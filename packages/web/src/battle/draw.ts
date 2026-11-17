/**
 * The canvas overlay of the battle screen: resources in conduits, units,
 * health bars and short effects (attacks, spawns, destruction, ramp steps).
 * Everything is read from the `Playback` each frame; nothing is kept here
 * between frames except scratch buffers, so there is no per-unit allocation.
 */

import {
  CELL_UNITS,
  buildFlowGraph,
  isCoreHealth,
  type TeamContent,
  type ArenaEvent,
  type ArenaSim,
  type TeamState,
  type UnitSim,
} from '@game/core';
import type { OverlayContext } from '../board/BoardView.js';
import type { Scene, ViewRect } from '../board/scene.js';
import type { WebContent } from '../content.js';
import type { Geometry } from './derive.js';
import {
  findSprite,
  frameCanvas,
  spriteSet,
  spriteStats,
  type SpriteSet,
} from '../sprites/atlas.js';
import { rampOf } from '../board/sprite-board.js';
import { restFacing, type Playback } from './playback.js';
import { spriteHalf, spriteReach } from './sprite-size.js';
import { bossMarks } from './boss.js';
import { drawPoints } from './draw-points.js';

type UnitsView = Pick<ArenaSim, 'health'>;
import { screenText, screenTexts } from '../build/texts.js';

type Pt = { x: number; y: number };

/** Geometry of the initial scene, for things that have since been destroyed. */
export interface DrawIndex {
  readonly rects: readonly [Map<number, ViewRect>, Map<number, ViewRect>];
  /** Each side's Core rectangles, by player index. */
  readonly coreRects: readonly [
    readonly (ViewRect | null)[],
    readonly (ViewRect | null)[],
  ];
  readonly conduitCells: readonly [
    Map<number, readonly Pt[]>,
    Map<number, readonly Pt[]>,
  ];
  readonly boardLabels: readonly { text: string; rect: ViewRect }[];
  /** Each side's refinery building IDs (their batches show as a pulse). */
  readonly refineries?: readonly [ReadonlySet<number>, ReadonlySet<number>];
  /** Each side's turrets with splash: building ID to the blast radius in cells. */
  readonly splashRadius?: readonly [
    ReadonlyMap<number, number>,
    ReadonlyMap<number, number>,
  ];
}

export function makeDrawIndex(
  initial: Scene,
  labels: { own: string; enemy: string },
  /** Each side's starting layout, to join the two halves of border links. */
  links?: readonly [
    ReadonlyMap<number, number> | undefined,
    ReadonlyMap<number, number> | undefined,
  ],
): DrawIndex {
  const rects: [Map<number, ViewRect>, Map<number, ViewRect>] = [
    new Map<number, ViewRect>(),
    new Map<number, ViewRect>(),
  ];
  const cores: [(ViewRect | null)[], (ViewRect | null)[]] = [[], []];
  const conduits: [Map<number, readonly Pt[]>, Map<number, readonly Pt[]>] = [
    new Map<number, readonly Pt[]>(),
    new Map<number, readonly Pt[]>(),
  ];
  const boardLabels: { text: string; rect: ViewRect }[] = [];
  const refineries: [Set<number>, Set<number>] = [new Set(), new Set()];
  const splashRadius: [Map<number, number>, Map<number, number>] = [
    new Map<number, number>(),
    new Map<number, number>(),
  ];
  for (const b of initial.boards) {
    const side = b.frame.id === 'own' ? 0 : 1;
    for (const s of b.buildings) {
      rects[side].set(s.instance.id, s.rect);
      if (s.def.kind === 'refinery') refineries[side].add(s.instance.id);
      if (s.def.kind === 'defense' && s.def.defenseType === 'turret') {
        const r = s.def.tiers[s.instance.tier - 1]?.splashRadiusCells;
        if (r !== undefined) splashRadius[side].set(s.instance.id, r);
      }
    }
    cores[side] = b.cores.map((c) => c?.rect ?? null);
    for (const c of b.conduits) conduits[side].set(c.id, c.cells);
    // A link is one flow edge under its sending half's id; its slots run
    // along the sending half and then the receiving half (PP-4).
    for (const [send, recv] of links?.[side] ?? []) {
      conduits[side].set(send, [
        ...(conduits[side].get(send) ?? []),
        ...(conduits[side].get(recv) ?? []),
      ]);
    }
    boardLabels.push({
      text: side === 0 ? labels.own : labels.enemy,
      rect: { x: b.frame.ox, y: b.frame.oy, w: b.frame.w, h: b.frame.h },
    });
  }
  return {
    rects,
    coreRects: cores,
    conduitCells: conduits,
    boardLabels,
    refineries,
    splashRadius,
  };
}

export interface BattleDrawData {
  readonly pb: Playback;
  readonly geo: Geometry;
  readonly index: DrawIndex;
  readonly content: WebContent;
}

// Effect lifetimes, in ticks.
const LIFE_ATTACK = 2;
const LIFE_SHOT = 3;
const LIFE_SPAWN = 5;
const LIFE_DESTROY = 14;
const LIFE_RAMP = 16;
// A refinery batch pulses; an item going in is a brief dot; an armored hit
// keeps its shield mark a little longer than the spark; a caster's shot flies
// for LIFE_PROJECTILE ticks, then its blast spreads for LIFE_BLAST.
const LIFE_BATCH = 12;
const LIFE_ITEM = 4;
const LIFE_ARMOR = 8;
const LIFE_PROJECTILE = 3;
const LIFE_BLAST = 8;
const LIFE_FLASH = 6;
const LIFE_BURST = 12;
const LIFE_SHIELD = 14;
const LIFE_BLOCK = 3;
const LIFE_MAX = 16;

/** A boss Core's shield and the lines to its pylons. */
const SHIELD = '#2e86de';
/** How much larger a champion is drawn than a unit of its type. */
const CHAMPION_SCALE = 1.7;

