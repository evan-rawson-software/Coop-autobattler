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
  breachStep,
  computeBreach,
  computeField,
  fieldStep,
  openFor,
  tieKey,
  type Field,
} from './arena-paths.js';
import {
  CELL_UNITS,
  boxDist2,
  buildSolid,
  buildingDist2,
  cellCoord,
  fillSolid,
  ownCellCoord,
  fits,
  type World,
} from './geometry.js';
import { MotionScratch } from './unit-motion.js';
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
import type { EconomyEffectType, Side } from './buildings.js';
import {
  addInt,
  addSaturating,
  divCeil,
  divFloor,
  modFloor,
  mulInt,
  mulPct,
} from './int.js';
import {
  assertWithin,
  MAX_DAMAGE,
  MAX_HEALTH,
  MAX_HIT,
  MAX_TICK_DAMAGE,
} from './limits.js';
import { maxHealthOf } from './max-health.js';
import { modifierPercent } from './modifiers.js';
import { cappedBonus, isOverloadBeat, overloadLevel } from './ramp.js';
import type { Cell } from './map.js';
import type { NeutralZone } from './neutral-zone.js';
import type { ResourceId } from './resources.js';
import type { SimConfig } from './sim-config.js';
import { conduitsLostWith } from './conduits.js';
import type { TeamState } from './team-state.js';
import { unitSpeed, type UnitDef, type UnitId } from './units.js';

// ---------------------------------------------------------------------------
// Events (arena coordinates)

export type UnitTarget =
  | { readonly kind: 'unit'; readonly unit: number }
  | {
      readonly kind: 'building';
      readonly side: number;
      readonly building: number;
    }
  | { readonly kind: 'core'; readonly side: number; readonly core: number };

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
      /** The centre of the unit, in sub-cell units (`CELL_UNITS` per cell). */
      readonly px: number;
      readonly py: number;
      readonly building: number;
      /** The producing building's owner; for a wave unit, the plot it enters on (PP-11). */
      readonly owner: number;
      /** The player index of the enemy Core it heads for, or -1 (PP-11). */
      readonly target: number;
    }
  | {
      readonly tick: number;
      readonly type: 'unit_retargeted';
      readonly unit: number;
      /** The new target: a player index of the enemy side, or -1. */
      readonly target: number;
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
      readonly core: number;
    }
  | {
      readonly tick: number;
      readonly type: 'ramp_step';
      readonly side: number;
      readonly building: number;
      readonly effect: EconomyEffectType;
      readonly steps: number;
    }
  | { readonly tick: number; readonly type: 'overload_started' }
  | {
      readonly tick: number;
      readonly type: 'overload_level';
      readonly level: number;
    }
  | {
      readonly tick: number;
      readonly type: 'overload_core_damage';
      readonly side: number;
      readonly core: number;
      readonly damage: number;
    }
  | {
      readonly tick: number;
      readonly type: 'zone_revealed';
      readonly zone: NeutralZone;
    }
  | {
      readonly tick: number;
      readonly type: 'battle_ended';
      readonly winner: number;
      readonly reason: string;
    };

// ---------------------------------------------------------------------------
// State (plain JSON, mutated in place by stepArena)

export interface UnitSim {
  readonly id: number;
  readonly side: number;
  readonly def: UnitId;
  /** The centre of the unit's circle, arena sub-cell units (`CELL_UNITS` per cell). */
  px: number;
  py: number;
  hp: number;
  /** Attack damage fixed at spawn (base damage with the side's strength bonus). */
  damage: number;
  attackCooldown: number;
  /** A player index of the unit's own side: whose plot it belongs to (PP-11). */
  readonly owner: number;
  /**
   * The player index of the enemy Core it heads for, or -1 when none stands.
   * Changes only when that Core is destroyed (PP-11).
   */
  target: number;
}

/** A player's Core in the `health` list (PP-9). */
export interface CoreHealthSim {
  readonly side: number;
  /** The player index. */
  readonly core: number;
  /** 0 once destroyed. */
  hp: number;
}

/** A placed building in the `health` list. */
export interface BuildingHealthSim {
  readonly side: number;
  /** Instance ID. */
  readonly building: number;
  /** 0 once destroyed. */
  hp: number;
}

export type HealthSim = CoreHealthSim | BuildingHealthSim;

/** True for the entry of a Core. */
export function isCoreHealth(h: HealthSim): h is CoreHealthSim {
  return 'core' in h;
}

export interface TurretSim {
  readonly side: number;
  readonly building: number;
  /** Resource units collected towards the next shot (0 .. costPerShot). */
  charge: number;
  /** Ticks until the turret may fire again. */
  cooldown: number;
}

export interface RampSim {
  readonly side: number;
  readonly building: number;
  /** Resource units collected towards the next step (0 .. costPerStep - 1). */
  charge: number;
  /** Steps taken so far (0 .. maxSteps). */
  steps: number;
  /** Ticks until the next step is allowed (PP-6). */
  cooldown: number;
}

export interface ProducerSim {
  readonly side: number;
  readonly building: number;
  /** Resource units collected towards the next unit (0 .. costPerUnit). */
  progress: number;
  /** Ticks until the next unit may be made (PP-6). */
  cooldown: number;
}

/**
 * A scheduled-wave unit that has not found room yet (see
 * `SideOptions.scheduledWaves`): the unit type and the own-frame column it
 * wants on the side's front row.
 */
export interface EnteringSim {
  readonly side: number;
  readonly unit: UnitId;
  readonly col: number;
}

/** One scheduled wave of a side (see `SideOptions.scheduledWaves`). */
export interface ScheduledWave {
  /** The tick on which the units spawn (in the Production step). */
  readonly tick: number;
  readonly unit: UnitId;
  readonly count: number;
}

/**
 * General per-side options of the arena simulation (PvE threats use them; a
 * ghost battle has none). Every field is optional.
 */
export interface SideOptions {
  /**
   * Units that arrive at the front row of the side's board at fixed ticks, in
   * the Production step, whatever buildings the side has.
   */
  readonly scheduledWaves?: readonly ScheduledWave[];
  /** The side's turrets are always fully charged (no flow needed). */
  readonly freePower?: boolean;
  /**
   * Strength percent applied to every unit the side spawns, added to the
   * side's `unit_strength` ramp bonus.
   */
  readonly unitStrengthPercent?: number;
  /**
   * Starting and maximum health of each Core by player index (before
   * `core_health_percent`), instead of the definition's; a player without an
   * entry has the definition's (PP-9).
   */
  readonly coreHealths?: readonly number[];
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
  /** Every Core and building ever placed: per side the Cores by player, then buildings by ID. */
  readonly health: HealthSim[];
  /** Living unit producers, by (side, building). */
  producers: ProducerSim[];
  /** Living turrets, by (side, building). */
  turrets: TurretSim[];
  /** Living economy (in-battle ramp) buildings, by (side, building). */
  ramps: RampSim[];
  /** Living units, sorted by `id`. */
  units: UnitSim[];
  /** Scheduled-wave units waiting for room, in queue order. */
  entering: EnteringSim[];
  /** Units spawned, by side. */
  readonly spawned: [number, number];
  /** Units that died, by side. */
  readonly unitsDied: [number, number];
  /**
   * Building damage dealt, by the side that dealt it (index = the attacker):
   * the total damage that side's units have applied to the enemy's buildings,
   * Core included, over the battle. Per building and tick it counts
   * `min(attack damage that tick, the building's health before the tick)`:
   * Overload Core decay and damage beyond the building's remaining health
   * (overkill) are not counted. A tiebreak input (CB-33); at most
   * `MAX_ARENA_CELLS * MAX_HEALTH`, so always exact. The units a side has
   * killed are `unitsDied` of the other side.
   */
  readonly buildingDamageDealt: [number, number];
  /** Present only when a side was given options (PvE); absent otherwise. */
  readonly sideOptions?: [SideOptions, SideOptions];
}

export interface ArenaOptions {
  /** Blocked cells inside the gap rows (arena coordinates). */
  readonly gapBlocked?: readonly Cell[];
  /** Options for side 0 and side 1; `null` or missing means none. */
  readonly sideOptions?: readonly [
    SideOptions | null | undefined,
    SideOptions | null | undefined,
  ];
}

// ---------------------------------------------------------------------------
// Unit stats seam (W1-7)

/**
 * The stats a unit of `side` and type `def` fights with. Every read of unit
 * health, damage, range and cooldowns goes through here. With a
 * `strengthPercent` P above 0 (the side's capped `unit_strength` bonus at the
 * moment of spawning), health and damage become `mulPct(base, 100 + P)`
 * (rounded down); everything else is unchanged. Units keep the result they
 * were spawned with (`hp`, `damage`).
 */
export function unitStats(
  _side: number,
  def: UnitDef,
  strengthPercent = 0,
): UnitDef {
  if (strengthPercent === 0) return def;
  // Scaled stats are held to the content bound (limits.ts): a strength so
  // large that a unit would exceed it is an error, not a wrapped number.
  const scaled = (value: number, what: string, max: number): number => {
    const v = mulPct(value, addInt(100, strengthPercent));
    if (v > max) {
      throw new RangeError(
        `Unit ${def.id}: ${what} ${String(v)} (strength ${String(strengthPercent)} percent) exceeds the maximum ${String(max)}.`,
      );
    }
    return v;
  };
  return {
    ...def,
    health: scaled(def.health, 'scaled health', MAX_HEALTH),
    damage: scaled(def.damage, 'scaled damage', MAX_DAMAGE),
  };
}

// ---------------------------------------------------------------------------
// Context (derived, not part of the state)

interface ProducerInfo {
  readonly ref: number;
  readonly unit: UnitId;
  readonly cost: number;
  readonly interval: number;
  /** The building's owner: the owner of the units it makes (PP-11). */
  readonly owner: number;
}

interface TurretInfo {
  readonly ref: number;
  readonly damage: number;
  readonly rangeCells: number;
  readonly cooldownTicks: number;
  readonly costPerShot: number;
}

