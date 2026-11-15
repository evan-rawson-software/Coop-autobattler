/**
 * The Golem forge, the Golem and armor (CB-5h, CB-13; issue #382): armor is
 * taken off every hit on a unit (at least 1 for a hit above 0), after Overload
 * scaling; a Golem fits a one-cell gap; the chain Ore and Power -> Composite
 * refinery -> Golem forge makes Golems.
 */
import { describe, expect, test } from 'vitest';
import unitsJson from '../../../content/units.json';
import type { ArenaContent } from './arena.js';
import {
  armorHit,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  unitStats,
  type ArenaEvent,
} from './arena-sim.js';
import { MAX_ARMOR, MAX_HEALTH } from './limits.js';
import { maxStrengthPercent, loadUnits, loadUnitsOrThrow } from './units.js';
import { coreOnlyTeam, tinyMap } from './testing/ramp-scenarios.js';
import {
  content,
  got,
  groundViolations,
  Lab,
  simConfig,
} from './testing/support.js';

const GAP = 4;
const golemDef = () => got(content.units.get('unit_golem'));

/** The shipped units plus a one-damage and a two-damage melee unit. */
const testContent: ArenaContent = {
  ...content,
  units: loadUnitsOrThrow({
    units: [
      ...content.units.list(),
      ...[1, 2].map((damage) => ({
        id: `unit_pin${String(damage)}`,
        health: 500,
        damage,
        attackCooldownTicks: 10,
        moveCooldownTicks: 6,
        radius: 72,
        collisionRadius: 47,
        reach: 60,
        flying: false,
        attackType: 'melee',
      })),
    ],
  }),
};

function attacks(events: readonly ArenaEvent[]) {
  return events.flatMap((e) =>
    e.type === 'unit_attacked' && e.target.kind === 'unit' ? [e] : [],
  );
}

describe('armor in content', () => {
  test('the Golem and its forge are in the shipped content', () => {
    const g = golemDef();
    expect(g).toMatchObject({
      health: 260,
      damage: 6,
      attackCooldownTicks: 14,
      moveCooldownTicks: 10,
      radius: 110,
      collisionRadius: 80,
      flying: false,
      attackType: 'melee',
      armor: 3,
    });
    // The collision diameter is under one cell (240).
    expect(2 * g.collisionRadius).toBeLessThan(240);
    const f = got(content.buildings.get('bld_golem_forge'));
    expect(f.kind === 'unit_producer' && f.unit).toBe('unit_golem');
    expect(f.inputs).toEqual([{ resource: 'res_ab_refined', side: 'south' }]);
    expect(f.footprint).toEqual({ width: 2, height: 2 });
    if (f.kind !== 'unit_producer') throw new Error('kind');
    expect(f.tiers.map((t) => t.price)).toEqual([45, 90, 160]);
    expect(f.tiers.map((t) => t.productionIntervalTicks)).toEqual([
      120, 84, 60,
    ]);
    expect(
      f.tiers.map((t) => ('costPerUnit' in t ? t.costPerUnit : undefined)),
    ).toEqual([4, 4, 4]);
  });

  test('every other unit has armor 0', () => {
    for (const u of content.units.list()) {
      expect(u.armor).toBe(u.id === 'unit_golem' ? 3 : 0);
    }
    // The key is absent from the existing records, so nothing in the files changed.
    for (const u of unitsJson.units) {
      if (u.id !== 'unit_golem') expect('armor' in u).toBe(false);
    }
  });

  test('armor is an integer from 0 to MAX_ARMOR', () => {
    const edit = (armor: unknown) => {
      const data = JSON.parse(JSON.stringify(unitsJson)) as {
        units: Record<string, unknown>[];
      };
      got(data.units.find((u) => u['id'] === 'unit_golem'))['armor'] = armor;
      const r = loadUnits(data);
      return r.ok ? '' : r.errors.join('\n');
    };
    expect(edit(0)).toBe('');
    expect(edit(MAX_ARMOR)).toBe('');
    expect(edit(MAX_ARMOR + 1)).toMatch(/"armor"/);
    expect(edit(-1)).toMatch(/"armor"/);
    expect(edit(1.5)).toMatch(/"armor"/);
    expect(edit('3')).toMatch(/"armor"/);
  });

  test('a Golem with the largest Armory bonus stays within MAX_HEALTH', () => {
    const g = golemDef();
    const best = maxStrengthPercent(g);
    expect(best).toBeGreaterThan(1000);
    const strongest = unitStats(0, g, best);
    expect(strongest.health).toBeLessThanOrEqual(MAX_HEALTH);
    expect(strongest.armor).toBe(3); // armor is not scaled
    expect(() => unitStats(0, g, best + 1)).toThrow(RangeError);
    // The Armory of the shipped content (tier 3, all steps, plus modifiers).
    const armory = got(content.buildings.get('bld_armory'));
    if (armory.kind !== 'economy') throw new Error('kind');
    for (const t of armory.tiers) {
      const bonus = t.maxSteps * t.stepPercent;
      expect(unitStats(0, g, bonus).health).toBeLessThanOrEqual(MAX_HEALTH);
    }
  });
});