const FONT = '600 {s}px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// Scratch buffers, reused across frames.
let idToIndex = new Int32Array(0);
const tmp: Pt = { x: 0, y: 0 };
const tmp2: Pt = { x: 0, y: 0 };
const tmp3: Pt = { x: 0, y: 0 };

/** One unit type on one side: the cut-out frames of its three animations. */
interface UnitArt {
  readonly idle: readonly HTMLCanvasElement[];
  readonly walk: readonly HTMLCanvasElement[];
  readonly attack: readonly HTMLCanvasElement[];
  readonly walkFps: number;
  readonly attackFps: number;
}

let artSet: SpriteSet | null = null;
// Sides A and B, then the neutral guards (the untinted grey sprites).
const artCache = new Map<
  string,
  readonly [UnitArt | null, UnitArt | null, UnitArt | null]
>();
// Per unit ID, valid only when `attackGen` equals the current draw's
// generation: the index of its attack event in the log. Nothing outlives a
// frame, so the picture depends only on the playback state at the shown tick.
let attackGen = new Int32Array(0);
let attackEv = new Int32Array(0);
let generation = 0;

/**
 * How the units face: along their last step (`movement`) or always as their
 * side rests (`side`: A north, B south). The owner has not chosen yet.
 */
export const FACING_MODE: 'movement' | 'side' = 'movement';

/** Whether an attack event of tick `eventTick` still shows at tick `tick`. */
export function attackShows(eventTick: number, tick: number): boolean {
  return eventTick >= tick - LIFE_ATTACK && eventTick < tick;
}

/** Whether unit `id` shows its attack frame at the playback's tick (pure). */
export function isAttacking(pb: Playback, id: number): boolean {
  const [from, to] = pb.eventRange(pb.tick - LIFE_ATTACK, pb.tick);
  for (let i = from; i < to; i++) {
    const e = pb.record.eventLog[i];
    if (e?.type === 'unit_attacked' && e.unit === id) {
      if (attackShows(e.tick, pb.tick)) return true;
    }
  }
  return false;
}

function framesOf(set: SpriteSet, name: string): HTMLCanvasElement[] | null {
  const sp = findSprite(name);
  if (sp === undefined) return null;
  const out: HTMLCanvasElement[] = [];
  for (let f = 0; f < sp.frames; f++) {
    const c = frameCanvas(set, name, f);
    if (c === null) return null;
    out.push(c);
  }
  return out;
}

/**
 * The side's pre-tinted, side-shaped sprites of a unit type (`unit_x@a`,
 * `@b`, with `.walk` and `.attack`), or null to draw the flat circle. Built
 * once per type; the per-frame lookup allocates nothing.
 */
function unitArt(def: string, side: number): UnitArt | null {
  const set = spriteSet();
  if (set === null) return null;
  if (set !== artSet) {
    artCache.clear();
    artSet = set;
  }
  let pair = artCache.get(def);
  if (pair === undefined) {
    const make = (tag: string): UnitArt | null => {
      const name = tag === '' ? def : `${def}@${tag}`;
      const idle = framesOf(set, name);
      const walk = framesOf(set, `${name}.walk`);
      const attack = framesOf(set, `${name}.attack`);
      if (!idle || !walk || !attack) return null;
      return {
        idle,
        walk,
        attack,
        walkFps: findSprite(`${name}.walk`)?.fps ?? 0,
        attackFps: findSprite(`${name}.attack`)?.fps ?? 0,
      };
    };
    pair = [make('a'), make('b'), make('')];
    artCache.set(def, pair);
  }
  return side === 0 ? pair[0] : side === 1 ? pair[1] : pair[2];
}

const OCTANT = Math.PI / 4;

/** Effect, shadow and item sprites, cut out once per atlas; null parts fall back to flat drawing. */
interface FxArt {
  readonly hit: readonly HTMLCanvasElement[] | null;
  readonly boom: readonly HTMLCanvasElement[] | null;
  readonly puff: readonly HTMLCanvasElement[] | null;
  readonly shot: readonly HTMLCanvasElement[] | null;
  readonly shadow: HTMLCanvasElement | null;
}

let fxSet: SpriteSet | null = null;
let fxCache: FxArt | null = null;
// Tinted conduit item per resource id (null: no art, draw the flat circle).
const itemCache = new Map<string, HTMLCanvasElement | null>();
// The conduit item art has a 6 px dot in a 16 px frame; scale to match a circle.
const ITEM_FRAME_SCALE = 16 / 6;

function fxArt(): FxArt | null {
  const set = spriteSet();
  if (set === null) return null;
  if (set !== fxSet || fxCache === null) {
    itemCache.clear();
    fxSet = set;
    fxCache = {
      hit: framesOf(set, 'fx_hit_spark'),
      boom: framesOf(set, 'fx_explosion'),
      puff: framesOf(set, 'fx_spawn_puff'),
      shot: framesOf(set, 'fx_turret_shot'),
      shadow: frameCanvas(set, 'fx_shadow', 0),
    };
  }
  return fxCache;
}

function itemArt(res: string): HTMLCanvasElement | null {
  const hit = itemCache.get(res);
  if (hit !== undefined) return hit;
  const set = spriteSet();
  const ramp = set === null ? undefined : rampOf(set, res);
  const img =
    set === null || ramp === undefined
      ? null
      : frameCanvas(set, 'conduit_item', 0, ramp);
  itemCache.set(res, img);
  return img;
}

/** The frame of an effect `p` (0 to 1) of the way through its life. */
function fxFrame(
  frames: readonly HTMLCanvasElement[],
  p: number,
): HTMLCanvasElement | undefined {
  return frames[Math.min(frames.length - 1, Math.floor(p * frames.length))];
}

/**
 * The fallback: units without a sprite are filled circles of their real
 * radius; side B carries a small diamond in the middle (shape as well as colour).
 */
