/**
 * The Transmuter (issue #476, step 8/9 of #468): the Alchemist's refinery of
 * one input and the resource setting. It takes any one base resource from the
 * conduit that feeds it, 2 items per batch, and makes 1 item of the base
 * resource its owner set. Golden vectors pin its battle behaviour; this file
 * checks the content, the loader, the rules of placement and conduits, and
 * the item accounting.
 */
import { describe, expect, test } from 'vitest';
import {
  hasResourceSetting,
  loadBuildings,
  refineryOutputPer1000,
  type BuildingDef,
} from './buildings.js';
import {
  createBoardSim,
  createFlowContext,
  flowTotals,
  stepFlow,
  type SimEvent,
} from './flow-sim.js';
import { addConduit } from './conduits.js';
import {
  setBuildingResource,
  validateTeamState,
  type TeamState,
} from './team-state.js';
import {
  Lab,
  board,
  content,
  got,
  mapgen,
  simConfig,
} from './testing/support.js';
import buildingsJson from '../../../content/buildings.json';

const T = 'bld_transmuter';

/** An Ore extractor (3,2), a Transmuter above it set to `setting`, and a consumer. */
function chain(setting: string, consumer = 'bld_hangar') {
  const lab = new Lab(
    board([
      [3, 2, 'res_a'],
      [8, 2, 'res_c'],
    ]),
  );
  const ext = lab.put('bld_extractor', 3, 2);
  const tm = lab.put(T, 3, 3, 0, 1, setting);
  lab.link(ext, 'north', tm, 'south');
  const user = lab.put(consumer, 3, 5);
  lab.link(tm, 'north', user, 'south');
  return { lab, ext, tm, user };
}

function run(
  state: TeamState,
  ticks: number,
  mode: 'drain' | 'hold' = 'drain',
) {
  const events: SimEvent[] = [];
  const sim = createBoardSim(state, content, simConfig);
  const ctx = createFlowContext(state, content, simConfig, {
    consumers: mode,
    events,
  });
  for (let t = 0; t < ticks; t++) {
    stepFlow(sim, ctx);
    const f = flowTotals(sim);
    expect(f.produced).toBe(
      f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
    );
  }
  return { sim, events, totals: flowTotals(sim) };
}

describe('the content', () => {
  test('a 1x2 refinery with the resource setting, one input of no resource, 2 in 1 out', () => {
    const d = got(content.buildings.get(T));
    if (d.kind !== 'refinery') throw new Error('kind');
    expect(hasResourceSetting(d)).toBe(true);
    expect(d.output).toBeUndefined();
    expect(d.footprint).toEqual({ width: 1, height: 2 });
    expect(d.inputs).toEqual([{ side: 'south' }]);
    expect(d.outputs).toEqual(['north']);
    for (const t of d.tiers) {
      expect(t.costPerBatch).toBe(2);
      expect(t.outputPerBatch).toBe(1);
      expect(t.costs).toBeUndefined();
    }
    // Faster with the tier, as a refinery is.
    const times = d.tiers.map((t) => t.productionIntervalTicks);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(refineryOutputPer1000(d, 1)).toBeGreaterThan(0);
  });

  test('it loses items: it makes at most half of what it takes in', () => {
    const d = got(content.buildings.get(T));
    if (d.kind !== 'refinery') throw new Error('kind');
    for (const t of d.tiers) {
      expect(t.outputPerBatch * 2).toBeLessThanOrEqual(t.costPerBatch ?? 0);
    }
  });
});

