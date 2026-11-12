/**
 * Conduits (W1-3, CB-3g, CB-3h, CB-5a, CB-5b, CB-9, CB-9a to CB-9c, CB-10):
 * drawing rules, resource typing, the no-loop rule and the flow graph.
 * All functions are pure. See docs/rules-reference.md, "Conduits".
 */

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
import type {
  Conduit,
  OpFailure,
  PlacedBuilding,
  TeamContent,
  TeamState,
} from './team-state.js';

// ---------------------------------------------------------------------------
// Types

export type ConduitReason =
  | 'unknown_building'
  | 'not_an_output'
  | 'not_an_input'
  | 'side_in_use'
  | 'invalid_path'
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
}

function endKey(e: { building: number; side: Side }): string {
  return `${String(e.building)}.${e.side}`;
}

function occupancyOf(map: GameMap, conduits: readonly Conduit[]): Occupancy {
  const outs = new Map<string, number>();
  const ins = new Map<string, number>();
  const cells = new Map<number, number>();
  const bump = <K>(m: Map<K, number>, k: K): void => {
    m.set(k, (m.get(k) ?? 0) + 1);
  };
  for (const o of conduits) {
    bump(outs, endKey(o.from));
    bump(ins, endKey(o.to));
    for (const cell of o.cells) {
      if (isInt(cell.x) && isInt(cell.y))
        bump(cells, cellKey(map, cell.x, cell.y));
    }
  }
  return { outs, ins, cells };
}

/**
 * Check one conduit against the board and the other conduits. Rules in this
 * order, the first failure reported: unknown_building, not_an_output,
 * not_an_input, side_in_use, invalid_path, blocked_by_feature, overlaps_core,
 * overlaps_building, crosses_conduit. (resource_mismatch and would_loop need
 * the whole network and are checked after these, by the caller.)
 */
