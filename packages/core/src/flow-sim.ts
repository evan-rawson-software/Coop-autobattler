/**
 * Resource flow simulation for one board (W1-4, CB-10, CB-11, CB-43).
 *
 * Time advances in fixed ticks. Sources produce items, items move along
 * conduits one cell per tick, route buildings pass them on, and consumers
 * collect them in input buffers. The state (`BoardSim`) is plain JSON; the
 * static wiring is compiled once into a `FlowPlan` (inside a `FlowContext`).
 * See docs/rules-reference.md, "Tick order", for the exact rules.
 */

import { buildFlowGraph, SIDE_ORDER } from './conduits.js';
import type { Side } from './buildings.js';
import { rotateBuilding } from './buildings.js';
import { divFloor } from './int.js';
import { queryMap } from './map.js';
import type { ResourceId } from './resources.js';
import type { SimConfig } from './sim-config.js';
import type { TeamContent, TeamState } from './team-state.js';

// ---------------------------------------------------------------------------
// Events

export type SimEvent =
  | {
      readonly tick: number;
      readonly type: 'produced';
      readonly building: number;
      readonly resource: ResourceId;
    }
  | {
      readonly tick: number;
      readonly type: 'delivered';
      readonly building: number;
      readonly side: Side;
      readonly resource: ResourceId;
    }
  | {
      readonly tick: number;
      readonly type: 'lost';
      readonly building: number;
      readonly resource: ResourceId;
    }
  | {
      readonly tick: number;
      readonly type: 'stalled';
      readonly building: number;
    };

// ---------------------------------------------------------------------------
// State (plain JSON, mutated in place by stepFlow)

export interface SourceSim {
  readonly building: number;
  readonly resource: ResourceId;
  /** Ticks until the next item; 0 means an item is ready (and may be stalled). */
  countdown: number;
  /** 1 while the ready item cannot be placed, else 0. */
  stalled: number;
  /** Index into the source's outputs (clockwise from north) preferred next. */
  pointer: number;
  produced: number;
  lost: number;
  stalledTicks: number;
}

export interface ConduitSim {
  readonly id: number;
  /** Slot 0 is nearest the `from` building; null is empty. */
  readonly slots: (ResourceId | null)[];
}

export interface RouteSim {
  /** Flow node key (`"<id>"` or `"<id>.<input side>"`). */
  readonly key: string;
  readonly building: number;
  /** The holding cell. */
  held: ResourceId | null;
  /** Splitter: preferred output; merger: preferred input; else 0. */
  pointer: number;
  lost: number;
}

export interface ConsumerInputSim {
  readonly side: Side;
  readonly resource: ResourceId;
  /** Units in the buffer. */
  count: number;
  delivered: number;
  consumed: number;
}

export interface ConsumerSim {
  readonly building: number;
  /** Clockwise from north. */
  readonly inputs: ConsumerInputSim[];
}

export interface BoardSim {
  /** Ticks completed so far. */
  tick: number;
  /** Capacity of each consumer input buffer. */
  readonly bufferCapacity: number;
  /** By building ID. */
  readonly sources: SourceSim[];
  /** By conduit ID. */
  readonly conduits: ConduitSim[];
  /** In flow-node order (building ID, then channel). */
  readonly routes: RouteSim[];
  /** By building ID. */
  readonly consumers: ConsumerSim[];
}

// ---------------------------------------------------------------------------
// Plan (static wiring, derived from the team state)

interface PlanTarget {
  readonly toRoute: boolean;
  /** Index into `sim.routes` or `sim.consumers`. */
  readonly index: number;
  /** Index into the node's inputs. */
  readonly input: number;
}

interface PlanConduit {
  readonly id: number;
  readonly length: number;
  readonly to: PlanTarget;
}

interface PlanRoute {
  readonly splitter: boolean;
  readonly merger: boolean;
  /** Conduit index per input (clockwise from north), or -1. */
  readonly inputs: readonly number[];
  /** Conduit index per output (clockwise from north), or -1. */
  readonly outputs: readonly number[];
}

