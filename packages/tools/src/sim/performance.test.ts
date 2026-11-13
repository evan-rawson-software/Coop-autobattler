/**
 * The performance budget of docs/performance-budget.md, enforced. Strict
 * timing floors are one quarter of the median measured on the development
 * sandbox on 2026-11-13 (5 runs each): a GitHub runner is about 4 times
 * slower than that machine, and CI relaxes the limits by a further 3, so a
 * slow or noisy runner passes and a real regression (the simulation getting
 * several times slower, or units, ticks or log size growing past the budget)
 * fails. Deterministic quantities (units, ticks, log size) are checked
 * exactly against the budget.
 *
 * Wall time uses `performance.now()` (allowed here, not in core). Each timing
 * is the best of several rounds to shed noise from a busy machine.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, test } from 'vitest';
import {
  ALL_REFERENCE_BOARDS,
  buildAnyReferenceBoard,
  startBattle,
  type TeamState,
} from '@game/core';
import { denseFourPlotTeam, legalDenseTeam } from './bench-teams.js';
import { loadSimContext } from './context.js';

/** The budget (docs/performance-budget.md); keep the two in sync. */
const BUDGET = {
  maxUnitsPerSide: 1000,
  /** Typical battles end by this tick; Overload ends every battle by 3101. */
  maxTicks: 4000,
  /** Event log size in JSON bytes. */
  maxLogBytesOnePlot: 1_000_000,
  /** The legal dense board measures 1.6 MB (tier 1) and 2.7 MB (tier 3). */
  maxLogBytesLegalDense: 4_000_000,
  /** The stress board measures 3.1 MB (tier 1) and 6.9 MB (tier 3). */
  maxLogBytesFourPlots: 12_000_000,
  /**
   * Targets on a developer machine (documented, not enforced). The one-plot
   * target (100) is met; the dense four-plot target (5) is met by the legal
   * dense board and not by the stress board (see docs/performance-budget.md).
   */
  targetBattlesPerSecondOnePlot: 100,
  targetBattlesPerSecondFourPlots: 5,
  /**
   * Enforced floors: fail below these. Medians of 5 runs, 2026-11-13: 139.5
   * one-plot battles a second (floor 35, was 40), 8.7 and 6.1 legal dense
   * tier 1 and tier 3 battles a second (floors 2 and 1.5, new), 1.4 stress
   * battles a second at tier 1 with four Cores per side (floor 0.35, was 0.7).
   */
  minBattlesPerSecondOnePlot: 35,
  minBattlesPerSecondLegalDenseTier1: 2,
  minBattlesPerSecondLegalDenseTier3: 1.5,
  minBattlesPerSecondFourPlots: 0.35,
  /**
   * Enforced ceiling for the stress tier 3 battle with four Cores per side,
   * in ms (median 1460, best of 5 about 1400; four times that, unchanged).
   */
  maxStressBattleMs: 6_000,
} as const;

/** CI_RELAXED_TIMING=1 (set in CI) loosens the wall-time limits by 3; unset is strict. */
const TIMING = process.env['CI_RELAXED_TIMING'] === '1' ? 3 : 1;

const ctx = loadSimContext();
const config = { sim: ctx.sim, mapgen: ctx.mapgen };

function start(a: TeamState, b: TeamState, seed: number) {
  const s = startBattle({ teamA: a, teamB: b, seed }, ctx.content, config);
  if (!s.ok) throw new Error(s.error.message);
  return s.battle;
}

/** Run to the end, untimed; the deterministic size measures. */
function shape(a: TeamState, b: TeamState, seed: number) {
  const battle = start(a, b, seed);
  let peak = 0;
  while (!battle.isOver()) {
    battle.step();
    let n0 = 0;
    for (const u of battle.sim.units) if (u.side === 0) n0 += 1;
    peak = Math.max(peak, n0, battle.sim.units.length - n0);
  }
  return {
    ticks: battle.sim.tick,
    peak,
    bytes: JSON.stringify(battle.eventLog).length,
  };
}

