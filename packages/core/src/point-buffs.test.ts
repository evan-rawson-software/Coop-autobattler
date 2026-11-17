/**
 * Points of interest, part 5 (CB-8g, #374): the buffs a held point gives its
 * side, `unit_strength` (stronger new units) and `heal` (healing near it).
 */
import { describe, expect, test } from 'vitest';
import {
  placeGuards,
  pointStrengthBonus,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  unitStats,
  type ArenaContext,
  type ArenaSim,
  type GuardPost,
} from './arena-sim.js';
import { simulateBattle } from './battle.js';
import { MAX_DAMAGE, MAX_HEALTH } from './limits.js';
import type { GameMap } from './map.js';
import type { NeutralZone } from './neutral-zone.js';
import { loadPoints, buffEffectOf, type PointBuffEffect } from './points.js';
import { maxStrengthPercent } from './units.js';
import { tinyMap } from './testing/ramp-scenarios.js';
import { Lab, content, got, mapgen, simConfig } from './testing/support.js';

const W = 12;
const GAP = 7;
const BOARD = 16;
const MID = BOARD + 3;
const CAP = content.points.capture;
const MAX = content.points.maxPointStrengthPercent;

const STRENGTH: PointBuffEffect = buffEffectOf(
  got(content.points.buff.get('poi_strength')),
);
const HEAL: PointBuffEffect = buffEffectOf(
  got(content.points.buff.get('poi_heal')),
);
const soldier = got(content.units.get('unit_soldier'));

function tiny(): GameMap {
  return {
    width: W,
    height: BOARD,
    partySize: 1,
    plotWidth: W,
    features: [],
    nodes: [],
  };
}

function coreOnly(x: number) {
  const lab = new Lab(tiny());
  lab.core(x, 0);
  return lab.state;
}

type Scene = { sim: ArenaSim; ctx: ArenaContext };

function scene(
  posts: GuardPost[],
  options: Parameters<typeof startArenaBattle>[5] = {},
  teamA = coreOnly(1),
): Scene {
  const s = startArenaBattle(
    teamA,
    coreOnly(10),
    GAP,
    content,
    simConfig,
    options,
  );
  placeGuards(s.sim, s.ctx, {
    capture: CAP,
    maxPointStrengthPercent: MAX,
    leashCells: 3,
    posts,
    plans: [],
  });
  return s;
}

const hold = (s: Scene, i: number, side: number): void => {
  const p = s.sim.points?.[i];
  if (p === undefined) throw new Error('no such point');
  p.controller = side;
};

const spawn = (s: Scene, side: number, x: number, y: number) =>
  spawnUnitForTest(s.sim, s.ctx, {
    side,
    def: 'unit_soldier',
    x,
    y,
  });

describe('content (CB-8g)', () => {
  test('the shipped numbers', () => {
    expect(STRENGTH).toEqual({ kind: 'unit_strength', strengthPercent: 20 });
    expect(HEAL).toEqual({
      kind: 'heal',
      healIntervalTicks: 10,
      healRadiusCells: 3,
      healAmount: 2,
    });
    expect(MAX).toBe(40);
  });

  test('every unit stays within the stat bounds at the largest possible sum', () => {
    // Armory cap + the point cap + a side base of 0, for every unit type.
    const most = simConfig.maxUnitStrengthPercent + MAX;
    for (const def of content.units.list()) {
      expect(maxStrengthPercent(def)).toBeGreaterThanOrEqual(most);
      const at = unitStats(0, def, most);
      expect(at.health).toBeLessThanOrEqual(MAX_HEALTH);
      expect(at.damage).toBeLessThanOrEqual(MAX_DAMAGE);
    }
  });

  test('a second entry of one kind with other numbers loads', () => {
    const data = {
      chancePercent: 60,
      bandMarginCells: 2,
      maxPointStrengthPercent: 30,
      buffs: [
        { id: 'poi_a', kind: 'unit_strength', weight: 1, strengthPercent: 5 },
        { id: 'poi_b', kind: 'unit_strength', weight: 2, strengthPercent: 9 },
        {
          id: 'poi_c',
          kind: 'heal',
          weight: 1,
          healIntervalTicks: 5,
          healRadiusCells: 2,
          healAmount: 1,
        },
      ],
      capture: CAP,
      guards: content.points.guards,
    };
    const r = loadPoints(data);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.buff.get('poi_b')).toEqual({
        id: 'poi_b',
        kind: 'unit_strength',
        weight: 2,
        strengthPercent: 9,
      });
    }
  });

  test('the loader refuses missing or foreign buff numbers', () => {
    const base = {
      chancePercent: 60,
      bandMarginCells: 2,
      maxPointStrengthPercent: 40,
      capture: CAP,
      guards: content.points.guards,
    };
    const bad = (buff: Record<string, unknown>): readonly string[] => {
      const r = loadPoints({ ...base, buffs: [buff] });
      return r.ok ? [] : r.errors;
    };
    expect(bad({ id: 'poi_x', kind: 'unit_strength', weight: 1 })).toEqual([
      expect.stringContaining('strengthPercent'),
    ]);
    expect(
      bad({
        id: 'poi_x',
        kind: 'unit_strength',
        weight: 1,
        strengthPercent: 20,
        healAmount: 2,
      }).join(),
    ).toContain('healAmount');
    expect(
      bad({ id: 'poi_x', kind: 'heal', weight: 1, healAmount: 0 }).length,
    ).toBeGreaterThan(0);
    expect(
      loadPoints({ ...base, maxPointStrengthPercent: -1, buffs: [] }).ok,
    ).toBe(false);
  });
});