interface PlanSource {
  /** Conduit index per output (clockwise from north), or -1. */
  readonly outputs: readonly number[];
  readonly interval: number;
}

export interface FlowPlan {
  readonly conduits: readonly PlanConduit[];
  /** Conduit indices in processing order (step 1). */
  readonly conduitOrder: readonly number[];
  readonly routes: readonly PlanRoute[];
  /** Route indices in topological order (step 2). */
  readonly routeOrder: readonly number[];
  /** Route indices that are mergers. */
  readonly mergers: readonly number[];
  readonly sources: readonly PlanSource[];
}

export type ConsumerMode = 'hold' | 'drain';

export interface FlowContext {
  readonly plan: FlowPlan;
  /** `'drain'` empties every consumer buffer at the end of each tick. */
  readonly consumers: ConsumerMode;
  /** Events are appended here when present. */
  readonly events?: SimEvent[];
}

function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`Index ${String(i)} out of range.`);
  return v;
}

const cmp = (a: number, b: number): number => a - b;

interface Compiled {
  readonly sim: BoardSim;
  readonly plan: FlowPlan;
}

function compile(
  state: TeamState,
  content: TeamContent,
  simConfig: SimConfig,
): Compiled {
  const graph = buildFlowGraph(state, content);
  const q = queryMap(state.map, content.terrain);
  const defOf = (id: string) => {
    const def = content.buildings.get(id);
    if (def === undefined) throw new Error(`Unknown building "${id}".`);
    return def;
  };

  // Conduits, by ID.
  const conduitIndex = new Map<number, number>();
  state.conduits.forEach((c, i) => conduitIndex.set(c.id, i));
  const edgeOf = new Map(graph.edges.map((e) => [e.conduitId, e]));
  const orderPos = new Map<string, number>();
  graph.order.forEach((k, i) => orderPos.set(k, i));

  // Routes: splitter, merger and crossover-channel nodes.
  const routeNodes = graph.nodes.filter(
    (n) =>
      n.kind === 'splitter' || n.kind === 'merger' || n.kind === 'crossover',
  );
  const routeIndex = new Map<string, number>();
  routeNodes.forEach((n, i) => routeIndex.set(n.key, i));

  // Consumers: every placed building with inputs that is not a route.
  const consumerSims: ConsumerSim[] = [];
  const consumerIndex = new Map<number, number>();
  for (const b of state.buildings) {
    const def = defOf(b.def);
    if (def.kind === 'source' || def.kind === 'route') continue;
    const rot = rotateBuilding(def, b.rotation);
    if (rot.inputs.length === 0) continue;
    const inputs: ConsumerInputSim[] = [];
    for (const side of SIDE_ORDER) {
      const inp = rot.inputs.find((i) => i.side === side);
      if (inp?.resource === undefined) continue;
      inputs.push({
        side,
        resource: inp.resource,
        count: 0,
        delivered: 0,
        consumed: 0,
      });
    }
    consumerIndex.set(b.id, consumerSims.length);
    consumerSims.push({ building: b.id, inputs });
  }

  const targetOf = (conduitId: number): PlanTarget => {
    const e = edgeOf.get(conduitId);
    if (e === undefined)
      throw new Error(`No edge for conduit ${String(conduitId)}.`);
    const ri = routeIndex.get(e.to);
    if (ri !== undefined) {
      const node = at(routeNodes, ri);
      return {
        toRoute: true,
        index: ri,
        input: node.inputs.findIndex((i) => i.conduit === conduitId),
      };
    }
    const building = Number(e.to);
    const ci = consumerIndex.get(building);
    if (ci === undefined)
      throw new Error(`Conduit ${String(conduitId)} ends at a non-consumer.`);
    return {
      toRoute: false,
      index: ci,
      input: at(consumerSims, ci).inputs.findIndex((i) => i.side === e.toSide),
    };
  };

  const planConduits: PlanConduit[] = state.conduits.map((c) => ({
    id: c.id,
    length: c.cells.length,
    to: targetOf(c.id),
  }));
  const conduitOrder = state.conduits
    .map((_c, i) => i)
    .sort((a, b) => {
      const ea = edgeOf.get(at(state.conduits, a).id);
      const eb = edgeOf.get(at(state.conduits, b).id);
      const pa = orderPos.get(ea?.from ?? '') ?? 0;
      const pb = orderPos.get(eb?.from ?? '') ?? 0;
      return (
        cmp(pb, pa) || cmp(at(state.conduits, a).id, at(state.conduits, b).id)
      );
    });

  const idxOf = (id: number | null): number =>
    id === null ? -1 : (conduitIndex.get(id) ?? -1);
  const planRoutes: PlanRoute[] = routeNodes.map((n) => ({
    splitter: n.kind === 'splitter',
    merger: n.kind === 'merger',
    inputs: n.inputs.map((i) => idxOf(i.conduit)),
    outputs: n.outputs.map((o) => idxOf(o.conduit)),
  }));
  const routeOrder: number[] = [];
  for (const k of graph.order) {
    const i = routeIndex.get(k);
    if (i !== undefined) routeOrder.push(i);
  }
  const mergers: number[] = [];
  planRoutes.forEach((r, i) => {
    if (r.merger) mergers.push(i);
  });

  // Sources: every placed source, connected or not.
  const bySide = new Map<string, number>();
  state.conduits.forEach((c, i) =>
    bySide.set(`${String(c.from.building)}:${c.from.side}`, i),
  );
  const sourceSims: SourceSim[] = [];
  const planSources: PlanSource[] = [];
  for (const b of state.buildings) {
    const def = defOf(b.def);
    if (def.kind !== 'source') continue;
    const resource = q.nodeAt(b.x, b.y);
    if (resource === undefined)
      throw new Error(`Source ${String(b.id)} is not on a node.`);
    const tier = def.tiers[b.tier - 1];
    if (tier === undefined)
      throw new Error(`Source ${String(b.id)} has an invalid tier.`);
    const outs = rotateBuilding(def, b.rotation).outputs;
    planSources.push({
      outputs: SIDE_ORDER.filter((s) => outs.includes(s)).map(
        (s) => bySide.get(`${String(b.id)}:${s}`) ?? -1,
      ),
      interval: tier.intervalTicks,
    });
    sourceSims.push({
      building: b.id,
      resource,
      countdown: tier.intervalTicks,
      stalled: 0,
      pointer: 0,
      produced: 0,
      lost: 0,
      stalledTicks: 0,
    });
  }

  const sim: BoardSim = {
    tick: 0,
    bufferCapacity: simConfig.inputBufferUnits,
    sources: sourceSims,
    conduits: state.conduits.map((c) => ({
      id: c.id,
      slots: c.cells.map(() => null),
    })),
    routes: routeNodes.map((n) => ({
      key: n.key,
      building: n.building,
      held: null,
      pointer: 0,
      lost: 0,
    })),
    consumers: consumerSims,
  };
  return {
    sim,
    plan: {
      conduits: planConduits,
      conduitOrder,
      routes: planRoutes,
      routeOrder,
      mergers,
      sources: planSources,
    },
  };
}

