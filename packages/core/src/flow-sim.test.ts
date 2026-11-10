import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import mapgenJson from '../../../content/mapgen.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import simJson from '../../../content/sim.json';
import terrainJson from '../../../content/terrain.json';
import unitsJson from '../../../content/units.json';
import type { Side } from './buildings.js';
import { addConduit } from './conduits.js';
import { loadAllContentOrThrow } from './content.js';
import {
  cloneBoardSim,
  createBoardSim,
  createFlowContext,
  dryRunFlow,
  flowTotals,
  stepFlow,
  takeFromBuffer,
  type BoardSim,
  type FlowContext,
  type SimEvent,
} from './flow-sim.js';
import { generateMap } from './generate-map.js';
import { hashJson } from './hash.js';
import type { Cell, GameMap } from './map.js';
import { loadMapgenOrThrow } from './mapgen.js';
import { Rng } from './rng.js';
import { loadSimConfig, loadSimConfigOrThrow } from './sim-config.js';
import {
  addToStash,
  createTeamState,
  occupancy,
  placeFromStash,
  type TeamState,
} from './team-state.js';

const content = loadAllContentOrThrow({
  resources: resourcesJson,
  terrain: terrainJson,
  units: unitsJson,
  buildings: buildingsJson,
  presentation: presentationJson,
});
const mapgen = loadMapgenOrThrow(mapgenJson, { terrain: content.terrain });
const simConfig = loadSimConfigOrThrow(simJson);

// ---------------------------------------------------------------------------
// Helpers

function got<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing value');
  return v;
}

/** An open 24 x 16 board with the given nodes. */
function board(
  nodes: [number, number, string][],
  width = 24,
  partySize = 1,
): GameMap {
  return {
    width,
    height: 16,
    partySize,
    plotWidth: width / partySize,
    features: [],
    nodes: nodes.map(([x, y, resource]) => ({ x, y, resource })),
  };
}

type Pairs = [number, number][];

class Lab {
  state: TeamState;
  constructor(map: GameMap) {
    this.state = createTeamState(map);
  }
  put(def: string, x: number, y: number, rotation = 0, tier = 1): number {
    const s = addToStash(this.state, content, { def, tier, owner: 0 });
    if (!s.ok) throw new Error(s.reason);
    const p = placeFromStash(s.state, content, { id: s.id, x, y, rotation });
    if (!p.ok) throw new Error(`${def}: ${p.reason}`);
    this.state = p.state;
    return s.id;
  }
  link(
    from: number,
    fromSide: Side,
    to: number,
    toSide: Side,
    cells: Pairs = [],
  ): number {
    const r = addConduit(this.state, content, {
      from: { building: from, side: fromSide },
      to: { building: to, side: toSide },
      cells: cells.map(([x, y]) => ({ x, y })),
    });
    if (!r.ok) throw new Error(`link: ${r.reason} ${r.detail ?? ''}`);
    this.state = r.state;
    return r.id;
  }
}

interface Run {
  sim: BoardSim;
  ctx: FlowContext;
  events: SimEvent[];
}

function start(state: TeamState, mode: 'hold' | 'drain'): Run {
  const events: SimEvent[] = [];
  return {
    sim: createBoardSim(state, content, simConfig),
    ctx: createFlowContext(state, content, simConfig, {
      consumers: mode,
      events,
    }),
    events,
  };
}

function run(r: Run, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepFlow(r.sim, r.ctx);
}

const delivered = (r: Run, building: number): number[] =>
  r.events
    .filter((e) => e.type === 'delivered' && e.building === building)
    .map((e) => e.tick);

/** Source at (2,2) -> conduit of `len` cells going north -> barracks. */
function straight(
  len: number,
  tier = 1,
): { lab: Lab; src: number; cons: number } {
  const lab = new Lab(board([[2, 2, 'res_a']]));
  const src = lab.put('bld_extractor', 2, 2, 0, tier);
  const cons = lab.put('bld_barracks', 2, 3 + len);
  const cells: Pairs = [];
  for (let k = 0; k < len; k++) cells.push([2, 3 + k]);
  lab.link(src, 'north', cons, 'south', cells);
  return { lab, src, cons };
}

// ---------------------------------------------------------------------------

