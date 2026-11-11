import {
  loadBuildings,
  loadEconomy,
  loadEvents,
  loadMapgen,
  loadPresentation,
  loadSimConfig,
  loadResources,
  loadTerrain,
  loadThreats,
  loadUnits,
  type BuildingConfig,
  type EconomyConfig,
  type EventsConfig,
  type MapgenConfig,
  type PresentationConfig,
  type ResourceConfig,
  type SimConfig,
  type TerrainConfig,
  type ThreatsConfig,
  type UnitConfig,
} from '@game/core';

/** Content already loaded successfully, keyed by registry `key`. */
export interface LoadedContent {
  resources?: ResourceConfig;
  terrain?: TerrainConfig;
  units?: UnitConfig;
  buildings?: BuildingConfig;
  mapgen?: MapgenConfig;
  economy?: EconomyConfig;
  events?: EventsConfig;
  sim?: SimConfig;
  threats?: ThreatsConfig;
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
    key: 'mapgen',
    contentFile: 'mapgen.json',
    schemaFile: 'mapgen.schema.json',
    needs: ['terrain'],
    load: (data, loaded) =>
      wrap(loadMapgen(data, { terrain: need(loaded, 'terrain') })),
  },
  {
    key: 'sim',
    contentFile: 'sim.json',
    schemaFile: 'sim.schema.json',
    load: (data) => wrap(loadSimConfig(data)),
  },
  {
    key: 'economy',
    contentFile: 'economy.json',
    schemaFile: 'economy.schema.json',
    needs: ['buildings'],
    load: (data, loaded) =>
      wrap(loadEconomy(data, { buildings: need(loaded, 'buildings') })),
  },
  {
    key: 'events',
    contentFile: 'events.json',
    schemaFile: 'events.schema.json',
    load: (data) => wrap(loadEvents(data)),
  },
  {
    key: 'threats',
    contentFile: 'threats.json',
    schemaFile: 'threats.schema.json',
    needs: ['units', 'buildings'],
    load: (data, loaded) =>
      wrap(
        loadThreats(data, {
          units: need(loaded, 'units'),
          buildings: need(loaded, 'buildings'),
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