function drawFlatUnits(
  ctx: CanvasRenderingContext2D,
  units: readonly UnitSim[],
  pxOf: (u: UnitSim, out: Pt) => void,
  radiusOf: (u: UnitSim) => number,
  own: string,
  foe: string,
  guard: string,
  outline: string,
  bg: string,
): void {
  for (const side of [0, 1, 2] as const) {
    ctx.beginPath();
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined || (u.side === 0 ? 0 : u.side === 1 ? 1 : 2) !== side)
        continue;
      if (unitArt(u.def, u.side) !== null) continue;
      pxOf(u, tmp);
      const ur = radiusOf(u);
      ctx.moveTo(tmp.x + ur, tmp.y);
      ctx.arc(tmp.x, tmp.y, ur, 0, Math.PI * 2);
    }
    ctx.fillStyle = side === 0 ? own : side === 1 ? foe : guard;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = outline;
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined || u.side !== 1) continue;
    if (unitArt(u.def, u.side) !== null) continue;
    pxOf(u, tmp);
    const dd = radiusOf(u) * 0.5;
    ctx.moveTo(tmp.x, tmp.y - dd);
    ctx.lineTo(tmp.x + dd, tmp.y);
    ctx.lineTo(tmp.x, tmp.y + dd);
    ctx.lineTo(tmp.x - dd, tmp.y);
    ctx.closePath();
  }
  ctx.fillStyle = bg;
  ctx.fill();
}

function rectCentre(r: ViewRect | null | undefined, out: Pt): boolean {
  if (r === null || r === undefined) return false;
  out.x = r.x + r.w / 2;
  out.y = r.y + r.h / 2;
  return true;
}

/**
 * The mark of a hit that armor reduced: a small grey shield with the damage
 * that got through, rising a little as it fades (CB-5h). Plain hits show only
 * the spark.
 */
function drawArmorMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  damage: number,
  p: number,
  z: number,
  ink: string,
): void {
  const w = Math.max(4, z * 0.16);
  const h = Math.max(5, z * 0.2);
  const rise = z * 0.5 * p;
  const top = y - z * 0.35 - rise;
  ctx.save();
  ctx.globalAlpha = 1 - p;
  ctx.beginPath();
  ctx.moveTo(x - w, top);
  ctx.lineTo(x + w, top);
  ctx.lineTo(x + w, top + h * 0.6);
  ctx.lineTo(x, top + h * 1.3);
  ctx.lineTo(x - w, top + h * 0.6);
  ctx.closePath();
  ctx.fillStyle = '#9aa5b1';
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (z >= 14) {
    ctx.font = FONT.replace('{s}', String(Math.max(9, Math.min(13, z * 0.32))));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8a95a1';
    ctx.fillText(String(damage), x + w + 2, top + h * 0.5);
  }
  ctx.restore();
}

/**
 * Pylons (MM-9d): while a Core has a pylon standing it wears a shield, and a
 * line runs from each standing pylon to the Core it guards.
 */
