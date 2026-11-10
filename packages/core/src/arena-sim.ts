/**
 * Two-board battle simulation with units (W1-5, CB-13..CB-20, CB-30).
 * One tick (`stepArena`): flow on both boards, production, decisions,
 * simultaneous attacks, moves, deaths and destruction, cooldowns. The state
 * (`ArenaSim`) is plain JSON; everything derived from it (the grid, wiring,
 * cached fields) lives in an `ArenaContext`. See docs/rules-reference.md,
 * "One battle tick".
 */

import {
  createArena,
  removeFromArena,
  type Arena,
  type ArenaBuilding,
  type ArenaContent,
} from './arena.js';
import {
  NEIGHBORS,
  TARGETINGS,
  breachStep,
  computeBreach,
  computeField,
  fieldStep,
  openFor,
  tieKey,
  type Field,
} from './arena-paths.js';
import {
  createBoardSim,
  createFlowContext,
  rebuildFlow,
  stepFlow,
  takeFromBuffer,
  type BoardSim,
  type FlowContext,
  type SimEvent,
} from './flow-sim.js';
import type { Side } from './buildings.js';
import { divFloor } from './int.js';
import type { Cell } from './map.js';
import type { ResourceId } from './resources.js';
import type { SimConfig } from './sim-config.js';
import type { TeamState } from './team-state.js';
import type { UnitDef, UnitId } from './units.js';

// ---------------------------------------------------------------------------
// Events (arena coordinates)

export type UnitTarget =
  | { readonly kind: 'unit'; readonly unit: number }
  | {
      readonly kind: 'building';
      readonly side: number;
      readonly building: number;
    }
  | { readonly kind: 'core'; readonly side: number };

/**
 * The flow events of each board, tagged with the board's `side`. The
 * `delivered` event's own input side is called `input` here (its `side` is
 * the board's).
 */
export type FlowArenaEvent =
  | {
      readonly tick: number;
      readonly type: 'produced';
      readonly side: number;
      readonly building: number;
      readonly resource: ResourceId;
    }
  | {
      readonly tick: number;
      readonly type: 'delivered';
      readonly side: number;
      readonly building: number;
      readonly input: Side;
      readonly resource: ResourceId;
    }
  | {
      readonly tick: number;
      readonly type: 'lost';
      readonly side: number;
      readonly building: number;
      readonly resource: ResourceId;
    }
  | {
      readonly tick: number;
      readonly type: 'stalled';
      readonly side: number;
      readonly building: number;
    };

export type ArenaEvent =
  | FlowArenaEvent
  | {
      readonly tick: number;
      readonly type: 'unit_spawned';
      readonly unit: number;
      readonly side: number;
      readonly def: UnitId;
      readonly x: number;
      readonly y: number;
      readonly building: number;
    }
  | {
      readonly tick: number;
      readonly type: 'unit_moved';
      readonly unit: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly tick: number;
      readonly type: 'unit_attacked';
      readonly unit: number;
      readonly target: UnitTarget;
      readonly damage: number;
    }
  | {
      readonly tick: number;
      readonly type: 'turret_fired';
      readonly side: number;
      readonly building: number;
      readonly unit: number;
      readonly damage: number;
    }
  | { readonly tick: number; readonly type: 'unit_died'; readonly unit: number }
  | {
      readonly tick: number;
      readonly type: 'building_destroyed';
      readonly side: number;
      readonly building: number;
    }
  | {
      readonly tick: number;
      readonly type: 'conduit_destroyed';
      readonly side: number;
      readonly conduit: number;
    }
  | {
      readonly tick: number;
      readonly type: 'core_destroyed';
      readonly side: number;
    };

// ---------------------------------------------------------------------------
// State (plain JSON, mutated in place by stepArena)

export interface UnitSim {
  readonly id: number;
  readonly side: number;
  readonly def: UnitId;
  /** Arena coordinates. */
  x: number;
  y: number;
  hp: number;
  moveCooldown: number;
  attackCooldown: number;
}

export interface HealthSim {
  readonly side: number;
  /** Instance ID, or 0 for the side's Core. */
  readonly building: number;
  /** 0 once destroyed. */
  hp: number;
}

export interface TurretSim {
  readonly side: number;
  readonly building: number;
  /** Resource units collected towards the next shot (0 .. costPerShot). */
  charge: number;
  /** Ticks until the turret may fire again. */
  cooldown: number;
}

export interface ProducerSim {
  readonly side: number;
  readonly building: number;
  /** Resource units collected towards the next unit. */
  progress: number;
}

