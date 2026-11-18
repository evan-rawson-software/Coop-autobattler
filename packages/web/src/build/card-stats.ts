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
 * - `makes`: a refinery's output rate ("Makes Composite 0.67/s"); null otherwise.
 * - `notes`: plain-words lines: why a refinery runs at a loss, what armor and
 *   area damage do for the unit a building trains.
 * - `io`: the same inputs and output as figures with the resource colour, for
 *   a card that draws them as chips.
 *
 * Each rate appears once. All words come from the presentation file.
 */

/** One resource of a card with its display name, colour and rate per second. */
export interface IoFigure {
  readonly resource: string;
  readonly name: string;
  readonly color: string;
  readonly rate: string;
}
import { formatText, type BuildingDef, type SimConfig } from '@game/core';
import type { WebContent } from '../content.js';
import { effectText, neededResources } from '../shop/effect-text.js';
import { buildingRate, formatHundredths } from './rates.js';
import { batchTotals, inputRates, outputRate } from './refining.js';
import { screenText, screenTexts, type ScreenTexts } from './texts.js';

export interface CardStats {
  readonly uses: string | null;
  readonly makes: string | null;
  readonly notes: readonly string[];
  /** Per-resource figures; only for a building with two inputs or an output. */
  readonly io: {
    readonly inputs: readonly IoFigure[];
    readonly output: IoFigure | null;
  } | null;
  readonly collects: string | null;
  readonly effect: string;
  readonly health: string;
}

export function cardStats(
  content: Pick<WebContent, 'resources' | 'presentation'> &
    Partial<Pick<WebContent, 'units'>>,
  sim: Pick<SimConfig, 'ticksPerSecond'>,
  def: BuildingDef,
  tier: number,
  texts: ScreenTexts = screenTexts,
): CardStats {
  const rate = buildingRate(def, tier, sim.ticksPerSecond);
  const ids = neededResources(def);
  const name = (id: string): string => formatText(`{${id}}`, content.resources);
  const figure = (resource: string, hundredths: number): IoFigure => ({
    resource,
    name: name(resource),
    color: content.resources.get(resource)?.color ?? '',
    rate: formatHundredths(hundredths),
  });
  const ins = inputRates(def, tier, sim.ticksPerSecond).map((r) =>
    figure(r.resource, r.hundredths),
  );
  const out = outputRate(def, tier, sim.ticksPerSecond);
  const output = out === null ? null : figure(out.resource, out.hundredths);
  const part = (f: IoFigure): string =>
    screenText(texts, 'ioPart', { resource: f.name, rate: f.rate });
  let uses: string | null = null;
  if (ins.length === 2) {
    // Two inputs at once: each resource has its own need per second.
    uses = screenText(texts, 'usesTwo', {
      first: part(ins[0] as IoFigure),
      second: part(ins[1] as IoFigure),
    });
  } else if (rate.needs !== null && ids.length > 0) {
    uses = screenText(texts, 'usesRate', {
      resource: ids
        .map((id) => formatText(`{${id}}`, content.resources))
        .join(', '),
      rate: formatHundredths(rate.needs),
    });
  } else if (
    def.kind === 'route' ||
    (def.kind === 'refinery' && def.resourceSetting === true)
  ) {
    // A route carries, and a Transmuter takes, any resource.
    uses = screenText(texts, 'uiShopUses', {
      needs: content.presentation.templates.needs.any,
    });
  }
  const health = def.tiers[tier - 1]?.health;
  const notes: string[] = [];
  const totals = batchTotals(def, tier);
  if (totals !== null && ins.length === 2 && output !== null) {
    notes.push(
      screenText(texts, 'refineryNote', {
        first: (ins[0] as IoFigure).name,
        second: (ins[1] as IoFigure).name,
        output: output.name,
        total: String(totals.taken),
        count: String(totals.made),
      }),
    );
  }
  const trained =
    def.kind === 'unit_producer' ? content.units?.get(def.unit) : undefined;
  if (trained !== undefined) {
    const unit = content.presentation.get(trained.id)?.name ?? trained.id;
    if (trained.armor > 0) {
      notes.push(
        screenText(texts, 'armorNote', { armor: String(trained.armor), unit }),
      );
    }
    if (trained.splash !== undefined) {
      notes.push(
        screenText(texts, 'splashNote', {
          percent: String(trained.splash.percent),
        }),
      );
    }
  }
  return {
    uses,
    makes:
      output === null
        ? null
        : screenText(texts, 'makesRate', {
            resource: output.name,
            rate: output.rate,
          }),
    notes,
    io: ins.length === 2 || output !== null ? { inputs: ins, output } : null,
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
