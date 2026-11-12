/**
 * Prints the performance-budget measures of docs/performance-budget.md
 * (dense stress battles, one-plot size and speed). Run with
 * `pnpm exec tsx packages/tools/src/sim/bench-report.ts` from the root.
 * Wall time is printed, so the output is not deterministic.
 */
import { performance } from 'node:perf_hooks';
import {
  ALL_REFERENCE_BOARDS,
  buildAnyReferenceBoard,
  startBattle,
  type TeamState,
} from '@game/core';
import { denseFourPlotTeam } from './bench-teams.js';
import { loadSimContext } from './context.js';

const ctx = loadSimContext();
const config = { sim: ctx.sim, mapgen: ctx.mapgen };

function start(a: TeamState, b: TeamState, seed: number) {
  const s = startBattle({ teamA: a, teamB: b, seed }, ctx.content, config);
  if (!s.ok) throw new Error(s.error.message);
  return s.battle;
}

function shape(a: TeamState, b: TeamState, seed: number) {
  const battle = start(a, b, seed);
  let peak = 0;
  const t0 = performance.now();
  while (!battle.isOver()) {
    battle.step();
    let n0 = 0;
    for (const u of battle.sim.units) if (u.side === 0) n0 += 1;
    peak = Math.max(peak, n0, battle.sim.units.length - n0);
  }
  return {
    ms: Math.round(performance.now() - t0),
    ticks: battle.sim.tick,
    peak,
    bytes: JSON.stringify(battle.eventLog).length,
    events: battle.eventLog.length,
    reason: battle.result()?.reason,
  };
}

function rate(pairs: readonly (readonly [TeamState, TeamState, number])[]) {
  let best = 0;
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    for (const [a, b, s] of pairs) {
      const bt = start(a, b, s);
      while (!bt.isOver()) bt.step();
    }
    best = Math.max(best, pairs.length / ((performance.now() - t0) / 1000));
  }
  return best.toFixed(1);
}

for (const tier of [1, 3]) {
  const t = denseFourPlotTeam(ctx, tier);
  console.log('dense tier', tier, JSON.stringify(shape(t, t, 1)));
}
{
  // How the dense stress boards end (a Core kill before Overload starts at
  // tick 1800 means the units got through; mirror matches fall together).
  const rows: string[] = [];
  for (const [ta, tb] of [
    [1, 1],
    [3, 3],
    [1, 3],
    [3, 1],
  ] as const) {
    const b = shape(denseFourPlotTeam(ctx, ta), denseFourPlotTeam(ctx, tb), 1);
    rows.push(
      `T${String(ta)} vs T${String(tb)}: ${String(b.reason)} @${String(b.ticks)}`,
    );
  }
  console.log('dense outcomes', rows.join('; '));
}
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
  const why = String(m.reason);
  reasons.set(why, (reasons.get(why) ?? 0) + 1);
  maxBytes = Math.max(maxBytes, m.bytes);
  maxTicks = Math.max(maxTicks, m.ticks);
  maxPeak = Math.max(maxPeak, m.peak);
}
console.log(
  'one plot: max log bytes',
  maxBytes,
  'max ticks',
  maxTicks,
  'peak',
  maxPeak,
);
console.log(
  'one plot: how battles ended (of',
  pairs.length,
  ')',
  [...reasons.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' '),
);
console.log('one plot battles/s', rate(pairs));
const team = denseFourPlotTeam(ctx, 1);
console.log(
  'dense tier 1 battles/s',
  rate(
    [1, 2, 3, 4].map((s) => [team, team, s] as [TeamState, TeamState, number]),
  ),
);
{
  // Archer-heavy: the same dense board with Ranges instead of Barracks.
  for (const producer of ['bld_barracks', 'bld_range']) {
    const t = denseFourPlotTeam(ctx, 1, producer);
    console.log(
      `dense tier 1 ${producer}`,
      JSON.stringify(shape(t, t, 1)),
      'battles/s',
      rate(
        [1, 2, 3, 4].map((s) => [t, t, s] as [TeamState, TeamState, number]),
      ),
    );
  }
}