export interface ArenaSim {
  /** Battle ticks completed; equals each board's tick. */
  tick: number;
  /** The ID the next spawned unit gets (one counter for both sides). */
  nextUnitId: number;
  gapRows: number;
  /** Blocked gap cells (arena coordinates), sorted by `(y, x)`. */
  readonly gapBlocked: Cell[];
  /** Each side's team state with destroyed buildings and conduits removed. */
  readonly teams: [TeamState, TeamState];
  readonly boards: [BoardSim, BoardSim];
  /** Every building and Core ever placed, by (side, id); Core first. */
  readonly health: HealthSim[];
  /** Living unit producers, by (side, building). */
  producers: ProducerSim[];
  /** Living turrets, by (side, building). */
  turrets: TurretSim[];
  /** Living units, sorted by `id`. */
  units: UnitSim[];
  /** Units spawned, by side. */
  readonly spawned: [number, number];
  /** Units that died, by side. */
  readonly unitsDied: [number, number];
}

export interface ArenaOptions {
  /** Blocked cells inside the gap rows (arena coordinates). */
  readonly gapBlocked?: readonly Cell[];
}

// ---------------------------------------------------------------------------
// Unit stats seam (W1-7)

/**
 * The stats a unit of `side` and type `def` fights with. Every read of unit
 * health, damage, range and cooldowns goes through here, so W1-7 can apply a
 * per-side modifier in one place.
 */
export function unitStats(_side: number, def: UnitDef): UnitDef {
  return def;
}

// ---------------------------------------------------------------------------
// Context (derived, not part of the state)

interface ProducerInfo {
  readonly ref: number;
  readonly unit: UnitId;
  readonly cost: number;
}

interface TurretInfo {
  readonly ref: number;
  readonly damage: number;
  readonly rangeCells: number;
  readonly cooldownTicks: number;
  readonly costPerShot: number;
}

export interface ArenaContext {
  readonly content: ArenaContent;
  readonly simConfig: SimConfig;
  readonly arena: Arena;
  /** Per side; replaced when a building is destroyed. */
  readonly flows: FlowContext[];
  /** Events are appended here when present. */
  readonly events?: ArenaEvent[];
  /** `ref` -> index into `sim.health`. */
  readonly healthIndex: Int32Array;
  readonly producers: Map<number, ProducerInfo>;
  readonly turrets: Map<number, TurretInfo>;
  readonly flowEvents: SimEvent[][];
  /** Lazily computed, dropped whenever a building is destroyed. */
  fields: (Field | undefined)[];
  breach: (Int32Array | undefined)[];
  // Scratch buffers reused across ticks.
  heads: Int32Array[];
  next: Int32Array;
  action: Uint8Array;
  arg: Int32Array;
  unitDamage: Int32Array;
  buildingDamage: Int32Array;
}

const bkey = (side: number, id: number): number => id * 2 + side;

/** The arena of a state: destroyed Cores are taken out again. */
export function arenaOf(sim: ArenaSim, content: ArenaContent): Arena {
  const arena = createArena(
    sim.teams[0],
    sim.teams[1],
    sim.gapRows,
    content,
    sim.gapBlocked,
  );
  for (const h of sim.health) {
    if (h.hp > 0) continue;
    const ref = arena.byId[h.side]?.get(h.building);
    const core = arena.coreRef[h.side] ?? -1;
    const r = h.building === 0 ? core : ref;
    if (r !== undefined && r >= 0) removeFromArena(arena, r);
  }
  return arena;
}

