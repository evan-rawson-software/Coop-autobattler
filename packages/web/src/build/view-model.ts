/**
 * Pure view models for the Build screen: the flow overlay, the inspector's
 * figures and the problems list. They read the team state, content and the
 * output of `core`'s `dryRunFlow`; they decide nothing about legality, and
 * every number is an estimate derived from the dry run and content numbers.
 */

import {
  buildFlowGraph,
  dryRunFlow,
  occupancy,
  type BuildingDef,
  type Cell,
  type DryRunResult,
  type PlacedBuilding,
  type Side,
  type SimConfig,
  type TeamState,
  buildingEnd,
} from '@game/core';
import type { WebContent } from '../content.js';
import { count } from '../plural.js';
import { formatHundredths, supplyOf, type Supply } from './rates.js';

// ---------------------------------------------------------------------------
// Names

export function buildingName(content: WebContent, defId: string): string {
  return content.presentation.get(defId)?.name ?? defId;
}

export function resourceName(content: WebContent, id: string): string {
  return content.resources.get(id)?.name ?? id;
}

// ---------------------------------------------------------------------------
// Dry run and the flow overlay

export interface FlowView {
  readonly dry: DryRunResult;
  /** Conduits fed, directly or through routes, by a source that produced. */
  readonly activeConduits: ReadonlySet<number>;
  /** Buildings with a connected input that received nothing in the dry run. */
  readonly starved: ReadonlySet<number>;
  /** Consumers against their need at top speed (`'need'` dry run, PP-6). */
  readonly supply: readonly Supply[];
  /** Buildings that receive less than their need. */
  readonly underSupplied: ReadonlySet<number>;
}

/** Whether `side` of a building has a conduit ending on it. */
export function inputConnected(
  state: TeamState,
  building: number,
  side: Side,
): boolean {
  return state.conduits.some((c) => {
    const t = buildingEnd(c.to);
    return t !== null && t.building === building && t.side === side;
  });
}

/** Run `dryRunFlow` and derive which conduits carry something. */
export function computeFlowView(
  state: TeamState,
  content: WebContent,
  sim: SimConfig,
  ticks: number,
): FlowView | null {
  let dry: DryRunResult;
  let supply: Supply[];
  const active = new Set<number>();
  try {
    dry = dryRunFlow(state, content, sim, ticks);
    supply = supplyOf(
      state,
      content,
      dryRunFlow(state, content, sim, ticks, 'need'),
      sim.ticksPerSecond,
    );
    const graph = buildFlowGraph(state, content);
    const producing = new Set(
      dry.sources.filter((s) => s.produced > 0).map((s) => String(s.building)),
    );
    for (const key of graph.order) {
      const on =
        producing.has(key) ||
        graph.edges.some((e) => e.to === key && active.has(e.conduitId));
      if (!on) continue;
      for (const e of graph.edges) {
        if (e.from !== key) continue;
        active.add(e.conduitId);
        // Both halves of a link carry (PP-4).
        if (e.linkedConduit !== null) active.add(e.linkedConduit);
      }
    }
  } catch {
    return null;
  }
  const starved = new Set<number>();
  for (const c of dry.consumers) {
    if (c.delivered === 0 && inputConnected(state, c.building, c.side)) {
      starved.add(c.building);
    }
  }
  const underSupplied = new Set(
    supply.filter((x) => x.state === 'under').map((x) => x.building),
  );
  return { dry, activeConduits: active, starved, supply, underSupplied };
}

// ---------------------------------------------------------------------------
// Inspector figures

export interface InputFigure {
  readonly side: Side;
  readonly resource: string;
  readonly connected: boolean;
  /** Units per second arriving in the dry run (second half). */
  readonly arrivesPerSec: number;
  /** Units per second needed to run flat out, when that is meaningful. */
  readonly needsPerSec: number | null;
}

export interface Derived {
  readonly kind: 'units' | 'shots' | 'steps';
  /** Estimated per minute at the current supply. */
  readonly perMin: number;
  /** Per minute with unlimited supply, when something caps it. */
  readonly maxPerMin: number | null;
  /** Resource units one of them costs. */
  readonly cost: number;
}

