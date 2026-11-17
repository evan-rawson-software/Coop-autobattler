/**
 * The Grand barracks and several units per production (CB-9f, CB-10f, CB-13a;
 * issue #440): a 3x3 unit producer fed with Ore that spawns two soldiers per
 * production for 4 Ore each, so its need is exactly two collectors of its tier.
 */
import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaEvent,
} from './arena-sim.js';
import { dryRunFlow } from './flow-sim.js';
import {
  loadBuildings,
  needPer1000,
  productionOf,
  rotateBuilding,
} from './buildings.js';
import type { BuildingDef, Rotation } from './buildings.js';
import { MAX_UNITS_PER_PRODUCTION } from './limits.js';
import { occupancy } from './team-state.js';
import { coreOnlyTeam, tinyMap } from './testing/ramp-scenarios.js';
import { content, got, Lab, simConfig } from './testing/support.js';
import buildingsJson from '../../../content/buildings.json';

const GAP = 4;
const hall = () => got(content.buildings.get('bld_grand_barracks'));
const barracks = () => got(content.buildings.get('bld_barracks'));

function producer(def: BuildingDef) {
  if (def.kind !== 'unit_producer') throw new Error('kind');
  return def;
}

describe('the Grand barracks in content', () => {
  test('3x3, one Ore input on the south side, two soldiers per production', () => {
    const h = producer(hall());
    expect(h.unit).toBe('unit_soldier');
    expect(h.footprint).toEqual({ width: 3, height: 3 });
    expect(h.inputs).toEqual([{ resource: 'res_a', side: 'south' }]);
    expect(h.outputs).toEqual([]);
    expect(h.tiers.map((t) => t.health)).toEqual([150, 225, 300]);
    expect(h.tiers.map((t) => t.price)).toEqual([70, 140, 240]);
    expect(h.tiers.map((t) => t.costPerUnit)).toEqual([4, 4, 4]);
    expect(h.tiers.map((t) => t.unitsPerProduction)).toEqual([2, 2, 2]);
    expect(h.tiers.map((t) => t.productionIntervalTicks)).toEqual([80, 56, 40]);
  });

  test('every other producer makes one unit per production', () => {
    for (const def of content.buildings.list()) {
      if (def.kind !== 'unit_producer' || def.id === 'bld_grand_barracks')
        continue;
      expect(def.tiers.map((t) => t.unitsPerProduction)).toEqual([1, 1, 1]);
    }
  });

  test('a production costs costPerUnit times the units; per Ore it is 20% cheaper per unit', () => {
    const g = producer(hall());
    const b = producer(barracks());
    for (const tier of [1, 2, 3]) {
      expect(productionOf(hall(), tier)?.cost).toBe(8);
      expect(productionOf(barracks(), tier)?.cost).toBe(5);
      // 4 Ore a soldier against 5: 25% more soldiers per Ore.
      expect(
        5 / (g.tiers[tier - 1] as { costPerUnit: number }).costPerUnit,
      ).toBe(1.25);
      expect(b.tiers[tier - 1]?.unitsPerProduction).toBe(1);
    }
  });

  test('its need is exactly two collectors of its tier (twice a Barracks at 80% of its interval)', () => {
    // A collector of tier t gives 1 item per 20 / 14 / 10 ticks.
    const collector = [20, 14, 10];
    for (const tier of [1, 2, 3]) {
      const g = producer(hall()).tiers[tier - 1];
      const b = producer(barracks()).tiers[tier - 1];
      // 8 items per interval equals two collectors: 8 / interval = 2 / c.
      expect(8 * (collector[tier - 1] as number)).toBe(
        2 * (g?.productionIntervalTicks as number),
      );
      // Twice the Barracks' soldiers per tick at 80% of its interval.
      expect((g?.productionIntervalTicks as number) * 5).toBe(
        (b?.productionIntervalTicks as number) * 4,
      );
    }
    expect([1, 2, 3].map((t) => needPer1000(hall(), t))).toEqual([
      100, 142, 200,
    ]);
  });
});

