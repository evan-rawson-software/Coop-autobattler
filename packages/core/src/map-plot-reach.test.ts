import { describe, expect, test } from 'vitest';
import { generateMap } from './generate-map.js';
import { queryMap } from './map.js';
import { content, mapgen } from './testing/support.js';

/** Walkable cells of plot `p`, and how many are reached from its front row inside it. */
function reachedInPlot(
  seed: number,
  size: number,
  p: number,
): { reached: number; walkable: number } {
  const map = generateMap(seed, size, content, mapgen);
  const q = queryMap(map, content.terrain);
  const x0 = p * map.plotWidth;
  const x1 = x0 + map.plotWidth;
  const seen = new Set<number>();
  const todo: [number, number][] = [];
  for (let x = x0; x < x1; x++) {
    if (q.isWalkable(x, map.height - 1)) {
      seen.add((map.height - 1) * map.width + x);
      todo.push([x, map.height - 1]);
    }
  }
  for (let c = todo.pop(); c !== undefined; c = todo.pop()) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = c[0] + dx;
      const ny = c[1] + dy;
      if (nx < x0 || nx >= x1 || !q.isWalkable(nx, ny)) continue;
      const k = ny * map.width + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      todo.push([nx, ny]);
    }
  }
  let walkable = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = x0; x < x1; x++) if (q.isWalkable(x, y)) walkable++;
  }
  return { reached: seen.size, walkable };
}

describe('PP-15: per-plot reachability', () => {
  test('every walkable cell of every plot reaches that plot front row inside the plot', () => {
    for (let size = 1; size <= 4; size++) {
      for (let seed = 1; seed <= 60; seed++) {
        for (let p = 0; p < size; p++) {
          const r = reachedInPlot(seed, size, p);
          expect(
            r.reached,
            `seed ${String(seed)} size ${String(size)} plot ${String(p)}`,
          ).toBe(r.walkable);
        }
      }
    }
  });
});
