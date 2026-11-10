/**
 * Cell geometry for drawing and input (pure). Board-local coordinates: x to
 * the east, y to the north (the front edge is y = height - 1). Nothing here
 * decides legality; `core` does.
 */

import {
  rotateBuilding,
  type BuildingDef,
  type Cell,
  type Rotation,
  type Side,
} from '@game/core';

export const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];

export const STEP: Readonly<Record<Side, Cell>> = {
  north: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: -1 },
  west: { x: -1, y: 0 },
};

export const cellKeyOf = (c: Cell): string => `${String(c.x)},${String(c.y)}`;

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/** The cells a definition would cover at a position and rotation. */
export function footprintCells(
  def: BuildingDef,
  x: number,
  y: number,
  rotation: Rotation,
): Cell[] {
  const fp = rotateBuilding(def, rotation).footprint;
  const out: Cell[] = [];
  for (let dy = 0; dy < fp.height; dy++) {
    for (let dx = 0; dx < fp.width; dx++) out.push({ x: x + dx, y: y + dy });
  }
  return out;
}

/** Anchor so that the cursor cell sits near the middle of the footprint. */
export function anchorUnderCursor(
  def: BuildingDef,
  rotation: Rotation,
  cursor: Cell,
): Cell {
  const fp = rotateBuilding(def, rotation).footprint;
  return {
    x: cursor.x - Math.floor((fp.width - 1) / 2),
    y: cursor.y - Math.floor((fp.height - 1) / 2),
  };
}

/** The cells directly outside one side of a set of building cells. */
export function outsideCells(cells: readonly Cell[], side: Side): Cell[] {
  const have = new Set(cells.map(cellKeyOf));
  const s = STEP[side];
  const out: Cell[] = [];
  for (const c of cells) {
    const n = { x: c.x + s.x, y: c.y + s.y };
    if (!have.has(cellKeyOf(n))) out.push(n);
  }
  return out;
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function adjacent(a: Cell, b: Cell): boolean {
  return manhattan(a, b) === 1;
}
