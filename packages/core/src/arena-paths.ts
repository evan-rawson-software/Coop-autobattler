/**
 * Goal sets and movement fields for units (W1-5, CB-14, CB-15, CB-19, CB-20).
 * A field is a breadth-first distance map; the breach field is a least-cost
 * map used when a base is sealed. Fields never depend on unit positions.
 * See docs/rules-reference.md, "Goals and movement fields".
 */

import { divFloor } from './int.js';
import type { Arena, ArenaBuilding } from './arena.js';
import type { Targeting } from './units.js';

export const TARGETINGS: readonly Targeting[] = [
  'core',
  'infrastructure',
  'defenses',
];

/** The four moves. Order does not matter: ties are broken by `tieKey`. */
export const NEIGHBORS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/**
 * The single predicate that says which buildings block which side's units
 * (W1-6 will change it: gates let their own side through). Movement fields,
 * the breach field and spawn cells all go through `openFor`.
 */
export function blocksUnit(building: ArenaBuilding, unitSide: number): boolean {
  return building.alive && unitSide >= 0; // `unitSide` is for W1-6 (gates)
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
 * preferred ("lowest y, then lowest x" of that frame). For side 0 this is the
 * arena `y * width + x`; for side 1 it is the same on the rotated cell, which
 * keeps a mirrored battle exactly symmetric.
 */
export function tieKey(
  arena: Arena,
  side: number,
  x: number,
  y: number,
): number {
  const { width, height } = arena.geom;
  return side === 0
    ? y * width + x
    : (height - 1 - y) * width + (width - 1 - x);
}

/** The goal set for a side's targeting preference (see the rules reference). */
export function goalBuildings(
  arena: Arena,
  side: number,
  targeting: Targeting,
): ArenaBuilding[] {
  const enemy = 1 - side;
  const core = arena.coreRef[enemy] ?? -1;
  const coreB = core >= 0 ? arena.buildings[core] : undefined;
  const coreGoal = coreB !== undefined && coreB.alive ? [coreB] : [];
  if (targeting === 'core') return coreGoal;
  const goals = arena.buildings.filter((b) => {
    if (b.side !== enemy || !b.alive) return false;
    return targeting === 'infrastructure'
      ? b.kind === 'source' || b.kind === 'route'
      : b.kind === 'defense';
  });
  return goals.length > 0 ? goals : coreGoal;
}

export interface Field {
  /** Steps to the nearest goal-adjacent cell; -1 when unreachable. */
  readonly dist: Int32Array;
  /** Per building `ref`: 1 when it is in the goal set. */
  readonly isGoal: Uint8Array;
}

/** Breadth-first movement field for (side, targeting). */
export function computeField(
  arena: Arena,
  side: number,
  targeting: Targeting,
): Field {
  const { width, height } = arena.geom;
  const n = width * height;
  const dist = new Int32Array(n).fill(-1);
  const isGoal = new Uint8Array(arena.buildings.length);
  const queue = new Int32Array(n);
  let tail = 0;
  for (const g of goalBuildings(arena, side, targeting)) {
    isGoal[g.ref] = 1;
    for (const c of g.cells) {
      for (const [dx, dy] of NEIGHBORS) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const k = y * width + x;
        if (dist[k] !== -1 || !openFor(arena, side, k)) continue;
        dist[k] = 0;
        queue[tail++] = k;
      }
    }
  }
  for (let head = 0; head < tail; head++) {
    const k = queue[head] ?? 0;
    const x = k % width;
    const y = divFloor(k, width);
    const d = (dist[k] ?? 0) + 1;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nk = ny * width + nx;
      if (dist[nk] !== -1 || !openFor(arena, side, nk)) continue;
      dist[nk] = d;
      queue[tail++] = nk;
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
  return base + divFloor(hpOf(ref) + perCost - 1, perCost);
}

/** Whether a cell can be on a breach route of `side` (open, or enemy building). */
export function breachPassable(
  arena: Arena,
  side: number,
  cell: number,
): boolean {
  if (arena.blocked[cell] === 1) return false;
  if (openFor(arena, side, cell)) return true;
  const ref = arena.occupant[cell] ?? -1;
  const b = arena.buildings[ref];
  return b !== undefined && b.side !== side && b.kind !== 'core';
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
  hpOf: (ref: number) => number,
  base: number,
  perCost: number,
): Int32Array {
  const { width, height } = arena.geom;
  const n = width * height;
  const dist = new Int32Array(n).fill(-1);
  const core = arena.buildings[arena.coreRef[1 - side] ?? -1];
  if (core === undefined || !core.alive) return dist;

  // Binary min-heap of dist * n + cell.
  const heap: number[] = [];
  const push = (v: number): void => {
    let i = heap.length;
    heap.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] ?? 0) <= v) break;
      heap[i] = heap[p] ?? 0;
      i = p;
    }
    heap[i] = v;
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

  for (const c of core.cells) {
    for (const [dx, dy] of NEIGHBORS) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const k = y * width + x;
      if (dist[k] !== -1 || !breachPassable(arena, side, k)) continue;
      dist[k] = 0;
      push(k);
    }
  }
  while (heap.length > 0) {
    const top = pop();
    const k = top % n;
    const d = divFloor(top, n);
    if (d !== dist[k]) continue; // stale entry
    const x = k % width;
    const y = divFloor(k, width);
    const through = d + breachCost(arena, side, k, hpOf, base, perCost);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nk = ny * width + nx;
      if (!breachPassable(arena, side, nk)) continue;
      const cur = dist[nk] ?? -1;
      if (cur === -1 || through < cur) {
        dist[nk] = through;
        push(through * n + nk);
      }
    }
  }
  return dist;
}
