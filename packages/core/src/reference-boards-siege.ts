/**
 * The fourth reference board (W1-10), kept apart from `reference-boards.ts`
 * so the original three and their golden vectors stay untouched. It uses the
 * same map (seed 5, party size 1) and Core position as the others. See
 * docs/rules-reference.md, "Reference boards".
 *
 * - `siege`: few, strong units. A tier 3 extractor on the Ore node at
 *   (10, 1) feeds a tier 3 barracks, a tier 2 extractor on (8, 8) feeds a
 *   tier 2 armory (a strength bonus for the soldiers spawned later), and a
 *   tier 2 extractor on (21, 4) feeds a tier 2 range (archers); a tier 1
 *   extractor on the Power node at (19, 5) feeds a tier 1 hangar (drones).
 *   No walls. Shop value 330 gold, the same as `rush` and `fortify`.
 */

import type { ArenaContent } from './arena.js';
import type { Json } from './hash.js';
import type { MapgenConfig } from './mapgen.js';
import {
  REFERENCE_SEED,
  buildReferenceBoard,
  referenceBoardScript,
  type ReferenceBoardName,
  type TeamScript,
} from './reference-boards.js';
import { runTeamStateOps } from './team-state-ops.js';
import type { TeamState } from './team-state.js';

/** The three original boards plus `siege`. */
export type AnyReferenceBoardName = ReferenceBoardName | 'siege';

/** Every reference board, in a fixed order. */
export const ALL_REFERENCE_BOARDS: readonly AnyReferenceBoardName[] = [
  'rush',
  'fortify',
  'siege',
  'poor',
];

function siegeScript(): TeamScript {
  const ops: Json[] = [];
  let nextId = 1;
  ops.push({ op: 'placeCore', actor: 0, x: 11, y: 5 });
  const put = (def: string, x: number, y: number, tier: number): number => {
    const id = nextId++;
    ops.push({ op: 'addToStash', def, tier, owner: 0 });
    ops.push({ op: 'placeFromStash', actor: 0, id, x, y, rotation: 0 });
    return id;
  };
  const feed = (from: number, to: number): void => {
    ops.push({
      op: 'addConduit',
      actor: 0,
      from: { building: from, side: 'north' },
      to: { building: to, side: 'south' },
      cells: [],
    });
  };
  const e1 = put('bld_extractor', 10, 1, 3);
  feed(e1, put('bld_barracks', 9, 2, 3));
  const e2 = put('bld_extractor', 8, 8, 2);
  feed(e2, put('bld_armory', 8, 9, 2));
  const e3 = put('bld_extractor', 19, 5, 1);
  feed(e3, put('bld_hangar', 19, 6, 1));
  const e4 = put('bld_extractor', 21, 4, 2);
  feed(e4, put('bld_range', 21, 5, 2));
  return { seed: REFERENCE_SEED, partySize: 1, ops };
}

/** The `team-state-ops` script of any reference board. */
export function anyReferenceBoardScript(
  name: AnyReferenceBoardName,
): TeamScript {
  return name === 'siege' ? siegeScript() : referenceBoardScript(name);
}

/** Build any reference board; throws if an operation of its script is rejected. */
export function buildAnyReferenceBoard(
  name: AnyReferenceBoardName,
  content: ArenaContent,
  mapgen: MapgenConfig,
): TeamState {
  if (name !== 'siege') return buildReferenceBoard(name, content, mapgen);
  const { results, state } = runTeamStateOps(
    siegeScript() as unknown as Json,
    content,
    mapgen,
  );
  results.forEach((r, i) => {
    const o = r as { ok?: boolean; reason?: string };
    if (o.ok !== true) {
      throw new Error(
        `Reference board "siege": operation ${String(i)} was rejected (${o.reason ?? 'unknown'}).`,
      );
    }
  });
  return state;
}