describe('simulation config', () => {
  test('content/sim.json loads', () => {
    expect(simConfig).toEqual({ ticksPerSecond: 10, inputBufferUnits: 4 });
  });
  test('bad data is reported', () => {
    expect(loadSimConfig(null).ok).toBe(false);
    expect(loadSimConfig({ ticksPerSecond: 10 }).ok).toBe(false);
    expect(loadSimConfig({ ticksPerSecond: 0, inputBufferUnits: 4 }).ok).toBe(
      false,
    );
    const r = loadSimConfig({
      ticksPerSecond: 10,
      inputBufferUnits: 4,
      extra: 1,
    });
    expect(r.ok).toBe(false);
    expect(() => loadSimConfigOrThrow({})).toThrow(/ticksPerSecond/);
  });
});

describe('cold start', () => {
  test('initial state is empty with full countdowns', () => {
    const { lab, src, cons } = straight(4);
    const sim = createBoardSim(lab.state, content, simConfig);
    expect(sim.tick).toBe(0);
    expect(sim.bufferCapacity).toBe(4);
    expect(sim.sources).toEqual([
      {
        building: src,
        resource: 'res_a',
        countdown: 20,
        stalled: 0,
        pointer: 0,
        produced: 0,
        lost: 0,
        stalledTicks: 0,
      },
    ]);
    expect(sim.conduits).toHaveLength(1);
    expect(sim.conduits[0]?.slots).toEqual([null, null, null, null]);
    expect(sim.consumers).toEqual([
      {
        building: cons,
        inputs: [
          {
            side: 'south',
            resource: 'res_a',
            count: 0,
            delivered: 0,
            consumed: 0,
          },
        ],
      },
    ]);
    expect(flowTotals(sim)).toEqual({
      produced: 0,
      inConduits: 0,
      held: 0,
      inBuffers: 0,
      consumed: 0,
      lost: 0,
    });
  });

  test('a source uses its tier interval', () => {
    const { lab } = straight(2, 3);
    expect(
      got(createBoardSim(lab.state, content, simConfig).sources[0]).countdown,
    ).toBe(10);
  });

  test('state is plain JSON', () => {
    const { lab } = straight(4);
    const r = start(lab.state, 'hold');
    run(r, 50);
    expect(JSON.parse(JSON.stringify(r.sim))).toEqual(r.sim);
    expect(cloneBoardSim(r.sim)).toEqual(r.sim);
  });
});

describe('(a) one source, one conduit, one consumer', () => {
  /*
   * Source interval I = 20, conduit of L cells, drain mode. Steps are numbered
   * from 1 (a step is one tick). The countdown starts at I and drops by one in
   * each step 3, so the first item is made in step I and enters slot 0. It
   * advances one slot per step, reaches slot L-1 in step I+L-1, and is handed
   * over in step 1 of step I+L. Later items follow every I steps. After N
   * steps the deliveries are the k >= 1 with I*k + L <= N, which is
   * floor((N - L) / I) (zero when N < I + L). The event `tick` is the step
   * number minus one.
   */
  test.each([
    { len: 4, steps: 200, first: 24, total: 9 }, // k*20+4 <= 200 -> k <= 9.8
    { len: 4, steps: 23, first: 24, total: 0 }, // I + L = 24 > 23
    { len: 4, steps: 24, first: 24, total: 1 }, // exactly the first delivery
    { len: 0, steps: 100, first: 20, total: 5 }, // direct: delivered the step it is made
    { len: 1, steps: 100, first: 21, total: 4 }, // k*20+1 <= 100 -> k <= 4.95
    { len: 7, steps: 247, first: 27, total: 12 }, // k*20+7 <= 247 -> k <= 12
  ])('L=$len, N=$steps', ({ len, steps, first, total }) => {
    const { lab, cons } = straight(len);
    const r = start(lab.state, 'drain');
    run(r, steps);
    const ticks = delivered(r, cons);
    expect(ticks).toHaveLength(total);
    if (total > 0) expect(ticks[0]).toBe(first - 1);
    for (let k = 1; k < ticks.length; k++) {
      expect(got(ticks[k]) - got(ticks[k - 1])).toBe(20);
    }
    expect(got(r.sim.consumers[0]).inputs[0]?.delivered).toBe(total);
  });

  test('tier 3 source (interval 10), L=3, N=100', () => {
    // k*10 + 3 <= 100 -> k <= 9.7 -> 9 deliveries, the first in step 13.
    const { lab, cons } = straight(3, 3);
    const r = start(lab.state, 'drain');
    run(r, 100);
    const ticks = delivered(r, cons);
    expect(ticks).toHaveLength(9);
    expect(ticks[0]).toBe(12);
  });

  test('produced events come from the source at its interval', () => {
    const { lab, src } = straight(4);
    const r = start(lab.state, 'drain');
    run(r, 60);
    expect(r.events.filter((e) => e.type === 'produced')).toEqual(
      [19, 39, 59].map((tick) => ({
        tick,
        type: 'produced',
        building: src,
        resource: 'res_a',
      })),
    );
  });
});