/** Derive the context for a state (new or restored). */
export function createArenaContext(
  sim: ArenaSim,
  content: ArenaContent,
  simConfig: SimConfig,
  options: { events?: ArenaEvent[] } = {},
): ArenaContext {
  const arena = arenaOf(sim, content);
  const healthAt = new Map<number, number>();
  sim.health.forEach((h, i) => healthAt.set(bkey(h.side, h.building), i));
  const healthIndex = new Int32Array(arena.buildings.length);
  for (const b of arena.buildings) {
    const i = healthAt.get(bkey(b.side, b.id));
    if (i === undefined) throw new Error('Arena: building without health.');
    healthIndex[b.ref] = i;
  }
  const producers = new Map<number, ProducerInfo>();
  const turrets = new Map<number, TurretInfo>();
  sim.teams.forEach((team, side) => {
    for (const p of team.buildings) {
      const def = content.buildings.get(p.def);
      const ref = arena.byId[side]?.get(p.id);
      if (def === undefined || ref === undefined) continue;
      if (def.kind === 'unit_producer') {
        const tier = def.tiers[p.tier - 1];
        if (tier === undefined) continue;
        producers.set(bkey(side, p.id), {
          ref,
          unit: def.unit,
          cost: tier.costPerUnit,
        });
      } else if (def.kind === 'defense' && def.defenseType === 'turret') {
        const tier = def.tiers[p.tier - 1];
        if (tier === undefined) continue;
        turrets.set(bkey(side, p.id), {
          ref,
          damage: tier.damage,
          rangeCells: tier.rangeCells,
          cooldownTicks: tier.cooldownTicks,
          costPerShot: tier.costPerShot,
        });
      }
    }
  });
  const cells = arena.geom.width * arena.geom.height;
  const flowEvents: SimEvent[][] = [[], []];
  const flows = sim.teams.map((team, side) =>
    flowContextFor(
      createFlowContext(team, content, simConfig).plan,
      options.events === undefined ? undefined : flowEvents[side],
    ),
  );
  const base = {
    content,
    simConfig,
    arena,
    flows,
    healthIndex,
    producers,
    turrets,
    flowEvents,
    fields: new Array<Field | undefined>(2 * TARGETINGS.length).fill(undefined),
    breach: [undefined, undefined] as (Int32Array | undefined)[],
    heads: [new Int32Array(cells), new Int32Array(cells)],
    next: new Int32Array(0),
    action: new Uint8Array(0),
    arg: new Int32Array(0),
    unitDamage: new Int32Array(0),
    buildingDamage: new Int32Array(arena.buildings.length),
  };
  return options.events === undefined
    ? base
    : { ...base, events: options.events };
}

function flowContextFor(
  plan: FlowContext['plan'],
  events: SimEvent[] | undefined,
): FlowContext {
  return events === undefined
    ? { plan, consumers: 'hold' }
    : { plan, consumers: 'hold', events };
}

/** Create the state of a battle at tick 0 (both boards cold, no units). */
export function createArenaSim(
  teamA: TeamState,
  teamB: TeamState,
  gapRows: number,
  content: ArenaContent,
  simConfig: SimConfig,
  options: ArenaOptions = {},
): ArenaSim {
  const gapBlocked = (options.gapBlocked ?? [])
    .map((c) => ({ x: c.x, y: c.y }))
    .sort((p, q) => p.y - q.y || p.x - q.x);
  const arena = createArena(teamA, teamB, gapRows, content, gapBlocked);
  const health: HealthSim[] = [];
  const teams = [teamA, teamB];
  for (const b of arena.buildings) {
    const def = content.buildings.get(b.def);
    const placed = teams[b.side]?.buildings.find((p) => p.id === b.id);
    const tier = b.kind === 'core' ? 0 : (placed?.tier ?? 1) - 1;
    const hp = def?.tiers[tier]?.health ?? 0;
    health.push({ side: b.side, building: b.id, hp });
  }
  const producers: ProducerSim[] = [];
  for (const b of arena.buildings) {
    if (b.kind === 'unit_producer') {
      producers.push({ side: b.side, building: b.id, progress: 0 });
    }
  }
  const turrets: TurretSim[] = [];
  for (const b of arena.buildings) {
    if (b.defenseType === 'turret') {
      turrets.push({ side: b.side, building: b.id, charge: 0, cooldown: 0 });
    }
  }
  return {
    tick: 0,
    nextUnitId: 1,
    gapRows,
    gapBlocked,
    teams: [teamA, teamB],
    boards: [
      createBoardSim(teamA, content, simConfig),
      createBoardSim(teamB, content, simConfig),
    ],
    health,
    producers,
    turrets,
    units: [],
    spawned: [0, 0],
    unitsDied: [0, 0],
  };
}

// ---------------------------------------------------------------------------
// Fields

function hpOf(sim: ArenaSim, ctx: ArenaContext, ref: number): number {
  return sim.health[ctx.healthIndex[ref] ?? 0]?.hp ?? 0;
}

function fieldFor(
  ctx: ArenaContext,
  side: number,
  targeting: UnitDef['targeting'],
): Field {
  const idx = side * TARGETINGS.length + TARGETINGS.indexOf(targeting);
  let f = ctx.fields[idx];
  if (f === undefined) {
    f = computeField(ctx.arena, side, targeting);
    ctx.fields[idx] = f;
  }
  return f;
}

