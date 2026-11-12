/**
 * Everything the panels and the summary show, derived from the up-front
 * record (the event log, the timeline, the Core health per tick) or read off
 * the visual simulation state. Nothing here decides an outcome.
 */

import {
  occupancy,
  isCoreHealth,
  type BattleSummary,
  type BuildingDef,
  type PlacedBuilding,
  conduitTouches,
} from '@game/core';
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

export const isTurret = (def: BuildingDef): boolean =>
  def.kind === 'defense' && def.defenseType === 'turret';

export function buildingName(content: WebContent, def: BuildingDef): string {
  return content.presentation.get(def.id)?.name ?? def.id;
}

// ---------------------------------------------------------------------------
// Notable moments

export type MomentKind =
  | 'zone'
  | 'overload'
  | 'breach'
  | 'turret'
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

/** How many Cores the side placed. */
export function placed(record: BattleRecord, side: Side): number {
  return record.initialTeams[side].cores.filter((c) => c !== null).length;
}

function coreFocus(
  record: BattleRecord,
  content: WebContent,
  g: Geometry,
  side: Side,
  /** The player whose Core; the first placed Core when omitted. */
  player?: number,
): { x: number; y: number } | null {
  const cores = record.initialTeams[side].cores;
  const core =
    (player === undefined ? cores.find((c) => c !== null) : cores[player]) ??
    null;
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
      } else if (isTurret(ref.def)) {
        out.push({
          tick: e.tick + 1,
          kind: 'turret',
          side,
          text: `${who} ${name} destroyed`,
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
        text:
          placed(record, side) > 1
            ? `${labels.side[side]} ${labels.coreName} ${String(e.core + 1)} fell`
            : `${labels.side[side]} ${labels.coreName} destroyed`,
        focus: coreFocus(record, content, g, side, e.core),
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

/** One Core's health at the playback position. */
export interface CoreNow {
  readonly player: number;
  readonly hp: number;
  readonly max: number;
}

export interface SideStats {
  readonly coreHp: number;
  readonly coreMax: number;
  /** Each placed Core's health now, by player. */
  readonly cores: readonly CoreNow[];
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
  const cores: CoreNow[] = [];
  sim.health.forEach((h, i) => {
    if (isCoreHealth(h) && h.side === side) {
      cores.push({
        player: h.core,
        hp: Math.max(0, h.hp),
        max: rec.initialHealth[i]?.hp ?? 0,
      });
    }
  });
  cores.sort((a, b) => a.player - b.player);
  return {
    coreHp,
    coreMax: rec.coreMax[side],
    cores,
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
  /** Why a unit producer trained nothing, when the log shows it; else null. */
  readonly note: string | null;
}

interface Tally {
  produced: number;
  delivered: number;
  trained: number;
  damage: number;
  upgrades: number;
  lostTick: number | null;
}

/** Why a unit producer that trained nothing did so, when it can be told. */
function idleNote(
  isProducer: boolean,
  t: Tally,
  team: BattleRecord['initialTeams'][number],
  id: number,
): string | null {
  if (!isProducer || t.trained > 0 || t.lostTick !== null) return null;
  const wired = team.conduits.some((c) => conduitTouches(c, id));
  if (!wired) return 'produced no units: no conduit was connected to it';
  if (t.delivered === 0) {
    return 'produced no units: it never received its input resource';
  }
  return null;
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
      note: idleNote(
        def.kind === 'unit_producer',
        t,
        record.initialTeams[side],
        placed.id,
      ),
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
): { buildings: number[]; conduits: number[]; cores: number[] } {
  const buildings: number[] = [];
  const conduits: number[] = [];
  const cores: number[] = [];
  for (const e of record.eventLog) {
    if (e.type === 'building_destroyed' && e.side === side) {
      buildings.push(e.building);
    } else if (e.type === 'conduit_destroyed' && e.side === side) {
      conduits.push(e.conduit);
    } else if (e.type === 'core_destroyed' && e.side === side) {
      cores.push(e.core);
    }
  }
  return { buildings, conduits, cores };
}

// ---------------------------------------------------------------------------
// Army strength chart

export interface ChartData {
  readonly own: readonly { x: number; y: number }[];
  readonly foe: readonly { x: number; y: number }[];
  /** Largest value among the samples up to the limit (at least 1). */
  readonly yMax: number;
}

/**
 * The army-strength series (unit health summed per side) of the samples up
 * to and including `upTo`. `yMax` covers only those samples, so a chart of
 * the battle so far never shows what comes later.
 */
export function strengthSeries(
  timeline: BattleSummary['timeline'],
  upTo: number,
): ChartData {
  const own: { x: number; y: number }[] = [];
  const foe: { x: number; y: number }[] = [];
  let yMax = 1;
  for (const s of timeline) {
    if (s.tick > upTo) continue;
    yMax = Math.max(yMax, s.sides[0].unitHealth, s.sides[1].unitHealth);
    own.push({ x: s.tick, y: s.sides[0].unitHealth });
    foe.push({ x: s.tick, y: s.sides[1].unitHealth });
  }
  return { own, foe, yMax };
}

/** Shortest time span the live chart shows, in seconds. */
export const LIVE_AXIS_MIN_SECONDS = 60;
/** The live chart's time axis grows in steps of this many seconds. */
export const LIVE_AXIS_STEP_SECONDS = 30;

/**
 * The end of the live chart's time axis at `tick`: a minimum window, then
 * growing with the playback position in whole steps. It does not depend on
 * when the battle ends.
 */
export function liveAxisMaxTick(tick: number, ticksPerSecond: number): number {
  const step = LIVE_AXIS_STEP_SECONDS * ticksPerSecond;
  const min = LIVE_AXIS_MIN_SECONDS * ticksPerSecond;
  return Math.max(min, Math.ceil(Math.max(0, tick) / step) * step);
}

/**
 * Chart markers for moments at the given ticks (in order), numbered from 1
 * like the list below the chart. Moments at the same tick share one marker
 * labelled with the range, e.g. "2–3".
 */
export function mergeMarkers(
  ticks: readonly number[],
): readonly { x: number; label: string }[] {
  const out: { x: number; label: string }[] = [];
  let i = 0;
  while (i < ticks.length) {
    let j = i;
    while (j + 1 < ticks.length && ticks[j + 1] === ticks[i]) j += 1;
    out.push({
      x: ticks[i] ?? 0,
      label: j === i ? String(i + 1) : `${String(i + 1)}–${String(j + 1)}`,
    });
    i = j + 1;
  }
  return out;
}

/** One line of "Where you were breached". */
export interface BreachEntry {
  readonly tick: number;
  readonly text: string;
}

/**
 * Everything of `side` that opened it up, in time order: all destroyed
 * walls, gates and turrets (grouped by kind, with the time span), plus the
 * destroyed junctions, producers and the Core from `moments`.
 */
export function breachEntries(
  record: BattleRecord,
  content: WebContent,
  moments: readonly Moment[],
  side: Side,
  ticksPerSecond: number,
): readonly BreachEntry[] {
  const refs = buildingIndex(record, content)[side];
  const groups = new Map<string, { name: string; ticks: number[] }>();
  for (const e of record.eventLog) {
    if (e.type !== 'building_destroyed' || e.side !== side) continue;
    const ref = refs.get(e.building);
    if (ref === undefined || !(isWallLike(ref.def) || isTurret(ref.def))) {
      continue;
    }
    let g = groups.get(ref.def.id);
    if (g === undefined) {
      g = { name: buildingName(content, ref.def).toLowerCase(), ticks: [] };
      groups.set(ref.def.id, g);
    }
    g.ticks.push(e.tick + 1);
  }
  const out: BreachEntry[] = [];
  for (const g of groups.values()) {
    const first = g.ticks[0] ?? 0;
    const last = g.ticks[g.ticks.length - 1] ?? first;
    const at =
      clock(first, ticksPerSecond) +
      (clock(last, ticksPerSecond) === clock(first, ticksPerSecond)
        ? ''
        : `–${clock(last, ticksPerSecond)}`);
    const n = g.ticks.length;
    out.push({
      tick: first,
      text: `${String(n)} ${g.name}${n > 1 ? 's' : ''} at ${at}`,
    });
  }
  for (const m of moments) {
    if (
      m.side === side &&
      (m.kind === 'junction' ||
        m.kind === 'production' ||
        m.kind === 'core_destroyed')
    ) {
      out.push({
        tick: m.tick,
        text: `${m.text} at ${clock(m.tick, ticksPerSecond)}`,
      });
    }
  }
  return out.sort((a, b) => a.tick - b.tick);
}

/**
 * The content's name for the walls of a board, plural ("Walls"): the wall
 * building's presentation name, or its ID if it has none.
 */
export function wallsWord(content: WebContent): string {
  const def = content.buildings
    .list()
    .find((d) => d.kind === 'defense' && d.defenseType === 'wall');
  const name = def === undefined ? 'wall' : buildingName(content, def);
  return /s$/i.test(name) ? name : `${name}s`;
}

/** The content's name for the Core. */
export function coreNameOf(content: WebContent): string {
  const def = content.buildings.list().find((d) => d.kind === 'core');
  return (def && content.presentation.get(def.id)?.name) ?? 'Core';
}

/** `m:ss` for a tick count. */
export function clock(ticks: number, ticksPerSecond: number): string {
  const s = Math.floor(ticks / ticksPerSecond);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}
