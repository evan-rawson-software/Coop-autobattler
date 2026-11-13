/**
 * Conduits (W1-3, CB-3g, CB-3h, CB-5a, CB-5b, CB-9, CB-9a to CB-9c, CB-10):
 * drawing rules, resource typing, the no-loop rule and the flow graph.
 * All functions are pure. See docs/rules-reference.md, "Conduits".
 */

import { decodeConduitId, encodeConduitId } from './conduit-ids.js';
import { allCoreCells, cellKey, defCells } from './board-cells.js';
import {
  oppositeSide,
  rotateBuilding,
  type BuildingDef,
  type BuildingId,
  type Side,
} from './buildings.js';
import { sortedKeys } from './hash.js';
import { isRecord } from './load-util.js';
import { queryMap, type Cell, type GameMap, type MapQuery } from './map.js';
import type { ResourceId } from './resources.js';
import {
  buildingEnd,
  conduitTouches,
  isBorderEnd,
  type BorderEnd,
  type Conduit,
  type ConduitEnd,
  type OpFailure,
  type PlacedBuilding,
  type TeamContent,
  type TeamState,
} from './team-state.js';

// ---------------------------------------------------------------------------
// Types

export type ConduitReason =
  | 'invalid_conduit_id'
  | 'unknown_building'
  | 'not_owner'
  | 'invalid_border'
  | 'not_an_output'
  | 'not_an_input'
  | 'side_in_use'
  | 'border_spot_in_use'
  | 'invalid_path'
  | 'outside_own_plot'
  | 'blocked_by_feature'
  | 'overlaps_core'
  | 'overlaps_building'
  | 'crosses_conduit'
  | 'resource_mismatch'
  | 'would_loop';

export type AddConduitResult =
  | { readonly ok: true; readonly state: TeamState; readonly id: number }
  | OpFailure<ConduitReason>;

/** The four absolute sides in the fixed clockwise order starting at north. */
export const SIDE_ORDER: readonly Side[] = ['north', 'east', 'south', 'west'];

function isSide(v: unknown): v is Side {
  return v === 'north' || v === 'east' || v === 'south' || v === 'west';
}

const isInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v);

// ---------------------------------------------------------------------------
// A read-only view of the board

interface Entry {
  readonly b: PlacedBuilding;
  readonly def: BuildingDef;
  readonly box: { x: number; y: number; w: number; h: number };
  readonly inputs: readonly { side: Side; resource?: ResourceId }[];
  readonly outputs: readonly Side[];
}

interface View {
  readonly state: TeamState;
  readonly q: MapQuery;
  readonly byId: ReadonlyMap<number, Entry>;
  /** Cell key -> building ID, for in-bounds cells. */
  readonly cellOwner: ReadonlyMap<number, number>;
  readonly coreKeys: ReadonlySet<number>;
}

/** Never throws: buildings with unknown definitions are left out. */
function makeView(state: TeamState, content: TeamContent): View {
  const map = state.map;
  const byId = new Map<number, Entry>();
  const cellOwner = new Map<number, number>();
  for (const b of state.buildings) {
    const def = content.buildings.get(b.def);
    if (def === undefined) continue;
    const r = rotateBuilding(def, b.rotation);
    byId.set(b.id, {
      b,
      def,
      box: { x: b.x, y: b.y, w: r.footprint.width, h: r.footprint.height },
      inputs: r.inputs,
      outputs: r.outputs,
    });
    for (const c of defCells(def, b.x, b.y, b.rotation)) {
      if (c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height) {
        cellOwner.set(cellKey(map, c.x, c.y), b.id);
      }
    }
  }
  const coreKeys = new Set<number>();
  for (const c of allCoreCells(state.cores, content)) {
    coreKeys.add(cellKey(map, c.x, c.y));
  }
  return {
    state,
    q: queryMap(map, content.terrain),
    byId,
    cellOwner,
    coreKeys,
  };
}

// ---------------------------------------------------------------------------
// Side geometry

/**
 * The cells directly outside the edges of a box's `side`, in increasing
 * coordinate order (west to east for north and south, south to north for east
 * and west). One cell per edge.
 */
function outsideCells(box: Entry['box'], side: Side): Cell[] {
  const out: Cell[] = [];
  switch (side) {
    case 'north':
      for (let i = 0; i < box.w; i++)
        out.push({ x: box.x + i, y: box.y + box.h });
      break;
    case 'south':
      for (let i = 0; i < box.w; i++) out.push({ x: box.x + i, y: box.y - 1 });
      break;
    case 'east':
      for (let j = 0; j < box.h; j++)
        out.push({ x: box.x + box.w, y: box.y + j });
      break;
    case 'west':
      for (let j = 0; j < box.h; j++) out.push({ x: box.x - 1, y: box.y + j });
      break;
  }
  return out;
}

function inBox(box: Entry['box'], c: Cell): boolean {
  return (
    c.x >= box.x && c.x < box.x + box.w && c.y >= box.y && c.y < box.y + box.h
  );
}

/**
 * Whether the `from` side of A directly faces the `to` side of B: B's side is
 * the opposite of A's and at least one edge of A's side is also an edge of B's
 * (the cell outside that edge is a cell of B).
 */
function directlyFaces(
  a: Entry,
  fromSide: Side,
  b: Entry,
  toSide: Side,
): boolean {
  if (toSide !== oppositeSide(fromSide)) return false;
  return outsideCells(a.box, fromSide).some((c) => inBox(b.box, c));
}

// ---------------------------------------------------------------------------
// Per-conduit rules

type Failure = OpFailure<ConduitReason>;

function pt(c: Cell): string {
  return `(${String(c.x)}, ${String(c.y)})`;
}

