/**
 * Display of flow rates (PP-5, PP-6). Every number comes from the helpers
 * `core` itself uses (`collectorHundredthsPerSecond`, `needHundredthsPerSecond`,
 * `needPer1000`, `productionOf`); nothing here models flow. Hundredths of an
 * item per second are formatted for display only.
 */

import {
  collectorHundredthsPerSecond,
  dryRunFlow,
  needHundredthsPerSecond,
  needPer1000,
  productionOf,
  type BuildingDef,
  type DryRunResult,
  type PlacedBuilding,
  type SimConfig,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';
import { screenText, screenTexts, type ScreenTexts } from './texts.js';

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

/** What a rate line counts, e.g. "shots" in "0.25 shots / s" (from the presentation file). */
export function topSpeedWord(
  def: BuildingDef,
  texts: ScreenTexts = screenTexts,
): string {
  if (def.kind === 'unit_producer') return screenText(texts, 'unitsWord');
  if (def.kind === 'economy') return screenText(texts, 'stepsWord');
  return screenText(texts, 'shotsWord');
}

/** Shortest counting window the supplied/under tolerance is computed over. */
const MIN_WINDOW = 300;

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
  // One delivery of tolerance, counted over at least `MIN_WINDOW` ticks so a
  // short dry-run setting cannot make a starving building read "supplied".
  const slack = Math.ceil(1000 / Math.max(window, MIN_WINDOW));
  for (const n of needRun.needs ?? []) {
    const b: PlacedBuilding | undefined = team.buildings.find(
      (x) => x.id === n.building,
    );
    const def = b === undefined ? undefined : content.buildings.get(b.def);
    if (b === undefined || def === undefined || n.needPer1000 === 0) continue;
    // An economy building that has taken all its steps stops asking for items
    // (the pacer closes at `maxSteps`), so nothing arrives afterwards: that is
    // a finished need, not a shortage.
    const limit = (def.tiers[b.tier - 1] as { maxSteps?: number } | undefined)
      ?.maxSteps;
    const finished =
      limit !== undefined && limit >= 0 && n.productions >= limit;
    const got = needRun.consumers
      .filter((c) => c.building === n.building)
      .reduce((sum, c) => sum + c.ratePer1000, 0);
    out.push({
      building: n.building,
      state: finished || got + slack >= n.needPer1000 ? 'full' : 'under',
      needs: needHundredthsPerSecond(def, b.tier, ticksPerSecond),
      gets: Math.floor((got * ticksPerSecond) / 10),
    });
  }
  return out;
}

/**
 * The length of the `'need'` dry run behind "supplied / UNDER-SUPPLIED". It is
 * fixed, so the label does not change with the dry-run length setting.
 */
export const NEED_RUN_TICKS = 600;

const needCache = new WeakMap<TeamState, Supply[]>();

/** `supplyOf` over a fixed-length `'need'` run, memoised per board state. */
export function needSupply(
  team: TeamState,
  content: WebContent,
  sim: SimConfig,
): Supply[] {
  const hit = needCache.get(team);
  if (hit !== undefined) return hit;
  const out = supplyOf(
    team,
    content,
    dryRunFlow(team, content, sim, NEED_RUN_TICKS, 'need'),
    sim.ticksPerSecond,
  );
  needCache.set(team, out);
  return out;
}

/** One line for a shop offer: "Needs 0.50 / s at top speed", "Collects 0.40 / s". */
export function rateText(
  def: BuildingDef,
  tier: number,
  ticksPerSecond: number,
  texts: ScreenTexts = screenTexts,
): string {
  const r = buildingRate(def, tier, ticksPerSecond);
  if (r.collects !== null) {
    return screenText(texts, 'collects', {
      rate: formatHundredths(r.collects),
    });
  }
  if (r.needs !== null && r.topSpeed !== null) {
    return screenText(texts, 'needsTopSpeed', {
      rate: formatHundredths(r.needs),
      speed: formatHundredths(r.topSpeed),
      unit: topSpeedWord(def, texts),
    });
  }
  return '';
}