describe('(b) a splitter feeding two consumers', () => {
  function splitterBoard(): { lab: Lab; b1: number; b2: number; sp: number } {
    const lab = new Lab(board([[10, 2, 'res_a']]));
    const src = lab.put('bld_extractor', 10, 2);
    const sp = lab.put('bld_splitter', 10, 3);
    const b1 = lab.put('bld_barracks', 10, 4); // direct from the splitter's north
    const b2 = lab.put('bld_barracks', 13, 3, 90); // two-cell conduit from the east
    lab.link(src, 'north', sp, 'south');
    lab.link(sp, 'north', b1, 'south');
    lab.link(sp, 'east', b2, 'west', [
      [11, 3],
      [12, 3],
    ]);
    return { lab, b1, b2, sp };
  }

  /*
   * I = 20, N = 200. Item j is made in step 20j and sits in the splitter's
   * holding cell; the splitter pushes it in step 2 of step 20j+1. The pointer
   * starts at output 0 (north), so items alternate north, east, north, ...
   * (the west output has no conduit and is skipped). North is a direct
   * connection: item j (odd) is delivered in step 20j+1: j = 1,3,5,7,9 (the
   * next, j = 11, would be step 221) -> 5. East has L = 2: item j (even) is
   * delivered in step 20j+1+2: j = 2,4,6,8 (j = 10 would be step 203) -> 4.
   * The split is 5 / 4: even to within one.
   */
  test('alternates between the two outputs', () => {
    const { lab, b1, b2 } = splitterBoard();
    const r = start(lab.state, 'drain');
    run(r, 200);
    expect(delivered(r, b1)).toEqual([20, 60, 100, 140, 180]);
    expect(delivered(r, b2)).toEqual([42, 82, 122, 162]);
  });

  test('over a long run the split stays within one', () => {
    const { lab, b1, b2 } = splitterBoard();
    const r = start(lab.state, 'drain');
    run(r, 2000);
    const n1 = delivered(r, b1).length;
    const n2 = delivered(r, b2).length;
    expect(Math.abs(n1 - n2)).toBeLessThanOrEqual(1);
    expect(n1 + n2).toBeGreaterThanOrEqual(98);
  });

  test('dry-run rates use the second half only', () => {
    // 1000 ticks, window = ticks 500..999 (0-based). North deliveries are at
    // 20j, j odd: j = 25..49 -> 13 -> 26 per 1000 ticks. East deliveries are
    // at 20j+2, j even: j = 26..48 -> 12 -> 24 per 1000 ticks.
    const { lab, b1, b2 } = splitterBoard();
    const d = dryRunFlow(lab.state, content, simConfig, 1000);
    expect(d.consumers).toEqual([
      expect.objectContaining({ building: b1, ratePer1000: 26 }),
      expect.objectContaining({ building: b2, ratePer1000: 24 }),
    ]);
    expect(d.sources[0]).toMatchObject({
      produced: 50,
      lost: 0,
      stalledTicks: 0,
    });
    expect(d.routes).toEqual([expect.objectContaining({ lost: 0 })]);
  });

  test('an unconnected output is skipped, not a dead end', () => {
    // Only the east output is connected: every item goes there, none is lost.
    const lab = new Lab(board([[10, 2, 'res_a']]));
    const src = lab.put('bld_extractor', 10, 2);
    const sp = lab.put('bld_splitter', 10, 3);
    const b2 = lab.put('bld_barracks', 13, 3, 90);
    lab.link(src, 'north', sp, 'south');
    lab.link(sp, 'east', b2, 'west', [
      [11, 3],
      [12, 3],
    ]);
    const r = start(lab.state, 'drain');
    run(r, 100);
    expect(delivered(r, b2)).toEqual([22, 42, 62, 82]); // every item: 20j+3 <= 100
    expect(flowTotals(r.sim).lost).toBe(0);
  });

  test('a full output makes the splitter use the next one', () => {
    // Hold mode: the east barracks fills (4) and its conduit fills (2); the
    // north barracks keeps receiving, so nothing stalls early.
    const { lab, b1, b2 } = splitterBoard();
    const r = start(lab.state, 'hold');
    run(r, 400);
    const total = flowTotals(r.sim);
    expect(total.lost).toBe(0);
    const buf = (b: number): number =>
      got(r.sim.consumers.find((c) => c.building === b)).inputs[0]?.count ?? -1;
    expect(buf(b1)).toBe(4);
    expect(buf(b2)).toBe(4);
  });
});