/**
 * How often each conduit end side and each path cell is used across a list of
 * conduits, built once so that checking every conduit stays linear (counting
 * "the other conduits" as the total minus the conduit's own use).
 */
interface Occupancy {
  readonly outs: Map<string, number>;
  readonly ins: Map<string, number>;
  readonly cells: Map<number, number>;
  /** Halves per `owner:border:y` spot. */
  readonly spots: Map<string, number>;
}

/** The border spot of a half, or null for an ordinary conduit. */
function spotOf(c: Conduit): BorderEnd | null {
  if (isBorderEnd(c.from)) return c.from;
  if (isBorderEnd(c.to)) return c.to;
  return null;
}

function spotKey(owner: number, sp: BorderEnd): string {
  return `${String(owner)}:${String(sp.border)}:${String(sp.y)}`;
}

function endKey(e: { building: number; side: Side }): string {
  return `${String(e.building)}.${e.side}`;
}

function occupancyOf(map: GameMap, conduits: readonly Conduit[]): Occupancy {
  const outs = new Map<string, number>();
  const ins = new Map<string, number>();
  const cells = new Map<number, number>();
  const spots = new Map<string, number>();
  const bump = <K>(m: Map<K, number>, k: K): void => {
    m.set(k, (m.get(k) ?? 0) + 1);
  };
  for (const o of conduits) {
    const f = buildingEnd(o.from);
    const t = buildingEnd(o.to);
    if (f !== null) bump(outs, endKey(f));
    if (t !== null) bump(ins, endKey(t));
    const sp = spotOf(o);
    if (sp !== null) bump(spots, spotKey(o.owner, sp));
    for (const cell of o.cells) {
      if (isInt(cell.x) && isInt(cell.y))
        bump(cells, cellKey(map, cell.x, cell.y));
    }
  }
  return { outs, ins, cells, spots };
}

/**
 * The owner's border cell of a spot (PP-4): `(xL, y)` for player `border`,
 * `(xR, y)` for player `border + 1`.
 */
function ownBorderCell(map: GameMap, owner: number, sp: BorderEnd): Cell {
  const xL = (sp.border + 1) * map.plotWidth - 1;
  return { x: owner === sp.border ? xL : xL + 1, y: sp.y };
}

/**
 * Check one conduit (or half) against the board and the other conduits.
 * Rules in this order, the first failure reported: unknown_building,
 * not_owner, invalid_border, not_an_output, not_an_input, side_in_use,
 * border_spot_in_use, invalid_path, outside_own_plot, blocked_by_feature,
 * overlaps_core, overlaps_building, crosses_conduit. (resource_mismatch and
 * would_loop need the whole network and are checked after these, by the
 * caller.)
 */
