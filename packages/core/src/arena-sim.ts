/**
 * Two-board battle simulation with units (W1-5, CB-13..CB-20, CB-30).
 * One tick (`stepArena`): flow on both boards, production, decisions,
 * simultaneous attacks, moves, deaths and destruction, cooldowns. The state
 * (`ArenaSim`) is plain JSON; everything derived from it (the grid, wiring,
 * cached fields) lives in an `ArenaContext`. See docs/rules-reference.md,
 * "One battle tick".
 */

import { sortedInts } from './collections.js';
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
  goalBuildings,
  goalRefs,
  standingPylons,
  computeCellField,
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
  intakeByResource,
  rebuildFlow,
  stepFlow,
  takeFromBuffer,
  type BoardSim,
  type FlowContext,
  type SimEvent,
} from './flow-sim.js';
import {
  costEntries,
  type CostEntry,
  type EconomyEffectType,
  type Side,
} from './buildings.js';
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
  MAX_ARMOR,
  MAX_DAMAGE,
  MAX_HEALTH,
  MAX_HIT,
  MAX_TICK_DAMAGE,
} from './limits.js';
import type { GuardPlan } from './guards.js';
import {
  captureTicksFor,
  type CaptureConfig,
  type PointBuffEffect,
} from './points.js';
import { maxHealthOf } from './max-health.js';
import {
  captureSpeedPercent,
  modifierPercent,
  unitArmorBonus,
  unitSpeedPercent,
  unitSplashPercent,
  unitStrengthPercent,
} from './modifiers.js';
import { cappedBonus, isOverloadBeat, overloadLevel } from './ramp.js';
import type { Cell } from './map.js';
import type { NeutralZone } from './neutral-zone.js';
import type { ResourceId } from './resources.js';
import type { SimConfig } from './sim-config.js';
import { brokenLinks, conduitsLostWith } from './conduits.js';
import { tunnelPairs, type TunnelPair } from './tunnels.js';
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
      /**
       * A boss Core's health fell to a burst threshold (MM-9d, "Brood"): the
       * units it releases (they enter on the next tick, or later when there is
       * no room), in composition order.
       */
      readonly type: 'burst_released';
      readonly side: number;
      /** The player index of the Core that released it. */
      readonly core: number;
      readonly thresholdPercent: number;
      readonly units: readonly {
        readonly unit: UnitId;
        readonly count: number;
      }[];
    }
  | {
      readonly tick: number;
      /**
       * A pylon (MM-9d) was destroyed; `standing` pylons of that Core remain.
       * Recorded in step 6 right after its `building_destroyed`.
       */
      readonly type: 'pylon_destroyed';
      readonly side: number;
      readonly building: number;
      /** The player index of the Core it shielded. */
      readonly core: number;
      readonly standing: number;
    }
  | {
      readonly tick: number;
      /**
       * The last pylon of a Core was destroyed (MM-9d): the Core can be hurt
       * from the next tick on. Recorded right after that `pylon_destroyed`.
       */
      readonly type: 'core_shield_down';
      readonly side: number;
      readonly core: number;
    }
  | {
      readonly tick: number;
      /**
       * A unit's hit on a shielded Core did nothing (MM-9d). Recorded in step
       * 4 right after the `unit_attacked` of the same hit.
       */
      readonly type: 'core_hit_blocked';
      readonly unit: number;
      readonly side: number;
      readonly core: number;
      readonly damage: number;
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
      /**
       * Only when the target is a Core of a side with `linkedCores` (MM-9d):
       * the shared pool's health at the start of this tick, before any of the
       * tick's damage.
       */
      readonly pool?: number;
    }
  | {
      readonly tick: number;
      readonly type: 'splash';
      /** The unit with `splash` that attacked a unit (its `unit_attacked` comes first). */
      readonly attacker: number;
      /** The primary target's centre, in sub-cell units (the blast centre). */
      readonly x: number;
      readonly y: number;
      /** The secondary targets hit, in unit id order, with the damage each took (after armor). */
      readonly targets: readonly {
        readonly unit: number;
        readonly damage: number;
      }[];
    }
  | {
      readonly tick: number;
      readonly type: 'turret_fired';
      readonly side: number;
      readonly building: number;
      readonly unit: number;
      readonly damage: number;
      /**
       * Only for a turret tier with splash (the Mortar, CB-18b): the other
       * units the shot hit, in unit id order, with the damage each took (after
       * armor). Empty when no other unit stood within the radius.
       */
      readonly splash?: readonly {
        readonly unit: number;
        readonly damage: number;
      }[];
    }
  | {
      readonly tick: number;
      /**
       * A neutral guard (CB-8e) was placed at its point at tick 0, before the
       * first tick, in point `id` order. Its centre is in sub-cell units.
       */
      readonly type: 'guard_spawned';
      readonly unit: number;
      /** The `id` of the point it guards. */
      readonly point: number;
      readonly def: UnitId;
      readonly px: number;
      readonly py: number;
    }
  | {
      /**
       * A side's units began capturing a point of interest (CB-8f): its
       * `progressSide` became `side` with progress 0 (capture step).
       */
      readonly tick: number;
      readonly type: 'point_capture_started';
      readonly point: number;
      readonly side: number;
    }
  | {
      /** A side took a point (CB-8f); `previous` is its controller before (-1 none). */
      readonly tick: number;
      readonly type: 'point_captured';
      readonly point: number;
      readonly side: number;
      readonly previous: number;
    }
  | {
      readonly tick: number;
      readonly type: 'unit_died';
      readonly unit: number;
      /** Only for a neutral guard (CB-8e): 2. Absent for a unit of a side. */
      readonly side?: 2;
    }
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
      /**
       * Only for a side with `linkedCores` (MM-9d): the decay is taken from
       * the shared pool once, and this single event names the lowest living
       * Core; `pool` is the pool's health at the start of this tick.
       */
      readonly pool?: number;
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
  /** 0 or 1, or 2 for a neutral guard (CB-8e). */
  readonly side: number;
  readonly def: UnitId;
  /** The centre of the unit's circle, arena sub-cell units (`CELL_UNITS` per cell). */
  px: number;
  py: number;
  hp: number;
  /**
   * The unit's maximum health, fixed at spawn from `unitStats` (CB-8g): healing
   * never takes `hp` above it. Never changes.
   */
  readonly maxHp: number;
  /** Attack damage fixed at spawn (base damage with the side's strength bonus). */
  damage: number;
  attackCooldown: number;
  /**
   * Only for a unit spawned with a speed modifier (issue #424), and only when
   * it differs from the unit definition: the move cooldown ticks and the
   * attack cooldown ticks this unit has for its whole life, fixed at spawn by
   * `unitStats`. Absent means the definition's value, so a battle without
   * speed modifiers has the same state and hash as before they existed.
   */
  moveCooldownTicks?: number;
  attackCooldownTicks?: number;
  /**
   * Only for a unit spawned with an armor or splash modifier (issue #426),
   * and only when it differs from the unit definition: the armor (the
   * definition's plus the side's `unit_armor_flat` amounts, at most
   * `MAX_ARMOR`) and the splash percent (the definition's raised by the
   * side's `unit_splash_percent`) this unit has for its whole life. Absent
   * means the definition's value.
   */
  armor?: number;
  splashPercent?: number;
  /** A player index of the unit's own side: whose plot it belongs to (PP-11). */
  readonly owner: number;
  /**
   * The player index of the enemy Core it heads for, or -1 when none stands.
   * Changes only when that Core is destroyed (PP-11).
   */
  target: number;
  /**
   * Only for a neutral guard (CB-8e, `side` 2, `owner` and `target` -1): the
   * `id` of the point it guards. No other unit has it.
   */
  readonly post?: number;
}

/** A player's Core in the `health` list (PP-9). */
export interface CoreHealthSim {
  readonly side: number;
  /** The player index. */
  readonly core: number;
  /** 0 once destroyed. */
  hp: number;
  /**
   * The health after all damage of the latest tick that damaged this Core,
   * NOT clamped at 0 (so a destroyed Core's overkill is known, CB-33).
   * Equals `hp` while alive. Part of the state so a restore keeps it.
   */
  remaining: number;
  /** The tick the Core was destroyed in, or null while it stands. */
  fellTick: number | null;
}

/**
 * The shared health pool of a side with `linkedCores` (MM-9d). The Cores of
 * the side keep their own `health` entries for layout and display, but take no
 * damage themselves: the pool does, and every Core falls when it reaches 0.
 */
export interface LinkedPoolSim {
  readonly side: number;
  /** The shared health, 0 once the Cores have fallen. */
  hp: number;
  /** The health after all damage of the latest tick, NOT clamped at 0. */
  remaining: number;
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
  /**
   * Resource units collected towards the next unit (0 .. costPerUnit). For a
   * two-input producer (CB-5e) the sum of `counters`.
   */
  progress: number;
  /**
   * Two-input producer only (CB-5e): one counter per resource, sorted by
   * resource ID, the same order as the tier's `costs` entries
   * (0 .. that resource's cost). Absent on a one-cost producer.
   */
  counters?: number[];
  /** Ticks until the next unit may be made (PP-6). */
  cooldown: number;
  /**
   * Units of a finished production that found no room yet (CB-13a): present
   * only while above 0 (omitted, not 0, so a producer that makes one unit at
   * a time has the state it always had).
   */
  held?: number;
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
  /** A champion's health percent (see `ScheduledWave.healthPercent`). */
  readonly healthPercent?: number;
  /** Only this plot's columns may be used (see `ScheduledWave.plot`). */
  readonly plot?: number;
}

/**
 * A burst-unit that has not found room yet (see `SideOptions.bursts`): the
 * unit type and the Core (player index of its own side) it comes out of.
 */
export interface BurstingSim {
  readonly side: number;
  readonly core: number;
  readonly unit: UnitId;
}

/**
 * Units a Core of the side releases when its health falls to a threshold (see
 * `SideOptions.bursts`). One entry per unit type.
 */
export interface SideBurst {
  readonly core: number;
  readonly thresholdPercent: number;
  readonly unit: UnitId;
  readonly count: number;
}

/**
 * A pylon of a side (MM-9d): the building with this instance ID has `health`
 * as its starting and maximum health (before modifiers) and shields the Core
 * of player `core` while it stands (see `SideOptions.pylons`).
 */
export interface SidePylon {
  readonly building: number;
  readonly core: number;
  readonly health: number;
}

/** One scheduled wave of a side (see `SideOptions.scheduledWaves`). */
export interface ScheduledWave {
  /** The tick on which the units spawn (in the Production step). */
  readonly tick: number;
  readonly unit: UnitId;
  readonly count: number;
  /**
   * Champions (MM-9d, "Warlord"): the units of this wave spawn with this
   * percent of their health, applied after the strength percent (`unitStats`).
   * Absent means 100.
   */
  readonly healthPercent?: number;
  /**
   * Focus (issue #433): the units of this wave enter only on the front-row
   * cells of this plot's columns (own frame; 0 to the plot count - 1). Absent
   * means the whole width.
   */
  readonly plot?: number;
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
  /**
   * Core bursts (MM-9d): see the rules reference, "Core bursts". Entries are
   * in release order within a Core and threshold: the order of the profile.
   */
  readonly bursts?: readonly SideBurst[];
  /**
   * The side's Cores share one health pool (MM-9d, "Linked Cores"): see the
   * rules reference. The pool starts as the sum of the Cores' starting health.
   */
  readonly linkedCores?: boolean;
  /**
   * Pylons (MM-9d, "Pylons"): buildings of the side that shield its Cores. A
   * Core takes no unit damage while a pylon of its player index stands; the
   * party's units aim at the pylons first. See the rules reference.
   */
  readonly pylons?: readonly SidePylon[];
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
  /**
   * Burst units released and waiting to spawn, in release order. Present only
   * when a side has `bursts` (so every other state is unchanged).
   */
  bursting?: BurstingSim[];
  /**
   * The shared health pool of each side with `linkedCores`, by side. Present
   * only then (so every other state is unchanged).
   */
  linkedPools?: LinkedPoolSim[];
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
  /**
   * Present only when `placeGuards` was called (battles whose zone has
   * points of interest): the posts of the neutral guards (CB-8e).
   */
  guards?: GuardsSim;
  /**
   * Present only when `placeGuards` was called (battles whose zone has
   * points of interest): the capture state of each point, sorted by `id`
   * (CB-8f).
   */
  points?: PointSim[];
}