export interface Figures {
  readonly inputs: readonly InputFigure[];
  /** For a source: its resource and units per second at full speed. */
  readonly produces: {
    readonly resource: string | null;
    readonly perSec: number;
    readonly lostPerSec: number;
  } | null;
  readonly derived: Derived | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Per-second rate from a per-1000-ticks rate. */
export function perSecond(ratePer1000: number, sim: SimConfig): number {
  return (ratePer1000 * sim.ticksPerSecond) / 1000;
}

export function inspectorFigures(
  state: TeamState,
  content: WebContent,
  sim: SimConfig,
  dry: DryRunResult | null,
  building: PlacedBuilding,
): Figures | null {
  const def = content.buildings.get(building.def);
  if (def === undefined) return null;
  const tier = def.tiers[building.tier - 1];
  if (tier === undefined) return null;
  const occ = occupancy(state, content);
  const sides = occ.absoluteSides(building);
  const tps = sim.ticksPerSecond;

  const inputs: InputFigure[] = [];
  for (const inp of sides.inputs) {
    if (inp.resource === undefined) continue;
    const row = dry?.consumers.find(
      (c) => c.building === building.id && c.side === inp.side,
    );
    const arrives = row === undefined ? 0 : perSecond(row.ratePer1000, sim);
    let needs: number | null = null;
    if (def.kind === 'defense' && def.defenseType === 'turret') {
      const t = def.tiers[building.tier - 1];
      if (t !== undefined) needs = (t.costPerShot * tps) / t.cooldownTicks;
    }
    inputs.push({
      side: inp.side,
      resource: inp.resource,
      connected: inputConnected(state, building.id, inp.side),
      arrivesPerSec: round1(arrives),
      needsPerSec: needs === null ? null : round1(needs),
    });
  }
  const arrivesTotal = inputs.reduce(
    (n, i) => n + (dry === null ? 0 : exactArrives(dry, building.id, i, sim)),
    0,
  );

  let produces: Figures['produces'] = null;
  if (def.kind === 'source') {
    const t = def.tiers[building.tier - 1];
    const row = dry?.sources.find((s) => s.building === building.id);
    produces = {
      resource: occ.sourceResource(building) ?? null,
      perSec: t === undefined ? 0 : round1(tps / t.intervalTicks),
      lostPerSec:
        row === undefined || dry === null
          ? 0
          : round1((row.lost * tps) / Math.max(1, dry.ticks)),
    };
  }

  return {
    inputs,
    produces,
    derived: deriveRate(def, building.tier, arrivesTotal, tps),
  };
}

function exactArrives(
  dry: DryRunResult,
  building: number,
  input: InputFigure,
  sim: SimConfig,
): number {
  const row = dry.consumers.find(
    (c) => c.building === building && c.side === input.side,
  );
  return row === undefined ? 0 : perSecond(row.ratePer1000, sim);
}

function deriveRate(
  def: BuildingDef,
  tierNumber: number,
  arrivesPerSec: number,
  tps: number,
): Derived | null {
  if (def.kind === 'unit_producer') {
    const t = def.tiers[tierNumber - 1];
    if (t === undefined) return null;
    return {
      kind: 'units',
      perMin: round1((arrivesPerSec * 60) / t.costPerUnit),
      maxPerMin: null,
      cost: t.costPerUnit,
    };
  }
  if (def.kind === 'defense' && def.defenseType === 'turret') {
    const t = def.tiers[tierNumber - 1];
    if (t === undefined) return null;
    const cap = (60 * tps) / t.cooldownTicks;
    return {
      kind: 'shots',
      perMin: round1(Math.min((arrivesPerSec * 60) / t.costPerShot, cap)),
      maxPerMin: round1(cap),
      cost: t.costPerShot,
    };
  }
  if (def.kind === 'economy') {
    const t = def.tiers[tierNumber - 1];
    if (t === undefined) return null;
    return {
      kind: 'steps',
      perMin: round1((arrivesPerSec * 60) / t.costPerStep),
      maxPerMin: null,
      cost: t.costPerStep,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Problems

export type ProblemKind =
  | 'missing_input'
  | 'starved'
  | 'under_supplied'
  | 'lost_output'
  | 'stash'
  | 'free_nodes';

export interface Problem {
  readonly id: string;
  readonly kind: ProblemKind;
  readonly text: string;
  /** Board cell to focus the camera on when clicked, if any. */
  readonly focus: Cell | null;
  /** Building to select when clicked, if any. */
  readonly building: number | null;
}

export function deriveProblems(
  state: TeamState,
  content: WebContent,
  flow: FlowView | null,
): Problem[] {
  const out: Problem[] = [];
  const occ = occupancy(state, content);
  const name = (b: PlacedBuilding): string => buildingName(content, b.def);

  for (const b of state.buildings) {
    const def = content.buildings.get(b.def);
    if (def === undefined) continue;
    const sides = occ.absoluteSides(b);
    const first = occ.cellsOf(b)[0] ?? { x: b.x, y: b.y };
    if (def.kind === 'route') {
      const any = sides.inputs.some((i) => inputConnected(state, b.id, i.side));
      if (!any && sides.inputs.length > 0) {
        out.push({
          id: `missing:${String(b.id)}`,
          kind: 'missing_input',
          text: `${name(b)} has nothing feeding it.`,
          focus: first,
          building: b.id,
        });
      }
    } else if (def.kind !== 'source') {
      for (const inp of sides.inputs) {
        if (inputConnected(state, b.id, inp.side)) continue;
        const what =
          inp.resource === undefined
            ? 'an input'
            : `its ${resourceName(content, inp.resource)} input`;
        out.push({
          id: `missing:${String(b.id)}:${inp.side}`,
          kind: 'missing_input',
          text: `${name(b)} has no conduit into ${what}.`,
          focus: first,
          building: b.id,
        });
      }
    }
    if (def.kind === 'source') {
      const hasOut = state.conduits.some(
        (c) => buildingEnd(c.from)?.building === b.id,
      );
      if (!hasOut) {
        const res = occ.sourceResource(b);
        out.push({
          id: `lost:${String(b.id)}`,
          kind: 'lost_output',
          text:
            res === undefined
              ? `${name(b)} has no conduit: its output is lost.`
              : `${name(b)} (${resourceName(content, res)}) has no conduit: its output is lost.`,
          focus: first,
          building: b.id,
        });
      }
    }
  }

  if (flow !== null) {
    for (const c of flow.dry.consumers) {
      if (c.delivered !== 0 || !inputConnected(state, c.building, c.side)) {
        continue;
      }
      const b = state.buildings.find((x) => x.id === c.building);
      if (b === undefined) continue;
      out.push({
        id: `starved:${String(b.id)}:${c.side}`,
        kind: 'starved',
        text: `${name(b)} receives no ${resourceName(content, c.resource)} in the dry run.`,
        focus: occ.cellsOf(b)[0] ?? { x: b.x, y: b.y },
        building: b.id,
      });
    }
  }

  if (flow !== null) {
    for (const u of flow.supply) {
      // Nothing at all is reported as "starved" above.
      if (u.state !== 'under' || flow.starved.has(u.building)) continue;
      const b = state.buildings.find((x) => x.id === u.building);
      if (b === undefined) continue;
      out.push({
        id: `under:${String(b.id)}`,
        kind: 'under_supplied',
        text: `${name(b)} gets ${formatHundredths(u.gets)}/s of the ${formatHundredths(u.needs)}/s it needs.`,
        focus: occ.cellsOf(b)[0] ?? { x: b.x, y: b.y },
        building: b.id,
      });
    }
  }

  const freeNodes = state.map.nodes.filter(
    (n) => occ.buildingAt(n.x, n.y) === null,
  );
  const sourceInStash = state.stash.find(
    (s) => content.buildings.get(s.def)?.kind === 'source',
  );
  if (freeNodes.length > 0 && sourceInStash !== undefined) {
    const kinds = Array.from(
      new Set(freeNodes.map((n) => resourceName(content, n.resource))),
    );
    const first = freeNodes[0];
    out.push({
      id: 'free_nodes',
      kind: 'free_nodes',
      text: `${buildingName(content, sourceInStash.def)} in stash: ${count(freeNodes.length, 'free node')} (${kinds.join(', ')}).`,
      focus: first === undefined ? null : { x: first.x, y: first.y },
      building: null,
    });
  }
  if (state.stash.length > 0) {
    const n = state.stash.length;
    out.push({
      id: 'stash',
      kind: 'stash',
      text: `${count(n, 'building')} in the stash could be placed.`,
      focus: null,
      building: null,
    });
  }
  return out;
}

/**
 * The Core spots the players have proposed so far in the Core placement step
 * (`pending.positions`, one entry per player, null until proposed). Read-only
 * view of existing session state.
 */
export function pendingCoreSpots(
  pending: unknown,
): { player: number; x: number; y: number }[] {
  const list = (pending as { positions?: unknown } | null)?.positions;
  if (!Array.isArray(list)) return [];
  const out: { player: number; x: number; y: number }[] = [];
  list.forEach((p: unknown, player) => {
    const c = p as { x?: unknown; y?: unknown } | null;
    if (c !== null && typeof c.x === 'number' && typeof c.y === 'number') {
      out.push({ player, x: c.x, y: c.y });
    }
  });
  return out;
}
