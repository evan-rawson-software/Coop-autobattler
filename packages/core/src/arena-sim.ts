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
import type { EconomyEffectType, Side } from './buildings.js';
import {
  addInt,
  addSaturating,
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
import { modifierPercent } from './modifiers.js';
import { cappedBonus, isOverloadBeat, overloadLevel } from './ramp.js';
import type { Cell } from './map.js';
import type { NeutralZone } from './neutral-zone.js';
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
  /** Arena coordinates. */
  x: number;
  y: number;
  hp: number;
  /** Attack damage fixed at spawn (base damage with the side's strength bonus). */
  damage: number;
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

export interface RampSim {
  readonly side: number;
  readonly building: number;
  /** Resource units collected towards the next step (0 .. costPerStep - 1). */
  charge: number;
  /** Steps taken so far (0 .. maxSteps). */
  steps: number;
}

export interface ProducerSim {
  readonly side: number;
  readonly building: number;
  /** Resource units collected towards the next unit. */
  progress: number;
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
  /** The side's Core starts with this health instead of the definition's. */
  readonly coreHealth?: number;
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
  /** Living economy (in-battle ramp) buildings, by (side, building). */
  ramps: RampSim[];
  /** Living units, sorted by `id`. */
  units: UnitSim[];
  /** Units spawned, by side. */
  readonly spawned: [number, number];
  /** Units that died, by side. */
  readonly unitsDied: [number, number];
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
}

interface TurretInfo {
  readonly ref: number;
  readonly damage: number;
  readonly rangeCells: number;
  readonly cooldownTicks: number;
  readonly costPerShot: number;
}

interface RampInfo {
  readonly effect: EconomyEffectType;
  readonly costPerStep: number;
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
   * Per side, the Core's health after all damage of the latest tick that
   * damaged it, NOT clamped at 0 (so a destroyed Core's overkill is known,
   * CB-33). Equals the Core's health while it is alive.
   */
  readonly coreRemaining: [number, number];
  readonly producers: Map<number, ProducerInfo>;
  readonly turrets: Map<number, TurretInfo>;
  readonly ramps: Map<number, RampInfo>;
  readonly flowEvents: SimEvent[][];
  /**
   * `ref` -> the building's maximum health (its tier's health). The breach
   * field is built from this, never from current health (CB-20), so the
   * cached field is a pure function of which buildings exist.
   */
  readonly maxHealth: Float64Array;
  /** Lazily computed, dropped whenever a building is destroyed. */
  fields: (Field | undefined)[];
  breach: (Float64Array | undefined)[];
  // Scratch buffers reused across ticks.
  heads: Int32Array[];
  next: Int32Array;
  action: Uint8Array;
  arg: Int32Array;
  /**
   * Damage accumulated this tick. Float64Array holding integers, summed with
   * `addDamage` (saturating at MAX_TICK_DAMAGE, each hit at most MAX_HIT, so
   * every sum is exact; never a wrap-around, which an Int32Array would do
   * past 2^31).
   */
  unitDamage: Float64Array;
  buildingDamage: Float64Array;
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

/**
 * A building's maximum health, the single definition used for both the health
 * it starts the battle with and the breach cost of covering it. It is the
 * tier's health (the Core is tier 1), or `coreHealthOverride` for the Core
 * when the side options give one, raised by the team's modifiers: for the Core
 * `core_health_percent`, for any other building `building_health_percent`
 * matching its defense type or kind. Rounded down. Throws a RangeError when
 * the result exceeds MAX_HEALTH or an override is out of range, so a bad
 * combination fails at battle setup, never mid-battle.
 */
function maxHealthOf(
  team: TeamState | undefined,
  b: ArenaBuilding,
  content: ArenaContent,
  coreHealthOverride?: number,
): number {
  const def = content.buildings.get(b.def);
  const placed = team?.buildings.find((p) => p.id === b.id);
  const tier = b.kind === 'core' ? 0 : (placed?.tier ?? 1) - 1;
  let hp = def?.tiers[tier]?.health ?? 0;
  if (b.kind === 'core' && coreHealthOverride !== undefined) {
    // Checked: the time-limit rule multiplies two Core healths.
    assertWithin(coreHealthOverride, 1, MAX_HEALTH, 'Side option coreHealth');
    hp = coreHealthOverride;
  }
  if (team !== undefined) {
    const pct =
      b.kind === 'core'
        ? modifierPercent(team, 'core_health_percent')
        : modifierPercent(
            team,
            'building_health_percent',
            b.defenseType ?? b.kind,
          );
    if (pct > 0) hp = mulPct(hp, 100 + pct);
  }
  if (hp > MAX_HEALTH) {
    throw new RangeError(
      `Building ${b.def} (id ${String(b.id)}): maximum health ${String(hp)} with modifiers exceeds the maximum ${String(MAX_HEALTH)}.`,
    );
  }
  return hp;
}

/** Adds one hit to the damage a target takes this tick (saturating, exact). */
function addDamage(sum: number, hit: number): number {
  return addSaturating(sum, hit, MAX_TICK_DAMAGE);
}

/** A turret tier's damage with the team's `turret_damage_percent`, checked. */
function turretDamageOf(team: TeamState, damage: number): number {
  const v = mulPct(
    damage,
    100 + modifierPercent(team, 'turret_damage_percent'),
  );
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
  sim.health.forEach((h, i) => healthAt.set(bkey(h.side, h.building), i));
  const healthIndex = new Int32Array(arena.buildings.length);
  for (const b of arena.buildings) {
    const i = healthAt.get(bkey(b.side, b.id));
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
      b.kind === 'core' ? sim.sideOptions?.[side].coreHealth : undefined,
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
        });
      } else if (def.kind === 'economy') {
        const tier = def.tiers[p.tier - 1];
        if (tier === undefined) continue;
        ramps.set(bkey(side, p.id), {
          effect: def.effect.type,
          costPerStep: tier.costPerStep,
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
  const coreRemaining: [number, number] = [0, 0];
  for (const h of sim.health) {
    if (h.building === 0) coreRemaining[h.side === 0 ? 0 : 1] = h.hp;
  }
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
    maxHealth,
    coreRemaining,
    producers,
    turrets,
    ramps,
    flowEvents,
    fields: new Array<Field | undefined>(2 * TARGETINGS.length).fill(undefined),
    breach: [undefined, undefined] as (Float64Array | undefined)[],
    heads: [new Int32Array(cells), new Int32Array(cells)],
    next: new Int32Array(0),
    action: new Uint8Array(0),
    arg: new Int32Array(0),
    unitDamage: new Float64Array(0),
    buildingDamage: new Float64Array(arena.buildings.length),
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
      b.kind === 'core' ? options.sideOptions?.[side]?.coreHealth : undefined,
    );
    health.push({ side: b.side, building: b.id, hp });
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
      producers.push({ side: b.side, building: b.id, progress: 0 });
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
      ramps.push({ side: b.side, building: b.id, charge: 0, steps: 0 });
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
    spawned: [0, 0],
    unitsDied: [0, 0],
  };
}

// ---------------------------------------------------------------------------
// Fields

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

function breachFor(ctx: ArenaContext, side: number): Float64Array {
  let f = ctx.breach[side];
  if (f === undefined) {
    f = computeBreach(
      ctx.arena,
      side,
      (ref) => ctx.maxHealth[ref] ?? 0,
      ctx.simConfig.breachBaseCost,
      ctx.simConfig.breachHealthPerCost,
    );
    ctx.breach[side] = f;
  }
  return f;
}

/**
 * A side's bonus percent for one effect: the sum over its living economy
 * buildings of that effect of `steps * stepPercent`, capped at the global
 * maximum from `sim.json`. Destroyed buildings are no longer in `sim.ramps`,
 * so their share leaves the total at once.
 */
export function rampBonus(
  sim: ArenaSim,
  ctx: ArenaContext,
  side: number,
  effect: EconomyEffectType,
): number {
  let raw = 0;
  for (const r of sim.ramps) {
    if (r.side !== side) continue;
    const info = ctx.ramps.get(bkey(r.side, r.building));
    if (info === undefined || info.effect !== effect) continue;
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

function spawnCell(
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
        d = breachFor(ctx, side)[k] ?? -1;
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
    const k = spawnCell(ctx, p.side, producer, unitDef);
    if (k < 0) continue; // no free cell: the spawn waits, progress is kept
    p.progress -= info.cost;
    const { width } = ctx.arena.geom;
    addUnit(
      sim,
      ctx,
      p.side,
      unitDef,
      k % width,
      divFloor(k, width),
      p.building,
      tick,
    );
  }
  spawnWaves(sim, ctx, tick);
}

/** The strength percent a unit of `side` spawned now gets: ramp bonus plus base. */
function spawnStrength(sim: ArenaSim, ctx: ArenaContext, side: number): number {
  return (
    rampBonus(sim, ctx, side, 'unit_strength') +
    (sim.sideOptions?.[side === 0 ? 0 : 1]?.unitStrengthPercent ?? 0) +
    modifierPercent(sim.teams[side === 0 ? 0 : 1], 'unit_strength_percent')
  );
}

/** Create a unit of `side` on cell `(x, y)` and record `unit_spawned`. */
function addUnit(
  sim: ArenaSim,
  ctx: ArenaContext,
  side: number,
  unitDef: UnitDef,
  x: number,
  y: number,
  building: number,
  tick: number,
): void {
  const stats = unitStats(side, unitDef, spawnStrength(sim, ctx, side));
  const unit: UnitSim = {
    id: sim.nextUnitId,
    side,
    def: unitDef.id,
    x,
    y,
    hp: stats.health,
    damage: stats.damage,
    moveCooldown: stats.moveCooldownTicks,
    attackCooldown: 0,
  };
  sim.nextUnitId += 1;
  sim.units.push(unit);
  sim.spawned[side === 0 ? 0 : 1] += 1;
  ctx.events?.push({
    tick,
    type: 'unit_spawned',
    unit: unit.id,
    side,
    def: unit.def,
    x,
    y,
    building,
  });
}

/** Between consecutive scheduled waves of a side the start column moves by this. */
const WAVE_START_STRIDE = 7;

/**
 * Scheduled waves (side options), after all unit producers: for side 0 then
 * side 1, each wave whose tick is the current tick, in list order, spawns its
 * `count` units on the side's front row. Wave number `j` (its index in the
 * side's list) with `n` units on a board `W` wide puts unit `i` (0-based) in
 * the side's own-frame column `(floor((2i + 1) * W / (2n)) + 7j) mod W`, i.e.
 * evenly across the whole width from a start column that moves with `j`. A
 * column whose front-row cell is not open for the side (terrain, a building
 * that blocks it) is replaced by the nearest open front-row cell, ties to the
 * lower own-frame column; if the row has no open cell the unit is not spawned.
 * The event has `building = 0`.
 */
function spawnWaves(sim: ArenaSim, ctx: ArenaContext, tick: number): void {
  const options = sim.sideOptions;
  if (options === undefined) return;
  const arena = ctx.arena;
  const { width, height, boardHeight } = arena.geom;
  for (const side of [0, 1] as const) {
    const waves = options[side].scheduledWaves;
    if (waves === undefined) continue;
    const row = side === 0 ? boardHeight - 1 : height - boardHeight;
    const cellOf = (col: number): number =>
      row * width + (side === 0 ? col : width - 1 - col);
    waves.forEach((w, j) => {
      if (w.tick !== tick) return;
      const unitDef = ctx.content.units.get(w.unit);
      if (unitDef === undefined) throw new Error(`Unknown unit "${w.unit}".`);
      for (let i = 0; i < w.count; i++) {
        const want = modFloor(
          divFloor((2 * i + 1) * width, 2 * w.count) + WAVE_START_STRIDE * j,
          width,
        );
        let col = -1;
        for (let d = 0; d < width && col < 0; d++) {
          for (const c of d === 0 ? [want] : [want - d, want + d]) {
            if (c >= 0 && c < width && openFor(arena, side, cellOf(c))) {
              col = c;
              break;
            }
          }
        }
        if (col < 0) continue;
        const k = cellOf(col);
        addUnit(
          sim,
          ctx,
          side,
          unitDef,
          k % width,
          divFloor(k, width),
          0,
          tick,
        );
      }
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
    if (r.charge >= info.costPerStep) {
      r.charge = 0;
      r.steps += 1;
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
  const stats = unitStats(args.side, def, spawnStrength(sim, ctx, args.side));
  const unit: UnitSim = {
    id: sim.nextUnitId,
    side: args.side,
    def: def.id,
    x: args.x,
    y: args.y,
    hp: stats.health,
    damage: stats.damage,
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
    ctx.unitDamage = new Float64Array(size);
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
  const bd = breachFor(ctx, u.side);
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
    (r) => ctx.maxHealth[r] ?? 0,
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
 * (5) moves; (6) deaths and destruction; (7) cooldowns and the tick counter.
 */
export function stepArena(sim: ArenaSim, ctx: ArenaContext): void {
  const tick = sim.tick;
  const events = ctx.events;
  const arena = ctx.arena;
  const { width } = arena.geom;

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
    flow.sourceSpeedPercent = rampBonus(sim, ctx, side, 'source_speed');
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
      damage,
    });
  }
  // Overload Core decay, applied together with the damage above.
  if (beat) {
    const decay = level * cfg.overloadCoreDamageStep;
    for (const side of [0, 1]) {
      const ref = arena.coreRef[side] ?? -1;
      if (ref < 0 || arena.buildings[ref]?.alive !== true) continue;
      ctx.buildingDamage[ref] = addDamage(ctx.buildingDamage[ref] ?? 0, decay);
      events?.push({ tick, type: 'overload_core_damage', side, damage: decay });
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
    const remaining = h.hp - dmg;
    if (h.building === 0) ctx.coreRemaining[h.side === 0 ? 0 : 1] = remaining;
    h.hp = Math.max(0, remaining);
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
