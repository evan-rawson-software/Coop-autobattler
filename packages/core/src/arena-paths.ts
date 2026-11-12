/**
 * Goal sets and movement fields for units (W1-5, CB-14, CB-15, CB-19, CB-20).
 * A field is a breadth-first distance map; the breach field is a least-cost
 * map used when a base is sealed. Fields never depend on unit positions.
 * See docs/rules-reference.md, "Goals and movement fields".
 */

import { addInt, divFloor } from './int.js';
import { assertWithin, MAX_ARENA_CELLS } from './limits.js';
import type { Arena, ArenaBuilding } from './arena.js';

/** The four moves. Order does not matter: ties are broken by `tieKey`. */
export const NEIGHBORS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/**
 * The eight moves of the movement field. Order does not matter: the field is
 * a minimum and ties are broken by `tieKey`.
 */
export const NEIGHBORS8: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Cost of an orthogonal and of a diagonal step of the movement field. */
export const STEP_COST = 10;
export const DIAGONAL_COST = 14;

/**
 * The single predicate that says which buildings block which side's units: a
 * living building blocks every unit, except that a gate lets the units of its
 * own side through (W1-6). Movement fields, the breach field, spawn cells and
 * aggro steps all go through `openFor`.
 */
export function blocksUnit(building: ArenaBuilding, unitSide: number): boolean {
  if (!building.alive) return false;
  return !(building.defenseType === 'gate' && building.side === unitSide);
}

/** Open for a unit of `side`: no terrain block and no blocking building. */
export function openFor(arena: Arena, side: number, cell: number): boolean {
  if (arena.blocked[cell] === 1) return false;
  const occ = arena.occupant[cell] ?? -1;
  if (occ < 0) return true;
  const b = arena.buildings[occ];
  return b === undefined || !blocksUnit(b, side);
}

/**
 * Tie-break key for a cell, in the acting side's own board frame: smaller is
 * preferred: the highest own-frame `y` first (forward, towards the enemy), then
 * the lowest own-frame `x`. With `(ox, oy)` the cell in the side's own frame
 * (side 0: `(x, y)`; side 1: `(W - 1 - x, H - 1 - y)`) the key is
 * `(H - 1 - oy) * W + ox`. Using the own frame keeps a mirrored battle
 * exactly symmetric.
 */
export function tieKey(
  arena: Arena,
  side: number,
  x: number,
  y: number,
): number {
  const { width, height } = arena.geom;
  return side === 0
    ? (height - 1 - y) * width + x
    : y * width + (width - 1 - x);
}

/**
 * Whether a diagonal step from `(x, y)` by `(dx, dy)` is allowed for `side`:
 * both orthogonal cells it passes must be open (no cutting corners).
 */
function diagonalOpen(
  arena: Arena,
  side: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
): boolean {
  const { width } = arena.geom;
  return (
    openFor(arena, side, y * width + x + dx) &&
    openFor(arena, side, (y + dy) * width + x)
  );
}

/**
 * The 4-neighbour of cell `(x, y)` with the lowest non-negative score (ties:
 * the tie key of `side`), as a cell index, or -1 when every score is negative
 * (a negative score means "not allowed").
 */
export function bestNeighbour(
  arena: Arena,
  side: number,
  x: number,
  y: number,
  score: (cell: number) => number,
): number {
  const { width, height } = arena.geom;
  let best = -1;
  let bestScore = 0;
  let bestTie = 0;
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const k = ny * width + nx;
    const s = score(k);
    if (s < 0) continue;
    const tie = tieKey(arena, side, nx, ny);
    if (best < 0 || s < bestScore || (s === bestScore && tie < bestTie)) {
      best = k;
      bestScore = s;
      bestTie = tie;
    }
  }
  return best;
}

/**
 * One step along a movement field from cell index `here` (which must have a
 * distance `d > 0`): among the open neighbours (8 directions, a diagonal only
 * if both orthogonal cells are open) with a distance below `d`, the one with
 * the smallest `dist + step cost` (10 orthogonal, 14 diagonal); ties by tie
 * key (forward first). -1 when there is none.
 */
export function fieldStep(
  arena: Arena,
  side: number,
  field: Field,
  here: number,
): number {
  const { width, height } = arena.geom;
  const x = here % width;
  const y = divFloor(here, width);
  const d = field.dist[here] ?? -1;
  let best = -1;
  let bestScore = 0;
  let bestTie = 0;
  for (const [dx, dy] of NEIGHBORS8) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const k = ny * width + nx;
    const v = field.dist[k] ?? -1;
    if (v < 0 || v >= d) continue;
    const diagonal = dx !== 0 && dy !== 0;
    if (diagonal && !diagonalOpen(arena, side, x, y, dx, dy)) continue;
    const score = v + (diagonal ? DIAGONAL_COST : STEP_COST);
    const tie = tieKey(arena, side, nx, ny);
    if (
      best < 0 ||
      score < bestScore ||
      (score === bestScore && tie < bestTie)
    ) {
      best = k;
      bestScore = score;
      bestTie = tie;
    }
  }
  return best;
}

