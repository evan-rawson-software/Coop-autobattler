/**
 * The neutral guards of the points of interest (CB-8c, CB-8e): how many of
 * which unit a point starts with in a given round. Pure planning, from the
 * battle seed, the round and `content/points.json`; the arena places the
 * units (`placeGuards` in arena-sim.ts). See docs/rules-reference.md,
 * "Neutral guards".
 */

import { divFloor, mulDiv } from './int.js';
import { MAX_DAMAGE, MAX_HEALTH } from './limits.js';
import type { GuardsConfig } from './points.js';
import { Rng } from './rng.js';
import { GENERIC_BUDGET_LIMIT, growBudget } from './threats.js';
import type { UnitConfig, UnitId } from './units.js';
import { pickWeightedIndex } from './weighted.js';

/** Child-stream label of the guards under the battle seed's root generator. */
export const GUARDS_STREAM = 'guards';

/** One guard to place: its unit and the strength percent it is spawned with. */
export interface PlannedGuard {
  readonly unit: UnitId;
  readonly strengthPercent: number;
}

/** The guards of one point, in placement order. */
export interface GuardPlan {
  /** The point's `id`. */
  readonly point: number;
  readonly guards: readonly PlannedGuard[];
}

/**
 * The budget of one point in `round` (CB-8e): `baseBudget` grown by
 * `growthPercent` per round after round 1, with the threat budget's integer
 * math (`growBudget`, SC-1).
 */
export function guardBudget(guards: GuardsConfig, round: number): number {
  return growBudget(
    guards.baseBudget,
    guards.growthPercent,
    round,
    GENERIC_BUDGET_LIMIT,
  );
}

/**
 * The largest strength percent a unit of `health` and `damage` can be given
 * and stay within `MAX_HEALTH` and `MAX_DAMAGE` (`mulPct(value, 100 + P)` at
 * most the bound for both).
 */
export function maxGuardStrength(health: number, damage: number): number {
  const room = (value: number, bound: number): number =>
    value <= 0
      ? Number.MAX_SAFE_INTEGER
      : divFloor((bound + 1) * 100 - 1, value) - 100;
  return Math.max(
    0,
    Math.min(room(health, MAX_HEALTH), room(damage, MAX_DAMAGE)),
  );
}

/**
 * The guards of one point. The draws come from `rng`
 * (`Rng.fromSeed(battleSeed).child("guards").child(pointId)`):
 *
 * 1. `budget = guardBudget(guards, round)`, `left = budget`.
 * 2. While fewer than `maxGuardsPerPoint` guards are drawn: the units with
 *    `cost <= left`, in file order; none: stop. Otherwise one
 *    `pickWeightedIndex` over their weights picks the next guard and its cost
 *    leaves `left`.
 * 3. With `spent = budget - left`: the strength percent of every guard of the
 *    point is `floor(left * 100 / spent)` (0 when nothing was bought), capped
 *    per unit by `maxGuardStrength` (a cap, not an error).
 */
export function planPointGuards(
  guards: GuardsConfig,
  units: UnitConfig,
  round: number,
  rng: Rng,
  point: number,
): GuardPlan {
  const budget = guardBudget(guards, round);
  let left = budget;
  const drawn: UnitId[] = [];
  while (drawn.length < guards.maxGuardsPerPoint) {
    const affordable = guards.units.filter((g) => g.cost <= left);
    if (affordable.length === 0) break;
    const pick = affordable[
      pickWeightedIndex(
        rng,
        affordable.map((g) => g.weight),
      )
    ] as (typeof affordable)[number];
    drawn.push(pick.unit);
    left -= pick.cost;
  }
  const spent = budget - left;
  const percent = spent > 0 && left > 0 ? mulDiv(left, 100, spent) : 0;
  return {
    point,
    guards: drawn.map((unit) => {
      const def = units.get(unit);
      if (def === undefined) throw new Error(`Unknown guard unit "${unit}".`);
      return {
        unit,
        strengthPercent: Math.min(
          percent,
          maxGuardStrength(def.health, def.damage),
        ),
      };
    }),
  };
}

/**
 * The guards of every point of a zone, in point `id` order (CB-8e): the
 * guards of point `p` are drawn from `Rng.fromSeed(battleSeed)
 * .child("guards").child(p)`, so a point's guards do not depend on the other
 * points.
 */
export function planGuards(
  guards: GuardsConfig,
  units: UnitConfig,
  round: number,
  battleSeed: number,
  pointIds: readonly number[],
): GuardPlan[] {
  const root = Rng.fromSeed(battleSeed).child(GUARDS_STREAM);
  return pointIds.map((id) =>
    planPointGuards(guards, units, round, root.child(id), id),
  );
}
