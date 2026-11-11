/** Configuration the battle screen needs beyond `content.ts`. */

import {
  loadThreatsOrThrow,
  type BattleConfig,
  type ThreatsConfig,
} from '@game/core';
import { rawThreats } from '@game/content';
import { simConfig } from '../build/setup.js';
import { content } from '../content.js';

export const threatsConfig: ThreatsConfig = loadThreatsOrThrow(rawThreats, {
  units: content.units,
  buildings: content.buildings,
});

/** The configuration every battle of the web app runs with. */
export const battleConfig: BattleConfig = {
  sim: simConfig,
  mapgen: content.mapgen,
};
