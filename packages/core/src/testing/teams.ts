/** Random but working teams for battle tests and benchmarks. */
import { addConduit } from '../conduits.js';
import { generateMap } from '../generate-map.js';
import { divFloor } from '../int.js';
import { Rng } from '../rng.js';
import {
  addToStash,
  createTeamState,
  occupancy,
  placeCore,
  placeFromStash,
  type TeamState,
} from '../team-state.js';
import {
  content,
  got,
  legalCoresAnyPlot,
  mapgen,
  outside,
  route,
} from './support.js';

/**
 * A random team: a generated board with the Core placed, and for every
 * resource node a source on it feeding (through a routed conduit) a consumer
 * chosen by the resource: unit producers and armories for `res_a`, turrets
 * near the front for `res_b`, overclockers for `res_c`, plus a few walls near
 * the front. Anything that cannot be placed or routed is simply left out.
 */
export function randomTeam(seed: number, partySize: number): TeamState {
  const m = generateMap(seed, partySize, content, mapgen);
  const rng = Rng.fromSeed(seed * 104729 + 17);
  let s = createTeamState(m);
  const cores = legalCoresAnyPlot(m);
  const at = cores[rng.nextInt(cores.length)];
  if (at !== undefined) {
    const c = placeCore(s, content, mapgen, at.player, at);
    if (c.ok) s = c.state;
  }
  const place = (
    def: string,
    tier: number,
    x: number,
    y: number,
  ): number | null => {
    const owner = divFloor(x, m.plotWidth);
    const a = addToStash(s, content, { def, tier, owner });
    if (!a.ok) return null;
    const p = placeFromStash(a.state, content, {
      actor: owner,
      id: a.id,
      x,
      y,
      rotation: 0,
    });
    if (!p.ok) return null;
    s = p.state;
    return a.id;
  };
  for (const n of m.nodes) {
    const src = place('bld_extractor', 1 + rng.nextInt(3), n.x, n.y);
    if (src === null) continue;
    let consumerDef = 'bld_barracks';
    if (n.resource === 'res_b') consumerDef = 'bld_turret';
    else if (n.resource === 'res_c') consumerDef = 'bld_overclocker';
    else if (rng.nextInt(4) === 0) consumerDef = 'bld_armory';
    let consumer: number | null = null;
    for (let tries = 0; tries < 40 && consumer === null; tries++) {
      // Same plot as its source: a conduit cannot leave the owner's plot.
      const x =
        divFloor(n.x, m.plotWidth) * m.plotWidth + rng.nextInt(m.plotWidth);
      const y =
        consumerDef === 'bld_turret'
          ? m.height - 5 + rng.nextInt(4)
          : rng.nextInt(m.height);
      consumer = place(consumerDef, 1 + rng.nextInt(3), x, y);
    }
    if (consumer === null) continue;
    const occ = occupancy(s, content);
    const a = got(s.buildings.find((b) => b.id === src));
    const b = got(s.buildings.find((p) => p.id === consumer));
    const used = new Set<number>();
    for (const c of s.conduits) {
      for (const k of c.cells) used.add(k.y * m.width + k.x);
    }
    const cells = route(
      s,
      outside(occ.cellsOf(a), 'north'),
      outside(occ.cellsOf(b), 'south'),
      occ,
      used,
    );
    const r = addConduit(s, content, {
      actor: a.owner,
      from: { building: src, side: 'north' },
      to: { building: consumer, side: 'south' },
      cells: cells ?? [],
    });
    if (r.ok) s = r.state;
  }
  for (let i = 0; i < 4; i++) {
    // A wall in a random plot.
    const wallPlot = m.partySize > 1 ? rng.nextInt(m.partySize) : 0;
    place(
      'bld_wall_block',
      1,
      wallPlot * m.plotWidth + rng.nextInt(m.plotWidth),
      m.height - 3 + rng.nextInt(2),
    );
  }
  // Battles need one Core per player: the first legal spot of each player
  // that has none yet (no random draw, so the rest of the team is unchanged).
  for (const spot of cores) {
    if (s.cores[spot.player] !== null) continue;
    const c = placeCore(s, content, mapgen, spot.player, spot);
    if (c.ok) s = c.state;
  }
  return s;
}