interface RampInfo {
  /** The player who owns the building (PP-8: only this player gains). */
  readonly owner: number;
  readonly effect: EconomyEffectType;
  readonly costPerStep: number;
  readonly stepInterval: number;
  readonly stepPercent: number;
  readonly maxSteps: number;
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
  /**
   * Per side and player index, the Core's health after all damage of the
   * latest tick that damaged it, NOT clamped at 0 (so a destroyed Core's
   * overkill is known, CB-33). Equals the Core's health while it is alive.
   * 0 for a player without a Core.
   */
  readonly coreRemaining: number[][];
  readonly producers: Map<number, ProducerInfo>;
  readonly turrets: Map<number, TurretInfo>;
  readonly ramps: Map<number, RampInfo>;
  readonly flowEvents: SimEvent[][];
  /**
   * `ref` -> the building's maximum health (`maxHealthOf`: its tier's health
   * with the team's modifiers and any Core health override). The breach
   * field is built from this, never from current health (CB-20), so the
   * cached field is a pure function of which buildings exist.
   */
  readonly maxHealth: Float64Array;
  /** The arena as the circle geometry sees it (solid cells per side). */
  readonly world: World;
  /** The same arena for flying units: nothing is solid (issue #59). */
  readonly air: World;
  /** Largest collision radius and largest body radius among the unit types. */
  readonly maxRadius: number;
  readonly maxBody: number;
  /**
   * Per side, per enemy Core (player index): lazily computed, dropped
   * whenever a building is destroyed (PP-11).
   */
  fields: (Field | undefined)[][];
  breach: (Float64Array | undefined)[][];
  /**
   * Cached `spawnCells` per (producer `ref`, target Core), key
   * `ref * SPAWN_KEY + core`; dropped with the fields.
   */
  spawnCells: Map<number, Int32Array>;
  // Scratch buffers reused across ticks (rebuilt from the state every tick).
  /** Per side, per cell: the first unit index whose centre is in the cell. */
  heads: Int32Array[];
  next: Int32Array;
  /** Per unit index: collision radius and body radius. */
  crad: Int32Array;
  brad: Int32Array;
  /** Per unit index: 1 for a flying unit, else 0. */
  fly: Uint8Array;
  motion: MotionScratch;
  /**
   * Per side, per target Core, per cell: cached `fieldStep` (-1 none, -2 not
   * computed yet); allocated with the field.
   */
  readonly steps: (Int32Array | undefined)[][];
  /**
   * Per side: summed-area table of the number of units whose centre is in a
   * cell ((width + 1) * (height + 1) entries), rebuilt every tick; lets the
   * searches skip windows without enemies.
   */
  readonly present: Int32Array[];
  presenceOn: boolean;
  /** Per side: the indices of its units (ascending), and how many. */
  readonly bySide: Int32Array[];
  readonly sideCount: [number, number];
  /** Scratch list of nearby units (x, y, radius triples) for spawn checks. */
  near: Int32Array;
  /** The part of `near` that can overlap one spawn cell. */
  nearCell: Int32Array;
  action: Uint8Array;
  arg: Int32Array;
  /** Per unit: 1 if it attacks this tick (decided before any unit moves). */
  holds: Uint8Array;
  /**
   * Damage accumulated this tick. Float64Array holding integers, summed with
   * `addDamage` (saturating at MAX_TICK_DAMAGE, each hit at most MAX_HIT, so
   * every sum is exact; never a wrap-around, which an Int32Array would do
   * past 2^31).
   */
  unitDamage: Float64Array;
  buildingDamage: Float64Array;
  /** The part of `buildingDamage` that comes from unit attacks (no decay). */
  attackDamage: Float64Array;
}

const bkey = (side: number, id: number): number => id * 2 + side;
/** Key of a Core's health entry; never equal to a `bkey` (negative). */
const ckey = (side: number, player: number): number => -1 - (player * 2 + side);

/** The arena `ref` of the building or Core a health entry belongs to, or -1. */
function refOfHealth(arena: Arena, h: HealthSim): number {
  return isCoreHealth(h)
    ? (arena.coreRef[h.side]?.[h.core] ?? -1)
    : (arena.byId[h.side]?.get(h.building) ?? -1);
}

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
    const r = refOfHealth(arena, h);
    if (r >= 0) removeFromArena(arena, r);
  }
  return arena;
}

/** Adds one hit to the damage a target takes this tick (saturating, exact). */
function addDamage(sum: number, hit: number): number {
  return addSaturating(sum, hit, MAX_TICK_DAMAGE);
}

/** A turret tier's damage with the team's `turret_damage_percent`, checked. */
function turretDamageOf(team: TeamState, damage: number): number {
  const pct = modifierPercent(team, 'turret_damage_percent');
  // Largest percent sum for which damage * (100 + pct) stays a safe integer.
  const room =
    damage === 0
      ? Number.MAX_SAFE_INTEGER
      : divFloor(Number.MAX_SAFE_INTEGER, damage);
  if (pct > room - 100) {
    throw new RangeError(
      `Modifier turret_damage_percent: the percent sum ${String(pct)} is too large for turret damage ${String(damage)}; damage times (100 + percent) must stay within ${String(Number.MAX_SAFE_INTEGER)}.`,
    );
  }
  const v = mulPct(damage, addInt(100, pct));
  if (v > MAX_DAMAGE) {
    throw new RangeError(
      `Turret damage ${String(v)} with modifiers exceeds the maximum ${String(MAX_DAMAGE)}.`,
    );
  }
  return v;
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
  sim.health.forEach((h, i) =>
    healthAt.set(
      isCoreHealth(h) ? ckey(h.side, h.core) : bkey(h.side, h.building),
      i,
    ),
  );
  const healthIndex = new Int32Array(arena.buildings.length);
  for (const b of arena.buildings) {
    const i = healthAt.get(
      b.kind === 'core' ? ckey(b.side, b.player) : bkey(b.side, b.id),
    );
    if (i === undefined) throw new Error('Arena: building without health.');
    healthIndex[b.ref] = i;
  }
  // Float64Array of integers, never Int32Array: a tier health of 2^31 or more
  // would wrap. Content health is at most MAX_HEALTH (limits.ts).
  const maxHealth = new Float64Array(arena.buildings.length);
  for (const b of arena.buildings) {
    const side = b.side === 0 ? 0 : 1;
    maxHealth[b.ref] = maxHealthOf(
      sim.teams[side],
      b,
      content,
      b.kind === 'core'
        ? sim.sideOptions?.[side].coreHealths?.[b.player]
        : undefined,
    );
  }
  const producers = new Map<number, ProducerInfo>();
  const turrets = new Map<number, TurretInfo>();
  const ramps = new Map<number, RampInfo>();
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
          interval: tier.productionIntervalTicks,
          owner: p.owner,
        });
      } else if (def.kind === 'economy') {
        const tier = def.tiers[p.tier - 1];
        if (tier === undefined) continue;
        ramps.set(bkey(side, p.id), {
          owner: p.owner,
          effect: def.effect.type,
          costPerStep: tier.costPerStep,
          stepInterval: tier.stepIntervalTicks,
          stepPercent: tier.stepPercent,
          maxSteps: tier.maxSteps,
        });
      } else if (def.kind === 'defense' && def.defenseType === 'turret') {
        const tier = def.tiers[p.tier - 1];
        if (tier === undefined) continue;
        turrets.set(bkey(side, p.id), {
          ref,
          damage: turretDamageOf(team, tier.damage),
          rangeCells: tier.rangeCells,
          cooldownTicks: tier.cooldownTicks,
          costPerShot: tier.costPerShot,
        });
      }
    }
  });
  const coreRemaining: number[][] = sim.teams.map((t) => t.cores.map(() => 0));
  for (const h of sim.health) {
    const row = coreRemaining[h.side];
    if (isCoreHealth(h) && row !== undefined) row[h.core] = h.hp;
  }
  const cells = arena.geom.width * arena.geom.height;
  const solid = buildSolid(arena);
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
    maxHealth,
    coreRemaining,
    producers,
    turrets,
    ramps,
    flowEvents,
    world: { width: arena.geom.width, height: arena.geom.height, solid },
    air: {
      width: arena.geom.width,
      height: arena.geom.height,
      solid: [new Uint8Array(cells), new Uint8Array(cells)] as const,
    },
    maxRadius: Math.max(
      1,
      ...content.units.list().map((d) => d.collisionRadius),
    ),
    maxBody: Math.max(1, ...content.units.list().map((d) => d.radius)),
    fields: [[], []] as (Field | undefined)[][],
    breach: [[], []] as (Float64Array | undefined)[][],
    spawnCells: new Map<number, Int32Array>(),
    heads: [new Int32Array(cells), new Int32Array(cells)],
    next: new Int32Array(0),
    crad: new Int32Array(0),
    brad: new Int32Array(0),
    fly: new Uint8Array(0),
    motion: new MotionScratch(),
    steps: [[], []] as (Int32Array | undefined)[][],
    present: [
      new Int32Array((arena.geom.width + 1) * (arena.geom.height + 1)),
      new Int32Array((arena.geom.width + 1) * (arena.geom.height + 1)),
    ],
    presenceOn: false,
    bySide: [new Int32Array(0), new Int32Array(0)],
    sideCount: [0, 0] as [number, number],
    near: new Int32Array(192),
    nearCell: new Int32Array(192),
    action: new Uint8Array(0),
    arg: new Int32Array(0),
    holds: new Uint8Array(0),
    unitDamage: new Float64Array(0),
    buildingDamage: new Float64Array(arena.buildings.length),
    attackDamage: new Float64Array(arena.buildings.length),
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
  const teams: [TeamState, TeamState] = [teamA, teamB];
  for (const b of arena.buildings) {
    const side = b.side === 0 ? 0 : 1;
    // The one place a building's maximum health is computed (checked against
    // the content bound); a building starts the battle at full health.
    const hp = maxHealthOf(
      teams[side],
      b,
      content,
      b.kind === 'core'
        ? options.sideOptions?.[side]?.coreHealths?.[b.player]
        : undefined,
    );
    health.push(
      b.kind === 'core'
        ? { side: b.side, core: b.player, hp }
        : { side: b.side, building: b.id, hp },
    );
  }
  // Fail at the start, not mid-battle: with the side's base strength, its
  // strength modifiers and the largest ramp bonus it can reach (none without
  // a unit_strength economy building), every unit type must stay within the
  // stat bounds.
  const maxLevel = overloadLevel(simConfig.maxBattleTicks, simConfig);
  for (const side of [0, 1] as const) {
    const base = options.sideOptions?.[side]?.unitStrengthPercent ?? 0;
    assertWithin(base, 0, Number.MAX_SAFE_INTEGER, 'unitStrengthPercent');
    const team = teams[side];
    const hasRamp = team.buildings.some((p) => {
      const def = content.buildings.get(p.def);
      return def?.kind === 'economy' && def.effect.type === 'unit_strength';
    });
    const strength = addInt(
      addInt(base, modifierPercent(team, 'unit_strength_percent')),
      hasRamp ? simConfig.maxUnitStrengthPercent : 0,
    );
    for (const def of content.units.list()) {
      const stats = unitStats(0, def, strength);
      // Overload at the last possible tick scales every hit; one hit must
      // stay within MAX_HIT so the per-tick damage sums are exact.
      const hit = mulPct(
        stats.damage,
        addInt(100, mulInt(maxLevel, simConfig.overloadDamageStepPercent)),
      );
      assertWithin(hit, 0, MAX_HIT, `Unit ${def.id}: Overload hit`);
    }
  }
  assertWithin(
    mulInt(maxLevel, simConfig.overloadCoreDamageStep),
    0,
    MAX_HIT,
    'Overload Core damage',
  );
  // Turret damage with modifiers: createArenaContext derives it by the same
  // checked function; run it now so the error comes at setup.
  for (const team of teams) {
    for (const p of team.buildings) {
      const def = content.buildings.get(p.def);
      if (def?.kind === 'defense' && def.defenseType === 'turret') {
        const tier = def.tiers[p.tier - 1];
        if (tier !== undefined) turretDamageOf(team, tier.damage);
      }
    }
  }
  const producers: ProducerSim[] = [];
  for (const b of arena.buildings) {
    if (b.kind === 'unit_producer') {
      producers.push({
        side: b.side,
        building: b.id,
        progress: 0,
        cooldown: 0,
      });
    }
  }
  const turrets: TurretSim[] = [];
  for (const b of arena.buildings) {
    if (b.defenseType === 'turret') {
      turrets.push({ side: b.side, building: b.id, charge: 0, cooldown: 0 });
    }
  }
  const ramps: RampSim[] = [];
  for (const b of arena.buildings) {
    if (b.kind === 'economy') {
      ramps.push({
        side: b.side,
        building: b.id,
        charge: 0,
        steps: 0,
        cooldown: 0,
      });
    }
  }
  const given = options.sideOptions;
  const hasOptions =
    given !== undefined && (given[0] != null || given[1] != null);
  const sideOptions: { sideOptions?: [SideOptions, SideOptions] } = hasOptions
    ? { sideOptions: [given[0] ?? {}, given[1] ?? {}] }
    : {};
  return {
    tick: 0,
    nextUnitId: 1,
    gapRows,
    gapBlocked,
    ...sideOptions,
    teams: [teamA, teamB],
    boards: [
      createBoardSim(teamA, content, simConfig),
      createBoardSim(teamB, content, simConfig),
    ],
    health,
    producers,
    turrets,
    ramps,
    units: [],
    entering: [],
    spawned: [0, 0],
    unitsDied: [0, 0],
    buildingDamageDealt: [0, 0],
  };
}

