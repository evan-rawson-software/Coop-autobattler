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
import type { Side, SourceBuildingDef } from './buildings.js';
import { needPer1000, productionOf, rotateBuilding } from './buildings.js';
import { divFloor, mulDiv } from './int.js';
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

/**
 * Counters of things removed mid-battle (a destroyed building): what they had
 * produced, lost and consumed, plus the items they or their conduits held,
 * which count as lost. Keeps the conservation law true after a removal.
 */
export interface RetiredTotals {
  produced: number;
  lost: number;
  consumed: number;
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
  /** Present only after a mid-battle removal (see `rebuildFlow`). */
  retired?: RetiredTotals;
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
  /**
   * Per input: the route index feeding it when the conduit is a direct
   * connection (`L = 0`) from a route building, else -1.
   */
  readonly inputRoute: readonly number[];
  /** Per input: the source index feeding it directly, else -1. */
  readonly inputSource: readonly number[];
  /** Conduit index per output (clockwise from north), or -1. */
  readonly outputs: readonly number[];
}

interface PlanSource {
  /** Conduit index per output (clockwise from north), or -1. */
  readonly outputs: readonly number[];
  readonly interval: number;
  /** The player who owns the source (PP-8: whose speed bonus applies). */
  readonly owner: number;
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

export type ConsumerMode = 'hold' | 'drain' | 'need';

/**
 * A consumer paced at its top speed in `'need'` mode (PP-6): the intake and
 * produce rules of the arena without an arena. It is run state of the run,
 * not part of `BoardSim`.
 */
export interface ConsumerPacer {
  readonly building: number;
  /** Cost of one production (`costPerUnit`, `costPerShot`, `costPerStep`). */
  readonly cost: number;
  /** Minimum ticks between productions. */
  readonly interval: number;
  /** Productions allowed in all (an economy building's `maxSteps`), or -1. */
  readonly limit: number;
  /** Items collected towards the next production (0 .. cost). */
  progress: number;
  /** Ticks until the next production is allowed. */
  cooldown: number;
  /** Productions so far. */
  productions: number;
}

export interface FlowContext {
  readonly plan: FlowPlan;
  /** `'drain'` empties every consumer buffer at the end of each tick. */
  readonly consumers: ConsumerMode;
  /** Events are appended here when present. */
  readonly events?: SimEvent[];
  /**
   * Source interval modifier for the tick, in percent, one value per player
   * index (PP-8; a missing entry or an absent list is 0): when a source's
   * countdown is reset its interval is
   * `max(1, floor(interval * 100 / (100 + percent)))` with the percent of the
   * source's owner. Set by the arena each tick from each owner's
   * `source_speed` total; a dry run leaves it unset.
   */
  sourceSpeedPercent?: readonly number[];
  /** Present in `'need'` mode: one pacer per consumer, in `sim.consumers` order. */
  readonly pacers?: ConsumerPacer[];
}

/** A source's interval under a speed bonus (rounded down, at least 1). */
export function scaledInterval(interval: number, percent: number): number {
  return Math.max(1, mulDiv(interval, 100, 100 + percent));
}

/**
 * A collector's rate in items per 1000 ticks, `floor(1000 / scaledInterval)`
 * (PP-5), for a tier (1..3) and an optional speed-up percent.
 */
export function collectorRatePer1000(
  def: SourceBuildingDef,
  tier: number,
  percent = 0,
): number {
  const t = def.tiers[tier - 1];
  if (t === undefined) throw new RangeError(`Invalid tier ${String(tier)}.`);
  return divFloor(1000, scaledInterval(t.intervalTicks, percent));
}

/**
 * The same rate in hundredths of an item per second, rounded down:
 * `floor(100 * ticksPerSecond / scaledInterval)` (PP-5).
 */
export function collectorHundredthsPerSecond(
  def: SourceBuildingDef,
  tier: number,
  ticksPerSecond: number,
  percent = 0,
): number {
  const t = def.tiers[tier - 1];
  if (t === undefined) throw new RangeError(`Invalid tier ${String(tier)}.`);
  return mulDiv(100, ticksPerSecond, scaledInterval(t.intervalTicks, percent));
}

function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`Index ${String(i)} out of range.`);
  return v;
}

