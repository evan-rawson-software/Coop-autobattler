/**
 * Cell geometry shared by the team-state and conduit code: footprint cells
 * of a building or the Core, and the cell index key. Pure.
 */
import {
  footprintCellList,
  rotateBuilding,
  type BuildingDef,
  type Rotation,
} from './buildings.js';
import type { Cell, GameMap } from './map.js';
import { coreFootprint } from './map.js';
import type { TeamContent } from './team-state.js';

/**
 * The absolute cells of a footprint of rotated size `(w, h)` anchored at
 * `(x, y)`: `x .. x + w - 1` by `y .. y + h - 1`, in `(y, x)` order. The
 * rotated bounding box is always anchored at the building's position.
 */
export function boxCells(x: number, y: number, w: number, h: number): Cell[] {
  const out: Cell[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  }
  return out;
}

/**
 * Cells covered by a definition at a position and rotation, in `(y, x)`
 * order: the rotated cell mask when the footprint has one (tetromino walls),
 * else the whole box.
 */
export function defCells(
  def: BuildingDef,
  x: number,
  y: number,
  rotation: Rotation,
): Cell[] {
  const fp = rotateBuilding(def, rotation).footprint;
  if (fp.cells === undefined) return boxCells(x, y, fp.width, fp.height);
  return footprintCellList(fp).map((c) => ({ x: x + c.x, y: y + c.y }));
}

/** `defCells` under the name the rules reference uses: the cells a building covers. */
export const footCells = defCells;

/** The rotated bounding box of a definition anchored at `(x, y)`. */
export function defBox(
  def: BuildingDef,
  x: number,
  y: number,
  rotation: Rotation,
): { x: number; y: number; w: number; h: number } {
  const fp = rotateBuilding(def, rotation).footprint;
  return { x, y, w: fp.width, h: fp.height };
}

export function coreCells(
  core: Cell,
  content: Pick<TeamContent, 'buildings'>,
): Cell[] {
  const fp = coreFootprint(content.buildings);
  return boxCells(core.x, core.y, fp.width, fp.height);
}

/** Cells of every placed Core (PP-2), in player order. */
export function allCoreCells(
  cores: readonly (Cell | null)[],
  content: Pick<TeamContent, 'buildings'>,
): Cell[] {
  const out: Cell[] = [];
  for (const core of cores) {
    if (core !== null) out.push(...coreCells(core, content));
  }
  return out;
}

export function cellKey(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}
