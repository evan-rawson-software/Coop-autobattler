/**
 * Enemy-path preview (W1-6, CB-43): the route an enemy Core-targeting unit
 * would take from each front-row entry cell to a board's Core. It runs the
 * same field and breach code as the battle simulation (`computeField`,
 * `computeBreach`, `fieldStep`, `breachStep`); there is no second pathfinder.
 * See docs/rules-reference.md, "Enemy-path preview".
 */

import { createArena, cellIndex, type ArenaContent } from './arena.js';
import {
  breachPassable,
  computeBreach,
  computeField,
  breachStep,
  fieldStep,
  openFor,
} from './arena-paths.js';
import { divFloor } from './int.js';
import { maxHealthOf } from './max-health.js';
import type { Cell } from './map.js';
import type { SimConfig } from './sim-config.js';
import { createTeamState, type TeamState } from './team-state.js';

export interface EnemyPath {
  /** The front-row board cell where the enemy unit starts. */
  readonly entry: Cell;
  /**
   * The walked path in board coordinates: the entry cell first, then each
   * step, up to the cell next to the Core, or, when the base is sealed, up to
   * the last open cell before the breach point.
   */
  readonly cells: readonly Cell[];
  /** The building the unit would attack and the cell of it it would enter. */
  readonly breach: { readonly building: number; readonly cell: Cell } | null;
}

/**
 * For a board with its Core placed: one `EnemyPath` for every `x` (ascending)
 * whose front-row cell (`y = height - 1`) is open ground for an enemy unit
 * (no terrain, and no building that blocks the enemy: walls, turrets and gates
 * block; a destroyed building does not exist). Gates block the enemy side.
 * Throws if the Core is not placed.
 */
export function previewEnemyPaths(
  team: TeamState,
  content: ArenaContent,
  simConfig: SimConfig,
): EnemyPath[] {
  if (team.core === null) {
    throw new Error('previewEnemyPaths: the Core is not placed.');
  }
  // The preview board is side 0 (arena = board coordinates); the enemy is side
  // 1 on an empty board of the same size, with gap 0.
  const enemyBoard = createTeamState({
    ...team.map,
    features: [],
    nodes: [],
  });
  const arena = createArena(team, enemyBoard, 0, content);
  const { width, boardHeight } = arena.geom;
  const side = 1;
  const field = computeField(arena, side, 'core');
  const hpOf = (ref: number): number => {
    const b = arena.buildings[ref];
    if (b === undefined) return 0;
    // The same maximum health the simulation prices a breach by, with the
    // team's health modifiers (a building not placed by the team has none).
    return maxHealthOf(team, b, content);
  };
  const base = simConfig.breachBaseCost;
  const per = simConfig.breachHealthPerCost;
  let breach: Float64Array | undefined;
  const cellOf = (k: number): Cell => ({ x: k % width, y: divFloor(k, width) });

  const out: EnemyPath[] = [];
  const y = boardHeight - 1;
  for (let x = 0; x < width; x++) {
    const start = cellIndex(arena.geom, x, y);
    if (!openFor(arena, side, start)) continue;
    const cells: Cell[] = [cellOf(start)];
    let at = start;
    let found: EnemyPath['breach'] = null;
    if ((field.dist[at] ?? -1) >= 0) {
      while ((field.dist[at] ?? -1) > 0) {
        const next = fieldStep(arena, side, field, at);
        if (next < 0) break;
        at = next;
        cells.push(cellOf(at));
      }
    } else {
      breach ??= computeBreach(arena, side, hpOf, base, per);
      const bd = breach;
      // Guard: every step strictly lowers the remaining cost.
      while ((bd[at] ?? -1) > 0) {
        const next = breachStep(arena, side, bd, at, hpOf, base, per);
        if (next < 0) break;
        if (!openFor(arena, side, next)) {
          const ref = arena.occupant[next] ?? -1;
          const b = arena.buildings[ref];
          if (b !== undefined && breachPassable(arena, side, next)) {
            found = { building: b.id, cell: cellOf(next) };
          }
          break;
        }
        at = next;
        cells.push(cellOf(at));
      }
    }
    out.push({ entry: cellOf(start), cells, breach: found });
  }
  return out;
}
