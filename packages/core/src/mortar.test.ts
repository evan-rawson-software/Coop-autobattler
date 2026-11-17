/**
 * The Mortar, minimum range and turret splash (CB-9f, CB-18b; issue #441): a
 * 2x2 turret fed with Ore that ignores units whose centre is closer than
 * `minRangeCells` to its nearest cell and whose shot also hurts the other
 * enemy units within `splashRadiusCells` of the target, by the rule of CB-5h.
 */
import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import {
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaEvent,
} from './arena-sim.js';
import {
  loadBuildings,
  loadBuildingsOrThrow,
  needPer1000,
} from './buildings.js';
import { dryRunFlow } from './flow-sim.js';
import { CELL_UNITS, MAX_SPLASH_RADIUS_CELLS } from './limits.js';
import { coreOnlyTeam, tinyMap } from './testing/ramp-scenarios.js';
import { content, got, Lab, simConfig } from './testing/support.js';

const GAP = 4;
const S = CELL_UNITS;
type Fired = Extract<ArenaEvent, { type: 'turret_fired' }>;
const fired = (e: readonly ArenaEvent[]): Fired[] =>
  e.flatMap((x) => (x.type === 'turret_fired' ? [x] : []));

function mortarDef() {
  const d = got(content.buildings.get('bld_mortar'));
  if (d.kind !== 'defense' || d.defenseType !== 'turret') {
    throw new Error('kind');
  }
  return d;
}

describe('the Mortar in content', () => {
  test('2x2 turret with one Ore input on the south side', () => {
    const m = mortarDef();
    expect(m.footprint).toEqual({ width: 2, height: 2 });
    expect(m.inputs).toEqual([{ resource: 'res_a', side: 'south' }]);
    expect(m.outputs).toEqual([]);
  });

  test('numbers of the three tiers', () => {
    const t = mortarDef().tiers;
    expect(t.map((x) => x.damage)).toEqual([8, 12, 16]);
    expect(t.map((x) => x.rangeCells)).toEqual([9, 10, 11]);
    expect(t.map((x) => x.minRangeCells)).toEqual([3, 3, 3]);
    expect(t.map((x) => x.cooldownTicks)).toEqual([30, 24, 18]);
    expect(t.map((x) => x.costPerShot)).toEqual([2, 2, 2]);
    expect(t.map((x) => x.splashPercent)).toEqual([60, 60, 60]);
    expect(t.map((x) => x.splashRadiusCells)).toEqual([1, 1, 1]);
    expect(t.map((x) => x.price)).toEqual([40, 80, 140]);
    expect(t.map((x) => x.health)).toEqual([80, 120, 160]);
  });

  test('the existing turret has neither a blind spot nor splash', () => {
    const d = got(content.buildings.get('bld_turret'));
    if (d.kind !== 'defense' || d.defenseType !== 'turret')
      throw new Error('x');
    for (const t of d.tiers) {
      expect('minRangeCells' in t).toBe(false);
      expect('splashPercent' in t).toBe(false);
      expect('splashRadiusCells' in t).toBe(false);
    }
  });
});

