/**
 * Which sides of placed buildings are free to take a conduit end (pure). The
 * sides come from `core`'s `occupancy`; "free" is only "no conduit is attached
 * yet", which `core` re-checks (`side_in_use`) when a conduit is added.
 */

import {
  occupancy,
  type Cell,
  type ConduitEnd,
  type PlacedBuilding,
  type Side,
  type TeamState,
  buildingEnd,
} from '@game/core';
import type { WebContent } from '../content.js';
import { manhattan, outsideCells, sameCell } from './geometry.js';

export interface SideMarker {
  readonly building: number;
  readonly side: Side;
  /** The cells just outside that side (one per edge cell). */
  readonly cells: readonly Cell[];
}

export function freeOutputSides(
  team: TeamState,
  content: WebContent,
  b: PlacedBuilding,
): Side[] {
  const occ = occupancy(team, content);
  return occ.absoluteSides(b).outputs.filter(
    (side) =>
      !team.conduits.some((c) => {
        const f = buildingEnd(c.from);
        return f !== null && f.building === b.id && f.side === side;
      }),
  );
}

export function freeInputSides(
  team: TeamState,
  content: WebContent,
  b: PlacedBuilding,
): Side[] {
  const occ = occupancy(team, content);
  return occ
    .absoluteSides(b)
    .inputs.map((i) => i.side)
    .filter(
      (side) =>
        !team.conduits.some((c) => {
          const t = buildingEnd(c.to);
          return t !== null && t.building === b.id && t.side === side;
        }),
    );
}

/** Markers for free output or input sides, of one building or of all. */
export function sideMarkers(
  team: TeamState,
  content: WebContent,
  kind: 'out' | 'in',
  only: number | null = null,
  except: number | null = null,
): SideMarker[] {
  const occ = occupancy(team, content);
  const out: SideMarker[] = [];
  for (const b of team.buildings) {
    if (only !== null && b.id !== only) continue;
    if (except !== null && b.id === except) continue;
    const sides =
      kind === 'out'
        ? freeOutputSides(team, content, b)
        : freeInputSides(team, content, b);
    const cells = occ.cellsOf(b);
    for (const side of sides) {
      out.push({ building: b.id, side, cells: outsideCells(cells, side) });
    }
  }
  return out;
}

export function markerAt(
  markers: readonly SideMarker[],
  cell: Cell,
): SideMarker | null {
  return markers.find((m) => m.cells.some((c) => sameCell(c, cell))) ?? null;
}

/**
 * The input side of `b` to aim at when the user points at the building: the
 * free input whose outside cells are nearest to `near`. With no free input the
 * first one, so that `core` can say why it is not possible; with no inputs at
 * all, a side core will refuse with `not_an_input`.
 */
export function chooseInput(
  team: TeamState,
  content: WebContent,
  b: PlacedBuilding,
  near: Cell | null,
): ConduitEnd {
  const occ = occupancy(team, content);
  const cells = occ.cellsOf(b);
  const free = freeInputSides(team, content, b);
  const all = occ.absoluteSides(b).inputs.map((i) => i.side);
  const pool = free.length > 0 ? free : all;
  if (pool.length === 0) return { building: b.id, side: 'north' };
  const dist = (side: Side): number => {
    if (near === null) return 0;
    return Math.min(
      ...outsideCells(cells, side).map((c) => manhattan(c, near)),
    );
  };
  let best = pool[0] as Side;
  for (const s of pool) if (dist(s) < dist(best)) best = s;
  return { building: b.id, side: best };
}

function inBoundsOf(team: TeamState, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < team.map.width && c.y < team.map.height;
}

/** Whether every cell just outside `side` of `b` is off the board. */
export function facesBoardEdge(
  team: TeamState,
  content: WebContent,
  b: PlacedBuilding,
  side: Side,
): boolean {
  const out = outsideCells(occupancy(team, content).cellsOf(b), side);
  return out.length > 0 && out.every((c) => !inBoundsOf(team, c));
}

/**
 * A building that sends something out, none of whose output sides can reach
 * a conduit because they all face the board edge.
 */
export function outputFacesEdge(
  team: TeamState,
  content: WebContent,
  b: PlacedBuilding,
): boolean {
  const outs = occupancy(team, content).absoluteSides(b).outputs;
  return (
    outs.length > 0 && outs.every((s) => facesBoardEdge(team, content, b, s))
  );
}