describe('(c) a merger joining two sources of one resource', () => {
  function mergerBoard(len = 0): {
    lab: Lab;
    a: number;
    b: number;
    m: number;
    cons: number;
  } {
    const lab = new Lab(
      board([
        [0, 3, 'res_a'],
        [6, 3, 'res_a'],
        [2, 3, 'res_a'],
        [4, 3, 'res_a'],
      ]),
    );
    const near = len === 0;
    const a = lab.put('bld_extractor', near ? 2 : 0, 3, 90); // east output
    const b = lab.put('bld_extractor', near ? 4 : 6, 3, 270); // west output
    const m = lab.put('bld_merger', 3, 3);
    const cons = lab.put('bld_barracks', 3, 4);
    lab.link(
      a,
      'east',
      m,
      'west',
      near
        ? []
        : [
            [1, 3],
            [2, 3],
          ],
    );
    lab.link(
      b,
      'west',
      m,
      'east',
      near
        ? []
        : [
            [5, 3],
            [4, 3],
          ],
    );
    lab.link(m, 'north', cons, 'south');
    return { lab, a, b, m, cons };
  }

  /*
   * Both sources have I = 20 and both direct-connect to the merger, which
   * connects directly to the barracks. Step 20: source A (lower ID) puts its
   * item in the merger's empty cell; source B finds the cell full, stalls (one
   * `stalled` event), and keeps its countdown at 0. Step 21: the merger pushes
   * A's item to the barracks (delivered in step 21), then B's attempt
   * succeeds and its countdown restarts at 20. Step 22: the merger pushes B's
   * item (delivered in step 22). From then A is made in steps 20j and B in
   * 20j+1, so deliveries are at steps 20j+1 (A) and 20j+2 (B). With N = 100:
   * j = 1..4 for each (j = 5 would be step 101) -> 4 + 4 = 8.
   */
  test('same-step arrivals take turns without loss', () => {
    const { lab, cons } = mergerBoard();
    const r = start(lab.state, 'drain');
    run(r, 100);
    expect(delivered(r, cons)).toEqual(
      [20, 21, 40, 41, 60, 61, 80, 81].map((t) => t),
    );
    expect(flowTotals(r.sim).lost).toBe(0);
    const stalls = r.events.filter((e) => e.type === 'stalled');
    expect(stalls).toEqual([{ tick: 19, type: 'stalled', building: 2 }]);
    expect(got(r.sim.sources[1]).stalledTicks).toBe(1);
  });

  test('a merger takes turns between its inputs when both back up', () => {
    // Conduits of two cells on each side. Hold mode until everything is
    // backed up, then free one unit every 10 ticks for 8 takes. Each take lets
    // exactly one item through the merger, from the input at the pointer, so
    // the two sources each make 4 more items (the pointer alternates).
    const { lab, cons } = mergerBoard(2);
    const r = start(lab.state, 'hold');
    run(r, 400);
    const before = [0, 1].map((i) => got(r.sim.sources[i]).produced);
    expect(got(r.sim.sources[0]).stalled).toBe(1);
    expect(got(r.sim.sources[1]).stalled).toBe(1);
    for (let k = 0; k < 8; k++) {
      expect(takeFromBuffer(r.sim, cons, 'south', 1)).toBe(true);
      run(r, 10);
    }
    const after = [0, 1].map((i) => got(r.sim.sources[i]).produced);
    const dA = got(after[0]) - got(before[0]);
    const dB = got(after[1]) - got(before[1]);
    expect(dA + dB).toBe(8);
    expect(Math.abs(dA - dB)).toBeLessThanOrEqual(1);
  });
});