describe('unitsPerProduction in the loader', () => {
  function load(patch: (tier: Record<string, unknown>) => void): string {
    const raw = JSON.parse(JSON.stringify(buildingsJson)) as {
      buildings: { id: string; tiers: Record<string, unknown>[] }[];
    };
    const g = got(raw.buildings.find((b) => b.id === 'bld_grand_barracks'));
    patch(got(g.tiers[0]));
    const r = loadBuildings(raw, {
      resources: content.resources,
      units: content.units,
    });
    return r.ok ? '' : r.errors.join('\n');
  }
  test('the shipped content loads', () => {
    expect(load(() => undefined)).toBe('');
  });
  test('absent means 1; 1 to the maximum is accepted', () => {
    expect(load((t) => delete t['unitsPerProduction'])).toBe('');
    expect(load((t) => (t['unitsPerProduction'] = 1))).toBe('');
    expect(
      load((t) => (t['unitsPerProduction'] = MAX_UNITS_PER_PRODUCTION)),
    ).toBe('');
    expect(MAX_UNITS_PER_PRODUCTION).toBe(4);
  });
  test('0, 5, a fraction, a string and null are refused', () => {
    for (const bad of [0, 5, 1.5, '2', -1, null]) {
      expect(load((t) => (t['unitsPerProduction'] = bad))).toContain(
        'unitsPerProduction',
      );
    }
  });
  test('it is not valid on another kind of building', () => {
    const raw = JSON.parse(JSON.stringify(buildingsJson)) as {
      buildings: { id: string; tiers: Record<string, unknown>[] }[];
    };
    const tier = got(
      got(raw.buildings.find((b) => b.id === 'bld_turret')).tiers[0],
    );
    tier['unitsPerProduction'] = 2;
    const r = loadBuildings(raw, {
      resources: content.resources,
      units: content.units,
    });
    expect(r.ok).toBe(false);
  });
});

/** Two collectors of tier `tier`, a merger and a Grand barracks above it. */
function farm(tier: number, collectors: 1 | 2 = 2) {
  const lab = new Lab(
    tinyMap([
      [3, 2, 'res_a'],
      [5, 2, 'res_a'],
    ]),
  );
  lab.core(8, 0);
  const a = lab.put('bld_extractor', 3, 2, 0, tier);
  const m = lab.put('bld_merger', 4, 4, 0, tier);
  const g = lab.put('bld_grand_barracks', 3, 6, 0, tier);
  lab.link(a, 'north', m, 'west', [
    [3, 3],
    [3, 4],
  ]);
  if (collectors === 2) {
    const b = lab.put('bld_extractor', 5, 2, 0, tier);
    lab.link(b, 'north', m, 'east', [
      [5, 3],
      [5, 4],
    ]);
  }
  lab.link(m, 'north', g, 'south', [[4, 5]]);
  return { lab, grand: g };
}

describe('two collectors feed a Grand barracks through a Merger', () => {
  test('at its top speed it takes 8 items per interval, and two collectors fully feed it', () => {
    for (const tier of [1, 2, 3]) {
      const { lab, grand } = farm(tier);
      const r = dryRunFlow(lab.state, content, simConfig, 3000, 'need');
      const need = got(r.needs?.find((n) => n.building === grand));
      const inp = got(r.consumers.find((c) => c.building === grand));
      // Collector rates per 1000 ticks: 50, 71, 100; two of them are 100,
      // 142 (floor of 142.9) and 200 = the need.
      expect(need.needPer1000).toBe([100, 142, 200][tier - 1] as number);
      for (const s of r.sources) {
        expect(s.stalledTicks).toBe(0);
        expect(s.lost).toBe(0);
      }
      expect(inp.ratePer1000).toBeGreaterThanOrEqual(need.needPer1000 - 1);
      expect(inp.ratePer1000).toBeLessThanOrEqual(need.needPer1000 + 2);
      // 8 items per production: one production per interval, every time.
      const interval = [80, 56, 40][tier - 1] as number;
      expect(need.productions).toBeGreaterThanOrEqual(
        Math.floor(3000 / interval) - 2,
      );
      expect(need.productions).toBe(Math.floor(inp.delivered / 8));
    }
  });

  test('one collector alone feeds it half the time (CB-10d)', () => {
    for (const tier of [1, 2, 3]) {
      const full = dryRunFlow(
        farm(tier).lab.state,
        content,
        simConfig,
        3000,
        'need',
      );
      const half = dryRunFlow(
        farm(tier, 1).lab.state,
        content,
        simConfig,
        3000,
        'need',
      );
      const grandOf = (r: typeof full) => got(r.needs?.[0]);
      const ratio =
        (grandOf(half).productions * 100) / grandOf(full).productions;
      expect(ratio).toBeGreaterThanOrEqual(48);
      expect(ratio).toBeLessThanOrEqual(52);
      // Nothing is lost: the lone collector never stalls.
      expect(got(half.sources[0]).stalledTicks).toBe(0);
    }
  });
});