/**
 * One step on a breach route from cell index `here` (distance `> 0`): the
 * passable neighbour minimising (its distance + the cost of entering it),
 * ties by tie key. The result may be covered by an enemy building. -1 when
 * there is none.
 */
export function breachStep(
  arena: Arena,
  side: number,
  dist: Float64Array,
  here: number,
  hpOf: (ref: number) => number,
  base: number,
  perCost: number,
  goal: number,
): number {
  const { width } = arena.geom;
  return bestNeighbour(
    arena,
    side,
    here % width,
    divFloor(here, width),
    (c) => {
      const v = dist[c] ?? -1;
      if (v < 0 || !breachPassable(arena, side, c, goal)) return -1;
      return addInt(v, breachCost(arena, side, c, hpOf, base, perCost));
    },
  );
}

/**
 * The goal set of a side's units heading for the enemy Core of player `core`
 * (PP-11): that Core while it stands, else nothing. Units never prefer other
 * buildings (issue #66).
 */
export function goalBuildings(
  arena: Arena,
  side: number,
  core: number,
): ArenaBuilding[] {
  const ref = arena.coreRef[1 - side]?.[core] ?? -1;
  const coreB = ref >= 0 ? arena.buildings[ref] : undefined;
  return coreB !== undefined && coreB.alive ? [coreB] : [];
}

export interface Field {
  /**
   * Cost to the nearest goal-adjacent cell (10 per orthogonal and 14 per
   * diagonal step); -1 when unreachable.
   */
  readonly dist: Int32Array;
  /** Per building `ref`: 1 when it is in the goal set. */
  readonly isGoal: Uint8Array;
}

/**
 * Movement field of a side towards the enemy Core: a least-cost map over open
 * cells with 8 directions (orthogonal step 10, diagonal 14, a diagonal only if
 * both orthogonal cells are open). Distance 0 for every open cell that
 * shares an edge with a Core cell (4 neighbours), so every free side of the
 * Core is a goal and a base whose edge cells are all walls is sealed even if
 * a corner cell is open. The values are exact whatever order the cells are processed in.
 */
export function computeField(arena: Arena, side: number, core: number): Field {
  const { width, height } = arena.geom;
  const n = width * height;
  assertWithin(n, 1, MAX_ARENA_CELLS, 'Field: arena cell count');
  const dist = new Int32Array(n).fill(-1);
  const isGoal = new Uint8Array(arena.buildings.length);
  // Binary min-heap of packed keys `distance * 8192 + cell` (a distance is at
  // most 14 * 8192 and a cell index below 8192: the key stays below 2^30).
  const heap: number[] = [];
  const push = (key: number): void => {
    let i = heap.length;
    heap.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] ?? 0) <= key) break;
      heap[i] = heap[p] ?? 0;
      i = p;
    }
    heap[i] = key;
  };
  const pop = (): number => {
    const top = heap[0] ?? 0;
    const last = heap.pop() ?? 0;
    if (heap.length > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && (heap[c + 1] ?? 0) < (heap[c] ?? 0)) c += 1;
        if ((heap[c] ?? 0) >= last) break;
        heap[i] = heap[c] ?? 0;
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  for (const g of goalBuildings(arena, side, core)) {
    isGoal[g.ref] = 1;
    for (const c of g.cells) {
      for (const [dx, dy] of NEIGHBORS) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const k = y * width + x;
        if (dist[k] !== -1 || !openFor(arena, side, k)) continue;
        dist[k] = 0;
        push(k);
      }
    }
  }
  while (heap.length > 0) {
    const key = pop();
    const k = key % 8192;
    const d = (key - k) / 8192;
    if (d !== dist[k]) continue; // stale entry
    const x = k % width;
    const y = divFloor(k, width);
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nk = ny * width + nx;
      if (!openFor(arena, side, nk)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && !diagonalOpen(arena, side, x, y, dx, dy)) continue;
      const nd = d + (diagonal ? DIAGONAL_COST : STEP_COST);
      const cur = dist[nk] ?? -1;
      if (cur === -1 || nd < cur) {
        dist[nk] = nd;
        push(nd * 8192 + nk);
      }
    }
  }
  return { dist, isGoal };
}

