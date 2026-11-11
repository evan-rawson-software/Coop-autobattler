import { describe, expect, test } from 'vitest';
import {
  SIDE_E,
  SIDE_N,
  SIDE_S,
  SIDE_W,
  conduitPiece,
} from '../sprites/conduit-piece.js';
import { conduitCells } from './sprite-board.js';
import type { BoardScene } from './scene.js';

const pt = (x: number, y: number) => ({ x: x + 0.5, y: y + 0.5 });

function boardWith(
  points: { x: number; y: number }[],
  cells: { x: number; y: number }[],
): BoardScene {
  return {
    conduits: [
      { id: 1, points, cells, color: '#fff', pattern: 0, resource: 'res_a' },
    ],
  } as unknown as BoardScene;
}

describe('conduit cells of a scene', () => {
  test('an L-shaped run between two buildings', () => {
    // Building cell (0,2), conduit (1,2) (2,2) (2,1), building cell (2,0).
    const pts = [pt(0, 2), pt(1, 2), pt(2, 2), pt(2, 1), pt(2, 0)];
    const out = conduitCells(boardWith(pts, [pt(1, 2), pt(2, 2), pt(2, 1)]));
    expect(out.map((c) => [c.x, c.y, c.sides])).toEqual([
      [1, 2, SIDE_W | SIDE_E],
      [2, 2, SIDE_W | SIDE_N],
      [2, 1, SIDE_S | SIDE_N],
    ]);
    expect(conduitPiece(out[1]?.sides ?? 0)).toEqual({
      kind: 'corner',
      rot: 3,
    });
    expect(conduitPiece(out[0]?.sides ?? 0)).toEqual({
      kind: 'straight',
      rot: 1,
    });
  });

  test('a run whose start building is missing begins with an end piece', () => {
    const pts = [pt(1, 2), pt(2, 2), pt(2, 1)];
    const out = conduitCells(boardWith(pts, [pt(1, 2), pt(2, 2)]));
    expect(out[0]?.sides).toBe(SIDE_E);
    expect(out[1]?.sides).toBe(SIDE_W | SIDE_N);
  });

  test('a direct connection has no conduit cells', () => {
    expect(conduitCells(boardWith([pt(0, 0), pt(1, 0)], []))).toEqual([]);
  });
});
