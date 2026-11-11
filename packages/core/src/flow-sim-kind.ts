/**
 * Golden-vector kind `flow-sim`. Input: a `team-state-ops` script (`seed`,
 * `partySize`, `ops`) plus `ticks` (integer >= 0) and `consumers` (`"hold"` or
 * `"drain"`) and optionally `take`: `{building, side, every}`, which removes
 * one unit from that consumer input (`takeFromBuffer`) before every tick whose
 * number T satisfies `T mod every = every - 1` (when a unit is there); it paces
 * a slow consumer in `"hold"` mode. The script builds the board; the flow simulation then runs for
 * `ticks` ticks. Result: `{ tick, stateHash, flow, sources, routes,
 * consumers }` where `stateHash` is the hash of the final `BoardSim`, `flow`
 * the item accounting and the lists the per-building totals. The event log
 * (all events, in order) is returned as the vector's `eventLog`, so its hash
 * is the vector's `eventLogHash`.
 */
import {
  createBoardSim,
  createFlowContext,
  flowTotals,
  stepFlow,
  takeFromBuffer,
  type SimEvent,
} from './flow-sim.js';
import { hashJson, type Json } from './hash.js';
import type { SimulationFn } from './golden-kinds.js';
import type { MapContent } from './map.js';
import type { MapgenConfig } from './mapgen.js';
import type { SimConfig } from './sim-config.js';
import { runTeamStateOps } from './team-state-ops.js';

function field(input: Json, key: string): Json | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('flow-sim: input must be an object');
  }
  return (input as Record<string, Json>)[key];
}

export function makeFlowSimKind(
  content: MapContent,
  mapgen: MapgenConfig,
  simConfig: SimConfig,
): SimulationFn {
  return (input: Json) => {
    const ticks = field(input, 'ticks');
    const mode = field(input, 'consumers');
    if (typeof ticks !== 'number' || !Number.isInteger(ticks) || ticks < 0) {
      throw new TypeError('flow-sim: ticks must be a non-negative integer');
    }
    if (mode !== 'hold' && mode !== 'drain') {
      throw new TypeError('flow-sim: consumers must be "hold" or "drain"');
    }
    const take = field(input, 'take');
    let taker: { building: number; side: string; every: number } | undefined;
    if (take !== undefined) {
      const t = take as Record<string, Json>;
      const every = t['every'];
      if (
        typeof t['building'] !== 'number' ||
        typeof t['side'] !== 'string' ||
        typeof every !== 'number' ||
        !Number.isInteger(every) ||
        every < 1
      ) {
        throw new TypeError('flow-sim: take needs building, side and every');
      }
      taker = { building: t['building'], side: t['side'], every };
    }
    const { state } = runTeamStateOps(input, content, mapgen);
    const events: SimEvent[] = [];
    const sim = createBoardSim(state, content, simConfig);
    const ctx = createFlowContext(state, content, simConfig, {
      consumers: mode,
      events,
    });
    for (let t = 0; t < ticks; t++) {
      if (taker !== undefined && t % taker.every === taker.every - 1) {
        takeFromBuffer(sim, taker.building, taker.side, 1);
      }
      stepFlow(sim, ctx);
    }
    const result: Json = {
      tick: sim.tick,
      stateHash: hashJson(sim),
      flow: { ...flowTotals(sim) },
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
        held: r.held,
      })),
      consumers: sim.consumers.flatMap((c) =>
        c.inputs.map((i) => ({
          building: c.building,
          side: i.side,
          resource: i.resource,
          count: i.count,
          delivered: i.delivered,
          consumed: i.consumed,
        })),
      ),
    };
    return { result, eventLog: events };
  };
}