function drawShields(
  ctx: CanvasRenderingContext2D,
  marks: ReturnType<typeof bossMarks>,
  sim: UnitsView,
  index: DrawIndex,
  ox: number,
  oy: number,
  z: number,
): void {
  const alive = new Set<number>();
  const cores = new Set<number>();
  for (const h of sim.health) {
    if (h.side !== 1 || h.hp <= 0) continue;
    if (isCoreHealth(h)) cores.add(h.core);
    else alive.add(h.building);
  }
  const lineW = Math.max(1.5, z * 0.08);
  ctx.save();
  ctx.strokeStyle = SHIELD;
  ctx.lineWidth = lineW;
  ctx.setLineDash([z * 0.25, z * 0.2]);
  for (const p of marks.pylons) {
    if (!alive.has(p.building) || !cores.has(p.core)) continue;
    const a = index.rects[1].get(p.building);
    const b = index.coreRects[1][p.core];
    if (a === undefined || b === null || b === undefined) continue;
    ctx.beginPath();
    ctx.moveTo(ox + (a.x + a.w / 2) * z, oy + (a.y + a.h / 2) * z);
    ctx.lineTo(ox + (b.x + b.w / 2) * z, oy + (b.y + b.h / 2) * z);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const shielded = new Set<number>();
  for (const p of marks.pylons) {
    if (alive.has(p.building) && cores.has(p.core)) shielded.add(p.core);
  }
  for (const core of shielded) {
    const r = index.coreRects[1][core];
    if (r === null || r === undefined) continue;
    const g = z * 0.25;
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = SHIELD;
    ctx.fillRect(
      ox + r.x * z - g,
      oy + r.y * z - g,
      r.w * z + 2 * g,
      r.h * z + 2 * g,
    );
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(2.5, z * 0.14);
    ctx.strokeRect(
      ox + r.x * z - g,
      oy + r.y * z - g,
      r.w * z + 2 * g,
      r.h * z + 2 * g,
    );
  }
  ctx.restore();
}

/** Linked Cores (MM-9d): a line joins the Cores that share one health. */
function drawCoreLink(
  ctx: CanvasRenderingContext2D,
  sim: UnitsView,
  index: DrawIndex,
  ox: number,
  oy: number,
  z: number,
  color: string,
  outline: string,
  chip: string | null,
): void {
  const pts: (Pt | undefined)[] = [];
  const rects = index.coreRects[1];
  for (const h of sim.health) {
    if (!isCoreHealth(h) || h.side !== 1 || h.hp <= 0) continue;
    const r = rects[h.core];
    if (r === null || r === undefined) continue;
    pts[h.core] = { x: ox + (r.x + r.w / 2) * z, y: oy + (r.y + r.h / 2) * z };
  }
  const line = pts.filter((p): p is Pt => p !== undefined);
  if (line.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [width, stroke] of [
    [Math.max(4, z * 0.2), outline],
    [Math.max(2, z * 0.1), color],
  ] as const) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.setLineDash(stroke === color ? [z * 0.3, z * 0.2] : []);
    ctx.beginPath();
    line.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const a = line[0];
  const b = line[1];
  if (chip !== null && a !== undefined && b !== undefined) {
    ctx.font = FONT.replace('{s}', '12');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const w = ctx.measureText(chip).width + 10;
    ctx.fillStyle = outline;
    ctx.fillRect(mx - w / 2, my - 9, w, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(chip, mx, my);
  }
  ctx.restore();
}

export function drawBattleOverlay(
  ctx: CanvasRenderingContext2D,
  o: OverlayContext,
  d: BattleDrawData,
): void {
  const { pb, geo, index, content } = d;
  const { camera: cam, viewport: vp, theme } = o;
  const z = cam.zoom;
  const ox = vp.w / 2 - cam.cx * z;
  const oy = vp.h / 2 - cam.cy * z;
  const sim = pb.sim;
  const tick = sim.tick;
  const frac = pb.frac;
  const own = theme.owners[0] ?? theme.ink;
  const foe = theme.owners[1] ?? theme.ink;
  const guardColor = theme.guard;
  const sideColor = (s: number): string =>
    s === 0 ? own : s === 1 ? foe : guardColor;

  // --- Board labels (rotated along the left edge) -------------------------
  if (z >= 8) {
    ctx.save();
    ctx.fillStyle = theme.inkMuted;
    ctx.font = FONT.replace('{s}', '12');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of index.boardLabels) {
      ctx.save();
      ctx.translate(
        ox + (l.rect.x - 0.8) * z,
        oy + (l.rect.y + l.rect.h / 2) * z,
      );
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // --- Resources in conduits ----------------------------------------------
  ctx.imageSmoothingEnabled = false;
  const fx = fxArt();
  const itemR = Math.max(2, z * 0.17);
  for (const side of [0, 1] as const) {
    const cells = index.conduitCells[side];
    for (const c of sim.boards[side].conduits) {
      const pts = cells.get(c.id);
      if (pts === undefined) continue;
      const slots = c.slots;
      for (let i = 0; i < slots.length; i++) {
        const res = slots[i];
        const p = pts[i];
        if (res === null || res === undefined || p === undefined) continue;
        const art = fx === null ? null : itemArt(res);
        if (art !== null) {
          const half = itemR * ITEM_FRAME_SCALE;
          ctx.drawImage(
            art,
            ox + p.x * z - half,
            oy + p.y * z - half,
            half * 2,
            half * 2,
          );
          continue;
        }
        const color = content.resources.get(res)?.color ?? theme.inkMuted;
        ctx.beginPath();
        ctx.arc(ox + p.x * z, oy + p.y * z, itemR, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = theme.outline;
        ctx.stroke();
      }
    }
  }

  // --- Fallen Cores: greyed out with a cross (follows the playback tick) ----
  for (const h of sim.health) {
    if (!isCoreHealth(h) || h.hp > 0) continue;
    const r = index.coreRects[h.side === 0 ? 0 : 1][h.core];
    if (r === null || r === undefined) continue;
    const x = ox + r.x * z;
    const y = oy + r.y * z;
    ctx.fillStyle = theme.outline;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(x, y, r.w * z, r.h * z);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = sideColor(h.side === 0 ? 0 : 1);
    ctx.lineWidth = Math.max(2, z * 0.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + r.w * z, y + r.h * z);
    ctx.moveTo(x + r.w * z, y);
    ctx.lineTo(x, y + r.h * z);
    ctx.stroke();
  }

  // --- Boss marks under the units: the Pylons' shields and lines, and the
  // link between linked Cores (MM-9d).
  const marks = bossMarks(sim);
  const pool = pb.record.linked[1]
    ? Math.max(0, sim.linkedPools?.find((p) => p.side === 1)?.hp ?? 0)
    : null;
  if (marks.pylons.length > 0) drawShields(ctx, marks, sim, index, ox, oy, z);
  if (marks.linked && z >= 4) {
    const chip = z >= 8 ? screenText(screenTexts, 'battleSharedChip') : null;
    drawCoreLink(ctx, sim, index, ox, oy, z, foe, theme.outline, chip);
  }

  // --- Health bars of damaged buildings and the Cores ---------------------
  if (z >= 6) {
    const initial = pb.record.initialHealth;
    for (let i = 0; i < sim.health.length; i++) {
      const h = sim.health[i];
      const max = initial[i]?.hp ?? 0;
      if (h === undefined || max <= 0 || h.hp <= 0) continue;
      const isCore = isCoreHealth(h);
      if (!isCore && h.hp >= max) continue;
      const side = h.side === 0 ? 0 : 1;
      const r = isCore
        ? (index.coreRects[side][h.core] ?? null)
        : index.rects[side].get(h.building);
      if (r === null || r === undefined) continue;
      const bw = r.w * z;
      const bx = ox + r.x * z;
      const by = oy + r.y * z - 6;
      // Linked Cores take their damage from the shared pool: every bar shows it.
      const frac =
        isCore && side === 1 && pool !== null
          ? pool / Math.max(1, pb.record.coreMax[1])
          : h.hp / max;
      ctx.fillStyle = theme.outline;
      ctx.fillRect(bx, by, bw, 4);
      ctx.fillStyle = sideColor(side);
      ctx.fillRect(bx + 0.5, by + 0.5, Math.max(0, (bw - 1) * frac), 3);
      // A Brood Core's burst thresholds: a tick on its bar for each.
      const ticks = isCore && side === 1 ? marks.bursts.get(h.core) : undefined;
      if (ticks !== undefined) {
        for (const m of ticks) {
          const mx = bx + bw * (m / 100);
          ctx.fillStyle = theme.ink;
          ctx.globalAlpha = frac * 100 <= m ? 0.4 : 1;
          ctx.fillRect(mx - 1, by - 2, 2, 8);
          ctx.strokeStyle = theme.boardBg;
          ctx.lineWidth = 1;
          ctx.strokeRect(mx - 1.5, by - 2.5, 3, 9);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // --- Points of interest, under the units (shown once the zone is revealed) ---
  if (pb.revealed) drawPoints(ctx, o, d, (tick + frac) / pb.ticksPerSecond);

  // --- Units ----------------------------------------------------------------
  // Units are circles at their real position and body radius (the collision
  // circle is smaller and soft, so neighbours may overlap on screen).
  // The neutral guards are part of the zone: not shown before it is revealed.
  const units = pb.revealed ? sim.units : sim.units.filter((u) => u.side !== 2);
  if (idToIndex.length < sim.nextUnitId + 1) {
    idToIndex = new Int32Array(
      Math.max(sim.nextUnitId + 1, idToIndex.length * 2),
    );
  }
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u !== undefined) idToIndex[u.id] = i;
  }
  const radiusOf = (u: UnitSim): number =>
    Math.max(2, ((content.units.get(u.def)?.radius ?? 72) / CELL_UNITS) * z);
  const r = Math.max(2.5, z * 0.3);
  const pxOf = (u: UnitSim, out: Pt): void => {
    pb.displayPos(u, out);
    out.x = ox + out.x * z;
    out.y = oy + (geo.height - out.y) * z;
  };
  // Units with a sprite are drawn from the atlas, facing their movement
  // (the art faces north for side A and south for side B at rest); the rest
  // fall back to circles. Side B also carries a diamond: shape as well as
  // colour (the sprites differ in shape too).
  if (attackGen.length < idToIndex.length) {
    attackGen = new Int32Array(idToIndex.length);
    attackEv = new Int32Array(idToIndex.length);
  }
  generation++;
  {
    const [af, at] = pb.eventRange(tick - LIFE_ATTACK, tick);
    const log = pb.record.eventLog;
    for (let i = af; i < at; i++) {
      const e = log[i];
      if (
        e !== undefined &&
        e.type === 'unit_attacked' &&
        attackShows(e.tick, tick)
      ) {
        attackGen[e.unit] = generation;
        attackEv[e.unit] = i;
      }
    }
  }
  // The screen point of an attack's target; false when it is not available.
  const targetPoint = (
    e: Extract<ArenaEvent, { type: 'unit_attacked' }>,
    out: Pt,
  ) => {
    if (e.target.kind === 'unit') {
      const ti = idToIndex[e.target.unit] ?? -1;
      const t = ti >= 0 ? units[ti] : undefined;
      if (t === undefined || t.id !== e.target.unit) return false;
      pxOf(t, out);
      return true;
    }
    const side = e.target.side === 0 ? 0 : 1;
    const r =
      e.target.kind === 'building'
        ? index.rects[side].get(e.target.building)
        : index.coreRects[side][e.target.core];
    if (!rectCentre(r, out)) return false;
    out.x = ox + out.x * z;
    out.y = oy + out.y * z;
    return true;
  };
  // Whether unit `id` is on the board and wears armor.
  const armored = (id: number): boolean => {
    const i = idToIndex[id] ?? -1;
    const t = i >= 0 ? units[i] : undefined;
    return (
      t !== undefined &&
      t.id === id &&
      (t.armor ?? content.units.get(t.def)?.armor ?? 0) > 0
    );
  };
  const base = ctx.getTransform();
  const clock = (tick + frac) / pb.ticksPerSecond;
  if (fx?.shadow) {
    // Flyers cast a soft shadow under their sprite, drawn before any unit.
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined || content.units.get(u.def)?.flying !== true)
        continue;
      if (unitArt(u.def, u.side) === null) continue;
      pxOf(u, tmp);
      const h = spriteHalf(radiusOf(u), false);
      ctx.drawImage(fx.shadow, tmp.x - h, tmp.y - h + h * 0.4, h * 2, h * 2);
    }
  }
  const champions = pb.record.champions;
  let flat = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined) continue;
    const art = unitArt(u.def, u.side);
    if (art === null) {
      flat++;
      continue;
    }
    pxOf(u, tmp);
    const ur = radiusOf(u);
    const attacking = attackGen[u.id] === generation;
    const frames = attacking
      ? art.attack
      : pb.isMoving(u)
        ? art.walk
        : art.idle;
    const fps = attacking ? art.attackFps : art.walkFps;
    const n = frames.length;
    const img =
      frames[n > 1 ? (Math.floor(clock * fps) + u.id) % n : 0] ?? frames[0];
    if (img === undefined) continue;
    // The art is drawn facing the side's rest direction (B is pre-flipped).
    let face = FACING_MODE === 'movement' ? pb.facing(u) : restFacing(u.side);
    if (attacking && FACING_MODE === 'movement') {
      const e = pb.record.eventLog[attackEv[u.id] ?? 0];
      if (e?.type === 'unit_attacked' && targetPoint(e, tmp2)) {
        const dx = tmp2.x - tmp.x;
        const dy = tmp2.y - tmp.y;
        if (dx * dx + dy * dy > 1) {
          face = Math.round(Math.atan2(dx, -dy) / OCTANT) & 7;
        }
      }
    }
    const k = (face - restFacing(u.side)) & 7;
    // A champion (Warlord) is drawn larger than the unit it is made from.
    const big = champions[u.id] !== undefined ? CHAMPION_SCALE : 1;
    if (k === 0) {
      const h = spriteHalf(ur, false) * big;
      ctx.drawImage(img, tmp.x - h, tmp.y - h, h * 2, h * 2);
    } else {
      // A turned square pokes out of the circle: keep it inside the diameter
      // (but never below the minimum sprite size).
      const h = spriteHalf(ur, (k & 1) === 1) * big;
      ctx.setTransform(base);
      ctx.translate(tmp.x, tmp.y);
      ctx.rotate(k * OCTANT);
      ctx.drawImage(img, -h, -h, h * 2, h * 2);
      ctx.setTransform(base);
    }
  }
  spriteStats.drawn += units.length - flat;
  spriteStats.units += units.length - flat;
  if (flat > 0) {
    drawFlatUnits(
      ctx,
      units,
      pxOf,
      radiusOf,
      own,
      foe,
      guardColor,
      theme.outline,
      theme.boardBg,
    );
  }

  // Health bars of damaged units, when zoomed in.
  if (z >= 18) {
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined) continue;
      const max = content.units.get(u.def)?.health ?? 0;
      if (max <= 0 || u.hp >= max) continue;
      pxOf(u, tmp);
      // Clear of a sprite that was enlarged to the minimum size.
      const up =
        unitArt(u.def, u.side) === null
          ? r
          : Math.max(r, spriteReach(radiusOf(u)));
      ctx.fillStyle = theme.outline;
      ctx.fillRect(tmp.x - r, tmp.y - up - 5, r * 2, 3);
      ctx.fillStyle = sideColor(u.side);
      ctx.fillRect(tmp.x - r, tmp.y - up - 5, r * 2 * (u.hp / max), 3);
    }
  }

  // A champion has its own health bar, whole or hurt, and a ring in its
  // side's colour so it stands out in the crowd.
  if (marks.champions) {
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined) continue;
      const max = champions[u.id];
      if (max === undefined || max <= 0) continue;
      pxOf(u, tmp);
      const half = spriteHalf(radiusOf(u), false) * CHAMPION_SCALE;
      ctx.strokeStyle = sideColor(u.side);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(
        tmp.x,
        tmp.y + half * 0.55,
        half * 0.8,
        half * 0.3,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      const bw = Math.max(24, half * 2);
      const by = tmp.y - half - 8;
      ctx.fillStyle = theme.outline;
      ctx.fillRect(tmp.x - bw / 2 - 1, by - 1, bw + 2, 7);
      ctx.fillStyle = sideColor(u.side);
      ctx.fillRect(
        tmp.x - bw / 2,
        by,
        Math.max(0, bw * Math.min(1, u.hp / max)),
        5,
      );
    }
  }

  // --- Effects ----------------------------------------------------------------
  const [from, to] = pb.eventRange(tick - LIFE_MAX, tick);
  const log = pb.record.eventLog;
  ctx.lineCap = 'round';
  for (let i = from; i < to; i++) {
    const e = log[i];
    if (e === undefined) continue;
    const age = tick - 1 - e.tick + frac; // 0 .. life
    switch (e.type) {
      case 'unit_attacked': {
        if (
          e.target.kind === 'unit' &&
          age < LIFE_ARMOR &&
          armored(e.target.unit) &&
          targetPoint(e, tmp3)
        ) {
          drawArmorMark(
            ctx,
            tmp3.x,
            tmp3.y,
            e.damage,
            age / LIFE_ARMOR,
            z,
            theme.ink,
          );
        }
        if (age >= LIFE_ATTACK) break;
        const ai = idToIndex[e.unit] ?? -1;
        const a = ai >= 0 ? units[ai] : undefined;
        if (a === undefined || a.id !== e.unit) break;
        const have = targetPoint(e, tmp2);
        if (!have) break;
        pxOf(a, tmp);
        ctx.globalAlpha = 1 - age / LIFE_ATTACK;
        ctx.strokeStyle = theme.hover;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tmp.x, tmp.y);
        ctx.lineTo(tmp2.x, tmp2.y);
        ctx.stroke();
        const spark = fx?.hit ? fxFrame(fx.hit, age / LIFE_ATTACK) : undefined;
        if (spark !== undefined) {
          const half = Math.max(8, z * 0.4);
          ctx.globalAlpha = 1;
          ctx.drawImage(
            spark,
            tmp2.x - half,
            tmp2.y - half,
            half * 2,
            half * 2,
          );
          spriteStats.effects++;
          break;
        }
        ctx.beginPath();
        ctx.arc(tmp2.x, tmp2.y, r * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = theme.hover;
        ctx.fill();
        break;
      }
      case 'turret_fired': {
        if (age < LIFE_ARMOR && armored(e.unit)) {
          const ti = idToIndex[e.unit] ?? -1;
          const t = ti >= 0 ? units[ti] : undefined;
          if (t !== undefined && t.id === e.unit) {
            pxOf(t, tmp3);
            drawArmorMark(
              ctx,
              tmp3.x,
              tmp3.y,
              e.damage,
              age / LIFE_ARMOR,
              z,
              theme.ink,
            );
          }
        }
        const side = e.side === 0 ? 0 : 1;
        if (e.splash !== undefined) {
          // A turret shell (the Mortar): when it lands a blast of the splash
          // radius spreads round the target, and each unit it hits flashes.
          const born = LIFE_SHOT - 1;
          const radius = index.splashRadius?.[side].get(e.building) ?? 1;
          const ci = idToIndex[e.unit] ?? -1;
          const c = ci >= 0 ? units[ci] : undefined;
          if (c !== undefined && c.id === e.unit && age >= born) {
            if (age < born + LIFE_BLAST) {
              const p = (age - born) / LIFE_BLAST;
              pxOf(c, tmp2);
              ctx.beginPath();
              ctx.arc(
                tmp2.x,
                tmp2.y,
                radius * z * (0.35 + 0.65 * Math.min(1, p * 2)),
                0,
                Math.PI * 2,
              );
              ctx.globalAlpha = 0.28 * (1 - p);
              ctx.fillStyle = sideColor(side);
              ctx.fill();
              ctx.globalAlpha = 1 - p;
              ctx.strokeStyle = sideColor(side);
              ctx.lineWidth = 2;
              ctx.stroke();
            }
            if (age < born + LIFE_FLASH) {
              const p = (age - born) / LIFE_FLASH;
              for (const hit of e.splash) {
                const hi = idToIndex[hit.unit] ?? -1;
                const h = hi >= 0 ? units[hi] : undefined;
                if (h === undefined || h.id !== hit.unit) continue;
                pxOf(h, tmp2);
                ctx.globalAlpha = 0.7 * (1 - p);
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(
                  tmp2.x,
                  tmp2.y,
                  Math.max(3, radiusOf(h)),
                  0,
                  Math.PI * 2,
                );
                ctx.fill();
              }
            }
            ctx.globalAlpha = 1;
          }
        }
        if (age >= LIFE_SHOT) break;
        if (!rectCentre(index.rects[side].get(e.building), tmp)) break;
        const ti = idToIndex[e.unit] ?? -1;
        const t = ti >= 0 ? units[ti] : undefined;
        if (t === undefined || t.id !== e.unit) break;
        pxOf(t, tmp2);
        const shot = fx?.shot ? fxFrame(fx.shot, age / LIFE_SHOT) : undefined;
        if (shot !== undefined) {
          // The shot flies from the turret to the target over its life.
          const q = age / LIFE_SHOT;
          const sx = ox + tmp.x * z;
          const sy = oy + tmp.y * z;
          const half = Math.max(4, z * 0.25);
          ctx.globalAlpha = 1;
          ctx.setTransform(base);
          ctx.translate(sx + (tmp2.x - sx) * q, sy + (tmp2.y - sy) * q);
          ctx.rotate(Math.atan2(tmp2.x - sx, -(tmp2.y - sy)));
          ctx.drawImage(shot, -half, -half, half * 2, half * 2);
          ctx.setTransform(base);
          spriteStats.effects++;
          break;
        }
        ctx.globalAlpha = 1 - age / LIFE_SHOT;
        ctx.strokeStyle = sideColor(side);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ox + tmp.x * z, oy + tmp.y * z);
        ctx.lineTo(tmp2.x, tmp2.y);
        ctx.stroke();
        break;
      }
      case 'unit_spawned': {
        if (age >= LIFE_SPAWN) break;
        const p = age / LIFE_SPAWN;
        const puff = fx?.puff ? fxFrame(fx.puff, p) : undefined;
        if (puff !== undefined) {
          const half = z * 0.8;
          const cx = ox + (e.px / CELL_UNITS) * z;
          const cy = oy + (geo.height - e.py / CELL_UNITS) * z;
          ctx.globalAlpha = 1;
          ctx.drawImage(puff, cx - half, cy - half, half * 2, half * 2);
          spriteStats.effects++;
          break;
        }
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = sideColor(e.side);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
          ox + (e.px / CELL_UNITS) * z,
          oy + (geo.height - e.py / CELL_UNITS) * z,
          z * (0.3 + 0.5 * p),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        break;
      }
      case 'splash': {
        // The caster's shot flies to the target, then a blast of the splash
        // radius spreads there; every unit it hits flashes.
        const cx = ox + (e.x / CELL_UNITS) * z;
        const cy = oy + (geo.height - e.y / CELL_UNITS) * z;
        const ai = idToIndex[e.attacker] ?? -1;
        const a = ai >= 0 ? units[ai] : undefined;
        const caster = a !== undefined && a.id === e.attacker ? a : undefined;
        if (age < LIFE_PROJECTILE && caster !== undefined) {
          pxOf(caster, tmp);
          const q = age / LIFE_PROJECTILE;
          const px = tmp.x + (cx - tmp.x) * q;
          const py = tmp.y + (cy - tmp.y) * q;
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = theme.hover;
          ctx.lineWidth = Math.max(2, z * 0.08);
          ctx.beginPath();
          ctx.moveTo(tmp.x + (px - tmp.x) * 0.4, tmp.y + (py - tmp.y) * 0.4);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(3, z * 0.13), 0, Math.PI * 2);
          ctx.fillStyle = theme.hover;
          ctx.fill();
          ctx.strokeStyle = theme.outline;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        const born = LIFE_PROJECTILE - 1;
        if (age >= born && age < born + LIFE_BLAST) {
          const p = (age - born) / LIFE_BLAST;
          const sub =
            (caster === undefined
              ? undefined
              : content.units.get(caster.def)?.splash?.radiusSub) ?? CELL_UNITS;
          const rad =
            (sub / CELL_UNITS) * z * (0.35 + 0.65 * Math.min(1, p * 2));
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          ctx.globalAlpha = 0.28 * (1 - p);
          ctx.fillStyle = theme.hover;
          ctx.fill();
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = theme.hover;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (age >= born && age < born + LIFE_FLASH) {
          const p = (age - born) / LIFE_FLASH;
          for (const hit of e.targets) {
            const ti = idToIndex[hit.unit] ?? -1;
            const t = ti >= 0 ? units[ti] : undefined;
            if (t === undefined || t.id !== hit.unit) continue;
            pxOf(t, tmp2);
            ctx.globalAlpha = 0.7 * (1 - p);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(tmp2.x, tmp2.y, Math.max(3, radiusOf(t)), 0, Math.PI * 2);
            ctx.fill();
            if (armored(hit.unit)) {
              drawArmorMark(ctx, tmp2.x, tmp2.y, hit.damage, p, z, theme.ink);
            }
          }
        }
        break;
      }
      case 'produced':
      case 'delivered': {
        // A refinery at work: each item that goes in is a dot at the building,
        // and a finished batch is a pulse of the compound's colour. The
        // compound itself then travels down the output conduit as items.
        const side = e.side === 0 ? 0 : 1;
        if (index.refineries?.[side].has(e.building) !== true) break;
        const rr = index.rects[side].get(e.building);
        if (rr === undefined) break;
        const color = content.resources.get(e.resource)?.color ?? theme.hover;
        const x = ox + rr.x * z;
        const y = oy + rr.y * z;
        if (e.type === 'delivered') {
          if (age >= LIFE_ITEM) break;
          const p = age / LIFE_ITEM;
          ctx.globalAlpha = 1 - p;
          ctx.fillStyle = color;
          ctx.strokeStyle = theme.outline;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(
            x + (rr.w * z) / 2,
            y + (rr.h * z) / 2,
            Math.max(3, z * 0.2) * (1 - p * 0.5),
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.stroke();
          break;
        }
        if (age >= LIFE_BATCH) break;
        const prev = log[i - 1];
        if (
          prev !== undefined &&
          prev.type === 'produced' &&
          prev.tick === e.tick &&
          prev.building === e.building
        ) {
          break; // One pulse per batch, not per item of the batch.
        }
        const p = age / LIFE_BATCH;
        ctx.globalAlpha = 0.45 * (1 - p);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, rr.w * z, rr.h * z);
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, z * 0.1);
        const grow = z * 0.35 * p;
        ctx.strokeRect(
          x - grow,
          y - grow,
          rr.w * z + 2 * grow,
          rr.h * z + 2 * grow,
        );
        break;
      }
      case 'building_destroyed':
      case 'core_destroyed':
      case 'conduit_destroyed': {
        if (age >= LIFE_DESTROY) break;
        const side = e.side === 0 ? 0 : 1;
        let have = false;
        if (e.type === 'building_destroyed') {
          have = rectCentre(index.rects[side].get(e.building), tmp);
        } else if (e.type === 'core_destroyed') {
          have = rectCentre(index.coreRects[side][e.core], tmp);
        } else {
          const cells = index.conduitCells[side].get(e.conduit);
          const mid = cells?.[Math.floor((cells.length - 1) / 2)];
          if (mid !== undefined) {
            tmp.x = mid.x;
            tmp.y = mid.y;
            have = true;
          }
        }
        if (!have) break;
        const p = age / LIFE_DESTROY;
        const boom = fx?.boom ? fxFrame(fx.boom, p) : undefined;
        if (boom !== undefined) {
          const half = z * 1.25;
          ctx.globalAlpha = 1;
          ctx.drawImage(
            boom,
            ox + tmp.x * z - half,
            oy + tmp.y * z - half,
            half * 2,
            half * 2,
          );
          spriteStats.effects++;
          break;
        }
        const rad = z * (0.6 + 1.6 * p);
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = theme.hover;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ox + tmp.x * z, oy + tmp.y * z, rad, 0, Math.PI * 2);
        ctx.stroke();
        const k = z * 0.5;
        ctx.beginPath();
        ctx.moveTo(ox + tmp.x * z - k, oy + tmp.y * z - k);
        ctx.lineTo(ox + tmp.x * z + k, oy + tmp.y * z + k);
        ctx.moveTo(ox + tmp.x * z + k, oy + tmp.y * z - k);
        ctx.lineTo(ox + tmp.x * z - k, oy + tmp.y * z + k);
        ctx.stroke();
        break;
      }
      case 'burst_released': {
        // A Brood Core bursts: a flash on the Core and a ring that spreads.
        if (age >= LIFE_BURST) break;
        const rr = index.coreRects[e.side === 0 ? 0 : 1][e.core];
        if (rr === null || rr === undefined) break;
        const p = age / LIFE_BURST;
        const x = ox + rr.x * z;
        const y = oy + rr.y * z;
        ctx.globalAlpha = 0.5 * (1 - p);
        ctx.fillStyle = theme.hover;
        ctx.fillRect(x, y, rr.w * z, rr.h * z);
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = theme.hover;
        ctx.lineWidth = Math.max(3, z * 0.15);
        ctx.beginPath();
        ctx.arc(
          x + (rr.w * z) / 2,
          y + (rr.h * z) / 2,
          (Math.max(rr.w, rr.h) / 2 + 0.6 + 2.2 * p) * z,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        break;
      }
      case 'core_shield_down':
      case 'core_hit_blocked': {
        // The shield drops: its ring spreads and fades. A blocked hit makes it
        // flash for a moment.
        const life = e.type === 'core_shield_down' ? LIFE_SHIELD : LIFE_BLOCK;
        if (age >= life) break;
        const rr = index.coreRects[e.side === 0 ? 0 : 1][e.core];
        if (rr === null || rr === undefined) break;
        const p = age / life;
        const grow =
          e.type === 'core_shield_down' ? z * (0.5 + 2 * p) : z * 0.3;
        ctx.globalAlpha = (e.type === 'core_shield_down' ? 1 : 0.7) * (1 - p);
        ctx.strokeStyle = SHIELD;
        ctx.lineWidth = Math.max(3, z * 0.16);
        ctx.setLineDash(
          e.type === 'core_shield_down' ? [z * 0.3, z * 0.2] : [],
        );
        ctx.strokeRect(
          ox + rr.x * z - grow,
          oy + rr.y * z - grow,
          rr.w * z + 2 * grow,
          rr.h * z + 2 * grow,
        );
        ctx.setLineDash([]);
        break;
      }
      case 'ramp_step': {
        if (age >= LIFE_RAMP) break;
        const side = e.side === 0 ? 0 : 1;
        if (!rectCentre(index.rects[side].get(e.building), tmp)) break;
        const p = age / LIFE_RAMP;
        const rr = index.rects[side].get(e.building);
        const lift = z * 0.9 * p;
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = theme.select;
        const cx = ox + tmp.x * z;
        const cy = oy + (rr ? rr.y : tmp.y) * z - lift - 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy - z * 0.35);
        ctx.lineTo(cx + z * 0.3, cy + z * 0.15);
        ctx.lineTo(cx - z * 0.3, cy + z * 0.15);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default:
        break;
    }
  }
  ctx.globalAlpha = 1;
}

/** Sending half id to receiving half id, for each joined link of a team. */
export function linkMap(
  team: TeamState,
  content: TeamContent,
): ReadonlyMap<number, number> {
  const m = new Map<number, number>();
  try {
    for (const e of buildFlowGraph(team, content).edges) {
      if (e.linkedConduit !== null) m.set(e.conduitId, e.linkedConduit);
    }
  } catch {
    // A layout the flow graph cannot read draws every half as unconnected.
    m.clear();
  }
  return m;
}
