/**
 * The canvas overlay of the battle screen: resources in conduits, units,
 * health bars and short effects (attacks, spawns, destruction, ramp steps).
 * Everything is read from the `Playback` each frame; nothing is kept here
 * between frames except scratch buffers, so there is no per-unit allocation.
 */

import { CELL_UNITS, type UnitSim } from '@game/core';
import type { OverlayContext } from '../board/BoardView.js';
import type { Scene, ViewRect } from '../board/scene.js';
import type { WebContent } from '../content.js';
import type { Geometry } from './derive.js';
import type { Playback } from './playback.js';

type Pt = { x: number; y: number };

/** Geometry of the initial scene, for things that have since been destroyed. */
export interface DrawIndex {
  readonly rects: readonly [Map<number, ViewRect>, Map<number, ViewRect>];
  readonly coreRects: readonly [ViewRect | null, ViewRect | null];
  readonly conduitCells: readonly [
    Map<number, readonly Pt[]>,
    Map<number, readonly Pt[]>,
  ];
  readonly boardLabels: readonly { text: string; rect: ViewRect }[];
}

export function makeDrawIndex(
  initial: Scene,
  labels: { own: string; enemy: string },
): DrawIndex {
  const rects: [Map<number, ViewRect>, Map<number, ViewRect>] = [
    new Map<number, ViewRect>(),
    new Map<number, ViewRect>(),
  ];
  const cores: [ViewRect | null, ViewRect | null] = [null, null];
  const conduits: [Map<number, readonly Pt[]>, Map<number, readonly Pt[]>] = [
    new Map<number, readonly Pt[]>(),
    new Map<number, readonly Pt[]>(),
  ];
  const boardLabels: { text: string; rect: ViewRect }[] = [];
  for (const b of initial.boards) {
    const side = b.frame.id === 'own' ? 0 : 1;
    for (const s of b.buildings) rects[side].set(s.instance.id, s.rect);
    cores[side] = b.core?.rect ?? null;
    for (const c of b.conduits) conduits[side].set(c.id, c.cells);
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

  // --- Health bars of damaged buildings and the Cores ---------------------
  if (z >= 6) {
    const initial = pb.record.initialHealth;
    for (let i = 0; i < sim.health.length; i++) {
      const h = sim.health[i];
      const max = initial[i]?.hp ?? 0;
      if (h === undefined || max <= 0 || h.hp <= 0) continue;
      const isCore = h.building === 0;
      if (!isCore && h.hp >= max) continue;
      const side = h.side === 0 ? 0 : 1;
      const r = isCore
        ? index.coreRects[side]
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
  // Units are circles at their real position and radius (they never overlap).
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
  // Both sides are filled circles of their real radius; side 1 carries a
  // small diamond in the middle: shape as well as colour.
  ctx.beginPath();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined || u.side !== 0) continue;
    pxOf(u, tmp);
    const ur = radiusOf(u);
    ctx.moveTo(tmp.x + ur, tmp.y);
    ctx.arc(tmp.x, tmp.y, ur, 0, Math.PI * 2);
  }
  ctx.fillStyle = own;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.outline;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined || u.side === 0) continue;
    pxOf(u, tmp);
    const ur = radiusOf(u);
    ctx.moveTo(tmp.x + ur, tmp.y);
    ctx.arc(tmp.x, tmp.y, ur, 0, Math.PI * 2);
  }
  ctx.fillStyle = foe;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined || u.side === 0) continue;
    pxOf(u, tmp);
    const dd = radiusOf(u) * 0.5;
    ctx.moveTo(tmp.x, tmp.y - dd);
    ctx.lineTo(tmp.x + dd, tmp.y);
    ctx.lineTo(tmp.x, tmp.y + dd);
    ctx.lineTo(tmp.x - dd, tmp.y);
    ctx.closePath();
  }
  ctx.fillStyle = theme.boardBg;
  ctx.fill();

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
          have = rectCentre(index.coreRects[side], tmp2);
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
          have = rectCentre(index.coreRects[side], tmp);
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