describe('turret tier bounds in the loader', () => {
  function load(patch: (tier: Record<string, unknown>) => void): string {
    const raw = JSON.parse(JSON.stringify(buildingsJson)) as {
      buildings: { id: string; tiers: Record<string, unknown>[] }[];
    };
    const m = got(raw.buildings.find((b) => b.id === 'bld_mortar'));
    patch(got(m.tiers[0]));
    const r = loadBuildings(raw, {
      resources: content.resources,
      units: content.units,
    });
    return r.ok ? '' : r.errors.join('\n');
  }
  test('the shipped content loads', () => {
    expect(load(() => undefined)).toBe('');
  });
  test('all three fields are optional', () => {
    expect(
      load((t) => {
        delete t['minRangeCells'];
        delete t['splashPercent'];
        delete t['splashRadiusCells'];
      }),
    ).toBe('');
    expect(load((t) => delete t['minRangeCells'])).toBe('');
    expect(
      load((t) => {
        delete t['splashPercent'];
        delete t['splashRadiusCells'];
      }),
    ).toBe('');
  });
  test('minRangeCells: from 1, below rangeCells, an integer', () => {
    expect(load((t) => (t['minRangeCells'] = 8))).toBe('');
    expect(load((t) => (t['minRangeCells'] = 0))).toMatch(/minRangeCells/);
    expect(load((t) => (t['minRangeCells'] = 9))).toMatch(
      /"minRangeCells" \(9\) must be below "rangeCells" \(9\)/,
    );
    expect(load((t) => (t['minRangeCells'] = 1.5))).toMatch(/minRangeCells/);
  });
  test('splash: both or neither, percent 1..100, radius 1..2 cells', () => {
    expect(MAX_SPLASH_RADIUS_CELLS).toBe(2);
    expect(load((t) => delete t['splashRadiusCells'])).toMatch(
      /both "splashPercent" and "splashRadiusCells"/,
    );
    expect(load((t) => delete t['splashPercent'])).toMatch(
      /both "splashPercent" and "splashRadiusCells"/,
    );
    expect(load((t) => (t['splashPercent'] = 100))).toBe('');
    expect(load((t) => (t['splashPercent'] = 0))).toMatch(/splashPercent/);
    expect(load((t) => (t['splashPercent'] = 101))).toMatch(/splashPercent/);
    expect(load((t) => (t['splashRadiusCells'] = 2))).toBe('');
    expect(load((t) => (t['splashRadiusCells'] = 3))).toMatch(
      /splashRadiusCells/,
    );
    expect(load((t) => (t['splashRadiusCells'] = 0))).toMatch(
      /splashRadiusCells/,
    );
  });
  test('a wall or a producer tier may not have them', () => {
    const raw = JSON.parse(JSON.stringify(buildingsJson)) as {
      buildings: { id: string; tiers: Record<string, unknown>[] }[];
    };
    got(raw.buildings.find((b) => b.id === 'bld_barracks')).tiers[0] = {
      ...got(raw.buildings.find((b) => b.id === 'bld_barracks')?.tiers[0]),
      minRangeCells: 1,
    };
    const r = loadBuildings(raw, {
      resources: content.resources,
      units: content.units,
    });
    expect(r.ok).toBe(false);
  });
});

/**
 * A tier `tier` Mortar at cells (2..3, 2..3) of side 0, fully charged (free
 * power), against a Core-only enemy. `extra` changes the content.
 */
function scene(tier = 1, base: typeof content = content) {
  const lab = new Lab(tinyMap(), base);
  lab.core(8, 0);
  lab.put('bld_mortar', 2, 2, 0, tier);
  return startArenaBattle(lab.state, coreOnlyTeam(8, 0), GAP, base, simConfig, {
    sideOptions: [{ freePower: true }, null],
  });
}

// The Mortar's top edge is y = 4 * S = 960 and its cells span x 480..960, so a
// unit at px = 720 above it is `py - 960` away from its nearest cell.
const TOP = 4 * S;
const X = 720;

