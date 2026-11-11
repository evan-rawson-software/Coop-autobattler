/**
 * One-line effect text for a building tier, generated from the building's
 * rules data (`content/buildings.json`) and the templates below. Nothing is
 * written per building: a new building of an existing kind gets its text
 * with no change here.
 *
 * Templates use `{name}` slots filled from the rules numbers, and `{res_x}`
 * for resources, which `formatText` replaces with the configured display
 * name (TA-27a). Resource names never appear in this file.
 *
 * The templates live here because the presentation loader in `core` accepts
 * only names and descriptions. Moving them to `presentation.en.json` needs a
 * small change to that loader.
 */
import {
  formatText,
  type BuildingDef,
  type ResourceConfig,
  type SimConfig,
} from '@game/core';
import type { WebContent } from '../content.js';

export const EFFECT_TEMPLATES = {
  source: 'Mines its node: 1 every {seconds} s · {health} health',
  splitter: 'Splits one flow into {outs} outputs · {health} health',
  merger: 'Merges {ins} inputs into one flow · {health} health',
  crossover: 'Lets two flows cross without mixing · {health} health',
  unit_producer: 'Trains 1 {unit} per {cost} {resource} · {health} health',
  wall: 'Blocks movement · {health} health',
  gate: 'Blocks enemies, lets your units pass · {health} health',
  turret:
    'Fires {damage} damage up to {range} cells every {seconds} s, using {cost} {resource} per shot · {health} health',
  source_speed:
    '+{step}% source speed per {cost} {resource} supplied, up to +{max}% · {health} health',
  unit_strength:
    '+{step}% unit strength per {cost} {resource} supplied, up to +{max}% · {health} health',
  core: 'Your party’s health · {health} health',
} as const;

export type EffectTemplateKey = keyof typeof EFFECT_TEMPLATES;

/** Human labels for building kinds (the card's second line). */
export const KIND_LABELS = {
  source: 'Source',
  route: 'Route',
  unit_producer: 'Units',
  defense: 'Defense',
  economy: 'Economy',
  core: 'Core',
} as const;

export const NEEDS_TEMPLATES = {
  nothing: 'nothing',
  any: 'any resource',
} as const;

function fill(template: string, values: Record<string, string>): string {
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
export function needsText(def: BuildingDef, resources: ResourceConfig): string {
  const ids = neededResources(def);
  if (ids.length > 0) {
    return ids.map((id) => formatText(`{${id}}`, resources)).join(', ');
  }
  return def.kind === 'route' ? NEEDS_TEMPLATES.any : NEEDS_TEMPLATES.nothing;
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
    fill(EFFECT_TEMPLATES[templateKey(def)], values),
    content.resources,
  );
}
