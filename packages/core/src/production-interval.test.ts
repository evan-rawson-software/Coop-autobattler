/**
 * Minimum time between productions, need and store (PP-5, PP-6, PP-7; issue
 * #130): the loader fields, the production step of a battle tick, the helpers
 * and the `"need"` dry run.
 */
import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import { runArena, startArenaBattle, type ArenaEvent } from './arena-sim.js';
import {
  loadBuildings,
  needHundredthsPerSecond,
  needPer1000,
  type SourceBuildingDef,
} from './buildings.js';
import {
  collectorHundredthsPerSecond,
  collectorRatePer1000,
  dryRunFlow,
  flowTotals,
} from './flow-sim.js';
import { coreOnlyTeam, tinyMap } from './ramp-scenarios.js';
import { content, got, Lab, simConfig } from './test-support.js';

const GAP = 4;
const CTX = { resources: content.resources, units: content.units };

function bld(id: string) {
  return got(content.buildings.get(id));
}

/** The shipped buildings with `edit` applied to a deep copy. */
function loadEdited(edit: (list: Record<string, unknown>[]) => void) {
  const data = JSON.parse(JSON.stringify(buildingsJson)) as {
    buildings: Record<string, unknown>[];
  };
  edit(data.buildings);
  return loadBuildings(data, CTX);
}

function errorsOf(edit: (list: Record<string, unknown>[]) => void): string {
  const r = loadEdited(edit);
  return r.ok ? '' : r.errors.join('\n');
}

function entry(list: Record<string, unknown>[], id: string) {
  return got(list.find((b) => b['id'] === id));
}

describe('content fields and loader rules', () => {
  test('the shipped content loads and has the new fields', () => {
    expect(loadEdited(() => undefined).ok).toBe(true);
    const barracks = bld('bld_barracks');
    expect(
      barracks.kind === 'unit_producer' &&
        barracks.tiers.map((t) => t.productionIntervalTicks),
    ).toEqual([40, 32, 25]);
  });

  test('a unit producer tier needs productionIntervalTicks >= 1', () => {
    const text = errorsOf((list) => {
      const tiers = entry(list, 'bld_barracks')['tiers'] as Record<
        string,
        unknown
      >[];
      delete tiers[0]?.['productionIntervalTicks'];
      got(tiers[1])['productionIntervalTicks'] = 0;
    });
    expect(text).toMatch(/tiers\[0\]: "productionIntervalTicks" must be/);
    expect(text).toMatch(/tiers\[1\]: "productionIntervalTicks" must be/);
  });

  test('an economy tier needs stepIntervalTicks >= 1', () => {
    const text = errorsOf((list) => {
      const tiers = entry(list, 'bld_armory')['tiers'] as Record<
        string,
        unknown
      >[];
      delete tiers[2]?.['stepIntervalTicks'];
    });
    expect(text).toMatch(/tiers\[2\]: "stepIntervalTicks" must be/);
  });

  test('a source has exactly one output side', () => {
    const text = errorsOf((list) => {
      entry(list, 'bld_extractor')['outputs'] = ['north', 'east'];
    });
    expect(text).toMatch(/a source needs/);
    const none = errorsOf((list) => {
      entry(list, 'bld_extractor')['outputs'] = [];
    });
    expect(none).toMatch(/a source needs/);
  });
});

describe('helpers (PP-5, PP-6)', () => {
  test('needPer1000 is floor(1000 * cost / interval)', () => {
    // Barracks costs 6 / 5 / 4 per 40 / 32 / 25 ticks.
    expect([1, 2, 3].map((t) => needPer1000(bld('bld_barracks'), t))).toEqual([
      150, 156, 160,
    ]);
    // Armory tier 1: 6 per 10 ticks.
    expect(needPer1000(bld('bld_armory'), 1)).toBe(600);
    // Turret tier 1: costPerShot per cooldownTicks 8.
    const turret = bld('bld_turret');
    const shot =
      turret.kind === 'defense' && turret.defenseType === 'turret'
        ? turret.tiers[0]
        : undefined;
    expect(needPer1000(turret, 1)).toBe(
      Math.floor((1000 * got(shot).costPerShot) / got(shot).cooldownTicks),
    );
    // A building that consumes nothing needs nothing.
    expect(needPer1000(bld('bld_wall'), 1)).toBe(0);
    expect(needPer1000(bld('bld_splitter'), 1)).toBe(0);
    expect(needPer1000(bld('bld_core'), 1)).toBe(0);
  });

  test('screens show hundredths per second, rounded down', () => {
    const ticksPerSecond = simConfig.ticksPerSecond;
    expect(ticksPerSecond).toBe(10);
    // 100 * 6 * 10 / 40 = 150: 1.50 items per second.
    expect(
      needHundredthsPerSecond(bld('bld_barracks'), 1, ticksPerSecond),
    ).toBe(150);
    // 100 * 5 * 10 / 32 = 156.25 -> 156.
    expect(
      needHundredthsPerSecond(bld('bld_barracks'), 2, ticksPerSecond),
    ).toBe(156);
  });

  test('a collector shows floor(1000 / scaledInterval)', () => {
    const extractor = bld('bld_extractor') as SourceBuildingDef;
    expect([1, 2, 3].map((t) => collectorRatePer1000(extractor, t))).toEqual([
      50, 71, 100,
    ]);
    // +100 percent halves the interval: 20 -> 10.
    expect(collectorRatePer1000(extractor, 1, 100)).toBe(100);
    // Tier 1 at 20 ticks, 10 ticks per second: 0.50 per second.
    expect(collectorHundredthsPerSecond(extractor, 1, 10)).toBe(50);
    // Tier 2 at 14 ticks: 100 * 10 / 14 = 71.4 -> 71.
    expect(collectorHundredthsPerSecond(extractor, 2, 10)).toBe(71);
  });
});

