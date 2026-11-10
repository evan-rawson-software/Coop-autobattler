/**
 * Presentation text for one language: a display name and a short description
 * per building, unit, and terrain feature. Rules never live here. Descriptions
 * may mention a resource as `{res_x}` (see `formatText`).
 */

import { sortedKeys } from './hash.js';
import type { BuildingConfig } from './buildings.js';
import {
  isRecord,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';
import type { ResourceConfig } from './resources.js';
import { placeholderIds } from './text.js';
import type { TerrainConfig } from './terrain.js';
import type { UnitConfig } from './units.js';

export interface PresentationEntry {
  readonly name: string;
  /** May contain `{res_x}` placeholders; pass it through `formatText`. */
  readonly description: string;
}

export interface PresentationConfig {
  /** Entry for a building, unit, or terrain ID; undefined if unknown. */
  get(id: string): PresentationEntry | undefined;
}

export interface PresentationLoadContext {
  readonly buildings: BuildingConfig;
  readonly units: UnitConfig;
  readonly terrain: TerrainConfig;
  /** When given, `{res_x}` placeholders are checked against it. */
  readonly resources?: ResourceConfig;
}

export type PresentationLoadResult = LoadResult<PresentationConfig>;

const GROUPS = ['buildings', 'units', 'terrain'] as const;
const SINGULAR = {
  buildings: 'building',
  units: 'unit',
  terrain: 'terrain feature',
} as const;
const ENTRY_KEYS = new Set(['name', 'description']);

/**
 * Validate parsed presentation data. Every building, unit, and terrain
 * feature must have exactly one entry, and no entry may name anything else.
 */
export function loadPresentation(
  data: unknown,
  context: PresentationLoadContext,
): PresentationLoadResult {
  if (!isRecord(data)) {
    return {
      ok: false,
      errors: [
        'Presentation file must be an object with "buildings", "units", and "terrain".',
      ],
    };
  }
  const errors: string[] = [];
  rejectUnknownKeys(
    data,
    new Set<string>([...GROUPS, '$schema']),
    'presentation',
    errors,
  );
  const expected: Record<(typeof GROUPS)[number], readonly string[]> = {
    buildings: context.buildings.list().map((d) => d.id),
    units: context.units.list().map((d) => d.id),
    terrain: context.terrain.list().map((d) => d.id),
  };
  const entries = new Map<string, PresentationEntry>();

  for (const group of GROUPS) {
    const raw = data[group];
    if (!isRecord(raw)) {
      errors.push(`presentation: "${group}" must be an object keyed by ID.`);
      continue;
    }
    for (const id of expected[group]) {
      if (!(id in raw)) {
        errors.push(`presentation.${group}: missing entry for "${id}".`);
      }
    }
    for (const id of sortedKeys(raw)) {
      const value = raw[id];
      const at = `presentation.${group}["${id}"]`;
      if (!expected[group].includes(id)) {
        errors.push(`${at}: not a defined ${SINGULAR[group]} ID.`);
        continue;
      }
      if (!isRecord(value)) {
        errors.push(`${at}: must be an object with "name" and "description".`);
        continue;
      }
      rejectUnknownKeys(value, ENTRY_KEYS, at, errors);
      const { name, description } = value;
      let usable = true;
      if (typeof name !== 'string' || name.trim() === '') {
        errors.push(`${at}: missing or empty "name".`);
        usable = false;
      }
      if (typeof description !== 'string' || description.trim() === '') {
        errors.push(`${at}: missing or empty "description".`);
        usable = false;
      }
      if (
        usable &&
        typeof name === 'string' &&
        typeof description === 'string'
      ) {
        if (context.resources) {
          for (const ref of [
            ...placeholderIds(name),
            ...placeholderIds(description),
          ]) {
            if (context.resources.get(ref) === undefined) {
              errors.push(
                `${at}: placeholder {${ref}} is not a known resource.`,
              );
            }
          }
        }
        entries.set(id, { name, description });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { get: (id) => entries.get(id) } };
}

/** Like loadPresentation, but throws one Error listing every problem. */
export function loadPresentationOrThrow(
  data: unknown,
  context: PresentationLoadContext,
): PresentationConfig {
  return unwrapOrThrow('presentation text', loadPresentation(data, context));
}
