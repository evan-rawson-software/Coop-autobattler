/**
 * The Mana Well and the resource setting of a building (issue #473, step 5/9
 * of #468): a collector that stands on any open cell of its owner's plot and
 * makes the base resource its owner chose; the setting is stored on the placed
 * building, changed between battles, and a change detaches the conduits.
 */
import { describe, expect, test } from 'vitest';
import { hasResourceSetting } from './buildings.js';
import { addConduit } from './conduits.js';
import {
  createBoardSim,
  createFlowContext,
  stepFlow,
  type SimEvent,
} from './flow-sim.js';
import {
  addToStash,
  moveBuilding,
  placeFromStash,
  returnToStash,
  setBuildingResource,
  validateTeamState,
  type TeamState,
} from './team-state.js';
import { hashJson } from './hash.js';
import {
  Lab,
  board,
  content,
  got,
  mapgen,
  simConfig,
} from './testing/support.js';

const WELL = 'bld_mana_well';

function stash(state: TeamState, def: string, tier = 1, owner = 0) {
  const r = addToStash(state, content, { def, tier, owner });
  if (!r.ok) throw new Error(r.reason);
  return { state: r.state, id: r.id };
}

const asJson = (s: TeamState): unknown => JSON.parse(JSON.stringify(s));

/** Items the building made in `ticks` ticks, by the flow simulation. */
function produced(state: TeamState, building: number, ticks: number): number {
  const events: SimEvent[] = [];
  const sim = createBoardSim(state, content, simConfig);
  const ctx = createFlowContext(state, content, simConfig, {
    consumers: 'drain',
    events,
  });
  for (let t = 0; t < ticks; t++) stepFlow(sim, ctx);
  return events.filter((e) => e.type === 'produced' && e.building === building)
    .length;
}

describe('the content', () => {
  test('the Mana Well is a 1x1 collector with the resource setting', () => {
    const def = got(content.buildings.get(WELL));
    expect(def.kind).toBe('source');
    expect(hasResourceSetting(def)).toBe(true);
    expect(def.footprint).toEqual({ width: 1, height: 1 });
    expect(def.outputs).toEqual(['north']);
    expect(
      hasResourceSetting(got(content.buildings.get('bld_extractor'))),
    ).toBe(false);
  });

  test('its rate is half the Extractor of the same tier (stated exception)', () => {
    const well = got(content.buildings.get(WELL));
    const ext = got(content.buildings.get('bld_extractor'));
    if (well.kind !== 'source' || ext.kind !== 'source')
      throw new Error('kind');
    for (let t = 0; t < 3; t++) {
      expect(got(well.tiers[t]).intervalTicks).toBe(
        2 * got(ext.tiers[t]).intervalTicks,
      );
    }
  });
});

describe('placement', () => {
  test('stands on an open cell with no node, in the owner plot', () => {
    const lab = new Lab(board([]));
    const id = lab.put(WELL, 4, 4, 0, 1, 'res_b');
    expect(lab.state.buildings.find((b) => b.id === id)?.resource).toBe(
      'res_b',
    );
  });

  test('may stand on a node and takes nothing from it', () => {
    const lab = new Lab(board([[4, 4, 'res_a']]));
    const id = lab.put(WELL, 4, 4, 0, 1, 'res_c');
    const cons = lab.put('bld_turret', 4, 7); // res_b input
    // Its output is the setting, not the node's resource.
    expect(() =>
      lab.link(id, 'north', cons, 'south', [
        [4, 5],
        [4, 6],
      ]),
    ).toThrow(/resource_mismatch/);
  });

  test('without a resource it takes the first base resource', () => {
    const lab = new Lab(board([]));
    const id = lab.put(WELL, 4, 4);
    expect(lab.state.buildings.find((b) => b.id === id)?.resource).toBe(
      'res_a',
    );
  });

  test('refuses a natural feature, another plot and a taken cell', () => {
    const map = {
      ...board([], 24, 2),
      features: [{ x: 3, y: 3, feature: 'ter_lake' }],
    };
    const lab = new Lab(map);
    const a = stash(lab.state, WELL);
    const at = (x: number, y: number, state = a.state) =>
      placeFromStash(state, content, {
        actor: 0,
        id: a.id,
        x,
        y,
        rotation: 0,
      });
    const lake = at(3, 3);
    expect(lake.ok ? 'ok' : lake.reason).toBe('blocked_by_feature');
    const other = at(14, 3);
    expect(other.ok ? 'ok' : other.reason).toBe('outside_own_plot');
    lab.put('bld_gate', 5, 5);
    const b = stash(lab.state, WELL);
    const taken = placeFromStash(b.state, content, {
      actor: 0,
      id: b.id,
      x: 5,
      y: 5,
      rotation: 0,
    });
    expect(taken.ok ? 'ok' : taken.reason).toBe('overlaps_building');
  });

  test('an ordinary building keeps its node rules (an Extractor needs a node)', () => {
    const lab = new Lab(board([]));
    const a = stash(lab.state, 'bld_extractor');
    const r = placeFromStash(a.state, content, {
      actor: 0,
      id: a.id,
      x: 4,
      y: 4,
      rotation: 0,
    });
    expect(r.ok ? 'ok' : r.reason).toBe('source_needs_node');
  });

  test('a resource must be a base resource, and only for a building with the setting', () => {
    const lab = new Lab(board([[2, 2, 'res_a']]));
    const w = stash(lab.state, WELL);
    for (const resource of ['res_ab_refined', 'res_nothing']) {
      const r = placeFromStash(w.state, content, {
        actor: 0,
        id: w.id,
        x: 4,
        y: 4,
        rotation: 0,
        resource,
      });
      expect(r.ok ? 'ok' : r.reason).toBe('invalid_resource');
    }
    const e = stash(lab.state, 'bld_extractor');
    const r = placeFromStash(e.state, content, {
      actor: 0,
      id: e.id,
      x: 2,
      y: 2,
      rotation: 0,
      resource: 'res_a',
    });
    expect(r.ok ? 'ok' : r.reason).toBe('invalid_resource');
  });

  test('a move keeps the setting; returning to the stash drops it', () => {
    const lab = new Lab(board([]));
    const id = lab.put(WELL, 4, 4, 0, 1, 'res_c');
    const moved = moveBuilding(lab.state, content, {
      actor: 0,
      id,
      x: 6,
      y: 6,
      rotation: 90,
    });
    if (!moved.ok) throw new Error(moved.reason);
    expect(moved.state.buildings[0]?.resource).toBe('res_c');
    const back = returnToStash(moved.state, content, { actor: 0, id });
    if (!back.ok) throw new Error(back.reason);
    expect(back.state.stash[0]).toEqual({ id, def: WELL, tier: 1, owner: 0 });
  });
});

