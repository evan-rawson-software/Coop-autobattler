/**
 * Shared scenarios for the in-battle ramp tests and the golden vectors (W1-7):
 * small boards on a 12 x 16 map built with the test `Lab`.
 */
import buildingsJson from '../../../../content/buildings.json';
import presentationJson from '../../../../content/presentation.en.json';
import resourcesJson from '../../../../content/resources.json';
import terrainJson from '../../../../content/terrain.json';
import unitsJson from '../../../../content/units.json';
import { loadAllContentOrThrow } from '../content.js';
import type { GameMap } from '../map.js';
import type { TeamState } from '../team-state.js';
import { Lab } from './support.js';

/** A 12 x 16 single-plot map with the given nodes. */
export function tinyMap(nodes: [number, number, string][] = []): GameMap {
  return {
    width: 12,
    height: 16,
    partySize: 1,
    plotWidth: 12,
    features: [],
    nodes: nodes.map(([x, y, resource]) => ({ x, y, resource })),
  };
}

/** A team with only a Core whose lowest cell is at `(x, y)`. */
export function coreOnlyTeam(x = 5, y = 6): TeamState {
  const lab = new Lab(tinyMap());
  lab.core(x, y);
  return lab.state;
}

/**
 * Content in which the overclocker takes `res_a` (like barracks) instead of
 * `res_c`, so that one source can feed either a barracks or an overclocker at
 * the same place, and the barracks has no top speed (interval 1), because the
 * crossover scenario is about supply rates, not about the cap of PP-6.
 * Everything else is the real content.
 */
export const overclockerOnOre = (() => {
  const buildings = (
    buildingsJson as unknown as {
      buildings: Record<string, unknown>[];
    }
  ).buildings.map((b) => {
    if (b['id'] === 'bld_barracks') {
      const tiers = (b['tiers'] as Record<string, unknown>[]).map((t) => ({
        ...t,
        productionIntervalTicks: 1,
      }));
      return { ...b, tiers };
    }
    return b['id'] === 'bld_overclocker'
      ? { ...b, inputs: [{ resource: 'res_a', side: 'south' }] }
      : b;
  });
  return loadAllContentOrThrow({
    resources: resourcesJson,
    terrain: terrainJson,
    units: unitsJson,
    buildings: { ...buildingsJson, buildings },
    presentation: presentationJson,
  });
})();

/**
 * The crossover boards (criterion 1). `barracks` barracks (3 by default) at x
 * = 0, 2, 4, ... (tier 1), each fed directly by a tier 1 extractor under it
 * on a `res_a` node; and an extra
 * tier 1 extractor at (10, 0) whose output goes north into a building at
 * (10, 1): a fourth barracks (`variant: 'barracks'`) or an overclocker of tier
 * 3 (`variant: 'overclocker'`), both fed directly.
 */
export function crossoverTeam(
  variant: 'barracks' | 'overclocker',
  barracks = 3,
): TeamState {
  const columns = Array.from({ length: barracks }, (_, i) => 2 * i);
  const lab = new Lab(
    tinyMap([...columns, 10].map((x) => [x, 0, 'res_a'])),
    overclockerOnOre,
  );
  lab.core(5, 6);
  for (const x of columns) {
    const s = lab.put('bld_extractor', x, 0);
    const b = lab.put('bld_barracks', x, 1);
    lab.link(s, 'north', b, 'south');
  }
  const extra = lab.put('bld_extractor', 10, 0);
  const sink =
    variant === 'barracks'
      ? lab.put('bld_barracks', 10, 1)
      : lab.put('bld_overclocker', 10, 1, 0, 3);
  lab.link(extra, 'north', sink, 'south');
  return lab.state;
}

/**
 * A tier 1 ore extractor feeding a barracks, and a tier 3 flux extractor that
 * feeds a tier 1 overclocker (`withOverclocker`) or has nothing to feed (its
 * items are then lost at once). Real content. Same as the golden vector
 * `arena-sim.ramp-overclocker-speeds-source`.
 */
export function overclockerSpeedTeam(withOverclocker: boolean): TeamState {
  const lab = new Lab(
    tinyMap([
      [0, 0, 'res_a'],
      [10, 0, 'res_c'],
    ]),
  );
  lab.core(5, 6);
  const ore = lab.put('bld_extractor', 0, 0);
  const b = lab.put('bld_barracks', 0, 1);
  lab.link(ore, 'north', b, 'south');
  const flux = lab.put('bld_extractor', 10, 0, 0, 3);
  if (withOverclocker) {
    const o = lab.put('bld_overclocker', 10, 1);
    lab.link(flux, 'north', o, 'south');
  }
  return lab.state;
}