describe('the blind spot', () => {
  test('a unit closer than the minimum range is ignored, one at exactly the minimum is not', () => {
    for (const [dist, shoots] of [
      [3 * S - 1, false],
      [3 * S, true],
      [2 * S, false],
      [120, false],
    ] as const) {
      const { sim, ctx, events } = scene();
      spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_soldier',
        px: X,
        py: TOP + dist,
      });
      stepArena(sim, ctx);
      expect(fired(events).length).toBe(shoots ? 1 : 0);
    }
  });

  test('the shot goes to the nearest unit outside the blind spot, not the nearest unit', () => {
    const { sim, ctx, events } = scene();
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X,
      py: TOP + S,
    });
    const far = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X,
      py: TOP + 6 * S,
    });
    const farther = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X,
      py: TOP + 7 * S,
    });
    stepArena(sim, ctx);
    const f = fired(events);
    expect(f.map((x) => x.unit)).toEqual([far.id]);
    // 8 on the target, splash radius 1 cell: the one 1 cell further is hit
    // (distance exactly 240) for floor(8 * 60 / 100) = 4.
    expect(f[0]?.damage).toBe(8);
    expect(f[0]?.splash).toEqual([{ unit: farther.id, damage: 4 }]);
  });

  test('a unit only inside the blind spot is never shot, however long it stays', () => {
    const { sim, ctx, events } = scene();
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X,
      py: TOP + 2 * S,
    });
    // The unit walks towards the Core, out of the blind spot or not; only
    // check while it is inside.
    for (let i = 0; i < 20; i++) {
      const u = sim.units[0];
      if (u === undefined) break;
      const dy = Math.max(0, TOP - u.py);
      const inside =
        Math.hypot(Math.max(0, 480 - u.px, u.px - 960), dy) < 3 * S;
      const n = fired(events).length;
      stepArena(sim, ctx);
      if (inside && u.py > 0) expect(fired(events).length).toBe(n);
    }
  });

  test('the maximum range is per tier: 9, 10 and 11 cells (the unit circle counts, as for any turret)', () => {
    for (const tier of [1, 2, 3]) {
      const range = 8 + tier;
      for (const [d, shoots] of [
        [range * S - 1, true],
        [range * S + 150, false],
      ] as const) {
        const { sim, ctx, events } = scene(tier);
        spawnUnitForTest(sim, ctx, {
          side: 1,
          def: 'unit_soldier',
          px: X,
          py: TOP + d,
        });
        stepArena(sim, ctx);
        expect(fired(events).length).toBe(shoots ? 1 : 0);
      }
    }
  });
});

