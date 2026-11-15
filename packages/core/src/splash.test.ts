/**
 * The Spire, the caster and area damage (CB-5h, CB-13; issue #387): a unit
 * with `splash` hurts the other opposing units within `radiusSub` of the
 * target's centre for `percent` of the hit (after Overload, before armor), each
 * reduced by its own armor; own units, buildings and Cores are never splashed.
 */
import { describe, expect, test } from 'vitest';
import unitsJson from '../../../content/units.json';
import type { ArenaContent } from './arena.js';
import {
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaEvent,
} from './arena-sim.js';
import { MAX_SPLASH_RADIUS } from './limits.js';
import { loadUnits, loadUnitsOrThrow } from './units.js';
import { coreOnlyTeam, tinyMap } from './testing/ramp-scenarios.js';
import { content, got, Lab, simConfig } from './testing/support.js';

const GAP = 4;

/** The shipped units plus a caster that hits for 20 (splash 10, armor-visible). */
const testContent: ArenaContent = {
  ...content,
  units: loadUnitsOrThrow({
    units: [
      ...content.units.list(),
      {
        id: 'unit_bigcaster',
        health: 28,
        damage: 20,
        attackCooldownTicks: 20,
        moveCooldownTicks: 6,
        radius: 66,
        collisionRadius: 43,
        reach: 720,
        flying: false,
        attackType: 'ranged',
        splash: { radiusSub: 240, percent: 50 },
      },
    ],
  }),
};

type Splash = Extract<ArenaEvent, { type: 'splash' }>;
type Attack = Extract<ArenaEvent, { type: 'unit_attacked' }>;
const splashes = (e: readonly ArenaEvent[]): Splash[] =>
  e.flatMap((x) => (x.type === 'splash' ? [x] : []));
const attacks = (e: readonly ArenaEvent[]): Attack[] =>
  e.flatMap((x) => (x.type === 'unit_attacked' ? [x] : []));

/** A caster at (1500, 4000) of side 0; the primary soldier 600 above it. */
function scene(casterDef: string, others: [string, number, number][]) {
  const { sim, ctx, events } = startArenaBattle(
    coreOnlyTeam(8, 0),
    coreOnlyTeam(8, 0),
    GAP,
    testContent,
    simConfig,
  );
  const caster = spawnUnitForTest(sim, ctx, {
    side: 0,
    def: casterDef,
    px: 1500,
    py: 4000,
  });
  const primary = spawnUnitForTest(sim, ctx, {
    side: 1,
    def: 'unit_soldier',
    px: 1500,
    py: 4600,
  });
  const extra = others.map(([def, px, py]) =>
    spawnUnitForTest(sim, ctx, {
      side: def.endsWith('!') ? 0 : 1,
      def: def.replace('!', ''),
      px,
      py,
    }),
  );
  return { sim, ctx, events, caster, primary, extra };
}

