/**
 * Circle geometry for units (issue #59). All values are integers in sub-cell
 * units: `CELL_UNITS` (240) per arena cell. Coordinates stay below
 * `MAX_ARENA_CELLS * CELL_UNITS` (about 2e6), so every square below is far
 * inside the safe integer range; `Math.floor(v / 240)` is exact for such `v`
 * (a non-multiple has a fractional part of at least 1/240, much larger than
 * the rounding error of the quotient). See docs/rules-reference.md, "Unit
 * geometry".
 */

import type { Arena, ArenaBuilding } from './arena.js';
import { openFor } from './arena-paths.js';
import { CELL_UNITS } from './limits.js';

export { CELL_UNITS };

const S = CELL_UNITS;

/**
 * Unchecked fast variants of the exact helpers in `int.ts`, for the hot loops
 * of the motion step: `isqrtFloorSmall(n)` is `isqrtFloor` (it is corrected
 * after the floating estimate, so exact for every `n` below 2^52), and
 * `awayDivSmall`/`truncDivSmall` give the exact `awayDiv`/`truncDiv` for
 * `|a| < 2^30` and `0 < b < 2^22`: the float quotient of two such integers is
 * either an exact integer or at least `1 / b > 2^-22` away from every integer,
 * while its rounding error is at most `|a / b| * 2^-53 < 2^-23`, so `ceil` and
 * `floor` of it are the exact ones. Every call site is inside the geometry
 * bounds of "Content bounds" (products below 1e9).
 */
export function isqrtFloorSmall(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r -= 1;
  while ((r + 1) * (r + 1) <= n) r += 1;
  return r;
}

export function awayDivSmall(a: number, b: number): number {
  return a >= 0 ? Math.ceil(a / b) : Math.floor(a / b);
}

export function truncDivSmall(a: number, b: number): number {
  return a >= 0 ? Math.floor(a / b) : Math.ceil(a / b);
}

/** What the geometry code needs to know about the arena. */
export interface World {
  readonly width: number;
  readonly height: number;
  /** Per side: 1 where a cell is solid for that side's units. */
  readonly solid: readonly [Uint8Array, Uint8Array];
}

/** The cell coordinate of a position coordinate, clamped to `0 .. n - 1`. */
export function cellCoord(v: number, n: number): number {
  const c = Math.floor(v / S);
  return c < 0 ? 0 : c >= n ? n - 1 : c;
}

/**
 * The cell coordinate of a position coordinate in the frame of `side`: for
 * side 0 it is `cellCoord`; for side 1 the coordinate is rotated first (the
 * arena rotation, `n * 240 - v`) and the cell mapped back, so a position
 * exactly on a cell boundary belongs to the lower cell of its own side's
 * frame. This keeps a mirrored battle exactly symmetric: every cell lookup of
 * a unit's decisions uses it.
 */
export function ownCellCoord(side: number, v: number, n: number): number {
  return side === 0 ? cellCoord(v, n) : n - 1 - cellCoord(n * S - v, n);
}

/** Squared distance from point `(x, y)` to the closed square of cell `(cx, cy)`. */
export function boxDist2(x: number, y: number, cx: number, cy: number): number {
  const lx = cx * S;
  const ly = cy * S;
  const dx = lx - x > 0 ? lx - x : x - (lx + S) > 0 ? x - (lx + S) : 0;
  const dy = ly - y > 0 ? ly - y : y - (ly + S) > 0 ? y - (ly + S) : 0;
  return dx * dx + dy * dy;
}

/** Squared distance from `(x, y)` to the nearest cell of a building. */
export function buildingDist2(
  x: number,
  y: number,
  building: ArenaBuilding,
): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (const c of building.cells) {
    const d = boxDist2(x, y, c.x, c.y);
    if (d < best) best = d;
  }
  return best;
}

/** The per-side solid grids of an arena (a cell not open for the side). */
export function buildSolid(arena: Arena): [Uint8Array, Uint8Array] {
  const n = arena.geom.width * arena.geom.height;
  const out: [Uint8Array, Uint8Array] = [new Uint8Array(n), new Uint8Array(n)];
  fillSolid(arena, out);
  return out;
}

/** Recompute the per-side solid grids in place (after a building was destroyed). */
export function fillSolid(
  arena: Arena,
  out: readonly [Uint8Array, Uint8Array],
): void {
  const n = arena.geom.width * arena.geom.height;
  for (let side = 0; side < 2; side++) {
    const grid = out[side];
    if (grid === undefined) continue;
    for (let k = 0; k < n; k++) grid[k] = openFor(arena, side, k) ? 0 : 1;
  }
}

/**
 * Whether a circle of radius `r` at `(x, y)` lies inside the arena and clear
 * of every solid cell of `side` (touching is allowed).
 */
