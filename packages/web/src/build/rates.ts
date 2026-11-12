/**
 * Display of flow rates (PP-5, PP-6). Every number comes from the helpers
 * `core` itself uses (`collectorHundredthsPerSecond`, `needHundredthsPerSecond`,
 * `needPer1000`, `productionOf`); nothing here models flow. Hundredths of an
 * item per second are formatted for display only.
 */

import {
  collectorHundredthsPerSecond,
  needHundredthsPerSecond,
  needPer1000,
  productionOf,
  type BuildingDef,
  type DryRunResult,
  type PlacedBuilding,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';

/** `125` -> `"1.25"`. */
export function formatHundredths(h: number): string {
  const whole = Math.floor(h / 100);
  const frac = h % 100;
  return `${String(whole)}.${String(frac).padStart(2, '0')}`;
}

export interface BuildingRate {
  /** A collector's output in hundredths per second at this tier. */
  readonly collects: number | null;
  /** A consumer's need at top speed, hundredths per second. */
  readonly needs: number | null;
  /** Items per 1000 ticks the consumer needs (`needPer1000`). */
  readonly needPer1000: number;
  /** Productions per second at top speed, in hundredths. */
  readonly topSpeed: number | null;
}

export function buildingRate(
  def: BuildingDef,
  tier: number,
  ticksPerSecond: number,
): BuildingRate {
  if (def.kind === 'source') {
    return {
      collects: collectorHundredthsPerSecond(def, tier, ticksPerSecond),
      needs: null,
      needPer1000: 0,
      topSpeed: null,
    };
  }
  const p = productionOf(def, tier);
  if (p === undefined) {
    return { collects: null, needs: null, needPer1000: 0, topSpeed: null };
  }
  return {
    collects: null,
    needs: needHundredthsPerSecond(def, tier, ticksPerSecond),
    needPer1000: needPer1000(def, tier),
    // 100 * ticksPerSecond / interval, rounded down.
    topSpeed: Math.floor((100 * ticksPerSecond) / p.interval),
  };
}

/** What a rate line says in words, e.g. "needs 0.50/s at top speed (0.25 shots/s)". */
export function topSpeedWord(def: BuildingDef): string {
  if (def.kind === 'unit_producer') return 'units';
  if (def.kind === 'economy') return 'steps';
  return 'shots';
}

export type SupplyState = 'full' | 'under';

export interface Supply {
  readonly building: number;
  readonly state: SupplyState;
  /** Hundredths per second needed and received (dry run, second half). */
  readonly needs: number;
  readonly gets: number;
}

/**
 * Whether each consumer of a `'need'` dry run receives its whole need. The
 * received rate is the dry run's `ratePer1000` summed over the building's
 * inputs; it is counted over a window of `ticks - floor(ticks / 2)` ticks, so
 * the allowed shortfall is one delivery in that window.
 */
export function supplyOf(
  team: TeamState,
  content: WebContent,
  needRun: DryRunResult,
  ticksPerSecond: number,
): Supply[] {
  const out: Supply[] = [];
  const window = needRun.ticks - Math.floor(needRun.ticks / 2);
  const slack = window === 0 ? 0 : Math.ceil(1000 / window);
  for (const n of needRun.needs ?? []) {
    const b: PlacedBuilding | undefined = team.buildings.find(
      (x) => x.id === n.building,
    );
    const def = b === undefined ? undefined : content.buildings.get(b.def);
    if (b === undefined || def === undefined || n.needPer1000 === 0) continue;
    const got = needRun.consumers
      .filter((c) => c.building === n.building)
      .reduce((sum, c) => sum + c.ratePer1000, 0);
    out.push({
      building: n.building,
      state: got + slack >= n.needPer1000 ? 'full' : 'under',
      needs: needHundredthsPerSecond(def, b.tier, ticksPerSecond),
      gets: Math.floor((got * ticksPerSecond) / 10),
    });
  }
  return out;
}

/** One line for a shop offer: "Needs 0.50 / s at top speed", "Collects 0.40 / s". */
export function rateText(
  def: BuildingDef,
  tier: number,
  ticksPerSecond: number,
): string {
  const r = buildingRate(def, tier, ticksPerSecond);
  if (r.collects !== null) {
    return `Collects ${formatHundredths(r.collects)} / s`;
  }
  if (r.needs !== null && r.topSpeed !== null) {
    return `Needs ${formatHundredths(r.needs)} / s at top speed (${formatHundredths(r.topSpeed)} ${topSpeedWord(def)} / s)`;
  }
  return '';
}
