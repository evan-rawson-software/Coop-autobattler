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
- Movement: see step 5. Relaxation (Jacobi pushes, anchored units immovable),
  then a validation fixpoint that reverts to the previous position every unit
  that would end in an overlap; that is the guarantee of the invariant.
- No `unit_moved` event: playback reads positions from its own re-stepped sim.
  `unit_spawned` carries `px, py`.
- Producer hold: a producer with `progress >= costPerUnit` takes nothing from
  its buffers; waves queue in `state.entering`.

## Stages (see the task)

- [x] A. Rules text (rules-reference, 03-combat)
- [ ] B. Content / schema / loader / threats
- [ ] C. Simulation
- [ ] D. Web playback / draw, CLI, ASCII
- [ ] E. Tests (invariants, fuzz, geometry), performance
- [ ] F. Golden vectors regenerated + new ones
- [ ] G. Measurements (batch stats, PvE sweep)

## Baseline (before this change)

Dense four plot tier 1: 195 ms, 687 ticks, peak 157 units, 968 KB log. Tier 3:
240 ms, 753 ticks, peak 610, 3.24 MB. One plot: max log 739 KB, 216 battles/s.
Dense tier 1: 14.9 battles/s. (`pnpm exec tsx packages/tools/src/sim/bench-report.ts`)
Mirror matchups (issue #33): attacker wins 93.0% / 0.3% / 100% / 99.7% / 96.7%
/ 99.0% for rush-rush, rush-fortify, fortify-rush, fortify-fortify,
siege-siege, poor-poor.
