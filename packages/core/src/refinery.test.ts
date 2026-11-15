/**
 * Refineries and the refined resources (CB-5b, CB-5d, CB-5f, CB-9, CB-10c,
 * CB-43, PP-4; issue #381): the resource and building loaders, map generation,
 * conduit typing, the battle rules of a refinery (batch, release, back-up),
 * conservation, removal in the middle of a battle and the dry run.
 */
import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import terrainJson from '../../../content/terrain.json';
import unitsJson from '../../../content/units.json';
import {
  costEntries,
  loadBuildings,
  needPer1000,
  needPer1000By,
  refineryOutputPer1000,
} from './buildings.js';
import {
  addConduit,
  brokenLinks,
  buildFlowGraph,
  conduitResource,
  conduitsLostWith,
} from './conduits.js';
import { loadAllContentOrThrow } from './content.js';
import {
  cloneBoardSim,
  createBoardSim,
  createFlowContext,
  dryRunFlow,
  flowTotals,
  rebuildFlow,
  stepFlow,
  takeFromBuffer,
  type BoardSim,
  type SimEvent,
} from './flow-sim.js';
import { generateMap } from './generate-map.js';
import { validateTeamState } from './team-state.js';
import { MAX_OUTPUT_PER_BATCH } from './limits.js';
import { sealedProducers } from './sealed-producers.js';
import type { TeamState } from './team-state.js';
import { tinyMap } from './testing/ramp-scenarios.js';
import { content, got, Lab, mapgen, simConfig } from './testing/support.js';

const CTX = { resources: content.resources, units: content.units };

/** A consumer of one refined resource: takes one item per 10 ticks. */
function sinkEntry(id: string, resource: string, interval = 10) {
  const tier = {
    health: 20,
    price: 0,
    costPerUnit: 1,
    productionIntervalTicks: interval,
  };
  return {
    id,
    kind: 'unit_producer',
    unit: 'unit_soldier',
    footprint: { width: 1, height: 1 },
    inputs: [{ side: 'south', resource }],
    outputs: [],
    tiers: [tier, tier, tier],
  };
}

/**
 * The shipped content plus two test consumers, one per refined resource (no
 * shipped building takes a refined resource yet).
 */
const withSinks = loadAllContentOrThrow({
  resources: resourcesJson,
  terrain: terrainJson,
  units: unitsJson,
  buildings: {
    buildings: [
      ...buildingsJson.buildings,
      sinkEntry('bld_sink_ab', 'res_ab_refined'),
      sinkEntry('bld_sink_bc', 'res_bc_refined'),
    ],
  },
  presentation: {
    ...presentationJson,
    buildings: {
      ...presentationJson.buildings,
      bld_sink_ab: { name: 'Sink', description: 'Test.' },
      bld_sink_bc: { name: 'Sink', description: 'Test.' },
    },
  },
});

interface Chain {
  lab: Lab;
  refinery: number;
  sink: number;
  /** Item sources: the one feeding the south input, then the west input. */
  south: number;
  west: number;
}

/**
 * Two collectors, a refinery at (5, 5) (inputs south and west, output north)
 * and a test consumer of its output at (5, 10).
 */
