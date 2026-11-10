/**
 * Where boards sit in view space (pure). View space has x to the right and y
 * down the screen, one unit per cell. The own board is at the bottom with its
 * front edge (y = height - 1) along its top. The enemy board, when shown, is
 * above, turned half a turn so its front edge faces down toward ours, with an
 * empty neutral strip between.
 *
 * This is presentation geometry only: it maps cells to places on screen.
 */

import type { Side } from '@game/core';
import type { Bounds } from './camera.js';

export type BoardId = 'own' | 'enemy';

export interface BoardFrame {
  readonly id: BoardId;
  /** Board size in cells. */
  readonly w: number;
  readonly h: number;
  /** View-space top-left corner of the board rectangle. */
  readonly ox: number;
  readonly oy: number;
  /** True when drawn turned half a turn (the enemy board). */
  readonly turned: boolean;
}

export interface BoardLayout {
  readonly frames: readonly BoardFrame[];
  readonly own: BoardFrame;
  readonly enemy: BoardFrame | null;
  /** The neutral strip rectangle, or null. */
  readonly neutral: Bounds | null;
  /** Everything the camera may show, including a margin. */
  readonly bounds: Bounds;
}

/** Empty margin around the content, in cells (room for edge labels). */
export const MARGIN = 1.6;

export function makeLayout(
  own: { width: number; height: number },
  enemy: { width: number; height: number } | null,
  neutralHeight: number,
): BoardLayout {
  const maxW = Math.max(own.width, enemy?.width ?? 0);
  const n = enemy ? Math.max(0, neutralHeight) : 0;
  const eh = enemy?.height ?? 0;
  const ownFrame: BoardFrame = {
    id: 'own',
    w: own.width,
    h: own.height,
    ox: (maxW - own.width) / 2,
    oy: eh + n,
    turned: false,
  };
  const enemyFrame: BoardFrame | null = enemy
    ? {
        id: 'enemy',
        w: enemy.width,
        h: enemy.height,
        ox: (maxW - enemy.width) / 2,
        oy: 0,
        turned: true,
      }
    : null;
  const neutral: Bounds | null =
    enemy && n > 0 ? { x0: 0, y0: eh, x1: maxW, y1: eh + n } : null;
  const bounds: Bounds = {
    x0: -MARGIN,
    y0: -MARGIN,
    x1: maxW + MARGIN,
    y1: eh + n + own.height + MARGIN,
  };
  return {
    frames: enemyFrame ? [enemyFrame, ownFrame] : [ownFrame],
    own: ownFrame,
    enemy: enemyFrame,
    neutral,
    bounds,
  };
}

/** The view-space top-left of a board-local cell. */
export function cellToView(
  f: BoardFrame,
  x: number,
  y: number,
): { x: number; y: number } {
  return f.turned
    ? { x: f.ox + (f.w - 1 - x), y: f.oy + y }
    : { x: f.ox + x, y: f.oy + (f.h - 1 - y) };
}

/**
 * View-space rectangle of the board-local cells `x0..x1` by `y0..y1`
 * (inclusive).
 */
export function boxToView(
  f: BoardFrame,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number; w: number; h: number } {
  const a = cellToView(f, x0, y0);
  const b = cellToView(f, x1, y1);
  const vx = Math.min(a.x, b.x);
  const vy = Math.min(a.y, b.y);
  return {
    x: vx,
    y: vy,
    w: Math.abs(a.x - b.x) + 1,
    h: Math.abs(a.y - b.y) + 1,
  };
}

/**
 * The board-local cell under a view-space point, or null when the point is
 * not on that board.
 */
export function viewToCell(
  f: BoardFrame,
  vx: number,
  vy: number,
): { x: number; y: number } | null {
  const ix = Math.floor(vx - f.ox);
  const iy = Math.floor(vy - f.oy);
  if (ix < 0 || iy < 0 || ix >= f.w || iy >= f.h) return null;
  return f.turned ? { x: f.w - 1 - ix, y: iy } : { x: ix, y: f.h - 1 - iy };
}

/**
 * The view-space step for one cell toward a board-local side. North is +y of
 * the board, which is up the screen for the own board and down for the turned
 * enemy board.
 */
export function sideStep(f: BoardFrame, side: Side): { x: number; y: number } {
  const own = {
    north: { x: 0, y: -1 },
    south: { x: 0, y: 1 },
    east: { x: 1, y: 0 },
    west: { x: -1, y: 0 },
  }[side];
  return f.turned ? { x: 0 - own.x, y: 0 - own.y } : own;
}