/** Battles per second over `pairs`, best of three rounds. */
function throughput(
  pairs: readonly (readonly [TeamState, TeamState, number])[],
  rounds = 3,
): number {
  let best = 0;
  for (let round = 0; round < rounds; round++) {
    const t0 = performance.now();
    for (const [a, b, seed] of pairs) {
      const battle = start(a, b, seed);
      while (!battle.isOver()) battle.step();
    }
    const seconds = (performance.now() - t0) / 1000;
    best = Math.max(best, pairs.length / seconds);
  }
  return best;
}

describe('performance budget', () => {
  const boards = ALL_REFERENCE_BOARDS.map((n) =>
    buildAnyReferenceBoard(n, ctx.content, ctx.mapgen),
  );

  // Every ordered pair of the reference boards at 8 seeds: 128 one-plot battles.
  const onePlot: [TeamState, TeamState, number][] = [];
  for (let seed = 1; seed <= 8; seed++) {
    for (const a of boards) for (const b of boards) onePlot.push([a, b, seed]);
  }

  test('one-plot battles stay within the size budget', () => {
    let maxBytes = 0;
    for (const [a, b, seed] of onePlot) {
      const m = shape(a, b, seed);
      expect(m.ticks).toBeLessThanOrEqual(BUDGET.maxTicks);
      expect(m.ticks).toBeLessThan(ctx.sim.maxBattleTicks);
      expect(m.peak).toBeLessThanOrEqual(BUDGET.maxUnitsPerSide);
      maxBytes = Math.max(maxBytes, m.bytes);
    }
    expect(maxBytes).toBeLessThanOrEqual(BUDGET.maxLogBytesOnePlot);
  }, 30_000);

  test('one-plot battles per second', () => {
    const rate = throughput(onePlot);
    expect(rate).toBeGreaterThanOrEqual(
      BUDGET.minBattlesPerSecondOnePlot / TIMING,
    );
  }, 30_000);

  test('stress board (four Cores per side) stays within the size budget', () => {
    for (const tier of [1, 3]) {
      const team = denseFourPlotTeam(ctx, tier);
      const m = shape(team, team, 1);
      expect(m.ticks).toBeLessThanOrEqual(BUDGET.maxTicks);
      expect(m.peak).toBeLessThanOrEqual(BUDGET.maxUnitsPerSide);
      expect(m.bytes).toBeLessThanOrEqual(BUDGET.maxLogBytesFourPlots);
    }
  }, 120_000);

  test.each([1, 3] as const)(
    'legal dense four-plot board, tier %i, stays within the size budget',
    (tier) => {
      const team = legalDenseTeam(ctx, tier);
      const m = shape(team, team, 1);
      expect(m.ticks).toBeLessThanOrEqual(BUDGET.maxTicks);
      expect(m.peak).toBeLessThanOrEqual(BUDGET.maxUnitsPerSide);
      expect(m.bytes).toBeLessThanOrEqual(BUDGET.maxLogBytesLegalDense);
    },
    60_000,
  );

  test.each([
    [1, BUDGET.minBattlesPerSecondLegalDenseTier1],
    [3, BUDGET.minBattlesPerSecondLegalDenseTier3],
  ] as const)(
    'legal dense four-plot board, tier %i, battles per second',
    (tier, floor) => {
      const team = legalDenseTeam(ctx, tier);
      const pairs: [TeamState, TeamState, number][] = [
        [team, team, 1],
        [team, team, 2],
      ];
      expect(throughput(pairs, 2)).toBeGreaterThanOrEqual(floor / TIMING);
    },
    60_000,
  );

  test('stress board (four Cores per side) battles per second', () => {
    const team = denseFourPlotTeam(ctx, 1, 'bld_barracks', 4);
    const pairs: [TeamState, TeamState, number][] = [];
    for (let seed = 1; seed <= 2; seed++) pairs.push([team, team, seed]);
    const rate = throughput(pairs, 2);
    expect(rate).toBeGreaterThanOrEqual(
      BUDGET.minBattlesPerSecondFourPlots / TIMING,
    );
  }, 120_000);

  test('the tier 3 stress battle with four Cores per side finishes in time', () => {
    const team = denseFourPlotTeam(ctx, 3, 'bld_barracks', 4);
    let best = Infinity;
    for (let round = 0; round < 2; round++) {
      const battle = start(team, team, 1);
      const t0 = performance.now();
      while (!battle.isOver()) battle.step();
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(BUDGET.maxStressBattleMs * TIMING);
  }, 120_000);
});