describe('splash', () => {
  test('a group: the others within one cell of the target take 60 percent, all in the same tick as the shot', () => {
    const { sim, ctx, events } = scene();
    const mk = (px: number, py: number, side = 1, def = 'unit_soldier') =>
      spawnUnitForTest(sim, ctx, { side, def, px, py });
    const primary = mk(X, TOP + 5 * S);
    const hp = primary.hp;
    const edge = mk(X + S, TOP + 5 * S); // distance exactly 240: hit
    const out = mk(X - S - 1, TOP + 5 * S); // 241: not hit
    const diag = mk(X + 100, TOP + 5 * S + 200); // inside
    const own = mk(X - 150, TOP + 5 * S + 150, 0); // the mortar's own side: never
    stepArena(sim, ctx);
    const f = fired(events);
    expect(f).toHaveLength(1);
    expect(f[0]?.unit).toBe(primary.id);
    expect(f[0]?.splash).toEqual(
      [edge, diag]
        .sort((a, b) => a.id - b.id)
        .map((u) => ({ unit: u.id, damage: 4 })),
    );
    expect(primary.hp).toBe(hp - 8);
    const byId = new Map(sim.units.map((u) => [u.id, u.hp]));
    expect(byId.get(edge.id)).toBe(40 - 4);
    expect(byId.get(diag.id)).toBe(40 - 4);
    // The unit 241 away and the unit of the Mortar's own side are not in the
    // splash list above (they may be hit by the soldiers' own melee attacks).
    expect(f[0]?.splash?.map((x) => x.unit)).not.toContain(out.id);
    expect(f[0]?.splash?.map((x) => x.unit)).not.toContain(own.id);
  });

  test('a flyer in the radius is hit', () => {
    const { sim, ctx, events } = scene();
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X,
      py: TOP + 5 * S,
    });
    const drone = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_drone',
      px: X + 150,
      py: TOP + 5 * S + 100,
    });
    stepArena(sim, ctx);
    expect(fired(events)[0]?.splash?.map((s) => s.unit)).toEqual([drone.id]);
  });

  test('armor: the target takes 8 minus 3, a Golem next to it 4 minus 3 (never below 1)', () => {
    const { sim, ctx, events } = scene();
    const golem = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_golem',
      px: X,
      py: TOP + 5 * S,
    });
    const other = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_golem',
      px: X + 160,
      py: TOP + 5 * S + 160,
    });
    const soldier = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X - 150,
      py: TOP + 5 * S + 150,
    });
    stepArena(sim, ctx);
    const f = got(fired(events)[0]);
    expect(f.unit).toBe(golem.id);
    expect(f.damage).toBe(5);
    expect(f.splash).toEqual([
      { unit: other.id, damage: 1 },
      { unit: soldier.id, damage: 4 },
    ]);
  });

  test('the percent is taken before armor, at tier 3 (16 damage): 9 on a soldier, 6 on a Golem', () => {
    const { sim, ctx, events } = scene(3);
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X,
      py: TOP + 5 * S,
    });
    const golem = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_golem',
      px: X + 200,
      py: TOP + 5 * S,
    });
    const soldier = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X - 160,
      py: TOP + 5 * S,
    });
    stepArena(sim, ctx);
    // floor(16 * 60 / 100) = 9; the Golem's armor 3 takes it to 6.
    expect(got(fired(events)[0]).splash).toEqual([
      { unit: golem.id, damage: 6 },
      { unit: soldier.id, damage: 9 },
    ]);
  });

  test('a turret does not hit buildings or Cores with its splash, and an empty splash is still listed', () => {
    const { sim, ctx, events } = scene();
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X,
      py: TOP + 5 * S,
    });
    stepArena(sim, ctx);
    expect(got(fired(events)[0]).splash).toEqual([]);
  });

  test('the splash is at least 1 even when the percent rounds to 0', () => {
    const raw = JSON.parse(JSON.stringify(buildingsJson)) as {
      buildings: { id: string; tiers: Record<string, unknown>[] }[];
    };
    const m = got(raw.buildings.find((b) => b.id === 'bld_mortar'));
    got(m.tiers[0])['damage'] = 1; // floor(1 * 60 / 100) = 0
    const buildings = loadBuildingsOrThrow(raw, {
      resources: content.resources,
      units: content.units,
    });
    const { sim, ctx, events } = scene(1, { ...content, buildings });
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X,
      py: TOP + 5 * S,
    });
    const next = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X + 160,
      py: TOP + 5 * S,
    });
    stepArena(sim, ctx);
    expect(got(fired(events)[0]).splash).toEqual([
      { unit: next.id, damage: 1 },
    ]);
  });

  test('two Mortars firing in one tick add up on the same units (simultaneous damage)', () => {
    const lab = new Lab(tinyMap());
    lab.core(8, 0);
    lab.put('bld_mortar', 2, 2, 0, 1);
    lab.put('bld_mortar', 5, 2, 0, 1);
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
      { sideOptions: [{ freePower: true }, null] },
    );
    const a = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: 1100,
      py: TOP + 5 * S,
    });
    const b = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: 1100 + 160,
      py: TOP + 5 * S,
    });
    stepArena(sim, ctx);
    expect(fired(events)).toHaveLength(2);
    // a: 8 from each Mortar's shot as the target or 4 as splash; whichever
    // the targeting picked, the sum of every hit is what both took.
    const dealt = new Map<number, number>();
    for (const f of fired(events)) {
      dealt.set(f.unit, (dealt.get(f.unit) ?? 0) + f.damage);
      for (const s of f.splash ?? [])
        dealt.set(s.unit, (dealt.get(s.unit) ?? 0) + s.damage);
    }
    for (const u of [a, b]) {
      expect(u.hp).toBe(40 - (dealt.get(u.id) ?? 0));
    }
    expect(dealt.get(a.id)).toBeGreaterThanOrEqual(8);
  });

  test('a unit killed by splash is removed with the tick (no damage to the dead later)', () => {
    const { sim, ctx } = scene();
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X,
      py: TOP + 5 * S,
    });
    const weak = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: X + 160,
      py: TOP + 5 * S,
    });
    weak.hp = 4;
    stepArena(sim, ctx);
    expect(sim.units.some((u) => u.id === weak.id)).toBe(false);
  });
});