describe('armorHit', () => {
  test('max(1, hit - armor) for a hit above 0; 0 stays 0', () => {
    expect(armorHit(6, 3)).toBe(3);
    expect(armorHit(3, 3)).toBe(1);
    expect(armorHit(2, 3)).toBe(1);
    expect(armorHit(1, 3)).toBe(1);
    expect(armorHit(0, 3)).toBe(0);
    expect(armorHit(6, 0)).toBe(6);
    expect(armorHit(14, 3)).toBe(11);
  });
});

describe('hits on a Golem', () => {
  function duel(foe: string, ticks: number) {
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(8, 0),
      coreOnlyTeam(8, 0),
      GAP,
      testContent,
      simConfig,
    );
    const golem = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_golem',
      x: 6,
      y: 17,
    });
    const other = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: foe,
      x: 6,
      y: 18,
    });
    for (let t = 0; t < ticks; t++) stepArena(sim, ctx);
    return { golem, other, events };
  }

  test('a soldier hit of 6 takes 3; the Golem hits back for 6', () => {
    const { golem, other, events } = duel('unit_soldier', 40);
    const onGolem = attacks(events).filter(
      (e) => e.target.kind === 'unit' && e.target.unit === golem.id,
    );
    expect(onGolem.length).toBeGreaterThan(1);
    expect(onGolem.every((e) => e.damage === 3)).toBe(true);
    expect(golem.hp).toBe(260 - 3 * onGolem.length);
    const onSoldier = attacks(events).filter((e) => e.unit === golem.id);
    expect(onSoldier.every((e) => e.damage === 6)).toBe(true);
    expect(other.hp).toBe(40 - 6 * onSoldier.length);
  });

  test('a hit of 1 still takes 1, a hit of 2 takes 1', () => {
    for (const foe of ['unit_pin1', 'unit_pin2']) {
      const { golem, events } = duel(foe, 40);
      const hits = attacks(events).filter((e) => e.unit !== golem.id);
      expect(hits.length).toBeGreaterThan(1);
      expect(hits.every((e) => e.damage === 1)).toBe(true);
      expect(golem.hp).toBe(260 - hits.length);
    }
  });

  test('an archer shot (5) takes 2', () => {
    const { golem, events } = duel('unit_archer', 40);
    const hits = attacks(events).filter((e) => e.unit !== golem.id);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.every((e) => e.damage === 2)).toBe(true);
    expect(golem.hp).toBe(260 - 2 * hits.length);
  });

  test('a raider (8) takes 5; units without armor take the full hit', () => {
    const { golem, events } = duel('unit_raider', 40);
    const hits = attacks(events).filter((e) => e.unit !== golem.id);
    expect(hits.every((e) => e.damage === 5)).toBe(true);
    // A soldier hitting a soldier is unchanged.
    const {
      sim,
      ctx,
      events: ev,
    } = startArenaBattle(
      coreOnlyTeam(8, 0),
      coreOnlyTeam(8, 0),
      GAP,
      testContent,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x: 6, y: 17 });
    spawnUnitForTest(sim, ctx, { side: 1, def: 'unit_soldier', x: 6, y: 18 });
    for (let t = 0; t < 30; t++) stepArena(sim, ctx);
    expect(attacks(ev).every((e) => e.damage === 6)).toBe(true);
  });

  test('a turret shot (tier 1: 5) takes 2', () => {
    const lab = new Lab(tinyMap([[3, 2, 'res_b']]));
    lab.core(8, 0);
    const src = lab.put('bld_extractor', 3, 2, 0, 3);
    const turret = lab.put('bld_turret', 3, 15, 0, 1);
    const cells: [number, number][] = [];
    for (let y = 3; y < 15; y++) cells.push([3, y]);
    lab.link(src, 'north', turret, 'south', cells);
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      testContent,
      simConfig,
    );
    const golem = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_golem',
      x: 3,
      y: 17,
    });
    for (let t = 0; t < 60; t++) stepArena(sim, ctx);
    const shots = events.filter((e) => e.type === 'turret_fired');
    expect(shots.length).toBeGreaterThan(0);
    for (const s of shots) {
      expect(s).toMatchObject({ unit: golem.id, damage: 2 });
    }
    expect(golem.hp).toBe(260 - 2 * shots.length);
  });

  test('Overload scales the hit first, then armor is taken off', () => {
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(8, 0),
      coreOnlyTeam(8, 0),
      GAP,
      testContent,
      simConfig,
    );
    sim.tick =
      simConfig.overloadStartTick + simConfig.overloadIntervalTicks * 3;
    const golem = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_golem',
      x: 6,
      y: 17,
    });
    spawnUnitForTest(sim, ctx, { side: 1, def: 'unit_soldier', x: 6, y: 18 });
    for (let t = 0; t < 12; t++) stepArena(sim, ctx);
    const level = ctx.simConfig.overloadDamageStepPercent;
    const hit = attacks(events).find((e) => e.unit !== golem.id);
    expect(hit).toBeDefined();
    const scaled = Math.floor((6 * (100 + 4 * level)) / 100);
    expect(hit?.damage).toBe(armorHit(scaled, 3));
    expect(scaled).toBeGreaterThan(6);
  });
});