// ---------------------------------------------------------------------------
// Fields

/** The movement field of `side` towards the enemy Core of player `core`. */
function fieldFor(ctx: ArenaContext, side: number, core: number): Field {
  const row = ctx.fields[side] ?? [];
  let f = row[core];
  if (f === undefined) {
    f = computeField(ctx.arena, side, core);
    row[core] = f;
    ctx.fields[side] = row;
  }
  return f;
}

/** `fieldStep` for a cell, cached until the next destruction. */
function stepFor(
  ctx: ArenaContext,
  side: number,
  core: number,
  field: Field,
  cell: number,
): number {
  const row = ctx.steps[side] ?? [];
  ctx.steps[side] = row;
  const cache = (row[core] ??= new Int32Array(field.dist.length).fill(-2));
  let v = cache[cell] ?? -2;
  if (v === -2) {
    v = fieldStep(ctx.arena, side, field, cell);
    cache[cell] = v;
  }
  return v;
}

/** Rebuild the per-side presence tables from the unit list. */
function buildPresence(sim: ArenaSim, ctx: ArenaContext): void {
  // Only an accelerator (a window without enemies is skipped): with few units
  // the table costs more than it saves, and the result is the same either way.
  ctx.presenceOn = sim.units.length >= 128;
  if (!ctx.presenceOn) return;
  const { width, height } = ctx.arena.geom;
  const stride = width + 1;
  for (const sat of ctx.present) sat.fill(0);
  for (const u of sim.units) {
    const sat = ctx.present[u.side];
    if (sat === undefined) continue;
    const k =
      (cellCoord(u.py, height) + 1) * stride + cellCoord(u.px, width) + 1;
    sat[k] = (sat[k] ?? 0) + 1;
  }
  for (const sat of ctx.present) {
    for (let y = 1; y <= height; y++) {
      for (let x = 1; x <= width; x++) {
        const k = y * stride + x;
        sat[k] =
          (sat[k] ?? 0) +
          (sat[k - stride] ?? 0) +
          (sat[k - 1] ?? 0) -
          (sat[k - stride - 1] ?? 0);
      }
    }
  }
}

/** Whether `side` has a unit centre in cells `x0..x1` x `y0..y1` (inclusive). */
function anyPresent(
  ctx: ArenaContext,
  side: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const sat = ctx.present[side];
  if (sat === undefined) return false;
  if (!ctx.presenceOn) return true;
  const stride = ctx.arena.geom.width + 1;
  return (
    (sat[(y1 + 1) * stride + x1 + 1] ?? 0) -
      (sat[y0 * stride + x1 + 1] ?? 0) -
      (sat[(y1 + 1) * stride + x0] ?? 0) +
      (sat[y0 * stride + x0] ?? 0) >
    0
  );
}

function breachFor(
  ctx: ArenaContext,
  side: number,
  core: number,
): Float64Array {
  const row = ctx.breach[side] ?? [];
  let f = row[core];
  if (f === undefined) {
    f = computeBreach(
      ctx.arena,
      side,
      core,
      (ref) => ctx.maxHealth[ref] ?? 0,
      ctx.simConfig.breachBaseCost,
      ctx.simConfig.breachHealthPerCost,
    );
    row[core] = f;
    ctx.breach[side] = row;
  }
  return f;
}

/** True while the enemy Core of player `core` (enemy of `side`) stands. */
function coreAlive(arena: Arena, side: number, core: number): boolean {
  const ref = arena.coreRef[1 - side]?.[core] ?? -1;
  return ref >= 0 && arena.buildings[ref]?.alive === true;
}

/**
 * A cell's rank for the enemy Core `core` (PP-11): class 0 and its distance
 * in the movement field, else class 1 and its distance in the breach field,
 * else class 2. Smaller is nearer; `core` -1 (no Core) ranks every cell 2.
 */
function cellRank(
  ctx: ArenaContext,
  side: number,
  core: number,
  k: number,
): { cls: number; d: number } {
  if (core < 0) return { cls: 2, d: 0 };
  const d = fieldFor(ctx, side, core).dist[k] ?? -1;
  if (d >= 0) return { cls: 0, d };
  const b = breachFor(ctx, side, core)[k] ?? -1;
  return b >= 0 ? { cls: 1, d: b } : { cls: 2, d: 0 };
}

/**
 * The best target by the key `(class, distance, |q - opposite|, -q)` among
 * the living enemy Cores, where `rank(q)` gives the first two parts, or -1
 * when none stands. Applies only once the opposite Core is gone.
 */
function bestCore(
  ctx: ArenaContext,
  side: number,
  owner: number,
  rank: (q: number) => { cls: number; d: number } | null,
): number {
  const n = ctx.arena.coreRef[1 - side]?.length ?? 0;
  const opp = n - 1 - owner;
  let best = -1;
  let bc = 0;
  let bd = 0;
  let bn = 0;
  for (let q = 0; q < n; q++) {
    if (!coreAlive(ctx.arena, side, q)) continue;
    const r = rank(q);
    if (r === null) continue;
    const near = Math.abs(q - opp);
    if (
      best < 0 ||
      r.cls < bc ||
      (r.cls === bc &&
        (r.d < bd || (r.d === bd && (near < bn || (near === bn && q > best)))))
    ) {
      best = q;
      bc = r.cls;
      bd = r.d;
      bn = near;
    }
  }
  return best;
}

/**
 * `chooseTarget(owner, cell)` of PP-11 for a unit of `side` whose centre is
 * in arena cell `k`: the Core opposite its owner's plot if it stands, else
 * the nearest living enemy Core, else -1.
 */
function chooseTarget(
  ctx: ArenaContext,
  side: number,
  owner: number,
  k: number,
): number {
  const n = ctx.arena.coreRef[1 - side]?.length ?? 0;
  const opp = n - 1 - owner;
  if (coreAlive(ctx.arena, side, opp)) return opp;
  return bestCore(ctx, side, owner, (q) => cellRank(ctx, side, q, k));
}

/**
 * One player's bonus percent for one effect (PP-8): the sum over the living
 * economy buildings of that effect owned by player `owner` on `side` of
 * `steps * stepPercent`, capped at the global maximum from `sim.json`. Each
 * owner is capped on their own; buildings of a partner add nothing. Destroyed buildings are no longer in `sim.ramps`,
 * so their share leaves the total at once.
 */
