/**
 * The golden kinds that need the repository's real content. `core` cannot read
 * files, so the kinds are built here from `@game/content` and added to the
 * pure kinds registered in `core`.
 */
import {
  goldenKinds as coreKinds,
  loadAllContentOrThrow,
  loadEconomyOrThrow,
  loadEventsOrThrow,
  loadMapgenOrThrow,
  loadSimConfigOrThrow,
  loadThreatsOrThrow,
  makeArenaSimKind,
  makeBattleKind,
  makeNeutralZoneKind,
  makePveBattleKind,
  makeThreatGenKind,
  makeEnemyPathsKind,
  makeFlowSimKind,
  makeFlowGraphKind,
  makeMapGenKind,
  makeTeamStateOpsKind,
  type SimulationFn,
} from '@game/core';
import {
  rawBuildings,
  rawEconomy,
  rawEvents,
  rawMapgen,
  rawPresentationEn,
  rawResources,
  rawSim,
  rawTerrain,
  rawThreats,
  rawUnits,
} from '@game/content';
import { makeRunReplayKind, makeShopRollKind } from './run-kinds.js';

const content = loadAllContentOrThrow({
  resources: rawResources,
  terrain: rawTerrain,
  units: rawUnits,
  buildings: rawBuildings,
  presentation: rawPresentationEn,
});
const mapgen = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });
const simConfig = loadSimConfigOrThrow(rawSim);
const threats = loadThreatsOrThrow(rawThreats, {
  units: content.units,
  buildings: content.buildings,
});

const gameConfigs = {
  mapgen,
  economy: loadEconomyOrThrow(rawEconomy, { buildings: content.buildings }),
  events: loadEventsOrThrow(rawEvents),
  threats,
  sim: simConfig,
};

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
  'threat-gen': makeThreatGenKind(content, mapgen, threats),
  'pve-battle': makePveBattleKind(content, mapgen, simConfig, threats),
  'shop-roll': makeShopRollKind(content, gameConfigs),
  'run-replay': makeRunReplayKind(content, gameConfigs),
};
