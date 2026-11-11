/**
 * Splits a previewed enemy path into contiguous drawing segments. The cells
 * of an `EnemyPath` are on the board only, so where the cheapest route leaves
 * the board (the `approach` detour) two consecutive cells are not adjacent;
 * drawing a line between them would cross walls. Pure, no canvas.
 */

import type { Cell } from '@game/core';

/** True if the two cells share an edge (4-adjacent). */
export function areAdjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/**
 * The maximal runs of consecutive 4-adjacent cells, in order. A new run starts
 * wherever two consecutive cells are not adjacent. An empty list gives no run.
 */
export function pathSegments(cells: readonly Cell[]): Cell[][] {
  const out: Cell[][] = [];
  let run: Cell[] = [];
  for (const c of cells) {
    const prev = run[run.length - 1];
    if (prev !== undefined && !areAdjacent(prev, c)) {
      out.push(run);
      run = [];
    }
    run.push(c);
  }
  if (run.length > 0) out.push(run);
  return out;
}

/**
 * The cells where a detour leaves and re-enters the board: for each break
 * between two runs, the last cell of the earlier and the first cell of the
 * later one (`from`, `to`). The screen draws a short stub outside the front
 * edge from each.
 */
export function pathGaps(cells: readonly Cell[]): { from: Cell; to: Cell }[] {
  const runs = pathSegments(cells);
  const out: { from: Cell; to: Cell }[] = [];
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1] as Cell[];
    const b = runs[i] as Cell[];
    out.push({ from: a[a.length - 1] as Cell, to: b[0] as Cell });
  }
  return out;
}
