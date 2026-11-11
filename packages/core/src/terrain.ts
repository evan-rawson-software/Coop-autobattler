/** Terrain rules (CB-6): which natural features block building and movement. */

import {
  isRecord,
  readBool,
  readId,
  readList,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';

export type TerrainFeatureId = string;

export interface TerrainFeatureDef {
  readonly id: TerrainFeatureId;
  readonly blocksBuilding: boolean;
  readonly blocksMovement: boolean;
}

export interface TerrainConfig {
  get(id: TerrainFeatureId): TerrainFeatureDef | undefined;
  /** Every feature, in file order. */
  list(): readonly TerrainFeatureDef[];
}

export type TerrainLoadResult = LoadResult<TerrainConfig>;

const ID_PATTERN = /^ter_[a-z0-9_]+$/;
const KNOWN_KEYS = new Set(['id', 'blocksBuilding', 'blocksMovement']);

/** Validate parsed terrain data (the contents of terrain.json). */
export function loadTerrain(data: unknown): TerrainLoadResult {
  const list = readList(data, 'features', 'Terrain');
  if ('error' in list) return { ok: false, errors: [list.error] };
  const errors: string[] = [];
  if (list.entries.length === 0) errors.push('"features" must not be empty.');

  const defs: TerrainFeatureDef[] = [];
  const seen = new Set<string>();
  list.entries.forEach((entry, index) => {
    const at = `features[${String(index)}]`;
    if (!isRecord(entry)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    const before = errors.length;
    const id = readId(entry, ID_PATTERN, at, errors);
    const label = id === undefined ? at : `${at} ("${id}")`;
    if (id !== undefined) {
      if (seen.has(id)) errors.push(`${label}: duplicate id "${id}".`);
      seen.add(id);
    }
    const blocksBuilding = readBool(entry, 'blocksBuilding', label, errors);
    const blocksMovement = readBool(entry, 'blocksMovement', label, errors);
    rejectUnknownKeys(entry, KNOWN_KEYS, label, errors);
    if (
      errors.length === before &&
      id !== undefined &&
      blocksBuilding !== undefined &&
      blocksMovement !== undefined
    ) {
      defs.push({ id, blocksBuilding, blocksMovement });
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  const byId = new Map(defs.map((d) => [d.id, d]));
  return { ok: true, config: { get: (id) => byId.get(id), list: () => defs } };
}

/** Like loadTerrain, but throws one Error listing every problem. */
export function loadTerrainOrThrow(data: unknown): TerrainConfig {
  return unwrapOrThrow('terrain configuration', loadTerrain(data));
}
