/**
 * Golden-vector kind `enemy-paths`. Input: a `team-state-ops` script (`seed`,
 * `partySize`, `ops`) that builds one board with its Core placed. Result:
 * `{ paths }` where each path is `{ entry: [x, y], cells: [[x, y], ...],
 * breach: null | { building, cell: [x, y] } }` as returned by
 * `previewEnemyPaths` (board coordinates), in ascending entry `x`.
 */
import type { ArenaContent } from './arena.js';
import { previewEnemyPaths } from './enemy-paths.js';
import type { Json } from './hash.js';
import type { SimulationFn } from './golden-kinds.js';
import type { MapgenConfig } from './mapgen.js';
import type { SimConfig } from './sim-config.js';
import { runTeamStateOps } from './team-state-ops.js';

export function makeEnemyPathsKind(
  content: ArenaContent,
  mapgen: MapgenConfig,
  simConfig: SimConfig,
): SimulationFn {
  return (input: Json) => {
    const state = runTeamStateOps(input, content, mapgen).state;
    const paths = previewEnemyPaths(state, content, simConfig).map((p) => ({
      entry: [p.entry.x, p.entry.y],
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
