/**
 * The performance budget of docs/performance-budget.md, enforced. The
 * enforced limits are about 3 times looser than the speed measured on a
 * developer machine with other work running (see the table in the document),
 * so a slow or noisy CI runner passes and a real regression (the simulation
 * getting several times slower, or units, ticks or log size growing past the
 * budget) fails. Deterministic quantities (units,
 * ticks, log size) are checked exactly against the budget.
 *
 * Wall time uses `performance.now()` (allowed here, not in core). Each timing
 * is the best of three rounds to shed noise from a busy machine.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, test } from 'vitest';
import {
  ALL_REFERENCE_BOARDS,
  buildAnyReferenceBoard,
  startBattle,
  type TeamState,
} from '@game/core';
import { denseFourPlotTeam } from './bench-teams.js';
import { loadSimContext } from './context.js';

/** The budget (docs/performance-budget.md); keep the two in sync. */
const BUDGET = {
  maxUnitsPerSide: 1000,
  /** Typical battles end by this tick; Overload ends every battle by 3101. */
  maxTicks: 4000,
  /** Event log size in JSON bytes. */
  maxLogBytesOnePlot: 1_000_000,
  maxLogBytesFourPlots: 8_000_000,
  /**
   * Targets on a developer machine (documented, not enforced). With soft
   * collision (issue #82) the one-plot target is met; the dense four-plot
   * targets are not quite (see docs/performance-budget.md).
   */
  targetBattlesPerSecondOnePlot: 100,
  targetBattlesPerSecondFourPlots: 5,
  /**
   * Enforced floors: fail below these. Measured: 120 to 140 one-plot battles
   * a second, 2.2 to 4.1 dense tier 1 battles a second, 1.0 to 2.0 s for the
   * tier 3 stress battle: about 3 times headroom each.
   */
  minBattlesPerSecondOnePlot: 40,
  minBattlesPerSecondFourPlots: 0.8,
  /** Enforced ceiling for the dense tier 3 stress battle, in ms. */
  maxStressBattleMs: 6_000,
} as const;

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
    expect(rate).toBeGreaterThanOrEqual(BUDGET.minBattlesPerSecondOnePlot);
  }, 30_000);

  test('dense four-plot battles stay within the size budget', () => {
    for (const tier of [1, 3]) {
      const team = denseFourPlotTeam(ctx, tier);
      const m = shape(team, team, 1);
      expect(m.ticks).toBeLessThanOrEqual(BUDGET.maxTicks);
      expect(m.peak).toBeLessThanOrEqual(BUDGET.maxUnitsPerSide);
      expect(m.bytes).toBeLessThanOrEqual(BUDGET.maxLogBytesFourPlots);
    }
  }, 120_000);

  test('dense four-plot battles per second', () => {
    const team = denseFourPlotTeam(ctx, 1);
    const pairs: [TeamState, TeamState, number][] = [];
    for (let seed = 1; seed <= 2; seed++) pairs.push([team, team, seed]);
    const rate = throughput(pairs, 2);
    expect(rate).toBeGreaterThanOrEqual(BUDGET.minBattlesPerSecondFourPlots);
  }, 120_000);

  test('the tier 3 stress battle finishes in time', () => {
    const team = denseFourPlotTeam(ctx, 3);
    let best = Infinity;
    for (let round = 0; round < 2; round++) {
      const battle = start(team, team, 1);
      const t0 = performance.now();
      while (!battle.isOver()) battle.step();
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(BUDGET.maxStressBattleMs);
  }, 120_000);
});
