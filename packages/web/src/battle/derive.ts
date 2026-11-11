/**
 * Everything the panels and the summary show, derived from the up-front
 * record (the event log, the timeline, the Core health per tick) or read off
 * the visual simulation state. Nothing here decides an outcome.
 */

import { occupancy, type BuildingDef, type PlacedBuilding } from '@game/core';
import type { WebContent } from '../content.js';
import type { Playback, BattleRecord } from './playback.js';

export type Side = 0 | 1;

/** Arena geometry in cells. */
export interface Geometry {
  readonly width: number;
  /** Total rows: both boards and the gap. */
  readonly height: number;
  readonly boardHeight: number;
  readonly gapRows: number;
}

export function geometryOf(record: BattleRecord): Geometry {
  const map = record.initialTeams[0].map;
  const gap = record.zone.depth;
  return {
    width: map.width,
    height: 2 * map.height + gap,
    boardHeight: map.height,
    gapRows: gap,
  };
}

/** View-space centre of an arena cell (the layout of `board/layout.ts`). */
export function arenaToView(
  g: Geometry,
  ax: number,
  ay: number,
): { x: number; y: number } {
  return { x: ax + 0.5, y: g.height - 1 - ay + 0.5 };
}

/** View-space centre of a board cell of `side`. */
export function boardCellToView(
  g: Geometry,
  side: Side,
  x: number,
  y: number,
): { x: number; y: number } {
  return side === 0
    ? arenaToView(g, x, y)
    : arenaToView(g, g.width - 1 - x, g.height - 1 - y);
}

// ---------------------------------------------------------------------------
// Building lookups

export interface BuildingRef {
  readonly placed: PlacedBuilding;
  readonly def: BuildingDef;
}

/** Placed buildings of the initial teams by (side, id). */
export function buildingIndex(
  record: BattleRecord,
  content: WebContent,
): readonly [Map<number, BuildingRef>, Map<number, BuildingRef>] {
  const make = (side: Side): Map<number, BuildingRef> => {
    const m = new Map<number, BuildingRef>();
    for (const placed of record.initialTeams[side].buildings) {
      const def = content.buildings.get(placed.def);
      if (def !== undefined) m.set(placed.id, { placed, def });
    }
    return m;
  };
  return [make(0), make(1)];
}

export const isWallLike = (def: BuildingDef): boolean =>
  def.kind === 'defense' &&
  (def.defenseType === 'wall' || def.defenseType === 'gate');

export function buildingName(content: WebContent, def: BuildingDef): string {
  return content.presentation.get(def.id)?.name ?? def.id;
}

// ---------------------------------------------------------------------------
// Notable moments

export type MomentKind =
  | 'zone'
  | 'overload'
  | 'breach'
  | 'junction'
  | 'production'
  | 'core_half'
  | 'core_quarter'
  | 'core_destroyed';

export interface Moment {
  /** Completed ticks at which it has happened (playback shows it from here). */
  readonly tick: number;
  readonly kind: MomentKind;
  readonly side: Side | null;
  readonly text: string;
  /** View-space point to look at, if the moment has a place. */
  readonly focus: { readonly x: number; readonly y: number } | null;
}

export interface MomentLabels {
  /** Subject words for each side, e.g. "Your" and "Enemy". */
  readonly side: readonly [string, string];
  readonly coreName: string;
  readonly zoneRevealed: string;
  readonly overload: string;
}

function buildingFocus(
  record: BattleRecord,
  content: WebContent,
  g: Geometry,
  side: Side,
  ref: BuildingRef,
): { x: number; y: number } {
  const cells = occupancy(record.initialTeams[side], content).cellsOf(
    ref.placed,
  );
  let sx = 0;
  let sy = 0;
  for (const c of cells) {
    const v = boardCellToView(g, side, c.x, c.y);
    sx += v.x;
    sy += v.y;
  }
  const n = Math.max(1, cells.length);
  return { x: sx / n, y: sy / n };
}

