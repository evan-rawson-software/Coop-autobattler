import { describe, expect, test } from 'vitest';
import {
  boxToView,
  cellToView,
  makeLayout,
  sideStep,
  viewToCell,
} from './layout.js';

const size = { width: 24, height: 16 };

describe('single board', () => {
  const l = makeLayout(size, null, 5);

  test('the front row is at the top, the back row at the bottom', () => {
    expect(cellToView(l.own, 3, 15).y).toBe(0);
    expect(cellToView(l.own, 3, 0).y).toBe(15);
    expect(cellToView(l.own, 3, 0).x).toBe(3);
  });

  test('north is up the screen', () => {
    expect(sideStep(l.own, 'north')).toEqual({ x: 0, y: -1 });
  });

  test('no neutral strip without an enemy board', () => {
    expect(l.neutral).toBeNull();
    expect(l.enemy).toBeNull();
  });

  test('view and cell conversions are inverse', () => {
    for (const [x, y] of [
      [0, 0],
      [23, 15],
      [5, 9],
    ] as const) {
      const v = cellToView(l.own, x, y);
      expect(viewToCell(l.own, v.x + 0.5, v.y + 0.5)).toEqual({ x, y });
    }
    expect(viewToCell(l.own, -0.1, 3)).toBeNull();
    expect(viewToCell(l.own, 24, 3)).toBeNull();
  });

  test('a box covers the cells it names', () => {
    expect(boxToView(l.own, 2, 3, 3, 4)).toEqual({ x: 2, y: 11, w: 2, h: 2 });
  });
});

describe('two boards', () => {
  const l = makeLayout(size, size, 6);
  const enemy = l.enemy;

  test('the enemy is above, with the neutral strip between', () => {
    expect(enemy).not.toBeNull();
    if (!enemy) return;
    expect(enemy.oy).toBe(0);
    expect(l.neutral).toEqual({ x0: 0, y0: 16, x1: 24, y1: 22 });
    expect(l.own.oy).toBe(22);
  });

  test('the enemy front edge faces down toward ours', () => {
    if (!enemy) return;
    expect(cellToView(enemy, 0, 15).y).toBe(15);
    expect(cellToView(enemy, 0, 0).y).toBe(0);
    // Turned half a turn: its north is down the screen, east is left.
    expect(sideStep(enemy, 'north')).toEqual({ x: 0, y: 1 });
    expect(sideStep(enemy, 'east')).toEqual({ x: -1, y: 0 });
    expect(cellToView(enemy, 0, 0).x).toBe(23);
  });

  test('conversions are inverse on the enemy board', () => {
    if (!enemy) return;
    const v = cellToView(enemy, 4, 7);
    expect(viewToCell(enemy, v.x + 0.5, v.y + 0.5)).toEqual({ x: 4, y: 7 });
  });

  test('a narrower board is centred under a wider one', () => {
    const l2 = makeLayout(
      { width: 24, height: 16 },
      { width: 48, height: 16 },
      2,
    );
    expect(l2.own.ox).toBe(12);
    expect(l2.enemy?.ox).toBe(0);
  });

  test('bounds contain both boards', () => {
    expect(l.bounds.y0).toBeLessThan(0);
    expect(l.bounds.y1).toBeGreaterThan(38);
  });
});
