/** Load every content file in dependency order into one typed object. */

import type { BuildingConfig } from './buildings.js';
import { loadBuildings } from './buildings.js';
import { unwrapOrThrow } from './load-util.js';
import type { PresentationConfig } from './presentation.js';
import { loadPresentation } from './presentation.js';
import type { ResourceConfig } from './resources.js';
import { loadResources } from './resources.js';
import type { TerrainConfig } from './terrain.js';
import { loadTerrain } from './terrain.js';
import type { UnitConfig } from './units.js';
import { loadUnits } from './units.js';

/** The raw parsed content files, one per loader. */
export interface RawContent {
  readonly resources: unknown;
  readonly terrain: unknown;
  readonly units: unknown;
  readonly buildings: unknown;
  readonly presentation: unknown;
}

export interface Content {
  readonly resources: ResourceConfig;
  readonly terrain: TerrainConfig;
  readonly units: UnitConfig;
  readonly buildings: BuildingConfig;
  readonly presentation: PresentationConfig;
}

export type ContentLoadResult =
  | { readonly ok: true; readonly content: Content }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Load all content: resources, then terrain and units, then buildings, then
 * presentation. A file that fails stops the files that depend on it, so the
 * errors come from the first broken layer(s), each prefixed with its file.
 */
export function loadAllContent(raw: RawContent): ContentLoadResult {
  const errors: string[] = [];
  const prefixed = (file: string, list: readonly string[]): void => {
    for (const message of list) errors.push(`${file}: ${message}`);
  };

  const resources = loadResources(raw.resources);
  if (!resources.ok) prefixed('resources', resources.errors);
  const terrain = loadTerrain(raw.terrain);
  if (!terrain.ok) prefixed('terrain', terrain.errors);
  const units = loadUnits(raw.units);
  if (!units.ok) prefixed('units', units.errors);

  if (!resources.ok || !terrain.ok || !units.ok) return { ok: false, errors };

  const buildings = loadBuildings(raw.buildings, {
    resources: resources.config,
    units: units.config,
  });
  if (!buildings.ok) {
    prefixed('buildings', buildings.errors);
    return { ok: false, errors };
  }

  const presentation = loadPresentation(raw.presentation, {
    buildings: buildings.config,
    units: units.config,
    terrain: terrain.config,
    resources: resources.config,
  });
  if (!presentation.ok) {
    prefixed('presentation', presentation.errors);
    return { ok: false, errors };
  }

  return {
    ok: true,
    content: {
      resources: resources.config,
      terrain: terrain.config,
      units: units.config,
      buildings: buildings.config,
      presentation: presentation.config,
    },
  };
}

/** Like loadAllContent, but throws one Error listing every problem. */
export function loadAllContentOrThrow(raw: RawContent): Content {
  const result = loadAllContent(raw);
  return unwrapOrThrow(
    'content',
    result.ok
      ? { ok: true, config: result.content }
      : { ok: false, errors: result.errors },
  );
}