function checkConduit(
  view: View,
  c: Conduit,
  occ: Occupancy,
  self: boolean,
): Failure | null {
  const map = view.state.map;
  const fe = buildingEnd(c.from);
  const te = buildingEnd(c.to);
  if (fe === null && te === null) {
    return {
      ok: false,
      reason: 'invalid_border',
      detail: 'a conduit needs a building end',
    };
  }
  const a = fe === null ? undefined : view.byId.get(fe.building);
  const b = te === null ? undefined : view.byId.get(te.building);
  if ((fe !== null && a === undefined) || (te !== null && b === undefined)) {
    return {
      ok: false,
      reason: 'unknown_building',
      detail: String(
        fe !== null && a === undefined ? fe.building : te?.building,
      ),
    };
  }
  if (a !== undefined && a.b.owner !== c.owner) {
    return { ok: false, reason: 'not_owner', detail: String(a.b.id) };
  }
  if (b !== undefined && b.b.owner !== c.owner) {
    return { ok: false, reason: 'not_owner', detail: String(b.b.id) };
  }
  const sp = spotOf(c);
  if (sp !== null) {
    const ok =
      isInt(sp.border) &&
      isInt(sp.y) &&
      sp.border >= 0 &&
      sp.border <= map.partySize - 2 &&
      sp.y >= 0 &&
      sp.y < map.height &&
      (c.owner === sp.border || c.owner === sp.border + 1);
    if (!ok) {
      return {
        ok: false,
        reason: 'invalid_border',
        detail: `${String(sp.border)}, ${String(sp.y)}`,
      };
    }
  }
  if (fe !== null && a !== undefined && !a.outputs.includes(fe.side)) {
    return { ok: false, reason: 'not_an_output', detail: fe.side };
  }
  if (
    te !== null &&
    b !== undefined &&
    !b.inputs.some((i) => i.side === te.side)
  ) {
    return { ok: false, reason: 'not_an_input', detail: te.side };
  }
  const own = self ? 1 : 0;
  if (fe !== null && (occ.outs.get(endKey(fe)) ?? 0) > own) {
    return { ok: false, reason: 'side_in_use', detail: 'output' };
  }
  if (te !== null && (occ.ins.get(endKey(te)) ?? 0) > own) {
    return { ok: false, reason: 'side_in_use', detail: 'input' };
  }
  if (sp !== null && (occ.spots.get(spotKey(c.owner, sp)) ?? 0) > own) {
    return { ok: false, reason: 'border_spot_in_use' };
  }

  // invalid_path
  const bad = (detail: string): Failure => ({
    ok: false,
    reason: 'invalid_path',
    detail,
  });
  const cells = c.cells;
  // Where the path must start and end: a cell outside a building side, or
  // the owner's border cell of the spot.
  const outsideOf = (e: Entry, side: Side) => (cell: Cell) =>
    outsideCells(e.box, side).some((o) => o.x === cell.x && o.y === cell.y);
  let direct: boolean;
  let startOk: (cell: Cell) => boolean;
  let endOk: (cell: Cell) => boolean;
  if (sp === null) {
    const ea = a as Entry;
    const eb = b as Entry;
    const fs = (fe as ConduitEnd).side;
    const ts = (te as ConduitEnd).side;
    direct = directlyFaces(ea, fs, eb, ts);
    startOk = outsideOf(ea, fs);
    endOk = outsideOf(eb, ts);
  } else {
    const border = ownBorderCell(map, c.owner, sp);
    const onBorder = (cell: Cell): boolean =>
      cell.x === border.x && cell.y === border.y;
    const e = (a ?? b) as Entry;
    const side = ((fe ?? te) as ConduitEnd).side;
    const facing: Side = c.owner === sp.border ? 'east' : 'west';
    direct = inBox(e.box, border) && side === facing;
    if (fe !== null) {
      startOk = outsideOf(e, side);
      endOk = onBorder;
    } else {
      startOk = onBorder;
      endOk = outsideOf(e, side);
    }
  }
  if (direct) {
    if (cells.length !== 0) return bad('a direct connection has no cells');
  } else {
    if (cells.length === 0) return bad('sides do not face; cells are needed');
    const seen = new Set<number>();
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (
        cell === undefined ||
        !isInt(cell.x) ||
        !isInt(cell.y) ||
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= map.width ||
        cell.y >= map.height
      ) {
        return bad(`cell ${String(i)} is not an in-bounds integer cell`);
      }
      const k = cellKey(map, cell.x, cell.y);
      if (seen.has(k)) return bad(`cell ${pt(cell)} repeats`);
      seen.add(k);
      const prev = cells[i - 1];
      if (
        prev !== undefined &&
        Math.abs(prev.x - cell.x) + Math.abs(prev.y - cell.y) !== 1
      ) {
        return bad(`cells ${String(i - 1)} and ${String(i)} are not adjacent`);
      }
    }
    if (!startOk(cells[0] as Cell)) {
      return bad(
        fe !== null || sp === null
          ? 'the first cell is not outside the from side'
          : 'the first cell is not on the border cell',
      );
    }
    if (!endOk(cells[cells.length - 1] as Cell)) {
      return bad(
        fe === null || sp === null
          ? 'the last cell is not outside the to side'
          : 'the last cell is not on the border cell',
      );
    }
  }

  for (const cell of cells) {
    if (view.q.plotOf(cell.x) !== c.owner) {
      return { ok: false, reason: 'outside_own_plot', detail: pt(cell) };
    }
  }
  for (const cell of cells) {
    if (!view.q.isBuildable(cell.x, cell.y)) {
      return { ok: false, reason: 'blocked_by_feature', detail: pt(cell) };
    }
  }
  for (const cell of cells) {
    if (view.coreKeys.has(cellKey(map, cell.x, cell.y))) {
      return { ok: false, reason: 'overlaps_core', detail: pt(cell) };
    }
  }
  for (const cell of cells) {
    if (view.cellOwner.has(cellKey(map, cell.x, cell.y))) {
      return { ok: false, reason: 'overlaps_building', detail: pt(cell) };
    }
  }
  // The cells are distinct here, so this conduit holds each of its own cells
  // once in `occ.cells`; any more is another conduit's.
  for (const cell of cells) {
    if ((occ.cells.get(cellKey(map, cell.x, cell.y)) ?? 0) > own) {
      return { ok: false, reason: 'crosses_conduit', detail: pt(cell) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The joined network (PP-4)

/** A building end of a flow edge. */
interface BEnd {
  readonly building: number;
  readonly side: Side;
}

/**
 * One edge of the joined network: an ordinary conduit, a link (a sending half
 * joined to a receiving half) or an open sending half (`to` is null). Open
 * receiving halves have no edge. `id` is the conduit's, or the sending
 * half's; `linked` is the receiving half's id for a link.
 */
interface Edge {
  readonly id: number;
  readonly linked: number | null;
  readonly from: BEnd;
  readonly to: BEnd | null;
  readonly length: number;
}

/** A link that is not joined: it acts as two open halves (PP-4, issue #38). */
export interface BrokenLink {
  /** The spot of the link. */
  readonly border: number;
  readonly y: number;
  /** The sending half's id, and the receiving half's id. */
  readonly sending: number;
  readonly receiving: number;
  /** Why joining it would leave the network invalid. */
  readonly reason: 'would_loop' | 'resource_mismatch';
  /** What the edit-time check names (a mismatch only; a loop has none). */
  readonly detail?: string;
}

interface Candidate {
  readonly send: Conduit;
  readonly recv: Conduit;
  readonly border: number;
  readonly y: number;
  /** The receiving half's building end. */
  readonly to: BEnd;
}

/**
 * The links that could join: a sending and a receiving half at one spot,
 * sorted by border, then row (the fixed order of the derivation).
 */
function candidatesOf(conduits: readonly Conduit[]): Candidate[] {
  const halves = new Map<string, Conduit>();
  for (const c of conduits) {
    const sp = spotOf(c);
    if (sp === null) continue;
    const k = spotKey(c.owner, sp);
    if (!halves.has(k)) halves.set(k, c);
  }
  const out: Candidate[] = [];
  for (const c of conduits) {
    const sp = spotOf(c);
    if (sp === null || buildingEnd(c.from) === null) continue;
    const other = halves.get(
      spotKey(c.owner === sp.border ? sp.border + 1 : sp.border, sp),
    );
    const ote = other === undefined ? null : buildingEnd(other.to);
    if (other === undefined || ote === null || !isBorderEnd(other.from)) {
      continue;
    }
    out.push({ send: c, recv: other, border: sp.border, y: sp.y, to: ote });
  }
  return out.sort((a, b) => a.border - b.border || a.y - b.y);
}

/** The edges, in conduit order, with exactly the links in `joined` joined. */
function edgesWith(
  conduits: readonly Conduit[],
  cands: readonly Candidate[],
  joined: ReadonlySet<number>,
): Edge[] {
  const byId = new Map(cands.map((c) => [c.send.id, c]));
  const out: Edge[] = [];
  for (const c of conduits) {
    const fe = buildingEnd(c.from);
    const te = buildingEnd(c.to);
    if (spotOf(c) === null) {
      if (fe !== null && te !== null) {
        out.push({
          id: c.id,
          linked: null,
          from: fe,
          to: te,
          length: c.cells.length,
        });
      }
      continue;
    }
    if (fe === null) continue; // a receiving half: part of its link, or open
    const k = joined.has(c.id) ? byId.get(c.id) : undefined;
    out.push({
      id: c.id,
      linked: k === undefined ? null : k.recv.id,
      from: fe,
      to: k === undefined ? null : k.to,
      length: c.cells.length + (k === undefined ? 0 : k.recv.cells.length),
    });
  }
  return out;
}

/** The first violation of a network: a mismatch, else a loop, else null. */
function violation(
  view: View,
  edges: readonly Edge[],
): { reason: 'resource_mismatch' | 'would_loop'; detail?: string } | null {
  const m = findMismatch(view, edges, computeResources(view, edges));
  if (m !== null) return { reason: 'resource_mismatch', detail: m };
  return hasLoop(view, edges) ? { reason: 'would_loop' } : null;
}

/**
 * The joined network, derived from the halves every time, never stored.
 * Candidate links are taken in order (border, then row); one is joined unless
 * joining it, on top of the ordinary conduits and the links already joined,
 * would give a mismatch or a loop, and is then broken: two open halves.
 * Violations only grow when edges are added, so if joining all is valid no
 * link is broken (the fast path), and an added edge never mends a broken link
 * nor breaks a link that stays joined.
 */
function deriveJoins(
  view: View,
  conduits: readonly Conduit[],
): { edges: Edge[]; broken: BrokenLink[] } {
  const cands = candidatesOf(conduits);
  const joined = new Set(cands.map((c) => c.send.id));
  const all = edgesWith(conduits, cands, joined);
  if (cands.length === 0 || violation(view, all) === null) {
    return { edges: all, broken: [] };
  }
  joined.clear();
  const broken: BrokenLink[] = [];
  for (const c of cands) {
    joined.add(c.send.id);
    const v = violation(view, edgesWith(conduits, cands, joined));
    if (v === null) continue;
    joined.delete(c.send.id);
    broken.push({
      border: c.border,
      y: c.y,
      sending: c.send.id,
      receiving: c.recv.id,
      reason: v.reason,
      ...(v.detail === undefined ? {} : { detail: v.detail }),
    });
  }
  return { edges: edgesWith(conduits, cands, joined), broken };
}

/** The broken links of a state (never throws). */
export function brokenLinks(
  state: TeamState,
  content: TeamContent,
): BrokenLink[] {
  return deriveJoins(makeView(state, content), state.conduits).broken;
}

/**
 * The IDs (ascending) of the conduits and halves that go when `building` is
 * destroyed in battle (PP-4, CB-9a): everything attached to it, and the other
 * half of every joined link that loses one half. An open half attached to it
 * goes alone, as does each half of a broken link (`broken`).
 */
export function conduitsLostWith(
  conduits: readonly Conduit[],
  building: number,
  /** Sending-half IDs of broken links: those halves are open, so go alone. */
  broken: ReadonlySet<number> = new Set(),
): number[] {
  const gone = new Set<number>();
  for (const c of conduits) if (conduitTouches(c, building)) gone.add(c.id);
  for (const k of candidatesOf(conduits)) {
    if (broken.has(k.send.id)) continue;
    if (gone.has(k.send.id) || gone.has(k.recv.id)) {
      gone.add(k.send.id);
      gone.add(k.recv.id);
    }
  }
  return [...gone].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Network analysis: nodes, resources, loops

/**
 * The key of the graph node a conduit end belongs to: the instance ID as a
 * decimal string, except for a crossover, which has one node per channel
 * `"<id>.<input side of the channel>"`. A channel is an input side and the
 * output side opposite it.
 */
function nodeKey(
  view: View,
  end: { building: number; side: Side },
  role: 'in' | 'out',
): string {
  const e = view.byId.get(end.building);
  if (
    e !== undefined &&
    e.def.kind === 'route' &&
    e.def.routeType === 'crossover'
  ) {
    const channel = role === 'in' ? end.side : oppositeSide(end.side);
    return `${String(end.building)}.${channel}`;
  }
  return String(end.building);
}

export interface NodeRef {
  readonly key: string;
  readonly building: number;
  readonly channel: Side | null;
}

function compareNodes(a: NodeRef, b: NodeRef): number {
  if (a.building !== b.building) return a.building - b.building;
  const ca = a.channel === null ? -1 : SIDE_ORDER.indexOf(a.channel);
  const cb = b.channel === null ? -1 : SIDE_ORDER.indexOf(b.channel);
  return ca - cb;
}

/**
 * Kahn's algorithm. Among ready nodes the smallest by `compareNodes` goes
 * first. `nodes` must hold every node named by an edge. Returns the keys in
 * order; shorter than `nodes` exactly when there is a cycle.
 */
export function topoOrder(
  nodes: readonly NodeRef[],
  edges: readonly { from: string; to: string }[],
): string[] {
  const sorted = [...nodes].sort(compareNodes);
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const n of sorted) {
    indeg.set(n.key, 0);
    out.set(n.key, []);
  }
  for (const e of edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    out.get(e.from)?.push(e.to);
  }
  // Ready nodes sit in a binary min-heap of ranks (positions in `sorted`), so
  // the smallest ready node by `compareNodes` still goes first, in O(E log V).
  // A node's indegree only falls, so a node that is ready stays ready.
  const rank = new Map<string, number>();
  sorted.forEach((n, i) => rank.set(n.key, i));
  const heap: number[] = [];
  const push = (r: number): void => {
    let i = heap.length;
    heap.push(r);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] ?? 0) <= r) break;
      heap[i] = heap[p] ?? 0;
      i = p;
    }
    heap[i] = r;
  };
  const pop = (): number => {
    const top = heap[0] ?? 0;
    const last = heap.pop() ?? 0;
    if (heap.length > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && (heap[c + 1] ?? 0) < (heap[c] ?? 0)) c++;
        if ((heap[c] ?? 0) >= last) break;
        heap[i] = heap[c] ?? 0;
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  sorted.forEach((n, i) => {
    if ((indeg.get(n.key) ?? 0) === 0) push(i);
  });
  const order: string[] = [];
  while (heap.length > 0) {
    const next = sorted[pop()];
    if (next === undefined) break;
    order.push(next.key);
    for (const t of out.get(next.key) ?? []) {
      const d = (indeg.get(t) ?? 0) - 1;
      indeg.set(t, d);
      const r = rank.get(t);
      if (d === 0 && r !== undefined) push(r);
    }
  }
  return order;
}

