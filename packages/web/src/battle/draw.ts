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
  for (const b of initial.boards) {
    const side = b.frame.id === 'own' ? 0 : 1;
    for (const s of b.buildings) rects[side].set(s.instance.id, s.rect);
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
  return { rects, coreRects: cores, conduitCells: conduits, boardLabels };
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
const LIFE_MAX = 16;

const FONT = '600 {s}px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// Scratch buffers, reused across frames.
let idToIndex = new Int32Array(0);
const tmp: Pt = { x: 0, y: 0 };
const tmp2: Pt = { x: 0, y: 0 };

/** One unit type on one side: the cut-out frames of its three animations. */
interface UnitArt {
  readonly idle: readonly HTMLCanvasElement[];
  readonly walk: readonly HTMLCanvasElement[];
  readonly attack: readonly HTMLCanvasElement[];
  readonly walkFps: number;
  readonly attackFps: number;
}

let artSet: SpriteSet | null = null;
const artCache = new Map<string, readonly [UnitArt | null, UnitArt | null]>();
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
      const idle = framesOf(set, `${def}@${tag}`);
      const walk = framesOf(set, `${def}@${tag}.walk`);
      const attack = framesOf(set, `${def}@${tag}.attack`);
      if (!idle || !walk || !attack) return null;
      return {
        idle,
        walk,
        attack,
        walkFps: findSprite(`${def}@${tag}.walk`)?.fps ?? 0,
        attackFps: findSprite(`${def}@${tag}.attack`)?.fps ?? 0,
      };
    };
    pair = [make('a'), make('b')];
    artCache.set(def, pair);
  }
  return side === 0 ? pair[0] : pair[1];
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
  outline: string,
  bg: string,
): void {
  for (const side of [0, 1] as const) {
    ctx.beginPath();
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined || (u.side === 0 ? 0 : 1) !== side) continue;
      if (unitArt(u.def, u.side) !== null) continue;
      pxOf(u, tmp);
      const ur = radiusOf(u);
      ctx.moveTo(tmp.x + ur, tmp.y);
      ctx.arc(tmp.x, tmp.y, ur, 0, Math.PI * 2);
    }
    ctx.fillStyle = side === 0 ? own : foe;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = outline;
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined || u.side === 0) continue;
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
  const sideColor = (s: number): string => (s === 0 ? own : foe);

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
      ctx.fillStyle = theme.outline;
      ctx.fillRect(bx, by, bw, 4);
      ctx.fillStyle = sideColor(side);
      ctx.fillRect(bx + 0.5, by + 0.5, Math.max(0, (bw - 1) * (h.hp / max)), 3);
    }
  }

  // --- Units ----------------------------------------------------------------
  // Units are circles at their real position and body radius (the collision
  // circle is smaller and soft, so neighbours may overlap on screen).
  const units = sim.units;
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
    if (k === 0) {
      const h = spriteHalf(ur, false);
      ctx.drawImage(img, tmp.x - h, tmp.y - h, h * 2, h * 2);
    } else {
      // A turned square pokes out of the circle: keep it inside the diameter
      // (but never below the minimum sprite size).
      const h = spriteHalf(ur, (k & 1) === 1);
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
        if (age >= LIFE_SHOT) break;
        const side = e.side === 0 ? 0 : 1;
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