describe('a Golem on the field', () => {
  test('passes a one-cell gap, pushing and pushed by a soldier', () => {
    const wall = new Lab(tinyMap());
    wall.core(5, 0);
    for (let x = 0; x < 12; x++) {
      if (x !== 5) wall.put('bld_wall_block', x, 8, 0, 3);
    }
    const { sim, ctx } = startArenaBattle(
      coreOnlyTeam(5, 0),
      wall.state,
      GAP,
      content,
      simConfig,
    );
    const golem = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_golem',
      x: 6,
      y: 20,
    });
    const soldier = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 4,
      y: 20,
    });
    // Side 1 board row 8 is arena row 35 - 8 = 27: the gap is at x = 5.
    let through = 0;
    for (let t = 0; t < 400; t++) {
      stepArena(sim, ctx);
      expect(groundViolations(sim, ctx)).toEqual([]);
      if (golem.py > 28 * 240 && soldier.py > 28 * 240 && through === 0) {
        through = t;
      }
    }
    expect(through).toBeGreaterThan(0);
  });

  test('the chain Ore + Power -> Composite refinery -> Golem forge makes Golems', () => {
    const lab = new Lab(
      tinyMap([
        [3, 2, 'res_b'],
        [5, 2, 'res_a'],
      ]),
    );
    lab.core(8, 0);
    const ore = lab.put('bld_extractor', 5, 2, 0, 3);
    const power = lab.put('bld_extractor', 3, 2, 0, 3);
    const ref = lab.put('bld_refinery_ab', 5, 5, 0, 3);
    const forge = lab.put('bld_golem_forge', 5, 10, 0, 3);
    lab.link(ore, 'north', ref, 'south', [
      [5, 3],
      [5, 4],
    ]);
    lab.link(power, 'north', ref, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
    lab.link(ref, 'north', forge, 'south', [
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
    for (let t = 0; t < 600; t++) stepArena(sim, ctx);
    const spawned = events.filter((e) => e.type === 'unit_spawned');
    expect(spawned.length).toBeGreaterThanOrEqual(3);
    expect(spawned.every((e) => e.def === 'unit_golem')).toBe(true);
    expect(spawned.every((e) => e.building === forge)).toBe(true);
    // Tier 3 forge: never faster than one Golem per 60 ticks.
    for (let i = 1; i < spawned.length; i++) {
      expect(
        got(spawned[i]).tick - got(spawned[i - 1]).tick,
      ).toBeGreaterThanOrEqual(60);
    }
  });
});
