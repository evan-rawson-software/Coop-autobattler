/**
 * Prints the performance-budget measures of docs/performance-budget.md: the
 * one-plot reference battles, the legal dense four-plot board and the stress
 * board (one Core and four Cores per side), each timed `RUNS` times with
 * min / median / max. Run with
 * `pnpm exec tsx packages/tools/src/sim/bench-report.ts [runs]` from the root.
 * Wall time is printed, so the output is not deterministic.
 */
import { performance } from 'node:perf_hooks';
import {
  ALL_REFERENCE_BOARDS,
  buildAnyReferenceBoard,
  startBattle,
  type TeamState,
} from '@game/core';
import { denseFourPlotTeam, legalDenseTeam } from './bench-teams.js';
import { loadSimContext } from './context.js';

const RUNS = Number(process.argv[2] ?? 5);
const ctx = loadSimContext();
const config = { sim: ctx.sim, mapgen: ctx.mapgen };

function start(a: TeamState, b: TeamState, seed: number) {
  const s = startBattle({ teamA: a, teamB: b, seed }, ctx.content, config);
  if (!s.ok) throw new Error(s.error.message);
  return s.battle;
}

/** Untimed run: the deterministic size measures. */
function shape(a: TeamState, b: TeamState, seed: number) {
  const battle = start(a, b, seed);
  let peak = 0;
  let unitTicks = 0;
  while (!battle.isOver()) {
    battle.step();
    unitTicks += battle.sim.units.length;
    let n0 = 0;
    for (const u of battle.sim.units) if (u.side === 0) n0 += 1;
    peak = Math.max(peak, n0, battle.sim.units.length - n0);
  }
  return {
    ticks: battle.sim.tick,
    peak,
    unitTicks,
    bytes: JSON.stringify(battle.eventLog).length,
    reason: String(battle.result()?.reason),
  };
}

/** Timed run of every pair; returns seconds and the ticks stepped. */
function timed(pairs: readonly (readonly [TeamState, TeamState, number])[]) {
  let ticks = 0;
  const t0 = performance.now();
  for (const [a, b, s] of pairs) {
    const bt = start(a, b, s);
    while (!bt.isOver()) bt.step();
    ticks += bt.sim.tick;
  }
  return { seconds: (performance.now() - t0) / 1000, ticks };
}

function spread(xs: number[], digits: number): string {
  const s = [...xs].sort((p, q) => p - q);
  const med =
    s.length % 2 === 1
      ? (s[(s.length - 1) / 2] ?? 0)
      : ((s[s.length / 2 - 1] ?? 0) + (s[s.length / 2] ?? 0)) / 2;
  const f = (n: number) => n.toFixed(digits);
  return `min ${f(s[0] ?? 0)} / median ${f(med)} / max ${f(s[s.length - 1] ?? 0)}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** Mirror battles of seeds 1..`seeds`, `RUNS` timed runs. Returns the median ms per tick and per unit-tick (all seeds). */
function dense(
  label: string,
  team: TeamState,
  seeds: number,
): { msTick: number; usUnitTick: number } {
  const pairs = Array.from(
    { length: seeds },
    (_, i) => [team, team, i + 1] as [TeamState, TeamState, number],
  );
  const first = shape(team, team, 1);
  let allUnitTicks = first.unitTicks;
  for (let seed = 2; seed <= seeds; seed++)
    allUnitTicks += shape(team, team, seed).unitTicks;
  const rate: number[] = [];
  const msTick: number[] = [];
  const wall: number[] = [];
  const usUnit: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t = timed(pairs);
    rate.push(pairs.length / t.seconds);
    msTick.push((t.seconds * 1000) / t.ticks);
    wall.push((t.seconds * 1000) / pairs.length);
    usUnit.push((t.seconds * 1e6) / allUnitTicks);
  }
  console.log(
    `${label}: seed 1 ${first.reason} @${String(first.ticks)} ticks, peak ${String(first.peak)} per side, log ${String(first.bytes)} bytes`,
  );
  console.log(
    `  ${String(seeds)} seeds x ${String(RUNS)} runs; battles/s ${spread(rate, 2)}; ms/battle ${spread(wall, 0)}; ms/tick ${spread(msTick, 3)}; us/unit-tick ${spread(usUnit, 2)}`,
  );
  return {
    msTick: median(msTick),
    usUnitTick: median(usUnit),
  };
}

console.log(`runs per figure: ${String(RUNS)}`);
{
  const boards = ALL_REFERENCE_BOARDS.map((n) =>
    buildAnyReferenceBoard(n, ctx.content, ctx.mapgen),
  );
  const pairs: [TeamState, TeamState, number][] = [];
  for (let seed = 1; seed <= 8; seed++) {
    for (const a of boards) for (const b of boards) pairs.push([a, b, seed]);
  }
  let maxBytes = 0;
  let maxTicks = 0;
  let maxPeak = 0;
  const reasons = new Map<string, number>();
  for (const [a, b, s] of pairs) {
    const m = shape(a, b, s);
    reasons.set(m.reason, (reasons.get(m.reason) ?? 0) + 1);
    maxBytes = Math.max(maxBytes, m.bytes);
    maxTicks = Math.max(maxTicks, m.ticks);
    maxPeak = Math.max(maxPeak, m.peak);
  }
  console.log(
    `one plot (${String(pairs.length)} battles): max log bytes ${String(maxBytes)}, max ticks ${String(maxTicks)}, peak ${String(maxPeak)}; ended ${[
      ...reasons.entries(),
    ]
      .sort((x, y) => (x[0] < y[0] ? -1 : 1))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(' ')}`,
  );
  const rate: number[] = [];
  for (let r = 0; r < RUNS; r++) rate.push(pairs.length / timed(pairs).seconds);
  console.log(`one plot battles/s ${spread(rate, 1)}`);
}
for (const tier of [1, 3] as const) {
  dense(
    `legal dense four-plot, tier ${String(tier)}`,
    legalDenseTeam(ctx, tier),
    2,
  );
}
for (const tier of [1, 3]) {
  const one = dense(
    `stress board, one Core per side, tier ${String(tier)}`,
    denseFourPlotTeam(ctx, tier, 'bld_barracks', 1),
    1,
  );
  const four = dense(
    `stress board, four Cores per side, tier ${String(tier)}`,
    denseFourPlotTeam(ctx, tier, 'bld_barracks', 4),
    1,
  );
  console.log(
    `  tier ${String(tier)} per-tick cost, four Cores / one Core: ${(four.msTick / one.msTick).toFixed(2)}, per unit-tick ${(four.usUnitTick / one.usUnitTick).toFixed(2)}`,
  );
}