function chain(
  kind: 'ab' | 'bc',
  opts: { tier?: number; south?: boolean; west?: boolean } = {},
): Chain {
  const [southRes, westRes] =
    kind === 'ab' ? ['res_a', 'res_b'] : ['res_b', 'res_c'];
  const lab = new Lab(
    tinyMap([
      [3, 2, westRes],
      [5, 2, southRes],
    ]),
    withSinks,
  );
  lab.core(8, 0);
  const refinery = lab.put(
    kind === 'ab' ? 'bld_refinery_ab' : 'bld_refinery_bc',
    5,
    5,
    0,
    opts.tier ?? 3,
  );
  let south = -1;
  let west = -1;
  if (opts.south !== false) {
    south = lab.put('bld_extractor', 5, 2, 0, 3);
    lab.link(south, 'north', refinery, 'south', [
      [5, 3],
      [5, 4],
    ]);
  }
  if (opts.west !== false) {
    west = lab.put('bld_extractor', 3, 2, 0, 3);
    lab.link(west, 'north', refinery, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
  }
  const sink = lab.put(kind === 'ab' ? 'bld_sink_ab' : 'bld_sink_bc', 5, 10);
  lab.link(refinery, 'north', sink, 'south', [
    [5, 7],
    [5, 8],
    [5, 9],
  ]);
  return { lab, refinery, sink, south, west };
}

function run(
  c: Chain,
  ticks: number,
  mode: 'hold' | 'drain' | 'need' = 'hold',
  each?: (sim: BoardSim, tick: number) => void,
) {
  const events: SimEvent[] = [];
  const sim = createBoardSim(c.lab.state, withSinks, simConfig);
  const ctx = createFlowContext(c.lab.state, withSinks, simConfig, {
    consumers: mode,
    events,
  });
  for (let t = 0; t < ticks; t++) {
    stepFlow(sim, ctx);
    const f = flowTotals(sim);
    expect(f.produced).toBe(
      f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
    );
    each?.(sim, t);
  }
  return { sim, ctx, events };
}

const producedBy = (events: readonly SimEvent[], building: number) =>
  events
    .filter((e) => e.type === 'produced' && e.building === building)
    .map((e) => e.tick);

describe('refined resources in content', () => {
  test('the two refined resources, with their own colours and no rarity', () => {
    const ab = got(content.resources.get('res_ab_refined'));
    const bc = got(content.resources.get('res_bc_refined'));
    expect(ab.name).toBe('Composite');
    expect(bc.name).toBe('Aether');
    expect(ab.refinedFrom).toEqual(['res_a', 'res_b']);
    expect(bc.refinedFrom).toEqual(['res_b', 'res_c']);
    expect(ab.rarity).toBeUndefined();
    expect(bc.rarity).toBeUndefined();
    const colours = content.resources.list().map((r) => r.color);
    expect(colours.every((c) => c !== undefined)).toBe(true);
    expect(new Set(colours).size).toBe(colours.length);
    expect(content.resources.listBase().map((r) => r.id)).toEqual([
      'res_a',
      'res_b',
      'res_c',
    ]);
  });

  test('map generation never places a node of a refined resource', () => {
    const refined = new Set(
      content.resources
        .list()
        .filter((r) => r.refinedFrom !== undefined)
        .map((r) => r.id),
    );
    expect(refined.size).toBe(2);
    for (let seed = 1; seed <= 30; seed++) {
      for (const partySize of [1, 2, 4]) {
        const map = generateMap(seed, partySize, content, mapgen);
        expect(map.nodes.length).toBeGreaterThan(0);
        expect(map.nodes.filter((n) => refined.has(n.resource))).toEqual([]);
      }
    }
  });
});

describe('the refinery kind in content', () => {
  test('the shipped refineries', () => {
    const ab = got(content.buildings.get('bld_refinery_ab'));
    const bc = got(content.buildings.get('bld_refinery_bc'));
    expect(ab.kind === 'refinery' && ab.output).toBe('res_ab_refined');
    expect(bc.kind === 'refinery' && bc.output).toBe('res_bc_refined');
    expect(ab.footprint).toEqual({ width: 2, height: 2 });
    expect(ab.inputs).toEqual([
      { resource: 'res_a', side: 'south' },
      { resource: 'res_b', side: 'west' },
    ]);
    expect(bc.inputs).toEqual([
      { resource: 'res_b', side: 'south' },
      { resource: 'res_c', side: 'west' },
    ]);
    expect(ab.outputs).toEqual(['north']);
    expect(bc.outputs).toEqual(['north']);
    for (const d of [ab, bc]) {
      if (d.kind !== 'refinery') throw new Error('not a refinery');
      expect(d.tiers.map((t) => t.productionIntervalTicks)).toEqual([
        60, 42, 30,
      ]);
      expect(d.tiers.map((t) => t.price)).toEqual([35, 75, 130]);
      expect(d.tiers.map((t) => t.outputPerBatch)).toEqual([2, 2, 2]);
      expect(
        [1, 2, 3].map((t) => costEntries(d, t)?.map((e) => e.cost)),
      ).toEqual([
        [3, 3],
        [3, 3],
        [3, 3],
      ]);
    }
  });

  test('need per input and output per 1000 ticks at top speed', () => {
    const ab = got(content.buildings.get('bld_refinery_ab'));
    expect([1, 2, 3].map((t) => needPer1000By(ab, t))).toEqual([
      [
        { resource: 'res_a', needPer1000: 50 },
        { resource: 'res_b', needPer1000: 50 },
      ],
      [
        { resource: 'res_a', needPer1000: 71 },
        { resource: 'res_b', needPer1000: 71 },
      ],
      [
        { resource: 'res_a', needPer1000: 100 },
        { resource: 'res_b', needPer1000: 100 },
      ],
    ]);
    expect([1, 2, 3].map((t) => needPer1000(ab, t))).toEqual([100, 142, 200]);
    expect([1, 2, 3].map((t) => refineryOutputPer1000(ab, t))).toEqual([
      33, 47, 66,
    ]);
    expect(
      refineryOutputPer1000(got(content.buildings.get('bld_barracks')), 1),
    ).toBe(0);
  });

  function loadEdited(edit: (entry: Record<string, unknown>) => void): string {
    const data = JSON.parse(JSON.stringify(buildingsJson)) as {
      buildings: Record<string, unknown>[];
    };
    edit(got(data.buildings.find((b) => b['id'] === 'bld_refinery_ab')));
    const r = loadBuildings(data, CTX);
    return r.ok ? '' : r.errors.join('\n');
  }
  const tierOf = (e: Record<string, unknown>, i: number) =>
    got((e['tiers'] as Record<string, unknown>[])[i]);

  test('the output must be a refined resource made from the input resources', () => {
    expect(
      loadEdited((e) => {
        e['output'] = 'res_a';
      }),
    ).toMatch(/not a refined resource/);
    expect(
      loadEdited((e) => {
        e['output'] = 'res_bc_refined';
      }),
    ).toMatch(
      /refined from \[res_b, res_c\] but the inputs take \[res_a, res_b\]/,
    );
    expect(
      loadEdited((e) => {
        e['output'] = 'res_nope';
      }),
    ).toMatch(/unknown resource ID "res_nope"/);
    expect(
      loadEdited((e) => {
        delete e['output'];
      }),
    ).toMatch(/needs an "output"/);
    // The same set of resources in another order is fine.
    expect(
      loadEdited((e) => {
        e['inputs'] = [
          { resource: 'res_b', side: 'south' },
          { resource: 'res_a', side: 'west' },
        ];
      }),
    ).toBe('');
  });

  test('costs, interval and outputPerBatch are checked', () => {
    expect(
      loadEdited((e) => {
        delete tierOf(e, 0)['costs'];
      }),
    ).toMatch(/needs "costs"/);
    expect(
      loadEdited((e) => {
        tierOf(e, 0)['costPerUnit'] = 3;
      }),
    ).toMatch(/field "costPerUnit" is not valid for refinery/);
    expect(
      loadEdited((e) => {
        tierOf(e, 1)['costs'] = { res_a: 3 };
      }),
    ).toMatch(/takes "res_b", which has no cost/);
    expect(
      loadEdited((e) => {
        tierOf(e, 1)['costs'] = { res_a: 3, res_b: 3, res_c: 3 };
      }),
    ).toMatch(/resource "res_c" has no input/);
    expect(
      loadEdited((e) => {
        tierOf(e, 2)['outputPerBatch'] = 0;
      }),
    ).toMatch(/"outputPerBatch" must be an integer >= 1/);
    expect(
      loadEdited((e) => {
        tierOf(e, 2)['outputPerBatch'] = MAX_OUTPUT_PER_BATCH + 1;
      }),
    ).toMatch(/"outputPerBatch" must be at most 1000/);
    expect(
      loadEdited((e) => {
        tierOf(e, 2)['outputPerBatch'] = MAX_OUTPUT_PER_BATCH;
      }),
    ).toBe('');
    expect(
      loadEdited((e) => {
        delete tierOf(e, 2)['productionIntervalTicks'];
      }),
    ).toMatch(/"productionIntervalTicks"/);
  });

  test('a refinery has one output and one or two inputs', () => {
    expect(
      loadEdited((e) => {
        e['outputs'] = [];
      }),
    ).toMatch(/a refinery needs exactly 1 output; found 0/);
    expect(
      loadEdited((e) => {
        e['inputs'] = [];
      }),
    ).toMatch(/a refinery needs 1 to 2 inputs; found 0/);
  });

  test('whole-state validation (saved teams and ghosts) knows the kind', () => {
    const c = chain('ab');
    const json = JSON.parse(JSON.stringify(c.lab.state)) as TeamState;
    expect(validateTeamState(json, withSinks, mapgen).ok).toBe(true);
    // A refined conduit into an input of another resource is rejected.
    const bad = JSON.parse(JSON.stringify(c.lab.state)) as {
      buildings: { def: string }[];
    };
    const sink = got(bad.buildings.find((b) => b.def === 'bld_sink_ab'));
    sink.def = 'bld_sink_bc';
    const r = validateTeamState(bad, withSinks, mapgen);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join('\n')).toMatch(/resource_mismatch/);
  });

  test('a refinery is not a unit producer', () => {
    const lab = new Lab(tinyMap(), withSinks);
    // A placed refinery is never listed (it makes no units).
    lab.put('bld_refinery_ab', 5, 5);
    expect(sealedProducers(lab.state, withSinks)).toEqual([]);
  });
});