/** The capture state of one point of interest (CB-8f). */
export interface PointSim {
  /** The point's `id`. */
  readonly id: number;
  /** The side that holds the point: 0 or 1, -1 for nobody (the start). */
  controller: number;
  /** The side whose capture progress `progress` is: 0, 1 or -1 for nobody. */
  progressSide: number;
  /** Capture progress of `progressSide`, from 0 up to below `captureTicks`. */
  progress: number;
  /** Ticks each side has held the point (counted at the end of each tick). */
  held: [number, number];
  /**
   * What the point gives its holder (CB-8g): the numbers of its buff, copied
   * from `content/points.json`. Absent: the point gives nothing (scenarios).
   */
  readonly buff?: PointBuffEffect;
}

/** A point of interest as the arena sees it: its arena cell (CB-8e). */
export interface GuardPost {
  /** The point's `id`. */
  readonly id: number;
  /** Arena cell: the zone's `x`, and `boardHeight + y` for its `y`. */
  readonly x: number;
  readonly y: number;
  /** The buff the point gives its holder (CB-8g); absent: none. */
  readonly buff?: PointBuffEffect;
}

/** The neutral guards' part of the state (CB-8e). */
export interface GuardsSim {
  /** A guard farther than this many cells from its post walks back. */
  readonly leashCells: number;
  /** The capture numbers of the points (CB-8f), stored so a restored state needs nothing else. */
  readonly capture: CaptureConfig;
  /** The posts, sorted by `id`. */
  readonly posts: readonly GuardPost[];
  /**
   * Guards killed, by the side whose units dealt the most damage to the guard
   * in the tick it died; equal damage counts for both. Not part of
   * `spawned` or `unitsDied`.
   */
  readonly killed: [number, number];
  /**
   * Units of each side that died, counted in `unitsDied`, mainly to guards:
   * the guards dealt more of the damage of their last tick than the other
   * side's units. They are not kills of the other side (`unitsKilled`, the
   * kills rung of the tiebreak).
   */
  readonly lostToGuards: [number, number];
  /**
   * The most a side's held `unit_strength` points add together (CB-8g),
   * outside the Armory cap.
   */
  readonly maxPointStrengthPercent: number;
  /** Health each side's units regained from `heal` points (CB-8g). */
  readonly healed: [number, number];
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
 * A cooldown made faster by `speedPercent` (issue #424): `max(1,
 * floor(base * 100 / (100 + speedPercent)))`, integer math only.
 */
export function fasterCooldown(base: number, speedPercent: number): number {
  return Math.max(1, divFloor(mulInt(base, 100), addInt(100, speedPercent)));
}

/**
 * The stats a unit of type `def` fights with (`_side` is unused). The
 * spawned health and damage and the attack cooldown are read through here;
 * the decisions read `def.reach` and `def.radius` directly. With a
 * `strengthPercent` P above 0 (the side's capped `unit_strength` bonus at the
 * moment of spawning), health and damage become `mulPct(base, 100 + P)`
 * (rounded down). With a `moveSpeedPercent` or `attackSpeedPercent` S (the
 * sum of the side's matching modifier effects, issue #424) the move or attack
 * cooldown becomes `fasterCooldown(base, S)`; everything else is unchanged.
 * Units keep the result they were spawned with (`hp`, `damage` and, when it
 * differs from the definition, `moveCooldownTicks` and `attackCooldownTicks`).
 */
export function unitStats(
  _side: number,
  def: UnitDef,
  strengthPercent = 0,
  healthPercent = 100,
  moveSpeedPercent = 0,
  attackSpeedPercent = 0,
  armorBonus = 0,
  splashBonusPercent = 0,
): UnitDef {
  if (
    strengthPercent === 0 &&
    healthPercent === 100 &&
    moveSpeedPercent === 0 &&
    attackSpeedPercent === 0 &&
    armorBonus === 0 &&
    splashBonusPercent === 0
  ) {
    return def;
  }
  // Scaled stats are held to the content bound (limits.ts): a strength so
  // large that a unit would exceed it is an error, not a wrapped number.
  const scaled2 = (value: number, pct: number, what: string): number => {
    const v = mulPct(value, pct);
    if (v > MAX_HEALTH) {
      throw new RangeError(
        `Unit ${def.id}: ${what} ${String(v)} (health percent ${String(pct)}) exceeds the maximum ${String(MAX_HEALTH)}.`,
      );
    }
    return v;
  };
  const scaled = (value: number, what: string, max: number): number => {
    const v = mulPct(value, addInt(100, strengthPercent));
    if (v > max) {
      throw new RangeError(
        `Unit ${def.id}: ${what} ${String(v)} (strength ${String(strengthPercent)} percent) exceeds the maximum ${String(max)}.`,
      );
    }
    return v;
  };
  // Champions: the health percent follows the strength percent (health only).
  const strengthened = scaled(def.health, 'scaled health', MAX_HEALTH);
  const scaledHealth =
    healthPercent === 100
      ? strengthened
      : scaled2(strengthened, healthPercent, 'champion health');
  return {
    ...def,
    health: scaledHealth,
    damage: scaled(def.damage, 'scaled damage', MAX_DAMAGE),
    armor: Math.min(MAX_ARMOR, addInt(def.armor, armorBonus)),
    ...(def.splash === undefined
      ? {}
      : {
          splash: {
            radiusSub: def.splash.radiusSub,
            percent: mulPct(
              def.splash.percent,
              addInt(100, splashBonusPercent),
            ),
          },
        }),
    moveCooldownTicks: fasterCooldown(def.moveCooldownTicks, moveSpeedPercent),
    attackCooldownTicks: fasterCooldown(
      def.attackCooldownTicks,
      attackSpeedPercent,
    ),
  };
}

// ---------------------------------------------------------------------------
// Context (derived, not part of the state)

interface ProducerInfo {
  readonly ref: number;
  readonly unit: UnitId;
  /** Items of one production: `costPerUnit` times `units` (CB-13a). */
  readonly cost: number;
  /** Units one production spawns (CB-13a). */
  readonly units: number;
  /** Two-input producer (CB-5e): the cost of each resource, sorted by ID. */
  readonly costs?: readonly CostEntry[];
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
  /** Blind spot in sub-cell units (CB-18b); 0 for none. */
  readonly minRangeSub: number;
  /** Splash of a shot (CB-18b): radius in sub-cell units and percent. */
  readonly splash?: { readonly radiusSub: number; readonly percent: number };
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
  /**
   * Per side, the Tunnel pairs of the battle (CB-9g): derived from the
   * placement once, at the start. A destroyed end takes its pair out of the
   * list for good, and no other end pairs in its place.
   */
  readonly tunnels: TunnelPair[][];
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
   * The movement field to each point of interest's cell (CB-8e), by point
   * `id`, built on first use (the guards walk back along it) and dropped with
   * the other fields when a building is destroyed. Part 4 shares it.
   */
  readonly postFields: Map<number, Field>;
  /**
   * Cached `spawnCells` per (producer `ref`, target Core), key
   * `ref * SPAWN_KEY + core + 1` (`core` may be -1: no target); dropped with
   * the fields.
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
   * computed yet). Allocated on first use by `stepFor`; refilled with -2 (not
   * dropped) when a building is destroyed.
   */
  readonly steps: (Int32Array | undefined)[][];
  /**
   * Per side: summed-area table of the number of units whose centre is in a
   * cell ((width + 1) * (height + 1) entries), rebuilt every tick; lets the
   * searches skip windows without enemies.
   */
  readonly present: Int32Array[];
  presenceOn: boolean;
  /** Per side (2 = neutral guards): the indices of its units (ascending), and how many. */
  readonly bySide: Int32Array[];
  readonly sideCount: [number, number, number];
  /** Scratch list of nearby units (x, y, radius triples) for spawn checks. */
  near: Int32Array;
  /** The part of `near` that can overlap one spawn cell. */
  nearCell: Int32Array;
  action: Uint8Array;
  arg: Int32Array;
  /**
   * Per unit: 1 if it chose a unit or a Core to attack this tick (contact or
   * aim), even while its attack cools down; a breach attack on a covering
   * building leaves it 0. Read by `moveAlong` to tell holders from walkers.
   */
  holds: Uint8Array;
  /**
   * Damage accumulated this tick. Float64Array holding integers, summed with
   * `addDamage` (saturating at MAX_TICK_DAMAGE, each hit at most MAX_HIT, so
   * every sum is exact; never a wrap-around, which an Int32Array would do
   * past 2^31).
   */
  unitDamage: Float64Array;
  /**
   * Per unit index `j`, only for hits that involve a neutral guard (a guard
   * is the target or the attacker): the damage of this tick that side 0
   * (`3 * j`), side 1 (`3 * j + 1`) and the guards (`3 * j + 2`) dealt to it,
   * summed like `unitDamage`. Decides whose kill a death counts as (CB-8e).
   */
  hitBy: Float64Array;
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

/**
 * The starting health a side's options give a building: a Core's
 * `coreHealths` entry, or a pylon's `pylons` entry; undefined for any other.
 */
function healthOverrideOf(
  options: SideOptions | null | undefined,
  b: ArenaBuilding,
): number | undefined {
  if (b.kind === 'core') return options?.coreHealths?.[b.player];
  if (b.defenseType !== 'pylon') return undefined;
  return options?.pylons?.find((p) => p.building === b.id)?.health;
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
  // Pylons (MM-9d): in the order of the side options (side 0, then side 1).
  for (const side of [0, 1] as const) {
    for (const p of sim.sideOptions?.[side].pylons ?? []) {
      const ref = arena.byId[side]?.get(p.building);
      if (ref !== undefined) arena.pylons.push({ ref, side, core: p.core });
    }
  }
  return arena;
}

/**
 * A hit on a unit with `armor` (CB-5h): `max(1, hit - armor)` for a hit above
 * 0; a hit of 0 stays 0. Applied last, per hit, after Overload scaling.
 */
export function armorHit(hit: number, armor: number): number {
  return hit > 0 && armor > 0 ? Math.max(1, hit - armor) : hit;
}

/** Adds one hit to the damage a target takes this tick (saturating, exact). */
function addDamage(sum: number, hit: number): number {
  return addSaturating(sum, hit, MAX_TICK_DAMAGE);
}

/** A turret tier's damage with the team's `turret_damage_percent`, checked. */
function turretDamageOf(
  team: TeamState,
  damage: number,
  minSum: number,
): number {
  const pct = modifierPercent(team, 'turret_damage_percent', minSum);
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
      simConfig.minModifierSumPercent,
      healthOverrideOf(sim.sideOptions?.[side], b),
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
        const costs = costEntries(def, p.tier);
        producers.set(bkey(side, p.id), {
          ref,
          unit: def.unit,
          cost: tier.costPerUnit * tier.unitsPerProduction,
          units: tier.unitsPerProduction,
          ...(costs === undefined ? {} : { costs }),
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
          damage: turretDamageOf(
            team,
            tier.damage,
            simConfig.minModifierSumPercent,
          ),
          rangeCells: tier.rangeCells,
          cooldownTicks: tier.cooldownTicks,
          costPerShot: tier.costPerShot,
          minRangeSub: (tier.minRangeCells ?? 0) * S,
          ...(tier.splashPercent === undefined ||
          tier.splashRadiusCells === undefined
            ? {}
            : {
                splash: {
                  radiusSub: tier.splashRadiusCells * S,
                  percent: tier.splashPercent,
                },
              }),
        });
      }
    }
  });
  const coreRemaining: number[][] = sim.teams.map((t) => t.cores.map(() => 0));
  for (const h of sim.health) {
    const row = coreRemaining[h.side];
    if (isCoreHealth(h) && row !== undefined) row[h.core] = h.remaining;
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
    tunnels: sim.teams.map((team) => tunnelPairs(team, content)),
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
      solid: [
        new Uint8Array(cells),
        new Uint8Array(cells),
        new Uint8Array(cells),
      ],
    },
    maxRadius: Math.max(
      1,
      ...content.units.list().map((d) => d.collisionRadius),
    ),
    maxBody: Math.max(1, ...content.units.list().map((d) => d.radius)),
    fields: [[], []] as (Field | undefined)[][],
    breach: [[], []] as (Float64Array | undefined)[][],
    postFields: new Map<number, Field>(),
    spawnCells: new Map<number, Int32Array>(),
    heads: [
      new Int32Array(cells),
      new Int32Array(cells),
      new Int32Array(cells),
    ],
    next: new Int32Array(0),
    crad: new Int32Array(0),
    brad: new Int32Array(0),
    fly: new Uint8Array(0),
    motion: new MotionScratch(),
    steps: [[], []] as (Int32Array | undefined)[][],
    present: [
      new Int32Array((arena.geom.width + 1) * (arena.geom.height + 1)),
      new Int32Array((arena.geom.width + 1) * (arena.geom.height + 1)),
      new Int32Array((arena.geom.width + 1) * (arena.geom.height + 1)),
    ],
    presenceOn: false,
    bySide: [new Int32Array(0), new Int32Array(0), new Int32Array(0)],
    sideCount: [0, 0, 0] as [number, number, number],
    near: new Int32Array(192),
    nearCell: new Int32Array(192),
    action: new Uint8Array(0),
    arg: new Int32Array(0),
    holds: new Uint8Array(0),
    unitDamage: new Float64Array(0),
    hitBy: new Float64Array(0),
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

/**
 * Fail at the start, not mid-battle (see `createArenaSim`): the largest
 * strength a side's units can reach is the side's base, its strength
 * modifiers, the largest ramp bonus and `pointMax`, the most its held points
 * can add (CB-8g, `placeGuards` calls this again with it).
 */
function assertStrengthBounds(
  teams: readonly [TeamState, TeamState],
  content: ArenaContent,
  simConfig: SimConfig,
  sideOptions: ArenaOptions['sideOptions'],
  pointMax: number,
): void {
  // Fail at the start, not mid-battle: with the side's base strength, its
  // strength modifiers and the largest ramp bonus it can reach (none without
  // a unit_strength economy building), every unit type must stay within the
  // stat bounds.
  const maxLevel = overloadLevel(simConfig.maxBattleTicks, simConfig);
  for (const side of [0, 1] as const) {
    const base = sideOptions?.[side]?.unitStrengthPercent ?? 0;
    assertWithin(base, 0, Number.MAX_SAFE_INTEGER, 'unitStrengthPercent');
    const team = teams[side];
    const hasRamp = team.buildings.some((p) => {
      const def = content.buildings.get(p.def);
      return def?.kind === 'economy' && def.effect.type === 'unit_strength';
    });
    const rampMax = hasRamp ? simConfig.maxUnitStrengthPercent : 0;
    for (const def of content.units.list()) {
      // Worst case per unit type: untargeted plus the targeted effects that
      // list this type.
      const strength = addInt(
        addInt(
          base,
          unitStrengthPercent(team, def.id, simConfig.minModifierSumPercent),
        ),
        addInt(rampMax, pointMax),
      );
      const stats = unitStats(0, def, strength);
      // Overload at the last possible tick scales every hit; one hit must
      // stay within MAX_HIT so the per-tick damage sums are exact.
      const hit = mulPct(
        stats.damage,
        addInt(100, mulInt(maxLevel, simConfig.overloadDamageStepPercent)),
      );
      assertWithin(hit, 0, MAX_HIT, `Unit ${def.id}: Overload hit`);
    }
    // Champions (MM-9d): the health percent of a wave is a whole percent of at
    // least 100, and the health it gives must stay within the bound too.
    for (const w of sideOptions?.[side]?.scheduledWaves ?? []) {
      if (w.plot !== undefined) {
        assertWithin(
          w.plot,
          0,
          divFloor(team.map.width, team.map.plotWidth) - 1,
          'Scheduled wave plot',
        );
      }
      if (w.healthPercent === undefined) continue;
      assertWithin(
        w.healthPercent,
        100,
        Number.MAX_SAFE_INTEGER,
        'Scheduled wave healthPercent',
      );
      const def = content.units.get(w.unit);
      if (def !== undefined) {
        unitStats(
          0,
          def,
          addInt(
            addInt(
              base,
              unitStrengthPercent(
                team,
                def.id,
                simConfig.minModifierSumPercent,
              ),
            ),
            addInt(rampMax, pointMax),
          ),
          w.healthPercent,
        );
      }
    }
  }
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
      simConfig.minModifierSumPercent,
      healthOverrideOf(options.sideOptions?.[side], b),
    );
    health.push(
      b.kind === 'core'
        ? { side: b.side, core: b.player, hp, remaining: hp, fellTick: null }
        : { side: b.side, building: b.id, hp },
    );
  }
  assertStrengthBounds(teams, content, simConfig, options.sideOptions, 0);
  const maxLevel = overloadLevel(simConfig.maxBattleTicks, simConfig);
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
        if (tier !== undefined) {
          turretDamageOf(team, tier.damage, simConfig.minModifierSumPercent);
        }
      }
    }
  }
  const producers: ProducerSim[] = [];
  for (const b of arena.buildings) {
    if (b.kind === 'unit_producer') {
      const placed = teams[b.side]?.buildings.find((x) => x.id === b.id);
      const def = placed && content.buildings.get(placed.def);
      const costs = placed && def && costEntries(def, placed.tier);
      producers.push({
        side: b.side,
        building: b.id,
        progress: 0,
        ...(costs === undefined ? {} : { counters: costs.map(() => 0) }),
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
  const hasBursts =
    given !== undefined &&
    [given[0], given[1]].some((o) => (o?.bursts?.length ?? 0) > 0);
  const linkedPools: LinkedPoolSim[] = [];
  for (const side of [0, 1] as const) {
    if (given?.[side]?.linkedCores !== true) continue;
    let hp = 0;
    for (const h of health) {
      if (isCoreHealth(h) && h.side === side) hp = addInt(hp, h.hp);
    }
    linkedPools.push({ side, hp, remaining: hp });
  }
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
    ...(hasBursts ? { bursting: [] } : {}),
    ...(linkedPools.length > 0 ? { linkedPools } : {}),
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
  fly?: { x: number; y: number },
): number {
  const n = ctx.arena.coreRef[1 - side]?.length ?? 0;
  const opp = n - 1 - owner;
  if (coreAlive(ctx.arena, side, opp)) return opp;
  if (fly !== undefined) {
    return bestCore(ctx, side, owner, (q) =>
      flyRank(ctx, side, q, fly.x, fly.y),
    );
  }
  return bestCore(ctx, side, owner, (q) => cellRank(ctx, side, q, k));
}

/**
 * A flying unit's rank for the enemy Core `core` (CB-16c): class 0 and the
 * straight-line squared distance from the point `(x, y)` to the Core's
 * nearest cell. Terrain, walls and the ground fields play no part.
 */
function flyRank(
  ctx: ArenaContext,
  side: number,
  core: number,
  x: number,
  y: number,
): { cls: number; d: number } {
  const ref = ctx.arena.coreRef[1 - side]?.[core] ?? -1;
  const b = ref >= 0 ? ctx.arena.buildings[ref] : undefined;
  return { cls: 0, d: b === undefined ? 0 : buildingDist2(x, y, b) };
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

/** A unit's armor: its own (issue #426) or its definition's. */
function armorOf(ctx: ArenaContext, unit: UnitSim): number {
  return unit.armor ?? defOf(ctx, unit).armor;
}

/** A unit's splash: its definition's radius with its own percent if it has one (issue #426). */
function splashOf(
  ctx: ArenaContext,
  unit: UnitSim,
): { readonly radiusSub: number; readonly percent: number } | undefined {
  const sp = defOf(ctx, unit).splash;
  if (sp === undefined || unit.splashPercent === undefined) return sp;
  return { radiusSub: sp.radiusSub, percent: unit.splashPercent };
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
  ctx.bySide[2] = g32(ctx.bySide[2] ?? new Int32Array(0));
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
  const hitBy = new Float64Array(3 * size);
  hitBy.set(ctx.hitBy);
  ctx.hitBy = hitBy;
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
  const slot = u.side === 0 ? 0 : u.side === 1 ? 1 : 2;
  if (list !== undefined) {
    list[ctx.sideCount[slot]] = i;
    ctx.sideCount[slot] += 1;
  }
}

/** Rebuild the per-side cell grid of the units (start of the Production step). */
function buildUnitGrid(sim: ArenaSim, ctx: ArenaContext): void {
  ensureUnitCapacity(ctx, sim.units.length + 16);
  ctx.heads[0]?.fill(-1);
  ctx.heads[1]?.fill(-1);
  ctx.heads[2]?.fill(-1);
  ctx.sideCount[0] = 0;
  ctx.sideCount[1] = 0;
  ctx.sideCount[2] = 0;
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
  const sign = side === 1 ? -1 : 1; // the neutral side 2 uses side 0's frame
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
  fly: boolean,
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
      // A flyer may leave onto any cell, ranked by straight-line distance.
      if (!fly && !openFor(arena, side, k)) continue;
      const { cls, d } = fly
        ? flyRank(ctx, side, core, x * S + S / 2, y * S + S / 2)
        : cellRank(ctx, side, core, k);
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

/**
 * Intake (PP-6): take items from `building`'s input buffers, input by input
 * in their order, at most `need` in all; returns how many were taken. A
 * building that is not a consumer of the board takes nothing.
 */
function intake(board: BoardSim, building: number, need: number): number {
  const consumer = board.consumers.find((c) => c.building === building);
  if (consumer === undefined) return 0;
  let taken = 0;
  for (const input of consumer.inputs) {
    const n = Math.min(input.count, need - taken);
    if (n > 0 && takeFromBuffer(board, building, input.side, n)) taken += n;
  }
  return taken;
}

/**
 * Step 2: unit producers take their inputs and spawn, then scheduled waves
 * are queued and enter. The unit grid is current when this runs.
 */
function produce(sim: ArenaSim, ctx: ArenaContext, tick: number): void {
  for (const p of sim.producers) {
    const info = ctx.producers.get(bkey(p.side, p.building));
    const board = sim.boards[p.side === 0 ? 0 : 1];
    if (info === undefined) continue;
    // A producer holding units of a finished production (CB-13a) spawns them
    // as room appears, before it takes anything for the next one.
    let held = p.held ?? 0;
    // Intake (PP-6): at most `cost - progress` items, so `progress` never
    // exceeds the cost. A producer holding a finished unit takes nothing: its
    // buffers fill and its conduits back up.
    // A two-input producer (CB-5e) keeps one counter per resource and takes
    // each input's items into its own resource's counter.
    const counters = info.costs === undefined ? undefined : p.counters;
    if (held === 0) {
      if (info.costs !== undefined && counters !== undefined) {
        intakeByResource(board, p.building, info.costs, counters);
        p.progress = counters.reduce((a, n) => a + n, 0);
      } else if (p.progress < info.cost) {
        p.progress += intake(board, p.building, info.cost - p.progress);
      }
      // A production starts only when the cost is there (every counter full)
      // and the cooldown is over.
      if (p.progress < info.cost || p.cooldown > 0) continue;
    }
    const unitDef = ctx.content.units.get(info.unit);
    if (unitDef === undefined) throw new Error(`Unknown unit "${info.unit}".`);
    const producer = ctx.arena.buildings[info.ref];
    if (producer === undefined) continue;
    const fly = unitDef.flying;
    // The target Core: the opposite one if it stands (the spawn cells are
    // ordered by its fields), else the nearest by the first spawn cell.
    const owner = info.owner;
    const target = exitTarget(ctx, p.side, owner, info.ref, producer, fly);
    const cells = spawnCells(ctx, p.side, target, info.ref, producer, fly);
    // The units one after another, each at the first free position (the unit
    // before it is already in the grid). With no room for the first unit of a
    // new production nothing is consumed and nothing starts (held as before).
    for (;;) {
      const pos = spawnPosition(sim, ctx, p.side, cells, unitDef);
      if (pos === null) break; // held: no free position at the exit
      if (held === 0) {
        p.progress = 0;
        counters?.fill(0);
        p.cooldown = info.interval;
        held = info.units;
      }
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
      held -= 1;
      if (held === 0) break;
    }
    if (held > 0) p.held = held;
    else delete p.held;
  }
  enterBursts(sim, ctx, tick);
  queueWaves(sim, tick);
  enterWaves(sim, ctx, tick);
}

/**
 * The enemy Core a unit leaving building `ref` (`owner`'s plot) heads for: the
 * opposite one if it stands, else the nearest by the first spawn cell.
 */
function exitTarget(
  ctx: ArenaContext,
  side: number,
  owner: number,
  ref: number,
  building: ArenaBuilding,
  fly: boolean,
): number {
  const gw = ctx.arena.geom.width;
  const n = ctx.arena.coreRef[1 - side]?.length ?? 0;
  const opp = n - 1 - owner;
  if (coreAlive(ctx.arena, side, opp)) return opp;
  return bestCore(ctx, side, owner, (q) => {
    const first = spawnCells(ctx, side, q, ref, building, fly)[0];
    if (first === undefined) return null;
    return fly
      ? flyRank(
          ctx,
          side,
          q,
          (first % gw) * S + S / 2,
          divFloor(first, gw) * S + S / 2,
        )
      : cellRank(ctx, side, q, first);
  });
}

/**
 * Burst units (side options), after the unit producers: walk the `bursting`
 * queue once in order. A unit leaves its Core like a producer's unit does:
 * its target, spawn cells and position are those of `produce` with the Core as
 * the building and the Core's plot as owner; it has no producer and no ramp
 * bonus. With no free position it stays in the queue, in its place.
 */
function enterBursts(sim: ArenaSim, ctx: ArenaContext, tick: number): void {
  const queue = sim.bursting;
  if (queue === undefined || queue.length === 0) return;
  const rest: BurstingSim[] = [];
  for (const e of queue) {
    const unitDef = ctx.content.units.get(e.unit);
    if (unitDef === undefined) throw new Error(`Unknown unit "${e.unit}".`);
    const ref = ctx.arena.coreRef[e.side]?.[e.core] ?? -1;
    const core = ref >= 0 ? ctx.arena.buildings[ref] : undefined;
    if (core === undefined) continue; // no such Core: nothing to release from
    const fly = unitDef.flying;
    const target = exitTarget(ctx, e.side, e.core, ref, core, fly);
    const cells = spawnCells(ctx, e.side, target, ref, core, fly);
    const pos = spawnPosition(sim, ctx, e.side, cells, unitDef);
    if (pos === null) {
      rest.push(e);
      continue;
    }
    addUnit(
      sim,
      ctx,
      e.side,
      unitDef,
      pos.x,
      pos.y,
      0,
      tick,
      { owner: e.core, target },
      null,
    );
  }
  sim.bursting = rest;
}

/**
 * The side's point bonus (CB-8g): the `strengthPercent` of every `unit_strength`
 * point the side holds now, summed and capped at `maxPointStrengthPercent`.
 * 0 for a battle without points. Read at the moment of a spawn.
 */
export function pointStrengthBonus(sim: ArenaSim, side: number): number {
  const points = sim.points;
  if (points === undefined || sim.guards === undefined) return 0;
  let sum = 0;
  for (const p of points) {
    if (p.controller === side && p.buff?.kind === 'unit_strength') {
      sum += p.buff.strengthPercent;
    }
  }
  return Math.min(sum, sim.guards.maxPointStrengthPercent);
}

/**
 * The strength percent a unit of `side` spawned now gets: the ramp bonus of
 * the player who owns its producer (`owner`; `null` for a scheduled-wave unit,
 * which has no owner and gets none) plus the side-wide base (PP-8) plus the
 * side's point bonus (CB-8g; the side's, so a wave unit gets it too, and
 * outside the Armory cap).
 */
function spawnStrength(
  sim: ArenaSim,
  ctx: ArenaContext,
  side: number,
  owner: number | null,
  unitId: string,
): number {
  return (
    (owner === null ? 0 : rampBonus(sim, ctx, side, 'unit_strength', owner)) +
    (sim.sideOptions?.[side === 0 ? 0 : 1]?.unitStrengthPercent ?? 0) +
    pointStrengthBonus(sim, side) +
    unitStrengthPercent(
      sim.teams[side === 0 ? 0 : 1],
      unitId,
      ctx.simConfig.minModifierSumPercent,
    )
  );
}

/**
 * The fields a unit spawns with that the side's combat modifiers change
 * (issues #424 and #426): the cooldowns, the armor and the splash percent,
 * each only when it differs from the definition; none when nothing changes.
 */
function modifierFields(
  sim: ArenaSim,
  side: number,
  def: UnitDef,
): {
  moveCooldownTicks?: number;
  attackCooldownTicks?: number;
  armor?: number;
  splashPercent?: number;
} {
  const team = sim.teams[side === 0 ? 0 : 1];
  const stats = unitStats(
    side,
    def,
    0,
    100,
    unitSpeedPercent(team, 'unit_move_speed_percent', def.id),
    unitSpeedPercent(team, 'unit_attack_speed_percent', def.id),
    unitArmorBonus(team, def.id),
    unitSplashPercent(team, def.id),
  );
  return {
    ...(stats.armor === def.armor ? {} : { armor: stats.armor }),
    ...(stats.splash === undefined ||
    def.splash === undefined ||
    stats.splash.percent === def.splash.percent
      ? {}
      : { splashPercent: stats.splash.percent }),
    ...(stats.moveCooldownTicks === def.moveCooldownTicks
      ? {}
      : { moveCooldownTicks: stats.moveCooldownTicks }),
    ...(stats.attackCooldownTicks === def.attackCooldownTicks
      ? {}
      : { attackCooldownTicks: stats.attackCooldownTicks }),
  };
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
  healthPercent = 100,
): void {
  const stats = unitStats(
    side,
    unitDef,
    spawnStrength(sim, ctx, side, rampOwner, unitDef.id),
    healthPercent,
  );
  const unit: UnitSim = {
    id: sim.nextUnitId,
    side,
    def: unitDef.id,
    px,
    py,
    hp: stats.health,
    maxHp: stats.health,
    damage: stats.damage,
    attackCooldown: 0,
    ...modifierFields(sim, side, unitDef),
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
  const plotWidth = sim.teams[0].map.plotWidth;
  for (const side of [0, 1] as const) {
    const waves = options[side].scheduledWaves;
    if (waves === undefined) continue;
    waves.forEach((w, j) => {
      if (w.tick !== tick) return;
      for (let i = 0; i < w.count; i++) {
        // Focus: the same spread, inside the plot's columns only.
        const span = w.plot === undefined ? width : plotWidth;
        const col =
          (w.plot === undefined ? 0 : w.plot * plotWidth) +
          modFloor(
            divFloor((2 * i + 1) * span, 2 * w.count) + WAVE_START_STRIDE * j,
            span,
          );
        sim.entering.push({
          side,
          unit: w.unit,
          col,
          ...(w.plot === undefined ? {} : { plot: w.plot }),
          ...(w.healthPercent === undefined
            ? {}
            : { healthPercent: w.healthPercent }),
        });
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
    // The shortcut key: the radius and the plot (+1; 0 is the whole width). A
    // failure on the whole width also fails every plot.
    const failKey = unitDef.collisionRadius * 128 + (e.plot ?? -1) + 1;
    if (
      failedHere?.includes(failKey) === true ||
      failedHere?.includes(unitDef.collisionRadius * 128) === true
    ) {
      rest.push(e);
      continue;
    }
    const row = side === 0 ? boardHeight - 1 : height - boardHeight;
    let pos: { x: number; y: number } | null = null;
    let used = 0;
    const plotWidth = sim.teams[side === 0 ? 0 : 1].map.plotWidth;
    const lo = e.plot === undefined ? 0 : e.plot * plotWidth;
    const hi = e.plot === undefined ? width : lo + plotWidth;
    for (let d = 0; d < hi - lo && pos === null; d++) {
      for (const c of d === 0 ? [e.col] : [e.col - d, e.col + d]) {
        if (c < lo || c >= hi) continue;
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
      if (side === 0) (failed0 ??= []).push(failKey);
      else (failed1 ??= []).push(failKey);
    } else {
      // PP-11: the owner is the plot of the column it entered on; the target
      // is chosen from the entry cell.
      const owner = divFloor(used, sim.teams[side === 0 ? 0 : 1].map.plotWidth);
      const target = chooseTarget(
        ctx,
        side,
        owner,
        cellAt(ctx, side, pos),
        unitDef.flying ? pos : undefined,
      );
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
        e.healthPercent,
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
    t.charge += intake(board, t.building, info.costPerShot - t.charge);
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
    if (!board.consumers.some((c) => c.building === r.building)) continue;
    r.charge += intake(board, r.building, info.costPerStep - r.charge);
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
 * `rangeCells` cells. A tier with `minRangeCells` ignores a unit whose centre's
 * squared distance to the nearest cell is below `(minRangeCells * CELL_UNITS)^2`
 * (CB-18b). Nearest: smallest such squared distance; ties by lowest unit ID.
 * Damage joins the pending damage, and so does the tier's splash (CB-18b).
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
      // Turrets do not shoot neutral guards (CB-8e).
      if (u === undefined || u.side === t.side || u.side === 2) continue;
      const row = ownCellCoord(t.side, u.py, geom.height);
      if (row < rowLo || row > rowHi) continue;
      const d = buildingDist2(u.px, u.py, turret);
      // The blind spot (CB-18b): the centre is closer than the minimum range.
      if (d < info.minRangeSub * info.minRangeSub) continue;
      const reach = info.rangeCells * S + (ctx.brad[i] ?? 0);
      if (d <= reach * reach && d < bestD) {
        best = i;
        bestD = d; // units are in ID order, so a tie keeps the lower ID
      }
    }
    const target = best >= 0 ? units[best] : undefined;
    if (target === undefined) continue;
    t.charge = 0;
    t.cooldown = info.cooldownTicks;
    const dealt = armorHit(info.damage, armorOf(ctx, target));
    ctx.unitDamage[best] = addDamage(ctx.unitDamage[best] ?? 0, dealt);
    // Splash (CB-18b) by the rule of CB-5h, from the same snapshot: the
    // percent of the shot's damage (before armor) with a minimum of 1, then
    // each unit's own armor, summed into this tick's damage.
    const splash =
      info.splash === undefined
        ? undefined
        : splashHits(
            ctx,
            units,
            t.side,
            target,
            best,
            info.damage,
            info.splash,
            1,
          );
    ctx.events?.push({
      tick,
      type: 'turret_fired',
      side: t.side,
      building: t.building,
      unit: target.id,
      damage: dealt,
      ...(splash === undefined ? {} : { splash }),
    });
  }
}

/** What `placeGuards` needs: the posts, the leash and the guards to place. */
export interface GuardSetup {
  readonly leashCells: number;
  /** How units divert to the points and capture them (`content.points.capture`). */
  readonly capture: CaptureConfig;
  /** The points of interest as arena cells, sorted by `id`. */
  readonly posts: readonly GuardPost[];
  /** `content.points.maxPointStrengthPercent` (CB-8g); absent: 0. */
  readonly maxPointStrengthPercent?: number;
  /** The guards of each point, in point `id` order (`planGuards`). */
  readonly plans: readonly GuardPlan[];
}

/**
 * The cells a guard of a point is tried in, as offsets from the point cell:
 * the cell itself, then its 8 neighbours N, E, S, W, NE, SE, SW, NW (north is
 * towards larger `y`, as everywhere in the rules).
 */
const GUARD_CELLS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
];

/**
 * The most the points can add to a side's units (CB-8g): the sum of every
 * `unit_strength` point of the zone (any side may hold all of them), capped.
 * The largest strength a unit can then reach must stay within the stat bounds,
 * so a battle that could overflow is refused at tick 0, not mid-battle.
 */
function assertPointStrengthWithinBounds(
  sim: ArenaSim,
  ctx: ArenaContext,
): void {
  const points = sim.points;
  const guards = sim.guards;
  if (points === undefined || guards === undefined) return;
  let sum = 0;
  for (const p of points) {
    if (p.buff?.kind === 'unit_strength') sum += p.buff.strengthPercent;
  }
  const pointMax = Math.min(sum, guards.maxPointStrengthPercent);
  if (pointMax === 0) return;
  assertStrengthBounds(
    sim.teams,
    ctx.content,
    ctx.simConfig,
    sim.sideOptions,
    pointMax,
  );
}

/**
 * Tick 0, before the first tick (CB-8e, "Spawning"): record the posts and the
 * leash in the state and place the neutral guards, point by point in the
 * order of `plans`, each guard in its plan's order, taking the next unit IDs.
 * A guard goes to the first cell of `GUARD_CELLS` (relative to its point)
 * that is inside the zone's rows, not blocked, and has a free position (the
 * fit and overlap test of a producer's spawn, `firstFreeIn`), at the first
 * free position of that cell; a guard with no room anywhere is not placed.
 * Records `guard_spawned` for each. Guards are not counted in `spawned`.
 */
export function placeGuards(
  sim: ArenaSim,
  ctx: ArenaContext,
  setup: GuardSetup,
  tick = 0,
): void {
  sim.guards = {
    leashCells: setup.leashCells,
    capture: { ...setup.capture },
    posts: setup.posts.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      ...(p.buff === undefined ? {} : { buff: { ...p.buff } }),
    })),
    killed: [0, 0],
    lostToGuards: [0, 0],
    maxPointStrengthPercent: setup.maxPointStrengthPercent ?? 0,
    healed: [0, 0],
  };
  // Every point starts uncontrolled with no progress (CB-8f).
  sim.points = setup.posts.map((p) => ({
    id: p.id,
    controller: -1,
    progressSide: -1,
    progress: 0,
    held: [0, 0],
    ...(p.buff === undefined ? {} : { buff: { ...p.buff } }),
  }));
  assertPointStrengthWithinBounds(sim, ctx);
  if (setup.plans.length === 0) return;
  const { width, boardHeight, gapRows } = ctx.arena.geom;
  buildUnitGrid(sim, ctx);
  for (const plan of setup.plans) {
    const post = sim.guards.posts.find((p) => p.id === plan.point);
    if (post === undefined) {
      throw new Error(`placeGuards: no post for point ${String(plan.point)}.`);
    }
    for (const g of plan.guards) {
      const def = ctx.content.units.get(g.unit);
      if (def === undefined) throw new Error(`Unknown unit "${g.unit}".`);
      let pos: { x: number; y: number } | null = null;
      for (const [dx, dy] of GUARD_CELLS) {
        const cx = post.x + dx;
        const cy = post.y + dy;
        if (cx < 0 || cx >= width) continue;
        if (cy < boardHeight || cy >= boardHeight + gapRows) continue;
        if (ctx.world.solid[2]?.[cy * width + cx] === 1) continue;
        pos = freeInCell(sim, ctx, 2, def, cx, cy);
        if (pos !== null) break;
      }
      if (pos === null) continue;
      const unit = addGuard(
        sim,
        ctx,
        def,
        pos.x,
        pos.y,
        post.id,
        g.strengthPercent,
      );
      ctx.events?.push({
        tick,
        type: 'guard_spawned',
        unit: unit.id,
        point: post.id,
        def: unit.def,
        px: unit.px,
        py: unit.py,
      });
    }
  }
}

/** Create a guard unit (side 2, no owner, no target) and link it into the grid. */
function addGuard(
  sim: ArenaSim,
  ctx: ArenaContext,
  def: UnitDef,
  px: number,
  py: number,
  post: number,
  strengthPercent: number,
): UnitSim {
  const stats = unitStats(2, def, strengthPercent);
  const unit: UnitSim = {
    id: sim.nextUnitId,
    side: 2,
    def: def.id,
    px,
    py,
    hp: stats.health,
    maxHp: stats.health,
    damage: stats.damage,
    attackCooldown: 0,
    owner: -1,
    target: -1,
    post,
  };
  sim.nextUnitId += 1;
  sim.units.push(unit);
  const index = sim.units.length - 1;
  ensureUnitCapacity(ctx, index + 1 + 16);
  linkUnit(ctx, index, unit, def);
  return unit;
}

/**
 * Put a neutral guard of the point `post` on the map (tests and scenarios), at
 * the centre of arena cell `(x, y)` or at `(px, py)` (sub-cell units), with
 * `strengthPercent` extra health and damage. Throws if its circle does not
 * fit for guards (inside the zone's rows, not blocked) or overlaps a living
 * unit (unless `allowOverlap`). Emits no event and counts nothing.
 */
export function spawnGuardForTest(
  sim: ArenaSim,
  ctx: ArenaContext,
  args: {
    def: UnitId;
    post: number;
    x?: number;
    y?: number;
    px?: number;
    py?: number;
    strengthPercent?: number;
    allowOverlap?: boolean;
  },
): UnitSim {
  const def = ctx.content.units.get(args.def);
  if (def === undefined) throw new Error(`Unknown unit "${args.def}".`);
  const px = args.px ?? (args.x === undefined ? undefined : args.x * S + S / 2);
  const py = args.py ?? (args.y === undefined ? undefined : args.y * S + S / 2);
  if (px === undefined || py === undefined) {
    throw new Error('spawnGuardForTest: give x and y or px and py.');
  }
  if (sim.guards?.posts.some((p) => p.id === args.post) !== true) {
    throw new Error(`spawnGuardForTest: no post ${String(args.post)}.`);
  }
  if (!fits(ctx.world, 2, def.collisionRadius, px, py)) {
    throw new Error(
      `spawnGuardForTest: (${String(px)}, ${String(py)}) is not open.`,
    );
  }
  for (const e of args.allowOverlap === true ? [] : sim.units) {
    const other = ctx.content.units.get(e.def);
    if (other?.flying !== def.flying) continue;
    const rr = def.collisionRadius + other.collisionRadius;
    const dx = e.px - px;
    const dy = e.py - py;
    if (dx * dx + dy * dy < rr * rr) {
      throw new Error(
        `spawnGuardForTest: (${String(px)}, ${String(py)}) overlaps unit ${String(e.id)}.`,
      );
    }
  }
  return addGuard(sim, ctx, def, px, py, args.post, args.strengthPercent ?? 0);
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
    const rr = def.collisionRadius + other.collisionRadius;
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
    spawnStrength(sim, ctx, args.side, owner, def.id),
  );
  const unit: UnitSim = {
    id: sim.nextUnitId,
    side: args.side,
    def: def.id,
    px,
    py,
    hp: stats.health,
    maxHp: stats.health,
    damage: stats.damage,
    attackCooldown: 0,
    ...modifierFields(sim, args.side, def),
    owner,
    target:
      args.target ??
      chooseTarget(
        ctx,
        args.side,
        owner,
        k,
        def.flying ? { x: px, y: py } : undefined,
      ),
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
 * The sides whose units are enemies of a unit of each side (CB-8e): a side's
 * enemies are the other side and the neutral guards; a guard's enemies are
 * both sides.
 */
const ENEMY_SIDES: readonly (readonly number[])[] = [
  [1, 2],
  [0, 2],
  [0, 1],
];

/**
 * Index of the enemy unit in contact with `u` (the gap between the circles is
 * at most `reach`) that is nearest by squared centre distance, ties by lowest
 * unit ID; -1 if none. The enemies are the units of the other side and the
 * neutral guards (a guard's: both sides).
 */
function nearestContact(
  sim: ArenaSim,
  ctx: ArenaContext,
  u: UnitSim,
  def: UnitDef,
): number {
  const { width, height } = ctx.arena.geom;
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
  for (const es of ENEMY_SIDES[u.side] ?? []) {
    const few = ctx.sideCount[es] ?? 0;
    if (few === 0) continue;
    if (few <= FEW_UNITS) {
      // Few enemies: look at all of them (the same result as the cell search).
      const list = ctx.bySide[es];
      for (let q = 0; q < few; q++) {
        const j = list?.[q] ?? -1;
        const e = j >= 0 ? sim.units[j] : undefined;
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
      continue;
    }
    if (!anyPresent(ctx, es, x0, y0, x1, y1)) continue;
    const heads = ctx.heads[es];
    if (heads === undefined) continue;
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
 * centre distance, ties by lowest unit ID); -1 if none. The enemies are as in
 * `nearestContact`.
 */
function nearestVisible(
  sim: ArenaSim,
  ctx: ArenaContext,
  u: UnitSim,
  def: UnitDef,
): number {
  const { width, height } = ctx.arena.geom;
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
  for (const es of ENEMY_SIDES[u.side] ?? []) {
    const few = ctx.sideCount[es] ?? 0;
    if (few === 0) continue;
    if (few <= FEW_UNITS) {
      const list = ctx.bySide[es];
      for (let q = 0; q < few; q++) {
        const j = list?.[q] ?? -1;
        const e = j >= 0 ? sim.units[j] : undefined;
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
      continue;
    }
    if (!anyPresent(ctx, es, x0, y0, x1, y1)) continue;
    const heads = ctx.heads[es];
    if (heads === undefined) continue;
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
  // A guard beyond its leash drops its target and walks back (CB-8e).
  if (u.side === 2 && guardLeashed(sim, u)) return;
  const j = nearestContact(sim, ctx, u, defOf(ctx, u));
  if (j >= 0) {
    ctx.action[i] = ACT_UNIT;
    ctx.arg[i] = j;
    ctx.holds[i] = 1;
  }
}

const EMPTY_BUILDINGS: readonly ArenaBuilding[] = [];

/** The post of neutral guard `u` (CB-8e), or undefined when it has none. */
function postOf(sim: ArenaSim, u: UnitSim): GuardPost | undefined {
  return sim.guards?.posts.find((p) => p.id === u.post);
}

/**
 * Whether guard `u` is more than `leashCells` from its post's centre
 * (squared distance above `(leashCells * CELL_UNITS)^2`, CB-8e).
 */
function guardLeashed(sim: ArenaSim, u: UnitSim): boolean {
  const post = postOf(sim, u);
  if (post === undefined || sim.guards === undefined) return false;
  const dx = u.px - (post.x * S + S / 2);
  const dy = u.py - (post.y * S + S / 2);
  const lim = sim.guards.leashCells * S;
  return dx * dx + dy * dy > lim * lim;
}

/** The movement field to the cell of `post`, built once and cached. */
function postFieldFor(ctx: ArenaContext, post: GuardPost): Field {
  let f = ctx.postFields.get(post.id);
  if (f === undefined) {
    f = computeCellField(ctx.arena, 2, post.y * ctx.arena.geom.width + post.x);
    ctx.postFields.set(post.id, f);
  }
  return f;
}

/**
 * Decision pass 3 for a guard with nothing to fight (CB-8e, "Hold"): inside
 * the 3x3 cells around its post's cell (where guards are placed) it stays;
 * outside, it walks back along the movement field to the post's cell, or
 * straight at the post's centre when the field has no route from its cell.
 */
function guardWalkHome(
  sim: ArenaSim,
  ctx: ArenaContext,
  i: number,
  u: UnitSim,
): void {
  const post = postOf(sim, u);
  if (post === undefined) return;
  const { width, height } = ctx.arena.geom;
  const gx = cellCoord(u.px, width);
  const gy = cellCoord(u.py, height);
  if (Math.abs(gx - post.x) <= 1 && Math.abs(gy - post.y) <= 1) return;
  const cell = gy * width + gx;
  const field = postFieldFor(ctx, post);
  if ((field.dist[cell] ?? -1) > 0) {
    const k = fieldStep(ctx.arena, 2, field, cell);
    if (k >= 0) {
      moveAlong(
        sim,
        ctx,
        i,
        u,
        ((k % width) - gx) * S,
        (divFloor(k, width) - gy) * S,
      );
      return;
    }
  }
  const hx = post.x * S + S / 2 - u.px;
  const hy = post.y * S + S / 2 - u.py;
  if (hx !== 0 || hy !== 0) moveAlong(sim, ctx, i, u, hx, hy);
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
  if (u.side === 2) {
    // A guard fights units by the aggro rule only: it never aims at a
    // building or a Core, and a leashed guard has dropped its target (CB-8e).
    if (ctx.simConfig.aggroRangeCells > 0 && !guardLeashed(sim, u)) {
      const a = nearestVisible(sim, ctx, u, def);
      if (a >= 0) {
        ctx.action[i] = ACT_AGGRO;
        ctx.arg[i] = a;
      }
    }
    return;
  }
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
  // target key, `(|q - opposite(owner)|, -q)`. A Core shielded by pylons
  // (MM-9d) is not attacked: its standing pylons stand in its place, each
  // with the Core's key, the nearest one first.
  const cores = arena.coreRef[1 - u.side] ?? [];
  const opp = cores.length - 1 - u.owner;
  let best = -1;
  let bestRef = -1;
  let bestT = 0;
  let bestD = 0;
  let bestN = 0;
  for (let q = 0; q < cores.length; q++) {
    const t = q === u.target ? 0 : 1;
    const near = Math.abs(q - opp);
    const coreRef = cores[q] ?? -1;
    const coreB = coreRef >= 0 ? arena.buildings[coreRef] : undefined;
    if (coreB === undefined || !coreB.alive) continue;
    const group =
      arena.pylons.length === 0
        ? EMPTY_BUILDINGS
        : standingPylons(arena, 1 - u.side, q);
    const count = group.length === 0 ? 1 : group.length;
    for (let g = 0; g < count; g++) {
      const core = group.length === 0 ? coreB : (group[g] ?? coreB);
      const d = buildingDist2(u.px, u.py, core);
      if (d > reachR * reachR) continue;
      if (
        best < 0 ||
        t < bestT ||
        (t === bestT &&
          (d < bestD ||
            (d === bestD && (near < bestN || (near === bestN && q > best)))))
      ) {
        best = q;
        bestRef = core.ref;
        bestT = t;
        bestD = d;
        bestN = near;
      }
    }
  }
  if (best >= 0) {
    ctx.action[i] = ACT_BUILDING;
    ctx.arg[i] = bestRef;
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
      const frame = u.side === 1 ? -1 : 1;
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

/**
 * Move towards the centre of the cell of the unit's goal buildings (its target
 * Core, or that Core's standing pylons, MM-9d) that is nearest to the unit.
 */
function moveToCore(
  sim: ArenaSim,
  ctx: ArenaContext,
  i: number,
  u: UnitSim,
): void {
  const goals = goalBuildings(ctx.arena, u.side, u.target);
  if (goals.length === 0) return;
  let bx = 0;
  let by = 0;
  let bestD = Number.MAX_SAFE_INTEGER;
  // Ties go to the first cell in the unit's own frame: side 1 reads the
  // arena-ordered list (goal buildings by ref, each building's cells in
  // arena order) from the end.
  const cells = goals.flatMap((g) => g.cells);
  const n = cells.length;
  for (let q = 0; q < n; q++) {
    const c = cells[u.side === 0 ? q : n - 1 - q];
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
 * The index (in `sim.points`) of the point unit `u` of side 0 or 1 diverts to
 * (CB-8f), or -1: the nearest by squared centre distance (ties by the lowest
 * `id`) of the points whose controller is not the unit's side and whose cell
 * centre is within `pointAggroRangeCells` of the unit's centre, seen with the
 * cell-level line of sight of rule a2 (a flyer sees past solid cells).
 */
function divertPoint(
  sim: ArenaSim,
  ctx: ArenaContext,
  u: UnitSim,
  def: UnitDef,
): number {
  const points = sim.points;
  const posts = sim.guards?.posts;
  if (points === undefined || posts === undefined || sim.guards === undefined) {
    return -1;
  }
  const range = sim.guards.capture.pointAggroRangeCells * S;
  const range2 = range * range;
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    const post = posts[k];
    if (p === undefined || post === undefined || p.controller === u.side) {
      continue;
    }
    const cx = post.x * S + S / 2;
    const cy = post.y * S + S / 2;
    const dx = cx - u.px;
    const dy = cy - u.py;
    const d2 = dx * dx + dy * dy;
    if (d2 > range2 || (best >= 0 && d2 >= bestD)) continue;
    if (!def.flying && !lineClear(ctx, u.side, u.px, u.py, cx, cy)) continue;
    best = k;
    bestD = d2;
  }
  return best;
}

/**
 * The move of a unit diverted to the point with index `k` (CB-8f): within
 * `captureRadiusCells` of the point's centre it waits (no move); otherwise a
 * ground unit takes one step of the point's movement field from its cell (or
 * heads straight for the centre when that cell has no route), a flyer heads
 * straight for it.
 */
function moveToPoint(
  sim: ArenaSim,
  ctx: ArenaContext,
  i: number,
  u: UnitSim,
  def: UnitDef,
  k: number,
): void {
  const post = sim.guards?.posts[k];
  const rules = sim.guards?.capture;
  if (post === undefined || rules === undefined) return;
  const cx = post.x * S + S / 2;
  const cy = post.y * S + S / 2;
  const hx = cx - u.px;
  const hy = cy - u.py;
  const stop = rules.captureRadiusCells * S;
  if (hx * hx + hy * hy <= stop * stop) return;
  if (!def.flying) {
    const { width, height } = ctx.arena.geom;
    const cell =
      ownCellCoord(u.side, u.py, height) * width +
      ownCellCoord(u.side, u.px, width);
    const field = postFieldFor(ctx, post);
    if ((field.dist[cell] ?? -1) > 0) {
      const next = fieldStep(ctx.arena, u.side, field, cell);
      if (next >= 0) {
        moveAlong(
          sim,
          ctx,
          i,
          u,
          ((next % width) - (cell % width)) * S,
          (divFloor(next, width) - divFloor(cell, width)) * S,
        );
        return;
      }
    }
  }
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
    const j = ctx.arg[i] ?? -1;
    const e = j >= 0 ? sim.units[j] : undefined;
    ctx.action[i] = ACT_NONE;
    if (e === undefined) return;
    const hx = e.px - u.px;
    const hy = e.py - u.py;
    if (hx === 0 && hy === 0) moveTo(ctx, i, e.px, e.py);
    else moveAlong(sim, ctx, i, u, hx, hy);
    return;
  }
  if (act !== ACT_NONE) return;

  // A guard with nothing to fight holds or walks back (CB-8e).
  if (u.side === 2) {
    guardWalkHome(sim, ctx, i, u);
    return;
  }

  // A unit passing near a point its side does not hold diverts to it (CB-8f).
  if (sim.points !== undefined) {
    const k = divertPoint(sim, ctx, u, def);
    if (k >= 0) {
      moveToPoint(sim, ctx, i, u, def, k);
      return;
    }
  }

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
    goalRefs(ctx.arena, u.side, u.target),
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
  const b = ref >= 0 ? ctx.arena.buildings[ref] : undefined;
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
  // A pylon (MM-9d) also says which Core it shielded and how many remain; the
  // last one takes the shield down.
  const shielded = ctx.arena.pylons.find((p) => p.ref === ref);
  if (shielded !== undefined) {
    const standing = standingPylons(ctx.arena, b.side, shielded.core).length;
    ctx.events?.push({
      tick,
      type: 'pylon_destroyed',
      side: b.side,
      building: b.id,
      core: shielded.core,
      standing,
    });
    if (standing === 0) {
      ctx.events?.push({
        tick,
        type: 'core_shield_down',
        side: b.side,
        core: shielded.core,
      });
    }
  }
  const team = sim.teams[b.side === 0 ? 0 : 1];
  const open = new Set(brokenLinks(team, ctx.content).map((l) => l.sending));
  const lost = new Set(conduitsLostWith(team.conduits, b.id, open));
  for (const id of sortedInts(lost)) {
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
  // A destroyed refinery loses the items of its output store (CB-9a): one
  // `lost` event each, at the tick of destruction. (`rebuildFlow` counts them
  // in `retired.lost`.)
  const gone = sim.boards[b.side === 0 ? 0 : 1].refineries?.find(
    (r) => r.building === b.id,
  );
  if (gone !== undefined) {
    for (let i = 0; i < gone.store; i++) {
      ctx.events?.push({
        tick,
        type: 'lost',
        side: b.side,
        building: b.id,
        resource: gone.resource,
      });
    }
  }
  // The pair of a destroyed Tunnel end is gone for the rest of the battle;
  // the end that is left stands unpaired (CB-9g).
  const standing = (ctx.tunnels[b.side] ?? []).filter(
    (p) => p.entrance !== b.id && p.exit !== b.id,
  );
  ctx.tunnels[b.side] = standing;
  const { sim: board, plan } = rebuildFlow(
    sim.boards[b.side === 0 ? 0 : 1],
    newTeam,
    ctx.content,
    ctx.simConfig,
    standing,
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
 * Advance the battle by one tick, in place. Order: (0) the Overload level;
 * (1) flow on both boards; (2) the unit grid, production (unit producers,
 * then scheduled waves), turret and ramp charging; (3) decisions from a
 * snapshot, then
 * turret fire; (4) simultaneous attacks and the Overload Core decay, then
 * damage, then healing near held `heal` points; (5) moves and separation; (6) deaths and destruction; (7) cooldowns
 * and the tick counter.
 */
export function stepArena(sim: ArenaSim, ctx: ArenaContext): void {
  const tick = sim.tick;
  const cfg = ctx.simConfig;

  // 0. Overload level (derived from the tick; events on the ticks it rises).
  const level = overloadLevel(tick, cfg);
  const beat = isOverloadBeat(tick, cfg);
  if (beat) {
    if (level === 1) ctx.events?.push({ tick, type: 'overload_started' });
    ctx.events?.push({ tick, type: 'overload_level', level });
  }

  // 1. Flow.
  stepBothFlows(sim, ctx);

  // 2. Production (unit producers, then scheduled waves), then turret and
  // ramp charging. The per-side cell grid is rebuilt first; new units are
  // linked into it as they are placed.
  buildUnitGrid(sim, ctx);
  produce(sim, ctx, tick);
  chargeTurrets(sim, ctx);
  chargeRamps(sim, ctx, tick);

  // 3. Decide, from a snapshot. `units` stays this tick's list until step 6.
  const units = sim.units;
  decideAll(sim, ctx, units);
  fireTurrets(sim, ctx, tick);

  // 4. Resolve attacks simultaneously, with the Overload Core decay, then
  // apply the damage.
  resolveAttacks(sim, ctx, units, tick, level);
  if (beat) addOverloadDecay(sim, ctx, tick, level);
  applyDamage(sim, ctx, units, tick);
  healUnits(sim, tick);

  // 5. Move and separate.
  moveUnits(ctx, units);

  // 6. Deaths and destruction.
  removeDeadUnits(sim, ctx, units, tick);
  destroyFallenBuildings(sim, ctx, tick);
  stepPoints(sim, ctx, tick);

  // 7. Cooldowns, then the tick counter.
  tickCooldowns(sim);
  sim.tick += 1;
}

/** Step 1: each board's flow, side 0 then side 1, events tagged with the side. */
function stepBothFlows(sim: ArenaSim, ctx: ArenaContext): void {
  const events = ctx.events;
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
}

/** Step 3: every unit's contact, then aim, then move decision, in unit order. */
function decideAll(
  sim: ArenaSim,
  ctx: ArenaContext,
  units: readonly UnitSim[],
): void {
  const n = units.length;
  ensureUnitCapacity(ctx, n);
  ctx.unitDamage.fill(0, 0, n);
  ctx.hitBy.fill(0, 0, 3 * n);
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
}

/**
 * Step 4: every attack ready this tick, in unit order, is summed into the
 * damage tables (nothing is applied yet) and logged.
 */
function resolveAttacks(
  sim: ArenaSim,
  ctx: ArenaContext,
  units: readonly UnitSim[],
  tick: number,
  level: number,
): void {
  const events = ctx.events;
  const arena = ctx.arena;
  const cfg = ctx.simConfig;
  const n = units.length;
  ctx.buildingDamage.fill(0);
  ctx.attackDamage.fill(0);
  for (let i = 0; i < n; i++) {
    const u = units[i];
    const act = ctx.action[i] ?? ACT_NONE;
    if (u === undefined || (act !== ACT_UNIT && act !== ACT_BUILDING)) continue;
    if (u.attackCooldown > 0) continue; // holds position
    // Damage order (CB-5h): spawn damage, then Overload, then the splash
    // percent (secondary targets only), then each target's armor (only for a
    // hit on a unit).
    // Overload does not affect neutral guards (CB-8e).
    const hit =
      u.side === 2
        ? u.damage
        : mulPct(u.damage, 100 + level * cfg.overloadDamageStepPercent);
    let damage = hit;
    const arg = ctx.arg[i] ?? 0;
    let target: UnitTarget;
    let blocked = false;
    let splash: SplashHit[] | undefined;
    let centre: UnitSim | undefined;
    if (act === ACT_UNIT) {
      const t = units[arg];
      if (t === undefined) continue;
      damage = armorHit(hit, armorOf(ctx, t));
      hurtUnit(ctx, units, arg, damage, u.side);
      target = { kind: 'unit', unit: t.id };
      const sp = splashOf(ctx, u);
      if (sp !== undefined) {
        splash = splashHits(ctx, units, u.side, t, arg, hit, sp, 0);
        centre = t;
      }
    } else {
      const b = arena.buildings[arg];
      if (b === undefined) continue;
      // A Core shielded by a standing pylon (MM-9d) takes nothing.
      blocked =
        b.kind === 'core' &&
        arena.pylons.length > 0 &&
        standingPylons(arena, b.side, b.player).length > 0;
      if (!blocked) {
        ctx.buildingDamage[arg] = addDamage(
          ctx.buildingDamage[arg] ?? 0,
          damage,
        );
        ctx.attackDamage[arg] = addDamage(ctx.attackDamage[arg] ?? 0, damage);
      }
      target =
        b.kind === 'core'
          ? { kind: 'core', side: b.side, core: b.player }
          : { kind: 'building', side: b.side, building: b.id };
    }
    u.attackCooldown =
      u.attackCooldownTicks ?? defOf(ctx, u).attackCooldownTicks;
    const pool =
      target.kind === 'core' ? poolOf(sim, target.side)?.hp : undefined;
    events?.push({
      tick,
      type: 'unit_attacked',
      unit: u.id,
      target,
      damage,
      ...(pool === undefined ? {} : { pool }),
    });
    if (blocked && target.kind === 'core') {
      events?.push({
        tick,
        type: 'core_hit_blocked',
        unit: u.id,
        side: target.side,
        core: target.core,
        damage,
      });
    }
    if (splash !== undefined && centre !== undefined) {
      events?.push({
        tick,
        type: 'splash',
        attacker: u.id,
        x: centre.px,
        y: centre.py,
        targets: splash,
      });
    }
  }
}

/**
 * Add `amount` to the damage unit index `j` takes this tick; when the target
 * or the attacker is a neutral guard, also to the damage the attacker's side
 * (0, 1 or 2 for a guard) dealt to it (`ctx.hitBy`, for the kill counts of
 * CB-8e).
 */
function hurtUnit(
  ctx: ArenaContext,
  units: readonly UnitSim[],
  j: number,
  amount: number,
  attackerSide: number,
): void {
  ctx.unitDamage[j] = addDamage(ctx.unitDamage[j] ?? 0, amount);
  if (attackerSide === 2 || units[j]?.side === 2) {
    const k = 3 * j + attackerSide;
    ctx.hitBy[k] = addDamage(ctx.hitBy[k] ?? 0, amount);
  }
}

interface SplashHit {
  readonly unit: number;
  readonly damage: number;
}

/**
 * The secondary hits of one attack by a unit with `splash` on the unit at
 * index `arg` (CB-5h): every other unit of the opposing side whose centre is
 * within `radiusSub` of the target's centre (squared distance <= radiusSub^2)
 * takes `mulPct(hit, percent)` (skipped when that is 0), reduced by its own
 * armor, summed into this tick's damage. Found through the opposing side's
 * cell grid, returned in unit id order (the list is in id order, so index
 * order is id order).
 */
function splashHits(
  ctx: ArenaContext,
  units: readonly UnitSim[],
  attackerSide: number,
  primary: UnitSim,
  arg: number,
  hit: number,
  sp: { readonly radiusSub: number; readonly percent: number },
  minPart: number,
): SplashHit[] {
  const out: SplashHit[] = [];
  // A turret's splash is at least 1 (CB-18b); a unit's may be 0 and is then
  // skipped (`minPart` 0).
  const part = Math.max(minPart, mulPct(hit, sp.percent));
  if (part <= 0) return out;
  const { width, height } = ctx.arena.geom;
  const r2 = sp.radiusSub * sp.radiusSub;
  const gx0 = cellCoord(primary.px - sp.radiusSub, width);
  const gx1 = cellCoord(primary.px + sp.radiusSub, width);
  const gy0 = cellCoord(primary.py - sp.radiusSub, height);
  const gy1 = cellCoord(primary.py + sp.radiusSub, height);
  const found: number[] = [];
  // Every unit of an enemy side of the attacker (CB-8e: the other side and
  // the neutral guards).
  for (const es of ENEMY_SIDES[attackerSide] ?? []) {
    const heads = ctx.heads[es];
    if (heads === undefined) continue;
    for (let y = gy0; y <= gy1; y++) {
      for (let x = gx0; x <= gx1; x++) {
        let j = heads[y * width + x] ?? -1;
        while (j !== -1) {
          const e = units[j];
          if (e !== undefined && j !== arg) {
            const dx = e.px - primary.px;
            const dy = e.py - primary.py;
            if (dx * dx + dy * dy <= r2) found.push(j);
          }
          j = ctx.next[j] ?? -1;
        }
      }
    }
  }
  found.sort((a, b) => a - b);
  for (const j of found) {
    const e = units[j];
    if (e === undefined) continue;
    const dealt = armorHit(part, armorOf(ctx, e));
    hurtUnit(ctx, units, j, dealt, attackerSide);
    out.push({ unit: e.id, damage: dealt });
  }
  return out;
}

/** Step 4, on an Overload beat: every living Core takes the decay. */
function addOverloadDecay(
  sim: ArenaSim,
  ctx: ArenaContext,
  tick: number,
  level: number,
): void {
  const events = ctx.events;
  const arena = ctx.arena;
  const cfg = ctx.simConfig;
  const decay = level * cfg.overloadCoreDamageStep;
  // Every living Core takes the full amount: side 0 then side 1, players in
  // ascending order (PP-9).
  for (const side of [0, 1]) {
    // A linked side (MM-9d) takes the decay once, from the shared pool: it is
    // added to the lowest living Core, and step 4 sums the Cores' damage.
    const pool = poolOf(sim, side);
    let done = false;
    (arena.coreRef[side] ?? []).forEach((ref, core) => {
      if (ref < 0 || arena.buildings[ref]?.alive !== true) return;
      if (pool !== undefined && done) return;
      done = true;
      ctx.buildingDamage[ref] = addDamage(ctx.buildingDamage[ref] ?? 0, decay);
      events?.push({
        tick,
        type: 'overload_core_damage',
        side,
        core,
        damage: decay,
        ...(pool === undefined ? {} : { pool: pool.hp }),
      });
    });
  }
}

/** Step 4: apply the summed damage to units, then to buildings and Cores. */
function applyDamage(
  sim: ArenaSim,
  ctx: ArenaContext,
  units: readonly UnitSim[],
  tick: number,
): void {
  const before = sim.bursting === undefined ? undefined : coreHealths(sim);
  const n = units.length;
  for (let i = 0; i < n; i++) {
    const dmg = ctx.unitDamage[i] ?? 0;
    const u = units[i];
    if (dmg > 0 && u !== undefined) u.hp -= dmg;
  }
  // Linked Cores (MM-9d): their damage is summed per side, in Core order, and
  // taken from the shared pool below, once.
  const pooled: { dmg: number; attack: number }[] = [
    { dmg: 0, attack: 0 },
    { dmg: 0, attack: 0 },
  ];
  for (let r = 0; r < ctx.buildingDamage.length; r++) {
    const dmg = ctx.buildingDamage[r] ?? 0;
    if (dmg === 0) continue;
    const h = sim.health[ctx.healthIndex[r] ?? 0];
    if (h === undefined) continue;
    if (isCoreHealth(h) && poolOf(sim, h.side) !== undefined) {
      const acc = pooled[h.side === 0 ? 0 : 1];
      if (acc !== undefined) {
        acc.dmg = addDamage(acc.dmg, dmg);
        acc.attack = addDamage(acc.attack, ctx.attackDamage[r] ?? 0);
      }
      continue;
    }
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
      h.remaining = remaining;
    }
    h.hp = Math.max(0, remaining);
  }
  for (const side of [0, 1] as const) {
    const pool = poolOf(sim, side);
    const acc = pooled[side];
    if (pool === undefined || acc === undefined || acc.dmg === 0) continue;
    // Building damage dealt: the attacks alone, at most the pool's health.
    const applied = Math.min(acc.attack, pool.hp);
    if (applied > 0) {
      const dealer = side === 0 ? 1 : 0;
      sim.buildingDamageDealt[dealer] = addInt(
        sim.buildingDamageDealt[dealer],
        applied,
      );
    }
    pool.remaining = pool.hp - acc.dmg;
    pool.hp = Math.max(0, pool.remaining);
    if (pool.hp > 0) continue;
    // The pool is empty: every Core of the side falls in this tick. The first
    // living Core (lowest player index) carries the overkill, the others 0.
    let first = true;
    for (const h of sim.health) {
      if (!isCoreHealth(h) || h.side !== side || h.hp <= 0) continue;
      h.hp = 0;
      h.remaining = first ? pool.remaining : 0;
      const row = ctx.coreRemaining[side];
      if (row !== undefined) row[h.core] = h.remaining;
      first = false;
    }
  }
  if (before !== undefined) releaseBursts(sim, ctx, before, tick);
}

/** The shared pool of a side with `linkedCores`, or undefined. */
export function poolOf(
  sim: Pick<ArenaSim, 'linkedPools'>,
  side: number,
): LinkedPoolSim | undefined {
  return sim.linkedPools?.find((p) => p.side === side);
}

/** Every Core's current health, by side and player index. */
function coreHealths(sim: ArenaSim): number[][] {
  const out: number[][] = [[], []];
  for (const h of sim.health) {
    if (isCoreHealth(h)) (out[h.side] ??= [])[h.core] = h.hp;
  }
  return out;
}

/**
 * Step 4, after the damage (MM-9d): for each side with `bursts`, each Core in
 * player order, each threshold in the order the profile lists them (highest
 * first) whose line the Core crossed this tick releases its units: the line is
 * `floor(starting * threshold / 100)` with `starting` the Core's starting
 * health; crossed means its health before this tick's damage was above the
 * line and is now at or below it. A Core reduced to 0 has crossed every line
 * it was still above. The units join the `bursting` queue in release order
 * and spawn from the next tick on; one `burst_released` is logged per release.
 */
function releaseBursts(
  sim: ArenaSim,
  ctx: ArenaContext,
  before: readonly (readonly number[])[],
  tick: number,
): void {
  const queue = sim.bursting;
  if (queue === undefined) return;
  for (const side of [0, 1] as const) {
    const bursts = sim.sideOptions?.[side].bursts;
    if (bursts === undefined || bursts.length === 0) continue;
    const cores: number[] = [];
    for (const b of bursts) if (!cores.includes(b.core)) cores.push(b.core);
    cores.sort((a, b) => a - b);
    for (const core of cores) {
      const ref = ctx.arena.coreRef[side]?.[core] ?? -1;
      const h = sim.health[ctx.healthIndex[ref] ?? 0];
      if (ref < 0 || h === undefined) continue;
      const old = before[side]?.[core] ?? 0;
      const starting = ctx.maxHealth[ref] ?? 0;
      const thresholds: number[] = [];
      for (const b of bursts) {
        if (b.core === core && !thresholds.includes(b.thresholdPercent)) {
          thresholds.push(b.thresholdPercent);
        }
      }
      thresholds.sort((a, b) => b - a);
      for (const t of thresholds) {
        const line = divFloor(starting * t, 100);
        if (!(old > line && h.hp <= line)) continue;
        const units: { unit: UnitId; count: number }[] = [];
        for (const b of bursts) {
          if (b.core !== core || b.thresholdPercent !== t) continue;
          units.push({ unit: b.unit, count: b.count });
          for (let i = 0; i < b.count; i++) {
            queue.push({ side, core, unit: b.unit });
          }
        }
        ctx.events?.push({
          tick,
          type: 'burst_released',
          side,
          core,
          thresholdPercent: t,
          units,
        });
      }
    }
  }
}

/** Step 5: hand this tick's motion inputs to the solver and run it. */
function moveUnits(ctx: ArenaContext, units: readonly UnitSim[]): void {
  const cfg = ctx.simConfig;
  const n = units.length;
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u === undefined) continue;
    ctx.motion.rad[i] = ctx.crad[i] ?? 0;
    ctx.motion.fly[i] = ctx.fly[i] ?? 0;
    ctx.motion.fight[i] =
      ctx.action[i] === ACT_UNIT || ctx.action[i] === ACT_BUILDING ? 1 : 0;
    if (ctx.action[i] === ACT_MOVE) {
      ctx.motion.speed[i] =
        u.moveCooldownTicks === undefined
          ? unitSpeed(defOf(ctx, u))
          : divFloor(CELL_UNITS, u.moveCooldownTicks);
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
}

/** Step 6: units at 0 health or less die, in unit order. */
function removeDeadUnits(
  sim: ArenaSim,
  ctx: ArenaContext,
  units: readonly UnitSim[],
  tick: number,
): void {
  const events = ctx.events;
  let died = false;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined || u.hp > 0) continue;
    died = true;
    if (u.side === 2) {
      // A guard death is not a unit death of a side (CB-8e): it counts in
      // `guardsKilled` for the side whose units dealt it the most damage
      // this tick, for both sides on a tie.
      events?.push({ tick, type: 'unit_died', unit: u.id, side: 2 });
      const killed = sim.guards?.killed;
      const d0 = ctx.hitBy[3 * i] ?? 0;
      const d1 = ctx.hitBy[3 * i + 1] ?? 0;
      if (killed !== undefined) {
        if (d0 >= d1) killed[0] += 1;
        if (d1 >= d0) killed[1] += 1;
      }
      continue;
    }
    events?.push({ tick, type: 'unit_died', unit: u.id });
    const side = u.side === 0 ? 0 : 1;
    sim.unitsDied[side] += 1;
    // A unit the guards killed (they dealt more than the other side's units in
    // the tick it died) is a loss, but not a kill of the other side (CB-8e).
    const byGuards = ctx.hitBy[3 * i + 2] ?? 0;
    if (
      sim.guards !== undefined &&
      byGuards > 0 &&
      byGuards > (ctx.unitDamage[i] ?? 0) - byGuards
    ) {
      sim.guards.lostToGuards[side] += 1;
    }
  }
  if (died) sim.units = units.filter((u) => u.hp > 0);
}

/**
 * Step 6: buildings at 0 health are destroyed, in health-list order. When any
 * fell, every cache that depends on the buildings is dropped and units whose
 * target Core fell choose a new one.
 */
function destroyFallenBuildings(
  sim: ArenaSim,
  ctx: ArenaContext,
  tick: number,
): void {
  const events = ctx.events;
  const arena = ctx.arena;
  let destroyed = false;
  for (const h of sim.health) {
    if (h.hp > 0) continue;
    const ref = refOfHealth(arena, h);
    const b = ref >= 0 ? arena.buildings[ref] : undefined;
    if (b === undefined || !b.alive) continue;
    destroyBuilding(sim, ctx, ref, tick);
    if (isCoreHealth(h)) h.fellTick = tick;
    destroyed = true;
  }
  if (destroyed) {
    ctx.fields[0] = [];
    ctx.fields[1] = [];
    ctx.postFields.clear();
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
        ctx.content.units.get(u.def)?.flying === true
          ? { x: u.px, y: u.py }
          : undefined,
      );
      events?.push({
        tick,
        type: 'unit_retargeted',
        unit: u.id,
        target: u.target,
      });
    }
  }
}

/**
 * Step 6, after the deaths and the destruction (CB-8f): the capture progress
 * of every point, in `id` order, from the units that are alive now.
 *
 * 1. A point with a living guard changes nothing.
 * 2. Count the units of side 0 and of side 1 whose centre is within
 *    `captureRadiusCells` of the point's centre (flyers too).
 * 3. Both counts above 0 (contested): nothing changes.
 * 4. Exactly one side `s` in range and `s` is not the controller: if
 *    `progressSide` is not `s`, it becomes `s` with progress 0
 *    (`point_capture_started`); then `progress += min(count,
 *    maxCapturersCounted)`; at `captureTicks` `s` takes the point
 *    (`point_captured`), progress 0 and `progressSide` -1.
 * 5. Nobody in range: progress falls by 1 to 0, `progressSide` -1 at 0.
 *
 * Last, every point with a controller adds a tick to that side's `held`.
 */
function stepPoints(sim: ArenaSim, ctx: ArenaContext, tick: number): void {
  const points = sim.points;
  const guards = sim.guards;
  if (points === undefined || guards === undefined || points.length === 0) {
    return;
  }
  const rules = guards.capture;
  const radius = rules.captureRadiusCells * S;
  const radius2 = radius * radius;
  const n = points.length;
  // The take threshold of each side (issue #426): its capture speed modifiers
  // shorten it; the progress added per tick is unchanged.
  const need: [number, number] = [
    captureTicksFor(rules.captureTicks, captureSpeedPercent(sim.teams[0])),
    captureTicksFor(rules.captureTicks, captureSpeedPercent(sim.teams[1])),
  ];
  const near = new Array<number>(2 * n).fill(0);
  const guarded = new Array<number>(n).fill(0);
  for (const u of sim.units) {
    if (u.side === 2) {
      const k = points.findIndex((p) => p.id === u.post);
      if (k >= 0) guarded[k] = 1;
      continue;
    }
    for (let k = 0; k < n; k++) {
      const post = guards.posts[k];
      if (post === undefined) continue;
      const dx = post.x * S + S / 2 - u.px;
      const dy = post.y * S + S / 2 - u.py;
      if (dx * dx + dy * dy <= radius2) {
        const at = 2 * k + u.side;
        near[at] = (near[at] ?? 0) + 1;
      }
    }
  }
  for (let k = 0; k < n; k++) {
    const p = points[k];
    if (p === undefined) continue;
    if (guarded[k] !== 1) {
      const c0 = near[2 * k] ?? 0;
      const c1 = near[2 * k + 1] ?? 0;
      if (c0 === 0 && c1 === 0) {
        if (p.progress > 0) p.progress -= 1;
        if (p.progress === 0) p.progressSide = -1;
      } else if ((c0 === 0) !== (c1 === 0)) {
        const s = c0 > 0 ? 0 : 1;
        if (s !== p.controller) {
          if (p.progressSide !== s) {
            p.progressSide = s;
            p.progress = 0;
            ctx.events?.push({
              tick,
              type: 'point_capture_started',
              point: p.id,
              side: s,
            });
          }
          p.progress += Math.min(c0 + c1, rules.maxCapturersCounted);
          if (p.progress >= need[s === 0 ? 0 : 1]) {
            const previous = p.controller;
            p.controller = s;
            p.progress = 0;
            p.progressSide = -1;
            ctx.events?.push({
              tick,
              type: 'point_captured',
              point: p.id,
              side: s,
              previous,
            });
          }
        }
      }
    }
    if (p.controller === 0 || p.controller === 1) p.held[p.controller] += 1;
  }
}

/**
 * Step 4, after the damage (CB-8g): on a tick `T` where `T mod
 * healIntervalTicks = 0` for a `heal` point held by side 0 or 1, every living
 * unit of that side whose centre is within `healRadiusCells` of the point
 * regains `healAmount` health, never above `maxHp`. A unit near several
 * qualifying points of its side takes the largest `healAmount` once (healing
 * does not stack). Units at 0 health are not healed; guards, buildings and
 * Cores never are. The health gained is added to `guards.healed` of the side.
 */
function healUnits(sim: ArenaSim, tick: number): void {
  const points = sim.points;
  const guards = sim.guards;
  if (points === undefined || guards === undefined) return;
  const beats: { k: number; side: number; r2: number; amount: number }[] = [];
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    const buff = p?.buff;
    if (
      p === undefined ||
      buff?.kind !== 'heal' ||
      (p.controller !== 0 && p.controller !== 1) ||
      tick % buff.healIntervalTicks !== 0
    ) {
      continue;
    }
    const r = buff.healRadiusCells * S;
    beats.push({ k, side: p.controller, r2: r * r, amount: buff.healAmount });
  }
  if (beats.length === 0) return;
  for (const u of sim.units) {
    if (u.side === 2 || u.hp <= 0 || u.hp >= u.maxHp) continue;
    let best = 0;
    for (const b of beats) {
      if (b.side !== u.side || b.amount <= best) continue;
      const post = guards.posts[b.k];
      if (post === undefined) continue;
      const dx = post.x * S + S / 2 - u.px;
      const dy = post.y * S + S / 2 - u.py;
      if (dx * dx + dy * dy <= b.r2) best = b.amount;
    }
    if (best === 0) continue;
    const gain = Math.min(best, u.maxHp - u.hp);
    u.hp += gain;
    guards.healed[u.side === 0 ? 0 : 1] += gain;
  }
}

/** Step 7: every cooldown above zero goes down by one. */
function tickCooldowns(sim: ArenaSim): void {
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