export function rampBonus(
  sim: ArenaSim,
  ctx: ArenaContext,
  side: number,
  effect: EconomyEffectType,
  owner: number,
): number {
  let raw = 0;
  for (const r of sim.ramps) {
    if (r.side !== side) continue;
    const info = ctx.ramps.get(bkey(r.side, r.building));
    if (info === undefined || info.effect !== effect || info.owner !== owner)
      continue;
    raw += r.steps * info.stepPercent;
  }
  return cappedBonus(
    raw,
    effect === 'source_speed'
      ? ctx.simConfig.maxSourceSpeedPercent
      : ctx.simConfig.maxUnitStrengthPercent,
  );
}

function defOf(ctx: ArenaContext, unit: UnitSim): UnitDef {
  const def = ctx.content.units.get(unit.def);
  if (def === undefined) throw new Error(`Unknown unit "${unit.def}".`);
  return def;
}

// ---------------------------------------------------------------------------
// Spawning

const S = CELL_UNITS;

/** Make room for `n` units in the per-unit scratch arrays (contents kept). */
function ensureUnitCapacity(ctx: ArenaContext, n: number): void {
  if (ctx.next.length >= n) return;
  const size = Math.max(n, 2 * ctx.next.length, 64);
  const g32 = (a: Int32Array): Int32Array => {
    const b = new Int32Array(size);
    b.set(a);
    return b;
  };
  ctx.next = g32(ctx.next);
  ctx.bySide[0] = g32(ctx.bySide[0] ?? new Int32Array(0));
  ctx.bySide[1] = g32(ctx.bySide[1] ?? new Int32Array(0));
  ctx.crad = g32(ctx.crad);
  ctx.brad = g32(ctx.brad);
  ctx.arg = g32(ctx.arg);
  const fly = new Uint8Array(size);
  fly.set(ctx.fly);
  ctx.fly = fly;
  const action = new Uint8Array(size);
  action.set(ctx.action);
  ctx.action = action;
  const holds = new Uint8Array(size);
  holds.set(ctx.holds);
  ctx.holds = holds;
  const damage = new Float64Array(size);
  damage.set(ctx.unitDamage);
  ctx.unitDamage = damage;
  ctx.motion.ensure(size);
}

/** Put unit index `i` (already in `sim.units`) into the per-side cell grid. */
function linkUnit(
  ctx: ArenaContext,
  i: number,
  u: UnitSim,
  def: UnitDef,
): void {
  const { width, height } = ctx.arena.geom;
  const heads = ctx.heads[u.side];
  if (heads === undefined) return;
  const k = cellCoord(u.py, height) * width + cellCoord(u.px, width);
  ctx.next[i] = heads[k] ?? -1;
  heads[k] = i;
  ctx.crad[i] = def.collisionRadius;
  ctx.brad[i] = def.radius;
  ctx.fly[i] = def.flying ? 1 : 0;
  const list = ctx.bySide[u.side];
  if (list !== undefined) {
    list[ctx.sideCount[u.side === 0 ? 0 : 1]] = i;
    ctx.sideCount[u.side === 0 ? 0 : 1] += 1;
  }
}

/** Rebuild the per-side cell grid of the units (start of the Production step). */
function buildUnitGrid(sim: ArenaSim, ctx: ArenaContext): void {
  ensureUnitCapacity(ctx, sim.units.length + 16);
  ctx.heads[0]?.fill(-1);
  ctx.heads[1]?.fill(-1);
  ctx.sideCount[0] = 0;
  ctx.sideCount[1] = 0;
  sim.units.forEach((u, i) => {
    linkUnit(ctx, i, u, defOf(ctx, u));
  });
}

/** The offsets (own frame, in units of `m`) tried inside a spawn cell, in order. */
const SPAWN_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

/**
 * Gather into `ctx.near` (x, y, radius triples) the living units whose centre
 * is in arena cells `x0 .. x1` x `y0 .. y1` widened by what a unit of
 * collision radius `r` can reach: every unit that could overlap a circle of
 * that radius centred anywhere inside the window, in the layer `fly` (flying
 * units and ground units do not collide). Returns how many.
 */
function gatherNear(
  sim: ArenaSim,
  ctx: ArenaContext,
  fly: number,
  r: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const { width, height } = ctx.arena.geom;
  const win = Math.max(1, divCeil(r + ctx.maxRadius, S));
  let count = 0;
  const yLo = Math.max(0, y0 - win);
  const yHi = Math.min(height - 1, y1 + win);
  const xLo = Math.max(0, x0 - win);
  const xHi = Math.min(width - 1, x1 + win);
  for (const heads of ctx.heads) {
    for (let y = yLo; y <= yHi; y++) {
      for (let x = xLo; x <= xHi; x++) {
        let j = heads[y * width + x] ?? -1;
        while (j !== -1) {
          const e = sim.units[j];
          if (e !== undefined && ctx.fly[j] === fly) {
            if (3 * count + 3 > ctx.near.length) {
              const bigger = new Int32Array(2 * ctx.near.length);
              bigger.set(ctx.near);
              ctx.near = bigger;
            }
            ctx.near[3 * count] = e.px;
            ctx.near[3 * count + 1] = e.py;
            ctx.near[3 * count + 2] = ctx.crad[j] ?? 0;
            count += 1;
          }
          j = ctx.next[j] ?? -1;
        }
      }
    }
  }
  return count;
}

/**
 * The first free position inside arena cell `(cx, cy)` for a unit of `side`
 * and type `def`: the cell's centre plus the offsets of `SPAWN_OFFSETS` times
 * `m = 120 - collisionRadius` (negated for side 1, the rotated frame), or null.
 * A position is free when the circle fits and overlaps no living unit by more
 * than half the new unit's collision radius (rounded down). The
 * `count` units of `ctx.near` (see `gatherNear`) must include every unit that
 * could overlap such a position; extra units do no harm.
 */
function firstFreeIn(
  ctx: ArenaContext,
  side: number,
  def: UnitDef,
  count: number,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const r = def.collisionRadius;
  const m = S / 2 - r;
  const half = Math.floor(r / 2);
  const sign = side === 0 ? 1 : -1;
  // Keep the gathered units that can overlap a position of this cell: a
  // position is at most `max(m, 0)` from the cell's centre.
  const mx = cx * S + S / 2;
  const my = cy * S + S / 2;
  const lim = r + ctx.maxRadius + (m > 0 ? m : 0);
  if (ctx.nearCell.length < ctx.near.length) {
    ctx.nearCell = new Int32Array(ctx.near.length);
  }
  const near = ctx.nearCell;
  let kept = 0;
  for (let q = 0; q < count; q++) {
    const ux = ctx.near[3 * q] ?? 0;
    const uy = ctx.near[3 * q + 1] ?? 0;
    if (ux - mx >= lim || mx - ux >= lim || uy - my >= lim || my - uy >= lim) {
      continue;
    }
    near[3 * kept] = ux;
    near[3 * kept + 1] = uy;
    near[3 * kept + 2] = ctx.near[3 * q + 2] ?? 0;
    kept += 1;
  }
  for (const [ox, oy] of SPAWN_OFFSETS) {
    if (m <= 0 && (ox !== 0 || oy !== 0)) continue;
    const x = mx + sign * ox * m;
    const y = my + sign * oy * m;
    if (!fits(def.flying ? ctx.air : ctx.world, side, r, x, y)) continue;
    let free = true;
    for (let q = 0; q < kept && free; q++) {
      const dx = (near[3 * q] ?? 0) - x;
      const dy = (near[3 * q + 1] ?? 0) - y;
      // Blocked only when heavily: overlap deeper than half the new unit's
      // collision radius (rounded down); lighter overlap resolves itself.
      const rr = r + (near[3 * q + 2] ?? 0) - half;
      if (dx * dx + dy * dy < rr * rr) free = false;
    }
    if (free) return { x, y };
  }
  return null;
}

/** `firstFreeIn` for one cell, gathering the units around it first. */
function freeInCell(
  sim: ArenaSim,
  ctx: ArenaContext,
  side: number,
  def: UnitDef,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const count = gatherNear(
    sim,
    ctx,
    def.flying ? 1 : 0,
    def.collisionRadius,
    cx,
    cy,
    cx,
    cy,
  );
  return firstFreeIn(ctx, side, def, count, cx, cy);
}

/**
 * The cells a unit leaving `producer` may appear in, in the order tried: the
 * cells 4-adjacent to the producer's footprint that are open for the side, in
 * the order of the key (class, distance, tie key), without repeats. A pure
 * function of which buildings exist, so it is cached per building until the
 * next destruction (like the movement fields) and rebuilt on demand.
 */
function spawnCells(
  ctx: ArenaContext,
  side: number,
  core: number,
  ref: number,
  producer: ArenaBuilding,
): Int32Array {
  const key = ref * SPAWN_KEY + core + 1;
  const cached = ctx.spawnCells.get(key);
  if (cached !== undefined) return cached;
  const arena = ctx.arena;
  const { width, height } = arena.geom;
  const cands: { k: number; cls: number; d: number; tie: number }[] = [];
  for (const c of producer.cells) {
    for (const [dx, dy] of NEIGHBORS) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const k = y * width + x;
      if (!openFor(arena, side, k)) continue;
      const { cls, d } = cellRank(ctx, side, core, k);
      cands.push({ k, cls, d, tie: tieKey(arena, side, x, y) });
    }
  }
  cands.sort(
    (a, b) => a.cls - b.cls || a.d - b.d || a.tie - b.tie || a.k - b.k,
  );
  const out: number[] = [];
  let last = -1;
  for (const c of cands) {
    if (c.k === last) continue;
    last = c.k;
    out.push(c.k);
  }
  const cells = Int32Array.from(out);
  ctx.spawnCells.set(key, cells);
  return cells;
}

/** Stride of the `spawnCells` cache key: more than any party size plus one. */
const SPAWN_KEY = 64;

/**
 * The spawn position of a unit leaving `producer`: the first free position in
 * the first of its `spawnCells` that has one. The units near any of the cells
 * are gathered once. Null when no position is free (the unit is held).
 */
