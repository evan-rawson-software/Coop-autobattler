/**
 * Two-input consumers, the Foundry and the heavy unit (CB-5e, CB-10d, CB-43,
 * PP-4; issue #380): the `costs` form of a unit producer tier, the per-resource
 * counters of a battle, back-up per resource, need per resource and the loss
 * of a Foundry in the middle of a battle.
 */
import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import goldenArena from '../../../golden/arena-sim.json';
import { createArenaSim, runArena, startArenaBattle } from './arena-sim.js';
import {
  costEntries,
  loadBuildings,
  needPer1000,
  needPer1000By,
} from './buildings.js';
import { dryRunFlow } from './flow-sim.js';
import { MAX_TIER_COST } from './limits.js';
import { runTeamStateOps } from './team-state-ops.js';
import { coreOnlyTeam, tinyMap } from './testing/ramp-scenarios.js';
import { content, got, Lab, mapgen, simConfig } from './testing/support.js';
import type { Json } from './hash.js';

const GAP = 4;
const CTX = { resources: content.resources, units: content.units };

function foundry() {
  return got(content.buildings.get('bld_foundry'));
}

function loadEdited(edit: (foundryEntry: Record<string, unknown>) => void) {
  const data = JSON.parse(JSON.stringify(buildingsJson)) as {
    buildings: Record<string, unknown>[];
  };
  edit(got(data.buildings.find((b) => b['id'] === 'bld_foundry')));
  const r = loadBuildings(data, CTX);
  return r.ok ? '' : r.errors.join('\n');
}

function tierOf(e: Record<string, unknown>, i: number) {
  return got((e['tiers'] as Record<string, unknown>[])[i]);
}