describe('conduit typing', () => {
  test('a conduit leaving a refinery carries its output resource', () => {
    const c = chain('ab');
    const out = got(
      c.lab.state.conduits.find(
        (x) => 'building' in x.to && x.to.building === c.sink,
      ),
    );
    expect(conduitResource(c.lab.state, withSinks, out.id)).toBe(
      'res_ab_refined',
    );
    const g = buildFlowGraph(c.lab.state, withSinks);
    expect(g.nodes.find((n) => n.building === c.refinery)?.kind).toBe(
      'refinery',
    );
    expect(g.edges.find((e) => e.conduitId === out.id)?.resource).toBe(
      'res_ab_refined',
    );
  });

  test('Composite is refused at every input of another resource, Composite or Aether alike', () => {
    const lab = new Lab(
      tinyMap([
        [3, 2, 'res_b'],
        [5, 2, 'res_a'],
      ]),
      withSinks,
    );
    lab.core(8, 0);
    const e1 = lab.put('bld_extractor', 5, 2, 0, 3);
    const e2 = lab.put('bld_extractor', 3, 2, 0, 3);
    const ab = lab.put('bld_refinery_ab', 5, 5, 0, 3);
    const bc = lab.put('bld_refinery_bc', 8, 8, 0, 3);
    const barracks = lab.put('bld_barracks', 1, 10);
    lab.link(e1, 'north', ab, 'south', [
      [5, 3],
      [5, 4],
    ]);
    lab.link(e2, 'north', ab, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
    const attempt = (to: number, side: 'south' | 'west', cells: number[][]) =>
      addConduit(lab.state, withSinks, {
        actor: 0,
        from: { building: ab, side: 'north' },
        to: { building: to, side },
        cells: cells.map(([x, y]) => ({ x: x as number, y: y as number })),
      });
    // Into the Aether refinery's Power input (south) and Flux input (west).
    const r1 = attempt(bc, 'south', [
      [5, 7],
      [6, 7],
      [7, 7],
      [8, 7],
    ]);
    expect(r1.ok).toBe(false);
    expect(!r1.ok && r1.reason).toBe('resource_mismatch');
    const r2 = attempt(bc, 'west', [
      [5, 7],
      [6, 7],
      [7, 7],
      [7, 8],
      [7, 9],
    ]);
    expect(!r2.ok && r2.reason).toBe('resource_mismatch');
    // Into a Barracks (takes Ore).
    const r3 = attempt(barracks, 'south', [
      [5, 7],
      [5, 8],
      [4, 8],
      [3, 8],
      [2, 8],
      [1, 8],
      [1, 9],
    ]);
    expect(!r3.ok && r3.reason).toBe('resource_mismatch');
    // Into the matching test consumer: accepted.
    const sink = lab.put('bld_sink_ab', 5, 10);
    const ok = attempt(sink, 'south', [
      [5, 7],
      [5, 8],
      [5, 9],
    ]);
    expect(ok.ok).toBe(true);
  });

  test('a splitter carries a refined resource', () => {
    const c = chain('ab');
    // Replace the output conduit by a direct splitter above the refinery.
    const lab = new Lab(
      tinyMap([
        [3, 2, 'res_b'],
        [5, 2, 'res_a'],
      ]),
      withSinks,
    );
    lab.core(8, 0);
    const ab = lab.put('bld_refinery_ab', 5, 5, 0, 3);
    const sp = lab.put('bld_splitter', 5, 7);
    const sink = lab.put('bld_sink_ab', 5, 9);
    lab.link(ab, 'north', sp, 'south', []);
    const id = lab.link(sp, 'north', sink, 'south', [[5, 8]]);
    expect(conduitResource(lab.state, withSinks, id)).toBe('res_ab_refined');
    expect(c.sink).toBeGreaterThan(0);
  });

  test('a merger fed Composite refuses Aether on another input', () => {
    const lab = new Lab(tinyMap(), withSinks);
    lab.core(8, 0);
    const ab = lab.put('bld_refinery_ab', 5, 5, 0, 3);
    const bc = lab.put('bld_refinery_bc', 2, 4, 0, 3);
    const merger = lab.put('bld_merger', 5, 7);
    lab.link(ab, 'north', merger, 'south', []);
    const r = addConduit(lab.state, withSinks, {
      actor: 0,
      from: { building: bc, side: 'north' },
      to: { building: merger, side: 'west' },
      cells: [
        { x: 2, y: 6 },
        { x: 2, y: 7 },
        { x: 3, y: 7 },
        { x: 4, y: 7 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('resource_mismatch');
  });
});

describe('the battle rules of a refinery', () => {
  test.each([['ab'], ['bc']] as const)(
    '%s: full input makes 2 items per batch at the top speed of its tier',
    (kind) => {
      for (const [tier, interval] of [
        [1, 60],
        [2, 42],
        [3, 30],
      ] as const) {
        const c = chain(kind, { tier });
        const { sim, events } = run(c, 1500, 'hold', (b) => {
          // The consumer is never paced here: keep it from backing up.
          takeFromBuffer(b, c.sink, 'south', 1);
        });
        const ticks = producedBy(events, c.refinery);
        expect(ticks.length % 2).toBe(0);
        const batches = ticks.filter((_t, i) => i % 2 === 0);
        // Both items of a batch are logged on the tick the batch is made.
        expect(ticks.filter((_t, i) => i % 2 === 1)).toEqual(batches);
        for (let i = 1; i < batches.length; i++) {
          expect(batches[i]).toBe((batches[i - 1] as number) + interval);
        }
        // Output rate: 2000 / interval items per 1000 ticks.
        const r = got(sim.refineries?.[0]);
        expect(r.batches).toBe(batches.length);
        expect(r.produced).toBe(2 * batches.length);
        expect(r.batches).toBeGreaterThanOrEqual(
          Math.floor((1500 - 40) / interval),
        );
        expect(r.lost).toBe(0);
        // The items arrive at the consumer.
        expect(
          got(sim.consumers.find((x) => x.building === c.sink)).inputs[0]
            ?.delivered,
        ).toBeGreaterThanOrEqual(r.produced - 8);
      }
    },
  );

  test('the first batch waits for every counter: 3 of each input', () => {
    const c = chain('ab');
    const { events } = run(c, 80);
    const first = producedBy(events, c.refinery)[0] as number;
    // A tier 3 collector makes an item every 10 ticks (the first at tick 9),
    // three of them over conduits of two or four cells.
    expect(first).toBeGreaterThan(30);
    expect(first).toBeLessThan(45);
  });

  test.each([
    ['no Power', { west: false }],
    ['no Ore', { south: false }],
    ['neither', { south: false, west: false }],
  ] as const)('with %s the refinery never produces', (_name, given) => {
    const opts: { south?: boolean; west?: boolean } = given;
    const c = chain('ab', opts);
    const { sim, events } = run(c, 1500);
    expect(producedBy(events, c.refinery)).toEqual([]);
    const r = got(sim.refineries?.[0]);
    expect(r.batches).toBe(0);
    expect(r.store).toBe(0);
    // The input that does arrive fills its counter to 3, then its buffer.
    if (opts.west === false && opts.south !== false) {
      expect(r.counters).toEqual([3, 0]);
      const c0 = got(sim.consumers.find((x) => x.building === c.refinery));
      expect(c0.inputs.map((i) => i.count)).toEqual([4, 0]);
      expect(got(sim.sources.find((x) => x.building === c.south)).stalled).toBe(
        1,
      );
    }
    expect(
      got(sim.consumers.find((x) => x.building === c.sink)).inputs[0]
        ?.delivered,
    ).toBe(0);
  });

  test('when the output backs up the store holds, intake stops, then everything resumes', () => {
    const c = chain('ab');
    // Hold mode and nobody paces the consumer: its buffer (4), the conduit
    // (3 cells) and then the refinery's store fill up.
    const { sim, ctx, events } = run(c, 600);
    const r = got(sim.refineries?.[0]);
    const sinkBuf = got(sim.consumers.find((x) => x.building === c.sink))
      .inputs[0];
    expect(sinkBuf?.count).toBe(4);
    expect(r.store).toBeGreaterThan(0);
    expect(r.stalled).toBe(1);
    expect(
      events.filter((e) => e.type === 'stalled' && e.building === c.refinery),
    ).toHaveLength(1);
    // No new batch while the store is not empty; the counters stay full and
    // so do the input buffers and the collectors are stalled.
    const batches = r.batches;
    expect(r.counters).toEqual([3, 3]);
    const refIn = got(sim.consumers.find((x) => x.building === c.refinery));
    expect(refIn.inputs.map((i) => i.count)).toEqual([4, 4]);
    expect(sim.sources.every((s) => s.stalled === 1)).toBe(true);
    const held = r.store;
    for (let t = 0; t < 100; t++) stepFlow(sim, ctx);
    expect(r.batches).toBe(batches);
    expect(r.store).toBe(held);
    // Free the consumer: the store drains, a batch starts, intake resumes.
    takeFromBuffer(sim, c.sink, 'south', 4);
    for (let t = 0; t < 40; t++) stepFlow(sim, ctx);
    expect(r.stalled === 0 || r.store > 0).toBe(true);
    expect(r.batches).toBeGreaterThan(batches);
    expect(r.stalledTicks).toBeGreaterThan(100);
    const f = flowTotals(sim);
    expect(f.produced).toBe(
      f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
    );
  });

  test('an output with no conduit sends its items into nothing: lost, never stalled', () => {
    const lab = new Lab(
      tinyMap([
        [3, 2, 'res_b'],
        [5, 2, 'res_a'],
      ]),
      withSinks,
    );
    lab.core(8, 0);
    const ref = lab.put('bld_refinery_ab', 5, 5, 0, 3);
    const a = lab.put('bld_extractor', 5, 2, 0, 3);
    const b = lab.put('bld_extractor', 3, 2, 0, 3);
    lab.link(a, 'north', ref, 'south', [
      [5, 3],
      [5, 4],
    ]);
    lab.link(b, 'north', ref, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
    const sim = createBoardSim(lab.state, withSinks, simConfig);
    const events: SimEvent[] = [];
    const ctx = createFlowContext(lab.state, withSinks, simConfig, { events });
    for (let t = 0; t < 400; t++) {
      stepFlow(sim, ctx);
      const f = flowTotals(sim);
      expect(f.produced).toBe(
        f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
      );
    }
    const r = got(sim.refineries?.[0]);
    expect(r.lost).toBe(r.produced);
    expect(r.stalledTicks).toBe(0);
    expect(
      events.filter((e) => e.type === 'lost' && e.building === ref),
    ).toHaveLength(r.lost);
    expect(r.batches).toBeGreaterThan(8);
  });

  test('the Overclocker speeds up collectors only, not refineries', () => {
    const c = chain('ab', { tier: 3 });
    const events: SimEvent[] = [];
    const sim = createBoardSim(c.lab.state, withSinks, simConfig);
    const ctx = createFlowContext(c.lab.state, withSinks, simConfig, {
      events,
    });
    ctx.sourceSpeedPercent = [100];
    for (let t = 0; t < 600; t++) {
      takeFromBuffer(sim, c.sink, 'south', 1);
      stepFlow(sim, ctx);
    }
    const batches = producedBy(events, c.refinery).filter(
      (_t, i) => i % 2 === 0,
    );
    for (let i = 1; i < batches.length; i++) {
      expect(
        (batches[i] as number) - (batches[i - 1] as number),
      ).toBeGreaterThanOrEqual(30);
    }
    expect(batches.length).toBeLessThanOrEqual(Math.floor(600 / 30));
    // The collectors are twice as fast but wait for the refinery.
    expect(got(sim.sources[0]).stalledTicks).toBeGreaterThan(200);
  });

  test('two refineries feeding one merger directly or by conduit never lose an item', () => {
    const lab = new Lab(
      tinyMap([
        [3, 2, 'res_b'],
        [5, 2, 'res_a'],
        [7, 2, 'res_b'],
        [9, 2, 'res_a'],
      ]),
      withSinks,
    );
    lab.core(8, 0);
    const r1 = lab.put('bld_refinery_ab', 5, 5, 0, 3);
    const r2 = lab.put('bld_refinery_ab', 9, 5, 0, 3);
    const e = [
      lab.put('bld_extractor', 5, 2, 0, 3),
      lab.put('bld_extractor', 3, 2, 0, 3),
      lab.put('bld_extractor', 9, 2, 0, 3),
      lab.put('bld_extractor', 7, 2, 0, 3),
    ];
    lab.link(got(e[0]), 'north', r1, 'south', [
      [5, 3],
      [5, 4],
    ]);
    lab.link(got(e[1]), 'north', r1, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
    lab.link(got(e[2]), 'north', r2, 'south', [
      [9, 3],
      [9, 4],
    ]);
    lab.link(got(e[3]), 'north', r2, 'west', [
      [7, 3],
      [7, 4],
      [7, 5],
      [8, 5],
    ]);
    const merger = lab.put('bld_merger', 5, 7);
    const sink = lab.put('bld_sink_ab', 5, 10);
    lab.link(r1, 'north', merger, 'south', []);
    lab.link(r2, 'north', merger, 'east', [
      [9, 7],
      [8, 7],
      [7, 7],
      [6, 7],
    ]);
    lab.link(merger, 'north', sink, 'south', [
      [5, 8],
      [5, 9],
    ]);
    const sim = createBoardSim(lab.state, withSinks, simConfig);
    const ctx = createFlowContext(lab.state, withSinks, simConfig, {
      consumers: 'drain',
    });
    for (let t = 0; t < 1500; t++) {
      stepFlow(sim, ctx);
      const f = flowTotals(sim);
      expect(f.produced).toBe(
        f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
      );
    }
    const [a, b] = got(sim.refineries).map((r) => r.produced);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(flowTotals(sim).lost).toBe(0);
    const delivered = got(sim.consumers.find((x) => x.building === sink))
      .inputs[0]?.delivered;
    expect(delivered).toBeGreaterThan(((a as number) + (b as number)) * 0.9);
  });

  test('cloneBoardSim copies the refineries', () => {
    const c = chain('ab');
    const { sim } = run(c, 100);
    const copy = cloneBoardSim(sim);
    expect(copy).toEqual(sim);
    got(copy.refineries)[0]?.counters.fill(9);
    expect(got(sim.refineries)[0]?.counters).not.toEqual([9, 9]);
  });
});

describe('a refinery destroyed in the middle of a battle', () => {
  test('its store is lost, everything downstream starves, conservation holds', () => {
    const c = chain('ab');
    const { sim } = run(c, 600); // backed up: the store holds items
    const r = got(sim.refineries?.[0]);
    expect(r.store).toBeGreaterThan(0);
    const store = r.store;
    const state = c.lab.state;
    const open = new Set(brokenLinks(state, withSinks).map((l) => l.sending));
    const lost = new Set(conduitsLostWith(state.conduits, c.refinery, open));
    const next: TeamState = {
      ...state,
      buildings: state.buildings.filter((b) => b.id !== c.refinery),
      conduits: state.conduits.filter((x) => !lost.has(x.id)),
    };
    const before = flowTotals(sim);
    const rebuilt = rebuildFlow(sim, next, withSinks, simConfig);
    expect(rebuilt.sim.refineries).toBeUndefined();
    const after = flowTotals(rebuilt.sim);
    expect(after.produced).toBe(before.produced);
    // The store, the refinery's buffers and the conduits that went with it
    // are lost; the consumer keeps what it has already received.
    expect(after.lost - before.lost).toBeGreaterThanOrEqual(store);
    expect(after.held).toBe(0);
    expect(after.produced).toBe(
      after.inConduits +
        after.held +
        after.inBuffers +
        after.consumed +
        after.lost,
    );
    const delivered = (s: BoardSim) =>
      got(s.consumers.find((x) => x.building === c.sink)).inputs[0]?.delivered;
    const d0 = delivered(rebuilt.sim);
    const flow = createFlowContext(next, withSinks, simConfig, {});
    for (let t = 0; t < 300; t++) {
      stepFlow(rebuilt.sim, { ...flow, plan: rebuilt.plan });
      const f = flowTotals(rebuilt.sim);
      expect(f.produced).toBe(
        f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
      );
    }
    expect(delivered(rebuilt.sim)).toBe(d0);
  });

  test('a surviving refinery keeps its state through a rebuild', () => {
    const c = chain('ab');
    const { sim } = run(c, 300);
    const before = JSON.parse(JSON.stringify(sim.refineries)) as unknown;
    const rebuilt = rebuildFlow(sim, c.lab.state, withSinks, simConfig);
    expect(rebuilt.sim.refineries).toEqual(before);
  });
});

describe('a refinery fed over a border link', () => {
  test('an Aether refinery takes Flux from a partner over a border link', () => {
    const map = {
      width: 24,
      height: 16,
      partySize: 2,
      plotWidth: 12,
      features: [],
      nodes: [
        { x: 15, y: 0, resource: 'res_b' },
        { x: 2, y: 2, resource: 'res_c' },
      ],
    };
    const lab = new Lab(map, withSinks);
    lab.core(5, 0, 0);
    lab.core(17, 0, 1);
    const flux = lab.put('bld_extractor', 2, 2, 0, 3);
    const power = lab.put('bld_extractor', 15, 0, 0, 3);
    const ref = lab.put('bld_refinery_bc', 15, 3, 0, 3);
    const sink = lab.put('bld_sink_bc', 15, 8);
    const cell = (x: number, y: number) => ({ x, y });
    const send = addConduit(lab.state, withSinks, {
      actor: 0,
      from: { building: flux, side: 'north' },
      to: { border: 0, y: 3 },
      cells: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((x) => cell(x, 3)),
    });
    if (!send.ok) throw new Error(send.reason);
    lab.state = send.state;
    const recv = addConduit(lab.state, withSinks, {
      actor: 1,
      from: { border: 0, y: 3 },
      to: { building: ref, side: 'west' },
      cells: [12, 13, 14].map((x) => cell(x, 3)),
    });
    if (!recv.ok) throw new Error(recv.reason);
    lab.state = recv.state;
    lab.link(power, 'north', ref, 'south', [
      [15, 1],
      [15, 2],
    ]);
    lab.link(ref, 'north', sink, 'south', [
      [15, 5],
      [15, 6],
      [15, 7],
    ]);
    expect(conduitResource(lab.state, withSinks, send.id)).toBe('res_c');
    const out = got(
      lab.state.conduits.find(
        (x) => 'building' in x.to && x.to.building === sink,
      ),
    );
    expect(conduitResource(lab.state, withSinks, out.id)).toBe(
      'res_bc_refined',
    );
    const sim = createBoardSim(lab.state, withSinks, simConfig);
    const ctx = createFlowContext(lab.state, withSinks, simConfig, {
      consumers: 'need',
    });
    for (let t = 0; t < 1000; t++) {
      stepFlow(sim, ctx);
      const f = flowTotals(sim);
      expect(f.produced).toBe(
        f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
      );
    }
    const r = got(sim.refineries?.[0]);
    expect(r.batches).toBeGreaterThan(28);
    expect(r.resource).toBe('res_bc_refined');
    expect(flowTotals(sim).lost).toBe(0);
  });
});

describe('the dry run with refineries', () => {
  test('reports the need per input, the output per 1000 ticks and the real output', () => {
    const c = chain('ab');
    const r = dryRunFlow(c.lab.state, withSinks, simConfig, 2000, 'need');
    const need = got(r.needs?.find((n) => n.building === c.refinery));
    expect(need.needPer1000).toBe(200);
    expect(need.needPer1000By).toEqual([
      { resource: 'res_a', needPer1000: 100 },
      { resource: 'res_b', needPer1000: 100 },
    ]);
    expect(need.outputPer1000).toBe(66);
    expect(need.productions).toBeGreaterThanOrEqual(64);
    // The consumer of the chain is a need entry too, without outputPer1000.
    const sinkNeed = got(r.needs?.find((n) => n.building === c.sink));
    expect(sinkNeed.outputPer1000).toBeUndefined();
    expect(sinkNeed.productions).toBeGreaterThanOrEqual(
      2 * need.productions - 8,
    );
    const row = got(r.refineries?.find((x) => x.building === c.refinery));
    expect(row.resource).toBe('res_ab_refined');
    expect(row.ratePer1000).toBe(66);
    expect(row.lost).toBe(0);
    // A board without a refinery has no `refineries` entry.
    const none = dryRunFlow(
      new Lab(tinyMap(), withSinks).state,
      withSinks,
      simConfig,
      10,
    );
    expect(none.refineries).toBeUndefined();
  });

  test('the output is limited by the slowest input', () => {
    const c = chain('ab');
    const slow = new Lab(
      tinyMap([
        [3, 2, 'res_b'],
        [5, 2, 'res_a'],
      ]),
      withSinks,
    );
    slow.core(8, 0);
    const ref = slow.put('bld_refinery_ab', 5, 5, 0, 3);
    const a = slow.put('bld_extractor', 5, 2, 0, 3);
    const b = slow.put('bld_extractor', 3, 2, 0, 1); // 50 per 1000 ticks
    slow.link(a, 'north', ref, 'south', [
      [5, 3],
      [5, 4],
    ]);
    slow.link(b, 'north', ref, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
    const sink = slow.put('bld_sink_ab', 5, 10);
    slow.link(ref, 'north', sink, 'south', [
      [5, 7],
      [5, 8],
      [5, 9],
    ]);
    const r = dryRunFlow(slow.state, withSinks, simConfig, 3000, 'need');
    const row = got(r.refineries?.[0]);
    // 50 Power per 1000 ticks make 50 / 3 batches of 2: 33 per 1000 ticks.
    expect(row.ratePer1000).toBeGreaterThanOrEqual(32);
    expect(row.ratePer1000).toBeLessThanOrEqual(34);
    expect(row.ratePer1000).toBeLessThan(
      refineryOutputPer1000(got(withSinks.buildings.get('bld_refinery_ab')), 3),
    );
    // The Ore collector backs up behind the full Ore counter.
    expect(
      got(r.sources.find((s) => s.building === a)).stalledTicks,
    ).toBeGreaterThan(1000);
    expect(c.refinery).toBeGreaterThan(0);
  });

  test('drain mode does not drain a refinery', () => {
    const c = chain('bc');
    const r = dryRunFlow(c.lab.state, withSinks, simConfig, 1000, 'drain');
    const rate = got(r.refineries?.[0]).ratePer1000;
    expect(rate).toBeGreaterThanOrEqual(64);
    expect(rate).toBeLessThanOrEqual(70);
  });
});
