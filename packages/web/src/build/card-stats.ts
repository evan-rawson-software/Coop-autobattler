/**
 * The stat lines of a building card, one rule set for every screen that shows
 * one (the Shop offers now, the Build screen's Selected panel later):
 *
 * - `uses`: what it consumes, with its rate ("Uses Ore 0.50/s"); a router
 *   says "Uses: any resource"; null for a building that consumes nothing.
 * - `collects`: a source's output rate ("Collects 0.50/s"); null otherwise.
 * - `effect`: what it does, with no rate and no health in it.
 * - `health`: its own line ("Health 60").
 *
 * Each rate appears once. All words come from the presentation file.
 */
import { formatText, type BuildingDef, type SimConfig } from '@game/core';
import type { WebContent } from '../content.js';
import { effectText, neededResources } from '../shop/effect-text.js';
import { buildingRate, formatHundredths } from './rates.js';
import { screenText, screenTexts, type ScreenTexts } from './texts.js';

export interface CardStats {
  readonly uses: string | null;
  readonly collects: string | null;
  readonly effect: string;
  readonly health: string;
}

export function cardStats(
  content: Pick<WebContent, 'resources' | 'presentation'>,
  sim: Pick<SimConfig, 'ticksPerSecond'>,
  def: BuildingDef,
  tier: number,
  texts: ScreenTexts = screenTexts,
): CardStats {
  const rate = buildingRate(def, tier, sim.ticksPerSecond);
  const ids = neededResources(def);
  let uses: string | null = null;
  if (rate.needs !== null && ids.length > 0) {
    uses = screenText(texts, 'usesRate', {
      resource: ids
        .map((id) => formatText(`{${id}}`, content.resources))
        .join(', '),
      rate: formatHundredths(rate.needs),
    });
  } else if (def.kind === 'route') {
    uses = screenText(texts, 'uiShopUses', {
      needs: content.presentation.templates.needs.any,
    });
  }
  const health = def.tiers[tier - 1]?.health;
  return {
    uses,
    collects:
      rate.collects === null
        ? null
        : screenText(texts, 'collects', {
            rate: formatHundredths(rate.collects),
          }),
    effect: effectText(content, sim, def, tier),
    health:
      health === undefined
        ? ''
        : screenText(texts, 'uiShopHealth', { health: String(health) }),
  };
}
