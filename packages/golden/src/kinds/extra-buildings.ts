/**
 * The optional `extraBuildings` input of the `flow-graph`, `flow-sim` and
 * `arena-sim` kinds: a list of building definitions in the format of
 * `content/buildings.json`, added to the content for that one run. A vector
 * uses it for a building the shipped content does not have yet, such as a
 * consumer of a refined resource (issue #381: no shipped building takes
 * Composite or Aether). An ID that already exists is an error.
 */
import {
  loadBuildingsOrThrow,
  type BuildingConfig,
  type Json,
  type MapContent,
  type UnitConfig,
} from '@game/core';

export function withExtraBuildings<
  C extends MapContent & { readonly units: UnitConfig },
>(shipped: C, extra: Json | undefined): C {
  if (extra === undefined) return shipped;
  if (!Array.isArray(extra)) {
    throw new TypeError('extraBuildings must be an array');
  }
  const added = loadBuildingsOrThrow(
    { buildings: extra },
    { resources: shipped.resources, units: shipped.units },
  ).list();
  for (const d of added) {
    if (shipped.buildings.get(d.id) !== undefined) {
      throw new TypeError(`extraBuildings: "${d.id}" already exists`);
    }
  }
  const all = [...shipped.buildings.list(), ...added];
  const byId = new Map(all.map((d) => [d.id, d]));
  const buildings: BuildingConfig = {
    get: (id) => byId.get(id),
    list: () => all,
  };
  return { ...shipped, buildings };
}
