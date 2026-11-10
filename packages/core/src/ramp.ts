/**
 * In-battle ramp helpers (W1-7): the Overload level (CB-12) and the capped
 * economy-building totals (SC-8..SC-10). Pure integer functions; the state
 * and the tick live in `arena-sim.ts`. See docs/rules-reference.md,
 * "In-battle ramp (economy buildings)" and "Overload".
 */

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
