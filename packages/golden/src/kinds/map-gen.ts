import {
  generateMapWithStats,
  hashJson,
  type Json,
  type MapContent,
  type MapgenConfig,
} from '@game/core';
import type { SimulationFn } from './prng.js';

/**
 * Golden-vector kind `map-gen`. Input `{ seed, partySize }`; the result is
 * `{ map, hash, attempts }` with `hash = hashJson(map)`. The content and
 * configuration are supplied by the package that registers the kind.
 */
export function makeMapGenKind(
  content: MapContent,
  config: MapgenConfig,
): SimulationFn {
  return (input: Json) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('map-gen: input must be an object');
    }
    const o = input as Record<string, Json>;
    const seed = o['seed'];
    const partySize = o['partySize'];
    if (typeof seed !== 'number' || typeof partySize !== 'number') {
      throw new TypeError('map-gen: seed and partySize must be numbers');
    }
    const { map, attempts } = generateMapWithStats(
      seed,
      partySize,
      content,
      config,
    );
    return {
      result: { map, hash: hashJson(map), attempts },
    };
  };
}
