/**
 * Wall autotile (pure). `bld_wall_auto` has 16 static frames; the frame index
 * is the 4-bit mask of the cardinal neighbours that are also walls:
 * bit0 N, bit1 E, bit2 S, bit3 W. No diagonals. y grows downward.
 */

export const WALL_N = 1;
export const WALL_E = 2;
export const WALL_S = 4;
export const WALL_W = 8;

/** The frame of a wall cell; `has` says whether a cell holds a wall. */
export function wallFrame(
  has: (x: number, y: number) => boolean,
  x: number,
  y: number,
): number {
  return (
    (has(x, y - 1) ? WALL_N : 0) |
    (has(x + 1, y) ? WALL_E : 0) |
    (has(x, y + 1) ? WALL_S : 0) |
    (has(x - 1, y) ? WALL_W : 0)
  );
}

/** A cell lookup over the given wall cells. */
export function cellSet(
  cells: readonly { readonly x: number; readonly y: number }[],
): (x: number, y: number) => boolean {
  const keys = new Set(cells.map((c) => `${String(c.x)},${String(c.y)}`));
  return (x, y) => keys.has(`${String(x)},${String(y)}`);
}