// ---------------------------------------------------------------------------
// Public construction

/**
 * A cold simulation state for a validated team state (CB-11): tick 0, every
 * source counting down its full interval, everything else empty.
 */
export function createBoardSim(
  state: TeamState,
  content: TeamContent,
  simConfig: SimConfig,
): BoardSim {
  return compile(state, content, simConfig).sim;
}

/** The compiled wiring plus the run options for `stepFlow`. */
export function createFlowContext(
  state: TeamState,
  content: TeamContent,
  simConfig: SimConfig,
  options: { consumers?: ConsumerMode; events?: SimEvent[] } = {},
): FlowContext {
  const { plan } = compile(state, content, simConfig);
  const base = { plan, consumers: options.consumers ?? 'hold' };
  return options.events === undefined
    ? base
    : { ...base, events: options.events };
}

/** A deep copy of a state (plain JSON round trip without the text). */
export function cloneBoardSim(sim: BoardSim): BoardSim {
  return {
    tick: sim.tick,
    bufferCapacity: sim.bufferCapacity,
    sources: sim.sources.map((s) => ({ ...s })),
    conduits: sim.conduits.map((c) => ({ id: c.id, slots: [...c.slots] })),
    routes: sim.routes.map((r) => ({ ...r })),
    consumers: sim.consumers.map((c) => ({
      building: c.building,
      inputs: c.inputs.map((i) => ({ ...i })),
    })),
  };
}