describe('the setting changes', () => {
  function wired() {
    const lab = new Lab(board([]));
    const well = lab.put(WELL, 4, 4, 0, 1, 'res_a');
    const barracks = lab.put('bld_barracks', 4, 7);
    const conduit = lab.link(well, 'north', barracks, 'south', [
      [4, 5],
      [4, 6],
    ]);
    return { lab, well, barracks, conduit };
  }

  test('a different resource detaches the attached conduit', () => {
    const { lab, well } = wired();
    expect(lab.state.conduits).toHaveLength(1);
    const r = setBuildingResource(lab.state, content, {
      actor: 0,
      id: well,
      resource: 'res_b',
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.conduits).toHaveLength(0);
    expect(r.state.buildings.find((b) => b.id === well)?.resource).toBe(
      'res_b',
    );
    // The ids and counters stay as they are.
    expect(r.state.nextId).toBe(lab.state.nextId);
    expect(r.state.nextConduitId).toEqual(lab.state.nextConduitId);
  });

  test('the same resource changes nothing', () => {
    const { lab, well } = wired();
    const r = setBuildingResource(lab.state, content, {
      actor: 0,
      id: well,
      resource: 'res_a',
    });
    expect(r.ok && r.state).toBe(lab.state);
  });

  test('refusals, in order', () => {
    const { lab, well, barracks } = wired();
    const run = (args: { actor: number; id: number; resource: string }) => {
      const r = setBuildingResource(lab.state, content, args);
      return r.ok ? 'ok' : r.reason;
    };
    expect(run({ actor: 0, id: 999, resource: 'res_b' })).toBe(
      'unknown_building',
    );
    expect(run({ actor: 7, id: well, resource: 'res_b' })).toBe(
      'invalid_owner',
    );
    expect(run({ actor: 0, id: barracks, resource: 'res_b' })).toBe(
      'no_resource_setting',
    );
    expect(run({ actor: 0, id: well, resource: 'res_ab_refined' })).toBe(
      'invalid_resource',
    );
    const two = new Lab(board([], 24, 2));
    const other = two.put(WELL, 16, 4, 0, 1, 'res_a');
    const r = setBuildingResource(two.state, content, {
      actor: 0,
      id: other,
      resource: 'res_b',
    });
    expect(r.ok ? 'ok' : r.reason).toBe('not_owner');
  });

  test('the new setting can be wired to a consumer of that resource', () => {
    const { lab, well, barracks } = wired();
    const away = returnToStash(lab.state, content, {
      actor: 0,
      id: barracks,
    });
    if (!away.ok) throw new Error(away.reason);
    const r = setBuildingResource(away.state, content, {
      actor: 0,
      id: well,
      resource: 'res_b',
    });
    if (!r.ok) throw new Error(r.reason);
    const turret = stash(r.state, 'bld_turret');
    const placed = placeFromStash(turret.state, content, {
      actor: 0,
      id: turret.id,
      x: 4,
      y: 7,
      rotation: 0,
    });
    if (!placed.ok) throw new Error(placed.reason);
    const linked = addConduit(placed.state, content, {
      actor: 0,
      from: { building: well, side: 'north' },
      to: { building: turret.id, side: 'south' },
      cells: [
        { x: 4, y: 5 },
        { x: 4, y: 6 },
      ],
    });
    expect(linked.ok).toBe(true);
  });
});

describe('production', () => {
  test('a tier 1 Well makes an item every 40 ticks; an Extractor every 20', () => {
    const lab = new Lab(board([[8, 4, 'res_a']]));
    const well = lab.put(WELL, 4, 4, 0, 1, 'res_a');
    const ext = lab.put('bld_extractor', 8, 4);
    expect(produced(lab.state, well, 400)).toBe(10);
    expect(produced(lab.state, ext, 400)).toBe(20);
  });

  test('tiers 2 and 3 make an item every 28 and 20 ticks', () => {
    for (const [tier, per] of [
      [2, 28],
      [3, 20],
    ] as const) {
      const lab = new Lab(board([]));
      const well = lab.put(WELL, 4, 4, 0, tier);
      expect(produced(lab.state, well, 560)).toBe(Math.floor(560 / per));
    }
  });

  test('it feeds a consumer of the chosen resource, and the setting is what it carries', () => {
    const lab = new Lab(board([]));
    const well = lab.put(WELL, 4, 4, 0, 1, 'res_b');
    const hangar = lab.put('bld_hangar', 4, 7); // takes res_b
    lab.link(well, 'north', hangar, 'south', [
      [4, 5],
      [4, 6],
    ]);
    const events: SimEvent[] = [];
    const sim = createBoardSim(lab.state, content, simConfig);
    const ctx = createFlowContext(lab.state, content, simConfig, {
      consumers: 'drain',
      events,
    });
    for (let t = 0; t < 300; t++) stepFlow(sim, ctx);
    expect(
      events.some((e) => e.type === 'delivered' && e.building === hangar),
    ).toBe(true);
  });

  test('the Flowmancer bonus speeds it up like an Extractor', () => {
    const lab = new Lab(board([]));
    const well = lab.put(WELL, 4, 4, 0, 1, 'res_a');
    const events: SimEvent[] = [];
    const sim = createBoardSim(lab.state, content, simConfig);
    const ctx = createFlowContext(lab.state, content, simConfig, {
      consumers: 'drain',
      events,
    });
    ctx.sourceSpeedPercent = [10];
    for (let t = 0; t < 400; t++) stepFlow(sim, ctx);
    // floor(40 * 100 / 110) = 36 ticks per item: 11 items in 400 ticks.
    expect(
      events.filter((e) => e.type === 'produced' && e.building === well),
    ).toHaveLength(11);
  });
});

describe('validation of a saved team state', () => {
  function good() {
    const lab = new Lab(board([]));
    lab.put(WELL, 4, 4, 0, 2, 'res_c');
    lab.put('bld_gate', 8, 8);
    return lab.state;
  }
  const check = (data: unknown) => validateTeamState(data, content, mapgen);

  test('a state with a Well round-trips and hashes with its setting', () => {
    const state = good();
    const r = check(asJson(state));
    expect(r.ok).toBe(true);
    if (r.ok) expect(hashJson(r.state as never)).toBe(hashJson(state as never));
    const other = setBuildingResource(state, content, {
      actor: 0,
      id: got(state.buildings[0]).id,
      resource: 'res_a',
    });
    if (!other.ok) throw new Error(other.reason);
    expect(hashJson(other.state as never)).not.toBe(hashJson(state as never));
  });

  test('a Well without a setting, or a setting on another building, is refused', () => {
    const mutate = (f: (rows: Record<string, unknown>[]) => void): string => {
      const data = asJson(good()) as { buildings: Record<string, unknown>[] };
      f(data.buildings);
      const r = check(data);
      return r.ok ? 'ok' : r.errors.join('\n');
    };
    expect(
      mutate((b) => delete (b[0] as Record<string, unknown>)['resource']),
    ).toMatch(/needs a "resource"/);
    expect(
      mutate((b) => {
        (b[1] as Record<string, unknown>)['resource'] = 'res_a';
      }),
    ).toMatch(/has no resource setting/);
  });

  test('a setting that is not a base resource is refused', () => {
    for (const bad of ['res_ab_refined', 'res_nothing', 4, null]) {
      const data = asJson(good()) as { buildings: Record<string, unknown>[] };
      (data.buildings[0] as Record<string, unknown>)['resource'] = bad;
      const r = check(data);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join('\n')).toMatch(/base resource/);
    }
  });

  test('a conduit that carries another resource than the setting is refused', () => {
    const lab = new Lab(board([]));
    const well = lab.put(WELL, 4, 4, 0, 1, 'res_a');
    const barracks = lab.put('bld_barracks', 4, 7);
    lab.link(well, 'north', barracks, 'south', [
      [4, 5],
      [4, 6],
    ]);
    const data = asJson(lab.state) as { buildings: Record<string, unknown>[] };
    expect(check(data).ok).toBe(true);
    (data.buildings.find((b) => b['def'] === WELL) as Record<string, unknown>)[
      'resource'
    ] = 'res_b';
    expect(check(data).ok).toBe(false);
  });
});