describe('splash in content', () => {
  test('the Spire and the caster are in the shipped content', () => {
    const c = got(content.units.get('unit_caster'));
    expect(c).toMatchObject({
      health: 28,
      damage: 9,
      attackCooldownTicks: 20,
      moveCooldownTicks: 6,
      reach: 720,
      flying: false,
      attackType: 'ranged',
      splash: { radiusSub: 240, percent: 50 },
    });
    const s = got(content.buildings.get('bld_spire'));
    if (s.kind !== 'unit_producer') throw new Error('kind');
    expect(s.unit).toBe('unit_caster');
    expect(s.inputs).toEqual([{ resource: 'res_bc_refined', side: 'south' }]);
    expect(s.footprint).toEqual({ width: 2, height: 2 });
    expect(s.tiers.map((t) => t.price)).toEqual([50, 95, 170]);
    expect(s.tiers.map((t) => t.health)).toEqual([70, 105, 140]);
    expect(s.tiers.map((t) => t.productionIntervalTicks)).toEqual([
      120, 84, 60,
    ]);
    expect(
      s.tiers.map((t) => ('costPerUnit' in t ? t.costPerUnit : undefined)),
    ).toEqual([4, 4, 4]);
  });

  test('no other unit has splash', () => {
    for (const u of content.units.list()) {
      expect('splash' in u).toBe(u.id === 'unit_caster');
    }
    for (const u of unitsJson.units) {
      if (u.id !== 'unit_caster') expect('splash' in u).toBe(false);
    }
  });

  test('splash bounds: radius 1..MAX_SPLASH_RADIUS, percent 1..100', () => {
    const edit = (splash: unknown) => {
      const data = JSON.parse(JSON.stringify(unitsJson)) as {
        units: Record<string, unknown>[];
      };
      got(data.units.find((u) => u['id'] === 'unit_caster'))['splash'] = splash;
      const r = loadUnits(data);
      return r.ok ? '' : r.errors.join('\n');
    };
    expect(MAX_SPLASH_RADIUS).toBe(480);
    expect(edit({ radiusSub: 1, percent: 1 })).toBe('');
    expect(edit({ radiusSub: 480, percent: 100 })).toBe('');
    expect(edit({ radiusSub: 481, percent: 50 })).toMatch(/radiusSub/);
    expect(edit({ radiusSub: 0, percent: 50 })).toMatch(/radiusSub/);
    expect(edit({ radiusSub: 240, percent: 0 })).toMatch(/percent/);
    expect(edit({ radiusSub: 240, percent: 101 })).toMatch(/percent/);
    expect(edit({ radiusSub: 240 })).toMatch(/percent/);
    expect(edit({ radiusSub: 240, percent: 50, extra: 1 })).toMatch(/extra/);
    expect(edit(5)).toMatch(/splash/);
  });
});