describe('crossover with two resources', () => {
  /*
   * Sources A (res_a at (12,2), north) and B (res_b at (11,3), turned east)
   * enter the crossover at (12,3) from the south and west; its channels leave
   * north (to a barracks, res_a) and east (to a turret, res_b). All
   * connections are direct. Each source is made in steps 20j and the channel
   * pushes it in step 20j+1, so each consumer is delivered in steps 20j+1.
   * N = 100 -> j = 1..4 -> 4 each, and the resources never mix.
   */
  test('channels carry their own resource', () => {
    const lab = new Lab(
      board([
        [12, 2, 'res_a'],
        [11, 3, 'res_b'],
      ]),
    );
    const sa = lab.put('bld_extractor', 12, 2);
    const sb = lab.put('bld_extractor', 11, 3, 90);
    const x = lab.put('bld_crossover', 12, 3);
    const bar = lab.put('bld_barracks', 12, 4);
    const tur = lab.put('bld_turret', 13, 3, 90);
    lab.link(sa, 'north', x, 'south');
    lab.link(sb, 'east', x, 'west');
    lab.link(x, 'north', bar, 'south');
    lab.link(x, 'east', tur, 'west');
    const r = start(lab.state, 'drain');
    run(r, 100);
    expect(delivered(r, bar)).toEqual([20, 40, 60, 80]);
    expect(delivered(r, tur)).toEqual([20, 40, 60, 80]);
    for (const e of r.events) {
      if (e.type !== 'delivered') continue;
      expect(e.resource).toBe(e.building === bar ? 'res_a' : 'res_b');
    }
    expect(flowTotals(r.sim).lost).toBe(0);
  });
});

describe('(d) backpressure in hold mode', () => {
  /*
   * L = 3, I = 20, buffer 4. Item j is made in step 20j and is delivered in
   * step 20j+3 while the buffer has room: items 1-4 fill the buffer. Items 5,
   * 6, 7 (made in steps 100, 120, 140) back up in slots 2, 1, 0 and the
   * conduit is full. In step 160 the source has item 8 and slot 0 is taken, so
   * it stalls (event tick 159) with countdown 0, and stays stalled. After 400
   * steps: produced 7, delivered 4, in conduit 3, nothing lost, and stalled
   * for steps 160..400 = 241 ticks.
   */
  test('the buffer fills, the conduit fills, the source stalls', () => {
    const { lab, src, cons } = straight(3);
    const r = start(lab.state, 'hold');
    run(r, 400);
    const s = got(r.sim.sources[0]);
    expect(s).toMatchObject({
      building: src,
      produced: 7,
      lost: 0,
      stalled: 1,
      countdown: 0,
      stalledTicks: 241,
    });
    const input = got(got(r.sim.consumers[0]).inputs[0]);
    expect(input).toMatchObject({ count: 4, delivered: 4, consumed: 0 });
    expect(got(r.sim.conduits[0]).slots).toEqual(['res_a', 'res_a', 'res_a']);
    expect(flowTotals(r.sim)).toEqual({
      produced: 7,
      inConduits: 3,
      held: 0,
      inBuffers: 4,
      consumed: 0,
      lost: 0,
    });
    expect(r.events.filter((e) => e.type === 'stalled')).toEqual([
      { tick: 159, type: 'stalled', building: src },
    ]);
    expect(r.events.some((e) => e.type === 'lost')).toBe(false);
    expect(delivered(r, cons)).toEqual([22, 42, 62, 82]);
  });

  test('freeing one unit lets the whole line move in a single tick', () => {
    const { lab, cons } = straight(3);
    const r = start(lab.state, 'hold');
    run(r, 400);
    expect(takeFromBuffer(r.sim, cons, 'res_a', 5)).toBe(false);
    expect(takeFromBuffer(r.sim, cons, 'res_a', 1)).toBe(true);
    stepFlow(r.sim, r.ctx);
    // Downstream first: the last slot delivers, the others shift, the stalled
    // source then fills slot 0, all in one step.
    expect(got(r.sim.consumers[0]).inputs[0]?.count).toBe(4);
    expect(got(r.sim.conduits[0]).slots).toEqual(['res_a', 'res_a', 'res_a']);
    expect(got(r.sim.sources[0]).stalled).toBe(0);
    expect(got(r.sim.sources[0]).countdown).toBe(20);
    expect(got(r.sim.sources[0]).produced).toBe(8);
  });
});

