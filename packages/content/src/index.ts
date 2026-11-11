/**
 * The raw parsed content files from `content/`. Pass these to the matching
 * loader in `@game/core`. They are `unknown` on purpose, so nothing uses them
 * without validation.
 */
import resourcesJson from '../../../content/resources.json';
import terrainJson from '../../../content/terrain.json';
import unitsJson from '../../../content/units.json';
import buildingsJson from '../../../content/buildings.json';
import mapgenJson from '../../../content/mapgen.json';
import simJson from '../../../content/sim.json';
import economyJson from '../../../content/economy.json';
import eventsJson from '../../../content/events.json';
import threatsJson from '../../../content/threats.json';
import presentationEnJson from '../../../content/presentation.en.json';

export const rawResources: unknown = resourcesJson;
export const rawTerrain: unknown = terrainJson;
export const rawUnits: unknown = unitsJson;
export const rawBuildings: unknown = buildingsJson;
export const rawPresentationEn: unknown = presentationEnJson;
export const rawMapgen: unknown = mapgenJson;
export const rawSim: unknown = simJson;
export const rawEconomy: unknown = economyJson;
export const rawEvents: unknown = eventsJson;
export const rawThreats: unknown = threatsJson;