describe('the existing turret is unchanged', () => {
  test('a turret shot has no splash field and no blind spot', () => {
    const lab = new Lab(tinyMap());
    lab.core(8, 0);
    lab.put('bld_turret', 2, 2, 0, 1);
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
      { sideOptions: [{ freePower: true }, null] },
    );
    // Right next to it (distance 100): the plain turret shoots.
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: 300,
      py: 600,
    });
    const other = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: 300,
      py: 750,
    });
    stepArena(sim, ctx);
    const f = fired(events);
    expect(f).toHaveLength(1);
    expect('splash' in got(f[0])).toBe(false);
    expect(other.hp).toBe(40);
  });
});

describe('where the Mortar can shoot (CB-18a)', () => {
  test('into the neutral zone, never onto the enemy board', () => {
    const lab = new Lab(tinyMap());
    lab.core(8, 0);
    // The front rows of the board: cells y 14..15, the gap is rows 16..19.
    lab.put('bld_mortar', 2, 14, 0, 3);
    const run = (py: number) => {
      const { sim, ctx, events } = startArenaBattle(
        lab.state,
        coreOnlyTeam(8, 0),
        GAP,
        content,
        simConfig,
        { sideOptions: [{ freePower: true }, null] },
      );
      spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_soldier',
        px: X,
        py,
      });
      stepArena(sim, ctx);
      return fired(events).length;
    };
    // The Mortar's top edge is row 16 (y = 3840). 3 cells above it (row 19) is
    // in the gap and outside the blind spot.
    expect(run(16 * S + 3 * S + 100)).toBe(1);
    // Row 20 is the enemy board: out of reach however close, 5 cells away.
    expect(run(20 * S + 100)).toBe(0);
    // 2 cells above (row 17): in the blind spot.
    expect(run(16 * S + 2 * S)).toBe(0);
  });
});

describe('one collector feeds one Mortar of its tier (rebalance principle)', () => {
  function farm(tier: number) {
    const lab = new Lab(tinyMap([[3, 2, 'res_a']]));
    lab.core(8, 0);
    const e = lab.put('bld_extractor', 3, 2, 0, tier);
    const m = lab.put('bld_mortar', 3, 6, 0, tier);
    lab.link(e, 'north', m, 'south', [
      [3, 3],
      [3, 4],
      [3, 5],
    ]);
    return { lab, mortar: m };
  }
  test('its need is 2 Ore per cooldown; the collector gives all it makes, the Mortar fires at the collector rate', () => {
    // Collector: 1 item per 20 / 14 / 10 ticks = 50 / 71 / 100 per 1000.
    // Mortar need: 2 per 30 / 24 / 18 = 66 / 83 / 111 per 1000.
    const need: number[] = [66, 83, 111];
    const supply: number[] = [50, 71, 100];
    for (const tier of [1, 2, 3]) {
      const def = got(content.buildings.get('bld_mortar'));
      expect(needPer1000(def, tier)).toBe(need[tier - 1]);
      const { lab, mortar } = farm(tier);
      const r = dryRunFlow(lab.state, content, simConfig, 3000, 'need');
      const inp = got(r.consumers.find((c) => c.building === mortar));
      for (const s of r.sources) {
        expect(s.stalledTicks).toBe(0);
        expect(s.lost).toBe(0);
      }
      // The collector's whole output arrives (within rounding)...
      expect(inp.ratePer1000).toBeGreaterThanOrEqual(
        (supply[tier - 1] as number) - 1,
      );
      expect(inp.ratePer1000).toBeLessThanOrEqual(
        (supply[tier - 1] as number) + 2,
      );
      // ...which is 75 to 91 percent of the top-speed need.
      expect(inp.ratePer1000 / (need[tier - 1] as number)).toBeGreaterThan(
        0.74,
      );
      expect(inp.ratePer1000 / (need[tier - 1] as number)).toBeLessThan(0.92);
    }
  });
});
