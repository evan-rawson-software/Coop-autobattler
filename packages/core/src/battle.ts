/**
 * A whole battle (W1-8, CB-8, CB-33): two boards, the neutral zone generated
 * between them from the battle seed, the arena simulation, the end conditions
 * and the result. See docs/rules-reference.md, "Battles". Side 0 is always the
 * party and side 1 the opponent (the defender, "the ghost").
 */

import type { ArenaContent } from './arena.js';
import {
  createArenaContext,
  createArenaSim,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
  type SideOptions,
} from './arena-sim.js';
import {
  generateNeutralZone,
  neutralZoneProblem,
  zoneBlockedCells,
  type NeutralZone,
} from './neutral-zone.js';
import { compareFractions } from './int.js';
import type { MapgenConfig } from './mapgen.js';
import type { SimConfig } from './sim-config.js';
import type { TeamState } from './team-state.js';

export type BattleReason =
  | 'core_destroyed'
  | 'tiebreak_overkill'
  | 'tiebreak_building_damage'
  | 'tiebreak_kills'
  | 'tiebreak_attacker'
  | 'time_limit';

export interface BattleResult {
  /** 0 = the party, 1 = the opponent. */
  readonly winner: 0 | 1;
  readonly reason: BattleReason;
  /** Ticks simulated; the last tick that ran has number `endTick - 1`. */
  readonly endTick: number;
}

export type BattleErrorCode =
  | 'party_size_mismatch'
  | 'board_size_mismatch'
  | 'core_not_placed'
  | 'several_cores'
  | 'invalid_zone';

export interface BattleError {
  readonly code: BattleErrorCode;
  readonly message: string;
  /** The side at fault, for `core_not_placed` and `several_cores`. */
  readonly side?: 0 | 1;
}

export interface BattleInput {
  /** Side 0, the party. */
  readonly teamA: TeamState;
  /** Side 1, the opponent. */
  readonly teamB: TeamState;
  /** The battle seed (CB-8a): the zone derives from it and the width only. */
  readonly seed: number;
  /**
   * General per-side arena options (waves, free power, strength, Core
   * health); used by PvE threats, absent for ghost battles.
   */
  readonly sideOptions?: readonly [
    SideOptions | null | undefined,
    SideOptions | null | undefined,
  ];
}

export interface BattleConfig {
  readonly sim: SimConfig;
  readonly mapgen: MapgenConfig;
}

/** Test-only switches. */
export interface BattleOptions {
  /**
   * Use this zone instead of generating one (for symmetric or empty zones in
   * tests). It must have the boards' width, satisfy the zone constraints and
   * is revealed as it is.
   */
  readonly zone?: NeutralZone;
}

export interface BattleSideSummary {
  readonly unitsSpawned: number;
  readonly unitsLost: number;
  /** Buildings destroyed, not counting the Core. */
  readonly buildingsLost: number;
  /** Core health at the end, clamped at 0. */
  readonly coreHealth: number;
  readonly coreMaxHealth: number;
  /** Damage beyond 0 that destroyed the Core (0 while it stands). */
  readonly coreOverkill: number;
  /** `ramp_step` events of this side over the battle. */
  readonly rampSteps: number;
  /**
   * Damage this side's units have applied to the enemy's buildings, Core
   * included (no Overload decay, no overkill past a building's remaining
   * health): the first tiebreak counter. See "Battles", "Tiebreak counters".
   */
  readonly buildingDamageDealt: number;
  /** Enemy units that died from this side's damage: the second counter. */
  readonly unitsKilled: number;
}

export interface TimelineSide {
  /** Units alive. */
  readonly units: number;
  /** Sum of the current health of those units. */
  readonly unitHealth: number;
  /** Placed buildings alive (not counting the Core). */
  readonly buildings: number;
}

export interface TimelineSample {
  readonly tick: number;
  readonly sides: readonly [TimelineSide, TimelineSide];
}

export interface BattleSummary {
  readonly sides: readonly [BattleSideSummary, BattleSideSummary];
  readonly timeline: readonly TimelineSample[];
}

export interface Battle {
  readonly zone: NeutralZone;
  /** The simulation state (plain JSON); read it, do not change it. */
  readonly sim: ArenaSim;
  readonly ctx: ArenaContext;
  /** Every event so far: `zone_revealed` first, `battle_ended` last. */
  readonly eventLog: readonly ArenaEvent[];
  /** Run one tick. Does nothing once the battle is over. */
  step(): void;
  isOver(): boolean;
  /** The result, or null while the battle is running. */
  result(): BattleResult | null;
  /** The summary so far (final once the battle is over). */
  summary(): BattleSummary;
}