describe('the Grand barracks in each rotation', () => {
  // Placed at (4, 5): a 3x3 box is the same at every rotation; the input side turns.
  const sides = ['south', 'west', 'north', 'east'] as const;
  for (const [i, rotation] of ([0, 90, 180, 270] as Rotation[]).entries()) {
    test(`rotation ${String(rotation)}: nine cells and the Ore input on the ${sides[i] as string} side`, () => {
      const lab = new Lab(tinyMap());
      lab.core(8, 0);
      const id = lab.put('bld_grand_barracks', 4, 5, rotation, 1);
      const occ = occupancy(lab.state, content);
      const b = got(lab.state.buildings.find((x) => x.id === id));
      const cells: [number, number][] = [];
      for (let y = 5; y < 8; y++)
        for (let x = 4; x < 7; x++) cells.push([x, y]);
      expect(occ.cellsOf(b).map((c) => [c.x, c.y])).toEqual(cells);
      expect(occ.absoluteSides(b).inputs).toEqual([
        { resource: 'res_a', side: sides[i] },
      ]);
      expect(rotateBuilding(hall(), rotation).footprint).toEqual({
        width: 3,
        height: 3,
      });
    });
  }

  test('it does not fit where a 3x3 box would leave the plot', () => {
    const lab = new Lab(tinyMap());
    lab.core(8, 0);
    // The map is 12 x 16.
    expect(() => lab.put('bld_grand_barracks', 4, 14, 0, 1)).toThrow();
    expect(() => lab.put('bld_grand_barracks', 10, 5, 90, 1)).toThrow();
    expect(() => lab.put('bld_grand_barracks', 9, 13, 0, 1)).not.toThrow();
  });

  test('a rotated barracks fed through its rotated input spawns soldiers', () => {
    // Rotation 180: the input is on the north side; one collector reaches it.
    const lab = new Lab(tinyMap([[2, 2, 'res_a']]));
    lab.core(8, 0);
    const ore = lab.put('bld_extractor', 2, 2, 0, 1);
    const g = lab.put('bld_grand_barracks', 4, 3, 180, 1);
    lab.link(ore, 'north', g, 'north', [
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
      [3, 6],
      [4, 6],
    ]);
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
    );
    for (let t = 0; t < 700; t++) stepArena(sim, ctx);
    expect(
      events.filter((e) => e.type === 'unit_spawned').length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('a Grand barracks in a battle spawns its units one after another', () => {
  const spawns = (events: readonly ArenaEvent[]) =>
    events.flatMap((e) => (e.type === 'unit_spawned' ? [e] : []));

  test('two soldiers in the same tick, every interval, when two collectors feed it', () => {
    for (const tier of [1, 2, 3]) {
      const { lab, grand } = farm(tier);
      const { sim, ctx, events } = startArenaBattle(
        lab.state,
        coreOnlyTeam(8, 0),
        GAP,
        content,
        simConfig,
      );
      for (let t = 0; t < 700; t++) stepArena(sim, ctx);
      const made = spawns(events).filter((e) => e.side === 0);
      expect(made.every((e) => e.building === grand)).toBe(true);
      expect(made.every((e) => e.def === 'unit_soldier')).toBe(true);
      // Pairs: the 2nd, 4th, ... spawn is in the tick of the one before it.
      expect(made.length % 2).toBe(0);
      for (let i = 0; i < made.length; i += 2) {
        expect(got(made[i]).tick).toBe(got(made[i + 1]).tick);
        // One after another: consecutive unit ids, at two different places.
        expect(got(made[i + 1]).unit).toBe(got(made[i]).unit + 1);
        expect([got(made[i]).px, got(made[i]).py]).not.toEqual([
          got(made[i + 1]).px,
          got(made[i + 1]).py,
        ]);
      }
      // One production per interval once the buffers are full: the gap
      // between pairs never falls below the interval and settles on it.
      const interval = [80, 56, 40][tier - 1] as number;
      const gaps = made
        .filter((_, i) => i % 2 === 0)
        .map((e, i, all) => (i === 0 ? 0 : e.tick - got(all[i - 1]).tick))
        .slice(1);
      expect(gaps.length).toBeGreaterThanOrEqual(3);
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(interval);
      expect(gaps.slice(-2)).toEqual([interval, interval]);
    }
  });

  test('a Barracks beside it still makes one soldier per production', () => {
    const lab = new Lab(tinyMap([[5, 2, 'res_a']]));
    lab.core(8, 0);
    const ore = lab.put('bld_extractor', 5, 2, 0, 3);
    const b = lab.put('bld_barracks', 5, 5, 0, 3);
    lab.link(ore, 'north', b, 'south', [
      [5, 3],
      [5, 4],
    ]);
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
    );
    for (let t = 0; t < 400; t++) stepArena(sim, ctx);
    const ticks = spawns(events)
      .filter((e) => e.side === 0)
      .map((e) => e.tick);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(sim.producers.every((p) => p.held === undefined)).toBe(true);
  });
});

describe('back-pressure on a production of several units (CB-13a)', () => {
  /**
   * A tier 1 Grand barracks fed straight by a tier 3 collector, in a pen of
   * walls with one open cell (4, 9) as its only exit and that cell closed by a
   * wall above it: the units that spawn stay there.
   */
  function pen(blockers = 0) {
    const lab = new Lab(tinyMap([[4, 5, 'res_a']]));
    lab.core(8, 0);
    const ore = lab.put('bld_extractor', 4, 5, 0, 3);
    const g = lab.put('bld_grand_barracks', 3, 6, 0, 1);
    lab.link(ore, 'north', g, 'south', []);
    for (const [x, y] of [
      [3, 5],
      [5, 5],
      [2, 6],
      [2, 7],
      [2, 8],
      [6, 6],
      [6, 7],
      [6, 8],
      [3, 9],
      [5, 9],
      [4, 10],
    ] as const) {
      lab.put('bld_wall_block', x, y, 0, 1);
    }
    const started = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
    );
    // Soldiers already standing in the open cell take room from the start.
    for (let i = 0; i < blockers; i++) {
      spawnUnitForTest(started.sim, started.ctx, {
        side: 0,
        def: 'unit_soldier',
        px: 4 * 240 + 120,
        py: 9 * 240 + 120,
      });
    }
    return started;
  }
  const spawns = (events: readonly ArenaEvent[]) =>
    events.flatMap((e) => (e.type === 'unit_spawned' ? [e] : []));
  const producerOf = (sim: ReturnType<typeof pen>['sim']) =>
    got(sim.producers.find((p) => p.side === 0));

  test('with no room for the first unit nothing starts and nothing is consumed', () => {
    const { sim, ctx, events } = pen();
    for (let t = 0; t < 600; t++) stepArena(sim, ctx);
    const p = producerOf(sim);
    // Three productions filled the pen; the fourth waits with its 8 items.
    expect(spawns(events)).toHaveLength(6);
    expect(p).toMatchObject({ progress: 8, cooldown: 0 });
    expect(p.held).toBeUndefined();
  });

  test('room for one of two: it spawns that one, holds the other and takes nothing meanwhile', () => {
    // A soldier standing in the pen from the start makes the room odd: the
    // third production finds room for one unit.
    const { sim, ctx, events } = pen(1);
    for (let t = 0; t < 400; t++) stepArena(sim, ctx);
    const p = producerOf(sim);
    expect(spawns(events)).toHaveLength(5);
    expect(p.held).toBe(1);
    // The production was paid for and its cooldown started at its first unit.
    expect(p.progress).toBe(0);
    expect(p.cooldown).toBeGreaterThanOrEqual(0);
    // Held: nothing more is taken from the input buffer, however long it waits,
    // although its cooldown ran out long ago.
    for (let t = 0; t < 200; t++) {
      stepArena(sim, ctx);
      expect(p.progress).toBe(0);
      expect(p.held).toBe(1);
    }
    expect(p.cooldown).toBe(0);
    expect(spawns(events)).toHaveLength(5);
    // Room appears: the held unit spawns first, then the next production.
    got(sim.units.find((u) => u.side === 0)).hp = 0;
    // The dead unit leaves at the end of the first tick, the held unit
    // spawns in the second, and the next production starts taking in the third.
    stepArena(sim, ctx);
    stepArena(sim, ctx);
    expect(spawns(events)).toHaveLength(6);
    expect(p.held).toBeUndefined();
    expect(p.progress).toBe(0);
    stepArena(sim, ctx);
    expect(p.held).toBeUndefined();
    expect(p.progress).toBeGreaterThan(0);
    // The held unit and its sibling came from the same building, and the
    // buffer, filled while it waited, gives the next production at once.
    const all = spawns(events);
    expect(new Set(all.map((e) => e.building)).size).toBe(1);
    expect(got(all[5]).tick).toBeGreaterThan(got(all[4]).tick);
  });

  test('the held count survives a save and restore, and the run goes on the same', () => {
    const a = pen(1);
    const b = pen(1);
    for (let t = 0; t < 400; t++) {
      stepArena(a.sim, a.ctx);
      stepArena(b.sim, b.ctx);
    }
    expect(producerOf(a.sim).held).toBe(1);
    // Save and restore `b` (a JSON round trip, then a new context).
    const restored = JSON.parse(JSON.stringify(b.sim)) as typeof b.sim;
    expect(producerOf(restored).held).toBe(1);
    const events: ArenaEvent[] = [];
    const ctx = createArenaContext(restored, content, simConfig, { events });
    got(a.sim.units.find((u) => u.side === 0)).hp = 0;
    got(restored.units.find((u) => u.side === 0)).hp = 0;
    for (let t = 0; t < 100; t++) {
      stepArena(a.sim, a.ctx);
      stepArena(restored, ctx);
    }
    expect(spawns(events).length).toBeGreaterThan(0);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(a.sim));
  });

  test('a producer that makes one unit at a time never has a held count', () => {
    const lab = new Lab(tinyMap([[5, 2, 'res_a']]));
    lab.core(8, 0);
    const ore = lab.put('bld_extractor', 5, 2, 0, 3);
    const b = lab.put('bld_barracks', 5, 5, 0, 3);
    lab.link(ore, 'north', b, 'south', [
      [5, 3],
      [5, 4],
    ]);
    const { sim, ctx } = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
    );
    for (let t = 0; t < 300; t++) {
      stepArena(sim, ctx);
      for (const p of sim.producers) expect('held' in p).toBe(false);
    }
  });
});

