/**
 * Golden-vector kinds `team-state-ops` and `flow-graph`: run a list of team
 * state operations (`runTeamStateOps`, documented there) and return the final
 * state or its flow graph. Result `{ results, state, hash }` with one result
 * per op and `hash = hashJson(state)`; `flow-graph` returns `{ graph, hash }`
 * with `graph = buildFlowGraph(final state)`.
 */
import {
  buildFlowGraph,
  hashJson,
  runTeamStateOps,
  type Json,
  type MapContent,
  type MapgenConfig,
} from '@game/core';
import type { SimulationFn } from './prng.js';

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