/**
 * Two tier 3 extractors (res_a, one item per 10 ticks each) -> merger ->
 * tier-1 barracks (6 per 40 ticks = 150 per 1000 ticks): supply 200 per 1000
 * ticks is above the need.
 */
function mergedFarm(extractors: number) {
  const lab = new Lab(
    tinyMap([
      [2, 2, 'res_a'],
      [4, 2, 'res_a'],
    ]),
  );
  lab.core(8, 0);
  const west = lab.put('bld_extractor', 2, 2, 0, 3);
  const merger = lab.put('bld_merger', 3, 4);
  const bar = lab.put('bld_barracks', 3, 5);
  lab.link(west, 'north', merger, 'west', [
    [2, 3],
    [2, 4],
  ]);
  if (extractors === 2) {
    const east = lab.put('bld_extractor', 4, 2, 0, 3);
    lab.link(east, 'north', merger, 'east', [
      [4, 3],
      [4, 4],
    ]);
  }
  lab.link(merger, 'north', bar, 'south');
  return { lab, bar };
}

function spawnTicks(events: readonly ArenaEvent[]): number[] {
  return events.filter((e) => e.type === 'unit_spawned').map((e) => e.tick);
}

describe('the production step (PP-6)', () => {
  test('every store is empty at tick 0 and the state has cooldowns', () => {
    const { lab } = mergedFarm(2);
    const { sim } = startArenaBattle(
      coreOnlyTeam(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    expect(sim.producers).toEqual([
      { side: 1, building: 3, progress: 0, cooldown: 0 },
    ]);
    for (const c of sim.boards[1].consumers) {
      for (const i of c.inputs) expect(i.count).toBe(0);
    }
  });

  test('a fully fed producer makes one unit per interval; the surplus backs up', () => {
    const { lab, bar } = mergedFarm(2);
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    let maxProgress = 0;
    let maxBuffer = 0;
    for (let t = 0; t < 800; t++) {
      runArena(sim, ctx, 1);
      const p = got(sim.producers.find((x) => x.building === bar));
      maxProgress = Math.max(maxProgress, p.progress);
      for (const i of got(sim.boards[1].consumers[0]).inputs) {
        maxBuffer = Math.max(maxBuffer, i.count);
      }
    }
    const spawns = spawnTicks(events);
    expect(spawns.length).toBeGreaterThanOrEqual(15);
    // After the first unit, exactly one per productionIntervalTicks (40).
    spawns.slice(1).forEach((tick, i) => {
      expect(tick - got(spawns[i])).toBe(40);
    });
    // A building never holds more than one production plus the buffer.
    expect(maxProgress).toBe(6);
    expect(maxBuffer).toBeLessThanOrEqual(simConfig.inputBufferUnits);
    // The surplus backs up to the collectors, which stall; nothing is lost.
    const board = sim.boards[1];
    expect(board.sources.some((s) => s.stalledTicks > 0)).toBe(true);
    const totals = flowTotals(board);
    expect(totals.lost).toBe(0);
    expect(totals.produced).toBe(
      totals.inConduits +
        totals.held +
        totals.inBuffers +
        totals.consumed +
        totals.lost,
    );
  });

  test('intake takes at most costPerUnit - progress; the rest stays in the buffer', () => {
    const { lab, bar } = mergedFarm(2);
    const { sim, ctx } = startArenaBattle(
      coreOnlyTeam(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    const p = got(sim.producers.find((x) => x.building === bar));
    const input = got(got(sim.boards[1].consumers[0]).inputs[0]);
    p.progress = 5;
    p.cooldown = 10;
    input.count = 4;
    runArena(sim, ctx, 1);
    expect(p.progress).toBe(6);
    expect(input.count).toBeGreaterThanOrEqual(3);
    // Full progress and a running cooldown: it takes nothing more.
    const before = input.count;
    runArena(sim, ctx, 3);
    expect(p.progress).toBe(6);
    expect(input.count).toBeGreaterThanOrEqual(before);
  });

  test('an under-supplied producer makes full units at the rate of its supply', () => {
    // One tier 3 extractor: 100 per 1000 ticks, below the need of 150. A unit
    // is made whenever 6 items are in: every 60 ticks, never weaker.
    const { lab } = mergedFarm(1);
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 800);
    const spawns = spawnTicks(events);
    expect(spawns.length).toBeGreaterThanOrEqual(12);
    spawns.slice(1).forEach((tick, i) => {
      expect(tick - got(spawns[i])).toBe(60);
    });
    expect(sim.boards[1].sources.every((s) => s.stalledTicks === 0)).toBe(true);
    expect(sim.units.every((u) => u.def === 'unit_soldier')).toBe(true);
  });

  test('an economy building steps only when its cooldown is 0', () => {
    const lab = new Lab(tinyMap([[10, 0, 'res_c']]));
    lab.core(5, 6);
    const s = lab.put('bld_extractor', 10, 0, 0, 3);
    const o = lab.put('bld_overclocker', 10, 1, 0, 1);
    lab.link(s, 'north', o, 'south');
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    const ramp = got(sim.ramps[0]);
    // A full charge but a running cooldown: the step waits for tick 3.
    ramp.charge = 4;
    ramp.cooldown = 3;
    runArena(sim, ctx, 3);
    expect(ramp.steps).toBe(0);
    runArena(sim, ctx, 1);
    expect(ramp.steps).toBe(1);
    expect(events.filter((e) => e.type === 'ramp_step')[0]?.tick).toBe(3);
    // The cooldown is the tier's stepIntervalTicks (10), counted down once in
    // the same tick.
    expect(ramp.cooldown).toBe(9);
  });
});

describe('the need dry run (PP-6, PP-7)', () => {
  test('a consumer fed at or above its need shows a delivered rate equal to its need', () => {
    const { lab, bar } = mergedFarm(2);
    const d = dryRunFlow(lab.state, content, simConfig, 2000, 'need');
    const need = needPer1000(bld('bld_barracks'), 1);
    expect(need).toBe(150);
    expect(d.needs).toEqual([
      { building: bar, needPer1000: 150, productions: 50 },
    ]);
    expect(d.consumers).toEqual([
      expect.objectContaining({ building: bar, ratePer1000: need }),
    ]);
    expect(d.sources.some((s) => s.stalledTicks > 0)).toBe(true);
    expect(d.sources.every((s) => s.lost === 0)).toBe(true);
  });

  test('an under-supplied consumer shows the rate of its supply', () => {
    const { lab, bar } = mergedFarm(1);
    const d = dryRunFlow(lab.state, content, simConfig, 2000, 'need');
    expect(d.consumers).toEqual([
      expect.objectContaining({ building: bar, ratePer1000: 100 }),
    ]);
    expect(got(d.needs?.[0]).needPer1000).toBe(150);
    expect(got(d.needs?.[0]).productions).toBe(33);
  });

  test('the default mode reports no needs', () => {
    const { lab } = mergedFarm(1);
    expect(dryRunFlow(lab.state, content, simConfig, 100).needs).toBe(
      undefined,
    );
  });
});

describe('splitting with back-up (PP-7)', () => {
  /** Tier 3 extractor -> splitter -> `north` (direct) and `east` consumers. */
  function split(north: string, east: string) {
    const lab = new Lab(tinyMap([[5, 2, 'res_a']]));
    lab.core(8, 0);
    const src = lab.put('bld_extractor', 5, 2, 0, 3);
    const sp = lab.put('bld_splitter', 5, 3);
    const a = lab.put(north, 5, 4);
    const b = lab.put(east, 8, 3, 90);
    lab.link(src, 'north', sp, 'south');
    lab.link(sp, 'north', a, 'south');
    lab.link(sp, 'east', b, 'west', [
      [6, 3],
      [7, 3],
    ]);
    return { lab, a, b };
  }
  const delivered = (
    d: ReturnType<typeof dryRunFlow>,
    building: number,
  ): number => got(d.consumers.find((c) => c.building === building)).delivered;

  test('two equal under-supplied consumers get counts that differ by at most 1', () => {
    const { lab, a, b } = split('bld_barracks', 'bld_barracks');
    const d = dryRunFlow(lab.state, content, simConfig, 2000, 'need');
    expect(Math.abs(delivered(d, a) - delivered(d, b))).toBeLessThanOrEqual(1);
    expect(delivered(d, a) + delivered(d, b)).toBeGreaterThanOrEqual(198);
  });

  test('when one consumer is full the other receives the remainder', () => {
    // The armory takes 6 steps of 6 items and is then full.
    const { lab, a, b } = split('bld_barracks', 'bld_armory');
    const d = dryRunFlow(lab.state, content, simConfig, 2000, 'need');
    const armory = delivered(d, b);
    expect(armory).toBeLessThanOrEqual(36 + simConfig.inputBufferUnits);
    expect(delivered(d, a)).toBeGreaterThan(armory * 3);
    expect(d.sources[0]?.stalledTicks).toBe(0);
    expect(d.routes[0]?.lost).toBe(0);
  });

  test('when everything is full the collector stalls and nothing is lost', () => {
    const { lab } = split('bld_armory', 'bld_armory');
    const d = dryRunFlow(lab.state, content, simConfig, 2000, 'need');
    expect(got(d.sources[0]).stalledTicks).toBeGreaterThan(1000);
    expect(got(d.sources[0]).lost).toBe(0);
    expect(d.routes[0]?.lost).toBe(0);
  });
});