describe('dead ends', () => {
  test('a source with no conduit loses every item', () => {
    const lab = new Lab(board([[2, 2, 'res_a']]));
    const src = lab.put('bld_extractor', 2, 2);
    const r = start(lab.state, 'drain');
    run(r, 60);
    expect(r.events).toEqual(
      [19, 39, 59].flatMap((tick) => [
        { tick, type: 'produced', building: src, resource: 'res_a' },
        { tick, type: 'lost', building: src, resource: 'res_a' },
      ]),
    );
    expect(flowTotals(r.sim)).toMatchObject({ produced: 3, lost: 3 });
  });

  test('a splitter with no output conduit loses the item', () => {
    const lab = new Lab(board([[10, 2, 'res_a']]));
    const src = lab.put('bld_extractor', 10, 2);
    const sp = lab.put('bld_splitter', 10, 3);
    lab.link(src, 'north', sp, 'south');
    const r = start(lab.state, 'drain');
    run(r, 41);
    const lost = r.events.filter((e) => e.type === 'lost');
    expect(lost).toEqual([
      { tick: 20, type: 'lost', building: sp, resource: 'res_a' },
      { tick: 40, type: 'lost', building: sp, resource: 'res_a' },
    ]);
    expect(flowTotals(r.sim)).toMatchObject({ produced: 2, lost: 2, held: 0 });
  });

  test('a merger and a crossover channel with no output conduit lose items', () => {
    const lab = new Lab(
      board([
        [3, 2, 'res_a'],
        [12, 2, 'res_a'],
      ]),
    );
    const s1 = lab.put('bld_extractor', 3, 2);
    const m = lab.put('bld_merger', 3, 3);
    const s2 = lab.put('bld_extractor', 12, 2);
    const x = lab.put('bld_crossover', 12, 3);
    lab.link(s1, 'north', m, 'south');
    lab.link(s2, 'north', x, 'south');
    const r = start(lab.state, 'drain');
    run(r, 41);
    const lostAt = r.events
      .filter((e) => e.type === 'lost')
      .map((e) => e.building);
    expect(lostAt).toEqual([m, x, m, x]);
    expect(flowTotals(r.sim)).toMatchObject({ produced: 4, lost: 4 });
  });
});

describe('consumer seam', () => {
  test('takeFromBuffer by side and by resource', () => {
    const { lab, cons } = straight(0);
    const r = start(lab.state, 'hold');
    run(r, 60); // items at steps 20, 40, 60
    expect(got(r.sim.consumers[0]).inputs[0]?.count).toBe(3);
    expect(takeFromBuffer(r.sim, cons, 'south', 4)).toBe(false);
    expect(got(r.sim.consumers[0]).inputs[0]?.count).toBe(3);
    expect(takeFromBuffer(r.sim, cons, 'south', 2)).toBe(true);
    expect(takeFromBuffer(r.sim, cons, 'res_a', 1)).toBe(true);
    expect(takeFromBuffer(r.sim, cons, 'res_a', 1)).toBe(false);
    expect(takeFromBuffer(r.sim, cons, 'res_b', 1)).toBe(false);
    expect(takeFromBuffer(r.sim, 999, 'south', 1)).toBe(false);
    expect(takeFromBuffer(r.sim, cons, 'south', 0)).toBe(true);
    expect(got(r.sim.consumers[0]).inputs[0]).toMatchObject({
      count: 0,
      delivered: 3,
      consumed: 3,
    });
    expect(() => takeFromBuffer(r.sim, cons, 'south', -1)).toThrow();
  });

  test('drain mode counts everything as consumed', () => {
    const { lab } = straight(2);
    const r = start(lab.state, 'drain');
    run(r, 100);
    const t = flowTotals(r.sim);
    expect(t.inBuffers).toBe(0);
    expect(t.consumed).toBe(got(r.sim.consumers[0]).inputs[0]?.delivered);
  });
});

describe('determinism', () => {
  test('two runs give identical state and event hashes', () => {
    const { lab } = straight(5);
    const a = start(lab.state, 'hold');
    const b = start(lab.state, 'hold');
    run(a, 333);
    run(b, 333);
    expect(hashJson(a.sim)).toBe(hashJson(b.sim));
    expect(hashJson(a.events)).toBe(hashJson(b.events));
  });

  test('stepping a clone does not touch the original', () => {
    const { lab } = straight(5);
    const a = start(lab.state, 'hold');
    run(a, 70);
    const snapshot = hashJson(a.sim);
    const copy = cloneBoardSim(a.sim);
    const events: SimEvent[] = [];
    const ctx = { ...a.ctx, events };
    for (let i = 0; i < 100; i++) stepFlow(copy, ctx);
    expect(hashJson(a.sim)).toBe(snapshot);
    run(a, 100);
    expect(hashJson(a.sim)).toBe(hashJson(copy));
  });
});

// ---------------------------------------------------------------------------
// Property: conservation over random networks

