/**
 * Auto-route: a shortest-path PROPOSAL for a conduit. It is a plain
 * breadth-first search over in-bounds cells that only prefers cells that look
 * free (no terrain, building, Core or conduit). Whether the result is accepted
 * is decided by `core` (`addConduit`), never here. If no free-looking path
 * exists the search is repeated over all in-bounds cells so that `core` can
 * report the exact reason for the shortest path.
 */

import {
  occupancy,
  type Cell,
  type ConduitEnd,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';
import { STEP, SIDES, cellKeyOf, outsideCells, sameCell } from './geometry.js';
import { previewConduit } from './ops.js';

function inBounds(state: TeamState, c: Cell): boolean {
  return (
    c.x >= 0 && c.y >= 0 && c.x < state.map.width && c.y < state.map.height
  );
}

/** Cells that look occupied: terrain, buildings, the Core, conduit cells. */
function looksOccupied(state: TeamState, content: WebContent): Set<string> {
  const occ = occupancy(state, content);
  const out = new Set<string>();
  for (const f of state.map.features) out.add(cellKeyOf(f));
  for (const b of state.buildings) {
    for (const c of occ.cellsOf(b)) out.add(cellKeyOf(c));
  }
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const hit = occ.buildingAt(x, y);
      if (hit !== null && 'core' in hit) out.add(cellKeyOf({ x, y }));
    }
  }
  for (const c of state.conduits) {
    for (const p of c.cells) out.add(cellKeyOf(p));
  }
  return out;
}

function bfs(
  state: TeamState,
  starts: readonly Cell[],
  goals: readonly Cell[],
  blocked: ReadonlySet<string>,
): Cell[] | null {
  const goalKeys = new Set(goals.map(cellKeyOf));
  const prev = new Map<string, string | null>();
  const cellOf = new Map<string, Cell>();
  const queue: Cell[] = [];
  for (const s of starts) {
    const k = cellKeyOf(s);
    if (!inBounds(state, s) || blocked.has(k) || prev.has(k)) continue;
    prev.set(k, null);
    cellOf.set(k, s);
    queue.push(s);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as Cell;
    const ck = cellKeyOf(cur);
    if (goalKeys.has(ck)) {
      const path: Cell[] = [];
      let k: string | null = ck;
      while (k !== null) {
        path.push(cellOf.get(k) as Cell);
        k = prev.get(k) ?? null;
      }
      return path.reverse();
    }
    for (const side of SIDES) {
      const d = STEP[side];
      const n = { x: cur.x + d.x, y: cur.y + d.y };
      const nk = cellKeyOf(n);
      if (!inBounds(state, n) || blocked.has(nk) || prev.has(nk)) continue;
      prev.set(nk, ck);
      cellOf.set(nk, n);
      queue.push(n);
    }
  }
  return null;
}

/**
 * Shortest route from any of `starts` to any of `goals` (inclusive). Free-
 * looking cells are preferred; `avoid` cells are never used.
 */
export function routeBetween(
  state: TeamState,
  content: WebContent,
  starts: readonly Cell[],
  goals: readonly Cell[],
  avoid: readonly Cell[] = [],
): Cell[] | null {
  const avoidKeys = new Set(avoid.map(cellKeyOf));
  const strict = looksOccupied(state, content);
  for (const k of avoidKeys) strict.add(k);
  return (
    bfs(state, starts, goals, strict) ?? bfs(state, starts, goals, avoidKeys)
  );
}

/**
 * Propose the cells for a conduit from `from` to `to`, continuing the cells
 * already drawn (`existing`, may be empty). Returns an empty list when the two
 * sides directly face each other (core confirms), and null if the board has no
 * route at all.
 */
export function proposePath(
  state: TeamState,
  content: WebContent,
  from: ConduitEnd,
  to: ConduitEnd,
  existing: readonly Cell[] = [],
): Cell[] | null {
  const a = state.buildings.find((b) => b.id === from.building);
  const b = state.buildings.find((x) => x.id === to.building);
  if (a === undefined || b === undefined) return null;
  if (existing.length === 0) {
    // Let core say whether the sides face each other: any answer but
    // invalid_path means the empty path was understood as a direct link.
    const direct = previewConduit(state, content, from, to, []);
    if (direct.ok || direct.reason !== 'invalid_path') return [];
  }
  const occ = occupancy(state, content);
  const goals = outsideCells(occ.cellsOf(b), to.side);
  const last = existing[existing.length - 1];
  const starts =
    last === undefined ? outsideCells(occ.cellsOf(a), from.side) : [last];
  const avoid = existing.slice(0, -1);
  const found = routeBetween(state, content, starts, goals, avoid);
  if (found === null) return null;
  return [...avoid, ...found];
}

/** Extend a partly drawn path to a clicked cell by the shortest route. */
export function extendPath(
  state: TeamState,
  content: WebContent,
  from: ConduitEnd,
  existing: readonly Cell[],
  target: Cell,
): Cell[] | null {
  const a = state.buildings.find((b) => b.id === from.building);
  if (a === undefined) return null;
  const last = existing[existing.length - 1];
  if (last !== undefined && sameCell(last, target)) return [...existing];
  const occ = occupancy(state, content);
  const starts =
    last === undefined ? outsideCells(occ.cellsOf(a), from.side) : [last];
  const avoid = existing.slice(0, -1);
  const found = routeBetween(state, content, starts, [target], avoid);
  if (found === null) return null;
  return [...avoid, ...found];
}