describe('unit_strength (CB-8g)', () => {
  test('a unit spawned while the point is held is stronger, one spawned before is not, and new units are normal again once it is lost', () => {
    const s = scene([{ id: 0, x: 3, y: MID, buff: STRENGTH }]);
    const before = spawn(s, 0, 2, 17);
    hold(s, 0, 0);
    expect(pointStrengthBonus(s.sim, 0)).toBe(20);
    expect(pointStrengthBonus(s.sim, 1)).toBe(0);
    const during = spawn(s, 0, 5, 17);
    expect(before.hp).toBe(soldier.health);
    expect(during.hp).toBe(Math.floor((soldier.health * 120) / 100));
    expect(during.damage).toBe(Math.floor((soldier.damage * 120) / 100));
    expect(during.maxHp).toBe(during.hp);
    hold(s, 0, 1);
    const after = spawn(s, 0, 8, 17);
    expect(after.hp).toBe(soldier.health);
    // The other side's units now get it; units already there never change.
    const theirs = spawn(s, 1, 9, 30);
    expect(theirs.hp).toBe(during.hp);
    expect(before.hp).toBe(soldier.health);
    expect(during.hp).toBe(Math.floor((soldier.health * 120) / 100));
  });

  test('it is the side that gets it: a partner player of the same side too', () => {
    const s = scene([{ id: 0, x: 3, y: MID, buff: STRENGTH }]);
    hold(s, 0, 0);
    const a = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 2,
      y: 17,
      owner: 0,
      target: 0,
    });
    const b = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 17,
      owner: 1,
      target: 0,
    });
    expect(a.hp).toBe(b.hp);
    expect(a.hp).toBeGreaterThan(soldier.health);
  });

  test('two points stop at maxPointStrengthPercent; three still give 40', () => {
    const posts: GuardPost[] = [0, 1, 2].map((i) => ({
      id: i,
      x: 2 + 3 * i,
      y: MID,
      buff: STRENGTH,
    }));
    const s = scene(posts);
    hold(s, 0, 0);
    expect(pointStrengthBonus(s.sim, 0)).toBe(20);
    hold(s, 1, 0);
    expect(pointStrengthBonus(s.sim, 0)).toBe(40);
    hold(s, 2, 0);
    expect(pointStrengthBonus(s.sim, 0)).toBe(40);
    const u = spawn(s, 0, 2, 17);
    expect(u.hp).toBe(Math.floor((soldier.health * 140) / 100));
  });

  test('a heal point adds no strength', () => {
    const s = scene([{ id: 0, x: 3, y: MID, buff: HEAL }]);
    hold(s, 0, 0);
    expect(pointStrengthBonus(s.sim, 0)).toBe(0);
  });

  test('it adds on top of a capped Armory (outside maxUnitStrengthPercent)', () => {
    const lab = new Lab(tinyMap());
    lab.core(5, 6);
    for (const x of [0, 2, 4]) lab.put('bld_armory', x, 0, 0, 3);
    const s = scene([{ id: 0, x: 3, y: MID, buff: STRENGTH }], {}, lab.state);
    for (const r of s.sim.ramps) r.steps = 5;
    const spawnOwned = (x: number) =>
      spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_soldier',
        x,
        y: 12,
        owner: 0,
        target: 0,
      });
    const capped = spawnOwned(2);
    expect(capped.hp).toBe(Math.floor((soldier.health * 200) / 100));
    hold(s, 0, 0);
    const plus = spawnOwned(5);
    expect(plus.hp).toBe(Math.floor((soldier.health * 220) / 100));
    expect(plus.damage).toBe(Math.floor((soldier.damage * 220) / 100));
  });

  test('scheduled wave units get the side bonus (and no ramp bonus)', () => {
    const s = scene([{ id: 0, x: 3, y: MID, buff: STRENGTH }], {
      sideOptions: [
        null,
        { scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 2 }] },
      ],
    });
    hold(s, 0, 1);
    stepArena(s.sim, s.ctx);
    const wave = s.sim.units.filter((u) => u.side === 1);
    expect(wave).toHaveLength(2);
    for (const u of wave) {
      expect(u.hp).toBe(Math.floor((soldier.health * 120) / 100));
      expect(u.maxHp).toBe(u.hp);
    }
  });

  test('a battle whose points could take a unit past the stat bounds is refused at tick 0', () => {
    const room = content.units
      .list()
      .reduce((m, d) => Math.min(m, maxStrengthPercent(d)), Infinity);
    // Fine without the point (10 percent of room left), too much with it (20).
    const options = {
      sideOptions: [{ unitStrengthPercent: room - 10 }, null] as never,
    };
    expect(() => scene([], options)).not.toThrow();
    expect(() =>
      scene([{ id: 0, x: 3, y: MID, buff: STRENGTH }], options),
    ).toThrow(RangeError);
  });
});