function spawnPosition(
  sim: ArenaSim,
  ctx: ArenaContext,
  side: number,
  cells: Int32Array,
  unitDef: UnitDef,
): { x: number; y: number } | null {
  if (cells.length === 0) return null;
  const width = ctx.arena.geom.width;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const k of cells) {
    const x = k % width;
    const y = divFloor(k, width);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const count = gatherNear(
    sim,
    ctx,
    unitDef.flying ? 1 : 0,
    unitDef.collisionRadius,
    x0,
    y0,
    x1,
    y1,
  );
  for (const k of cells) {
    const pos = firstFreeIn(
      ctx,
      side,
      unitDef,
      count,
      k % width,
      divFloor(k, width),
    );
    if (pos !== null) return pos;
  }
  return null;
}

function produce(sim: ArenaSim, ctx: ArenaContext, tick: number): void {
  buildUnitGrid(sim, ctx);
  for (const p of sim.producers) {
    const info = ctx.producers.get(bkey(p.side, p.building));
    const board = sim.boards[p.side === 0 ? 0 : 1];
    if (info === undefined) continue;
    // Intake (PP-6): at most `cost - progress` items, so `progress` never
    // exceeds the cost. A producer holding a finished unit takes nothing: its
    // buffers fill and its conduits back up.
    if (p.progress < info.cost) {
      const consumer = board.consumers.find((c) => c.building === p.building);
      if (consumer !== undefined) {
        for (const input of consumer.inputs) {
          const n = Math.min(input.count, info.cost - p.progress);
          if (n > 0 && takeFromBuffer(board, p.building, input.side, n)) {
            p.progress += n;
          }
        }
      }
    }
    // A unit is made only when the cost is there and the cooldown is over.
    if (p.progress < info.cost || p.cooldown > 0) continue;
    const unitDef = ctx.content.units.get(info.unit);
    if (unitDef === undefined) throw new Error(`Unknown unit "${info.unit}".`);
    const producer = ctx.arena.buildings[info.ref];
    if (producer === undefined) continue;
    // The target Core: the opposite one if it stands (the spawn cells are
    // ordered by its fields), else the nearest by the first spawn cell.
    const owner = info.owner;
    const n = ctx.arena.coreRef[1 - p.side]?.length ?? 0;
    const opp = n - 1 - owner;
    const target = coreAlive(ctx.arena, p.side, opp)
      ? opp
      : bestCore(ctx, p.side, owner, (q) => {
          const first = spawnCells(ctx, p.side, q, info.ref, producer)[0];
          return first === undefined ? null : cellRank(ctx, p.side, q, first);
        });
    const cells = spawnCells(ctx, p.side, target, info.ref, producer);
    const pos = spawnPosition(sim, ctx, p.side, cells, unitDef);
    if (pos === null) continue; // held: no free position at the exit
    p.progress = 0;
    p.cooldown = info.interval;
    addUnit(
      sim,
      ctx,
      p.side,
      unitDef,
      pos.x,
      pos.y,
      p.building,
      tick,
      { owner, target },
      info.owner,
    );
  }
  queueWaves(sim, tick);
  enterWaves(sim, ctx, tick);
}

/**
 * The strength percent a unit of `side` spawned now gets: the ramp bonus of
 * the player who owns its producer (`owner`; `null` for a scheduled-wave unit,
 * which has no owner and gets none) plus the side-wide base (PP-8).
 */
function spawnStrength(
  sim: ArenaSim,
  ctx: ArenaContext,
  side: number,
  owner: number | null,
): number {
  return (
    (owner === null ? 0 : rampBonus(sim, ctx, side, 'unit_strength', owner)) +
    (sim.sideOptions?.[side === 0 ? 0 : 1]?.unitStrengthPercent ?? 0) +
    modifierPercent(sim.teams[side === 0 ? 0 : 1], 'unit_strength_percent')
  );
}

/** Create a unit of `side` at `(px, py)` and record `unit_spawned`. */
function addUnit(
  sim: ArenaSim,
  ctx: ArenaContext,
  side: number,
  unitDef: UnitDef,
  px: number,
  py: number,
  building: number,
  tick: number,
  who: { owner: number; target: number },
  rampOwner: number | null,
): void {
  const stats = unitStats(
    side,
    unitDef,
    spawnStrength(sim, ctx, side, rampOwner),
  );
  const unit: UnitSim = {
    id: sim.nextUnitId,
    side,
    def: unitDef.id,
    px,
    py,
    hp: stats.health,
    damage: stats.damage,
    attackCooldown: 0,
    owner: who.owner,
    target: who.target,
  };
  sim.nextUnitId += 1;
  sim.units.push(unit);
  const index = sim.units.length - 1;
  ensureUnitCapacity(ctx, index + 1 + 16);
  linkUnit(ctx, index, unit, unitDef);
  sim.spawned[side === 0 ? 0 : 1] += 1;
  ctx.events?.push({
    tick,
    type: 'unit_spawned',
    unit: unit.id,
    side,
    def: unit.def,
    px,
    py,
    building,
    owner: unit.owner,
    target: unit.target,
  });
}

/** The arena cell index holding the point `(pos.x, pos.y)` (sub-cell units). */
function cellAt(
  ctx: ArenaContext,
  side: number,
  pos: { x: number; y: number },
): number {
  const { width, height } = ctx.arena.geom;
  return (
    ownCellCoord(side, pos.y, height) * width + ownCellCoord(side, pos.x, width)
  );
}

/** Between consecutive scheduled waves of a side the start column moves by this. */
const WAVE_START_STRIDE = 7;

/**
 * Scheduled waves (side options), step 1: for side 0 then side 1, each wave
 * whose tick is the current tick, in list order, appends its `count` units to
 * the `entering` queue, unit `i` (0-based) of wave `j` wanting the own-frame
 * column `(floor((2i + 1) * W / (2n)) + 7j) mod W`.
 */
function queueWaves(sim: ArenaSim, tick: number): void {
  const options = sim.sideOptions;
  if (options === undefined) return;
  const width = sim.teams[0].map.width;
  for (const side of [0, 1] as const) {
    const waves = options[side].scheduledWaves;
    if (waves === undefined) continue;
    waves.forEach((w, j) => {
      if (w.tick !== tick) return;
      for (let i = 0; i < w.count; i++) {
        const col = modFloor(
          divFloor((2 * i + 1) * width, 2 * w.count) + WAVE_START_STRIDE * j,
          width,
        );
        sim.entering.push({ side, unit: w.unit, col });
      }
    });
  }
}

/**
 * Scheduled waves, step 2: walk the `entering` queue once in order. An entry
 * tries the side's front row at its wanted column, then `col - 1`, `col + 1`,
 * `col - 2`, ... (cells open for the side); in each the first free position
 * (see `freeInCell`). It enters, or stays in the queue in its place.
 */