// ---------------------------------------------------------------------------
// The step

/** Offer one item to a conduit's target; true if accepted. */
function offerTarget(
  sim: BoardSim,
  ctx: FlowContext,
  target: PlanTarget,
  resource: ResourceId,
): boolean {
  if (target.toRoute) {
    const r = at(sim.routes, target.index);
    if (r.held !== null) return false;
    r.held = resource;
    if (at(ctx.plan.routes, target.index).merger) {
      r.pointer =
        (target.input + 1) % at(ctx.plan.routes, target.index).inputs.length;
    }
    return true;
  }
  const input = at(at(sim.consumers, target.index).inputs, target.input);
  if (input.count >= sim.bufferCapacity) return false;
  input.count += 1;
  input.delivered += 1;
  ctx.events?.push({
    tick: sim.tick,
    type: 'delivered',
    building: at(sim.consumers, target.index).building,
    side: input.side,
    resource,
  });
  return true;
}

/** Put an item onto a conduit (slot 0, or straight onward when direct). */
function pushOnto(
  sim: BoardSim,
  ctx: FlowContext,
  conduit: number,
  resource: ResourceId,
): boolean {
  const pc = at(ctx.plan.conduits, conduit);
  if (pc.length === 0) return offerTarget(sim, ctx, pc.to, resource);
  const slots = at(sim.conduits, conduit).slots;
  if (slots[0] !== null) return false;
  slots[0] = resource;
  return true;
}

/**
 * Advance the simulation by one tick, in place. Order: (1) conduits deliver
 * and advance, downstream first; (2) route buildings push; (3) sources
 * produce; (4) the tick counter increments. With `consumers: 'drain'` all
 * consumer buffers are emptied after step 3.
 */
