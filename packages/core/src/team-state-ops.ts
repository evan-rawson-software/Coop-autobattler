/**
 * Golden-vector kind `team-state-ops`. Input `{ seed, partySize, ops }` (or
 * `{ map, ops }` with an explicit map in the map format) where
 * each op is `{ op, ...args }` (`addToStash` {def, tier, owner}; `placeCore`
 * {actor, x, y}; `placeFromStash` and `moveBuilding` {actor, id, x, y,
 * rotation}; `returnToStash` and `removeFromStash` {actor, id}). The map is `generateMap(seed,
 * partySize)`. Result: `{ results, state, hash }` with one result per op
 * (`{ op, ok: true }` plus `id` for addToStash and addConduit, or
 * `{ op, ok: false, reason }`) and `hash = hashJson(state)`. Conduit ops:
 * `addConduit` {actor, from: {building, side}, to: {building, side}, cells:
 * [{x, y}]} and `eraseConduit` {actor, id}.
 *
 * Golden-vector kind `flow-graph`: the same input; the result is
 * `{ graph, hash }` with `graph = buildFlowGraph(final state)` and
 * `hash = hashJson(graph)`.
 */
import { generateMap } from './generate-map.js';
import { hashJson, type Json } from './hash.js';
import type { SimulationFn } from './golden-kinds.js';
import { loadMapOrThrow, type MapContent } from './map.js';
import type { MapgenConfig } from './mapgen.js';
import { addConduit, buildFlowGraph, type ConduitEndArg } from './conduits.js';
import {
  addToStash,
  createTeamState,
  eraseConduit,
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

function cellList(v: Json | undefined): { x: number; y: number }[] {
  if (!Array.isArray(v)) {
    throw new TypeError('team-state-ops: cells must be an array');
  }
  return (v as Json[]).map((c) => {
    const r = rec(c, 'cell');
    return { x: int(r, 'x'), y: int(r, 'y') };
  });
}

function endOf(v: Json | undefined, what: string): ConduitEndArg {
  const r = rec(v, what);
  if ('border' in r) return { border: int(r, 'border'), y: int(r, 'y') };
  const side = r['side'];
  if (typeof side !== 'string') {
    throw new TypeError(`team-state-ops: ${what}.side must be a string`);
  }
  return { building: int(r, 'building'), side };
}

/** Run a `team-state-ops` input script; shared by both kinds. */
export function runTeamStateOps(
  input: Json,
  content: MapContent,
  config: MapgenConfig,
): { results: Json[]; state: TeamState } {
  {
    const o = rec(input, 'input');
    const ops = o['ops'];
    if (!Array.isArray(ops)) {
      throw new TypeError('team-state-ops: ops must be an array');
    }
    // `map` (optional) is an explicit map in the map format; without it the
    // map is generated from `seed` and `partySize`.
    const given = o['map'];
    const map =
      given === undefined
        ? generateMap(int(o, 'seed'), int(o, 'partySize'), content, config)
        : loadMapOrThrow(given, content);
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
          outcome = placeCore(state, content, config, int(a, 'actor'), {
            x: int(a, 'x'),
            y: int(a, 'y'),
          });
          break;
        case 'placeFromStash':
          outcome = placeFromStash(state, content, {
            actor: int(a, 'actor'),
            id: int(a, 'id'),
            x: int(a, 'x'),
            y: int(a, 'y'),
            rotation: int(a, 'rotation'),
          });
          break;
        case 'moveBuilding':
          outcome = moveBuilding(state, content, {
            actor: int(a, 'actor'),
            id: int(a, 'id'),
            x: int(a, 'x'),
            y: int(a, 'y'),
            rotation: int(a, 'rotation'),
          });
          break;
        case 'returnToStash':
          outcome = returnToStash(state, content, {
            actor: int(a, 'actor'),
            id: int(a, 'id'),
          });
          break;
        case 'removeFromStash':
          outcome = removeFromStash(state, {
            actor: int(a, 'actor'),
            id: int(a, 'id'),
          });
          break;
        case 'addConduit':
          outcome = addConduit(state, content, {
            actor: int(a, 'actor'),
            from: endOf(a['from'], 'from'),
            to: endOf(a['to'], 'to'),
            cells: cellList(a['cells']),
          });
          break;
        case 'eraseConduit':
          outcome = eraseConduit(state, {
            actor: int(a, 'actor'),
            id: int(a, 'id'),
          });
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
    return { results, state };
  }
}

export function makeTeamStateOpsKind(
  content: MapContent,
  config: MapgenConfig,
): SimulationFn {
  return (input: Json) => {
    const { results, state } = runTeamStateOps(input, content, config);
    return {
      result: {
        results,
        state: state as unknown as Json,
        hash: hashJson(state),
      },
    };
  };
}

export function makeFlowGraphKind(
  content: MapContent,
  config: MapgenConfig,
): SimulationFn {
  return (input: Json) => {
    const { state } = runTeamStateOps(input, content, config);
    const graph = buildFlowGraph(state, content) as unknown as Json;
    return { result: { graph, hash: hashJson(graph) } };
  };
}
