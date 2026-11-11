# Performance budget (CB-36, W1-10)

Baseline measurements of whole battles (`simulateBattle` / `startBattle` run to
the end, event log recorded) and the budget derived from them. The rules are in
[`rules-reference.md`](rules-reference.md) ("Battles"). The budget is enforced by
`packages/tools/src/sim/performance.test.ts` (W1-10) and, with looser limits,
by `packages/core/src/battle.test.ts` ("performance (CB-36)"). Both fail only
on a large regression, not on a slow machine.

## Method

Wall time is `Date.now()` around the tick loop (including the per-tick count of
units for the peak), single run, Node on a cloud sandbox, no warm-up: use the
numbers as orders of magnitude. "Peak units" is the maximum number of units
alive on one side at the end of any tick. The event log size is the length of
`JSON.stringify(eventLog)`. The teams are:

- **Typical one plot**: `randomTeam` (test helper): a generated 24 x 16 board,
  a source on every resource node feeding a barracks, armory, turret or
  overclocker, and a few walls.
- **Dense four plot**: `bigBoard()`: a 96 x 16 board of 48 modules (source,
  splitter, two barracks), 96 barracks and 48 sources, mirrored against itself.
  "Every building at tier 3" is the same board with all sources and barracks at
  tier 3.

## Baseline

| Battle                                   | Wall time | Ticks | Peak units per side | Events | Event log (JSON) |
| ---------------------------------------- | --------- | ----- | ------------------- | ------ | ---------------- |
| One plot, one typical battle             | 5 ms      | 970   | 11                  | 3,653  | 261 KB           |
| One plot, mean (max) of 20 random        | 10 (40) ms | 940 (3701) | 13 (29)       | 2,659 (13,221) | 190 (942) KB |
| Two plots, mean (max) of 20 random       | 5 (9) ms  | 589 (914) | 17 (37)         | 2,975 (5,776)  | 211 (398) KB |
| Four plots, mean (max) of 20 random      | 9 (21) ms | 582 (1047) | 30 (62)        | 6,366 (10,593) | 447 (744) KB |
| Dense four plots, tier 1                 | 90-110 ms | 687   | 157                 | 13,078 | 968 KB           |
| Dense four plots, every building tier 3  | 212 ms    | 753   | 610                 | 44,974 | 3.24 MB          |

The longest battles end at tick 3701: both Cores are destroyed by Overload
(Core decay) at tick 3700 at the latest, so with the standard constants no
battle can last longer, and the 12000-tick cap (`maxBattleTicks`) is never
reached (40 random matchups, none came near it). Per-tick cost scales with the
number of units and buildings; the dense tier 3 battle costs about 0.28 ms per
tick on average with up to 1,220 units on the field.

## Budget (W1-10)

| Quantity                                | Budget                 | Measured (worst case) | Enforced by                                  |
| --------------------------------------- | ---------------------- | --------------------- | -------------------------------------------- |
| Units alive per side                    | 1,000                  | 610 (dense tier 3)    | `performance.test.ts`, exact                 |
| Battle length                           | 4,000 ticks            | 3,701                 | `performance.test.ts`, exact                 |
| Hard cap on battle length               | `maxBattleTicks` 12,000 | never reached        | the end conditions                           |
| One plot: battles per second (target)   | at least 100           | 110-215               | fails below 25 (6.6x idle, 3.5x loaded)      |
| Four plots, dense: battles per second   | at least 5             | 9-16 (tier 1)         | fails below 2 (7.5x idle, 4.5x loaded)       |
| Four plots, dense tier 3, one battle    | at most 1 s            | 0.21 s                | fails above 1.5 s (7x idle, 7x loaded)       |
| Event log, one plot                     | 1 MB                   | 0.89 MB               | `performance.test.ts`, exact                 |
| Event log, four plots                   | 5 MB                   | 3.24 MB               | `performance.test.ts`, exact                 |

Where the budget is written once more: the `BUDGET` constant at the top of
`packages/tools/src/sim/performance.test.ts`. Keep the two in sync.

**Benchmark.** `packages/tools/src/sim/performance.test.ts` (run by `pnpm
test`; about 5 s, each test has a 30 s timeout):

- _One plot_: every ordered pair of the four reference boards (rush, fortify,
  siege, poor) at seeds 1 to 8, 128 battles, including the long stalls that
  end by Overload at tick 3700. The rate is battles completed per second of
  wall time, best of three rounds (`performance.now()`, allowed in `tools`
  only). Measured on the sandbox this was written on: 110 to 215 battles per
  second (the best of three 128-battle rounds; the first round is slower
  while the engine warms up).
- _Four plots_: the dense board below mirrored against itself, tier 1, four
  seeds, best of three rounds: 9 to 16 battles per second (60 to 110 ms each).
  The tier 3 version runs once for its time (about 210 ms) and, with tier 1,
  for the unit peak, length and log size (untimed, deterministic).

The enforced limits are below the measured speed, so a slow or noisy CI
runner passes and a regression of several times fails. CI runs `pnpm -r run
test`, so the package suites run in parallel and the benchmark competes for
CPU; the margins are given idle (the benchmark alone) and loaded (three runs
of `pnpm test` from the repository root, 4 cores): one plot at least 25
battles per second against about 165 idle (6.6x) and 87 to 183 loaded (3.5x at
worst); dense tier 1 at least 2 per second against about 15 idle (7.5x) and
8.9 to 12.2 loaded (4.5x at worst; a slower 2-vCPU machine measured 3.5 to
5.9 under load, 1.7x); the tier 3 stress battle under 1.5 s against about
0.21 s idle and 0.18 to 0.21 s loaded (7x). The dense floor was lowered from 3
to 2 for that reason. The limits on
units, ticks and log bytes are deterministic and are checked at the budget
itself: change a board or a content file in a way that grows them and the test
fails until the budget (or the change) is reconsidered. The core tests
(`packages/core/src/battle.test.ts`, "performance (CB-36)") keep their own
looser limits (2 s, 10 s, 20 s) as an extra guard.

**Command-line check.** `pnpm sim batch --a rush --b fortify --count 300
--time` runs 300 one-plot battles and prints the wall time (see the README).

## PvE battles (W1-9)

A PvE battle (`startPveBattle`, see "PvE threats" in the rules reference) is the
same simulation with a scripted opponent. The threat side has no sources,
conduits or producers; its cost is its units and its stronghold buildings, both
bounded by configuration: a wave has at most `maxUnitsPerWavePerPlot` (12)
units per plot (48 on four plots) and a threat has at most 12 waves, so at most
576 threat units on a four-plot board, and a stronghold has at most
`maxWallsPerPlot + maxTurretsPerPlot` (76) buildings per plot (304 on four
plots). Late-round power comes from `unitStrengthPercent`, not from numbers.

Measured (reference `rush` board for one plot, the dense four-plot board above
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
battles) the longest battle was 3701 ticks and none reached `maxBattleTicks`.

## Notes

- Flow events (`produced`, `delivered`, `lost`, `stalled`) are recorded for
  every item moved, so the log grows with throughput as well as with fighting;
  the log was not broken down by event type.
- The numbers do not include the neutral zone generation (one attempt in
  practice, microseconds), the summary timeline (a sample every 50 ticks) or
  any rendering.