export function stepFlow(sim: BoardSim, ctx: FlowContext): void {
  const plan = ctx.plan;
  const events = ctx.events;

  // Merger fairness: decide, before anything moves, which input conduit may
  // deliver into each empty merger this tick.
  const winners = new Map<number, number>();
  for (const ri of plan.mergers) {
    const route = at(sim.routes, ri);
    if (route.held !== null) continue;
    const inputs = at(plan.routes, ri).inputs;
    for (let k = 0; k < inputs.length; k++) {
      const input = (route.pointer + k) % inputs.length;
      const c = at(inputs, input);
      if (c < 0 || at(plan.conduits, c).length === 0) continue;
      const slots = at(sim.conduits, c).slots;
      if (slots[slots.length - 1] !== null) {
        winners.set(ri, input);
        break;
      }
    }
  }

  // 1. Deliver and advance, downstream first.
  for (const ci of plan.conduitOrder) {
    const pc = at(plan.conduits, ci);
    if (pc.length === 0) continue;
    const slots = at(sim.conduits, ci).slots;
    const last = pc.length - 1;
    const item = slots[last];
    if (item !== null && item !== undefined) {
      const t = pc.to;
      const allowed =
        !t.toRoute ||
        !at(plan.routes, t.index).merger ||
        winners.get(t.index) === t.input;
      if (allowed && offerTarget(sim, ctx, t, item)) slots[last] = null;
    }
    for (let i = last - 1; i >= 0; i--) {
      const it = slots[i];
      if (it !== null && it !== undefined && slots[i + 1] === null) {
        slots[i + 1] = it;
        slots[i] = null;
      }
    }
  }

  // 2. Route buildings push, in topological order.
  for (const ri of plan.routeOrder) {
    const route = at(sim.routes, ri);
    const item = route.held;
    if (item === null) continue;
    const pr = at(plan.routes, ri);
    const n = pr.outputs.length;
    if (pr.splitter) {
      let connected = false;
      let placed = false;
      for (let k = 0; k < n; k++) {
        const o = (route.pointer + k) % n;
        const c = at(pr.outputs, o);
        if (c < 0) continue;
        connected = true;
        if (pushOnto(sim, ctx, c, item)) {
          route.held = null;
          route.pointer = (o + 1) % n;
          placed = true;
          break;
        }
      }
      if (!placed && !connected) lose(sim, ctx, route, item);
    } else {
      const c = at(pr.outputs, 0);
      if (c < 0) lose(sim, ctx, route, item);
      else if (pushOnto(sim, ctx, c, item)) route.held = null;
    }
  }

  // 3. Sources produce, in building order.
  for (let si = 0; si < sim.sources.length; si++) {
    const s = at(sim.sources, si);
    const ps = at(plan.sources, si);
    if (s.countdown > 0) s.countdown -= 1;
    if (s.countdown > 0) continue;
    const n = ps.outputs.length;
    let connected = false;
    let placed = false;
    for (let k = 0; k < n; k++) {
      const o = (s.pointer + k) % n;
      const c = at(ps.outputs, o);
      if (c < 0) continue;
      connected = true;
      if (pushOnto(sim, ctx, c, s.resource)) {
        s.pointer = (o + 1) % n;
        placed = true;
        break;
      }
    }
    if (placed || !connected) {
      s.produced += 1;
      events?.push({
        tick: sim.tick,
        type: 'produced',
        building: s.building,
        resource: s.resource,
      });
      if (!connected) {
        s.lost += 1;
        events?.push({
          tick: sim.tick,
          type: 'lost',
          building: s.building,
          resource: s.resource,
        });
      }
      s.countdown = ps.interval;
      s.stalled = 0;
    } else {
      if (s.stalled === 0) {
        s.stalled = 1;
        events?.push({ tick: sim.tick, type: 'stalled', building: s.building });
      }
      s.stalledTicks += 1;
    }
  }

  // Consumers (test and dry-run mode only).
  if (ctx.consumers === 'drain') {
    for (const c of sim.consumers) {
      for (const input of c.inputs) {
        input.consumed += input.count;
        input.count = 0;
      }
    }
  }

  // 4. The tick counter.
  sim.tick += 1;
}

function lose(
  sim: BoardSim,
  ctx: FlowContext,
  route: RouteSim,
  item: ResourceId,
): void {
  route.held = null;
  route.lost += 1;
  ctx.events?.push({
    tick: sim.tick,
    type: 'lost',
    building: route.building,
    resource: item,
  });
}

// ---------------------------------------------------------------------------
// Consumer seam

/**
 * Remove `n` units from a consumer's input buffer if that many are there;
 * returns whether it did (nothing is removed otherwise). `sideOrResource` is
 * an absolute side, or a resource ID: for a resource, the units are drawn
 * from the inputs that take it (clockwise from north) and the total must
 * cover `n`. Removed units count as consumed.
 */