function breachFor(sim: ArenaSim, ctx: ArenaContext, side: number): Int32Array {
  let f = ctx.breach[side];
  if (f === undefined) {
    f = computeBreach(
      ctx.arena,
      side,
      (ref) => hpOf(sim, ctx, ref),
      ctx.simConfig.breachBaseCost,
      ctx.simConfig.breachHealthPerCost,
    );
    ctx.breach[side] = f;
  }
  return f;
}

function defOf(ctx: ArenaContext, unit: UnitSim): UnitDef {
  const def = ctx.content.units.get(unit.def);
  if (def === undefined) throw new Error(`Unknown unit "${unit.def}".`);
  return def;
}

// ---------------------------------------------------------------------------
// Spawning

function spawnCell(
  sim: ArenaSim,
  ctx: ArenaContext,
  side: number,
  producer: ArenaBuilding,
  unitDef: UnitDef,
): number {
  const arena = ctx.arena;
  const { width, height } = arena.geom;
  const field = fieldFor(ctx, side, unitDef.targeting);
  let best = -1;
  let bestClass = 3;
  let bestDist = 0;
  let bestTie = 0;
  for (const c of producer.cells) {
    for (const [dx, dy] of NEIGHBORS) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const k = y * width + x;
      if (!openFor(arena, side, k)) continue;
      let cls = 0;
      let d = field.dist[k] ?? -1;
      if (d < 0) {
        cls = 1;
        d = breachFor(sim, ctx, side)[k] ?? -1;
        if (d < 0) {
          cls = 2;
          d = 0;
        }
      }
      const tie = tieKey(arena, side, x, y);
      if (
        best < 0 ||
        cls < bestClass ||
        (cls === bestClass &&
          (d < bestDist || (d === bestDist && tie < bestTie)))
      ) {
        best = k;
        bestClass = cls;
        bestDist = d;
        bestTie = tie;
      }
    }
  }
  return best;
}

function produce(sim: ArenaSim, ctx: ArenaContext, tick: number): void {
  for (const p of sim.producers) {
    const info = ctx.producers.get(bkey(p.side, p.building));
    const board = sim.boards[p.side === 0 ? 0 : 1];
    if (info === undefined) continue;
    const consumer = board.consumers.find((c) => c.building === p.building);
    if (consumer !== undefined) {
      for (const input of consumer.inputs) {
        const n = input.count;
        if (n > 0 && takeFromBuffer(board, p.building, input.side, n)) {
          p.progress += n;
        }
      }
    }
    if (p.progress < info.cost) continue;
    const unitDef = ctx.content.units.get(info.unit);
    if (unitDef === undefined) throw new Error(`Unknown unit "${info.unit}".`);
    const producer = ctx.arena.buildings[info.ref];
    if (producer === undefined) continue;
    const k = spawnCell(sim, ctx, p.side, producer, unitDef);
    if (k < 0) continue; // no free cell: the spawn waits, progress is kept
    p.progress -= info.cost;
    const { width } = ctx.arena.geom;
    const x = k % width;
    const y = divFloor(k, width);
    const stats = unitStats(p.side, unitDef);
    const unit: UnitSim = {
      id: sim.nextUnitId,
      side: p.side,
      def: unitDef.id,
      x,
      y,
      hp: stats.health,
      moveCooldown: stats.moveCooldownTicks,
      attackCooldown: 0,
    };
    sim.nextUnitId += 1;
    sim.units.push(unit);
    sim.spawned[p.side === 0 ? 0 : 1] += 1;
    ctx.events?.push({
      tick,
      type: 'unit_spawned',
      unit: unit.id,
      side: p.side,
      def: unit.def,
      x,
      y,
      building: p.building,
    });
  }
}

/**
 * Turret charging (step 2, after the unit producers): each living turret, in
 * side then building-ID order, takes from its input buffers only as many items
 * as it still needs to reach `costPerShot`.
 */
function chargeTurrets(sim: ArenaSim, ctx: ArenaContext): void {
  for (const t of sim.turrets) {
    const info = ctx.turrets.get(bkey(t.side, t.building));
    if (info === undefined || t.charge >= info.costPerShot) continue;
    const board = sim.boards[t.side === 0 ? 0 : 1];
    const consumer = board.consumers.find((c) => c.building === t.building);
    if (consumer === undefined) continue;
    for (const input of consumer.inputs) {
      const take = Math.min(input.count, info.costPerShot - t.charge);
      if (take > 0 && takeFromBuffer(board, t.building, input.side, take)) {
        t.charge += take;
      }
    }
  }
}

