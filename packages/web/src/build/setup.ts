/** Content and configuration the Build screen needs beyond `content.ts`. */

import {
  loadEconomyOrThrow,
  loadSimConfigOrThrow,
  type EconomyConfig,
  type SimConfig,
} from '@game/core';
import { rawEconomy, rawSim } from '@game/content';
import { content } from '../content.js';

export const simConfig: SimConfig = loadSimConfigOrThrow(rawSim);

export const economy: EconomyConfig = loadEconomyOrThrow(rawEconomy, {
  buildings: content.buildings,
});

/** Seed of the first dev run. */
export const DEFAULT_SEED = 7;
