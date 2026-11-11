/** Weighted choice over integer weights. */

import type { Rng } from './rng.js';

/**
 * Pick an index with probability proportional to its weight. Weights are
 * non-negative integers with a positive sum. Consumes exactly one
 * `rng.nextInt(total)`; the draw `x` selects the first index whose running
 * total of weights exceeds `x`. Zero-weight entries are never chosen.
 */
export function pickWeightedIndex(
  rng: Rng,
  weights: readonly number[],
): number {
  let total = 0;
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0) {
      throw new RangeError(
        `weight must be a non-negative integer: ${String(w)}`,
      );
    }
    total += w;
  }
  if (total < 1) throw new RangeError('weights must have a positive sum');
  const x = rng.nextInt(total);
  let running = 0;
  for (let i = 0; i < weights.length; i++) {
    running += weights[i] as number;
    if (x < running) return i;
  }
  throw new Error('unreachable: draw below total');
}
