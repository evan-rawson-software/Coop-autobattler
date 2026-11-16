/**
 * Pylon layout for the Pylons boss (MM-9d): where the pylons of each boss
 * Core stand. Everything is in the stronghold's board coordinates (all plots
 * side by side, `y = 0` the back row, `y = depth - 1` the front row). See
 * docs/rules-reference.md, "PvE threats".
 */

import type { Arena, ArenaBuilding } from './arena.js';
import { computeField } from './arena-paths.js';
import { divFloor } from './int.js';
import type { Cell } from './map.js';
import type { Rng } from './rng.js';
import { coreDistance } from './threat-layouts.js';
import type { PylonsTemplate } from './threats.js';

export interface PylonBoard {
  readonly plotWidth: number;
  readonly partySize: number;
  /** Rows of the stronghold board. */
  readonly depth: number;
  readonly coreWidth: number;
  readonly coreHeight: number;
}

/** A stronghold item that occupies a board cell (Core cell, wall, turret). */
export interface Occupier {
  readonly cells: readonly Cell[];
  /** The player index of a Core, else -1. */
  readonly core: number;
  readonly defenseType: 'wall' | 'turret' | null;
}

/**
 * The arena of a stronghold alone, for the "never seals a Core" check: the
 * boss is side 0 (arena cell = board cell) and the party is side 1 on an empty
 * board of the same size, with no gap rows, exactly as the Build screen's
 * enemy-path preview sets it up. Every item is a synthetic building.
 */
function strongholdArena(board: PylonBoard, items: readonly Occupier[]): Arena {
  const width = board.plotWidth * board.partySize;
  const height = 2 * board.depth;
  const occupant = new Int32Array(width * height).fill(-1);
  const buildings: ArenaBuilding[] = [];
  const coreRef: number[][] = [
    Array.from({ length: board.partySize }, () => -1),
    Array.from({ length: board.partySize }, () => -1),
  ];
  const add = (o: Occupier): number => {
    const ref = buildings.length;
    buildings.push({
      ref,
      side: 0,
      id: o.core >= 0 ? 0 : ref + 1,
      player: o.core,
      kind: o.core >= 0 ? 'core' : 'defense',
      defenseType: o.defenseType,
      def: '',
      cells: o.cells,
      alive: true,
    });
    for (const c of o.cells) occupant[c.y * width + c.x] = ref;
    return ref;
  };
  for (const o of items) {
    const ref = add(o);
    if (o.core >= 0) (coreRef[0] as number[])[o.core] = ref;
  }
  return {
    geom: { width, height, boardHeight: board.depth, gapRows: 0 },
    blocked: new Uint8Array(width * height),
    occupant,
    buildings,
    byId: [new Map(), new Map()],
    coreRef,
    pylons: [],
  };
}

/** Whether some front-row cell has a route to the Core of plot `core`. */
function reachable(arena: Arena, board: PylonBoard, core: number): boolean {
  const field = computeField(arena, 1, core);
  const width = arena.geom.width;
  const y = board.depth - 1;
  for (let x = 0; x < width; x++) {
    if ((field.dist[y * width + x] ?? -1) >= 0) return true;
  }
  return false;
}

/**
 * The sector (0 .. n-1) of the cell at offset `(vx, vy)` from the Core's
 * centre, both doubled so that the centre is an integer: walk clockwise round
 * the square of half-side `m = max(|vx|, |vy|)` that holds the cell, starting
 * at its back-left corner (`vy = -m`, `vx = -m`): `pos` runs over `0 .. 8m - 1`
 * (top edge `vx + m`, right edge `2m + vy + m`, bottom edge `4m + m - vx`,
 * left edge `6m + m - vy`, first matching edge wins), and
 * `sector = floor(n * pos / (8 * m))`.
 */
export function pylonSector(vx: number, vy: number, n: number): number {
  const m = Math.max(Math.abs(vx), Math.abs(vy));
  let pos: number;
  if (vy === -m) pos = vx + m;
  else if (vx === m) pos = 2 * m + vy + m;
  else if (vy === m) pos = 4 * m + m - vx;
  else pos = 6 * m + m - vy;
  return divFloor(n * pos, 8 * m);
}

export interface PlacedPylon {
  readonly core: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Place the pylons of every plot, plots in order. For plot `p` (stream
 * `rngOf(p)`): the candidate cells are the board cells of the plot's own
 * columns, not on the front row, not occupied by a Core, wall, turret or
 * earlier pylon, at Chebyshev distance `minDistance` to `maxDistance` from the
 * Core footprint. Each candidate has a sector (see `pylonSector`, `perPlot`
 * sectors). For sector `s = 0 .. perPlot - 1` in turn: the sector's candidates
 * (listed by `(y, x)`) are shuffled once with `rng.shuffle` and the first one
 * that does not seal the Core (some front-row cell still has a route to it in
 * the movement field of the party's units, if one had before) is taken; a
 * sector with no such cell gets no pylon. Returns the pylons in placement
 * order.
 */
export function placePylons(
  board: PylonBoard,
  cfg: PylonsTemplate,
  cores: readonly Cell[],
  fixed: readonly Occupier[],
  rngOf: (plot: number) => Rng,
): PlacedPylon[] {
  const { plotWidth, depth } = board;
  const items: Occupier[] = [...fixed];
  const arena = strongholdArena(board, items);
  const width = arena.geom.width;
  const placed: PlacedPylon[] = [];
  for (let p = 0; p < board.partySize; p++) {
    const dx = p * plotWidth;
    const core = cores[p];
    if (core === undefined) continue;
    const local = { x: core.x - dx, y: core.y };
    const layoutBoard = {
      width: plotWidth,
      height: depth,
      plotWidth,
      coreWidth: board.coreWidth,
      coreHeight: board.coreHeight,
    };
    const cx2 = 2 * local.x + board.coreWidth - 1;
    const cy2 = 2 * local.y + board.coreHeight - 1;
    const rng = rngOf(p);
    const sectors: Cell[][] = Array.from({ length: cfg.perPlot }, () => []);
    for (let y = 0; y <= depth - 2; y++) {
      for (let lx = 0; lx < plotWidth; lx++) {
        const d = coreDistance(local, layoutBoard, lx, y);
        if (d < cfg.minDistance || d > cfg.maxDistance) continue;
        if ((arena.occupant[y * width + lx + dx] ?? -1) >= 0) continue;
        const s = pylonSector(2 * lx - cx2, 2 * y - cy2, cfg.perPlot);
        sectors[s]?.push({ x: lx + dx, y });
      }
    }
    const wasReachable = reachable(arena, board, p);
    for (const cands of sectors) {
      for (const c of rng.shuffle(cands)) {
        if ((arena.occupant[c.y * width + c.x] ?? -1) >= 0) continue;
        const ref = arena.buildings.length;
        arena.buildings.push({
          ref,
          side: 0,
          id: ref + 1,
          player: -1,
          kind: 'defense',
          defenseType: 'pylon',
          def: '',
          cells: [c],
          alive: true,
        });
        arena.occupant[c.y * width + c.x] = ref;
        if (wasReachable && !reachable(arena, board, p)) {
          arena.buildings.pop();
          arena.occupant[c.y * width + c.x] = -1;
          continue;
        }
        placed.push({ core: p, x: c.x, y: c.y });
        break;
      }
    }
  }
  return placed;
}