function nodeRefOf(key: string): NodeRef {
  const dot = key.indexOf('.');
  if (dot < 0) return { key, building: Number(key), channel: null };
  return {
    key,
    building: Number(key.slice(0, dot)),
    channel: key.slice(dot + 1) as Side,
  };
}

/** The usable edges: both ends (when there is one) are known buildings. */
function usable(view: View, edges: readonly Edge[]): Edge[] {
  return edges.filter(
    (c) =>
      view.byId.has(c.from.building) &&
      (c.to === null || view.byId.has(c.to.building)),
  );
}

function hasLoop(view: View, edges: readonly Edge[]): boolean {
  const list: { from: string; to: string }[] = [];
  for (const c of usable(view, edges)) {
    if (c.to === null) continue;
    list.push({
      from: nodeKey(view, c.from, 'out'),
      to: nodeKey(view, c.to, 'in'),
    });
  }
  const keys = new Set<string>();
  for (const e of list) {
    keys.add(e.from);
    keys.add(e.to);
  }
  const nodes = [...keys].map(nodeRefOf);
  return topoOrder(nodes, list).length < nodes.length;
}

/**
 * The resource each edge carries, by edge id (null when not determined),
 * safe on cyclic or half-built networks: an edge that depends on itself is
 * null.
 */
