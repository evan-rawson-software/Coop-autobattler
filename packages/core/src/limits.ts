/**
 * Content and run-time bounds that keep the breach computation exact.
 *
 * `computeBreach` (CB-20) sums per-cell costs along a route and packs
 * `distance * cellCount + cell` into one heap key; the battle's time-limit
 * rule multiplies two Core healths. All of it is plain IEEE-754 doubles, so
 * every value must stay a safe integer (|x| <= 2^53 - 1).
 *
 * Derivation, for the largest supported board:
 * - A cell costs at most `MAX_BREACH_BASE_COST + ceil(MAX_HEALTH / 1)`, which
 *   is `1.1e7` (an open cell costs 1).
 * - A shortest route enters each cell at most once, so a distance is at most
 *   `MAX_ARENA_CELLS * 1.1e7 = 16384 * 1.1e7 < 1.81e11`. Four plots of the
 *   shipped content (24 x 16 each) with the neutral zone are 96 x 39 = 3744
 *   cells, so 16384 is more than four times the largest supported board.
 * - A heap key is at most `(1.81e11 + 1.1e7) * 16384 + 16383 < 2.97e15`,
 *   below 2^53 - 1 = 9.007e15 with a factor of three to spare.
 * - Two Core healths multiply to at most `MAX_HEALTH^2 = 1e14`.
 */

/** Largest health a building tier or unit may declare, and the largest a
 * run-time scaled health or Core health override may reach. */
export const MAX_HEALTH = 10_000_000;

/** Largest damage a unit or turret tier may declare (damage is summed per
 * target per tick, so it is held to the same bound as health). */
export const MAX_DAMAGE = MAX_HEALTH;

/** Largest `breachBaseCost` and `breachHealthPerCost` in `sim.json`. */
export const MAX_BREACH_BASE_COST = 1_000_000;

/** Largest arena (cells) the breach field is computed for. */
export const MAX_ARENA_CELLS = 16_384;

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
