/**
 * Pure parts of the Build overlay marks (issue #142): what a border link
 * carries and which way, the zoom at which rate numbers are drawn, and which
 * connected sources back up unused. Drawing lives in `overlay-draw.ts`.
 */

import type { BuildingDef, DryRunResult } from '@game/core';
import type { Half } from './border-links.js';
import { buildingRate, formatHundredths, type Supply } from './rates.js';
import { screenText, screenTexts, type ScreenTexts } from './texts.js';

/** Screen direction of the arrow on a border cell (plots lie left to right). */
export type FlowDirection = 'east' | 'west';

export interface HalfFlow {
  readonly direction: FlowDirection;
  /** The link's conduit is fed by a source that produced in the dry run. */
  readonly active: boolean;
}

/**
 * The arrow of one half points from the sending plot into the receiving plot.
 * Border `b` lies between plot `b` (left) and plot `b + 1` (right): a sending
 * half in the left plot, or a receiving half in the right plot, points east.
 * Both halves of a joined link therefore point the same way.
 */
export function halfFlow(
  h: Pick<Half, 'owner' | 'spot' | 'kind' | 'conduit'>,
  activeConduits: ReadonlySet<number> | null,
): HalfFlow {
  const inLeftPlot = h.owner === h.spot.border;
  return {
    direction: (h.kind === 'send') === inLeftPlot ? 'east' : 'west',
    active: activeConduits?.has(h.conduit) ?? false,
  };
}

/** Smallest text the rate numbers may be drawn at, in pixels. */
export const MIN_RATE_FONT_PX = 9;

/** Font size of the per-building rate text at a camera zoom (pixels per cell). */
export function rateFontPx(zoom: number): number {
  return Math.min(12, zoom * 0.3);
}

/** Whether the rate numbers are readable (not under `MIN_RATE_FONT_PX`) at `zoom`. */
export function showRates(zoom: number): boolean {
  return rateFontPx(zoom) >= MIN_RATE_FONT_PX;
}

/**
 * A connected source counts as backing up when it was stalled for more than
 * half of the dry-run window. Buffers fill in the first ticks of every run,
 * so a short stall is normal and not reported.
 */
export function isBackedUp(stalledTicks: number, runTicks: number): boolean {
  return runTicks > 0 && stalledTicks * 2 > runTicks;
}

/**
 * The text drawn on a building: a collector's output or a consumer's need at
 * top speed ("0.40/s"), or '' for a building that has neither.
 */
export function boardRateText(
  def: BuildingDef,
  tier: number,
  ticksPerSecond: number,
  texts: ScreenTexts = screenTexts,
): string {
  const r = buildingRate(def, tier, ticksPerSecond);
  const h = r.collects ?? r.needs;
  return h === null
    ? ''
    : screenText(texts, 'rateOnBoard', { rate: formatHundredths(h) });
}

/** Sources of a dry run that back up, with the share of the run stalled (0-100). */
export function backedUpSources(dry: DryRunResult): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of dry.sources) {
    if (isBackedUp(s.stalledTicks, dry.ticks)) {
      out.set(s.building, Math.round((100 * s.stalledTicks) / dry.ticks));
    }
  }
  return out;
}

/** The mark a building carries in its top-right corner, if any. */
export type RateMark = 'stalled' | 'starved' | 'low' | null;

/** Where the rate text goes on a building. */
export type RateLabelSpot = 'top' | 'bottom' | 'hidden';

export interface RateLabelInput {
  readonly zoom: number;
  /** A sealed unit producer: its rate means nothing until it is reachable. */
  readonly sealed: boolean;
  readonly mark: RateMark;
  /** Width of the text box, in pixels. */
  readonly textWidth: number;
  /** Width the corner mark takes, 0 when there is none. */
  readonly reserved: number;
  readonly boxWidth: number;
}

/**
 * Where the rate text is drawn. Hidden below the zoom cut-off and on a sealed
 * building. Beside a corner mark it stays on the top row when it fits; when it
 * does not, an under-supplied consumer (LOW or starved) moves it to the bottom
 * row so the canvas still shows what the building gets, and a stalled marker
 * hides it.
 */
export function rateLabelSpot(i: RateLabelInput): RateLabelSpot {
  if (!showRates(i.zoom) || i.sealed) return 'hidden';
  if (i.mark === null || i.reserved === 0) return 'top';
  if (i.textWidth + i.reserved <= i.boxWidth) return 'top';
  return i.mark === 'stalled' ? 'hidden' : 'bottom';
}

/** "0.25/0.50/s": what an under-supplied consumer gets against what it needs. */
export function suppliedRateText(
  supply: Pick<Supply, 'gets' | 'needs'>,
  texts: ScreenTexts = screenTexts,
): string {
  return screenText(texts, 'rateGetsNeeds', {
    gets: formatHundredths(supply.gets),
    needs: formatHundredths(supply.needs),
  });
}
