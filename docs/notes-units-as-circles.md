# Notes: units as circles (issues #59 part 1 and #66)

Working note for whoever continues this branch (`combat-59-circles-part1`).
The rules are in `docs/rules-reference.md` ("Unit geometry", "One battle
tick" steps 2, 3, 5, "Goals and movement fields", "Side options"); this file
only tracks progress and decisions. Delete it when part 1 is merged.

## Decisions

- Scale `CELL_UNITS = 240` sub-cell units per cell (placeholder radii and the
  speeds from the move cooldowns are exact integers: soldier radius 72,
  raider 60, speed `floor(240 / moveCooldownTicks)` = 40 and 60).
- Unit state: `{id, side, def, px, py, hp, damage, attackCooldown}`
  (`moveCooldown` is gone). Content: `radius`, `collisionRadius`, `reach`,
  `moveCooldownTicks`, `flying` (must be false), `attackType` ("melee"); the
  `targeting` and `rangeCells` fields are gone.
- #66: one goal (the enemy Core), one movement field per side. `unit_raider`
  stays as a small, fast, weak ordinary unit; the Boss signature stays "every
  third wave is raiders only" (a fast swarm), it no longer means anything
  about buildings.
- Movement (`unit-motion.ts`, rules step 5): desire, up to 4 Jacobi relaxation
  passes (the mover farther from its target takes the push; anchored units are
  immovable; equal priority shares), then an acceptance step: movers that
  clear everything move, the rest are decided nearest-to-target first and stay
  at their old position when `T` would overlap something. That step is the
  guarantee of the invariant (and the earlier "revert the whole connected
  group" version deadlocked on knots, so do not go back to it).
- Mirror symmetry (a documented property, tested) needs: the cell of a unit
  taken in its side's frame (`ownCellCoord`), `pushOutSolid` in the side's
  frame, equal-priority movers sharing pushes, equal-priority runs decided
  together. Keep these when changing anything.
- No `unit_moved` event: playback reads positions from its own re-stepped sim.
  `unit_spawned` carries `px, py`.
- Producer hold: a producer with `progress >= costPerUnit` takes nothing from
  its buffers; waves queue in `state.entering`.

## Status

All stages A to G are done and committed; the rules text, the golden vectors
and the performance numbers are current. Open ends for a reviewer or for
part 2:

- Performance is worse than the old budget: see `docs/performance-budget.md`
  (the dense stress battle now lasts until Overload, 3101 ticks, and costs
  about 1.2 ms a tick; one plot runs at about 60 battles a second).
- Known behaviour to look at: the field's "lowest own-frame y first" tie key
  makes units walk sideways along their front row to the Core's column before
  going forward (a conga line); wide waves therefore take a while to leave
  the row and the middle of the row jams.
- Part 2 needs: ranged `reach` + projectiles (reach is already an edge gap in
  sub-cell units, `attackType` is reserved), flying units (`flying`,
  `collisionRadius` smaller than `radius`; motion must skip ground
  collisions), turrets engaging in the neutral zone (turret targeting is in
  `fireTurrets`, the owner-rows test is one line), new unit types (content
  only for ground units).

## Measurements

Before (cell model): dense four plot tier 1: 195 ms, 687 ticks, peak 157
units, 968 KB log. Tier 3: 240 ms, 753 ticks, peak 610, 3.24 MB. One plot: max
log 739 KB, 216 battles/s. Dense tier 1: 14.9 battles/s.
After: see `docs/performance-budget.md`.
(`pnpm exec tsx packages/tools/src/sim/bench-report.ts`)

Mirror matchups, attacker win rate with 300 seeds (issue #33 figures first):
rush-rush 93.0% -> 93.3%, rush-fortify 0.3% -> 0.0%, fortify-rush 100% ->
100%, fortify-fortify 99.7% -> 100%, siege-siege 96.7% -> 83.7%, poor-poor
99.0% -> 95.7%.
