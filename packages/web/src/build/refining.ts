/**
 * Per-resource figures for two-input buildings and refineries (CB-5d, CB-5e),
 * and the refining chain of a flow preview (CB-43). Every number comes from
 * the helpers `core` uses (`costEntries`, `productionOf`); this module only
 * turns them into per-second display figures and walks the conduits.
 */
import {
  buildFlowGraph,
  buildingEnd,
  costEntries,
  productionOf,
  tunnelPairs,
  type BuildingDef,
  type PlacedBuilding,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';
import type { Supply } from './rates.js';

/** One resource and a rate in hundredths of an item per second. */
export interface ResourceRate {
  readonly resource: string;
  readonly hundredths: number;
}

/**
 * What a consumer takes per second at top speed, one entry per resource, in
 * resource ID order: the two costs of a Foundry or a refinery. Empty for a
 * one-cost building (use `buildingRate`).
 */
export function inputRates(
  def: BuildingDef,
  tier: number,
  ticksPerSecond: number,
): ResourceRate[] {
  const entries = costEntries(def, tier);
  const p = productionOf(def, tier);
  if (entries === undefined || p === undefined) return [];
  return entries.map((e) => ({
    resource: e.resource,
    hundredths: Math.floor((100 * e.cost * ticksPerSecond) / p.interval),
  }));
}

/** A refinery's output per second at top speed (every input kept full). */
export function outputRate(
  def: BuildingDef,
  tier: number,
  ticksPerSecond: number,
  /** A Transmuter's setting (issue #476): the resource it is set to make. */
  setting?: string,
): ResourceRate | null {
  if (def.kind !== 'refinery') return null;
  const t = def.tiers[tier - 1];
  const resource = def.output ?? setting;
  if (t === undefined || resource === undefined) return null;
  return {
    resource,
    hundredths: Math.floor(
      (100 * t.outputPerBatch * ticksPerSecond) / t.productionIntervalTicks,
    ),
  };
}

/** Items one batch of a refinery takes in, and the items it makes. */
export function batchTotals(
  def: BuildingDef,
  tier: number,
): { readonly taken: number; readonly made: number } | null {
  if (def.kind !== 'refinery') return null;
  const t = def.tiers[tier - 1];
  if (t === undefined) return null;
  return {
    taken:
      t.costPerBatch ??
      (costEntries(def, tier) ?? []).reduce((n, e) => n + e.cost, 0),
    made: t.outputPerBatch,
  };
}

/**
 * The base resource that arrives at a Transmuter's input (issue #476), or
 * null when no conduit feeds it or the resource is not known yet.
 */
export function arrivingResource(
  team: TeamState,
  content: Pick<WebContent, 'buildings' | 'terrain' | 'resources'>,
  building: number,
): string | null {
  try {
    const edge = buildFlowGraph(team, content).edges.find(
      (e) => e.to === String(building),
    );
    return edge?.resource ?? null;
  } catch {
    // A loop in the conduits: nothing is known.
    return null;
  }
}

/** The resource a `resource_mismatch` refusal says an input takes, if it does. */
export function mismatchWanted(detail: string | undefined): string | null {
  if (detail === undefined) return null;
  const m = /\bwhich takes (\S+)$/.exec(detail);
  return m === null ? null : (m[1] as string);
}

/**
 * The buildings that take what `from` sends out, following the conduits
 * through routes (splitters, mergers, crossovers); a consumer ends the walk.
 * Border links are not followed (they are halves of another plot's board).
 */
export function downstreamOf(
  team: TeamState,
  content: Pick<WebContent, 'buildings' | 'terrain'>,
  from: number,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>([from]);
  const todo = [from];
  const pairs = tunnelPairs(team, content);
  while (todo.length > 0) {
    const at = todo.pop() as number;
    // A Tunnel entrance carries on at its exit (CB-9g).
    const exit = pairs.find((p) => p.entrance === at)?.exit;
    if (exit !== undefined && !seen.has(exit)) {
      seen.add(exit);
      todo.push(exit);
    }
    for (const c of team.conduits) {
      if (buildingEnd(c.from)?.building !== at) continue;
      const to = buildingEnd(c.to)?.building;
      if (to === undefined || seen.has(to)) continue;
      seen.add(to);
      const b: PlacedBuilding | undefined = team.buildings.find(
        (x) => x.id === to,
      );
      const def = b === undefined ? undefined : content.buildings.get(b.def);
      if (def === undefined) continue;
      if (def.kind === 'route') todo.push(to);
      else out.push(to);
    }
  }
  return out;
}

/**
 * The sources that feed `side` of a building, following the conduits back
 * through routes (a router takes every conduit that ends on it).
 */
export function upstreamSources(
  team: TeamState,
  content: Pick<WebContent, 'buildings' | 'terrain'>,
  building: number,
  side: string,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const pairs = tunnelPairs(team, content);
  // Conduits into (building, side) first; then every conduit into a router.
  const todo: { building: number; side: string | null }[] = [
    { building, side },
  ];
  while (todo.length > 0) {
    const at = todo.pop() as { building: number; side: string | null };
    // What leaves a Tunnel exit came in at its entrance (CB-9g).
    const entrance = pairs.find((p) => p.exit === at.building)?.entrance;
    if (entrance !== undefined && !seen.has(entrance)) {
      seen.add(entrance);
      todo.push({ building: entrance, side: null });
    }
    for (const c of team.conduits) {
      const to = buildingEnd(c.to);
      if (to === null || to.building !== at.building) continue;
      if (at.side !== null && to.side !== at.side) continue;
      const from = buildingEnd(c.from)?.building;
      if (from === undefined || seen.has(from)) continue;
      seen.add(from);
      const b = team.buildings.find((x) => x.id === from);
      const d = b === undefined ? undefined : content.buildings.get(b.def);
      if (d === undefined) continue;
      if (d.kind === 'source') out.push(from);
      else if (d.kind === 'route') todo.push({ building: from, side: null });
    }
  }
  return out;
}

/** One consumer fed by a refinery, and whether it is fully fed. */
export interface ChainFeed {
  readonly building: number;
  readonly state: 'full' | 'under' | 'starved';
  /** Resources of its inputs that are short (two-input consumers); else the refinery's output. */
  readonly short: readonly string[];
}

/** One refining chain of a flow preview. */
export interface ChainRow {
  readonly refinery: number;
  /** What reaches the refinery: each input against its need. */
  readonly takes: Supply['inputs'];
  /** What it makes against its top speed. */
  readonly makes: Supply['output'];
  readonly feeds: readonly ChainFeed[];
}

/**
 * The refining chains of a board: for every refinery, what reaches it, what
 * it makes, and whether each consumer downstream of it is fully fed. A
 * consumer is `starved` when nothing reaches its inputs at all.
 */
export function chainRows(
  team: TeamState,
  content: Pick<WebContent, 'buildings' | 'terrain'>,
  supply: readonly Supply[],
  starved: ReadonlySet<number>,
): ChainRow[] {
  const rows: ChainRow[] = [];
  for (const b of team.buildings) {
    const def = content.buildings.get(b.def);
    if (def === undefined || def.kind !== 'refinery') continue;
    const mine = supply.find((s) => s.building === b.id);
    const feeds: ChainFeed[] = [];
    for (const id of downstreamOf(team, content, b.id)) {
      const s = supply.find((x) => x.building === id);
      if (s === undefined) continue;
      const dead = starved.has(id);
      feeds.push({
        building: id,
        state: dead ? 'starved' : s.state === 'full' ? 'full' : 'under',
        short:
          s.inputs === undefined
            ? [def.output ?? b.resource].flatMap((r) =>
                r === undefined ? [] : [r],
              )
            : s.inputs.filter((i) => i.short).map((i) => i.resource),
      });
    }
    rows.push({
      refinery: b.id,
      takes: mine?.inputs,
      makes: mine?.output,
      feeds,
    });
  }
  return rows;
}
