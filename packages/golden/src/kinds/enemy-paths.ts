/**
 * Golden-vector kind `enemy-paths`. Input: a `team-state-ops` script (`seed`,
 * `partySize`, `ops`) that builds one board with its Core placed. Result:
 * `{ paths }` where each path is `{ entry: [x, y], cells: [[x, y], ...],
 * breach: null | { building, cell: [x, y] } }` as returned by
 * `previewEnemyPaths` (board coordinates), in ascending entry `x`.
 */
import {
  previewEnemyPaths,
  runTeamStateOps,
  type ArenaContent,
  type Json,
  type MapgenConfig,
  type SimConfig,
} from '@game/core';
import type { SimulationFn } from './prng.js';

export function makeEnemyPathsKind(
  content: ArenaContent,
  mapgen: MapgenConfig,
  simConfig: SimConfig,
): SimulationFn {
  return (input: Json) => {
    const state = runTeamStateOps(input, content, mapgen).state;
    const paths = previewEnemyPaths(state, content, simConfig).map((p) => ({
      entry: [p.entry.x, p.entry.y],
      core: p.core,
      cells: p.cells.map((c) => [c.x, c.y]),
      breach:
        p.breach === null
          ? null
          : {
              building: p.breach.building,
              cell: [p.breach.cell.x, p.breach.cell.y],
            },
    }));
    return { result: { paths } };
  };
}
