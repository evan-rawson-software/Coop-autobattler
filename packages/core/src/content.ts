/** Load every content file in dependency order into one typed object. */

import type { BuildingConfig } from './buildings.js';
import { loadBuildings } from './buildings.js';
import { unwrapOrThrow } from './load-util.js';
import type { PointsConfig } from './points.js';
import { loadPoints } from './points.js';
import type { PresentationConfig } from './presentation.js';
import { loadPresentation } from './presentation.js';
import type { ResourceConfig } from './resources.js';
import type { SpecialistConfig } from './specialists.js';
import { loadSpecialists } from './specialists.js';
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
  readonly points: unknown;
  readonly specialists: unknown;
  readonly presentation: unknown;
}

export interface Content {
  readonly resources: ResourceConfig;
  readonly terrain: TerrainConfig;
  readonly units: UnitConfig;
  readonly buildings: BuildingConfig;
  readonly points: PointsConfig;
  readonly specialists: SpecialistConfig;
  readonly presentation: PresentationConfig;
}

export type ContentLoadResult =
  | { readonly ok: true; readonly content: Content }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Load all content: resources, then terrain and units, then buildings, then
 * presentation (points need the unit list, for their guards). A file that fails stops the files that depend on it, so the
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
  // Points check their guard units against the unit list; without a valid
  // unit list only their own shape is checked.
  const points = loadPoints(
    raw.points,
    units.ok ? { units: units.config } : {},
  );
  if (!points.ok) prefixed('points', points.errors);
  const specialists = loadSpecialists(raw.specialists);
  if (!specialists.ok) prefixed('specialists', specialists.errors);

  if (
    !resources.ok ||
    !terrain.ok ||
    !units.ok ||
    !points.ok ||
    !specialists.ok
  )
    return { ok: false, errors };

  const buildings = loadBuildings(raw.buildings, {
    resources: resources.config,
    units: units.config,
  });
  if (!buildings.ok) {
    prefixed('buildings', buildings.errors);
    return { ok: false, errors };
  }

  // A signature building is a building of the content (EC-3b).
  for (const sp of specialists.config.specialists) {
    if (buildings.config.get(sp.signature) === undefined) {
      errors.push(
        `specialists: "${sp.id}" names the signature building "${sp.signature}", which is not in buildings.`,
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const presentation = loadPresentation(raw.presentation, {
    buildings: buildings.config,
    units: units.config,
    terrain: terrain.config,
    resources: resources.config,
    specialistIds: specialists.config.ids(),
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
      points: points.config,
      specialists: specialists.config,
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