const cmp = (a: number, b: number): number => a - b;

/** Plan output value: nothing attached (an item sent here is lost). */
const NO_OUTPUT = -1;
/** Plan output value: an open sending half, connected but never accepting. */
const OPEN_HALF = -2;

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

  // Conduits, by ID: one per flow edge, so one per link (under the sending
  // half's id; the receiving half's id points at the same entry). Open
  // halves have no entry (PP-4).
  const edgeOf = new Map(graph.edges.map((e) => [e.conduitId, e]));
  const edgeOfAny = new Map(graph.edges.map((e) => [e.conduitId, e]));
  for (const e of graph.edges) {
    if (e.linkedConduit !== null) edgeOfAny.set(e.linkedConduit, e);
  }
  const simConduits = state.conduits.filter((c) => edgeOf.has(c.id));
  const conduitIndex = new Map<number, number>();
  simConduits.forEach((c, i) => {
    conduitIndex.set(c.id, i);
    const linked = edgeOf.get(c.id)?.linkedConduit ?? null;
    if (linked !== null) conduitIndex.set(linked, i);
  });
  const orderPos = new Map<string, number>();
  graph.order.forEach((k, i) => orderPos.set(k, i));

  // Routes: splitter, merger and crossover-channel nodes.
  const routeNodes = graph.nodes.filter(
    (n) =>
      n.kind === 'splitter' || n.kind === 'merger' || n.kind === 'crossover',
  );
  // The building of each node key (keys are never parsed back).
  const buildingOfNode = new Map<string, number>();
  for (const n of graph.nodes) buildingOfNode.set(n.key, n.building);
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
        input: node.inputs.findIndex(
          (i) => i.conduit === (e.linkedConduit ?? conduitId),
        ),
      };
    }
    const ci = consumerIndex.get(buildingOfNode.get(e.to) ?? -1);
    if (ci === undefined)
      throw new Error(`Conduit ${String(conduitId)} ends at a non-consumer.`);
    return {
      toRoute: false,
      index: ci,
      input: at(consumerSims, ci).inputs.findIndex((i) => i.side === e.toSide),
    };
  };

  const planConduits: PlanConduit[] = simConduits.map((c) => ({
    id: c.id,
    length: edgeOf.get(c.id)?.length ?? 0,
    to: targetOf(c.id),
  }));
  const conduitOrder = simConduits
    .map((_c, i) => i)
    .sort((a, b) => {
      const ea = edgeOf.get(at(simConduits, a).id);
      const eb = edgeOf.get(at(simConduits, b).id);
      const pa = orderPos.get(ea?.from ?? '') ?? 0;
      const pb = orderPos.get(eb?.from ?? '') ?? 0;
      return cmp(pb, pa) || cmp(at(simConduits, a).id, at(simConduits, b).id);
    });

  const idxOf = (id: number | null): number =>
    id === null ? -1 : (conduitIndex.get(id) ?? -1);
  /** A plan output: -1 none, `OPEN_HALF` an open sending half, else a conduit. */
  const outIdx = (o: { conduit: number | null; open?: true }): number =>
    o.open === true ? OPEN_HALF : idxOf(o.conduit);
  // Source index (in sim.sources order) by building ID.
  const sourceIndex = new Map<number, number>();
  for (const b of state.buildings) {
    if (defOf(b.def).kind === 'source') sourceIndex.set(b.id, sourceIndex.size);
  }
  /** The route or source behind a direct (zero-length) input conduit. */
  const directOrigin = (conduit: number | null): [number, number] => {
    if (conduit === null) return [-1, -1];
    const e = edgeOfAny.get(conduit);
    if (e === undefined || e.length > 0) return [-1, -1];
    return [
      routeIndex.get(e.from) ?? -1,
      sourceIndex.get(buildingOfNode.get(e.from) ?? -1) ?? -1,
    ];
  };
  const planRoutes: PlanRoute[] = routeNodes.map((n) => ({
    splitter: n.kind === 'splitter',
    merger: n.kind === 'merger',
    inputs: n.inputs.map((i) => idxOf(i.conduit)),
    inputRoute: n.inputs.map((i) => directOrigin(i.conduit)[0]),
    inputSource: n.inputs.map((i) => directOrigin(i.conduit)[1]),
    outputs: n.outputs.map(outIdx),
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
  const nodeOfBuilding = new Map(graph.nodes.map((n) => [n.key, n]));
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
      outputs: SIDE_ORDER.filter((s) => outs.includes(s)).map((s) => {
        const o = nodeOfBuilding
          .get(String(b.id))
          ?.outputs.find((x) => x.side === s);
        return o === undefined ? -1 : outIdx(o);
      }),
      interval: tier.intervalTicks,
      owner: b.owner,
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
    conduits: simConduits.map((c) => ({
      id: c.id,
      slots: Array.from({ length: edgeOf.get(c.id)?.length ?? 0 }, () => null),
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

function makePacers(
  state: TeamState,
  content: TeamContent,
  simConfig: SimConfig,
): ConsumerPacer[] {
  const pacers: ConsumerPacer[] = [];
  for (const c of createBoardSim(state, content, simConfig).consumers) {
    const b = state.buildings.find((x) => x.id === c.building);
    const def = b && content.buildings.get(b.def);
    const p = b && def && productionOf(def, b.tier);
    if (b === undefined || def === undefined || p === undefined) continue;
    const tier = def.kind === 'economy' ? def.tiers[b.tier - 1] : undefined;
    pacers.push({
      building: c.building,
      cost: p.cost,
      interval: p.interval,
      limit: tier === undefined ? -1 : tier.maxSteps,
      progress: 0,
      cooldown: 0,
      productions: 0,
    });
  }
  return pacers;
}

/** The compiled wiring plus the run options for `stepFlow`. */
export function createFlowContext(
  state: TeamState,
  content: TeamContent,
  simConfig: SimConfig,
  options: { consumers?: ConsumerMode; events?: SimEvent[] } = {},
): FlowContext {
  const { plan } = compile(state, content, simConfig);
  const mode = options.consumers ?? 'hold';
  const base = {
    plan,
    consumers: mode,
    ...(mode === 'need'
      ? { pacers: makePacers(state, content, simConfig) }
      : {}),
  };
  return options.events === undefined
    ? base
    : { ...base, events: options.events };
}

/**
 * Rebuild the flow simulation after buildings and their conduits were removed
 * from the team state (a mid-battle destruction, CB-9a). `newState` is the
 * team state with those buildings and every conduit attached to them gone.
 * Everything that survives keeps its state (matched by building ID, conduit
 * ID, route key and input side). Items in removed conduits, held by removed
 * routes or in removed consumers' buffers are lost; the counters of removed
 * parts move to `retired`, so conservation still holds. Returns the new
 * state and the new wiring; the old state is not changed.
 */
export function rebuildFlow(
  old: BoardSim,
  newState: TeamState,
  content: TeamContent,
  simConfig: SimConfig,
): { sim: BoardSim; plan: FlowPlan } {
  const fresh = compile(newState, content, simConfig);
  const sim = fresh.sim;
  const retired: RetiredTotals = {
    produced: old.retired?.produced ?? 0,
    lost: old.retired?.lost ?? 0,
    consumed: old.retired?.consumed ?? 0,
  };
  sim.tick = old.tick;

  const sourceAt = new Map(sim.sources.map((s) => [s.building, s]));
  for (const o of old.sources) {
    const s = sourceAt.get(o.building);
    if (s === undefined) {
      retired.produced += o.produced;
      retired.lost += o.lost;
    } else {
      s.countdown = o.countdown;
      s.stalled = o.stalled;
      s.pointer = o.pointer;
      s.produced = o.produced;
      s.lost = o.lost;
      s.stalledTicks = o.stalledTicks;
    }
  }
  const conduitAt = new Map(sim.conduits.map((c) => [c.id, c]));
  for (const o of old.conduits) {
    const c = conduitAt.get(o.id);
    if (c === undefined) {
      for (const slot of o.slots) if (slot !== null) retired.lost += 1;
    } else {
      o.slots.forEach((slot, i) => {
        c.slots[i] = slot;
      });
    }
  }
  const routeAt = new Map(sim.routes.map((r) => [r.key, r]));
  for (const o of old.routes) {
    const r = routeAt.get(o.key);
    if (r === undefined) {
      retired.lost += o.lost + (o.held === null ? 0 : 1);
    } else {
      r.held = o.held;
      r.pointer = o.pointer;
      r.lost = o.lost;
    }
  }
  const consumerAt = new Map(sim.consumers.map((c) => [c.building, c]));
  for (const o of old.consumers) {
    const c = consumerAt.get(o.building);
    if (c === undefined) {
      for (const i of o.inputs) {
        retired.consumed += i.consumed;
        retired.lost += i.count;
      }
    } else {
      for (const i of o.inputs) {
        const n = c.inputs.find((x) => x.side === i.side);
        if (n === undefined) continue;
        n.count = i.count;
        n.delivered = i.delivered;
        n.consumed = i.consumed;
      }
    }
  }
  if (retired.produced > 0 || retired.lost > 0 || retired.consumed > 0) {
    sim.retired = retired;
  }
  return { sim, plan: fresh.plan };
}

/** A deep copy of a state (plain JSON round trip without the text). */
export function cloneBoardSim(sim: BoardSim): BoardSim {
  const copy: BoardSim = {
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
  if (sim.retired !== undefined) copy.retired = { ...sim.retired };
  return copy;
}

// ---------------------------------------------------------------------------
// The step

/** Offer one item to a conduit's target; true if accepted. */
function offerTarget(
  sim: BoardSim,
  ctx: FlowContext,
  winners: Int32Array,
  target: PlanTarget,
  resource: ResourceId,
): boolean {
  if (target.toRoute) {
    const r = at(sim.routes, target.index);
    if (r.held !== null) return false;
    if (at(ctx.plan.routes, target.index).merger) {
      // Only the merger's winner of step 0 may fill the cell (nobody else
      // when it has a winner; anybody when it has none).
      const w = winners[target.index] ?? -1;
      if (w >= 0 && w !== target.input) return false;
      r.pointer =
        (target.input + 1) % at(ctx.plan.routes, target.index).inputs.length;
    }
    r.held = resource;
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
  winners: Int32Array,
  conduit: number,
  resource: ResourceId,
): boolean {
  const pc = at(ctx.plan.conduits, conduit);
  if (pc.length === 0) return offerTarget(sim, ctx, winners, pc.to, resource);
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

  // Merger fairness: decide, before anything moves, which input may fill each
  // merger's cell this tick. Conduit inputs, direct route inputs and direct
  // source inputs all take part (see docs/rules-reference.md, step 0).
  const winners = new Int32Array(plan.routes.length).fill(-1);
  for (const ri of plan.mergers) {
    const pr = at(plan.routes, ri);
    const n = pr.inputs.length;
    const pointer = at(sim.routes, ri).pointer;
    for (let k = 0; k < n; k++) {
      const input = (pointer + k) % n;
      const c = at(pr.inputs, input);
      if (c < 0) continue;
      let ready: boolean;
      if (at(plan.conduits, c).length > 0) {
        const slots = at(sim.conduits, c).slots;
        ready = slots[slots.length - 1] !== null;
      } else if (at(pr.inputRoute, input) >= 0) {
        ready = at(sim.routes, at(pr.inputRoute, input)).held !== null;
      } else if (at(pr.inputSource, input) >= 0) {
        ready = at(sim.sources, at(pr.inputSource, input)).countdown <= 1;
      } else {
        ready = false;
      }
      if (ready) {
        winners[ri] = input;
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
      if (offerTarget(sim, ctx, winners, pc.to, item)) slots[last] = null;
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
        if (c === NO_OUTPUT) continue;
        connected = true;
        // An open half is connected but never accepts.
        if (c === OPEN_HALF) continue;
        if (pushOnto(sim, ctx, winners, c, item)) {
          route.held = null;
          route.pointer = (o + 1) % n;
          placed = true;
          break;
        }
      }
      if (!placed && !connected) lose(sim, ctx, route, item);
    } else {
      const c = at(pr.outputs, 0);
      if (c === NO_OUTPUT) lose(sim, ctx, route, item);
      else if (c === OPEN_HALF) continue;
      else if (pushOnto(sim, ctx, winners, c, item)) route.held = null;
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
      if (c === NO_OUTPUT) continue;
      connected = true;
      if (c === OPEN_HALF) continue;
      if (pushOnto(sim, ctx, winners, c, s.resource)) {
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
      s.countdown = scaledInterval(
        ps.interval,
        ctx.sourceSpeedPercent?.[ps.owner] ?? 0,
      );
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
  if (ctx.consumers === 'need' && ctx.pacers !== undefined) {
    for (const pacer of ctx.pacers) paceConsumer(sim, pacer);
  }
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

/**
 * One tick of a paced consumer (`'need'` mode, PP-6): intake of at most
 * `cost - progress` items, one production when `progress = cost` and the
 * cooldown is 0, then the cooldown counts down (as in step 7 of a battle tick).
 */
function paceConsumer(sim: BoardSim, p: ConsumerPacer): void {
  const consumer = sim.consumers.find((c) => c.building === p.building);
  const open = p.limit < 0 || p.productions < p.limit;
  if (consumer !== undefined && open && p.progress < p.cost) {
    for (const input of consumer.inputs) {
      const n = Math.min(input.count, p.cost - p.progress);
      if (n > 0 && takeFromBuffer(sim, p.building, input.side, n)) {
        p.progress += n;
      }
    }
  }
  if (open && p.progress === p.cost && p.cooldown === 0) {
    p.progress = 0;
    p.cooldown = p.interval;
    p.productions += 1;
  }
  if (p.cooldown > 0) p.cooldown -= 1;
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
  let produced = sim.retired?.produced ?? 0;
  let lost = sim.retired?.lost ?? 0;
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
  let consumed = sim.retired?.consumed ?? 0;
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

/** A consumer's need and productions in a `'need'` dry run (PP-6). */
export interface DryRunNeed {
  readonly building: number;
  /** Items per 1000 ticks at top speed (`needPer1000`). */
  readonly needPer1000: number;
  /** Productions made during the run. */
  readonly productions: number;
}

export interface DryRunResult {
  readonly ticks: number;
  readonly sources: readonly DryRunSource[];
  readonly routes: readonly DryRunRoute[];
  readonly consumers: readonly DryRunConsumerInput[];
  /** Only in `'need'` mode: one entry per consumer, in building order. */
  readonly needs?: readonly DryRunNeed[];
}

/**
 * Simulate the board alone for `ticks` ticks with every consumer buffer
 * drained each tick, and report totals and delivery rates. The rate counts
 * deliveries in ticks `floor(ticks / 2)` to `ticks - 1`, so the cold start
 * does not distort it. With `mode` `'need'` each consumer is instead paced at
 * its top speed (PP-6: intake of at most `cost - progress`, one production per
 * interval) and `needs` reports its need and productions.
 */
export function dryRunFlow(
  state: TeamState,
  content: TeamContent,
  simConfig: SimConfig,
  ticks: number,
  mode: 'drain' | 'need' = 'drain',
): DryRunResult {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError('dryRunFlow: ticks must be a non-negative integer.');
  }
  const sim = createBoardSim(state, content, simConfig);
  const ctx = createFlowContext(state, content, simConfig, {
    consumers: mode,
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
  const needs: DryRunNeed[] = (ctx.pacers ?? []).map((p) => {
    const b = state.buildings.find((x) => x.id === p.building);
    const def = b && content.buildings.get(b.def);
    return {
      building: p.building,
      needPer1000: b && def ? needPer1000(def, b.tier) : 0,
      productions: p.productions,
    };
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
    ...(mode === 'need' ? { needs } : {}),
  };
}