/** A shortest free path between the cells outside two sides, or null. */
function route(
  state: TeamState,
  from: Cell[],
  to: Cell[],
  occ: ReturnType<typeof occupancy>,
  used: Set<number>,
): Cell[] | null {
  const { width, height } = state.map;
  const free = (c: Cell): boolean =>
    c.x >= 0 &&
    c.y >= 0 &&
    c.x < width &&
    c.y < height &&
    occ.buildingAt(c.x, c.y) === null &&
    !used.has(c.y * width + c.x) &&
    !state.map.features.some((f) => f.x === c.x && f.y === c.y);
  const goal = new Set(to.map((c) => c.y * width + c.x));
  const prev = new Map<number, number>();
  const queue: Cell[] = [];
  for (const c of from) {
    if (free(c) && !prev.has(c.y * width + c.x)) {
      prev.set(c.y * width + c.x, -1);
      queue.push(c);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = got(queue[head]);
    const k = c.y * width + c.x;
    if (goal.has(k)) {
      const out: Cell[] = [];
      for (let at = k; at !== -1; at = got(prev.get(at))) {
        out.push({ x: at % width, y: Math.floor(at / width) });
      }
      return out.reverse();
    }
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as const) {
      const n = { x: c.x + dx, y: c.y + dy };
      const nk = n.y * width + n.x;
      if (free(n) && !prev.has(nk)) {
        prev.set(nk, k);
        queue.push(n);
      }
    }
  }
  return null;
}

/** Cells just outside a building's side, in increasing coordinate order. */
function outside(cells: Cell[], side: Side): Cell[] {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const [x0, x1, y0, y1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const out: Cell[] = [];
  if (side === 'north')
    for (let x = x0; x <= x1; x++) out.push({ x, y: y1 + 1 });
  if (side === 'south')
    for (let x = x0; x <= x1; x++) out.push({ x, y: y0 - 1 });
  if (side === 'east')
    for (let y = y0; y <= y1; y++) out.push({ x: x1 + 1, y });
  if (side === 'west')
    for (let y = y0; y <= y1; y++) out.push({ x: x0 - 1, y });
  return out;
}

/** A random valid network on a generated map (sources on nodes, BFS conduits). */
function randomNetwork(seed: number): TeamState {
  const partySize = 1 + (seed % 3);
  const m = generateMap(seed, partySize, content, mapgen);
  const rng = Rng.fromSeed(seed * 7919);
  let s = createTeamState(m);
  const defs = content.buildings
    .list()
    .filter((b) => b.kind !== 'core')
    .map((b) => b.id);
  const sources = defs.filter(
    (d) => content.buildings.get(d)?.kind === 'source',
  );
  const rest = defs.filter((d) => content.buildings.get(d)?.kind !== 'source');
  for (let step = 0; step < 150; step++) {
    const roll = rng.nextInt(10);
    if (roll <= 4) {
      const wantSource = rng.nextInt(3) === 0;
      const def = wantSource
        ? got(sources[rng.nextInt(sources.length)])
        : got(rest[rng.nextInt(rest.length)]);
      const a = addToStash(s, content, {
        def,
        tier: 1 + rng.nextInt(3),
        owner: rng.nextInt(partySize),
      });
      if (!a.ok) continue;
      const n = got(m.nodes[rng.nextInt(m.nodes.length)]);
      const p = wantSource
        ? { x: n.x, y: n.y }
        : { x: rng.nextInt(m.width), y: rng.nextInt(m.height) };
      const placed = placeFromStash(a.state, content, {
        id: a.id,
        x: p.x,
        y: p.y,
        rotation: [0, 90, 180, 270][rng.nextInt(4)] as number,
      });
      s = placed.ok ? placed.state : a.state;
    } else if (s.buildings.length >= 2) {
      const occ = occupancy(s, content);
      const a = got(s.buildings[rng.nextInt(s.buildings.length)]);
      const b = got(s.buildings[rng.nextInt(s.buildings.length)]);
      const outs = occ.absoluteSides(a).outputs;
      const ins = occ.absoluteSides(b).inputs;
      if (outs.length === 0 || ins.length === 0) continue;
      const fromSide = got(outs[rng.nextInt(outs.length)]);
      const toSide = got(ins[rng.nextInt(ins.length)]).side;
      const used = new Set<number>();
      for (const c of s.conduits) {
        for (const k of c.cells) used.add(k.y * m.width + k.x);
      }
      const cells = route(
        s,
        outside(occ.cellsOf(a), fromSide),
        outside(occ.cellsOf(b), toSide),
        occ,
        used,
      );
      const r = addConduit(s, content, {
        from: { building: a.id, side: fromSide },
        to: { building: b.id, side: toSide },
        cells: cells ?? [],
      });
      if (r.ok) s = r.state;
    }
  }
  return s;
}

describe('property: conservation', () => {
  test('items are never created or destroyed except by production and loss', () => {
    let wired = 0;
    let delivered = 0;
    let lost = 0;
    let stalledTicks = 0;
    let heldSeen = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const state = randomNetwork(seed);
      wired += state.conduits.length;
      const mode = seed % 2 === 0 ? 'hold' : 'drain';
      const r = start(state, mode);
      for (let t = 0; t < 300; t++) {
        stepFlow(r.sim, r.ctx);
        const f = flowTotals(r.sim);
        expect(f.produced).toBe(
          f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
        );
        heldSeen += f.held;
        for (const c of r.sim.consumers) {
          for (const i of c.inputs) {
            expect(i.count).toBeLessThanOrEqual(r.sim.bufferCapacity);
            expect(i.count + i.consumed).toBe(i.delivered);
          }
        }
      }
      const f = flowTotals(r.sim);
      lost += f.lost;
      for (const c of r.sim.consumers) {
        for (const i of c.inputs) delivered += i.delivered;
      }
      for (const src of r.sim.sources) stalledTicks += src.stalledTicks;
      expect(r.sim.tick).toBe(300);
      // Events agree with the counters.
      expect(r.events.filter((e) => e.type === 'produced')).toHaveLength(
        f.produced,
      );
      expect(r.events.filter((e) => e.type === 'lost')).toHaveLength(f.lost);
    }
    // The generator really exercises flow, loss, stalling and routes.
    expect(wired).toBeGreaterThan(100);
    expect(delivered).toBeGreaterThan(100);
    expect(lost).toBeGreaterThan(0);
    expect(stalledTicks).toBeGreaterThan(0);
    expect(heldSeen).toBeGreaterThan(0);
  });

  test('random networks run identically twice', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const state = randomNetwork(seed);
      const a = start(state, 'hold');
      const b = start(state, 'hold');
      run(a, 200);
      run(b, 200);
      expect(hashJson(a.sim)).toBe(hashJson(b.sim));
      expect(hashJson(a.events)).toBe(hashJson(b.events));
    }
  });
});

