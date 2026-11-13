# Performance budget (CB-36, W1-10)

Baseline measurements of whole battles (`simulateBattle` / `startBattle` run to
the end, event log recorded) and the budget derived from them. The rules are in
[`rules-reference.md`](rules-reference.md) ("Battles"). The budget is enforced by
`packages/tools/src/sim/performance.test.ts` (W1-10) and, with looser limits,
by `packages/core/src/battle.test.ts` ("performance (CB-36)"). Both fail only
on a large regression, not on a slow machine.

This is the baseline of **2026-11-13** (issues #164 and #123), measured on the
rules and boards of that day: per-player design, one Core per player, buildings
limited by the nodes of their plot. Wall time is the median of 5 runs on a
shared cloud sandbox (4 cores, other work running), with the spread (min to
max) beside it. A GitHub runner is about 4 times slower than this sandbox.

## Method and boards

`pnpm exec tsx packages/tools/src/sim/bench-report.ts [runs]` prints every
figure below (default 5 runs; min / median / max). Wall time is
`performance.now()` around the tick loop, no warm-up. "Peak units" is the
maximum number of units alive on one side at the end of any tick (untimed
run). The event log size is the length of `JSON.stringify(eventLog)`. Each
board is mirrored against itself.

- **One plot (reference)**: every ordered pair of the four reference boards
  (rush, fortify, siege, poor) at seeds 1 to 8, 128 battles.
- **Legal dense four plots** (`legalDenseTeam`, `bench-teams.ts`): a board a
  party of four could build. Each plot is the `full1` (tier 1) or `full3`
  (tier 3) board of `pnpm sim stage` (`fillStagePlot`, `stage-command.ts`): all
  three Ore and all three Power nodes of the plot are used, one consumer per
  collector (3 Barracks, 3 turrets), 7 walls, and a Core in every plot. A
  plot has 3 Ore, 3 Power and 1 Flux node (`nodesPerPlot` in
  `content/mapgen.json`: 3 common, 1 rare); the stage boards use no Flux. The
  map is the generated map of seed 5 repeated four times side by side, so each
  plot is exactly the stage plot; seeds 1 and 2 are the battle seeds.
- **Stress board** (`denseFourPlotTeam`): 96 Barracks on 48 Ore sources, a
  hand-made flat 96 x 16 map. **No player can build it** (a plot has 3 Ore
  nodes, not 12); it exists to put far more units on the field than any legal
  board does. Four Cores per side (a Core in every plot, owners by plot) is the
  default; the one-Core variant is a party of one with the same buildings on
  the same map, used to measure what the per-Core fields cost.

## Baseline (2026-11-13)

| Board                                  | Battles/s (min / median / max) | Ticks (seed 1) | Peak units per side | Log (JSON) | ms per tick (median) | us per unit-tick (median) |
| -------------------------------------- | ------------------------------ | -------------- | ------------------- | ---------- | -------------------- | ------------------------- |
| One plot, 128 battles (5 runs)         | 127 / 139.5 / 148              | 3101 (longest) | 17 (largest)        | 0.38 MB (largest) | n/a           | n/a                       |
| Legal dense, tier 1                    | 8.3 / 8.7 / 10.4               | 3101           | 24                  | 1.56 MB    | 0.037                | 1.27                      |
| Legal dense, tier 3                    | 5.7 / 6.1 / 7.1                | 3101           | 36                  | 2.67 MB    | 0.053                | 0.99                      |
| Stress, one Core, tier 1               | 1.9 / 2.2 / 2.6                | 1820           | 411                 | 2.64 MB    | 0.248                | 1.06                      |
| Stress, four Cores, tier 1             | 1.3 / 1.40 / 1.6               | 2117           | 478                 | 3.09 MB    | 0.338                | 1.16                      |
| Stress, one Core, tier 3               | 0.71 / 0.73 / 0.79             | 1667           | 699                 | 4.72 MB    | 0.816                | 1.05                      |
| Stress, four Cores, tier 3             | 0.61 / 0.69 / 0.72             | 2318           | 810                 | 6.90 MB    | 0.629                | 1.13                      |

The legal dense battles run to tick 3101: with a plot's real supply the armies
stay small, nobody reaches a Core, and Overload decides (reason
`tiebreak_attacker`). The stress battles end by a Core kill before Overload.
The legal dense wall time per battle is 115 ms (tier 1) and 163 ms (tier 3),
about 6 to 9 times cheaper than the stress board with four Cores, whose peak
is about 20 times higher.

**What a Core costs.** Since #133 each side keeps one movement field and one
breach field per living enemy Core, dropped after every building destruction.
The four-Core stress battle is a different battle from the one-Core one (more
ticks, more units), so the time per tick alone is misleading: four Cores over
one Core is 1.37 at tier 1 but 0.77 at tier 3 per tick. Per unit-tick (the
better measure, since the work scales with the units alive) it is 1.10 at tier
1 and 1.07 at tier 3, within the 10 to 20 percent spread of the runs. So the
per-Core fields cost about 7 to 10 percent per unit-tick, not the "20 to 50
percent" read from single runs earlier.

**#123, history in short.** The wide-front pathing (#82 part 2) made the dense
stress battles 1.4 to 2.1 times slower, mostly by making them longer and the
units more often in motion (`moveAlong`, `nearestVisible`, `lineClear`). A
trim of the blocker search was tried on 2026-11-13: the half-width of the
scan `4 * maxRadius` replaced by `2 * (own radius + maxRadius)`, which is the
exact bound of the test below it, so it cannot change a result (the ticks
and log sizes of the bench were identical). The stress boards did not get faster (four Cores, tier
3: median 1457 ms before, 1475 ms after, 5 runs each; the same ticks and log
size), so it was reverted (no gain, no risk taken). Skipping the search when no ally can block is not
possible from local data (an ally that moves also blocks when it overlaps), so
it was not tried.

## Budget (W1-10)

Strict floors are one quarter of the median above (a runner is about 4 times
slower; CI multiplies the limits by 3 more with `CI_RELAXED_TIMING=1`), rounded
to a simple number; ceilings are four times the median.

| Quantity                                  | Budget                       | Measured (median, worst case) | Enforced by                           |
| ----------------------------------------- | ---------------------------- | ----------------------------- | ------------------------------------- |
| Units alive per side                      | 1,000                        | 810 (stress tier 3), 36 legal | `performance.test.ts`, exact          |
| Battle length                             | 4,000 ticks                  | 3,101                         | `performance.test.ts`, exact          |
| Hard cap on battle length                 | `maxBattleTicks` 12,000      | never reached                 | the end conditions                    |
| One plot: battles per second              | target at least 100 (met)    | 139.5                         | fails below 35 (was 40)               |
| Legal dense tier 1: battles per second    | target at least 5 (met)      | 8.7                           | fails below 2 (new)                   |
| Legal dense tier 3: battles per second    | target at least 5 (met)      | 6.1                           | fails below 1.5 (new)                 |
| Stress, four Cores, tier 1: battles/s     | target at least 5 (**not met**) | 1.40                       | fails below 0.35 (was 0.7)            |
| Stress, four Cores, tier 3: one battle    | target at most 1 s (**not met**) | 1.46 s                    | fails above 6 s (unchanged)           |
| Event log, one plot                       | 1 MB                         | 0.38 MB                       | `performance.test.ts`, exact          |
| Event log, legal dense four plots         | 4 MB (new)                   | 2.7 MB                        | `performance.test.ts`, exact          |
| Event log, stress board                   | 12 MB                        | 6.9 MB                        | `performance.test.ts`, exact          |

The floor of the stress tier 1 rate is lowered from 0.7 to 0.35 by the same
rule: a GitHub runner measured 0.41 battles per second on it, so 0.7 failed
there until CI relaxed the timing. The legal dense floors (2 and 1.5) watch the
boards a player can build; the stress floors watch the engine with hundreds of
units. The 6 s ceiling stayed (4 times 1.46 s).

Where the budget is written once more: the `BUDGET` constant at the top of
`packages/tools/src/sim/performance.test.ts`. Keep the two in sync.

**Unit budget.** The documented limit is 1,000 units alive per side. No board a
player can build comes near it (24 to 36 per side on the legal dense board,
17 on the one-plot reference boards); only the stress board does (up to 810).
The web stress sample ("Stress test: hundreds of units",
`packages/web/src/battle/samples.ts`) is 12 scripted waves of 40 units, with a
peak of about 390 units alive in total. It is a rendering stress test, not a
reachable board, and its peak is pinned by `STRESS_PEAK_FLOOR = 370` in
`packages/web/scripts/smoke.mjs`.

**Benchmark.** `packages/tools/src/sim/performance.test.ts` (run by `pnpm
test`; about 20 seconds): the one-plot size and rate tests, the legal dense
board at tier 1 and tier 3 (size untimed, rate over seeds 1 and 2, best of two
rounds), and the stress board with four Cores (size at both tiers, rate at
tier 1, and the tier 3 battle in time, best of two). Rates are battles
completed per second of wall time, best of the rounds (`performance.now()`,
allowed in `tools` only). The limits on units, ticks and log bytes are
deterministic and checked at the budget itself: change a board or a content
file in a way that grows them and the test fails until the budget (or the
change) is reconsidered. The core tests (`packages/core/src/battle.test.ts`,
"performance (CB-36)") keep their own looser limits (2 s, 10 s, 20 s) as an
extra guard. CI runs `pnpm -r run test`, so the package suites run in
parallel and the benchmark competes for CPU; if a runner turns out slower than
that, widen the margin rather than skip the check.

**Command-line check.** `pnpm sim batch --a rush --b fortify --count 300
--time` runs 300 one-plot battles and prints the wall time (see the README).

## PvE battles (W1-9)

A PvE battle (`startPveBattle`, see "PvE threats" in the rules reference) is the
same simulation with a scripted opponent. The threat side has no sources,
conduits or producers; its cost is its units and its stronghold buildings, both
bounded by configuration: a wave has at most `maxUnitsPerWavePerPlot` (12)
units per plot (48 on four plots) and a threat has at most 12 waves, so at most
576 threat units on a four-plot board, and a stronghold has at most
`maxWallsPerPlot + maxTurretsPerPlot` (66) buildings per plot (264 on four
plots). Late-round power comes from `unitStrengthPercent`, not from numbers.

Measured (reference `rush` board for one plot, the stress board above
for four plots, every archetype, same method as above; the peak is units alive
on the threat side at the end of any tick):

| Threat                   | Party size | Wall time  | Ticks     | Peak threat units |
| ------------------------ | ---------- | ---------- | --------- | ----------------- |
| Round 15 hard            | 1          | 1-4 ms     | 240-748   | 1-11              |
| Round 20 boss            | 1          | 1-5 ms     | 208-716   | 1-7               |
| Round 15 hard            | 4          | 34-104 ms  | 259-910   | 2-52              |
| Round 20 boss            | 4          | 20-100 ms  | 214-826   | 12-28             |

The peaks are low because late threats end the battle quickly (the party's Core
falls in a few hundred ticks); the bound above is what matters. Across the
reference-board sweep (3 boards, 4 archetypes, 4 types, rounds 1 to 20: 960
battles) the longest battle was 3101 ticks (the party lost to the Overload decay of
its own Core in 12 of them) and none reached `maxBattleTicks`.

## Notes

- Flow events (`produced`, `delivered`, `lost`, `stalled`) are recorded for
  every item moved, so the log grows with throughput as well as with fighting.
  See "Event log size by event type" below.
- The numbers do not include the neutral zone generation (one attempt in
  practice, microseconds), the summary timeline (a sample every 50 ticks) or
  any rendering.

## Event log size by event type (issue #38)

Share of the log's JSON bytes per event type. One plot is the largest battle
of the benchmark (every pair of the 4 reference boards, seeds 1 to 8): siege
against siege, seed 7, 3,101 ticks, 384 KB. Stress is the four-Core stress board
against itself, seed 1: tier 1 is 2,117 ticks and 3.09 MB, tier 3 is 2,318
ticks and 6.91 MB.

| Event type        | One plot (siege, seed 7) | Stress tier 1 | Stress tier 3 |
| ----------------- | ------------------------ | ------------ | ------------ |
| `unit_attacked`   | 32.4%                    | 33.9%        | 34.8%        |
| `delivered`       | 30.5%                    | 29.5%        | 29.1%        |
| `produced`        | 24.7%                    | 24.1%        | 23.8%        |
| `unit_spawned`    | 8.4%                     | 8.3%         | 8.5%         |
| `unit_died`       | 2.7%                     | 2.1%         | 2.3%         |
| `unit_retargeted` | 0.1%                     | 2.0%         | 1.4%         |
| all others        | 1.2%                     | 0.1%         | 0.1%         |

There is no per-tick movement event. Units move without logging.
Resource flow events (`produced` and `delivered`, always equal in count) are a
bit over half of an economy-heavy log. `unit_attacked` is about a third.

Logs are not saved. The budgets are met with margin: the largest one plot log
is 38% of its 1 MB budget and the dense tier 3 log is 58% of its 12 MB budget.
The size is accepted for now.

Coalescing flow events per building is the known option if co-op transport or
ghost replays later need smaller logs. It is estimated, not measured, to save
roughly 30 to 40% and would change the golden event log hashes.

## Simulating off the main thread (issue #53)

The Battle screen no longer runs `simulateRecord` on the main thread: it asks a
module Worker (`packages/web/src/sim-worker/`) and shows "Preparing the
battle" meanwhile. Browser smoke test, Chromium headless, the dense `stress`
sample (917 units alive at peak; run with `pnpm smoke`, single runs, shared
machine):

| Measure                                   | Main thread (fallback) | Worker             |
| ----------------------------------------- | ---------------------- | ------------------ |
| Longest main-thread task while preparing  | 408 ms (70 ms + 408)   | 53 to 122 ms (*)   |
| Simulation time                           | 371 ms                 | 319 to 426 ms      |
| Animation frames while preparing          | 4                      | 26 to 32           |
| Request to result (clone and transfer)    | -                      | simulation + 27 to 36 ms |
| Main-thread setup of playback (`prepare`) | -                      | 24 to 27 ms        |

(*) The remaining long task is the page receiving the message (structured
clone of the event log into the page's heap) and drawing the first frames of
the screen. It varied between runs (53, 63, 79 and 122 ms); the smoke check
limits it to 100 ms (scaled by the CI timing factor).

Transfer: the event log (plain objects) is copied by structured clone, about 30
ms for the stress battle's log (about 1 to 1.5 MB as JSON). The three typed
arrays of the record (`coreHp`, `tickStart`) are transferred, not copied. The
clone cost is roughly linear in the log size, so the largest log in this
document (5.1 MB, dense tier 3) should take about 100 to 150 ms in total, split
between the worker (serialising) and the page (deserialising, which is the
part that blocks); this was estimated, not measured. If it ever matters, send
the log in chunks of a few thousand events.

Still on the main thread (not measured here, only known to exist): generating
a four-plot map, ghost validation, enemy path previews, and the playback
engine re-stepping a battle to the saved tick after a mid-battle reload
(`Playback.seekTo`).