export function takeFromBuffer(
  sim: BoardSim,
  buildingId: number,
  sideOrResource: string,
  n: number,
): boolean {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError('takeFromBuffer: n must be a non-negative integer.');
  }
  const consumer = sim.consumers.find((c) => c.building === buildingId);
  if (consumer === undefined) return false;
  const matching = consumer.inputs.filter(
    (i) => i.side === sideOrResource || i.resource === sideOrResource,
  );
  if (matching.length === 0) return false;
  let have = 0;
  for (const i of matching) have += i.count;
  if (have < n) return false;
  let left = n;
  for (const i of matching) {
    const take = Math.min(i.count, left);
    i.count -= take;
    i.consumed += take;
    left -= take;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Accounting

export interface FlowTotals {
  readonly produced: number;
  readonly inConduits: number;
  readonly held: number;
  readonly inBuffers: number;
  readonly consumed: number;
  readonly lost: number;
}

/**
 * Item accounting. Conservation: `produced = inConduits + held + inBuffers +
 * consumed + lost` at the end of every tick.
 */
export function flowTotals(sim: BoardSim): FlowTotals {
  let produced = 0;
  let lost = 0;
  for (const s of sim.sources) {
    produced += s.produced;
    lost += s.lost;
  }
  let inConduits = 0;
  for (const c of sim.conduits) {
    for (const slot of c.slots) if (slot !== null) inConduits += 1;
  }
  let held = 0;
  for (const r of sim.routes) {
    lost += r.lost;
    if (r.held !== null) held += 1;
  }
  let inBuffers = 0;
  let consumed = 0;
  for (const c of sim.consumers) {
    for (const i of c.inputs) {
      inBuffers += i.count;
      consumed += i.consumed;
    }
  }
  return { produced, inConduits, held, inBuffers, consumed, lost };
}

// ---------------------------------------------------------------------------
// Dry run (CB-43)

export interface DryRunSource {
  readonly building: number;
  readonly resource: ResourceId;
  readonly produced: number;
  readonly lost: number;
  readonly stalledTicks: number;
}

export interface DryRunRoute {
  readonly building: number;
  readonly key: string;
  readonly lost: number;
}

export interface DryRunConsumerInput {
  readonly building: number;
  readonly side: Side;
  readonly resource: ResourceId;
  readonly delivered: number;
  /** Delivered per 1000 ticks over the second half of the run (floored). */
  readonly ratePer1000: number;
}

export interface DryRunResult {
  readonly ticks: number;
  readonly sources: readonly DryRunSource[];
  readonly routes: readonly DryRunRoute[];
  readonly consumers: readonly DryRunConsumerInput[];
}

/**
 * Simulate the board alone for `ticks` ticks with every consumer buffer
 * drained each tick, and report totals and delivery rates. The rate counts
 * deliveries in ticks `floor(ticks / 2)` to `ticks - 1`, so the cold start
 * does not distort it.
 */
export function dryRunFlow(
  state: TeamState,
  content: TeamContent,
  simConfig: SimConfig,
  ticks: number,
): DryRunResult {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError('dryRunFlow: ticks must be a non-negative integer.');
  }
  const sim = createBoardSim(state, content, simConfig);
  const ctx = createFlowContext(state, content, simConfig, {
    consumers: 'drain',
  });
  const half = divFloor(ticks, 2);
  for (let t = 0; t < half; t++) stepFlow(sim, ctx);
  const atHalf = sim.consumers.map((c) => c.inputs.map((i) => i.delivered));
  for (let t = half; t < ticks; t++) stepFlow(sim, ctx);
  const window = ticks - half;
  const consumers: DryRunConsumerInput[] = [];
  sim.consumers.forEach((c, ci) => {
    c.inputs.forEach((i, ii) => {
      const recent = i.delivered - at(at(atHalf, ci), ii);
      consumers.push({
        building: c.building,
        side: i.side,
        resource: i.resource,
        delivered: i.delivered,
        ratePer1000: window === 0 ? 0 : divFloor(recent * 1000, window),
      });
    });
  });
  return {
    ticks,
    sources: sim.sources.map((s) => ({
      building: s.building,
      resource: s.resource,
      produced: s.produced,
      lost: s.lost,
      stalledTicks: s.stalledTicks,
    })),
    routes: sim.routes.map((r) => ({
      building: r.building,
      key: r.key,
      lost: r.lost,
    })),
    consumers,
  };
}
