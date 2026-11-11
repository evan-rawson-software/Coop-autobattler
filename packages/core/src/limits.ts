/**
 * Content and run-time bounds that keep every outcome-affecting sum and
 * product an exact integer (|x| <= 2^53 - 1 = 9.007e15).
 *
 * The simulation uses plain IEEE-754 doubles holding integers, and the
 * checked helpers in `int.ts` throw instead of rounding. The bounds below make
 * sure the checks never fire for content within the caps; where a value can
 * grow without a content bound (damage sums), the rule saturates instead.
 *
 * Derivation, with `MAX_HEALTH = MAX_DAMAGE = 1e12`:
 * - Breach cost of one cell: an open cell 1, a cell under a building
 *   `base + ceil(health / perCost)`, at most `MAX_BREACH_BASE_COST +
 *   MAX_HEALTH = 1e6 + 1e12 = 1.000001e12`.
 * - A least-cost route enters each cell at most once, so a distance is at
 *   most `MAX_ARENA_CELLS * 1.000001e12 = 8192 * 1.000001e12 < 8.2e15`, below
 *   `2^53 - 1 = 9.007e15`. The heap compares `(distance, cell)` pairs, so no
 *   product with the cell count is formed. Four shipped plots with the
 *   neutral zone are 3744 cells, more than twice below `MAX_ARENA_CELLS`.
 *   (`through = d + cost` is checked with `addInt` and is at most the same
 *   bound, because it is itself a route distance.)
 * - The time-limit rule compares two fractions `hp / max` exactly with
 *   `compareFractions` (Euclid), which never multiplies, so any two safe
 *   integers work.
 * - A unit's scaled health and damage, `floor(v * (100 + P) / 100)`, is held
 *   to the caps; the product `v * (100 + P)` is then at most `100 * 1e12 +
 *   99 < 1.1e14`. A modifier percent sum `100 + S` multiplies a health or
 *   damage of at most 1e12 and must keep the product below 2^53 - 1, so `S`
 *   up to 8907 is safe and more throws `RangeError` at setup.
 * - Overload multiplies a hit by `100 + level * step` percent (`level` at most
 *   the level at `maxBattleTicks`); `createArenaSim` checks that no unit's
 *   hit or Core decay exceeds `MAX_HIT`, so a hit is at most 2^51.
 * - Damage dealt to one target in one tick is summed with a saturating add at
 *   `MAX_TICK_DAMAGE = 2^52`: each hit is at most `MAX_HIT = 2^51` (so a
 *   partial sum plus a hit is below 2^53 and exact) and a sum that reaches the
 *   cap stays there. Health is at most 1e12, so a target that takes the cap
 *   is long dead. Only the Core overkill tiebreak can tell it apart, and it
 *   compares `hp - damage`, not the damages: when both Cores' sums saturate,
 *   the damages are equal, so the Core with the higher pre-tick health has
 *   the less negative `hp - damage`, less overkill, and wins.
 * - The tiebreak counter `buildingDamageDealt` of a side sums, over ticks and
 *   enemy buildings, `min(attack damage that tick, health before the tick)`.
 *   Each building yields at most its maximum health (a credit also lowers its
 *   health by at least that much), so at most `MAX_HEALTH`, and there are at
 *   most `MAX_ARENA_CELLS` buildings: the total is below `8192 * 1e12 =
 *   8.192e15 < 2^53 - 1`, exact, summed with the checked `addInt` (it never
 *   throws for content within the caps).
 */

/** Largest health a building tier or unit may declare, and the largest a
 * run-time scaled health or Core health override may reach. */
export const MAX_HEALTH = 1_000_000_000_000;

/** Largest damage a unit or turret tier may declare (damage is summed per
 * target per tick, so it is held to the same bound as health). */
export const MAX_DAMAGE = MAX_HEALTH;

/** Largest `breachBaseCost` and `breachHealthPerCost` in `sim.json`. */
export const MAX_BREACH_BASE_COST = 1_000_000;

/** Largest arena (cells) the breach field is computed for. */
export const MAX_ARENA_CELLS = 8192;

/** Throws a RangeError naming `what` unless `value` is in `[min, max]`. */
export function assertWithin(
  value: number,
  min: number,
  max: number,
  what: string,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(
      `${what} must be an integer from ${String(min)} to ${String(max)}, got ${String(value)}.`,
    );
  }
}

/** Largest damage dealt to one target in one tick (the sum saturates here). */
export const MAX_TICK_DAMAGE = 2 ** 52;

/** Largest single hit after Overload scaling. */
export const MAX_HIT = MAX_TICK_DAMAGE / 2;

/** Sub-cell units per arena cell: positions, radii and reach are in these. */
export const CELL_UNITS = 240;

/** Largest `radius` and `collisionRadius` of a unit (two cells). */
export const MAX_UNIT_RADIUS = 2 * CELL_UNITS;

/** Largest `reach` of a unit (eight cells). */
export const MAX_UNIT_REACH = 8 * CELL_UNITS;

/** Largest `separationCap` in `sim.json` (sub-cell units a pair moves apart per tick). */
export const MAX_SEPARATION_CAP = 480;