/**
 * Turret fire (end of step 3). Each ready turret (cooldown 0, fully charged),
 * side 0 first then by building ID, shoots the nearest enemy unit that is
 * within range and standing inside the arena rows of the turret owner's own
 * board; ties by lowest unit ID. Damage joins the pending damage.
 */
function fireTurrets(sim: ArenaSim, ctx: ArenaContext, tick: number): void {
  const geom = ctx.arena.geom;
  const units = sim.units;
  for (const t of sim.turrets) {
    if (t.cooldown > 0) continue;
    const info = ctx.turrets.get(bkey(t.side, t.building));
    if (info === undefined || t.charge < info.costPerShot) continue;
    const turret = ctx.arena.buildings[info.ref];
    if (turret === undefined) continue;
    const rowLo = t.side === 0 ? 0 : geom.height - geom.boardHeight;
    const rowHi = rowLo + geom.boardHeight - 1;
    let best = -1;
    let bestD = info.rangeCells + 1;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined || u.side === t.side) continue;
      if (u.y < rowLo || u.y > rowHi) continue;
      let d = bestD;
      for (const c of turret.cells) {
        d = Math.min(d, Math.abs(c.x - u.x) + Math.abs(c.y - u.y));
      }
      if (d < bestD) {
        best = i;
        bestD = d; // units are in ID order, so a tie keeps the lower ID
      }
    }
    const target = units[best];
    if (target === undefined) continue;
    t.charge = 0;
    t.cooldown = info.cooldownTicks;
    ctx.unitDamage[best] = (ctx.unitDamage[best] ?? 0) + info.damage;
    ctx.events?.push({
      tick,
      type: 'turret_fired',
      side: t.side,
      building: t.building,
      unit: target.id,
      damage: info.damage,
    });
  }
}

/**
 * Put a unit on an open cell, as if spawned (tests and scenarios). Throws if
 * the cell is blocked or covered by a building that blocks the unit's side
 * (a gate of its own side does not). Emits no event.
 */
export function spawnUnitForTest(
  sim: ArenaSim,
  ctx: ArenaContext,
  args: { side: number; def: UnitId; x: number; y: number },
): UnitSim {
  const def = ctx.content.units.get(args.def);
  if (def === undefined) throw new Error(`Unknown unit "${args.def}".`);
  const { width, height } = ctx.arena.geom;
  if (
    args.x < 0 ||
    args.y < 0 ||
    args.x >= width ||
    args.y >= height ||
    !openFor(ctx.arena, args.side, args.y * width + args.x)
  ) {
    throw new Error(
      `spawnUnitForTest: (${String(args.x)}, ${String(args.y)}) is not open.`,
    );
  }
  const stats = unitStats(args.side, def);
  const unit: UnitSim = {
    id: sim.nextUnitId,
    side: args.side,
    def: def.id,
    x: args.x,
    y: args.y,
    hp: stats.health,
    moveCooldown: stats.moveCooldownTicks,
    attackCooldown: 0,
  };
  sim.nextUnitId += 1;
  sim.units.push(unit);
  sim.spawned[args.side === 0 ? 0 : 1] += 1;
  return unit;
}

// ---------------------------------------------------------------------------
// Decisions

const ACT_NONE = 0;
const ACT_UNIT = 1;
const ACT_BUILDING = 2;
const ACT_MOVE = 3;

function growScratch(ctx: ArenaContext, n: number): void {
  if (ctx.next.length < n) {
    const size = Math.max(n, 2 * ctx.next.length, 64);
    ctx.next = new Int32Array(size);
    ctx.action = new Uint8Array(size);
    ctx.arg = new Int32Array(size);
    ctx.unitDamage = new Int32Array(size);
  }
}

/**
 * Index of the nearest enemy unit within `reach` (Chebyshev distance), or -1.
 * Nearest is by Chebyshev distance, ties by Manhattan distance, then by
 * lowest unit ID.
 */
function nearestEnemy(
  sim: ArenaSim,
  ctx: ArenaContext,
  u: UnitSim,
  reach: number,
): number {
  const { width, height } = ctx.arena.geom;
  const heads = ctx.heads[1 - u.side];
  if (heads === undefined) return -1;
  let best = -1;
  let bestC = reach + 1;
  let bestM = 0;
  let bestId = 0;
  const y0 = Math.max(0, u.y - reach);
  const y1 = Math.min(height - 1, u.y + reach);
  const x0 = Math.max(0, u.x - reach);
  const x1 = Math.min(width - 1, u.x + reach);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ax = Math.abs(x - u.x);
      const ay = Math.abs(y - u.y);
      const c = Math.max(ax, ay);
      const m = ax + ay;
      let j = heads[y * width + x] ?? -1;
      while (j !== -1) {
        const e = sim.units[j];
        if (
          e !== undefined &&
          (c < bestC ||
            (c === bestC && (m < bestM || (m === bestM && e.id < bestId))))
        ) {
          best = j;
          bestC = c;
          bestM = m;
          bestId = e.id;
        }
        j = ctx.next[j] ?? -1;
      }
    }
  }
  return best;
}