function coreFocus(
  record: BattleRecord,
  content: WebContent,
  g: Geometry,
  side: Side,
): { x: number; y: number } | null {
  const core = record.initialTeams[side].core;
  if (core === null) return null;
  const def = content.buildings.list().find((d) => d.kind === 'core');
  const fp = def?.footprint ?? { width: 1, height: 1 };
  const a = boardCellToView(g, side, core.x, core.y);
  const b = boardCellToView(
    g,
    side,
    core.x + fp.width - 1,
    core.y + fp.height - 1,
  );
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The notable moments of a whole battle, in time order. */
export function deriveMoments(
  record: BattleRecord,
  content: WebContent,
  labels: MomentLabels,
): readonly Moment[] {
  const g = geometryOf(record);
  const index = buildingIndex(record, content);
  const out: Moment[] = [];
  const firstWall: [boolean, boolean] = [false, false];
  out.push({
    tick: 0,
    kind: 'zone',
    side: null,
    text: labels.zoneRevealed,
    focus: null,
  });
  for (const e of record.eventLog) {
    if (e.type === 'overload_started') {
      out.push({
        tick: e.tick + 1,
        kind: 'overload',
        side: null,
        text: labels.overload,
        focus: null,
      });
    } else if (e.type === 'building_destroyed') {
      const side: Side = e.side === 0 ? 0 : 1;
      const ref = index[side].get(e.building);
      if (ref === undefined) continue;
      const name = buildingName(content, ref.def).toLowerCase();
      const who = labels.side[side];
      const focus = buildingFocus(record, content, g, side, ref);
      if (isWallLike(ref.def)) {
        if (firstWall[side]) continue;
        firstWall[side] = true;
        out.push({
          tick: e.tick + 1,
          kind: 'breach',
          side,
          text: `${who} first ${name} destroyed: a breach`,
          focus,
        });
      } else if (ref.def.kind === 'route') {
        out.push({
          tick: e.tick + 1,
          kind: 'junction',
          side,
          text: `${who} ${name} destroyed`,
          focus,
        });
      } else if (
        ref.def.kind === 'source' ||
        ref.def.kind === 'unit_producer' ||
        ref.def.kind === 'economy'
      ) {
        out.push({
          tick: e.tick + 1,
          kind: 'production',
          side,
          text: `${who} ${name} destroyed`,
          focus,
        });
      }
    } else if (e.type === 'core_destroyed') {
      const side: Side = e.side === 0 ? 0 : 1;
      out.push({
        tick: e.tick + 1,
        kind: 'core_destroyed',
        side,
        text: `${labels.side[side]} ${labels.coreName} destroyed`,
        focus: coreFocus(record, content, g, side),
      });
    }
  }
  for (const side of [0, 1] as const) {
    const hp = record.coreHp[side];
    const max = record.coreMax[side];
    if (max <= 0) continue;
    let half = false;
    let quarter = false;
    for (let t = 1; t < hp.length; t++) {
      const v = hp[t] ?? 0;
      if (v <= 0) break;
      if (!half && v * 2 < max) {
        half = true;
        out.push({
          tick: t,
          kind: 'core_half',
          side,
          text: `${labels.side[side]} ${labels.coreName} below 50%`,
          focus: coreFocus(record, content, g, side),
        });
      }
      if (!quarter && v * 4 < max) {
        quarter = true;
        out.push({
          tick: t,
          kind: 'core_quarter',
          side,
          text: `${labels.side[side]} ${labels.coreName} below 25%`,
          focus: coreFocus(record, content, g, side),
        });
      }
    }
  }
  return out.sort((a, b) => a.tick - b.tick);
}

// ---------------------------------------------------------------------------
// Statistics at the playback tick

export interface ProductionRate {
  readonly resource: string;
  readonly perSecond: number;
}

export interface SideStats {
  readonly coreHp: number;
  readonly coreMax: number;
  readonly wallsStanding: number;
  readonly wallsTotal: number;
  readonly unitsAlive: number;
  readonly unitsLost: number;
  readonly rampSteps: number;
  /** One entry per resource of the content, in content order. */
  readonly production: readonly ProductionRate[];
}

/** Ticks the production rate is averaged over (10 seconds at 10 ticks/s). */
const RATE_WINDOW_TICKS = 100;

export function sideStats(
  pb: Playback,
  content: WebContent,
  side: Side,
  ticksPerSecond: number,
): SideStats {
  const sim = pb.sim;
  const rec = pb.record;
  const tick = pb.tick;
  let wallsStanding = 0;
  for (const b of sim.teams[side].buildings) {
    const def = content.buildings.get(b.def);
    if (def !== undefined && isWallLike(def)) wallsStanding += 1;
  }
  let wallsTotal = 0;
  for (const b of rec.initialTeams[side].buildings) {
    const def = content.buildings.get(b.def);
    if (def !== undefined && isWallLike(def)) wallsTotal += 1;
  }
  let alive = 0;
  for (const u of sim.units) if (u.side === side) alive += 1;

  const window = Math.max(1, Math.min(RATE_WINDOW_TICKS, tick));
  const [from, to] = pb.eventRange(tick - window, tick);
  const counts = new Map<string, number>();
  let ramp = 0;
  for (let i = from; i < to; i++) {
    const e = rec.eventLog[i];
    if (e?.type === 'produced' && e.side === side) {
      counts.set(e.resource, (counts.get(e.resource) ?? 0) + 1);
    }
  }
  const [rFrom, rTo] = pb.eventRange(0, tick);
  for (let i = rFrom; i < rTo; i++) {
    const e = rec.eventLog[i];
    if (e?.type === 'ramp_step' && e.side === side) ramp += 1;
  }
  const seconds = window / ticksPerSecond;
  const coreHp =
    rec.coreHp[side][Math.min(tick, rec.coreHp[side].length - 1)] ?? 0;
  return {
    coreHp,
    coreMax: rec.coreMax[side],
    wallsStanding,
    wallsTotal,
    unitsAlive: alive,
    unitsLost: sim.unitsDied[side],
    rampSteps: ramp,
    production: content.resources.list().map((r) => ({
      resource: r.id,
      perSecond: (counts.get(r.id) ?? 0) / seconds,
    })),
  };
}

// ---------------------------------------------------------------------------
// Summary: per-building table and breaches

export interface BuildingRow {
  readonly key: string;
  readonly name: string;
  /** Instances covered by the row (walls are grouped). */
  readonly count: number;
  readonly produced: number;
  readonly delivered: number;
  readonly trained: number;
  readonly damage: number;
  readonly upgrades: number;
  /** Instances destroyed. */
  readonly lost: number;
  /** Tick of the first destruction, or null. */
  readonly firstLostTick: number | null;
}

interface Tally {
  produced: number;
  delivered: number;
  trained: number;
  damage: number;
  upgrades: number;
  lostTick: number | null;
}

/**
 * What each building of `side` did, from the event log. Walls and gates are
 * grouped by kind. Statistics the events do not carry (kills, resources
 * consumed) are not offered.
 */
export function buildingRows(
  record: BattleRecord,
  content: WebContent,
  side: Side,
): readonly BuildingRow[] {
  const tally = new Map<number, Tally>();
  const get = (id: number): Tally => {
    let t = tally.get(id);
    if (t === undefined) {
      t = {
        produced: 0,
        delivered: 0,
        trained: 0,
        damage: 0,
        upgrades: 0,
        lostTick: null,
      };
      tally.set(id, t);
    }
    return t;
  };
  const unitHome = new Map<number, number>();
  for (const e of record.eventLog) {
    switch (e.type) {
      case 'produced':
        if (e.side === side) get(e.building).produced += 1;
        break;
      case 'delivered':
        if (e.side === side) get(e.building).delivered += 1;
        break;
      case 'unit_spawned':
        if (e.side === side) {
          get(e.building).trained += 1;
          unitHome.set(e.unit, e.building);
        }
        break;
      case 'unit_attacked': {
        const home = unitHome.get(e.unit);
        if (home !== undefined) get(home).damage += e.damage;
        break;
      }
      case 'turret_fired':
        if (e.side === side) get(e.building).damage += e.damage;
        break;
      case 'ramp_step':
        if (e.side === side) get(e.building).upgrades += 1;
        break;
      case 'building_destroyed':
        if (e.side === side) get(e.building).lostTick = e.tick + 1;
        break;
      default:
        break;
    }
  }
  const rows: BuildingRow[] = [];
  const grouped = new Map<string, BuildingRow>();
  for (const placed of record.initialTeams[side].buildings) {
    const def = content.buildings.get(placed.def);
    if (def === undefined) continue;
    const t = get(placed.id);
    const base = {
      name: buildingName(content, def),
      produced: t.produced,
      delivered: t.delivered,
      trained: t.trained,
      damage: t.damage,
      upgrades: t.upgrades,
      lost: t.lostTick === null ? 0 : 1,
      firstLostTick: t.lostTick,
    };
    if (isWallLike(def)) {
      const prev = grouped.get(def.id);
      if (prev === undefined) {
        grouped.set(def.id, { key: def.id, count: 1, ...base });
      } else {
        grouped.set(def.id, {
          ...prev,
          count: prev.count + 1,
          lost: prev.lost + base.lost,
          firstLostTick:
            prev.firstLostTick === null
              ? base.firstLostTick
              : base.firstLostTick === null
                ? prev.firstLostTick
                : Math.min(prev.firstLostTick, base.firstLostTick),
        });
      }
    } else {
      rows.push({ key: `b${String(placed.id)}`, count: 1, ...base });
    }
  }
  return [...rows, ...grouped.values()];
}

/** The IDs of side `side`'s buildings and conduits destroyed in the battle. */
export function destroyedOf(
  record: BattleRecord,
  side: Side,
): { buildings: number[]; conduits: number[]; core: boolean } {
  const buildings: number[] = [];
  const conduits: number[] = [];
  let core = false;
  for (const e of record.eventLog) {
    if (e.type === 'building_destroyed' && e.side === side) {
      buildings.push(e.building);
    } else if (e.type === 'conduit_destroyed' && e.side === side) {
      conduits.push(e.conduit);
    } else if (e.type === 'core_destroyed' && e.side === side) {
      core = true;
    }
  }
  return { buildings, conduits, core };
}

/** `m:ss` for a tick count. */
export function clock(ticks: number, ticksPerSecond: number): string {
  const s = Math.floor(ticks / ticksPerSecond);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}