describe('heal (CB-8g)', () => {
  const near = (s: Scene, x: number, y = MID) => spawn(s, 0, x, y);

  test('restores 2 health on beats, only up to maxHp', () => {
    const s = scene([{ id: 0, x: 3, y: MID, buff: HEAL }]);
    hold(s, 0, 0);
    const u = near(s, 3);
    u.hp = soldier.health - 3;
    stepArena(s.sim, s.ctx); // tick 0 is a beat
    expect(u.hp).toBe(soldier.health - 1);
    for (let t = 0; t < 9; t++) stepArena(s.sim, s.ctx);
    expect(u.hp).toBe(soldier.health - 1); // not between beats
    stepArena(s.sim, s.ctx); // tick 10
    expect(u.hp).toBe(soldier.health); // capped: gained 1, not 2
    expect(s.sim.guards?.healed).toEqual([3, 0]);
    for (let t = 0; t < 10; t++) stepArena(s.sim, s.ctx);
    expect(u.hp).toBe(soldier.health);
    expect(s.sim.guards?.healed).toEqual([3, 0]);
  });

  test('only the holder is healed, only in range, never guards', () => {
    const s = scene([{ id: 0, x: 3, y: MID, buff: HEAL }]);
    hold(s, 0, 0);
    const mine = near(s, 3);
    const far = near(s, 10, 17);
    const theirs = spawn(s, 1, 4, MID);
    for (const u of [mine, far, theirs]) u.hp = 10;
    stepArena(s.sim, s.ctx);
    // Positions move a little in a tick, but the unit at the point stays near.
    expect(mine.hp).toBe(12);
    expect(far.hp).toBe(10);
    expect(theirs.hp).toBeLessThanOrEqual(10);
    expect(s.sim.guards?.healed).toEqual([2, 0]);
  });

  test('a point nobody holds, or one held by the other side, heals nobody', () => {
    const s = scene([{ id: 0, x: 3, y: MID, buff: HEAL }]);
    const u = near(s, 3);
    u.hp = 10;
    stepArena(s.sim, s.ctx);
    expect(u.hp).toBe(10);
    hold(s, 0, 1);
    for (let t = 0; t < 20; t++) stepArena(s.sim, s.ctx);
    expect(u.hp).toBeLessThanOrEqual(10);
  });

  test('two overlapping points heal once per beat', () => {
    const s = scene([
      { id: 0, x: 3, y: MID, buff: HEAL },
      { id: 1, x: 4, y: MID, buff: HEAL },
    ]);
    hold(s, 0, 0);
    hold(s, 1, 0);
    const u = near(s, 3);
    u.hp = 10;
    stepArena(s.sim, s.ctx);
    expect(u.hp).toBe(12);
    expect(s.sim.guards?.healed).toEqual([2, 0]);
  });

  test('a unit that dies this tick is not healed back', () => {
    const s = scene([{ id: 0, x: 3, y: MID, buff: HEAL }]);
    hold(s, 0, 0);
    const u = near(s, 3);
    u.hp = 1;
    // An enemy archer next to it: its hit kills the unit in step 4.
    const killer = spawnUnitForTest(s.sim, s.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 3,
      y: MID + 0,
      allowOverlap: true,
    });
    killer.damage = 50;
    stepArena(s.sim, s.ctx);
    expect(s.sim.units.find((q) => q.id === u.id)).toBeUndefined();
    expect(s.sim.guards?.healed).toEqual([0, 0]);
  });

  test('buildings and Cores are not healed', () => {
    const s = scene([{ id: 0, x: 3, y: MID, buff: HEAL }]);
    hold(s, 0, 0);
    const before = s.sim.health.map((h) => h.hp);
    for (let t = 0; t < 30; t++) stepArena(s.sim, s.ctx);
    expect(s.sim.health.map((h) => h.hp)).toEqual(before);
  });

  test('a restored state heals the same', () => {
    const run = (restore: boolean): string => {
      let s = scene([{ id: 0, x: 3, y: MID, buff: HEAL }]);
      hold(s, 0, 0);
      near(s, 3).hp = 10;
      for (let t = 0; t < 25; t++) {
        if (restore && t === 12) {
          const sim = JSON.parse(JSON.stringify(s.sim)) as ArenaSim;
          s = { sim, ctx: s.ctx };
        }
        stepArena(s.sim, s.ctx);
      }
      return (
        JSON.stringify(s.sim.units.map((u) => u.hp)) +
        JSON.stringify(s.sim.guards?.healed)
      );
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('the battle summary (CB-8g)', () => {
  const zoneWith = (buff: string): NeutralZone => ({
    width: W,
    depth: GAP,
    features: [],
    pointsOfInterest: [{ id: 0, band: 0, x: 3, y: 3, buff }],
  });
  const fight = (zone: NeutralZone) => {
    const r = simulateBattle(
      {
        teamA: coreOnly(1),
        teamB: coreOnly(10),
        seed: 1,
        round: 1,
        sideOptions: [
          { scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 12 }] },
          null,
        ],
      },
      content,
      { sim: simConfig, mapgen },
      { zone },
    );
    if (!r.ok) throw new Error(r.error.message);
    return r;
  };

  test('the holder of a strength point has its bonus at the end', () => {
    const r = fight(zoneWith('poi_strength'));
    expect(r.summary.points?.[0]?.controller).toBe(0);
    expect(r.summary.sides.map((x) => x.pointBonus)).toEqual([20, 0]);
    expect(r.summary.sides.map((x) => x.healedHp)).toEqual([0, 0]);
  });

  test('a battle without a point has zeros', () => {
    const r = fight({ ...zoneWith('poi_heal'), pointsOfInterest: [] });
    expect(r.summary.sides.map((x) => x.pointBonus)).toEqual([0, 0]);
    expect(r.summary.sides.map((x) => x.healedHp)).toEqual([0, 0]);
  });

  test('the holder of a heal point heals its units while it holds it', () => {
    const r = fight(zoneWith('poi_heal'));
    expect(r.summary.points?.[0]?.controller).toBe(0);
    expect(r.summary.sides[0].healedHp).toBeGreaterThan(0);
    expect(r.summary.sides[1].healedHp).toBe(0);
    expect(r.summary.sides.map((x) => x.pointBonus)).toEqual([0, 0]);
  });
});
