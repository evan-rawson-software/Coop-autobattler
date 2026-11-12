/**
 * Splits a previewed enemy path into contiguous drawing segments. The cells
 * of an `EnemyPath` are on the board only, so where the cheapest route leaves
 * the board (the `approach` detour) two consecutive cells are not adjacent;
 * drawing a line between them would cross walls. Pure, no canvas.
 */

import type { Cell } from '@game/core';

/**
 * True if the two cells share an edge or a corner (8-adjacent): the movement
 * field steps diagonally (issue #82), so a previewed path does too.
 */
export function areAdjacent(a: Cell, b: Cell): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
}

/**
 * The maximal runs of consecutive 8-adjacent cells, in order. A new run starts
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

/** A stub the screen draws just outside the front edge. */
export interface PathStub {
  /** The on-board cell the stub starts from (it points off the board). */
  readonly cell: Cell;
  /** `exit`: the path leaves the board here; `reentry`: it comes back here. */
  readonly kind: 'exit' | 'reentry';
}

/**
 * The stubs of a previewed path: one `exit` at every cell where the walk
 * leaves the board and one `reentry` at every cell where it returns, in walk
 * order. `cells` and `approach` are those of an `EnemyPath`: `approach` holds
 * the off-board cells in walk order, each detour a run of adjacent cells,
 * and every detour sits between two on-board runs (`pathSegments(cells)`) or,
 * for the last one, ends the walk. So the i-th detour leaves at the last cell
 * of run i and returns at the first cell of run i + 1; the final detour has
 * no run after it and gets an exit only (the line would otherwise stop short).
 * A break between runs with no `approach` still gets its two stubs. A path
 * with no detour gives none.
 */
export function pathStubs(
  cells: readonly Cell[],
  approach: readonly Cell[],
): PathStub[] {
  const runs = pathSegments(cells);
  const detours = pathSegments(approach).length;
  const count = Math.max(detours, runs.length - 1);
  const out: PathStub[] = [];
  for (let i = 0; i < count; i++) {
    const before = runs[i];
    const after = runs[i + 1];
    const exit = before?.[before.length - 1];
    if (exit !== undefined) out.push({ cell: exit, kind: 'exit' });
    const back = after?.[0];
    if (back !== undefined) out.push({ cell: back, kind: 'reentry' });
  }
  return out;
}
