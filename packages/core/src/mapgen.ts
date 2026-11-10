/** Map generation parameters (W1-1): loaded from content/mapgen.json. */

import {
  isRecord,
  readInt,
  rejectUnknownKeys,
  show,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';
import type { TerrainConfig, TerrainFeatureId } from './terrain.js';

export interface MapgenLakes {
  readonly feature: TerrainFeatureId;
  readonly countMin: number;
  readonly countMax: number;
  readonly sizeMin: number;
  readonly sizeMax: number;
}

export interface MapgenCliffs {
  readonly feature: TerrainFeatureId;
  readonly countMin: number;
  readonly countMax: number;
  readonly lengthMin: number;
  readonly lengthMax: number;
}

export interface MapgenConfig {
  readonly plotWidth: number;
  readonly plotDepth: number;
  readonly maxPartySize: number;
  /** Resource nodes per plot, for each base resource of that rarity. */
  readonly nodesPerPlot: { readonly common: number; readonly rare: number };
  readonly lakes: MapgenLakes;
  readonly cliffs: MapgenCliffs;
  /** Minimum share of a plot's cells that must be buildable, in percent. */
  readonly minBuildablePercent: number;
  /** Rows at the back of the board kept free of features. */
  readonly backMargin: number;
  /** Rows at the front of the board kept free of features (at least 1). */
  readonly frontMargin: number;
  /** Columns at each side edge of the board kept free of features. */
  readonly sideMargin: number;
  /** A Core footprint must satisfy `y + footprintHeight <= height - this`. */
  readonly coreFrontClearance: number;
  /** Tries per lake or cliff before the whole attempt is abandoned. */
  readonly placementTries: number;
  readonly maxAttempts: number;
}

export interface MapgenLoadContext {
  readonly terrain: TerrainConfig;
}

export type MapgenLoadResult = LoadResult<MapgenConfig>;

const TOP_KEYS = new Set([
  '$schema',
  'plotWidth',
  'plotDepth',
  'maxPartySize',
  'nodesPerPlot',
  'lakes',
  'cliffs',
  'minBuildablePercent',
  'backMargin',
  'frontMargin',
  'sideMargin',
  'coreFrontClearance',
  'placementTries',
  'maxAttempts',
]);

function section(
  data: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  errors: string[],
): Record<string, unknown> | undefined {
  const value = data[key];
  if (!isRecord(value)) {
    errors.push(`"${key}" must be an object.`);
    return undefined;
  }
  rejectUnknownKeys(value, new Set(allowed), `"${key}"`, errors);
  return value;
}

function readFeature(
  rec: Record<string, unknown>,
  label: string,
  terrain: TerrainConfig,
  errors: string[],
): string | undefined {
  const feature = rec['feature'];
  if (typeof feature !== 'string' || terrain.get(feature) === undefined) {
    errors.push(
      `${label}: "feature" must be a known terrain feature ID (got ${show(feature)}).`,
    );
    return undefined;
  }
  return feature;
}

/** Validate parsed map generation data (the contents of mapgen.json). */
export function loadMapgen(
  data: unknown,
  context: MapgenLoadContext,
): MapgenLoadResult {
  if (!isRecord(data)) {
    return { ok: false, errors: ['Mapgen file must be an object.'] };
  }
  const errors: string[] = [];
  rejectUnknownKeys(data, TOP_KEYS, 'mapgen', errors);
  const int = (key: string, min: number): number | undefined =>
    readInt(data, key, min, 'mapgen', errors);
  const plotWidth = int('plotWidth', 1);
  const plotDepth = int('plotDepth', 1);
  const maxPartySize = int('maxPartySize', 1);
  const minBuildablePercent = int('minBuildablePercent', 0);
  const backMargin = int('backMargin', 0);
  const frontMargin = int('frontMargin', 1);
  const sideMargin = int('sideMargin', 1);
  const coreFrontClearance = int('coreFrontClearance', 0);
  const placementTries = int('placementTries', 1);
  const maxAttempts = int('maxAttempts', 1);
  if (minBuildablePercent !== undefined && minBuildablePercent > 100) {
    errors.push('mapgen: "minBuildablePercent" must be at most 100.');
  }

  const nodesRec = section(data, 'nodesPerPlot', ['common', 'rare'], errors);
  const nodeCommon =
    nodesRec && readInt(nodesRec, 'common', 0, 'nodesPerPlot', errors);
  const nodeRare =
    nodesRec && readInt(nodesRec, 'rare', 0, 'nodesPerPlot', errors);

  const lakesRec = section(
    data,
    'lakes',
    ['feature', 'countMin', 'countMax', 'sizeMin', 'sizeMax'],
    errors,
  );
  let lakes: MapgenLakes | undefined;
  if (lakesRec) {
    const feature = readFeature(lakesRec, 'lakes', context.terrain, errors);
    const countMin = readInt(lakesRec, 'countMin', 0, 'lakes', errors);
    const countMax = readInt(lakesRec, 'countMax', 0, 'lakes', errors);
    const sizeMin = readInt(lakesRec, 'sizeMin', 1, 'lakes', errors);
    const sizeMax = readInt(lakesRec, 'sizeMax', 1, 'lakes', errors);
    if (countMin !== undefined && countMax !== undefined && countMax < countMin)
      errors.push('lakes: "countMax" must be at least "countMin".');
    if (sizeMin !== undefined && sizeMax !== undefined && sizeMax < sizeMin)
      errors.push('lakes: "sizeMax" must be at least "sizeMin".');
    if (
      feature !== undefined &&
      countMin !== undefined &&
      countMax !== undefined &&
      sizeMin !== undefined &&
      sizeMax !== undefined
    ) {
      lakes = { feature, countMin, countMax, sizeMin, sizeMax };
    }
  }

  const cliffsRec = section(
    data,
    'cliffs',
    ['feature', 'countMin', 'countMax', 'lengthMin', 'lengthMax'],
    errors,
  );
  let cliffs: MapgenCliffs | undefined;
  if (cliffsRec) {
    const feature = readFeature(cliffsRec, 'cliffs', context.terrain, errors);
    const countMin = readInt(cliffsRec, 'countMin', 0, 'cliffs', errors);
    const countMax = readInt(cliffsRec, 'countMax', 0, 'cliffs', errors);
    const lengthMin = readInt(cliffsRec, 'lengthMin', 2, 'cliffs', errors);
    const lengthMax = readInt(cliffsRec, 'lengthMax', 2, 'cliffs', errors);
    if (countMin !== undefined && countMax !== undefined && countMax < countMin)
      errors.push('cliffs: "countMax" must be at least "countMin".');
    if (
      lengthMin !== undefined &&
      lengthMax !== undefined &&
      lengthMax < lengthMin
    )
      errors.push('cliffs: "lengthMax" must be at least "lengthMin".');
    if (
      feature !== undefined &&
      countMin !== undefined &&
      countMax !== undefined &&
      lengthMin !== undefined &&
      lengthMax !== undefined
    ) {
      cliffs = { feature, countMin, countMax, lengthMin, lengthMax };
    }
  }

  if (plotDepth !== undefined) {
    if (
      backMargin !== undefined &&
      frontMargin !== undefined &&
      plotDepth - backMargin - frontMargin < 1
    )
      errors.push('mapgen: "backMargin" + "frontMargin" leave no room.');
    if (coreFrontClearance !== undefined && coreFrontClearance >= plotDepth)
      errors.push(
        'mapgen: "coreFrontClearance" must be less than "plotDepth".',
      );
  }
  if (
    plotWidth !== undefined &&
    sideMargin !== undefined &&
    plotWidth - 2 * sideMargin < 1
  )
    errors.push('mapgen: "sideMargin" leaves no room.');

  if (
    errors.length > 0 ||
    plotWidth === undefined ||
    plotDepth === undefined ||
    maxPartySize === undefined ||
    minBuildablePercent === undefined ||
    backMargin === undefined ||
    frontMargin === undefined ||
    sideMargin === undefined ||
    coreFrontClearance === undefined ||
    placementTries === undefined ||
    maxAttempts === undefined ||
    typeof nodeCommon !== 'number' ||
    typeof nodeRare !== 'number' ||
    lakes === undefined ||
    cliffs === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    config: {
      plotWidth,
      plotDepth,
      maxPartySize,
      nodesPerPlot: { common: nodeCommon, rare: nodeRare },
      lakes,
      cliffs,
      minBuildablePercent,
      backMargin,
      frontMargin,
      sideMargin,
      coreFrontClearance,
      placementTries,
      maxAttempts,
    },
  };
}

/** Like loadMapgen, but throws one Error listing every problem. */
export function loadMapgenOrThrow(
  data: unknown,
  context: MapgenLoadContext,
): MapgenConfig {
  return unwrapOrThrow(
    'map generation configuration',
    loadMapgen(data, context),
  );
}
