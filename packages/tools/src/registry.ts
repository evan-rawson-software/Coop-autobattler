import {
  loadBuildings,
  loadPresentation,
  loadResources,
  loadTerrain,
  loadUnits,
  type BuildingConfig,
  type PresentationConfig,
  type ResourceConfig,
  type TerrainConfig,
  type UnitConfig,
} from '@game/core';

/** Content already loaded successfully, keyed by registry `key`. */
export interface LoadedContent {
  resources?: ResourceConfig;
  terrain?: TerrainConfig;
  units?: UnitConfig;
  buildings?: BuildingConfig;
  presentation?: PresentationConfig;
}

/** Outcome of running a core loader on parsed content. */
export type LoaderResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface ContentEntry {
  /** Where the loaded result is stored for later entries. */
  readonly key: keyof LoadedContent;
  /** Path relative to `content/`. */
  readonly contentFile: string;
  /** Path relative to `schemas/`. */
  readonly schemaFile: string;
  /** Entries that must load first; if one failed, the loader is skipped. */
  readonly needs?: readonly (keyof LoadedContent)[];
  /** Core loader; receives the parsed JSON and the content loaded so far. */
  readonly load: (data: unknown, loaded: LoadedContent) => LoaderResult;
}

function need<K extends keyof LoadedContent>(
  loaded: LoadedContent,
  key: K,
): NonNullable<LoadedContent[K]> {
  const value = loaded[key];
  if (value === undefined) throw new Error(`"${key}" was not loaded first.`);
  return value;
}

function wrap(
  result:
    | { readonly ok: true; readonly config: unknown }
    | { readonly ok: false; readonly errors: readonly string[] },
): LoaderResult {
  return result.ok ? { ok: true, value: result.config } : result;
}

/**
 * Register new content files here: one row per file, listed in dependency
 * order (resources, then terrain and units, then buildings, then presentation).
 */
export const contentRegistry: readonly ContentEntry[] = [
  {
    key: 'resources',
    contentFile: 'resources.json',
    schemaFile: 'resources.schema.json',
    load: (data) => wrap(loadResources(data)),
  },
  {
    key: 'terrain',
    contentFile: 'terrain.json',
    schemaFile: 'terrain.schema.json',
    load: (data) => wrap(loadTerrain(data)),
  },
  {
    key: 'units',
    contentFile: 'units.json',
    schemaFile: 'units.schema.json',
    load: (data) => wrap(loadUnits(data)),
  },
  {
    key: 'buildings',
    contentFile: 'buildings.json',
    schemaFile: 'buildings.schema.json',
    needs: ['resources', 'units'],
    load: (data, loaded) =>
      wrap(
        loadBuildings(data, {
          resources: need(loaded, 'resources'),
          units: need(loaded, 'units'),
        }),
      ),
  },
  {
    key: 'presentation',
    contentFile: 'presentation.en.json',
    schemaFile: 'presentation.schema.json',
    needs: ['resources', 'terrain', 'units', 'buildings'],
    load: (data, loaded) =>
      wrap(
        loadPresentation(data, {
          resources: need(loaded, 'resources'),
          terrain: need(loaded, 'terrain'),
          units: need(loaded, 'units'),
          buildings: need(loaded, 'buildings'),
        }),
      ),
  },
];