function checkConduit(
  view: View,
  c: Conduit,
  occ: Occupancy,
  self: boolean,
): Failure | null {
  const map = view.state.map;
  const a = view.byId.get(c.from.building);
  const b = view.byId.get(c.to.building);
  if (a === undefined || b === undefined) {
    return {
      ok: false,
      reason: 'unknown_building',
      detail: String(a === undefined ? c.from.building : c.to.building),
    };
  }
  if (!a.outputs.includes(c.from.side)) {
    return { ok: false, reason: 'not_an_output', detail: c.from.side };
  }
  if (!b.inputs.some((i) => i.side === c.to.side)) {
    return { ok: false, reason: 'not_an_input', detail: c.to.side };
  }
  const own = self ? 1 : 0;
  if ((occ.outs.get(endKey(c.from)) ?? 0) > own) {
    return { ok: false, reason: 'side_in_use', detail: 'output' };
  }
  if ((occ.ins.get(endKey(c.to)) ?? 0) > own) {
    return { ok: false, reason: 'side_in_use', detail: 'input' };
  }

  // invalid_path
  const bad = (detail: string): Failure => ({
    ok: false,
    reason: 'invalid_path',
    detail,
  });
  const cells = c.cells;
  if (directlyFaces(a, c.from.side, b, c.to.side)) {
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
    const first = cells[0] as Cell;
    const last = cells[cells.length - 1] as Cell;
    if (
      !outsideCells(a.box, c.from.side).some(
        (o) => o.x === first.x && o.y === first.y,
      )
    ) {
      return bad('the first cell is not outside the from side');
    }
    if (
      !outsideCells(b.box, c.to.side).some(
        (o) => o.x === last.x && o.y === last.y,
      )
    ) {
      return bad('the last cell is not outside the to side');
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

/** The usable conduits: both ends are known buildings. */
function usable(view: View, conduits: readonly Conduit[]): Conduit[] {
  return conduits.filter(
    (c) => view.byId.has(c.from.building) && view.byId.has(c.to.building),
  );
}

function hasLoop(view: View, conduits: readonly Conduit[]): boolean {
  const edges = usable(view, conduits).map((c) => ({
    from: nodeKey(view, c.from, 'out'),
    to: nodeKey(view, c.to, 'in'),
  }));
  const keys = new Set<string>();
  for (const e of edges) {
    keys.add(e.from);
    keys.add(e.to);
  }
  const nodes = [...keys].map(nodeRefOf);
  return topoOrder(nodes, edges).length < nodes.length;
}

/**
 * The resource each conduit carries (null when not determined), safe on
 * cyclic or half-built networks: a conduit that depends on itself is null.
 */
function computeResources(
  view: View,
  conduits: readonly Conduit[],
): Map<number, ResourceId | null> {
  const list = usable(view, conduits);
  const byTo = new Map<string, Conduit>();
  for (const c of list) byTo.set(`${String(c.to.building)}:${c.to.side}`, c);
  const memo = new Map<number, ResourceId | null>();
  const visiting = new Set<number>();
  const upstream = (building: number, side: Side): Conduit | undefined =>
    byTo.get(`${String(building)}:${side}`);
  const carry = (c: Conduit): ResourceId | null => {
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
  conduits: readonly Conduit[],
  res: ReadonlyMap<number, ResourceId | null>,
): string | null {
  const list = usable(view, conduits);
  for (const c of list) {
    const e = view.byId.get(c.to.building);
    if (e === undefined || e.def.kind === 'route') continue;
    const need = e.inputs.find((i) => i.side === c.to.side)?.resource;
    const got = res.get(c.id) ?? null;
    if (need !== undefined && got !== null && got !== need) {
      return `conduit ${String(c.id)} carries ${got} into building ${String(e.b.id)}, which takes ${need}`;
    }
  }
  // The first conduit (in list order) into each building side.
  const firstInto = new Map<string, Conduit>();
  for (const x of list) {
    const k = `${String(x.to.building)}:${x.to.side}`;
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

/**
 * Add a conduit. The new conduit's ID is `state.nextId`. Rules, in this
 * fixed order, the first failure reported: unknown_building, not_an_output,
 * not_an_input, side_in_use, invalid_path, blocked_by_feature, overlaps_core,
 * overlaps_building, crosses_conduit, resource_mismatch, would_loop.
 */
export function addConduit(
  state: TeamState,
  content: TeamContent,
  args: {
    from: { building: number; side: string };
    to: { building: number; side: string };
    cells: readonly Cell[];
  },
): AddConduitResult {
  const end = (e: unknown): { building: number; side: Side } => {
    const r = isRecord(e) ? e : {};
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
    id: state.nextId,
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
  const conduits = [...state.conduits, candidate];
  const mismatch = findMismatch(
    view,
    conduits,
    computeResources(view, conduits),
  );
  if (mismatch !== null) {
    return { ok: false, reason: 'resource_mismatch', detail: mismatch };
  }
  if (hasLoop(view, conduits)) return { ok: false, reason: 'would_loop' };
  return {
    ok: true,
    id: candidate.id,
    state: { ...state, conduits, nextId: state.nextId + 1 },
  };
}

/**
 * The resource a conduit carries, or null when it is not determined yet (or
 * the ID is unknown). See "Resource typing" in the rules reference.
 */
export function conduitResource(
  state: TeamState,
  content: TeamContent,
  conduitId: number,
): ResourceId | null {
  const view = makeView(state, content);
  return computeResources(view, state.conduits).get(conduitId) ?? null;
}

// ---------------------------------------------------------------------------
// Flow graph

export type FlowNodeKind =
  'source' | 'splitter' | 'merger' | 'crossover' | 'consumer';

export interface FlowInput {
  readonly side: Side;
  /** ID of the conduit attached to this input side, or null. */
  readonly conduit: number | null;
  /** The resource this input requires (consumers only), else null. */
  readonly requires: ResourceId | null;
}

export interface FlowOutput {
  readonly side: Side;
  readonly conduit: number | null;
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
  readonly conduitId: number;
  /** Node keys. */
  readonly from: string;
  readonly to: string;
  readonly fromSide: Side;
  readonly toSide: Side;
  /** Number of path cells; 0 for a direct connection. */
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
}

/**
 * The flow graph of a valid state (no loops; it throws otherwise, and on
 * unknown building definitions). Plain data, deterministic, safe to hash.
 */
export function buildFlowGraph(
  state: TeamState,
  content: TeamContent,
): FlowGraph {
  const view = makeView(state, content);
  const res = computeResources(view, state.conduits);
  const byFrom = new Map<string, Conduit>();
  const byTo = new Map<string, Conduit>();
  for (const c of state.conduits) {
    byFrom.set(`${String(c.from.building)}:${c.from.side}`, c);
    byTo.set(`${String(c.to.building)}:${c.to.side}`, c);
  }
  const attached = new Set<number>();
  for (const c of state.conduits) {
    attached.add(c.from.building);
    attached.add(c.to.building);
  }
  const nodes: FlowNode[] = [];
  for (const b of state.buildings) {
    if (!attached.has(b.id)) continue;
    const e = view.byId.get(b.id);
    if (e === undefined) throw new Error(`Unknown building "${b.def}".`);
    const inputOf = (side: Side): FlowInput => ({
      side,
      conduit: byTo.get(`${String(b.id)}:${side}`)?.id ?? null,
      requires:
        e.def.kind === 'route'
          ? null
          : (e.inputs.find((i) => i.side === side)?.resource ?? null),
    });
    const outputOf = (side: Side): FlowOutput => ({
      side,
      conduit: byFrom.get(`${String(b.id)}:${side}`)?.id ?? null,
    });
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
  const edges: FlowEdge[] = state.conduits.map((c) => ({
    conduitId: c.id,
    from: nodeKey(view, c.from, 'out'),
    to: nodeKey(view, c.to, 'in'),
    fromSide: c.from.side,
    toSide: c.to.side,
    length: c.cells.length,
    resource: res.get(c.id) ?? null,
  }));
  const order = topoOrder(
    nodes.map((n) => nodeRefOf(n.key)),
    edges,
  );
  if (order.length < nodes.length) {
    throw new Error('The conduit network contains a loop.');
  }
  return { nodes, edges, order };
}

// ---------------------------------------------------------------------------
// Validation support (used by validateTeamState)

const CONDUIT_KEYS = new Set(['id', 'from', 'to', 'cells']);
const END_KEYS = new Set(['building', 'side']);
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
    const ends: { building: number; side: Side }[] = [];
    for (const name of ['from', 'to']) {
      const e = entry[name];
      if (!isRecord(e)) {
        errors.push(`${at}: "${name}" must be an object { building, side }.`);
        ok = false;
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
    if (ok && isInt(id) && from !== undefined && to !== undefined) {
      out.push({ id, from, to, cells });
    }
  });
  return out;
}

/**
 * Re-check every conduit of `state` independently (the per-conduit rules
 * against all the other conduits, then loops and resource mismatches over
 * the whole network) and push readable errors. Never throws.
 */
export function checkConduitList(
  state: TeamState,
  content: TeamContent,
  errors: string[],
): void {
  const view = makeView(state, content);
  const occ = occupancyOf(state.map, state.conduits);
  state.conduits.forEach((c, i) => {
    const failure = checkConduit(view, c, occ, true);
    if (failure !== null) {
      errors.push(
        `conduits[${String(i)}] (id ${String(c.id)}): ${failure.reason}${failure.detail === undefined ? '' : ` (${failure.detail})`}.`,
      );
    }
  });
  // Only conduits whose sides exist are analysed as a network.
  const sound = state.conduits.filter((c) => {
    const a = view.byId.get(c.from.building);
    const b = view.byId.get(c.to.building);
    return (
      a !== undefined &&
      b !== undefined &&
      a.outputs.includes(c.from.side) &&
      b.inputs.some((x) => x.side === c.to.side)
    );
  });
  const mismatch = findMismatch(view, sound, computeResources(view, sound));
  if (mismatch !== null) {
    errors.push(`conduits: resource_mismatch (${mismatch}).`);
  }
  if (hasLoop(view, sound))
    errors.push('conduits: would_loop (the network has a loop).');
}
