import {
  generateNeutralZoneWithStats,
  hashJson,
  type Json,
  type MapgenConfig,
  type NeutralZoneContent,
} from '@game/core';
import type { SimulationFn } from './prng.js';

/**
 * Golden-vector kind `neutral-zone`. Input `{ seed, partySize }`; the width is
 * `partySize * plotWidth`. Result `{ zone, hash, attempts }`.
 */
export function makeNeutralZoneKind(
  content: NeutralZoneContent,
  config: MapgenConfig,
): SimulationFn {
  return (input: Json) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('neutral-zone: input must be an object');
    }
    const o = input as Record<string, Json>;
    const seed = o['seed'];
    const partySize = o['partySize'];
    if (typeof seed !== 'number' || typeof partySize !== 'number') {
      throw new TypeError('neutral-zone: seed and partySize must be numbers');
    }
    const { zone, attempts } = generateNeutralZoneWithStats(
      seed,
      partySize * config.plotWidth,
      content,
      config,
    );
    return {
      result: {
        zone: zone as unknown as Json,
        hash: hashJson(zone),
        attempts,
      },
    };
  };
}