// ---------------------------------------------------------------------------
// Performance

/**
 * A four-plot (96 x 16) board of 48 modules: a source, a two-cell conduit, a
 * splitter, a barracks directly north of the splitter and a barracks reached
 * through a one-cell conduit east. 48 sources, 48 splitters and 96 consumers.
 */
function bigBoard(): TeamState {
  const nodes: [number, number, string][] = [];
  for (let col = 0; col < 24; col++) {
    for (const y0 of [0, 8]) nodes.push([col * 4, y0, 'res_a']);
  }
  const lab = new Lab(board(nodes, 96, 4));
  for (let col = 0; col < 24; col++) {
    for (const y0 of [0, 8]) {
      const x0 = col * 4;
      const src = lab.put('bld_extractor', x0, y0);
      const sp = lab.put('bld_splitter', x0, y0 + 3);
      const a = lab.put('bld_barracks', x0, y0 + 4);
      const b = lab.put('bld_barracks', x0 + 2, y0 + 2, 90);
      lab.link(src, 'north', sp, 'south', [
        [x0, y0 + 1],
        [x0, y0 + 2],
      ]);
      lab.link(sp, 'north', a, 'south');
      lab.link(sp, 'east', b, 'west', [[x0 + 1, y0 + 3]]);
    }
  }
  return lab.state;
}

describe('performance', () => {
  test('a 2000-tick dry run of a large four-plot network', () => {
    const state = bigBoard();
    const sources = state.buildings.filter((b) => b.def === 'bld_extractor');
    expect(sources.length).toBeGreaterThanOrEqual(40);
    expect(state.buildings.length - sources.length).toBeGreaterThanOrEqual(80);
    expect(state.map.partySize).toBe(4);
    const t0 = Date.now();
    const d = dryRunFlow(state, content, simConfig, 2000);
    const ms = Date.now() - t0;
    // The threshold is generous so the test is never flaky; the message
    // carries the measured wall time when it does fail.
    expect(
      ms,
      `dryRunFlow of 2000 ticks on ${String(state.buildings.length)} buildings took ${String(ms)} ms`,
    ).toBeLessThan(10000);
    // Every source made 2000 / 20 = 100 items and none was lost or stalled.
    expect(d.sources).toHaveLength(48);
    for (const s of d.sources) {
      expect(s).toMatchObject({ produced: 100, lost: 0, stalledTicks: 0 });
    }
    expect(d.consumers).toHaveLength(96);
  });
});
