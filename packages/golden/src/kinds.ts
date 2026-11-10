/**
 * The golden kinds that need the repository's real content. `core` cannot read
 * files, so the kinds are built here from `@game/content` and added to the
 * pure kinds registered in `core`.
 */
import {
  goldenKinds as coreKinds,
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  makeMapGenKind,
  makeTeamStateOpsKind,
  type SimulationFn,
} from '@game/core';
import {
  rawBuildings,
  rawMapgen,
  rawPresentationEn,
  rawResources,
  rawTerrain,
  rawUnits,
} from '@game/content';

const content = loadAllContentOrThrow({
  resources: rawResources,
  terrain: rawTerrain,
  units: rawUnits,
  buildings: rawBuildings,
  presentation: rawPresentationEn,
});
const mapgen = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });

/** Every golden kind: those in `core` plus the content-dependent ones. */
export const goldenKinds: Readonly<Record<string, SimulationFn>> = {
  ...coreKinds,
  'map-gen': makeMapGenKind(content, mapgen),
  'team-state-ops': makeTeamStateOpsKind(content, mapgen),
};