/** Cost of stepping onto a cell on a breach route (cell must be passable). */
export function breachCost(
  arena: Arena,
  side: number,
  cell: number,
  hpOf: (ref: number) => number,
  base: number,
  perCost: number,
): number {
  if (openFor(arena, side, cell)) return 1;
  const ref = arena.occupant[cell] ?? -1;
  return addInt(base, divFloor(addInt(hpOf(ref), perCost - 1), perCost));
}

/**
 * Whether a cell can be on a breach route of `side` towards the Core with
 * arena ref `goal`: open, or an enemy building. The goal Core is never
 * entered; an enemy Core that is not the goal can be (a costly building like
 * any other, PP-11).
 */
export function breachPassable(
  arena: Arena,
  side: number,
  cell: number,
  goal: number,
): boolean {
  if (arena.blocked[cell] === 1) return false;
  if (openFor(arena, side, cell)) return true;
  const ref = arena.occupant[cell] ?? -1;
  const b = arena.buildings[ref];
  return b !== undefined && b.side !== side && ref !== goal;
}

/**
 * Least-cost distance map to the enemy Core for a sealed side (CB-20).
 * `dist[c]` is the cost of the cheapest route from `c` to a cell next to the
 * Core, not counting `c` itself and counting every later cell: 1 for an open
 * cell, `base + ceil(health / perCost)` for a cell covered by an enemy
 * building. -1 when no route exists (or the Core is gone).
 */
export function computeBreach(
  arena: Arena,
  side: number,
  core: number,
  hpOf: (ref: number) => number,
  base: number,
  perCost: number,
): Float64Array {
  const { width, height } = arena.geom;
  const n = width * height;
  // Distances can exceed 2^31 (a wall may have health up to MAX_HEALTH), so
  // they live in a Float64Array of integers. See limits.ts for why every
  // distance below stays a safe integer.
  assertWithin(n, 1, MAX_ARENA_CELLS, 'Breach: arena cell count');
  const dist = new Float64Array(n).fill(-1);
  const goal = arena.coreRef[1 - side]?.[core] ?? -1;
  const goalB = goal >= 0 ? arena.buildings[goal] : undefined;
  if (goalB === undefined || !goalB.alive) return dist;

  // Binary min-heap of (distance, cell) pairs, ordered by distance and then
  // by cell index, held in two parallel arrays (no packed key, so a distance
  // only has to be a safe integer, see limits.ts).
  const heapD: number[] = [];
  const heapK: number[] = [];
  const less = (d1: number, k1: number, d2: number, k2: number): boolean =>
    d1 < d2 || (d1 === d2 && k1 < k2);
  const push = (d: number, k: number): void => {
    let i = heapD.length;
    heapD.push(d);
    heapK.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(d, k, heapD[p] ?? 0, heapK[p] ?? 0)) break;
      heapD[i] = heapD[p] ?? 0;
      heapK[i] = heapK[p] ?? 0;
      i = p;
    }
    heapD[i] = d;
    heapK[i] = k;
  };
  /** Removes the smallest pair; returns its cell, its distance in `popped`. */
  let popped = 0;
  const pop = (): number => {
    const topD = heapD[0] ?? 0;
    const topK = heapK[0] ?? 0;
    const lastD = heapD.pop() ?? 0;
    const lastK = heapK.pop() ?? 0;
    if (heapD.length > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heapD.length) break;
        if (
          c + 1 < heapD.length &&
          less(
            heapD[c + 1] ?? 0,
            heapK[c + 1] ?? 0,
            heapD[c] ?? 0,
            heapK[c] ?? 0,
          )
        ) {
          c += 1;
        }
        if (!less(heapD[c] ?? 0, heapK[c] ?? 0, lastD, lastK)) break;
        heapD[i] = heapD[c] ?? 0;
        heapK[i] = heapK[c] ?? 0;
        i = c;
      }
      heapD[i] = lastD;
      heapK[i] = lastK;
    }
    popped = topD;
    return topK;
  };

  for (const c of goalB.cells) {
    for (const [dx, dy] of NEIGHBORS) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const k = y * width + x;
      if (dist[k] !== -1 || !breachPassable(arena, side, k, goal)) continue;
      dist[k] = 0;
      push(0, k);
    }
  }
  while (heapD.length > 0) {
    const k = pop();
    const d = popped;
    if (d !== dist[k]) continue; // stale entry
    const x = k % width;
    const y = divFloor(k, width);
    const through = addInt(d, breachCost(arena, side, k, hpOf, base, perCost));
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nk = ny * width + nx;
      if (!breachPassable(arena, side, nk, goal)) continue;
      const cur = dist[nk] ?? -1;
      if (cur === -1 || through < cur) {
        dist[nk] = through;
        push(through, nk);
      }
    }
  }
  return dist;
}