function enterWaves(sim: ArenaSim, ctx: ArenaContext, tick: number): void {
  if (sim.entering.length === 0) return;
  const arena = ctx.arena;
  const { width, height, boardHeight } = arena.geom;
  const rest: EnteringSim[] = [];
  // Units only get added during the walk, which can only take room away: once
  // an entry found no place on a side's row, no later entry of that side with
  // the very same collision radius can find one either (it tries the same
  // positions, whatever its wanted column, since every open cell of the row is
  // tried). Entries of another radius try other offsets inside a cell (the
  // offsets scale with `120 - radius`), so a larger unit can fit where a
  // smaller one did not and vice versa: they are tried. (Only a shortcut: it
  // never changes who enters.)
  let failed0: number[] | null = null;
  let failed1: number[] | null = null;
  for (const e of sim.entering) {
    const unitDef = ctx.content.units.get(e.unit);
    if (unitDef === undefined) throw new Error(`Unknown unit "${e.unit}".`);
    const side = e.side;
    const failedHere = side === 0 ? failed0 : failed1;
    if (failedHere?.includes(unitDef.collisionRadius) === true) {
      rest.push(e);
      continue;
    }
    const row = side === 0 ? boardHeight - 1 : height - boardHeight;
    let pos: { x: number; y: number } | null = null;
    let used = 0;
    for (let d = 0; d < width && pos === null; d++) {
      for (const c of d === 0 ? [e.col] : [e.col - d, e.col + d]) {
        if (c < 0 || c >= width) continue;
        const cx = side === 0 ? c : width - 1 - c;
        if (!openFor(arena, side, row * width + cx)) continue;
        pos = freeInCell(sim, ctx, side, unitDef, cx, row);
        if (pos !== null) {
          used = c;
          break;
        }
      }
    }
    if (pos === null) {
      rest.push(e);
      if (side === 0) (failed0 ??= []).push(unitDef.collisionRadius);
      else (failed1 ??= []).push(unitDef.collisionRadius);
    } else {
      // PP-11: the owner is the plot of the column it entered on; the target
      // is chosen from the entry cell.
      const owner = divFloor(used, sim.teams[side === 0 ? 0 : 1].map.plotWidth);
      const target = chooseTarget(ctx, side, owner, cellAt(ctx, side, pos));
      // A wave unit has no producer, so no ramp bonus (PP-8).
      addUnit(
        sim,
        ctx,
        side,
        unitDef,
        pos.x,
        pos.y,
        0,
        tick,
        { owner, target },
        null,
      );
    }
  }
  sim.entering = rest;
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
    if (sim.sideOptions?.[t.side === 0 ? 0 : 1]?.freePower === true) {
      t.charge = info.costPerShot;
      continue;
    }
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
 * Ramp charging (step 2, after turret charging): each living economy
 * building, in side then building-ID order, that has `steps < maxSteps` takes
 * from its input buffers only as many items as it needs to reach
 * `costPerStep`. When the charge is complete it takes one step (at most one
 * per tick), the charge resets to 0 and `ramp_step` is recorded. A building at
 * its cap takes nothing, so its buffer fills and its conduit backs up.
 */
function chargeRamps(sim: ArenaSim, ctx: ArenaContext, tick: number): void {
  for (const r of sim.ramps) {
    const info = ctx.ramps.get(bkey(r.side, r.building));
    if (info === undefined || r.steps >= info.maxSteps) continue;
    const board = sim.boards[r.side === 0 ? 0 : 1];
    const consumer = board.consumers.find((c) => c.building === r.building);
    if (consumer === undefined) continue;
    for (const input of consumer.inputs) {
      const take = Math.min(input.count, info.costPerStep - r.charge);
      if (take > 0 && takeFromBuffer(board, r.building, input.side, take)) {
        r.charge += take;
      }
    }
    if (r.charge >= info.costPerStep && r.cooldown === 0) {
      r.charge = 0;
      r.steps += 1;
      r.cooldown = info.stepInterval;
      ctx.events?.push({
        tick,
        type: 'ramp_step',
        side: r.side,
        building: r.building,
        effect: info.effect,
        steps: r.steps,
      });
    }
  }
}

/**
 * Turret fire (end of step 3). Each ready turret (cooldown 0, fully charged),
 * side 0 first then by building ID, shoots the nearest enemy unit that is
 * in range and whose centre stands inside the arena rows of the turret
 * owner's own board or the gap rows (never the enemy's board; side 0: rows
 * `0 .. h + gapRows - 1`, side 1: rows `h .. H - 1`). In range: the squared distance from the unit's centre to
 * the nearest cell of the turret is at most `(rangeCells * CELL_UNITS +
 * radius)^2`, i.e. the gap from the unit's circle to the turret is at most
 * `rangeCells` cells. Nearest: smallest such squared distance; ties by lowest
 * unit ID. Damage joins the pending damage.
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
    // PP-13: the owner's board rows and the gap rows (never the enemy board).
    const rowLo = t.side === 0 ? 0 : geom.boardHeight;
    const rowHi =
      t.side === 0 ? geom.boardHeight + geom.gapRows - 1 : geom.height - 1;
    let best = -1;
    let bestD = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined || u.side === t.side) continue;
      const row = ownCellCoord(t.side, u.py, geom.height);
      if (row < rowLo || row > rowHi) continue;
      const d = buildingDist2(u.px, u.py, turret);
      const reach = info.rangeCells * S + (ctx.brad[i] ?? 0);
      if (d <= reach * reach && d < bestD) {
        best = i;
        bestD = d; // units are in ID order, so a tie keeps the lower ID
      }
    }
    const target = units[best];
    if (target === undefined) continue;
    t.charge = 0;
    t.cooldown = info.cooldownTicks;
    ctx.unitDamage[best] = addDamage(ctx.unitDamage[best] ?? 0, info.damage);
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
 * Put a unit on the map, as if spawned (tests and scenarios), at the centre of
 * arena cell `(x, y)` or at the exact position `(px, py)` (sub-cell units).
 * Throws if its circle does not fit for its side (blocked ground or a
 * building that blocks the side; a gate of its own side does not) or overlaps
 * a living unit (unless `allowOverlap`). Emits no event.
 */
export function spawnUnitForTest(
  sim: ArenaSim,
  ctx: ArenaContext,
  args: {
    side: number;
    def: UnitId;
    x?: number;
    y?: number;
    px?: number;
    py?: number;
    /** Skip the overlap check (tests of damage sums that stack units). */
    allowOverlap?: boolean;
    /**
     * The unit's owner; default the plot its cell is in, in its own frame. The
     * owner's ramp bonus applies to its strength (PP-8).
     */
    owner?: number;
    /** The unit's target Core; default `chooseTarget(owner, cell)`. */
    target?: number;
  },
): UnitSim {
  const def = ctx.content.units.get(args.def);
  if (def === undefined) throw new Error(`Unknown unit "${args.def}".`);
  const px = args.px ?? (args.x === undefined ? undefined : args.x * S + S / 2);
  const py = args.py ?? (args.y === undefined ? undefined : args.y * S + S / 2);
  if (px === undefined || py === undefined) {
    throw new Error('spawnUnitForTest: give x and y or px and py.');
  }
  if (
    !fits(
      def.flying ? ctx.air : ctx.world,
      args.side,
      def.collisionRadius,
      px,
      py,
    )
  ) {
    throw new Error(
      `spawnUnitForTest: (${String(px)}, ${String(py)}) is not open.`,
    );
  }
  for (const e of args.allowOverlap === true ? [] : sim.units) {
    const other = ctx.content.units.get(e.def);
    if (other?.flying !== def.flying) continue;
    const rr = def.collisionRadius + (other?.collisionRadius ?? 0);
    const dx = e.px - px;
    const dy = e.py - py;
    if (dx * dx + dy * dy < rr * rr) {
      throw new Error(
        `spawnUnitForTest: (${String(px)}, ${String(py)}) overlaps unit ${String(e.id)}.`,
      );
    }
  }
  const k = cellAt(ctx, args.side, { x: px, y: py });
  // The column in the unit's own frame; `ownCellCoord` returns the arena column
  // with the boundary rule of the own frame, so a side-1 column is mirrored back.
  const width = ctx.arena.geom.width;
  const ownCol =
    args.side === 0
      ? ownCellCoord(0, px, width)
      : width - 1 - ownCellCoord(args.side, px, width);
  const owner =
    args.owner ??
    divFloor(ownCol, sim.teams[args.side === 0 ? 0 : 1].map.plotWidth);
  const stats = unitStats(
    args.side,
    def,
    spawnStrength(sim, ctx, args.side, owner),
  );
  const unit: UnitSim = {
    id: sim.nextUnitId,
    side: args.side,
    def: def.id,
    px,
    py,
    hp: stats.health,
    damage: stats.damage,
    attackCooldown: 0,
    owner,
    target: args.target ?? chooseTarget(ctx, args.side, owner, k),
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
/** Transient (between decision passes): chase the unit at index `arg`. */
const ACT_AGGRO = 4;

/** Below this many enemy units the searches look at every one of them. */
const FEW_UNITS = 24;

/**
 * Whether a unit of type `def` can hit enemy unit index `j`: only ranged
 * attackers can hit a flying unit (issue #59, CB-16b).
 */
function canHit(ctx: ArenaContext, def: UnitDef, j: number): boolean {
  return ctx.fly[j] !== 1 || def.attackType === 'ranged';
}

/**
 * Index of the enemy unit in contact with `u` (the gap between the circles is
 * at most `reach`) that is nearest by squared centre distance, ties by lowest
 * unit ID; -1 if none.
 */
function nearestContact(
  sim: ArenaSim,
  ctx: ArenaContext,
  u: UnitSim,
  def: UnitDef,
): number {
  const { width, height } = ctx.arena.geom;
  const heads = ctx.heads[1 - u.side];
  if (heads === undefined) return -1;
  const win = Math.max(1, divCeil(def.reach + def.radius + ctx.maxBody, S));
  const gx = cellCoord(u.px, width);
  const gy = cellCoord(u.py, height);
  let best = -1;
  let bestD = 0;
  let bestId = 0;
  const y0 = Math.max(0, gy - win);
  const y1 = Math.min(height - 1, gy + win);
  const x0 = Math.max(0, gx - win);
  const x1 = Math.min(width - 1, gx + win);
  const few = ctx.sideCount[1 - u.side === 0 ? 0 : 1];
  if (few <= FEW_UNITS) {
    // Few enemies: look at all of them (the same result as the cell search).
    const list = ctx.bySide[1 - u.side];
    for (let q = 0; q < few; q++) {
      const j = list?.[q] ?? -1;
      const e = sim.units[j];
      if (e === undefined) continue;
      const dx = e.px - u.px;
      const dy = e.py - u.py;
      const d2 = dx * dx + dy * dy;
      const lim = def.reach + def.radius + (ctx.brad[j] ?? 0);
      if (
        d2 <= lim * lim &&
        (best < 0 || d2 < bestD || (d2 === bestD && e.id < bestId)) &&
        canHit(ctx, def, j)
      ) {
        best = j;
        bestD = d2;
        bestId = e.id;
      }
    }
    return best;
  }
  if (!anyPresent(ctx, 1 - u.side, x0, y0, x1, y1)) return -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let j = heads[y * width + x] ?? -1;
      while (j !== -1) {
        const e = sim.units[j];
        if (e !== undefined) {
          const dx = e.px - u.px;
          const dy = e.py - u.py;
          const d2 = dx * dx + dy * dy;
          const lim = def.reach + def.radius + (ctx.brad[j] ?? 0);
          if (
            d2 <= lim * lim &&
            (best < 0 || d2 < bestD || (d2 === bestD && e.id < bestId)) &&
            canHit(ctx, def, j)
          ) {
            best = j;
            bestD = d2;
            bestId = e.id;
          }
        }
        j = ctx.next[j] ?? -1;
      }
    }
  }
  return best;
}

/**
 * Cell-level line of sight: every sample point from `(x0, y0)` to `(x1, y1)`,
 * spaced at most half a cell apart, lies in a cell that is not solid for
 * `side`.
 */
function lineClear(
  ctx: ArenaContext,
  side: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const { width, height } = ctx.arena.geom;
  const solid = ctx.world.solid[side];
  if (solid === undefined) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const n = Math.max(1, divCeil(Math.max(Math.abs(dx), Math.abs(dy)), S / 2));
  for (let k = 0; k <= n; k++) {
    const x = x0 + Math.trunc((dx * k) / n);
    const y = y0 + Math.trunc((dy * k) / n);
    if (
      solid[
        ownCellCoord(side, y, height) * width + ownCellCoord(side, x, width)
      ] === 1
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Index of the nearest visible enemy unit within the aggro range (squared
 * centre distance, ties by lowest unit ID); -1 if none.
 */
function nearestVisible(
  sim: ArenaSim,
  ctx: ArenaContext,
  u: UnitSim,
  def: UnitDef,
): number {
  const { width, height } = ctx.arena.geom;
  const heads = ctx.heads[1 - u.side];
  if (heads === undefined) return -1;
  const range = ctx.simConfig.aggroRangeCells * S;
  const range2 = range * range;
  const win = Math.max(1, divCeil(range, S));
  const gx = cellCoord(u.px, width);
  const gy = cellCoord(u.py, height);
  let best = -1;
  let bestD = 0;
  let bestId = 0;
  const y0 = Math.max(0, gy - win);
  const y1 = Math.min(height - 1, gy + win);
  const x0 = Math.max(0, gx - win);
  const x1 = Math.min(width - 1, gx + win);
  const few = ctx.sideCount[1 - u.side === 0 ? 0 : 1];
  if (few <= FEW_UNITS) {
    const list = ctx.bySide[1 - u.side];
    for (let q = 0; q < few; q++) {
      const j = list?.[q] ?? -1;
      const e = sim.units[j];
      if (e === undefined) continue;
      const dx = e.px - u.px;
      const dy = e.py - u.py;
      const d2 = dx * dx + dy * dy;
      if (
        d2 <= range2 &&
        (best < 0 || d2 < bestD || (d2 === bestD && e.id < bestId)) &&
        canHit(ctx, def, j) &&
        (def.flying || lineClear(ctx, u.side, u.px, u.py, e.px, e.py))
      ) {
        best = j;
        bestD = d2;
        bestId = e.id;
      }
    }
    return best;
  }
  if (!anyPresent(ctx, 1 - u.side, x0, y0, x1, y1)) return -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let j = heads[y * width + x] ?? -1;
      while (j !== -1) {
        const e = sim.units[j];
        if (e !== undefined) {
          const dx = e.px - u.px;
          const dy = e.py - u.py;
          const d2 = dx * dx + dy * dy;
          if (
            d2 <= range2 &&
            (best < 0 || d2 < bestD || (d2 === bestD && e.id < bestId)) &&
            canHit(ctx, def, j) &&
            (def.flying || lineClear(ctx, u.side, u.px, u.py, e.px, e.py))
          ) {
            best = j;
            bestD = d2;
            bestId = e.id;
          }
        }
        j = ctx.next[j] ?? -1;
      }
    }
  }
  return best;
}

/** Set the move target of unit `i` to `(tx, ty)`. */
function moveTo(ctx: ArenaContext, i: number, tx: number, ty: number): void {
  ctx.action[i] = ACT_MOVE;
  ctx.motion.want[i] = 1;
  ctx.motion.tx[i] = tx;
  ctx.motion.ty[i] = ty;
}

/**
 * Decision pass 1 (rule a): attack the nearest enemy unit in contact. Every
 * decision pass reads only the state and the results of the earlier passes.
 */
function decideContact(
  sim: ArenaSim,
  ctx: ArenaContext,
  i: number,
  u: UnitSim,
): void {
  ctx.action[i] = ACT_NONE;
  ctx.holds[i] = 0;
  ctx.motion.want[i] = 0;
  const j = nearestContact(sim, ctx, u, defOf(ctx, u));
  if (j >= 0) {
    ctx.action[i] = ACT_UNIT;
    ctx.arg[i] = j;
    ctx.holds[i] = 1;
  }
}

/**
 * Decision pass 2 (rules a2 and b): chase the nearest visible enemy unit in
 * aggro range, else attack the Core when it is within reach.
 */
function decideAim(
  sim: ArenaSim,
  ctx: ArenaContext,
  i: number,
  u: UnitSim,
): void {
  if (ctx.action[i] !== ACT_NONE) return;
  const arena = ctx.arena;
  const def = defOf(ctx, u);
  const reachR = def.reach + def.radius;
  if (ctx.simConfig.aggroRangeCells > 0) {
    const a = nearestVisible(sim, ctx, u, def);
    if (a >= 0) {
      ctx.action[i] = ACT_AGGRO;
      ctx.arg[i] = a;
      return;
    }
  }
  // Rule b (PP-11, CB-15c): any living enemy Core within reach. The unit's
  // target Core first, else the nearest; ties by the later parts of the
  // target key, `(|q - opposite(owner)|, -q)`.
  const cores = arena.coreRef[1 - u.side] ?? [];
  const opp = cores.length - 1 - u.owner;
  let best = -1;
  let bestT = 0;
  let bestD = 0;
  let bestN = 0;
  for (let q = 0; q < cores.length; q++) {
    const ref = cores[q] ?? -1;
    const core = ref >= 0 ? arena.buildings[ref] : undefined;
    if (core === undefined || !core.alive) continue;
    const d = buildingDist2(u.px, u.py, core);
    if (d > reachR * reachR) continue;
    const t = q === u.target ? 0 : 1;
    const near = Math.abs(q - opp);
    if (
      best < 0 ||
      t < bestT ||
      (t === bestT &&
        (d < bestD ||
          (d === bestD && (near < bestN || (near === bestN && q > best)))))
    ) {
      best = q;
      bestT = t;
      bestD = d;
      bestN = near;
    }
  }
  if (best >= 0) {
    ctx.action[i] = ACT_BUILDING;
    ctx.arg[i] = cores[best] ?? -1;
    ctx.holds[i] = 1;
  }
}

/**
 * Move along the heading `(hx, hy)` (not zero; its length is the distance of
 * the aim point). If an ally that holds its place (it attacks this tick) is
 * ahead and within the combined collision radii of the line, slide past it:
 * the heading becomes `H + sigma * perp(H)` (45 degrees), `sigma` towards the
 * side away from the ally, or, on the line, towards the positive x of the
 * unit's own frame (then the positive y). See "Steering".
 */
function moveAlong(
  sim: ArenaSim,
  ctx: ArenaContext,
  i: number,
  u: UnitSim,
  hx: number,
  hy: number,
): void {
  const { width, height } = ctx.arena.geom;
  const heads = ctx.heads[u.side];
  let vx = hx;
  let vy = hy;
  if (heads !== undefined) {
    const l2 = hx * hx + hy * hy;
    // Candidates: allies whose centre is closer than `reach` (below), found
    // in the cells that hold the square of that half-width around the unit,
    // so the set does not depend on the alignment of the grid.
    const reach = 4 * ctx.maxRadius;
    const gx0 = cellCoord(u.px - reach, width);
    const gx1 = cellCoord(u.px + reach, width);
    const gy0 = cellCoord(u.py - reach, height);
    const gy1 = cellCoord(u.py + reach, height);
    const cr = ctx.crad[i] ?? 0;
    let best = -1;
    let bestD = 0;
    let bestCross = 0;
    for (let y = gy0; y <= gy1; y++) {
      for (let x = gx0; x <= gx1; x++) {
        let j = heads[y * width + x] ?? -1;
        while (j !== -1) {
          const f =
            j !== i && ctx.fly[j] === ctx.fly[i] ? sim.units[j] : undefined;
          if (f !== undefined) {
            const rx = f.px - u.px;
            const ry = f.py - u.py;
            const d = rx * rx + ry * ry;
            const rc = cr + (ctx.crad[j] ?? 0);
            // A holder blocks within two collision diameters, an ally that
            // moves only when its circle already overlaps ours.
            const lim = ctx.holds[j] === 1 ? 4 * rc * rc : rc * rc;
            if (d < lim) {
              const dot = rx * hx + ry * hy;
              const cross = rx * hy - ry * hx;
              if (dot > 0 && dot < l2 && cross * cross <= rc * rc * l2) {
                if (
                  best < 0 ||
                  d < bestD ||
                  (d === bestD &&
                    (cross > bestCross ||
                      (cross === bestCross &&
                        f.id < (sim.units[best]?.id ?? 0))))
                ) {
                  best = j;
                  bestD = d;
                  bestCross = cross;
                }
              }
            }
          }
          j = ctx.next[j] ?? -1;
        }
      }
    }
    if (best >= 0) {
      const frame = u.side === 0 ? 1 : -1;
      let sigma = bestCross > 0 ? 1 : bestCross < 0 ? -1 : 0;
      if (sigma === 0) {
        // On the line: towards positive x (then y) of the unit's own frame.
        sigma = hy !== 0 ? (-hy * frame > 0 ? 1 : -1) : hx * frame > 0 ? 1 : -1;
      }
      vx = hx - sigma * hy;
      vy = hy + sigma * hx;
    }
  }
  moveTo(ctx, i, u.px + vx, u.py + vy);
}

/** Move towards the centre of the Core cell nearest to the unit. */
function moveToCore(
  sim: ArenaSim,
  ctx: ArenaContext,
  i: number,
  u: UnitSim,
): void {
  const core = ctx.arena.coreRef[1 - u.side]?.[u.target] ?? -1;
  const b = core >= 0 ? ctx.arena.buildings[core] : undefined;
  if (b === undefined || !b.alive) return;
  let bx = 0;
  let by = 0;
  let bestD = Number.MAX_SAFE_INTEGER;
  // Ties go to the first cell in the unit's own frame: side 1 reads the
  // arena-ordered list from the end.
  const n = b.cells.length;
  for (let q = 0; q < n; q++) {
    const c = b.cells[u.side === 0 ? q : n - 1 - q];
    if (c === undefined) continue;
    const d = boxDist2(u.px, u.py, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      bx = c.x;
      by = c.y;
    }
  }
  const hx = bx * S + S / 2 - u.px;
  const hy = by * S + S / 2 - u.py;
  if (hx === 0 && hy === 0) return;
  moveAlong(sim, ctx, i, u, hx, hy);
}

/**
 * Decision pass 3 (rule c and the chase of rule a2): where the units that
 * neither attack nor wait move to.
 */
function decideMove(
  sim: ArenaSim,
  ctx: ArenaContext,
  i: number,
  u: UnitSim,
): void {
  const arena = ctx.arena;
  const { width, height } = arena.geom;
  const def = defOf(ctx, u);
  const reachR = def.reach + def.radius;
  const act = ctx.action[i];
  if (act === ACT_AGGRO) {
    const e = sim.units[ctx.arg[i] ?? -1];
    ctx.action[i] = ACT_NONE;
    if (e === undefined) return;
    const hx = e.px - u.px;
    const hy = e.py - u.py;
    if (hx === 0 && hy === 0) moveTo(ctx, i, e.px, e.py);
    else moveAlong(sim, ctx, i, u, hx, hy);
    return;
  }
  if (act !== ACT_NONE) return;

  // c. Move. A flying unit ignores the fields: it flies straight at its
  // target Core and never breaches (CB-16b).
  if (def.flying) {
    moveToCore(sim, ctx, i, u);
    return;
  }
  const cell =
    ownCellCoord(u.side, u.py, height) * width +
    ownCellCoord(u.side, u.px, width);
  if (u.target < 0) return; // no enemy Core stands: wait
  const field = fieldFor(ctx, u.side, u.target);
  const d = field.dist[cell] ?? -1;
  if (d > 0) {
    const k = stepFor(ctx, u.side, u.target, field, cell);
    if (k >= 0) {
      // Steer by the direction of the step, not at the next cell's centre.
      moveAlong(
        sim,
        ctx,
        i,
        u,
        ((k % width) - (cell % width)) * S,
        (Math.floor(k / width) - Math.floor(cell / width)) * S,
      );
    }
    return;
  }
  if (d === 0) {
    moveToCore(sim, ctx, i, u);
    return;
  }

  // No route in the normal field: breach (CB-20).
  const bd = breachFor(ctx, u.side, u.target);
  const here0 = bd[cell] ?? -1;
  if (here0 < 0) return; // wait
  if (here0 === 0) {
    moveToCore(sim, ctx, i, u);
    return;
  }
  const k = breachStep(
    arena,
    u.side,
    bd,
    cell,
    (r) => ctx.maxHealth[r] ?? 0,
    ctx.simConfig.breachBaseCost,
    ctx.simConfig.breachHealthPerCost,
    ctx.arena.coreRef[1 - u.side]?.[u.target] ?? -1,
  );
  if (k < 0) return;
  const occ = arena.occupant[k] ?? -1;
  if (occ >= 0 && !openFor(arena, u.side, k)) {
    const b = arena.buildings[occ];
    if (b !== undefined && buildingDist2(u.px, u.py, b) <= reachR * reachR) {
      ctx.action[i] = ACT_BUILDING;
      ctx.arg[i] = occ;
      return;
    }
  }
  moveTo(ctx, i, (k % width) * S + S / 2, Math.floor(k / width) * S + S / 2);
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
    ctx.events?.push({
      tick,
      type: 'core_destroyed',
      side: b.side,
      core: b.player,
    });
    return;
  }
  ctx.events?.push({
    tick,
    type: 'building_destroyed',
    side: b.side,
    building: b.id,
  });
  const team = sim.teams[b.side === 0 ? 0 : 1];
  const lost = new Set(conduitsLostWith(team.conduits, b.id));
  for (const id of [...lost].sort((x, y) => x - y)) {
    ctx.events?.push({
      tick,
      type: 'conduit_destroyed',
      side: b.side,
      conduit: id,
    });
  }
  const newTeam: TeamState = {
    ...team,
    buildings: team.buildings.filter((p) => p.id !== b.id),
    conduits: team.conduits.filter((c) => !lost.has(c.id)),
  };
  sim.teams[b.side === 0 ? 0 : 1] = newTeam;
  sim.producers = sim.producers.filter(
    (p) => !(p.side === b.side && p.building === b.id),
  );
  sim.turrets = sim.turrets.filter(
    (t) => !(t.side === b.side && t.building === b.id),
  );
  sim.ramps = sim.ramps.filter(
    (r) => !(r.side === b.side && r.building === b.id),
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
 * (5) moves and separation; (6) deaths and destruction; (7) cooldowns and the tick counter.
 */
export function stepArena(sim: ArenaSim, ctx: ArenaContext): void {
  const tick = sim.tick;
  const events = ctx.events;
  const arena = ctx.arena;

  // 0. Overload level (derived from the tick; events on the ticks it rises).
  const cfg = ctx.simConfig;
  const level = overloadLevel(tick, cfg);
  const beat = isOverloadBeat(tick, cfg);
  if (beat) {
    if (level === 1) events?.push({ tick, type: 'overload_started' });
    events?.push({ tick, type: 'overload_level', level });
  }

  // 1. Flow.
  for (const side of [0, 1] as const) {
    const buf = ctx.flowEvents[side];
    if (buf !== undefined) buf.length = 0;
    const flow = ctx.flows[side];
    if (flow === undefined) throw new Error('Arena: missing flow context.');
    flow.sourceSpeedPercent = sim.teams[side].cores.map((_, owner) =>
      rampBonus(sim, ctx, side, 'source_speed', owner),
    );
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
  chargeRamps(sim, ctx, tick);

  // 3. Decide, from a snapshot.
  // (The per-side cell grid was built in the Production step, new units
  // linked as they were placed.)
  const units = sim.units;
  const n = units.length;
  ensureUnitCapacity(ctx, n);
  ctx.unitDamage.fill(0, 0, n);
  buildPresence(sim, ctx);
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u !== undefined) decideContact(sim, ctx, i, u);
  }
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u !== undefined) decideAim(sim, ctx, i, u);
  }
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u !== undefined) decideMove(sim, ctx, i, u);
  }
  fireTurrets(sim, ctx, tick);

  // 4. Resolve attacks simultaneously.
  ctx.buildingDamage.fill(0);
  ctx.attackDamage.fill(0);
  for (let i = 0; i < n; i++) {
    const u = units[i];
    const act = ctx.action[i] ?? ACT_NONE;
    if (u === undefined || (act !== ACT_UNIT && act !== ACT_BUILDING)) continue;
    if (u.attackCooldown > 0) continue; // holds position
    const stats = unitStats(u.side, defOf(ctx, u));
    const damage = mulPct(
      u.damage,
      100 + level * cfg.overloadDamageStepPercent,
    );
    const arg = ctx.arg[i] ?? 0;
    let target: UnitTarget;
    if (act === ACT_UNIT) {
      const t = units[arg];
      if (t === undefined) continue;
      ctx.unitDamage[arg] = addDamage(ctx.unitDamage[arg] ?? 0, damage);
      target = { kind: 'unit', unit: t.id };
    } else {
      const b = arena.buildings[arg];
      if (b === undefined) continue;
      ctx.buildingDamage[arg] = addDamage(ctx.buildingDamage[arg] ?? 0, damage);
      ctx.attackDamage[arg] = addDamage(ctx.attackDamage[arg] ?? 0, damage);
      target =
        b.kind === 'core'
          ? { kind: 'core', side: b.side, core: b.player }
          : { kind: 'building', side: b.side, building: b.id };
    }
    u.attackCooldown = stats.attackCooldownTicks;
    events?.push({
      tick,
      type: 'unit_attacked',
      unit: u.id,
      target,
      damage,
    });
  }
  // Overload Core decay, applied together with the damage above.
  if (beat) {
    const decay = level * cfg.overloadCoreDamageStep;
    // Every living Core takes the full amount: side 0 then side 1, players in
    // ascending order (PP-9).
    for (const side of [0, 1]) {
      (arena.coreRef[side] ?? []).forEach((ref, core) => {
        if (ref < 0 || arena.buildings[ref]?.alive !== true) return;
        ctx.buildingDamage[ref] = addDamage(
          ctx.buildingDamage[ref] ?? 0,
          decay,
        );
        events?.push({
          tick,
          type: 'overload_core_damage',
          side,
          core,
          damage: decay,
        });
      });
    }
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
    if (h === undefined) continue;
    // Damage dealt to buildings (tiebreak): the attacks only, at most the
    // health the building had, credited to the other side.
    const applied = Math.min(ctx.attackDamage[r] ?? 0, h.hp);
    if (applied > 0) {
      const dealer = h.side === 0 ? 1 : 0;
      sim.buildingDamageDealt[dealer] = addInt(
        sim.buildingDamageDealt[dealer],
        applied,
      );
    }
    const remaining = h.hp - dmg;
    if (isCoreHealth(h)) {
      const row = ctx.coreRemaining[h.side];
      if (row !== undefined) row[h.core] = remaining;
    }
    h.hp = Math.max(0, remaining);
  }

  // 5. Move and separate.
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u === undefined) continue;
    ctx.motion.rad[i] = ctx.crad[i] ?? 0;
    ctx.motion.fly[i] = ctx.fly[i] ?? 0;
    ctx.motion.fight[i] =
      ctx.action[i] === ACT_UNIT || ctx.action[i] === ACT_BUILDING ? 1 : 0;
    if (ctx.action[i] === ACT_MOVE) {
      ctx.motion.speed[i] = unitSpeed(defOf(ctx, u));
    }
  }
  ctx.motion.resolve(
    units,
    ctx.world,
    cfg.separationPercent,
    cfg.separationCap,
    ctx.maxRadius,
    ctx.air,
  );

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
    const ref = refOfHealth(arena, h);
    const b = ref >= 0 ? arena.buildings[ref] : undefined;
    if (b === undefined || !b.alive) continue;
    destroyBuilding(sim, ctx, ref, tick);
    destroyed = true;
  }
  if (destroyed) {
    ctx.fields[0] = [];
    ctx.fields[1] = [];
    ctx.breach[0] = [];
    ctx.breach[1] = [];
    ctx.spawnCells.clear();
    for (const row of ctx.steps) {
      for (const s of row) s?.fill(-2);
    }
    fillSolid(arena, ctx.world.solid);
    // PP-11: a unit whose target Core fell chooses a new one, in unit-ID
    // order, from the cell that holds its centre.
    for (const u of sim.units) {
      if (u.target < 0 || coreAlive(arena, u.side, u.target)) continue;
      u.target = chooseTarget(
        ctx,
        u.side,
        u.owner,
        cellAt(ctx, u.side, { x: u.px, y: u.py }),
      );
      events?.push({
        tick,
        type: 'unit_retargeted',
        unit: u.id,
        target: u.target,
      });
    }
  }

  // 7. Cooldowns, then the tick counter.
  for (const t of sim.turrets) {
    if (t.cooldown > 0) t.cooldown -= 1;
  }
  for (const p of sim.producers) {
    if (p.cooldown > 0) p.cooldown -= 1;
  }
  for (const r of sim.ramps) {
    if (r.cooldown > 0) r.cooldown -= 1;
  }
  for (const u of sim.units) {
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

/** A state and a context with an event list: the usual way to start an arena. */
export function startArenaBattle(
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