/** The goal building within `reach` of the unit (nearest; ties: Core, lowest ID). */
function goalInReach(
  ctx: ArenaContext,
  u: UnitSim,
  reach: number,
  field: Field,
): number {
  const arena = ctx.arena;
  const { width, height } = arena.geom;
  let best = -1;
  let bestD = reach + 1;
  let bestId = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    const y = u.y + dy;
    if (y < 0 || y >= height) continue;
    const span = reach - Math.abs(dy);
    const x0 = Math.max(0, u.x - span);
    const x1 = Math.min(width - 1, u.x + span);
    for (let x = x0; x <= x1; x++) {
      const ref = arena.occupant[y * width + x] ?? -1;
      if (ref < 0 || field.isGoal[ref] !== 1) continue;
      const d = Math.abs(dy) + Math.abs(x - u.x);
      const id = arena.buildings[ref]?.id ?? 0;
      if (d < bestD || (d === bestD && id < bestId)) {
        best = ref;
        bestD = d;
        bestId = id;
      }
    }
  }
  return best;
}

function decide(sim: ArenaSim, ctx: ArenaContext, i: number, u: UnitSim): void {
  const arena = ctx.arena;
  const { width } = arena.geom;
  const def = unitStats(u.side, defOf(ctx, u));
  const reach = Math.max(1, def.rangeCells);
  ctx.action[i] = ACT_NONE;

  // a. Attack the nearest enemy unit in reach.
  const j = nearestEnemy(sim, ctx, u, reach);
  if (j >= 0) {
    ctx.action[i] = ACT_UNIT;
    ctx.arg[i] = j;
    return;
  }

  // a2. Aggro (CB-16): step towards the nearest enemy unit within aggro range.
  const aggro = ctx.simConfig.aggroRangeCells;
  if (aggro > reach && u.moveCooldown === 0) {
    const a = nearestEnemy(sim, ctx, u, aggro);
    const e = a >= 0 ? sim.units[a] : undefined;
    if (e !== undefined) {
      // One step along the axis with the larger difference (y when equal),
      // else along the other axis if it differs.
      const ex = e.x - u.x;
      const ey = e.y - u.y;
      const stepX = (): number =>
        ex === 0 ? -1 : u.y * width + u.x + (ex > 0 ? 1 : -1);
      const stepY = (): number =>
        ey === 0 ? -1 : (u.y + (ey > 0 ? 1 : -1)) * width + u.x;
      const order =
        Math.abs(ex) > Math.abs(ey) ? [stepX, stepY] : [stepY, stepX];
      for (const step of order) {
        const k = step();
        if (k >= 0 && openFor(arena, u.side, k)) {
          ctx.action[i] = ACT_MOVE;
          ctx.arg[i] = k;
          return;
        }
      }
    }
  }

  const here = u.y * width + u.x;
  const field = fieldFor(ctx, u.side, def.targeting);
  const d = field.dist[here] ?? -1;
  if (d >= 0) {
    // b. Attack the goal building in reach.
    const ref = goalInReach(ctx, u, reach, field);
    if (ref >= 0) {
      ctx.action[i] = ACT_BUILDING;
      ctx.arg[i] = ref;
      return;
    }
    // c. Move one step along the field.
    if (u.moveCooldown === 0 && d > 0) {
      const k = fieldStep(arena, u.side, field, here);
      if (k >= 0) {
        ctx.action[i] = ACT_MOVE;
        ctx.arg[i] = k;
      }
    }
    return;
  }

  // No route in the normal field: breach (CB-20).
  const bd = breachFor(sim, ctx, u.side);
  const here0 = bd[here] ?? -1;
  if (here0 < 0) return; // wait
  if (here0 === 0) {
    const core = arena.coreRef[1 - u.side] ?? -1;
    if (core >= 0 && arena.buildings[core]?.alive === true) {
      ctx.action[i] = ACT_BUILDING;
      ctx.arg[i] = core;
    }
    return;
  }
  const base = ctx.simConfig.breachBaseCost;
  const per = ctx.simConfig.breachHealthPerCost;
  const k = breachStep(
    arena,
    u.side,
    bd,
    here,
    (r) => hpOf(sim, ctx, r),
    base,
    per,
  );
  if (k < 0) return;
  const occ = arena.occupant[k] ?? -1;
  if (occ >= 0 && !openFor(arena, u.side, k)) {
    ctx.action[i] = ACT_BUILDING;
    ctx.arg[i] = occ;
  } else if (u.moveCooldown === 0) {
    ctx.action[i] = ACT_MOVE;
    ctx.arg[i] = k;
  }
}

