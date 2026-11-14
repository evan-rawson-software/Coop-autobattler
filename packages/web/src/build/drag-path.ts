/**
 * Drawing a conduit path by dragging (pure). The path grows one orthogonal
 * cell at a time as the pointer moves; moving back over the previous cell (or
 * any earlier cell of the path) takes cells off again. A cell that cannot
 * hold a conduit stops the path and says why. This only mirrors the cell
 * rules of `core` (`addConduit` is the judge of the finished path); it makes
 * no decision about the two ends.
 */

import {
  occupancy,
  queryMap,
  type Cell,
  type PlacedBuilding,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';
import { cellKeyOf, manhattan, sameCell } from './geometry.js';

/** Why one cell cannot take a conduit. */
export interface CellProblem {
  /** A `core` reason code. */
  readonly reason: string;
  /** The building in the way, if one is. */
  readonly building: PlacedBuilding | null;
}

/** Null when `cell` is free for the actor's conduit, else why not. */
export function cellProblem(
  team: TeamState,
  content: WebContent,
  actor: number,
  cell: Cell,
): CellProblem | null {
  const q = queryMap(team.map, content.terrain);
  if (!q.isInBounds(cell.x, cell.y)) {
    return { reason: 'out_of_bounds', building: null };
  }
  if (q.plotOf(cell.x) !== actor) {
    return { reason: 'outside_own_plot', building: null };
  }
  if (!q.isBuildable(cell.x, cell.y)) {
    return { reason: 'blocked_by_feature', building: null };
  }
  const hit = occupancy(team, content).buildingAt(cell.x, cell.y);
  if (hit !== null) {
    return 'core' in hit
      ? { reason: 'overlaps_core', building: null }
      : { reason: 'overlaps_building', building: hit };
  }
  const k = cellKeyOf(cell);
  for (const c of team.conduits) {
    if (c.cells.some((p) => cellKeyOf(p) === k)) {
      return { reason: 'crosses_conduit', building: null };
    }
  }
  return null;
}

/** A cell the path was stopped at. */
export interface DragBlock extends CellProblem {
  readonly cell: Cell;
}

export interface DragResult {
  readonly cells: readonly Cell[];
  /** Why the path could not follow the pointer, or null. */
  readonly blocked: DragBlock | null;
}

/**
 * The path after the pointer moved to `target`. `starts` are the cells at
 * which a path may begin (just outside the output side); they are only used
 * while the path is empty. A jump of several cells is walked one cell at a
 * time (along x, then y), each cell checked.
 */
export function dragStep(
  team: TeamState,
  content: WebContent,
  actor: number,
  cells: readonly Cell[],
  target: Cell,
  starts: readonly Cell[] = [],
): DragResult {
  let path = [...cells];
  const at = path.findIndex((c) => sameCell(c, target));
  if (at >= 0) return { cells: path.slice(0, at + 1), blocked: null };
  if (path.length === 0) {
    if (!starts.some((c) => sameCell(c, target))) {
      return { cells: path, blocked: null };
    }
    const bad = cellProblem(team, content, actor, target);
    return bad === null
      ? { cells: [target], blocked: null }
      : { cells: path, blocked: { ...bad, cell: target } };
  }
  let guard = manhattan(path[path.length - 1] as Cell, target);
  while (guard-- > 0) {
    const last = path[path.length - 1] as Cell;
    if (sameCell(last, target)) break;
    const dx = target.x - last.x;
    const dy = target.y - last.y;
    const next: Cell =
      dx !== 0
        ? { x: last.x + Math.sign(dx), y: last.y }
        : { x: last.x, y: last.y + Math.sign(dy) };
    // A walked cell may be one the path already holds: back up to it.
    const seen = path.findIndex((c) => sameCell(c, next));
    if (seen >= 0) {
      path = path.slice(0, seen + 1);
      continue;
    }
    const bad = cellProblem(team, content, actor, next);
    if (bad !== null) {
      return { cells: path, blocked: { ...bad, cell: next } };
    }
    path.push(next);
  }
  return { cells: path, blocked: null };
}
