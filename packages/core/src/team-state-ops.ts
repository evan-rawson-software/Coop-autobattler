/**
 * Golden-vector kind `team-state-ops`. Input `{ seed, partySize, ops }` where
 * each op is `{ op, ...args }` (`addToStash` {def, tier, owner}; `placeCore`
 * {x, y}; `placeFromStash` and `moveBuilding` {id, x, y, rotation};
 * `returnToStash` and `removeFromStash` {id}). The map is `generateMap(seed,
 * partySize)`. Result: `{ results, state, hash }` with one result per op
 * (`{ op, ok: true }` plus `id` for addToStash, or `{ op, ok: false, reason }`)
 * and `hash = hashJson(state)`.
 */
import { generateMap } from './generate-map.js';
import { hashJson, type Json } from './hash.js';
import type { SimulationFn } from './golden-kinds.js';
import type { MapContent } from './map.js';
import type { MapgenConfig } from './mapgen.js';
import {
  addToStash,
  createTeamState,
  moveBuilding,
  placeCore,
  placeFromStash,
  removeFromStash,
  returnToStash,
  type TeamState,
} from './team-state.js';

function rec(v: Json | undefined, what: string): Record<string, Json> {
  if (
    v === null ||
    v === undefined ||
    typeof v !== 'object' ||
    Array.isArray(v)
  ) {
    throw new TypeError(`team-state-ops: ${what} must be an object`);
  }
  return v as Record<string, Json>;
}

function int(o: Record<string, Json>, key: string): number {
  const v = o[key];
  if (typeof v !== 'number') {
    throw new TypeError(`team-state-ops: ${key} must be a number`);
  }
  return v;
}

type Outcome =
  { ok: true; state: TeamState; id?: number } | { ok: false; reason: string };

export function makeTeamStateOpsKind(
  content: MapContent,
  config: MapgenConfig,
): SimulationFn {
  return (input: Json) => {
    const o = rec(input, 'input');
    const ops = o['ops'];
    if (!Array.isArray(ops)) {
      throw new TypeError('team-state-ops: ops must be an array');
    }
    const map = generateMap(
      int(o, 'seed'),
      int(o, 'partySize'),
      content,
      config,
    );
    let state: TeamState = createTeamState(map);
    const results: Json[] = [];
    for (const raw of ops) {
      const a = rec(raw as Json, 'op');
      const name = a['op'];
      let outcome: Outcome;
      switch (name) {
        case 'addToStash': {
          const def = a['def'];
          if (typeof def !== 'string') {
            throw new TypeError('team-state-ops: def must be a string');
          }
          outcome = addToStash(state, content, {
            def,
            tier: int(a, 'tier'),
            owner: int(a, 'owner'),
          });
          break;
        }
        case 'placeCore':
          outcome = placeCore(state, content, config, {
            x: int(a, 'x'),
            y: int(a, 'y'),
          });
          break;
        case 'placeFromStash':
          outcome = placeFromStash(state, content, {
            id: int(a, 'id'),
            x: int(a, 'x'),
            y: int(a, 'y'),
            rotation: int(a, 'rotation'),
          });
          break;
        case 'moveBuilding':
          outcome = moveBuilding(state, content, {
            id: int(a, 'id'),
            x: int(a, 'x'),
            y: int(a, 'y'),
            rotation: int(a, 'rotation'),
          });
          break;
        case 'returnToStash':
          outcome = returnToStash(state, content, { id: int(a, 'id') });
          break;
        case 'removeFromStash':
          outcome = removeFromStash(state, { id: int(a, 'id') });
          break;
        default:
          throw new TypeError('team-state-ops: unknown op');
      }
      if (outcome.ok) {
        state = outcome.state;
        results.push(
          outcome.id === undefined
            ? { op: name, ok: true }
            : { op: name, ok: true, id: outcome.id },
        );
      } else {
        results.push({ op: name, ok: false, reason: outcome.reason });
      }
    }
    return {
      result: {
        results,
        state: state as unknown as Json,
        hash: hashJson(state),
      },
    };
  };
}