// ---------------------------------------------------------------------------
// Destruction

function destroyBuilding(
  sim: ArenaSim,
  ctx: ArenaContext,
  ref: number,
  tick: number,
): void {
  const b = ctx.arena.buildings[ref];
  if (b === undefined || !b.alive) return;
  removeFromArena(ctx.arena, ref);
  if (b.kind === 'core') {
    ctx.events?.push({ tick, type: 'core_destroyed', side: b.side });
    return;
  }
  ctx.events?.push({
    tick,
    type: 'building_destroyed',
    side: b.side,
    building: b.id,
  });
  const team = sim.teams[b.side === 0 ? 0 : 1];
  const attached = team.conduits.filter(
    (c) => c.from.building === b.id || c.to.building === b.id,
  );
  for (const c of attached) {
    ctx.events?.push({
      tick,
      type: 'conduit_destroyed',
      side: b.side,
      conduit: c.id,
    });
  }
  const newTeam: TeamState = {
    ...team,
    buildings: team.buildings.filter((p) => p.id !== b.id),
    conduits: team.conduits.filter(
      (c) => c.from.building !== b.id && c.to.building !== b.id,
    ),
  };
  sim.teams[b.side === 0 ? 0 : 1] = newTeam;
  sim.producers = sim.producers.filter(
    (p) => !(p.side === b.side && p.building === b.id),
  );
  sim.turrets = sim.turrets.filter(
    (t) => !(t.side === b.side && t.building === b.id),
  );
  const { sim: board, plan } = rebuildFlow(
    sim.boards[b.side === 0 ? 0 : 1],
    newTeam,
    ctx.content,
    ctx.simConfig,
  );
  sim.boards[b.side === 0 ? 0 : 1] = board;
  ctx.flows[b.side] = flowContextFor(
    plan,
    ctx.events === undefined ? undefined : ctx.flowEvents[b.side],
  );
}

// ---------------------------------------------------------------------------
// The step

/**
 * Advance the battle by one tick, in place. Order: (1) flow on both boards;
 * (2) production and turret charging; (3) decisions from a snapshot, then
 * turret fire; (4) simultaneous attacks;
 * (5) moves; (6) deaths and destruction; (7) cooldowns and the tick counter.
 */