function computeResources(
  view: View,
  edges: readonly Edge[],
): Map<number, ResourceId | null> {
  const list = usable(view, edges);
  const byTo = new Map<string, Edge>();
  for (const c of list) {
    if (c.to !== null) byTo.set(`${String(c.to.building)}:${c.to.side}`, c);
  }
  const memo = new Map<number, ResourceId | null>();
  const visiting = new Set<number>();
  const upstream = (building: number, side: Side): Edge | undefined =>
    byTo.get(`${String(building)}:${side}`);
  const carry = (c: Edge): ResourceId | null => {
    const known = memo.get(c.id);
    if (known !== undefined) return known;
    if (visiting.has(c.id)) return null;
    visiting.add(c.id);
    let r: ResourceId | null = null;
    const e = view.byId.get(c.from.building);
    if (e !== undefined) {
      if (e.def.kind === 'source') {
        r = view.q.nodeAt(e.b.x, e.b.y) ?? null;
      } else if (e.def.kind === 'route') {
        if (e.def.routeType === 'crossover') {
          const up = upstream(e.b.id, oppositeSide(c.from.side));
          r = up === undefined ? null : carry(up);
        } else {
          for (const side of SIDE_ORDER) {
            if (!e.inputs.some((i) => i.side === side)) continue;
            const up = upstream(e.b.id, side);
            const v = up === undefined ? null : carry(up);
            if (v !== null && r === null) r = v;
          }
        }
      }
    }
    visiting.delete(c.id);
    memo.set(c.id, r);
    return r;
  };
  for (const c of list) carry(c);
  return memo;
}

