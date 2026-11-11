/**
 * The loaded content every command needs, built from `@game/content` and the
 * core loaders (the same way the golden runner does it).
 */
import {
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  loadSimConfigOrThrow,
  loadThreatsOrThrow,
  type ArenaContent,
  type MapgenConfig,
  type SimConfig,
  type ThreatsConfig,
} from '@game/core';
import {
  rawBuildings,
  rawMapgen,
  rawPresentationEn,
  rawResources,
  rawSim,
  rawTerrain,
  rawThreats,
  rawUnits,
} from '@game/content';

export interface SimContext {
  readonly content: ArenaContent;
  readonly mapgen: MapgenConfig;
  readonly sim: SimConfig;
  readonly threats: ThreatsConfig;
}

let cached: SimContext | undefined;

/** Load and cache the repository content. Throws if it does not load. */
export function loadSimContext(): SimContext {
  if (cached !== undefined) return cached;
  const content = loadAllContentOrThrow({
    resources: rawResources,
    terrain: rawTerrain,
    units: rawUnits,
    buildings: rawBuildings,
    presentation: rawPresentationEn,
  });
  const mapgen = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });
  const sim = loadSimConfigOrThrow(rawSim);
  const threats = loadThreatsOrThrow(rawThreats, {
    units: content.units,
    buildings: content.buildings,
  });
  cached = { content, mapgen, sim, threats };
  return cached;
}
