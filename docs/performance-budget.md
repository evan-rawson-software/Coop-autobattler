# Performance budget (CB-36)

Baseline measurements of whole battles (`simulateBattle` / `startBattle` run to
the end, event log recorded) and the budget numbers proposed from them. The
rules are in [`rules-reference.md`](rules-reference.md) ("Battles"). The
benchmark tests are in `packages/core/src/battle.test.ts` ("performance
(CB-36)"); they assert the budgets below with generous timeouts, so they fail
only on a large regression, not on a slow machine.

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

## Proposed budgets

| Quantity                          | Budget            | Baseline worst case | Note |
| --------------------------------- | ----------------- | ------------------- | ---- |
| Units alive per side              | 1,000             | 610                 | Content and shop balance should stay below this; it is also what the playback has to draw. |
| Battle length                     | 4,000 ticks (400 s) | 3,701              | Fixed by Overload; `maxBattleTicks` (12,000) stays as a safety net. |
| Simulation time, one plot         | 100 ms            | 40 ms               | To completion on a developer machine. |
| Simulation time, four plots       | 1 s               | 0.21 s              | The dense board above is the stress case. |
| Event log, one plot               | 1 MB              | 0.94 MB             | JSON bytes; keep the log in memory only, store `(teams, seed)` and replay (CB-30). |
| Event log, four plots             | 5 MB              | 3.24 MB             | Same. |

The tests assert looser limits than these (2 s and 10 s for the one-plot and
dense four-plot battles, 20 s for the tier 3 stress battle) so that a slow CI
runner does not fail them; a regression that doubles the numbers above shows
up in these measurements rather than in the tests.

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
