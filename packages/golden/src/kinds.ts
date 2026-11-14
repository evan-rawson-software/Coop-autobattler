/**
 * The registry of golden-vector kinds: `kind` -> a deterministic function from
 * plain JSON input to a plain JSON result (and optionally an event log). Each
 * kind is an adapter in `./kinds/` over the rules in `@game/core` and
 * `@game/session`; the content-dependent ones are built here from
 * `@game/content`. To add a kind, add one entry.
 */
import {
  loadAllContentOrThrow,
  loadEconomyOrThrow,
  loadEventsOrThrow,
  loadMapgenOrThrow,
  loadSimConfigOrThrow,
  loadThreatsOrThrow,
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
import { makeArenaSimKind } from './kinds/arena-sim.js';
import { makeBattleKind } from './kinds/battle.js';
import { makeEnemyPathsKind } from './kinds/enemy-paths.js';
import { makeFlowSimKind } from './kinds/flow-sim.js';
import { makeMapGenKind } from './kinds/map-gen.js';
import { makeNeutralZoneKind } from './kinds/neutral-zone.js';
import { prngKinds, type SimulationFn } from './kinds/prng.js';
import {
  makeFlowGraphKind,
  makeTeamStateOpsKind,
} from './kinds/team-state-ops.js';
import { makePveBattleKind, makeThreatGenKind } from './kinds/threat.js';
import { makeRunReplayKind, makeShopRollKind } from './run-kinds.js';

export const content = loadAllContentOrThrow({
  resources: rawResources,
  terrain: rawTerrain,
  units: rawUnits,
  buildings: rawBuildings,
  presentation: rawPresentationEn,
});
export const mapgen = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });
export const simConfig = loadSimConfigOrThrow(rawSim);
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
  ...prngKinds,
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
