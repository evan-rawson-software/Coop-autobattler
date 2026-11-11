/** The loaded game content, parsed once at start-up. */

import {
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  type Content,
  type MapgenConfig,
} from '@game/core';
import {
  rawBuildings,
  rawMapgen,
  rawPresentationEn,
  rawResources,
  rawTerrain,
  rawUnits,
} from '@game/content';

export interface WebContent extends Content {
  readonly mapgen: MapgenConfig;
}

export function loadWebContent(): WebContent {
  const content = loadAllContentOrThrow({
    resources: rawResources,
    terrain: rawTerrain,
    units: rawUnits,
    buildings: rawBuildings,
    presentation: rawPresentationEn,
  });
  const mapgen = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });
  return { ...content, mapgen };
}

export const content: WebContent = loadWebContent();
