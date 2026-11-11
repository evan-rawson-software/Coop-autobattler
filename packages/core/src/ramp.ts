/**
 * In-battle ramp helpers (W1-7): the Overload level (CB-12) and the capped
 * economy-building totals (SC-8..SC-10). Pure integer functions; the state
 * and the tick live in `arena-sim.ts`. See docs/rules-reference.md,
 * "In-battle ramp (economy buildings)" and "Overload".
 */

import { addInt, divFloor, mulInt } from './int.js';
import type { SimConfig } from './sim-config.js';

/**
 * The Overload level at a tick: 0 before `overloadStartTick`, then
 * `1 + floor((tick - overloadStartTick) / overloadIntervalTicks)`.
 */
export function overloadLevel(tick: number, config: SimConfig): number {
  if (tick < config.overloadStartTick) return 0;
  return (
    1 +
    Math.floor((tick - config.overloadStartTick) / config.overloadIntervalTicks)
  );
}

/**
 * True on the ticks where Overload applies Core decay: `level >= 1` and
 * `(tick - overloadStartTick)` is a multiple of `overloadIntervalTicks`.
 * These are also the ticks at which the level rises.
 */
export function isOverloadBeat(tick: number, config: SimConfig): boolean {
  return (
    tick >= config.overloadStartTick &&
    (tick - config.overloadStartTick) % config.overloadIntervalTicks === 0
  );
}

/** The percent bonus of a side for one effect: the raw sum, capped. */
export function cappedBonus(rawPercent: number, capPercent: number): number {
  return Math.min(rawPercent, capPercent);
}

/** The Overload schedule against one Core health (see `overloadDeadline`). */
export interface OverloadDeadline {
  /** The first tick of Overload (level 1, first Core decay). */
  readonly startTick: number;
  /**
   * The tick of the Overload beat at which the Core decay alone (the total
   * of `level * overloadCoreDamageStep` over the beats so far, no other
   * damage at all) has taken a Core of the given maximum health to 0 or
   * below: that Core is destroyed on this tick unless it fell earlier. `null`
   * when `overloadCoreDamageStep` is 0 (the decay never kills).
   */
  readonly decayDestroysTick: number | null;
  /** The Overload level at `decayDestroysTick` (`null` with it). */
  readonly decayDestroysLevel: number | null;
}

/**
 * When Overload starts and when its flat Core decay alone destroys a Core of
 * `coreMaxHealth` (an integer >= 1). With `n` beats the decay has taken
 * `overloadCoreDamageStep * n * (n + 1) / 2` health, and beat `n` is at tick
 * `overloadStartTick + (n - 1) * overloadIntervalTicks`; the answer is the
 * first beat where that total reaches `coreMaxHealth`. This is a deadline for
 * a Core that is not damaged otherwise: damage from units or turrets makes it
 * earlier. In PvE (CB-29) the party must destroy the stronghold before this
 * tick of its own (smaller) Core; see docs/rules-reference.md, "Overload".
 * Exact integers (`RangeError` if a product would leave the safe range).
 */
export function overloadDeadline(
  config: SimConfig,
  coreMaxHealth: number,
): OverloadDeadline {
  if (!Number.isSafeInteger(coreMaxHealth) || coreMaxHealth < 1) {
    throw new RangeError(
      `overloadDeadline: coreMaxHealth must be a positive integer, got ${String(coreMaxHealth)}.`,
    );
  }
  const step = config.overloadCoreDamageStep;
  if (step === 0) {
    return {
      startTick: config.overloadStartTick,
      decayDestroysTick: null,
      decayDestroysLevel: null,
    };
  }
  const decayAfter = (n: number): number =>
    mulInt(step, divFloor(mulInt(n, n + 1), 2));
  // decayAfter(n) >= n * (n + 1) / 2 >= n^2 / 2, so n = ceil(sqrt(2 * H))
  // certainly reaches H. The search is exact: only decayAfter decides.
  let lo = 1;
  let hi = Math.ceil(Math.sqrt(2 * coreMaxHealth)) + 1;
  while (lo < hi) {
    const mid = divFloor(lo + hi, 2);
    if (decayAfter(mid) >= coreMaxHealth) hi = mid;
    else lo = mid + 1;
  }
  return {
    startTick: config.overloadStartTick,
    decayDestroysTick: addInt(
      config.overloadStartTick,
      mulInt(lo - 1, config.overloadIntervalTicks),
    ),
    decayDestroysLevel: lo,
  };
}
