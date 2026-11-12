/**
 * The arena (W1-5, CB-3d, CB-3j): one grid that holds both boards and the
 * ground between them. Units live here; flow simulation stays in each board's
 * own coordinates. See docs/rules-reference.md, "The arena".
 *
 * Side 0's board occupies arena rows `0 .. h - 1` unchanged. Then `gapRows`
 * rows of open ground (the future neutral zone). Then side 1's board rotated
 * 180 degrees: board cell `(x, y)` is arena cell `(W - 1 - x, H - 1 - y)`
 * with `H = 2h + gapRows`.
 */

import type { BuildingKind, DefenseType } from './buildings.js';
import { coreFootprint, type Cell } from './map.js';
import { occupancy, type TeamContent, type TeamState } from './team-state.js';
import type { UnitConfig } from './units.js';

/** What the arena code needs from the loaded content. */
export interface ArenaContent extends TeamContent {
  readonly units: UnitConfig;
}

export interface ArenaGeometry {
  readonly width: number;
  /** Total rows: `2 * boardHeight + gapRows`. */
  readonly height: number;
  readonly boardHeight: number;
  readonly gapRows: number;
}

/** A board cell of `side` as an arena cell. Side 0 is the identity. */
export function toArena(geom: ArenaGeometry, side: number, cell: Cell): Cell {
  return side === 0
    ? { x: cell.x, y: cell.y }
    : { x: geom.width - 1 - cell.x, y: geom.height - 1 - cell.y };
}

/** An arena cell as a board cell of `side`. Inverse of `toArena`. */
export function toBoard(geom: ArenaGeometry, side: number, cell: Cell): Cell {
  return toArena(geom, side, cell); // the rotation is its own inverse
}

/** One building (or a Core) as the arena sees it. Conduits are never here. */
export interface ArenaBuilding {
  /** Index into `Arena.buildings`. */
  readonly ref: number;
  readonly side: number;
  /** Instance ID, or 0 for a Core (then `player` tells which). */
  readonly id: number;
  /** The player index of a Core (PP-9); -1 for any other building. */
  readonly player: number;
  readonly kind: BuildingKind;
  readonly defenseType: DefenseType | null;
  readonly def: string;
  /** Covered arena cells, in `(y, x)` order of the arena. */
  readonly cells: readonly Cell[];
  /** False once destroyed; its cells are open ground again. */
  alive: boolean;
}

export interface Arena {
  readonly geom: ArenaGeometry;
  /** Per cell (`y * width + x`): 1 when terrain or a gap cell blocks movement. */
  readonly blocked: Uint8Array;
  /** Per cell: index into `buildings` of the building covering it, else -1. */
  readonly occupant: Int32Array;
  readonly buildings: ArenaBuilding[];
  /** Per side: instance ID -> `ref`. */
  readonly byId: readonly Map<number, number>[];
  /**
   * Per side, per player index: `ref` of that player's Core, or -1 when none
   * was placed (PP-9).
   */
  readonly coreRef: number[][];
}

/** Cell index `y * width + x`. */
export function cellIndex(geom: ArenaGeometry, x: number, y: number): number {
  return y * geom.width + x;
}

/**
 * Build the arena for two teams. Both boards must have the same width and
 * height. `gapBlocked` lists blocked arena cells inside the gap rows (the
 * neutral zone will use it); conduits are not in the arena.
 */
export function createArena(
  teamA: TeamState,
  teamB: TeamState,
  gapRows: number,
  content: TeamContent,
  gapBlocked: readonly Cell[] = [],
): Arena {
  const a = teamA.map;
  const b = teamB.map;
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `Arena: both boards must have the same size; got ${String(a.width)}x${String(a.height)} and ${String(b.width)}x${String(b.height)}.`,
    );
  }
  if (!Number.isInteger(gapRows) || gapRows < 0) {
    throw new RangeError('Arena: gapRows must be a non-negative integer.');
  }
  const geom: ArenaGeometry = {
    width: a.width,
    height: 2 * a.height + gapRows,
    boardHeight: a.height,
    gapRows,
  };
  const n = geom.width * geom.height;
  const blocked = new Uint8Array(n);
  const occupant = new Int32Array(n).fill(-1);
  const buildings: ArenaBuilding[] = [];
  const teams = [teamA, teamB];
  const byId: Map<number, number>[] = [
    new Map<number, number>(),
    new Map<number, number>(),
  ];
  const coreRef: number[][] = teams.map((t) => t.cores.map(() => -1));

  teams.forEach((team, side) => {
    for (const f of team.map.features) {
      const def = content.terrain.get(f.feature);
      if (def === undefined) throw new Error(`Unknown feature "${f.feature}".`);
      if (!def.blocksMovement) continue;
      const c = toArena(geom, side, f);
      blocked[cellIndex(geom, c.x, c.y)] = 1;
    }
  });
  for (const g of gapBlocked) {
    if (
      !Number.isInteger(g.x) ||
      !Number.isInteger(g.y) ||
      g.x < 0 ||
      g.x >= geom.width ||
      g.y < geom.boardHeight ||
      g.y >= geom.boardHeight + gapRows
    ) {
      throw new RangeError(
        `Arena: blocked gap cell (${String(g.x)}, ${String(g.y)}) is outside the gap rows.`,
      );
    }
    blocked[cellIndex(geom, g.x, g.y)] = 1;
  }

  const add = (
    side: number,
    id: number,
    kind: BuildingKind,
    defenseType: DefenseType | null,
    def: string,
    boardCells: readonly Cell[],
    player = -1,
  ): void => {
    const ref = buildings.length;
    const cells = boardCells
      .map((c) => toArena(geom, side, c))
      .sort((p, q) => p.y - q.y || p.x - q.x);
    buildings.push({
      ref,
      side,
      id,
      player,
      kind,
      defenseType,
      def,
      cells,
      alive: true,
    });
    for (const c of cells) occupant[cellIndex(geom, c.x, c.y)] = ref;
    if (kind === 'core') {
      const refs = coreRef[side];
      if (refs !== undefined) refs[player] = ref;
    } else byId[side]?.set(id, ref);
  };

  teams.forEach((team, side) => {
    const fp = coreFootprint(content.buildings);
    const coreDef = content.buildings.list().find((d) => d.kind === 'core');
    team.cores.forEach((core, player) => {
      if (core === null) return;
      const cells: Cell[] = [];
      for (let dy = 0; dy < fp.height; dy++) {
        for (let dx = 0; dx < fp.width; dx++) {
          cells.push({ x: core.x + dx, y: core.y + dy });
        }
      }
      add(side, 0, 'core', null, coreDef?.id ?? 'core', cells, player);
    });
    const occ = occupancy(team, content);
    for (const p of team.buildings) {
      const def = content.buildings.get(p.def);
      if (def === undefined) throw new Error(`Unknown building "${p.def}".`);
      add(
        side,
        p.id,
        def.kind,
        def.kind === 'defense' ? def.defenseType : null,
        p.def,
        occ.cellsOf(p),
      );
    }
  });
  return { geom, blocked, occupant, buildings, byId, coreRef };
}

/** Take a building out of the arena: its cells become open ground. */
export function removeFromArena(arena: Arena, ref: number): void {
  const b = arena.buildings[ref];
  if (b === undefined || !b.alive) return;
  b.alive = false;
  for (const c of b.cells) {
    arena.occupant[cellIndex(arena.geom, c.x, c.y)] = -1;
  }
}