export function stepArena(sim: ArenaSim, ctx: ArenaContext): void {
  const tick = sim.tick;
  const events = ctx.events;
  const arena = ctx.arena;
  const { width } = arena.geom;

  // 1. Flow.
  for (const side of [0, 1] as const) {
    const buf = ctx.flowEvents[side];
    if (buf !== undefined) buf.length = 0;
    const flow = ctx.flows[side];
    if (flow === undefined) throw new Error('Arena: missing flow context.');
    stepFlow(sim.boards[side], flow);
    if (events !== undefined && buf !== undefined) {
      for (const e of buf) {
        if (e.type === 'delivered') {
          events.push({
            tick: e.tick,
            type: 'delivered',
            side,
            building: e.building,
            input: e.side,
            resource: e.resource,
          });
        } else events.push({ ...e, side });
      }
    }
  }

  // 2. Production (unit producers, then turret charging).
  produce(sim, ctx, tick);
  chargeTurrets(sim, ctx);

  // 3. Decide, from a snapshot.
  const units = sim.units;
  const n = units.length;
  growScratch(ctx, n);
  ctx.heads[0]?.fill(-1);
  ctx.heads[1]?.fill(-1);
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u === undefined) continue;
    const heads = ctx.heads[u.side];
    if (heads === undefined) continue;
    const k = u.y * width + u.x;
    ctx.next[i] = heads[k] ?? -1;
    heads[k] = i;
  }
  ctx.unitDamage.fill(0, 0, n);
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u !== undefined) decide(sim, ctx, i, u);
  }
  fireTurrets(sim, ctx, tick);

  // 4. Resolve attacks simultaneously.
  ctx.buildingDamage.fill(0);
  for (let i = 0; i < n; i++) {
    const u = units[i];
    const act = ctx.action[i] ?? ACT_NONE;
    if (u === undefined || (act !== ACT_UNIT && act !== ACT_BUILDING)) continue;
    if (u.attackCooldown > 0) continue; // holds position
    const stats = unitStats(u.side, defOf(ctx, u));
    const arg = ctx.arg[i] ?? 0;
    let target: UnitTarget;
    if (act === ACT_UNIT) {
      const t = units[arg];
      if (t === undefined) continue;
      ctx.unitDamage[arg] = (ctx.unitDamage[arg] ?? 0) + stats.damage;
      target = { kind: 'unit', unit: t.id };
    } else {
      const b = arena.buildings[arg];
      if (b === undefined) continue;
      ctx.buildingDamage[arg] = (ctx.buildingDamage[arg] ?? 0) + stats.damage;
      target =
        b.kind === 'core'
          ? { kind: 'core', side: b.side }
          : { kind: 'building', side: b.side, building: b.id };
    }
    u.attackCooldown = stats.attackCooldownTicks;
    events?.push({
      tick,
      type: 'unit_attacked',
      unit: u.id,
      target,
      damage: stats.damage,
    });
  }
  for (let i = 0; i < n; i++) {
    const dmg = ctx.unitDamage[i] ?? 0;
    const u = units[i];
    if (dmg > 0 && u !== undefined) u.hp -= dmg;
  }
  for (let r = 0; r < ctx.buildingDamage.length; r++) {
    const dmg = ctx.buildingDamage[r] ?? 0;
    if (dmg === 0) continue;
    const h = sim.health[ctx.healthIndex[r] ?? 0];
    if (h !== undefined) h.hp = Math.max(0, h.hp - dmg);
  }

  // 5. Resolve moves.
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u === undefined || ctx.action[i] !== ACT_MOVE) continue;
    const k = ctx.arg[i] ?? 0;
    u.x = k % width;
    u.y = divFloor(k, width);
    u.moveCooldown = unitStats(u.side, defOf(ctx, u)).moveCooldownTicks;
    events?.push({ tick, type: 'unit_moved', unit: u.id, x: u.x, y: u.y });
  }

  // 6. Deaths and destruction.
  let died = false;
  for (const u of units) {
    if (u.hp <= 0) {
      died = true;
      events?.push({ tick, type: 'unit_died', unit: u.id });
      sim.unitsDied[u.side === 0 ? 0 : 1] += 1;
    }
  }
  if (died) sim.units = units.filter((u) => u.hp > 0);
  let destroyed = false;
  for (const h of sim.health) {
    if (h.hp > 0) continue;
    const ref =
      h.building === 0
        ? (arena.coreRef[h.side] ?? -1)
        : (arena.byId[h.side]?.get(h.building) ?? -1);
    const b = ref >= 0 ? arena.buildings[ref] : undefined;
    if (b === undefined || !b.alive) continue;
    destroyBuilding(sim, ctx, ref, tick);
    destroyed = true;
  }
  if (destroyed) {
    ctx.fields.fill(undefined);
    ctx.breach.fill(undefined);
  }

  // 7. Cooldowns, then the tick counter.
  for (const t of sim.turrets) {
    if (t.cooldown > 0) t.cooldown -= 1;
  }
  for (const u of sim.units) {
    if (u.moveCooldown > 0) u.moveCooldown -= 1;
    if (u.attackCooldown > 0) u.attackCooldown -= 1;
  }
  sim.tick += 1;
}

/**
 * Run `ticks` ticks and return the events they produced. Events are only
 * recorded when the context was created with an `events` list.
 */
export function runArena(
  sim: ArenaSim,
  ctx: ArenaContext,
  ticks: number,
): ArenaEvent[] {
  const start = ctx.events?.length ?? 0;
  for (let t = 0; t < ticks; t++) stepArena(sim, ctx);
  return ctx.events === undefined ? [] : ctx.events.slice(start);
}

/** A state and a context with an event list: the usual way to start a battle. */
export function startBattle(
  teamA: TeamState,
  teamB: TeamState,
  gapRows: number,
  content: ArenaContent,
  simConfig: SimConfig,
  options: ArenaOptions = {},
): { sim: ArenaSim; ctx: ArenaContext; events: ArenaEvent[] } {
  const sim = createArenaSim(
    teamA,
    teamB,
    gapRows,
    content,
    simConfig,
    options,
  );
  const events: ArenaEvent[] = [];
  const ctx = createArenaContext(sim, content, simConfig, { events });
  return { sim, ctx, events };
}
