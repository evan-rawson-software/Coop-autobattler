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
import type { Playback } from './playback.js';

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
/** Per unit ID: 1 + the tick of its latest attack event. */
let attackedAt = new Int32Array(0);

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
  if (attackedAt.length < idToIndex.length) {
    attackedAt = new Int32Array(idToIndex.length);
  }
  {
    const [af, at] = pb.eventRange(tick - LIFE_ATTACK - 1, tick);
    for (let i = af; i < at; i++) {
      const e = pb.record.eventLog[i];
      if (e !== undefined && e.type === 'unit_attacked') {
        attackedAt[e.unit] = e.tick + 1;
      }
    }
  }
  const base = ctx.getTransform();
  const clock = (tick + frac) / pb.ticksPerSecond;
  ctx.imageSmoothingEnabled = false;
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
    const attacking = (attackedAt[u.id] ?? 0) >= tick - LIFE_ATTACK;
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
    // Pre-rotated for side B (it faces south at rest).
    const k = (pb.facing(u) - (u.side === 0 ? 0 : 4)) & 7;
    if (k === 0) {
      ctx.drawImage(img, tmp.x - ur, tmp.y - ur, ur * 2, ur * 2);
    } else {
      ctx.setTransform(base);
      ctx.translate(tmp.x, tmp.y);
      ctx.rotate(k * OCTANT);
      ctx.drawImage(img, -ur, -ur, ur * 2, ur * 2);
    }
    if (k !== 0) ctx.setTransform(base);
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
      ctx.fillStyle = theme.outline;
      ctx.fillRect(tmp.x - r, tmp.y - r - 5, r * 2, 3);
      ctx.fillStyle = sideColor(u.side);
      ctx.fillRect(tmp.x - r, tmp.y - r - 5, r * 2 * (u.hp / max), 3);
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
        let have = false;
        if (e.target.kind === 'unit') {
          const ti = idToIndex[e.target.unit] ?? -1;
          const t = ti >= 0 ? units[ti] : undefined;
          if (t !== undefined && t.id === e.target.unit) {
            pxOf(t, tmp2);
            have = true;
          }
        } else if (e.target.kind === 'building') {
          const side = e.target.side === 0 ? 0 : 1;
          have = rectCentre(index.rects[side].get(e.target.building), tmp2);
          if (have) {
            tmp2.x = ox + tmp2.x * z;
            tmp2.y = oy + tmp2.y * z;
          }
        } else {
          const side = e.target.side === 0 ? 0 : 1;
          have = rectCentre(index.coreRects[side][e.target.core], tmp2);
          if (have) {
            tmp2.x = ox + tmp2.x * z;
            tmp2.y = oy + tmp2.y * z;
          }
        }
        if (!have) break;
        pxOf(a, tmp);
        ctx.globalAlpha = 1 - age / LIFE_ATTACK;
        ctx.strokeStyle = theme.hover;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tmp.x, tmp.y);
        ctx.lineTo(tmp2.x, tmp2.y);
        ctx.stroke();
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
