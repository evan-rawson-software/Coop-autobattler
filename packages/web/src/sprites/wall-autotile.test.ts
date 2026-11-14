import { describe, expect, test } from 'vitest';
import atlasJson from '../../../../assets/sprites/atlas.json';
import {
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  cellSet,
  wallFrame,
} from './wall-autotile.js';

describe('wall autotile', () => {
  test('an isolated wall is frame 0', () => {
    expect(wallFrame(cellSet([{ x: 3, y: 3 }]), 3, 3)).toBe(0);
  });

  test('each cardinal neighbour sets its own bit', () => {
    const at = (dx: number, dy: number): number =>
      wallFrame(
        cellSet([
          { x: 5, y: 5 },
          { x: 5 + dx, y: 5 + dy },
        ]),
        5,
        5,
      );
    expect(at(0, -1)).toBe(WALL_N);
    expect(at(1, 0)).toBe(WALL_E);
    expect(at(0, 1)).toBe(WALL_S);
    expect(at(-1, 0)).toBe(WALL_W);
    expect([WALL_N, WALL_E, WALL_S, WALL_W]).toEqual([1, 2, 4, 8]);
  });

  test('diagonal walls do not count', () => {
    const has = cellSet([
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(wallFrame(has, 1, 1)).toBe(0);
  });

  test('a run and a cross', () => {
    const has = cellSet([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
    ]);
    expect(wallFrame(has, 0, 1)).toBe(WALL_E);
    expect(wallFrame(has, 2, 1)).toBe(WALL_W);
    expect(wallFrame(has, 1, 1)).toBe(15);
    expect(wallFrame(has, 1, 0)).toBe(WALL_S);
  });

  test('the atlas has 16 static frames for it', () => {
    const sp = atlasJson.sprites.bld_wall_auto;
    expect(sp.frames).toBe(16);
    expect(sp.fps).toBe(0);
    expect(sp.w).toBe(atlasJson.sprites.bld_wall_block.w);
  });
});