describe('the loader', () => {
  const ctx = { resources: content.resources, units: content.units };
  const valid = () =>
    JSON.parse(JSON.stringify(buildingsJson)) as {
      buildings: Record<string, unknown>[];
    };
  const load = (edit: (t: Record<string, unknown>) => void) => {
    const data = valid();
    const t = data.buildings.find((b) => b['id'] === T) as Record<
      string,
      unknown
    >;
    edit(t);
    return loadBuildings(data, ctx);
  };
  const errorsOf = (r: ReturnType<typeof loadBuildings>): string =>
    r.ok ? '' : r.errors.join('\n');

  test('the shipped file loads', () => {
    expect(load(() => {}).ok).toBe(true);
  });

  test('an output is refused: the setting is the output', () => {
    expect(errorsOf(load((t) => (t['output'] = 'res_ab_refined')))).toMatch(
      /must not have an "output"/,
    );
  });

  test('an input that names a resource is refused', () => {
    expect(
      errorsOf(
        load((t) => (t['inputs'] = [{ side: 'south', resource: 'res_a' }])),
      ),
    ).toMatch(/must not name a "resource"/);
  });

  test('two inputs are refused', () => {
    expect(
      errorsOf(
        load((t) => (t['inputs'] = [{ side: 'south' }, { side: 'west' }])),
      ),
    ).toMatch(/exactly 1 input/);
  });

  test('a tier with costs instead of costPerBatch is refused', () => {
    expect(
      errorsOf(
        load((t) => {
          const tiers = t['tiers'] as Record<string, unknown>[];
          for (const x of tiers) {
            delete x['costPerBatch'];
            x['costs'] = { res_a: 2 };
          }
        }),
      ),
    ).toMatch(/costPerBatch/);
  });

  test('costPerBatch is bounded', () => {
    expect(
      errorsOf(
        load((t) => {
          const tiers = t['tiers'] as Record<string, unknown>[];
          (tiers[0] as Record<string, unknown>)['costPerBatch'] = 0;
        }),
      ),
    ).toMatch(/costPerBatch/);
  });

  test('the setting is refused on other kinds', () => {
    const data = valid();
    const wall = data.buildings.find((b) => b['id'] === 'bld_turret');
    (wall as Record<string, unknown>)['resourceSetting'] = true;
    expect(errorsOf(loadBuildings(data, ctx))).toMatch(/only valid on kind/);
  });

  test('a refinery without the setting still needs an output', () => {
    const data = valid();
    const r = data.buildings.find(
      (b) => b['id'] === 'bld_refinery_ab',
    ) as Record<string, unknown>;
    delete r['output'];
    expect(errorsOf(loadBuildings(data, ctx))).toMatch(/needs an "output"/);
  });
});

