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

/** The percent bonus of one player for one effect: the raw sum, capped. */
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
   * when `overloadCoreDamageStep` is 0 (the decay never kills) and when that
   * tick is not within the battle: a battle processes ticks
   * `0 .. maxBattleTicks - 1` (it ends after the step of tick
   * `maxBattleTicks - 1`), so a beat at or after `maxBattleTicks` never lands.
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
 * earlier. A deadline at or after `config.maxBattleTicks` is not within the
 * battle: the fields are `null` (the battle ends at the time limit first; the
 * most decay that can land with the shipped configuration is 26,265). The
 * decay applies equally to both Cores, so a screen must compute
 * the deadline for BOTH Cores (or call `overloadOutcome`) and show which one
 * falls first: the Core with less health. In PvE (CB-29) the stronghold's
 * Core is often smaller than the party's 500 (then it falls first and the
 * party wins by outlasting it, an intended way to win) and sometimes larger
 * (then the party must break it before its own deadline); see
 * docs/rules-reference.md, "Overload". Exact integers (`RangeError` if a product would leave the safe
 * range).
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
  const never: OverloadDeadline = {
    startTick: config.overloadStartTick,
    decayDestroysTick: null,
    decayDestroysLevel: null,
  };
  if (step === 0) {
    return never;
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
  const tick = addInt(
    config.overloadStartTick,
    mulInt(lo - 1, config.overloadIntervalTicks),
  );
  // The last tick processed is maxBattleTicks - 1 (battle.ts ends the battle
  // once the tick counter reaches maxBattleTicks, after that tick's decay).
  if (tick >= config.maxBattleTicks) return never;
  return {
    startTick: config.overloadStartTick,
    decayDestroysTick: tick,
    decayDestroysLevel: lo,
  };
}

/** Which side loses its last Core to the Overload decay first (`overloadOutcome`). */
export interface OverloadOutcome {
  /** `'a'`/`'b'`: that side loses its last Core first; `'both'`: on the same tick; `null`: the decay does not strip either side within the battle. */
  readonly first: 'a' | 'b' | 'both' | null;
  /** The last-Core tick of the first side (`null` with `first`). */
  readonly tick: number | null;
}

/**
 * Which side the Overload decay alone strips of its last Core first, and on
 * which tick, given each side's Cores' maximum health (before the battle
 * ends at `maxBattleTicks`, see `overloadDeadline`). Every living Core takes
 * the full decay, so a side's **last-Core tick** is the largest
 * `decayDestroysTick` of its Cores, or `null` if the decay does not destroy
 * one of them within the battle (or the side has no Core). The side with the
 * smaller last-Core tick is first; equal ticks give `'both'`; a side whose
 * tick is `null` never comes first. Other damage is ignored (it only makes a
 * fall earlier).
 */
export function overloadOutcome(
  config: SimConfig,
  coresA: readonly number[],
  coresB: readonly number[],
): OverloadOutcome {
  const last = (cores: readonly number[]): number | null => {
    if (cores.length === 0) return null;
    let worst = 0;
    for (const max of cores) {
      const t = overloadDeadline(config, max).decayDestroysTick;
      if (t === null) return null;
      if (t > worst) worst = t;
    }
    return worst;
  };
  const a = last(coresA);
  const b = last(coresB);
  if (a === null) {
    return b === null ? { first: null, tick: null } : { first: 'b', tick: b };
  }
  if (b === null) return { first: 'a', tick: a };
  if (a === b) return { first: 'both', tick: a };
  return a < b ? { first: 'a', tick: a } : { first: 'b', tick: b };
}
