import { describe, expect, test } from 'vitest';
import type { Cell } from '@game/core';
import { areAdjacent, pathSegments, pathStubs } from './path-segments.js';

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
    expect(pathStubs(p, [])).toEqual([]);
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
    expect(
      pathStubs(p, cells('3,16 4,16 5,16 6,16 7,16 8,16 9,16 10,16')),
    ).toEqual([
      { cell: { x: 3, y: 15 }, kind: 'exit' },
      { cell: { x: 10, y: 15 }, kind: 'reentry' },
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

  const stubs = (c: string, a: string): string[] =>
    pathStubs(cells(c), cells(a)).map((t) => `${t.kind} ${text([t.cell])}`);

  test('stubs: a path with no detour has none', () => {
    expect(stubs('5,15 5,14 5,13', '')).toEqual([]);
  });

  test('stubs: one detour in the middle gives an exit and a re-entry', () => {
    expect(
      stubs('3,15 10,15 10,14', '3,16 4,16 5,16 6,16 7,16 8,16 9,16 10,16'),
    ).toEqual(['exit 3,15', 'reentry 10,15']);
  });

  test('stubs: two detours give two exits and two re-entries in walk order', () => {
    // Out at 0,15, back at 4,15, along the front row to 6,15, out again,
    // back at 9,15.
    expect(
      stubs(
        '0,15 4,15 5,15 6,15 9,15 9,14',
        '0,16 1,16 2,16 3,16 4,16 6,16 7,16 8,16 9,16',
      ),
    ).toEqual(['exit 0,15', 'reentry 4,15', 'exit 6,15', 'reentry 9,15']);
  });

  test('stubs: a walk that ends off the board gets a final exit only', () => {
    // Leaves at 4,15 and never returns (for example beside a breach).
    expect(stubs('4,15', '4,16 5,16')).toEqual(['exit 4,15']);
    // A detour in the middle, then a final exit with no re-entry.
    expect(
      stubs('3,15 8,15 9,15', '3,16 4,16 5,16 6,16 7,16 8,16 10,16 11,16'),
    ).toEqual(['exit 3,15', 'reentry 8,15', 'exit 9,15']);
  });
});