export function fits(
  world: World,
  side: number,
  r: number,
  x: number,
  y: number,
): boolean {
  const { width, height } = world;
  if (x < r || y < r || x > width * S - r || y > height * S - r) return false;
  const solid = world.solid[side];
  if (solid === undefined) return false;
  const x0 = Math.floor((x - r) / S);
  const x1 = Math.min(width - 1, Math.floor((x + r) / S));
  const y0 = Math.floor((y - r) / S);
  const y1 = Math.min(height - 1, Math.floor((y + r) / S));
  const r2 = r * r;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (solid[cy * width + cx] === 1 && boxDist2(x, y, cx, cy) < r2) {
        return false;
      }
    }
  }
  return true;
}

/** Most sweeps of `pushOutSolid` that `settleOutOfSolid` makes. */
export const SETTLE_SWEEPS = 4;

/**
 * Put a circle at `(x, y)` where it fits (see the rules reference, "Push-out
 * of solid ground"): the position itself if it fits; else the result of up to
 * `SETTLE_SWEEPS` sweeps of `pushOutSolid`, stopping at the first one that
 * fits; else the fallback `(fx, fy)`, which the caller knows fits. The result
 * is written to `out[0], out[1]` and always fits when the fallback does, so
 * applying the function to its own output changes nothing (idempotent).
 */
export function settleOutOfSolid(
  world: World,
  side: number,
  r: number,
  x: number,
  y: number,
  fx: number,
  fy: number,
  out: Int32Array,
): void {
  if (fits(world, side, r, x, y)) {
    out[0] = x;
    out[1] = y;
    return;
  }
  for (let k = 0; k < SETTLE_SWEEPS; k++) {
    pushOutSolid(world, side, r, x, y, out);
    x = out[0] ?? 0;
    y = out[1] ?? 0;
    if (fits(world, side, r, x, y)) return;
  }
  out[0] = fx;
  out[1] = fy;
}

/**
 * One sweep of push-out of solid ground (see the rules reference): returns
 * the new position in `out[0], out[1]`. The result is at least `r` from every
 * solid cell of the window that was pushed against, but a push can land in
 * another solid cell; callers check with `fits` (or use `settleOutOfSolid`).
 */
export function pushOutSolid(
  world: World,
  side: number,
  r: number,
  x: number,
  y: number,
  out: Int32Array,
): void {
  const { width, height } = world;
  const solid = world.solid[side];
  if (solid !== undefined) {
    const x0 = Math.max(0, Math.floor((x - r) / S));
    const x1 = Math.min(width - 1, Math.floor((x + r) / S));
    const y0 = Math.max(0, Math.floor((y - r) / S));
    const y1 = Math.min(height - 1, Math.floor((y + r) / S));
    const r2 = r * r;
    // Side 1 visits the cells in the opposite order and prefers the opposite
    // faces: the same rule in its own (rotated) frame.
    const dir = side === 0 ? 1 : -1;
    const cyFirst = side === 0 ? y0 : y1;
    const cxFirst = side === 0 ? x0 : x1;
    const rows = y1 - y0;
    const cols = x1 - x0;
    for (let iy = 0; iy <= rows; iy++) {
      const cy = cyFirst + dir * iy;
      for (let ix = 0; ix <= cols; ix++) {
        const cx = cxFirst + dir * ix;
        if (solid[cy * width + cx] !== 1) continue;
        const lx = cx * S;
        const ly = cy * S;
        const qx = x < lx ? lx : x > lx + S ? lx + S : x;
        const qy = y < ly ? ly : y > ly + S ? ly + S : y;
        const ox = x - qx;
        const oy = y - qy;
        const d2 = ox * ox + oy * oy;
        if (d2 >= r2) continue;
        if (d2 > 0) {
          const d = isqrtFloorSmall(d2);
          x = qx + awayDivSmall(ox * r, d);
          y = qy + awayDivSmall(oy * r, d);
        } else {
          // The centre is inside the square or on its edge: leave through
          // the nearest face (ties in the order left, right, down, up).
          const left = x - lx;
          const right = lx + S - x;
          const down = y - ly;
          const up = ly + S - y;
          const m = Math.min(left, right, down, up);
          if (side === 0) {
            if (left === m) x = lx - r;
            else if (right === m) x = lx + S + r;
            else if (down === m) y = ly - r;
            else y = ly + S + r;
          } else if (right === m) x = lx + S + r;
          else if (left === m) x = lx - r;
          else if (up === m) y = ly + S + r;
          else y = ly - r;
        }
      }
    }
  }
  x = x < r ? r : x > width * S - r ? width * S - r : x;
  y = y < r ? r : y > height * S - r ? height * S - r : y;
  out[0] = x;
  out[1] = y;
}