/** A Foundry at (5, 5), Ore on its south side and Power on its west side. */
function farm(opts: { ore?: number; power?: number; tier?: number } = {}) {
  const lab = new Lab(
    tinyMap([
      [3, 2, 'res_b'],
      [5, 2, 'res_a'],
    ]),
  );
  lab.core(8, 0);
  const f = lab.put('bld_foundry', 5, 5, 0, opts.tier ?? 3);
  let ore = -1;
  let power = -1;
  if (opts.ore !== 0) {
    ore = lab.put('bld_extractor', 5, 2, 0, opts.ore ?? 3);
    lab.link(ore, 'north', f, 'south', [
      [5, 3],
      [5, 4],
    ]);
  }
  if (opts.power !== 0) {
    power = lab.put('bld_extractor', 3, 2, 0, opts.power ?? 3);
    lab.link(power, 'north', f, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
  }
  return { lab, f, ore, power };
}

function spawns(events: readonly { type: string; tick: number }[]): number[] {
  return events.filter((e) => e.type === 'unit_spawned').map((e) => e.tick);
}

describe('the two-cost form in content', () => {
  test('the Foundry and the heavy unit are in the shipped content', () => {
    const d = foundry();
    expect(d.kind === 'unit_producer' && d.unit).toBe('unit_heavy');
    expect(d.inputs).toEqual([
      { resource: 'res_a', side: 'south' },
      { resource: 'res_b', side: 'west' },
    ]);
    expect([1, 2, 3].map((t) => costEntries(d, t))).toEqual([
      [
        { resource: 'res_a', cost: 5 },
        { resource: 'res_b', cost: 5 },
      ],
      [
        { resource: 'res_a', cost: 5 },
        { resource: 'res_b', cost: 5 },
      ],
      [
        { resource: 'res_a', cost: 5 },
        { resource: 'res_b', cost: 5 },
      ],
    ]);
    expect(d.kind === 'unit_producer' && d.tiers.map((t) => t.price)).toEqual([
      40, 85, 150,
    ]);
    // One-cost buildings have no entries and keep their numbers.
    expect(costEntries(got(content.buildings.get('bld_barracks')), 1)).toBe(
      undefined,
    );
  });

  test('need per resource: floor(1000 * cost / interval)', () => {
    const d = foundry();
    expect([1, 2, 3].map((t) => needPer1000By(d, t))).toEqual([
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
    // The combined figure is the one of the summed cost.
    expect([1, 2, 3].map((t) => needPer1000(d, t))).toEqual([100, 142, 200]);
    expect(
      needPer1000By(got(content.buildings.get('bld_barracks')), 1),
    ).toEqual([]);
  });

  test('a tier gives exactly one of costPerUnit and costs', () => {
    expect(
      loadEdited((e) => {
        tierOf(e, 0)['costPerUnit'] = 5;
      }),
    ).toMatch(/exactly one of "costPerUnit" and "costs"/);
    expect(
      loadEdited((e) => {
        delete tierOf(e, 0)['costs'];
      }),
    ).toMatch(/costPerUnit/);
  });

  test('every resource in costs has an input, and every input has a cost', () => {
    expect(
      loadEdited((e) => {
        tierOf(e, 0)['costs'] = { res_a: 5, res_c: 5 };
      }),
    ).toMatch(/resource "res_c" has no input/);
    expect(
      loadEdited((e) => {
        tierOf(e, 0)['costs'] = { res_a: 5 };
      }),
    ).toMatch(/takes "res_b", which has no cost/);
    expect(
      loadEdited((e) => {
        tierOf(e, 0)['costs'] = { res_a: 5, res_zzz: 5 };
      }),
    ).toMatch(/unknown resource ID "res_zzz"/);
  });

  test('costs are integers from 1 to MAX_TIER_COST, the same resources in every tier', () => {
    expect(
      loadEdited((e) => {
        tierOf(e, 1)['costs'] = { res_a: 0, res_b: 5 };
      }),
    ).toMatch(/>= 1/);
    expect(
      loadEdited((e) => {
        tierOf(e, 1)['costs'] = { res_a: MAX_TIER_COST + 1, res_b: 5 };
      }),
    ).toMatch(/at most/);
    expect(
      loadEdited((e) => {
        tierOf(e, 2)['costs'] = { res_a: MAX_TIER_COST, res_b: MAX_TIER_COST };
      }),
    ).toBe('');
    expect(
      loadEdited((e) => {
        const t = tierOf(e, 2);
        delete t['costs'];
        t['costPerUnit'] = 10;
      }),
    ).toMatch(/same cost form/);
  });
});

describe('the battle: one counter per resource', () => {
  test('with only Ore a Foundry never produces; the Ore backs up', () => {
    const { lab, f, ore } = farm({ power: 0 });
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 1500);
    const p = got(sim.producers.find((x) => x.building === f));
    expect(p.counters).toEqual([5, 0]);
    expect(p.progress).toBe(5);
    expect(spawns(events)).toEqual([]);
    const south = got(
      got(sim.boards[1].consumers.find((c) => c.building === f)).inputs.find(
        (i) => i.side === 'south',
      ),
    );
    expect(south.count).toBe(4); // inputBufferUnits
    const src = got(sim.boards[1].sources.find((s) => s.building === ore));
    expect(src.stalledTicks).toBeGreaterThan(1000);
  });

  test('with both inputs it produces at its top speed, one unit per interval', () => {
    for (const [tier, interval] of [
      [1, 100],
      [2, 70],
      [3, 50],
    ] as const) {
      const { lab } = farm({ ore: tier, power: tier, tier });
      const { sim, ctx, events } = startArenaBattle(
        coreOnlyTeam(),
        lab.state,
        GAP,
        content,
        simConfig,
      );
      runArena(sim, ctx, 1200);
      const t = spawns(events);
      expect(t.length).toBeGreaterThanOrEqual(8);
      t.slice(2).forEach((tick, i) => {
        expect(tick - got(t[i + 1])).toBe(interval);
      });
      expect(sim.units.every((u) => u.def === 'unit_heavy')).toBe(true);
    }
  });

  test('slow Power: Ore backs up while Power is still arriving, units are full strength', () => {
    const { lab, f, ore } = farm({ ore: 3, power: 1 });
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    const p = got(sim.producers.find((x) => x.building === f));
    let sawOreFullPowerPartial = false;
    for (let t = 0; t < 1500; t++) {
      runArena(sim, ctx, 1);
      const [a = 0, b = 0] = got(p.counters);
      if (a === 5 && b > 0 && b < 5) sawOreFullPowerPartial = true;
      expect(a).toBeLessThanOrEqual(5);
      expect(b).toBeLessThanOrEqual(5);
    }
    expect(sawOreFullPowerPartial).toBe(true);
    const src = got(sim.boards[1].sources.find((s) => s.building === ore));
    expect(src.stalledTicks).toBeGreaterThan(500);
    // Power: 50 per 1000 ticks, 5 per unit: one unit per 100 ticks.
    const t = spawns(events);
    expect(t.length).toBeGreaterThanOrEqual(12);
    t.slice(2).forEach((tick, i) => {
      expect(tick - got(t[i + 1])).toBe(100);
    });
  });

  test('both counters reset when a unit is made', () => {
    const { lab, f } = farm();
    const { sim, ctx } = startArenaBattle(
      coreOnlyTeam(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    const p = got(sim.producers.find((x) => x.building === f));
    let resets = 0;
    let before = [0, 0];
    for (let t = 0; t < 400; t++) {
      runArena(sim, ctx, 1);
      const now = got(p.counters);
      if (before.some((n) => n > 0) && now[0] === 0 && now[1] === 0) resets++;
      before = [...now];
    }
    expect(resets).toBeGreaterThan(0);
  });

  test('the need dry run reports each resource', () => {
    const { lab, f } = farm();
    const r = dryRunFlow(lab.state, content, simConfig, 1000, 'need');
    const need = got(r.needs?.find((n) => n.building === f));
    expect(need.needPer1000).toBe(200);
    expect(need.needPer1000By).toEqual([
      { resource: 'res_a', needPer1000: 100 },
      { resource: 'res_b', needPer1000: 100 },
    ]);
    // Fed at its need: a unit per 50 ticks.
    expect(need.productions).toBeGreaterThanOrEqual(18);
    const slow = farm({ power: 1 });
    const rs = dryRunFlow(slow.lab.state, content, simConfig, 2000, 'need');
    const n2 = got(rs.needs?.find((n) => n.building === slow.f));
    expect(n2.productions).toBeLessThan(need.productions * 2);
    expect(n2.productions).toBeGreaterThanOrEqual(18);
    expect(n2.productions).toBeLessThanOrEqual(21);
  });

  test('a Foundry destroyed mid-battle leaves the other buildings intact', () => {
    const v = got(
      (goldenArena as { id: string; input: Json }[]).find(
        (x) => x.id === 'arena-sim.foundry-destroyed-mid-battle',
      ),
    );
    const input = v.input as Record<string, Json>;
    const a = runTeamStateOps(input['teamA'] as Json, content, mapgen).state;
    const b = runTeamStateOps(input['teamB'] as Json, content, mapgen).state;
    const fid = got(b.buildings.find((x) => x.def === 'bld_foundry')).id;
    const sim0 = createArenaSim(a, b, GAP, content, simConfig);
    expect(sim0.producers.some((p) => p.side === 1 && p.building === fid)).toBe(
      true,
    );
    const { sim, ctx, events } = startArenaBattle(
      a,
      b,
      GAP,
      content,
      simConfig,
    );
    const hp = got(
      sim.health.find(
        (h) => 'building' in h && h.side === 1 && h.building === fid,
      ),
    );
    hp.hp = 1;
    runArena(sim, ctx, 600);
    expect(
      events.some(
        (e) =>
          e.type === 'building_destroyed' && e.side === 1 && e.building === fid,
      ),
    ).toBe(true);
    expect(sim.producers.some((p) => p.side === 1 && p.building === fid)).toBe(
      false,
    );
    expect(sim.teams[1].buildings.some((x) => x.id === fid)).toBe(false);
  });
});