describe('a caster hit', () => {
  test('splashes neighbours within one cell, not farther, never its own side', () => {
    const { ctx, sim, events, caster, primary, extra } = scene('unit_caster', [
      ['unit_soldier', 1700, 4600], // 200 away: hit
      ['unit_soldier', 1500, 4840], // exactly 240 away: hit (<=)
      ['unit_soldier', 1259, 4600], // 241 away: not hit
      ['unit_soldier!', 1380, 4600], // own side, 120 away: never hurt
    ]);
    stepArena(sim, ctx);
    const a = attacks(events).filter((e) => e.unit === caster.id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      target: { kind: 'unit', unit: primary.id },
      damage: 9,
    });
    const sp = splashes(events);
    expect(sp).toEqual([
      {
        tick: 0,
        type: 'splash',
        attacker: caster.id,
        x: 1500,
        y: 4600,
        targets: [
          { unit: got(extra[0]).id, damage: 4 },
          { unit: got(extra[1]).id, damage: 4 },
        ],
      },
    ]);
    // Only damage that rounds to something is dealt; hp reflects it.
    const onUnit = (id: number) =>
      attacks(events)
        .filter((e) => e.target.kind === 'unit' && e.target.unit === id)
        .reduce((n, e) => n + e.damage, 0);
    expect(primary.hp).toBe(40 - onUnit(primary.id));
    expect(got(extra[3]).hp).toBe(40 - onUnit(got(extra[3]).id));
    expect(got(extra[0]).hp).toBe(40 - 4);
    expect(got(extra[1]).hp).toBe(40 - 4);
    expect(got(extra[2]).hp).toBe(40);
  });

  test('the splash event follows the attack and targets are in id order', () => {
    const { ctx, sim, events } = scene('unit_caster', [
      ['unit_soldier', 1300, 4600],
      ['unit_soldier', 1700, 4600],
      ['unit_soldier', 1500, 4800],
    ]);
    stepArena(sim, ctx);
    const i = events.findIndex((e) => e.type === 'unit_attacked');
    expect(events[i + 1]?.type).toBe('splash');
    const ids = got(splashes(events)[0]).targets.map((t) => t.unit);
    expect(ids).toEqual([...ids].sort((p, q) => p - q));
    expect(ids).toHaveLength(3);
  });

  test('a flyer within the radius is hit', () => {
    const { ctx, sim, events, extra } = scene('unit_caster', [
      ['unit_drone', 1500, 4750],
    ]);
    stepArena(sim, ctx);
    const sp = got(splashes(events)[0]);
    expect(sp.targets).toEqual([{ unit: got(extra[0]).id, damage: 4 }]);
    expect(got(extra[0]).hp).toBe(20 - 4);
  });

  test('a splash that rounds to 0 is skipped', () => {
    // Splash 50 percent of a hit of 1 is 0: no secondary hit, no entry.
    const tiny: ArenaContent = {
      ...content,
      units: loadUnitsOrThrow({
        units: [
          ...content.units.list(),
          {
            id: 'unit_pincaster',
            health: 28,
            damage: 1,
            attackCooldownTicks: 20,
            moveCooldownTicks: 6,
            radius: 66,
            collisionRadius: 43,
            reach: 720,
            flying: false,
            attackType: 'ranged',
            splash: { radiusSub: 240, percent: 50 },
          },
        ],
      }),
    };
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(8, 0),
      coreOnlyTeam(8, 0),
      GAP,
      tiny,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_pincaster',
      px: 1500,
      py: 4000,
    });
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: 1500,
      py: 4600,
    });
    const n = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: 1700,
      py: 4600,
    });
    stepArena(sim, ctx);
    expect(got(splashes(events)[0]).targets).toEqual([]);
    expect(n.hp).toBe(40);
  });

  test('a Golem in the radius takes the splash reduced by armor, at least 1', () => {
    // The shipped caster: hit 9, splash 4, armor 3 -> 1 (the floor).
    const a = scene('unit_caster', [['unit_golem', 1700, 4600]]);
    stepArena(a.sim, a.ctx);
    expect(got(splashes(a.events)[0]).targets).toEqual([
      { unit: got(a.extra[0]).id, damage: 1 },
    ]);
    expect(got(a.extra[0]).hp).toBe(260 - 1);
    // A hit of 20: splash 10, armor 3 -> 7; the primary soldier takes 20.
    const b = scene('unit_bigcaster', [['unit_golem', 1700, 4600]]);
    stepArena(b.sim, b.ctx);
    expect(got(splashes(b.events)[0]).targets).toEqual([
      { unit: got(b.extra[0]).id, damage: 7 },
    ]);
    expect(b.primary.hp).toBe(40 - 20);
  });

  test('a Golem as the primary target takes its armor; the splash percent uses the hit before armor', () => {
    const { sim, ctx, events, extra } = (() => {
      const s = startArenaBattle(
        coreOnlyTeam(8, 0),
        coreOnlyTeam(8, 0),
        GAP,
        testContent,
        simConfig,
      );
      spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_bigcaster',
        px: 1500,
        py: 4000,
      });
      spawnUnitForTest(s.sim, s.ctx, {
        side: 1,
        def: 'unit_golem',
        px: 1500,
        py: 4600,
      });
      const o = spawnUnitForTest(s.sim, s.ctx, {
        side: 1,
        def: 'unit_soldier',
        px: 1700,
        py: 4600,
      });
      return { ...s, extra: o };
    })();
    stepArena(sim, ctx);
    expect(attacks(events)[0]?.damage).toBe(17); // 20 - 3
    // 50 percent of 20 (not of 17) = 10; the soldier has no armor.
    expect(got(splashes(events)[0]).targets).toEqual([
      { unit: extra.id, damage: 10 },
    ]);
  });

  test('Overload scales the hit before the splash percent', () => {
    const { sim, ctx, events, extra } = scene('unit_caster', [
      ['unit_soldier', 1700, 4600],
    ]);
    sim.tick =
      simConfig.overloadStartTick + simConfig.overloadIntervalTicks * 3;
    stepArena(sim, ctx);
    const hit = got(attacks(events)[0]).damage;
    expect(hit).toBeGreaterThan(9);
    expect(got(splashes(events)[0]).targets).toEqual([
      { unit: got(extra[0]).id, damage: Math.floor(hit / 2) },
    ]);
  });

  test('splash is not part of a unit state and restores exactly', () => {
    const { sim, ctx } = scene('unit_caster', [['unit_soldier', 1700, 4600]]);
    stepArena(sim, ctx);
    for (const u of sim.units) {
      expect(Object.keys(u).sort()).toEqual(
        [
          'attackCooldown',
          'damage',
          'def',
          'hp',
          'id',
          'owner',
          'px',
          'py',
          'side',
          'target',
        ].sort(),
      );
    }
  });
});