describe('the strength bonus of a production is read at each unit', () => {
  test('a unit held back by a full exit gets the bonus of the tick it spawns', () => {
    const lab = new Lab(tinyMap([[4, 5, 'res_a']]));
    lab.core(8, 0);
    const ore = lab.put('bld_extractor', 4, 5, 0, 3);
    const g = lab.put('bld_grand_barracks', 3, 6, 0, 1);
    lab.link(ore, 'north', g, 'south', []);
    for (const [x, y] of [
      [3, 5],
      [5, 5],
      [2, 6],
      [2, 7],
      [2, 8],
      [6, 6],
      [6, 7],
      [6, 8],
      [3, 9],
      [5, 9],
      [4, 10],
    ] as const) {
      lab.put('bld_wall_block', x, y, 0, 1);
    }
    const { sim, ctx } = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: 4 * 240 + 120,
      py: 9 * 240 + 120,
    });
    for (let t = 0; t < 400; t++) stepArena(sim, ctx);
    const p = got(sim.producers.find((x) => x.side === 0));
    expect(p.held).toBe(1);
    // Raise the side's strength by 50 percent, then let the held unit spawn.
    Object.assign(sim, { sideOptions: [{ unitStrengthPercent: 50 }, {}] });
    const before = sim.units.length;
    got(sim.units.find((u) => u.side === 0)).hp = 0;
    stepArena(sim, ctx);
    stepArena(sim, ctx);
    expect(p.held).toBeUndefined();
    const health = got(content.units.get('unit_soldier')).health;
    const fresh = sim.units.slice(before - 1).filter((u) => u.side === 0);
    expect(fresh.length).toBeGreaterThanOrEqual(1);
    // The unit that waited has the new bonus; the two before it do not.
    expect(got(fresh[fresh.length - 1]).maxHp).toBe(
      Math.floor((health * 150) / 100),
    );
    expect(
      sim.units.filter((u) => u.maxHp === health).length,
    ).toBeGreaterThanOrEqual(4);
  });
});