describe('placement and the setting', () => {
  test('stands where a refinery stands: not on a node', () => {
    const lab = new Lab(board([[4, 4, 'res_a']]));
    expect(() => lab.put(T, 4, 4, 0, 1, 'res_b')).toThrow(/node_reserved/);
    expect(() => lab.put(T, 6, 4, 0, 1, 'res_b')).not.toThrow();
  });

  test('without a resource it is set to the first base resource', () => {
    const lab = new Lab(board([]));
    const id = lab.put(T, 4, 4);
    expect(lab.state.buildings.find((b) => b.id === id)?.resource).toBe(
      'res_a',
    );
  });

  test('a change detaches its conduits and is validated like a Mana Well setting', () => {
    const { lab, tm } = chain('res_b');
    expect(lab.state.conduits.length).toBe(2);
    const r = setBuildingResource(lab.state, content, {
      actor: 0,
      id: tm,
      resource: 'res_c',
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.conduits.length).toBe(0);
    expect(
      setBuildingResource(lab.state, content, {
        actor: 0,
        id: tm,
        resource: 'res_ab_refined',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid_resource' });
    expect(
      validateTeamState(JSON.parse(JSON.stringify(r.state)), content, mapgen)
        .ok,
    ).toBe(true);
  });

  test('a saved Transmuter needs its setting', () => {
    const { lab } = chain('res_b');
    const raw = JSON.parse(JSON.stringify(lab.state)) as TeamState;
    const broken = {
      ...raw,
      buildings: raw.buildings.map((b) => {
        if (b.def !== T) return b;
        const rest: Record<string, unknown> = { ...b };
        delete rest['resource'];
        return rest;
      }),
    };
    const v = validateTeamState(broken, content, mapgen);
    expect(v.ok).toBe(false);
  });
});

describe('conduits', () => {
  test('its input takes any base resource, and the conduit out carries the setting', () => {
    for (const fed of ['res_a', 'res_b', 'res_c']) {
      const lab = new Lab(board([[3, 2, fed]]));
      const ext = lab.put('bld_extractor', 3, 2);
      const tm = lab.put(T, 3, 3, 0, 1, 'res_a');
      expect(() => lab.link(ext, 'north', tm, 'south')).not.toThrow();
      // Out of it: the setting (Ore), whatever came in.
      const power = lab.put('bld_turret', 3, 5); // takes Power
      expect(() => lab.link(tm, 'north', power, 'south')).toThrow(
        /resource_mismatch/,
      );
    }
  });

  test('a refined resource is refused', () => {
    const lab = new Lab(
      board([
        [2, 2, 'res_a'],
        [0, 4, 'res_b'],
      ]),
    );
    const ea = lab.put('bld_extractor', 2, 2);
    const eb = lab.put('bld_extractor', 0, 4);
    const ref = lab.put('bld_refinery_ab', 3, 4);
    lab.link(ea, 'north', ref, 'south', [
      [2, 3],
      [3, 3],
    ]);
    lab.link(eb, 'north', ref, 'west', [
      [0, 5],
      [1, 5],
      [2, 5],
    ]);
    const tm = lab.put(T, 3, 7, 0, 1, 'res_a');
    const r = addConduit(lab.state, content, {
      actor: 0,
      from: { building: ref, side: 'north' },
      to: { building: tm, side: 'south' },
      cells: [{ x: 3, y: 6 }],
    });
    expect(r).toMatchObject({ ok: false, reason: 'resource_mismatch' });
  });
});

describe('the flow', () => {
  test('2 in, 1 out: the output is the setting, and the loss is the difference', () => {
    const { lab, tm, user } = chain('res_b');
    const { sim, events, totals } = run(lab.state, 600);
    const r = sim.refineries?.find((x) => x.building === tm);
    expect(r?.resource).toBe('res_b');
    expect(r?.batches).toBeGreaterThan(2);
    expect(r?.produced).toBe(r?.batches);
    // What the Hangar took is Power; what the extractor made is Ore.
    const c = sim.consumers.find((x) => x.building === user);
    expect(c?.inputs[0]?.resource).toBe('res_b');
    expect(c?.inputs[0]?.delivered).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'produced' && e.building === tm)).toBe(
      true,
    );
    // Items in minus items out: consumed counts what it took (2 per batch),
    // produced what it made (1 per batch), so the loss shows.
    const took = (r?.batches ?? 0) * 2;
    const made = r?.produced ?? 0;
    expect(took - made).toBe(r?.batches);
    expect(totals.consumed).toBeGreaterThanOrEqual(took);
  });

  test('the same resource as the input: it takes nothing and makes nothing', () => {
    const { lab, tm } = chain('res_a', 'bld_barracks');
    const { sim, totals } = run(lab.state, 400);
    const r = sim.refineries?.find((x) => x.building === tm);
    expect(r?.batches).toBe(0);
    expect(r?.produced).toBe(0);
    expect(r?.counters).toEqual([0]);
    // The conduit backs up to the extractor.
    expect(totals.consumed).toBe(0);
    expect(sim.sources[0]?.stalledTicks).toBeGreaterThan(0);
  });

  test('an unconnected input makes nothing', () => {
    const lab = new Lab(board([]));
    lab.put(T, 4, 4, 0, 1, 'res_b');
    const { sim } = run(lab.state, 100);
    expect(sim.refineries?.[0]?.batches).toBe(0);
  });

  test('its output backs up when the consumer is full, and it stalls', () => {
    const { lab, tm } = chain('res_b');
    const { sim } = run(lab.state, 800, 'hold');
    const r = sim.refineries?.find((x) => x.building === tm);
    expect(r?.stalledTicks).toBeGreaterThan(0);
    expect(r?.store).toBeLessThanOrEqual(1);
  });

  test('an output with no conduit is lost, and counted', () => {
    const lab = new Lab(board([[3, 2, 'res_a']]));
    const ext = lab.put('bld_extractor', 3, 2);
    const tm = lab.put(T, 3, 3, 0, 1, 'res_c');
    lab.link(ext, 'north', tm, 'south');
    const { sim, totals } = run(lab.state, 300);
    const r = sim.refineries?.find((x) => x.building === tm);
    expect(r?.lost).toBe(r?.produced);
    expect(totals.lost).toBeGreaterThan(0);
  });

  test('the same input as the setting of another Transmuter works (two in a row)', () => {
    const lab = new Lab(board([[3, 2, 'res_a']]));
    const ext = lab.put('bld_extractor', 3, 2);
    const a = lab.put(T, 3, 3, 0, 1, 'res_b');
    lab.link(ext, 'north', a, 'south');
    const b = lab.put(T, 3, 7, 0, 1, 'res_c');
    lab.link(a, 'north', b, 'south', [
      [3, 5],
      [3, 6],
    ]);
    const { sim } = run(lab.state, 800);
    const rb = sim.refineries?.find((x) => x.building === b);
    expect(rb?.resource).toBe('res_c');
    expect(rb?.batches).toBeGreaterThan(0);
  });
});

describe('typing', () => {
  test('a def is a plain BuildingDef', () => {
    const d: BuildingDef = got(content.buildings.get(T));
    expect(d.id).toBe(T);
  });
});
