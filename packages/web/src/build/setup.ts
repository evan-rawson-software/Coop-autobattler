/** Content and configuration the Build and Shop screens need beyond `content.ts`. */

import {
  loadEconomyOrThrow,
  loadEventsOrThrow,
  loadSimConfigOrThrow,
  loadThreatsOrThrow,
  type EconomyConfig,
  type SimConfig,
} from '@game/core';
import type { GameConfigs } from '@game/session';
import { rawEconomy, rawEvents, rawSim, rawThreats } from '@game/content';
import { content } from '../content.js';

export const simConfig: SimConfig = loadSimConfigOrThrow(rawSim);

export const economy: EconomyConfig = loadEconomyOrThrow(rawEconomy, {
  buildings: content.buildings,
});

/** Everything `createGameDeps` needs besides the content. */
export const gameConfigs: GameConfigs = {
  mapgen: content.mapgen,
  economy,
  events: loadEventsOrThrow(rawEvents),
  threats: loadThreatsOrThrow(rawThreats, {
    units: content.units,
    buildings: content.buildings,
  }),
  sim: simConfig,
};

/** Seed of the first dev run. */
export const DEFAULT_SEED = 7;
