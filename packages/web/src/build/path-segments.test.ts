import { describe, expect, test } from 'vitest';
import type { Cell } from '@game/core';
import { areAdjacent, pathGaps, pathSegments } from './path-segments.js';

/** `"x,y x,y ..."` to cells. */
function cells(text: string): Cell[] {
  return text
    .split(' ')
    .filter((s) => s !== '')
    .map((s) => {
      const [x, y] = s.split(',').map(Number);
      return { x: x as number, y: y as number };
    });
}

const text = (cs: readonly Cell[]): string =>
  cs.map((c) => `${String(c.x)},${String(c.y)}`).join(' ');

describe('enemy path segments (pure)', () => {
  test('adjacency is 4-adjacency', () => {
    expect(areAdjacent({ x: 1, y: 1 }, { x: 1, y: 2 })).toBe(true);
    expect(areAdjacent({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
    expect(areAdjacent({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
  });

  test('a contiguous path is one segment; an empty path none', () => {
    const p = cells('5,15 5,14 5,13 4,13');
    expect(pathSegments(p).map(text)).toEqual(['5,15 5,14 5,13 4,13']);
    expect(pathGaps(p)).toEqual([]);
    expect(pathSegments([])).toEqual([]);
  });

  test('the detour layout of defense.test.ts (3,15 then 10,15) splits in two', () => {
    // From the "approach cells" test: the walk leaves the board after 3,15
    // (row 16 is off-board) and re-enters at 10,15.
    const p = cells('3,15 10,15 10,14 10,13 9,13 8,13');
    expect(pathSegments(p).map(text)).toEqual([
      '3,15',
      '10,15 10,14 10,13 9,13 8,13',
    ]);
    expect(pathGaps(p)).toEqual([
      { from: { x: 3, y: 15 }, to: { x: 10, y: 15 } },
    ]);
  });

  test('every break starts a new segment', () => {
    const p = cells('0,15 5,15 5,14 9,14 9,13');
    expect(pathSegments(p).map(text)).toEqual([
      '0,15',
      '5,15 5,14',
      '9,14 9,13',
    ]);
  });
});
