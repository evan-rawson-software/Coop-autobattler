/**
 * A whole battle (W1-8, CB-8, CB-33): two boards, the neutral zone generated
 * between them from the battle seed, the arena simulation, the end conditions
 * and the result. See docs/rules-reference.md, "Battles". Side 0 is always the
 * party and side 1 the opponent (the defender, "the ghost").
 */

import type { ArenaContent } from './arena.js';
import {
  isCoreHealth,
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
import { addInt, addSaturating, compareFractions } from './int.js';
import { MAX_TICK_DAMAGE } from './limits.js';
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
  | 'invalid_zone';

export interface BattleError {
  readonly code: BattleErrorCode;
  readonly message: string;
  /** The side at fault, for `core_not_placed`. */
  readonly side?: 0 | 1;
  /** The lowest player index without a Core on that side, for `core_not_placed`. */
  readonly player?: number;
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

/** One Core of a side in the summary (PP-10). */
export interface CoreSummary {
  /** The player index. */
  readonly player: number;
  /** Health at the end, clamped at 0. */
  readonly health: number;
  readonly maxHealth: number;
  /** Damage beyond 0 that destroyed the Core; 0 while it stands. */
  readonly overkill: number;
  /** The tick the Core fell, or null while it stands. */
  readonly destroyedTick: number | null;
}

interface CoreMax {
  readonly player: number;
  readonly max: number;
}

export interface BattleSideSummary {
  readonly unitsSpawned: number;
  readonly unitsLost: number;
  /** Buildings destroyed, not counting the Core. */
  readonly buildingsLost: number;
  /** Every placed Core of the side, by player index. */
  readonly cores: readonly CoreSummary[];
  readonly coresStanding: number;
  /** Total Core health at the end (Cores clamped at 0): `sumHp` of PP-10. */
  readonly coreHealth: number;
  /** Total maximum Core health: `sumMax`. */
  readonly coreMaxHealth: number;
  /**
   * The overkill of the Cores destroyed in the latest tick, summed
   * (saturating): the rung-3 value of PP-10. 0 while all Cores stand.
   */
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

/**
 * The overkill of several Cores added in player order, saturating at
 * `MAX_TICK_DAMAGE` (2^52): each term is below it, and two sides that both
 * saturate are equal on the overkill rung (PP-10).
 */
export function sumOverkill(terms: readonly number[]): number {
  let sum = 0;
  for (const t of terms) sum = addSaturating(sum, t, MAX_TICK_DAMAGE);
  return sum;
}

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
      player: 0, // no Core at all, so the lowest index is 0
    });
  }
  if (teamB.cores.every((c) => c === null)) {
    return fail({
      code: 'core_not_placed',
      message: 'Side 1 has not placed its Core.',
      side: 1,
      player: 0, // no Core at all, so the lowest index is 0
    });
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

  // Per side, the placed Cores by player index (the health list order).
  const coreMax: [CoreMax[], CoreMax[]] = [[], []];
  for (const h of sim.health) {
    if (isCoreHealth(h)) {
      coreMax[h.side === 0 ? 0 : 1].push({ player: h.core, max: h.hp });
    }
  }
  const fellAt: Map<string, number> = new Map();
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

  const coreHpOf = (s: number, player: number): number => {
    const h = sim.health.find(
      (x) => isCoreHealth(x) && x.side === s && x.core === player,
    );
    return h?.hp ?? 0;
  };
  const standing = (s: 0 | 1): number =>
    coreMax[s].filter((c) => coreHpOf(s, c.player) > 0).length;
  const sumHp = (s: 0 | 1): number =>
    coreMax[s].reduce((t, c) => addInt(t, coreHpOf(s, c.player)), 0);
  const sumMax = (s: 0 | 1): number =>
    coreMax[s].reduce((t, c) => addInt(t, c.max), 0);
  const fellTick = (s: number, player: number): number | null =>
    fellAt.get(`${String(s)}:${String(player)}`) ?? null;
  /**
   * A side's overkill: the sum, in player order and saturating, of the
   * overkill of its Cores destroyed in the latest tick (PP-10).
   */
  const overkillSum = (s: 0 | 1): number =>
    sumOverkill(
      coreMax[s]
        .filter((c) => fellTick(s, c.player) === sim.tick - 1)
        .map((c) => 0 - (ctx.coreRemaining[s]?.[c.player] ?? 0)),
    );

  /**
   * The ladder of PP-10 from rung `from` on; the first rung on which the
   * sides differ decides. Rungs 1 and 2 only matter at the time limit.
   * The defender wins no tie.
   */
  const ladder = (from: 1 | 3): Omit<BattleResult, 'endTick'> => {
    if (from === 1) {
      const c0 = standing(0);
      const c1 = standing(1);
      if (c0 !== c1) {
        return { winner: c0 > c1 ? 0 : 1, reason: 'time_limit' };
      }
      // Share of total Core health, compared exactly (no product).
      const cmp = compareFractions(sumHp(0), sumMax(0), sumHp(1), sumMax(1));
      if (cmp !== 0) {
        return { winner: cmp > 0 ? 0 : 1, reason: 'time_limit' };
      }
    }
    const o0 = overkillSum(0);
    const o1 = overkillSum(1);
    if (o0 !== o1) {
      return { winner: o0 < o1 ? 0 : 1, reason: 'tiebreak_overkill' };
    }
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

  /** The end conditions, checked after each tick (CB-33, PP-10). */
  const decide = (): Omit<BattleResult, 'endTick'> | null => {
    const dead0 = standing(0) === 0;
    const dead1 = standing(1) === 0;
    if (dead0 && dead1) return ladder(3);
    if (dead0) return { winner: 1, reason: 'core_destroyed' };
    if (dead1) return { winner: 0, reason: 'core_destroyed' };
    if (sim.tick >= config.sim.maxBattleTicks) return ladder(1);
    return null;
  };

  const summary = (): BattleSummary => {
    const side = (s: 0 | 1): BattleSideSummary => {
      let buildingsLost = 0;
      for (const h of sim.health) {
        if (h.side === s && !isCoreHealth(h) && h.hp <= 0) buildingsLost += 1;
      }
      const cores = coreMax[s].map((c): CoreSummary => {
        const hp = coreHpOf(s, c.player);
        return {
          player: c.player,
          health: hp,
          maxHealth: c.max,
          overkill: hp > 0 ? 0 : 0 - (ctx.coreRemaining[s]?.[c.player] ?? 0),
          destroyedTick: fellTick(s, c.player),
        };
      });
      return {
        unitsSpawned: sim.spawned[s],
        unitsLost: sim.unitsDied[s],
        buildingsLost,
        cores,
        coresStanding: standing(s),
        coreHealth: sumHp(s),
        coreMaxHealth: sumMax(s),
        coreOverkill: overkillSum(s),
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
        if (e?.type === 'core_destroyed') {
          fellAt.set(`${String(e.side)}:${String(e.core)}`, e.tick);
        }
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
