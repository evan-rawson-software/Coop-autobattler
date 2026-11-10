/**
 * The golden kinds that need the repository's real content. `core` cannot read
 * files, so the kinds are built here from `@game/content` and added to the
 * pure kinds registered in `core`.
 */
import {
  goldenKinds as coreKinds,
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  loadSimConfigOrThrow,
  makeArenaSimKind,
  makeBattleKind,
  makeNeutralZoneKind,
  makeEnemyPathsKind,
  makeFlowSimKind,
  makeFlowGraphKind,
  makeMapGenKind,
  makeTeamStateOpsKind,
  type SimulationFn,
} from '@game/core';
import {
  rawBuildings,
  rawMapgen,
  rawPresentationEn,
  rawResources,
  rawSim,
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
const simConfig = loadSimConfigOrThrow(rawSim);

/** Every golden kind: those in `core` plus the content-dependent ones. */
export const goldenKinds: Readonly<Record<string, SimulationFn>> = {
  ...coreKinds,
  'map-gen': makeMapGenKind(content, mapgen),
  'team-state-ops': makeTeamStateOpsKind(content, mapgen),
  'flow-graph': makeFlowGraphKind(content, mapgen),
  'flow-sim': makeFlowSimKind(content, mapgen, simConfig),
  'arena-sim': makeArenaSimKind(content, mapgen, simConfig),
  'enemy-paths': makeEnemyPathsKind(content, mapgen, simConfig),
  'neutral-zone': makeNeutralZoneKind(content, mapgen),
  battle: makeBattleKind(content, mapgen, simConfig),
};
