/**
 * Enemy-path preview (W1-6, CB-43): the route an enemy unit (they all head for the
 * Core) would take from each front-row entry cell to a board's Core. It runs the
 * same field and breach code as the battle simulation (`computeField`,
 * `computeBreach`, `fieldStep`, `breachStep`); there is no second pathfinder.
 * The field has 8 directions (issue #82), so a route may step diagonally; a
 * unit steers by the direction of each step and keeps its offset in the cell,
 * so its trajectory stays within a cell of the route.
 * See docs/rules-reference.md, "Enemy-path preview".
 */

import { createArena, cellIndex, type ArenaContent } from './arena.js';
import {
  type Field,
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
   * The walked path in board coordinates, restricted to cells on the board
   * (`0 <= y < height`): the entry cell first, then each step, up to the cell
   * next to the Core, or, when the base is sealed, up to the last open cell
   * before the breach point. Where the cheapest route leaves the board (see
   * `approach`) the on-board cells before and after that stretch are not
   * adjacent.
   */
  readonly cells: readonly Cell[];
  /**
   * The cells of the walked path that lie off the board (`y >= height`: the
   * neutral zone, where a soldier detours around a wall in the front row), in
   * walk order, in the same coordinates. Empty for most paths. The Build
   * screen can ignore them.
   */
  readonly approach: readonly Cell[];
  /** The player index of the Core this path leads to: the plot the column is in, else the nearest placed Core (PP-12). */
  readonly core: number;
  /** The building the unit would attack and the cell of it it would enter. */
  readonly breach: { readonly building: number; readonly cell: Cell } | null;
}

/**
 * One `EnemyPath` for every `x` (ascending) whose front-row cell
 * (`y = height - 1`) is open ground for an enemy unit (no terrain, and no
 * building that blocks the enemy: walls, turrets and gates block; a destroyed
 * building does not exist) and whose plot's Core is placed. The path leads to
 * the Core of the plot that column is in (PP-12); what a unit does after that
 * Core has fallen is not previewed. Columns of a plot without a Core give no
 * entry.
 */
export function previewEnemyPaths(
  team: TeamState,
  content: ArenaContent,
  simConfig: SimConfig,
): EnemyPath[] {
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
  const hpOf = (ref: number): number => {
    const b = ref >= 0 ? arena.buildings[ref] : undefined;
    if (b === undefined) return 0;
    // The same maximum health the simulation prices a breach by, with the
    // team's health modifiers (a building not placed by the team has none).
    return maxHealthOf(team, b, content);
  };
  const base = simConfig.breachBaseCost;
  const per = simConfig.breachHealthPerCost;
  const fields: (Field | undefined)[] = [];
  const breaches: (Float64Array | undefined)[] = [];
  const fieldOf = (q: number): Field =>
    (fields[q] ??= computeField(arena, side, q));
  const breachOf = (q: number): Float64Array =>
    (breaches[q] ??= computeBreach(arena, side, q, hpOf, base, per));
  const cellOf = (k: number): Cell => ({ x: k % width, y: divFloor(k, width) });

  const out: EnemyPath[] = [];
  const y = boardHeight - 1;
  for (let x = 0; x < width; x++) {
    const start = cellIndex(arena.geom, x, y);
    if (!openFor(arena, side, start)) continue;
    const plot = divFloor(x, team.map.plotWidth);
    // The Core a unit entering here would choose (PP-11): the Core of this
    // plot if placed, else the nearest placed one by the key (class,
    // distance, |q - plot|, -q).
    let core = -1;
    if ((arena.coreRef[0]?.[plot] ?? -1) >= 0) core = plot;
    else {
      let best: number[] = [];
      (arena.coreRef[0] ?? []).forEach((ref, q) => {
        if (ref < 0) return;
        const d = fieldOf(q).dist[start] ?? -1;
        const bd = d >= 0 ? -1 : (breachOf(q)[start] ?? -1);
        const key =
          d >= 0
            ? [0, d, Math.abs(q - plot), -q]
            : bd >= 0
              ? [1, bd, Math.abs(q - plot), -q]
              : [2, 0, Math.abs(q - plot), -q];
        let less = best.length === 0;
        for (let i = 0; !less && i < key.length; i++) {
          const a = key[i] ?? 0;
          const b = best[i] ?? 0;
          if (a !== b) {
            less = a < b;
            break;
          }
        }
        if (less) {
          core = q;
          best = key;
        }
      });
    }
    if (core < 0) continue;
    const goal = arena.coreRef[0]?.[core] ?? -1;
    const field = fieldOf(core);
    const cells: Cell[] = [cellOf(start)];
    const approach: Cell[] = [];
    // The walked cells split into on-board cells and the off-board approach.
    const walk = (k: number): void => {
      const c = cellOf(k);
      (c.y < boardHeight ? cells : approach).push(c);
    };
    let at = start;
    let found: EnemyPath['breach'] = null;
    if ((field.dist[at] ?? -1) >= 0) {
      while ((field.dist[at] ?? -1) > 0) {
        const next = fieldStep(arena, side, field, at);
        if (next < 0) break;
        at = next;
        walk(at);
      }
    } else {
      const bd = breachOf(core);
      // Guard: every step strictly lowers the remaining cost.
      while ((bd[at] ?? -1) > 0) {
        const next = breachStep(arena, side, bd, at, hpOf, base, per, goal);
        if (next < 0) break;
        if (!openFor(arena, side, next)) {
          const ref = arena.occupant[next] ?? -1;
          const b = ref >= 0 ? arena.buildings[ref] : undefined;
          if (b !== undefined && breachPassable(arena, side, next, goal)) {
            found = { building: b.id, cell: cellOf(next) };
          }
          break;
        }
        at = next;
        walk(at);
      }
    }
    out.push({ entry: cellOf(start), core, cells, approach, breach: found });
  }
  return out;
}
