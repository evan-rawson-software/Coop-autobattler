# Performance budget (CB-36, W1-10)

Baseline measurements of whole battles (`simulateBattle` / `startBattle` run to
the end, event log recorded) and the budget derived from them. The rules are in
[`rules-reference.md`](rules-reference.md) ("Battles"). The budget is enforced by
`packages/tools/src/sim/performance.test.ts` (W1-10) and, with looser limits,
by `packages/core/src/battle.test.ts` ("performance (CB-36)"). Both fail only
on a large regression, not on a slow machine.

**Status under the per-player design (issue #124).** Everything below was
measured on the rules as implemented today: one Core per side and no limit on
how fast a building consumes. Under the new design (specified in
`rules-reference.md`, "Per-player design", not yet implemented) the dense
four-plot board used here is no longer legal as a player-built board (a plot
has 4 resource nodes, so a four-plot board has 16 sources, not 48), unit
counts fall with scarcity, and each side needs one movement field and one
breach field per living enemy Core, not one of each. The budget is measured
again as part of the rebalance (issue #145); until then these
numbers describe the current code only.

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

**Soft unit collision (issue #82).** Until issue #82 units were circles that
could never overlap (issue #59): four relaxation passes and an acceptance step
that sent any mover that still overlapped back where it was. On a dense board
that gridlocked (about 60 percent of the movers were held every tick) and made
a tick with a thousand units cost 17 to 30 times as much as before the circles.
Since #82 units are pushed apart in ONE pass per tick and may overlap for a
while (see "Unit geometry" in the rules reference). Measured back to back on
the same sandbox (single runs, the machine shared with other work, so 10 to 30
percent noise; the dense rows are `pnpm exec tsx
packages/tools/src/sim/bench-report.ts`):

| Battle                                       | Hard collision (#59) | Soft collision (#82) |
| -------------------------------------------- | -------------------- | -------------------- |
| One plot, 128 reference battles: speed       | 87 to 96 battles/s   | 123 to 138 battles/s |
| One plot: longest log (JSON)                 | 438 KB               | 442 KB               |
| One plot: longest battle                     | 3101 ticks           | 3101 ticks           |
| One plot: peak units per side                | 32                   | 20                   |
| Dense four plots, tier 1: wall time          | 3.5 to 4.8 s         | 0.47 to 1.0 s        |
| Dense tier 1: ticks / peak / log             | 3101 / 699 / 2.73 MB | 1116 / 217 / 1.33 MB |
| Dense four plots, tier 3: wall time          | 8.1 to 9.3 s         | 1.0 to 1.1 s         |
| Dense tier 3: ticks / peak / log             | 3101 / 976 / 2.39 MB | 1575 / 568 / 5.09 MB |
| Dense tier 1: battles per second             | 0.3                  | 5.0 to 5.6           |

The dense stress battle (96 barracks in corridors two cells wide, mirrored
against itself) used to run until Overload kills both Cores at tick 3100; now
the units get through and both Cores fall to them at tick 1116 (tier 1) and
1575 (tier 3), before Overload starts at tick 1800. Because the log records
every fight, the tier 3 log is larger than before (5.1 MB against 2.4 MB: more
fighting, shorter battle). Against a weaker opponent (tier 1 against tier 3)
the stress battle ends with a Core kill at tick 376 instead of at the end of
the Overload decay.

The cost of a tick is now in the neighbour search of the single push pass
(each unit looks at the nine cells around it on a uniform grid, each pair once)
and in the decisions, not in the retries of the old acceptance step.

**Wide-front pathing (issue #82, part 2).** The field has eight directions,
units steer by the direction of the step and step around an ally that holds
its place, and ties go forward (see "Goals and movement fields" and
"Steering" in the rules reference). Armies now advance on a wide front, meet
earlier and fight longer instead of stalling in file, so battles last longer
and carry more events. Measured back to back on the same sandbox (single runs,
`pnpm exec tsx packages/tools/src/sim/bench-report.ts`, machine otherwise idle):

| Battle                                       | Soft collision (#82 part 1) | Wide fronts (#82 part 2) |
| -------------------------------------------- | --------------------------- | ------------------------ |
| One plot, 128 reference battles: speed       | 129 battles/s               | 149 battles/s            |
| One plot: longest log (JSON)                 | 445 KB                      | 440 KB                   |
| One plot: longest battle / peak units        | 3101 ticks / 20             | 3101 ticks / 20          |
| One plot: ended by a Core kill               | 80 of 128                   | 101 of 128               |
| Dense four plots, tier 1: wall time          | 0.60 s                      | 0.96 s                   |
| Dense tier 1: ticks / peak / log             | 1116 / 217 / 1.33 MB        | 1528 / 192 / 2.03 MB     |
| Dense four plots, tier 3: wall time          | 0.99 s                      | 1.9 s                    |
| Dense tier 3: ticks / peak / log             | 1575 / 568 / 5.09 MB        | 2514 / 615 / 8.20 MB     |
| Dense tier 1: battles per second             | 4.5                         | 2.9                      |
| Wall time per tick (dense tier 1 / tier 3)   | 0.54 / 0.63 ms              | 0.63 / 0.76 ms           |

The cost per tick rose by 15 to 20 percent (three decision passes, the 8-way
field and the search for a blocker in the unit's neighbourhood; the push pass
is unchanged) and the dense battles last 37 to 60 percent longer (the mirror
of an army against itself is no longer decided by both Cores falling in the
same tick while the armies are still stalled). One-plot battles got faster
because more of them end by a Core kill early. The dense tier 1 rate target of
5 battles a second is no longer met (2.9); the enforced floor of 0.7 is.

**One field per target Core (issue #133, PP-11).** A side now has a movement
field and a breach field for each living enemy Core, computed on first use and
dropped after every destruction, and every unit carries its own target. The
cost was measured on the dense four-plot board of the bench (tier 1 and
tier 3, mirrored against itself, single runs, machine shared with other work,
so 20 to 30 percent noise) with one Core per side (one field) and with four
Cores per side (a Core in every plot, owners by plot, so all four fields are
used):

| Dense four plots                      | One Core per side | Four Cores per side |
| ------------------------------------- | ----------------- | ------------------- |
| Tier 1: ticks / events                | 1528 / 23,808     | 2459 / 38,235       |
| Tier 1: wall time per tick            | 0.23 ms           | 0.28 ms             |
| Tier 3: ticks / events                | 2514 / 94,492     | 3101 / 113,884      |
| Tier 3: wall time per tick            | 0.68 ms           | 0.87 to 1.04 ms     |

The four-Core battles are different battles (units spread over four targets,
so they last longer), so compare the time per tick: 20 to 50 percent more with
four Cores, of which the fields are a small part (a field is one Dijkstra
over the arena, computed once per Core between two
destructions) and the rest is the longer fights. Rule b now looks at every
living enemy Core for each unit that is not busy, a loop of at most the party
size. The enforced floors are unchanged and still met; the budget is measured
again with the rebalance (issue #145).

Rows below are the earlier (stacking) baseline, kept for reference:

| Battle                                   | Wall time | Ticks | Peak units per side | Events | Event log (JSON) |
| ---------------------------------------- | --------- | ----- | ------------------- | ------ | ---------------- |
| One plot, one typical battle             | 5 ms      | 970   | 11                  | 3,653  | 261 KB           |
| One plot, mean (max) of 20 random        | 10 (40) ms | 940 (3101) | 13 (29)       | 2,659 (13,221) | 190 (942) KB |
| Two plots, mean (max) of 20 random       | 5 (9) ms  | 589 (914) | 17 (37)         | 2,975 (5,776)  | 211 (398) KB |
| Four plots, mean (max) of 20 random      | 9 (21) ms | 582 (1047) | 30 (62)        | 6,366 (10,593) | 447 (744) KB |
| Dense four plots, tier 1                 | 90-110 ms | 687   | 157                 | 13,078 | 968 KB           |
| Dense four plots, every building tier 3  | 212 ms    | 753   | 610                 | 44,974 | 3.24 MB          |

The mean columns of the "20 random" rows and the typical-battle row were measured with Overload at tick 2400; only the maximum tick was updated for #33 (the means can only have fallen).

The longest battles end at tick 3101: both Cores are destroyed by Overload
(Core decay) at tick 3100 at the latest (Overload starts at tick 1800, and
since #33 no longer at 2400, which made it 3701), so with the standard constants no
battle can last longer, and the 12000-tick cap (`maxBattleTicks`) is never
reached (40 random matchups, none came near it). Per-tick cost scales with the
number of units and buildings; the dense tier 3 battle costs about 0.28 ms per
tick on average with up to 1,220 units on the field.

## Budget (W1-10)

| Quantity                                | Budget                 | Measured (worst case) | Enforced by                                  |
| --------------------------------------- | ---------------------- | --------------------- | -------------------------------------------- |
| Units alive per side                    | 1,000                  | 615 (dense tier 3)    | `performance.test.ts`, exact                 |
| Battle length                           | 4,000 ticks            | 3,101                 | `performance.test.ts`, exact                 |
| Hard cap on battle length               | `maxBattleTicks` 12,000 | never reached        | the end conditions                           |
| One plot: battles per second (target)   | at least 100           | 129-149               | fails below 40 (about 3x)                    |
| Four plots, dense: battles per second   | at least 5 (**not met**) | 2.9 (tier 1)        | fails below 0.7 (about 4x)                   |
| Four plots, dense tier 3, one battle    | at most 1 s (**not met**) | 1.9 s              | fails above 6 s (about 3x)                   |
| Event log, one plot                     | 1 MB                   | 0.44 MB               | `performance.test.ts`, exact                 |
| Event log, four plots                   | 12 MB (was 8 MB, 5 MB) | 8.2 MB                | `performance.test.ts`, exact                 |

Where the budget is written once more: the `BUDGET` constant at the top of
`packages/tools/src/sim/performance.test.ts`. Keep the two in sync. The four
plot log budget was raised from 5 MB to 8 MB because battles that used to stall
for 3,101 ticks now end in under 2,000 with units fighting all the way (more
events per tick, fewer ticks), and from 8 MB to 12 MB by the wide-front
pathing (the dense tier 3 battle now runs 2,514 ticks and logs 8.2 MB).

**Benchmark.** `packages/tools/src/sim/performance.test.ts` (run by `pnpm
test`; about 1 minute since the dense battles take seconds, each test has a 30 to 120 s timeout):

- _One plot_: every ordered pair of the four reference boards (rush, fortify,
  siege, poor) at seeds 1 to 8, 128 battles, including the long stalls that
  end by Overload at tick 3100. The rate is battles completed per second of
  wall time, best of three rounds (`performance.now()`, allowed in `tools`
  only). Measured on the sandbox this was written on: 110 to 215 battles per
  second before the circle model, 87 to 96 with hard circles and 120 to 138
  with soft collision (the best of three 128-battle rounds; the first round is
  slower while the engine warms up).
- _Four plots_: the dense board below mirrored against itself, tier 1, four
  seeds, best of two rounds: 9 to 16 battles per second (60 to 110 ms each)
  before the circle model, 0.3 with hard circles and 5.0 to 5.6 with soft
  collision (the test uses two seeds). The tier 3 version runs twice for its
  time (about 210 ms before the circle model, 8 s with hard circles, 1.0 to 1.1
  s now) and, with tier 1, for the unit peak, length and log size (untimed,
  deterministic).

The enforced limits are about 3 times looser than the speed measured on the
sandbox this was written on (4 cores shared with other work, so the figures
move by 10 to 30 percent from run to run): one plot at least 40 battles per
second against 129 to 149 measured; dense tier 1 at least 0.7 per second
against 2.9; the tier 3 stress battle under 6 s against 1.9 s.
A slow or noisy CI runner passes and a regression of several times fails. CI
runs `pnpm -r run test`, so the package suites run in parallel and the
benchmark competes for CPU; if a runner turns out slower than that, widen the
margin rather than skip the check. The limits on
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
`maxWallsPerPlot + maxTurretsPerPlot` (66) buildings per plot (264 on four
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
battles) the longest battle was 3101 ticks (the party lost to the Overload decay of
its own Core in 12 of them) and none reached `maxBattleTicks`.

## Notes

- Flow events (`produced`, `delivered`, `lost`, `stalled`) are recorded for
  every item moved, so the log grows with throughput as well as with fighting;
  the log was not broken down by event type.
- The numbers do not include the neutral zone generation (one attempt in
  practice, microseconds), the summary timeline (a sample every 50 ticks) or
  any rendering.

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
