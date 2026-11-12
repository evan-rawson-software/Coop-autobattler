/**
 * One-line effect text for a building tier, generated from the building's
 * rules data (`content/buildings.json`) and the templates in
 * `content/presentation.en.json`. Nothing is written per building: a new
 * building of an existing kind gets its text with no change here.
 *
 * Templates use `{name}` slots filled from the rules numbers, and `{res_x}`
 * for resources, which `formatText` replaces with the configured display
 * name (TA-27a). Neither sentences nor resource names appear in this file.
 */
import { formatText, type BuildingDef, type SimConfig } from '@game/core';
import type { WebContent } from '../content.js';

/** A key of `templates.effects` in the presentation file. */
export type EffectTemplateKey = string;

/** Human label for a building kind (the card's second line). */
export function kindLabel(
  content: Pick<WebContent, 'presentation'>,
  kind: string,
): string {
  return content.presentation.templates.kinds[kind] ?? kind;
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (whole, key: string) =>
    key in values ? (values[key] as string) : whole,
  );
}

const num = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

/** Distinct resource IDs a building takes in, in input order. */
export function neededResources(def: BuildingDef): string[] {
  const out: string[] = [];
  for (const i of def.inputs) {
    if (i.resource !== undefined && !out.includes(i.resource)) {
      out.push(i.resource);
    }
  }
  return out;
}

/** The `Needs:` text, with resource display names from configuration. */
export function needsText(
  def: BuildingDef,
  content: Pick<WebContent, 'resources' | 'presentation'>,
): string {
  const ids = neededResources(def);
  if (ids.length > 0) {
    return ids.map((id) => formatText(`{${id}}`, content.resources)).join(', ');
  }
  const needs = content.presentation.templates.needs;
  return def.kind === 'route' ? needs.any : needs.nothing;
}

/** The template key for a building. */
export function templateKey(def: BuildingDef): EffectTemplateKey {
  switch (def.kind) {
    case 'source':
      return 'source';
    case 'route':
      return def.routeType;
    case 'unit_producer':
      return 'unit_producer';
    case 'defense':
      return def.defenseType;
    case 'economy':
      return def.effect.type;
    case 'core':
      return 'core';
  }
}

/**
 * The effect line for `tier` (1 to 3) of a building. Returns '' for an
 * unknown tier.
 */
export function effectText(
  content: Pick<WebContent, 'resources' | 'presentation'>,
  sim: Pick<SimConfig, 'ticksPerSecond'>,
  def: BuildingDef,
  tier: number,
): string {
  const t = def.tiers[tier - 1];
  if (t === undefined) return '';
  const seconds = (ticks: number): string => num(ticks / sim.ticksPerSecond);
  const values: Record<string, string> = {
    health: String(t.health),
    outs: String(def.outputs.length),
    ins: String(def.inputs.length),
  };
  const res = neededResources(def)[0];
  if (res !== undefined) values['resource'] = `{${res}}`;
  switch (def.kind) {
    case 'source': {
      const x = def.tiers[tier - 1];
      if (x !== undefined) values['seconds'] = seconds(x.intervalTicks);
      break;
    }
    case 'unit_producer': {
      const x = def.tiers[tier - 1];
      if (x !== undefined) values['cost'] = String(x.costPerUnit);
      values['unit'] = content.presentation.get(def.unit)?.name ?? def.unit;
      break;
    }
    case 'defense': {
      if (def.defenseType === 'turret') {
        const x = def.tiers[tier - 1];
        if (x !== undefined) {
          values['damage'] = String(x.damage);
          values['range'] = String(x.rangeCells);
          values['seconds'] = seconds(x.cooldownTicks);
          values['cost'] = String(x.costPerShot);
        }
      }
      break;
    }
    case 'economy': {
      const x = def.tiers[tier - 1];
      if (x !== undefined) {
        values['step'] = String(x.stepPercent);
        values['cost'] = String(x.costPerStep);
        values['max'] = String(x.stepPercent * x.maxSteps);
      }
      break;
    }
    default:
      break;
  }
  return formatText(
    fill(
      content.presentation.templates.effects[templateKey(def)] ?? '',
      values,
    ),
    content.resources,
  );
}