describe('a caster hitting a building', () => {
  test('hits only the wall: no splash event', () => {
    const lab = new Lab(tinyMap());
    lab.core(8, 0);
    // A closed wall line on side 1's board: the caster has to breach it.
    for (let x = 0; x < 12; x++) lab.put('bld_wall_block', x, 8, 0, 3);
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(8, 0),
      lab.state,
      GAP,
      testContent,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_caster',
      x: 4,
      y: 20,
    });
    for (let t = 0; t < 400; t++) stepArena(sim, ctx);
    const wallHits = attacks(events).filter(
      (e) => e.target.kind === 'building',
    );
    expect(wallHits.length).toBeGreaterThan(0);
    expect(splashes(events)).toEqual([]);
  });
});

describe('the chain in a battle', () => {
  test('Power and Flux collectors -> Aether refinery -> Spire -> casters thin a swarm', () => {
    const lab = new Lab(
      tinyMap([
        [3, 2, 'res_c'],
        [5, 2, 'res_b'],
      ]),
    );
    lab.core(8, 0);
    const power = lab.put('bld_extractor', 5, 2, 0, 3); // res_b: first input
    const flux = lab.put('bld_extractor', 3, 2, 0, 3); // res_c: second input
    const ref = lab.put('bld_refinery_bc', 5, 5, 0, 3);
    const spire = lab.put('bld_spire', 5, 10, 0, 3);
    lab.link(power, 'north', ref, 'south', [
      [5, 3],
      [5, 4],
    ]);
    lab.link(flux, 'north', ref, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
    lab.link(ref, 'north', spire, 'south', [
      [5, 7],
      [5, 8],
      [5, 9],
    ]);
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
    );
    // Casters come out of the Spire from tick 68 and walk north; a swarm of
    // 12 soldiers, close together, arrives at tick 100 just ahead of them.
    for (let t = 0; t < 100; t++) stepArena(sim, ctx);
    const swarm = [];
    for (let k = 0; k < 12; k++) {
      swarm.push(
        spawnUnitForTest(sim, ctx, {
          side: 1,
          def: 'unit_soldier',
          px: 1100 + (k % 4) * 110,
          py: 5200 + Math.floor(k / 4) * 110,
        }),
      );
    }
    for (let t = 0; t < 1100; t++) stepArena(sim, ctx);
    const spawned = events.filter((e) => e.type === 'unit_spawned');
    expect(spawned.length).toBeGreaterThanOrEqual(3);
    expect(spawned.every((e) => e.def === 'unit_caster')).toBe(true);
    expect(spawned.every((e) => e.building === spire)).toBe(true);
    for (let i = 1; i < spawned.length; i++) {
      expect(
        got(spawned[i]).tick - got(spawned[i - 1]).tick,
      ).toBeGreaterThanOrEqual(60);
    }
    const sp = splashes(events);
    expect(sp.length).toBeGreaterThan(0);
    expect(sp.some((e) => e.targets.length >= 2)).toBe(true);
    // Swarm soldiers took damage as secondary targets.
    const ids = new Set(swarm.map((u) => u.id));
    const splashDamage = sp.reduce(
      (n, e) =>
        n +
        e.targets
          .filter((t) => ids.has(t.unit))
          .reduce((m, t) => m + t.damage, 0),
      0,
    );
    expect(splashDamage).toBeGreaterThan(0);
  });
});