/** A description of the first resource mismatch in the network, or null. */
function findMismatch(
  view: View,
  edges: readonly Edge[],
  res: ReadonlyMap<number, ResourceId | null>,
): string | null {
  const list = usable(view, edges).filter((c) => c.to !== null);
  for (const c of list) {
    const to = c.to as BEnd;
    const e = view.byId.get(to.building);
    if (e === undefined || e.def.kind === 'route') continue;
    const need = e.inputs.find((i) => i.side === to.side)?.resource;
    const got = res.get(c.id) ?? null;
    if (need !== undefined && got !== null && got !== need) {
      return `conduit ${String(c.id)} carries ${got} into building ${String(e.b.id)}, which takes ${need}`;
    }
  }
  // The first edge (in list order) into each building side.
  const firstInto = new Map<string, Edge>();
  for (const x of list) {
    const to = x.to as BEnd;
    const k = `${String(to.building)}:${to.side}`;
    if (!firstInto.has(k)) firstInto.set(k, x);
  }
  for (const e of view.byId.values()) {
    if (e.def.kind !== 'route' || e.def.routeType !== 'merger') continue;
    let first: ResourceId | null = null;
    for (const side of SIDE_ORDER) {
      const c = firstInto.get(`${String(e.b.id)}:${side}`);
      const v = c === undefined ? null : (res.get(c.id) ?? null);
      if (v === null) continue;
      if (first === null) first = v;
      else if (first !== v) {
        return `merger ${String(e.b.id)} is fed both ${first} and ${v}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public operations

/** A conduit end as given by a caller: a building side or a border spot. */
export type ConduitEndArg =
  { building: number; side: string } | { border: number; y: number };

/**
 * Add a conduit, or a half of a border link (PP-4). The new conduit's ID is
 * the actor's next one (`nextConduitId`, issue #38). Rules, in this fixed order, the first failure reported:
 * invalid_conduit_id (only with an explicit `id`), unknown_building, not_owner, invalid_border, not_an_output, not_an_input,
 * side_in_use, border_spot_in_use, invalid_path, outside_own_plot,
 * blocked_by_feature, overlaps_core, overlaps_building, crosses_conduit,
 * resource_mismatch, would_loop. An `actor` that is no player index owns no
 * building and so gives not_owner.
 */
export function addConduit(
  state: TeamState,
  content: TeamContent,
  args: {
    actor: number;
    from: ConduitEndArg;
    to: ConduitEndArg;
    cells: readonly Cell[];
    /**
     * Re-add a conduit under an ID handed out before (undo, RS-5g). It must
     * decode to `actor`, with a number from 1 up to below the actor's counter,
     * and be used by no conduit; the counter is left unchanged. Without it
     * the actor's next ID is used.
     */
    id?: number;
    /**
     * Allow the add although it makes a link conflict (undo and redo): the
     * link is then broken (see `deriveJoins`). Refused as ever when a
     * mismatch or loop would remain with every conflicting link broken.
     */
    restore?: boolean;
  },
): AddConduitResult {
  const explicit = args.id;
  const counter = isInt(args.actor)
    ? state.nextConduitId[args.actor]
    : undefined;
  if (explicit !== undefined) {
    const at = isInt(explicit) ? decodeConduitId(explicit) : undefined;
    if (
      at === undefined ||
      counter === undefined ||
      at.owner !== args.actor ||
      at.n < 1 ||
      at.n >= counter ||
      state.conduits.some((c) => c.id === explicit)
    ) {
      return { ok: false, reason: 'invalid_conduit_id' };
    }
  }
  const end = (e: unknown): ConduitEnd | BorderEnd => {
    const r = isRecord(e) ? e : {};
    if ('border' in r) {
      // Not integers when malformed: fails the border check.
      return {
        border: isInt(r['border']) ? r['border'] : Number.NaN,
        y: isInt(r['y']) ? r['y'] : Number.NaN,
      };
    }
    return {
      building: isInt(r['building']) ? r['building'] : 0,
      // Not a real side: fails the output/input check.
      side: (typeof r['side'] === 'string' ? r['side'] : '') as Side,
    };
  };
  const rawCells: unknown = (args as { cells?: unknown }).cells;
  const cells: Cell[] = Array.isArray(rawCells)
    ? (rawCells as unknown[]).map((c) =>
        isRecord(c) && isInt(c['x']) && isInt(c['y'])
          ? { x: c['x'], y: c['y'] }
          : { x: Number.NaN, y: Number.NaN },
      )
    : [{ x: Number.NaN, y: Number.NaN }];
  const candidate: Conduit = {
    id:
      explicit ??
      encodeConduitId(isInt(args.actor) ? args.actor : -1, counter ?? 1),
    // Not a real player when malformed: fails the owner check.
    owner: isInt(args.actor) ? args.actor : -1,
    from: end((args as { from?: unknown }).from),
    to: end((args as { to?: unknown }).to),
    cells,
  };
  const view = makeView(state, content);
  const failure = checkConduit(
    view,
    candidate,
    occupancyOf(state.map, state.conduits),
    false,
  );
  if (failure !== null) return failure;
  // Conduits stay sorted by ID; a new ID can fall between others (another
  // player's counter, or an explicit ID).
  const conduits = [...state.conduits, candidate].sort((a, b) => a.id - b.id);
  const after = deriveJoins(view, conduits);
  // What remains with every conflicting link broken (a plot's own mismatch
  // or loop) is refused in any case.
  const v = violation(view, after.edges);
  if (v !== null) {
    return {
      ok: false,
      reason: v.reason,
      ...(v.detail === undefined ? {} : { detail: v.detail }),
    };
  }
  if (args.restore !== true && after.broken.length > 0) {
    // An ordinary add must not break a link: broken links count as open, and
    // the ones that were broken stay so (adding edges cannot mend them).
    const key = (l: BrokenLink): string =>
      `${String(l.sending)}:${String(l.receiving)}`;
    const was = new Set(deriveJoins(view, state.conduits).broken.map(key));
    const fresh = after.broken.find((l) => !was.has(key(l)));
    if (fresh !== undefined) {
      return {
        ok: false,
        reason: fresh.reason,
        ...(fresh.detail === undefined ? {} : { detail: fresh.detail }),
      };
    }
  }
  return {
    ok: true,
    id: candidate.id,
    state:
      explicit === undefined
        ? {
            ...state,
            conduits,
            nextConduitId: state.nextConduitId.map((n, i) =>
              i === args.actor ? n + 1 : n,
            ),
          }
        : { ...state, conduits },
  };
}

/**
 * The resource a conduit carries, or null when it is not determined yet (or
 * the ID is unknown). A receiving half has the resource of its link, and
 * null while it is open. See "Resource typing" in the rules reference.
 */
export function conduitResource(
  state: TeamState,
  content: TeamContent,
  conduitId: number,
): ResourceId | null {
  const view = makeView(state, content);
  const edges = deriveJoins(view, state.conduits).edges;
  const edge = edges.find((e) => e.id === conduitId || e.linked === conduitId);
  if (edge === undefined) return null;
  return computeResources(view, edges).get(edge.id) ?? null;
}

// ---------------------------------------------------------------------------
// Flow graph

export type FlowNodeKind =
  'source' | 'splitter' | 'merger' | 'crossover' | 'consumer';

export interface FlowInput {
  readonly side: Side;
  /**
   * ID of the conduit attached to this input side, or null (also null for a
   * receiving half that is open). For a link it is the receiving half's id.
   */
  readonly conduit: number | null;
  /** The resource this input requires (consumers only), else null. */
  readonly requires: ResourceId | null;
}

export interface FlowOutput {
  readonly side: Side;
  readonly conduit: number | null;
  /**
   * Present (and true) only for an open sending half: a connected output
   * that never accepts (PP-4).
   */
  readonly open?: true;
}

export interface FlowNode {
  /** `"<building>"`, or `"<building>.<input side>"` for a crossover channel. */
  readonly key: string;
  readonly building: number;
  /** For a crossover channel its input side; otherwise null. */
  readonly channel: Side | null;
  readonly def: BuildingId;
  readonly kind: FlowNodeKind;
  /** For a source, the resource of its node; otherwise null. */
  readonly produces: ResourceId | null;
  /** Clockwise from north (absolute sides at the current rotation). */
  readonly inputs: readonly FlowInput[];
  /** Clockwise from north; this is the splitter's alternation order. */
  readonly outputs: readonly FlowOutput[];
}

export interface FlowEdge {
  /** The conduit's id; for a link the sending half's id. */
  readonly conduitId: number;
  /** The receiving half's id for a link, else null. */
  readonly linkedConduit: number | null;
  /** Node keys. */
  readonly from: string;
  readonly to: string;
  readonly fromSide: Side;
  readonly toSide: Side;
  /** Number of path cells (both halves for a link); 0 for a direct connection. */
  readonly length: number;
  readonly resource: ResourceId | null;
}

export interface FlowGraph {
  /** Sorted by building ID, then channel (north, east, south, west). */
  readonly nodes: readonly FlowNode[];
  /** Sorted by conduit ID. */
  readonly edges: readonly FlowEdge[];
  /** Node keys, every edge going from earlier to later. */
  readonly order: readonly string[];
  /** Links acting as two open halves (issue #38), by border then row. */
  readonly brokenLinks: readonly BrokenLink[];
}

/**
 * The flow graph of a valid state (no loops; it throws otherwise, and on
 * unknown building definitions). Plain data, deterministic, safe to hash.
 * Links are joined: one edge per link; an open sending half is an output
 * with `open: true` and has no edge; an open receiving half is an input
 * with `conduit: null`.
 */
export function buildFlowGraph(
  state: TeamState,
  content: TeamContent,
): FlowGraph {
  const view = makeView(state, content);
  const derived = deriveJoins(view, state.conduits);
  const joined = derived.edges;
  const res = computeResources(view, joined);
  const byFrom = new Map<string, Edge>();
  const byTo = new Map<string, Edge>();
  for (const e of joined) {
    byFrom.set(`${String(e.from.building)}:${e.from.side}`, e);
    if (e.to !== null) byTo.set(`${String(e.to.building)}:${e.to.side}`, e);
  }
  const attached = new Set<number>();
  for (const c of state.conduits) {
    const f = buildingEnd(c.from);
    const t = buildingEnd(c.to);
    if (f !== null) attached.add(f.building);
    if (t !== null) attached.add(t.building);
  }
  const nodes: FlowNode[] = [];
  for (const b of state.buildings) {
    if (!attached.has(b.id)) continue;
    const e = view.byId.get(b.id);
    if (e === undefined) throw new Error(`Unknown building "${b.def}".`);
    const inputOf = (side: Side): FlowInput => {
      const edge = byTo.get(`${String(b.id)}:${side}`);
      return {
        side,
        conduit: edge === undefined ? null : (edge.linked ?? edge.id),
        requires:
          e.def.kind === 'route'
            ? null
            : (e.inputs.find((i) => i.side === side)?.resource ?? null),
      };
    };
    const outputOf = (side: Side): FlowOutput => {
      const edge = byFrom.get(`${String(b.id)}:${side}`);
      if (edge === undefined) return { side, conduit: null };
      return edge.to === null
        ? { side, conduit: edge.id, open: true }
        : { side, conduit: edge.id };
    };
    if (e.def.kind === 'route' && e.def.routeType === 'crossover') {
      for (const side of SIDE_ORDER) {
        if (!e.inputs.some((i) => i.side === side)) continue;
        nodes.push({
          key: `${String(b.id)}.${side}`,
          building: b.id,
          channel: side,
          def: b.def,
          kind: 'crossover',
          produces: null,
          inputs: [inputOf(side)],
          outputs: [outputOf(oppositeSide(side))],
        });
      }
      continue;
    }
    const kind: FlowNodeKind =
      e.def.kind === 'source'
        ? 'source'
        : e.def.kind === 'route'
          ? e.def.routeType === 'merger'
            ? 'merger'
            : 'splitter'
          : 'consumer';
    nodes.push({
      key: String(b.id),
      building: b.id,
      channel: null,
      def: b.def,
      kind,
      produces:
        e.def.kind === 'source' ? (view.q.nodeAt(b.x, b.y) ?? null) : null,
      inputs: SIDE_ORDER.filter((s) => e.inputs.some((i) => i.side === s)).map(
        inputOf,
      ),
      outputs: SIDE_ORDER.filter((s) => e.outputs.includes(s)).map(outputOf),
    });
  }
  const edges: FlowEdge[] = [];
  for (const c of joined) {
    if (c.to === null) continue;
    edges.push({
      conduitId: c.id,
      linkedConduit: c.linked,
      from: nodeKey(view, c.from, 'out'),
      to: nodeKey(view, c.to, 'in'),
      fromSide: c.from.side,
      toSide: c.to.side,
      length: c.length,
      resource: res.get(c.id) ?? null,
    });
  }
  const order = topoOrder(
    nodes.map((n) => nodeRefOf(n.key)),
    edges,
  );
  if (order.length < nodes.length) {
    throw new Error('The conduit network contains a loop.');
  }
  return { nodes, edges, order, brokenLinks: derived.broken };
}

// ---------------------------------------------------------------------------
// Validation support (used by validateTeamState)

const CONDUIT_KEYS = new Set(['id', 'owner', 'from', 'to', 'cells']);
const END_KEYS = new Set(['building', 'side']);
const BORDER_KEYS = new Set(['border', 'y']);
const CELL_KEYS = new Set(['x', 'y']);

function extraKeys(
  rec: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
  errors: string[],
): void {
  for (const key of sortedKeys(rec)) {
    if (!allowed.has(key)) errors.push(`${at}: unknown field "${key}".`);
  }
}

/**
 * Parse the raw `conduits` value, reporting every shape problem and keeping
 * the well-formed entries (in the given order). Never throws.
 */
export function parseConduits(raw: unknown, errors: string[]): Conduit[] {
  const out: Conduit[] = [];
  if (!Array.isArray(raw)) {
    errors.push('conduits: must be an array.');
    return out;
  }
  (raw as unknown[]).forEach((entry, i) => {
    const at = `conduits[${String(i)}]`;
    if (!isRecord(entry)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    extraKeys(entry, CONDUIT_KEYS, at, errors);
    let ok = true;
    const id = entry['id'];
    if (!isInt(id) || id < 1) {
      errors.push(`${at}: "id" must be a positive integer.`);
      ok = false;
    }
    const owner = entry['owner'];
    if (!isInt(owner) || owner < 0) {
      errors.push(`${at}: "owner" must be a non-negative integer.`);
      ok = false;
    }
    const ends: (ConduitEnd | BorderEnd)[] = [];
    for (const name of ['from', 'to']) {
      const e = entry[name];
      if (!isRecord(e)) {
        errors.push(
          `${at}: "${name}" must be an object { building, side } or { border, y }.`,
        );
        ok = false;
        continue;
      }
      if ('border' in e) {
        extraKeys(e, BORDER_KEYS, `${at}.${name}`, errors);
        const border = e['border'];
        const y = e['y'];
        if (!isInt(border) || !isInt(y)) {
          errors.push(`${at}: "${name}" needs integer "border" and "y".`);
          ok = false;
          continue;
        }
        ends.push({ border, y });
        continue;
      }
      extraKeys(e, END_KEYS, `${at}.${name}`, errors);
      const building = e['building'];
      const side = e['side'];
      if (!isInt(building) || !isSide(side)) {
        errors.push(
          `${at}: "${name}" needs an integer "building" and a "side" of north, east, south or west.`,
        );
        ok = false;
        continue;
      }
      ends.push({ building, side });
    }
    const cells: Cell[] = [];
    const rawCells = entry['cells'];
    if (!Array.isArray(rawCells)) {
      errors.push(`${at}: "cells" must be an array.`);
      ok = false;
    } else {
      (rawCells as unknown[]).forEach((c, j) => {
        if (!isRecord(c) || !isInt(c['x']) || !isInt(c['y'])) {
          errors.push(
            `${at}.cells[${String(j)}]: must be an object { x, y } of integers.`,
          );
          ok = false;
          return;
        }
        extraKeys(c, CELL_KEYS, `${at}.cells[${String(j)}]`, errors);
        cells.push({ x: c['x'], y: c['y'] });
      });
    }
    const from = ends[0];
    const to = ends[1];
    if (
      ok &&
      isInt(id) &&
      isInt(owner) &&
      from !== undefined &&
      to !== undefined
    ) {
      out.push({ id, owner, from, to, cells });
    }
  });
  return out;
}

/**
 * Re-check every conduit of `state` independently (the per-conduit rules
 * against all the other conduits, then loops and resource mismatches over
 * the whole joined network) and push readable errors. Never throws.
 */
export function checkConduitList(
  state: TeamState,
  content: TeamContent,
  errors: string[],
): void {
  const view = makeView(state, content);
  const occ = occupancyOf(state.map, state.conduits);
  state.conduits.forEach((c, i) => {
    if (c.owner >= state.map.partySize) {
      errors.push(
        `conduits[${String(i)}] (id ${String(c.id)}): "owner" must be an integer from 0 to ${String(state.map.partySize - 1)}.`,
      );
    }
    const failure = checkConduit(view, c, occ, true);
    if (failure !== null) {
      errors.push(
        `conduits[${String(i)}] (id ${String(c.id)}): ${failure.reason}${failure.detail === undefined ? '' : ` (${failure.detail})`}.`,
      );
    }
  });
  // Only conduits whose sides exist are analysed as a network.
  const sound = state.conduits.filter((c) => {
    const f = buildingEnd(c.from);
    const t = buildingEnd(c.to);
    const a = f === null ? undefined : view.byId.get(f.building);
    const b = t === null ? undefined : view.byId.get(t.building);
    return (
      (f === null || (a !== undefined && a.outputs.includes(f.side))) &&
      (t === null ||
        (b !== undefined && b.inputs.some((x) => x.side === t.side))) &&
      (f !== null || t !== null)
    );
  });
  // Broken links are allowed: only what remains once they are open counts.
  const edges = deriveJoins(view, sound).edges;
  const mismatch = findMismatch(view, edges, computeResources(view, edges));
  if (mismatch !== null) {
    errors.push(`conduits: resource_mismatch (${mismatch}).`);
  }
  if (hasLoop(view, edges))
    errors.push('conduits: would_loop (the network has a loop).');
}