export type StartBattleResult =
  | { readonly ok: true; readonly battle: Battle }
  | { readonly ok: false; readonly error: BattleError };

export type SimulateBattleResult =
  | {
      readonly ok: true;
      readonly result: BattleResult;
      readonly summary: BattleSummary;
      readonly eventLog: readonly ArenaEvent[];
      readonly zone: NeutralZone;
    }
  | { readonly ok: false; readonly error: BattleError };

function fail(error: BattleError): { ok: false; error: BattleError } {
  return { ok: false, error };
}

/**
 * Set a battle up at tick 0: validate the boards, generate the zone, build the
 * arena and record `zone_revealed`. Typed errors, in this order: the boards
 * differ in width (`party_size_mismatch`) or height (`board_size_mismatch`);
 * a Core is not placed (`core_not_placed`, side 0 checked first); a handed-in
 * zone is unusable (`invalid_zone`).
 */
export function startBattle(
  input: BattleInput,
  content: ArenaContent,
  config: BattleConfig,
  options: BattleOptions = {},
): StartBattleResult {
  const { teamA, teamB, seed } = input;
  const a = teamA.map;
  const b = teamB.map;
  if (a.width !== b.width) {
    return fail({
      code: 'party_size_mismatch',
      message: `Both sides must have the same party size: the boards are ${String(a.width)} and ${String(b.width)} cells wide.`,
    });
  }
  if (a.height !== b.height) {
    return fail({
      code: 'board_size_mismatch',
      message: `Both boards must have the same height: ${String(a.height)} and ${String(b.height)}.`,
    });
  }
  if (teamA.cores.every((c) => c === null)) {
    return fail({
      code: 'core_not_placed',
      message: 'Side 0 has not placed its Core.',
      side: 0,
    });
  }
  if (teamB.cores.every((c) => c === null)) {
    return fail({
      code: 'core_not_placed',
      message: 'Side 1 has not placed its Core.',
      side: 1,
    });
  }
  // Fighting with several Cores per side comes with issue #132.
  for (const side of [0, 1] as const) {
    const team = side === 0 ? teamA : teamB;
    if (team.cores.filter((c) => c !== null).length > 1) {
      return fail({
        code: 'several_cores',
        message: `Side ${String(side)} has more than one Core placed; a battle supports one Core per side for now.`,
        side,
      });
    }
  }
  let zone: NeutralZone;
  if (options.zone !== undefined) {
    zone = options.zone;
    const problem =
      zone.width !== a.width
        ? `the zone is ${String(zone.width)} wide, the boards ${String(a.width)}`
        : neutralZoneProblem(zone, content);
    if (problem !== undefined) {
      return fail({ code: 'invalid_zone', message: problem });
    }
  } else {
    zone = generateNeutralZone(seed, a.width, content, config.mapgen);
  }

  const sim = createArenaSim(teamA, teamB, zone.depth, content, config.sim, {
    gapBlocked: zoneBlockedCells(zone, a.height, content),
    ...(input.sideOptions === undefined
      ? {}
      : { sideOptions: input.sideOptions }),
  });
  const eventLog: ArenaEvent[] = [];
  const ctx = createArenaContext(sim, content, config.sim, {
    events: eventLog,
  });
  eventLog.push({ tick: 0, type: 'zone_revealed', zone });

  const coreMax: [number, number] = [0, 0];
  for (const h of sim.health) {
    if (h.building === 0) coreMax[h.side === 0 ? 0 : 1] = h.hp;
  }
  const rampSteps: [number, number] = [0, 0];
  const timeline: TimelineSample[] = [];
  let scanned = eventLog.length;
  let result: BattleResult | null = null;

  const sample = (): void => {
    const side = (s: number): TimelineSide => {
      let units = 0;
      let unitHealth = 0;
      for (const u of sim.units) {
        if (u.side !== s) continue;
        units += 1;
        unitHealth += u.hp;
      }
      return {
        units,
        unitHealth,
        buildings: sim.teams[s === 0 ? 0 : 1].buildings.length,
      };
    };
    timeline.push({ tick: sim.tick, sides: [side(0), side(1)] });
  };
  sample();

  const coreHp = (s: number): number =>
    sim.health.find((h) => h.side === s && h.building === 0)?.hp ?? 0;

  /**
   * The tiebreak rungs shared by a same-tick double Core fall (after the
   * overkill rung) and the time limit (after the Core health fraction): more
   * building damage dealt, then more enemy units killed, then the attacker
   * (side 0). The defender wins no tie.
   */
  const ladder = (): Omit<BattleResult, 'endTick'> => {
    const d0 = sim.buildingDamageDealt[0];
    const d1 = sim.buildingDamageDealt[1];
    if (d0 !== d1) {
      return {
        winner: d0 > d1 ? 0 : 1,
        reason: 'tiebreak_building_damage',
      };
    }
    // A unit's damage always comes from the other side, so a side's kills are
    // the other side's deaths.
    const k0 = sim.unitsDied[1];
    const k1 = sim.unitsDied[0];
    if (k0 !== k1) {
      return { winner: k0 > k1 ? 0 : 1, reason: 'tiebreak_kills' };
    }
    return { winner: 0, reason: 'tiebreak_attacker' };
  };

  /** The end conditions, checked after each tick (CB-33). */
  const decide = (): Omit<BattleResult, 'endTick'> | null => {
    const dead0 = coreHp(0) <= 0;
    const dead1 = coreHp(1) <= 0;
    if (dead0 && dead1) {
      const r0 = ctx.coreRemaining[0];
      const r1 = ctx.coreRemaining[1];
      if (r0 !== r1) {
        return { winner: r0 > r1 ? 0 : 1, reason: 'tiebreak_overkill' };
      }
      return ladder();
    }
    if (dead0) return { winner: 1, reason: 'core_destroyed' };
    if (dead1) return { winner: 0, reason: 'core_destroyed' };
    if (sim.tick >= config.sim.maxBattleTicks) {
      // Health as a fraction of the maximum, compared exactly (no product).
      const cmp = compareFractions(
        coreHp(0),
        coreMax[0],
        coreHp(1),
        coreMax[1],
      );
      if (cmp !== 0) {
        return { winner: cmp > 0 ? 0 : 1, reason: 'time_limit' };
      }
      return ladder();
    }
    return null;
  };

  const summary = (): BattleSummary => {
    const side = (s: 0 | 1): BattleSideSummary => {
      let buildingsLost = 0;
      for (const h of sim.health) {
        if (h.side === s && h.building !== 0 && h.hp <= 0) buildingsLost += 1;
      }
      const hp = coreHp(s);
      return {
        unitsSpawned: sim.spawned[s],
        unitsLost: sim.unitsDied[s],
        buildingsLost,
        coreHealth: hp,
        coreMaxHealth: coreMax[s],
        coreOverkill: hp > 0 ? 0 : 0 - ctx.coreRemaining[s],
        rampSteps: rampSteps[s],
        buildingDamageDealt: sim.buildingDamageDealt[s],
        unitsKilled: sim.unitsDied[s === 0 ? 1 : 0],
      };
    };
    return { sides: [side(0), side(1)], timeline: timeline.slice() };
  };

  const battle: Battle = {
    zone,
    sim,
    ctx,
    eventLog,
    step(): void {
      if (result !== null) return;
      stepArena(sim, ctx);
      for (; scanned < eventLog.length; scanned++) {
        const e = eventLog[scanned];
        if (e?.type === 'ramp_step') rampSteps[e.side === 0 ? 0 : 1] += 1;
      }
      const ended = decide();
      if (ended !== null) {
        result = { ...ended, endTick: sim.tick };
        eventLog.push({
          tick: sim.tick - 1,
          type: 'battle_ended',
          winner: ended.winner,
          reason: ended.reason,
        });
        scanned = eventLog.length;
      }
      if (sim.tick % config.sim.timelineSampleTicks === 0 || result !== null) {
        if (timeline[timeline.length - 1]?.tick !== sim.tick) sample();
      }
    },
    isOver: () => result !== null,
    result: () => result,
    summary,
  };
  return { ok: true, battle };
}

/**
 * Run a whole battle to its end. `{ok: true, result, summary, eventLog, zone}`
 * or `{ok: false, error}`. Deterministic in `(teamA, teamB, seed)`, the content
 * and the configuration.
 */
export function simulateBattle(
  input: BattleInput,
  content: ArenaContent,
  config: BattleConfig,
  options: BattleOptions = {},
): SimulateBattleResult {
  const started = startBattle(input, content, config, options);
  if (!started.ok) return started;
  const { battle } = started;
  while (!battle.isOver()) battle.step();
  const result = battle.result();
  if (result === null) throw new Error('Battle: ended without a result.');
  return {
    ok: true,
    result,
    summary: battle.summary(),
    eventLog: battle.eventLog,
    zone: battle.zone,
  };
}
