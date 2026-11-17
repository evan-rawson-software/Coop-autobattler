/**
 * Neutral guards (CB-8e): planning from the content, placement at tick 0, and
 * the behaviour on hand-made zones (hold, fight, leash, ranged and flyers,
 * turrets, units of both sides, the summary counters).
 */
import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  placeGuards,
  spawnGuardForTest,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
  type UnitSim,
} from './arena-sim.js';
import { simulateBattle, startBattle, type BattleInput } from './battle.js';
import {
  guardBudget,
  maxGuardStrength,
  planGuards,
  planPointGuards,
} from './guards.js';
import { hashJson } from './hash.js';
import { MAX_DAMAGE, MAX_HEALTH } from './limits.js';
import type { GameMap } from './map.js';
import { mulPct } from './int.js';
import type { NeutralZone } from './neutral-zone.js';
import { loadPoints } from './points.js';
import { Rng } from './rng.js';
import {
  Lab,
  content,
  mapgen,
  mid,
  simConfig,
  threats,
} from './testing/support.js';
import { threatBudget } from './threats.js';
import { loadUnitsOrThrow } from './units.js';
import pointsJson from '../../../content/points.json';

const W = 12;
/** The zone is 7 rows deep, as in `content/mapgen.json`. */
const GAP = 7;
const BOARD = 16;
/** The arena row of the zone's middle row (the points' row). */
const MID = BOARD + 3;
const POST = { id: 0, x: 6, y: MID };
const cfg = content.points.guards;

function tiny(
  nodes: [number, number, string][] = [],
  lakes: [number, number][] = [],
): GameMap {
  return {
    width: W,
    height: BOARD,
    partySize: 1,
    plotWidth: W,
    features: lakes
      .map(([x, y]) => ({ x, y, feature: 'ter_lake' }))
      .sort((a, b) => a.y - b.y || a.x - b.x),
    nodes: nodes.map(([x, y, resource]) => ({ x, y, resource })),
  };
}

/** A Core at board `x` on each side (side 1's is rotated into the arena). */
function coreOnly(x: number, map: GameMap = tiny()) {
  const lab = new Lab(map);
  lab.core(x, 0);
  return lab.state;
}

type Scene = { sim: ArenaSim; ctx: ArenaContext; events: ArenaEvent[] };

/** An empty arena with one post at `POST` and no guards placed yet. */
function scene(
  a = coreOnly(1),
  b = coreOnly(10),
  options: Parameters<typeof startArenaBattle>[5] = {},
): Scene {
  const s = startArenaBattle(a, b, GAP, content, simConfig, options);
  placeGuards(s.sim, s.ctx, { leashCells: 3, posts: [POST], plans: [] });
  return s;
}

function run(s: Scene, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepArena(s.sim, s.ctx);
}

const cellOf = (u: UnitSim): { x: number; y: number } => ({
  x: Math.floor(u.px / 240),
  y: Math.floor(u.py / 240),
});

type Attack = Extract<ArenaEvent, { type: 'unit_attacked' }>;
const attacksBy = (events: ArenaEvent[], unit: number): Attack[] =>
  events.filter(
    (e): e is Attack => e.type === 'unit_attacked' && e.unit === unit,
  );
const attacksOn = (events: ArenaEvent[], unit: number): Attack[] =>
  events.filter(
    (e): e is Attack =>
      e.type === 'unit_attacked' &&
      e.target.kind === 'unit' &&
      e.target.unit === unit,
  );

// ---------------------------------------------------------------------------

describe('guard budget and composition (CB-8e)', () => {
  test('the budget grows like the threat budget (SC-1)', () => {
    expect(guardBudget(cfg, 1)).toBe(44);
    expect(guardBudget(cfg, 2)).toBe(55);
    expect(guardBudget(cfg, 3)).toBe(68);
    // The same integer math as `threatBudget` with the guard numbers.
    const same = {
      ...threats,
      baseBudget: cfg.baseBudget,
      growthPercent: cfg.growthPercent,
      typeMultiplierPercent: { easy: 100, medium: 100, hard: 100, boss: 100 },
    };
    for (const round of [1, 2, 5, 12, 30]) {
      expect(guardBudget(cfg, round)).toBe(
        threatBudget(same, round, 'medium', 1),
      );
    }
    expect(() => guardBudget(cfg, 0)).toThrow(RangeError);
  });

  test('round 1 buys about three soldiers and one archer', () => {
    let soldiers = 0;
    let archers = 0;
    const SEEDS = 200;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const [plan] = planGuards(cfg, content.units, 1, seed, [0]);
      for (const g of plan?.guards ?? []) {
        if (g.unit === 'unit_soldier') soldiers++;
        else archers++;
      }
    }
    expect(soldiers / SEEDS).toBeGreaterThan(2.4);
    expect(soldiers / SEEDS).toBeLessThan(3.6);
    expect(archers / SEEDS).toBeGreaterThan(0.4);
    expect(archers / SEEDS).toBeLessThan(1.4);
  });

  test('never more than maxGuardsPerPoint; the rest becomes strength', () => {
    for (const round of [1, 2, 5, 10, 20]) {
      for (let seed = 1; seed <= 20; seed++) {
        const [plan] = planGuards(cfg, content.units, round, seed, [0]);
        const guards = plan?.guards ?? [];
        expect(guards.length).toBeLessThanOrEqual(cfg.maxGuardsPerPoint);
        expect(guards.length).toBeGreaterThan(0);
        // One percent for the whole point (before the per-unit cap).
        expect(new Set(guards.map((g) => g.strengthPercent)).size).toBe(1);
      }
    }
    const early = planGuards(cfg, content.units, 1, 3, [0])[0];
    const late = planGuards(cfg, content.units, 12, 3, [0])[0];
    expect(late?.guards.length).toBe(cfg.maxGuardsPerPoint);
    expect(late?.guards[0]?.strengthPercent ?? 0).toBeGreaterThan(
      early?.guards[0]?.strengthPercent ?? 0,
    );
  });

  test('draws come from the point own stream: the other points do not matter', () => {
    const [p0, p1] = planGuards(cfg, content.units, 4, 77, [0, 1]);
    const [only1] = planGuards(cfg, content.units, 4, 77, [1]);
    expect(only1).toEqual(p1);
    const rng = Rng.fromSeed(77).child('guards').child(0);
    expect(planPointGuards(cfg, content.units, 4, rng, 0)).toEqual(p0);
    expect(planGuards(cfg, content.units, 4, 78, [0, 1])).not.toEqual([p0, p1]);
  });

  test('a strength that would exceed the bounds is capped, not an error', () => {
    expect(maxGuardStrength(40, 6)).toBeGreaterThan(1_000_000_000);
    const strong = loadUnitsOrThrow({
      units: [
        {
          id: 'unit_big',
          health: MAX_HEALTH / 2,
          damage: 6,
          attackCooldownTicks: 10,
          moveCooldownTicks: 6,
          radius: 72,
          collisionRadius: 47,
          reach: 60,
          flying: false,
          attackType: 'melee',
        },
      ],
    });
    // 2x the health already fills the bound: no room for any strength.
    expect(maxGuardStrength(MAX_HEALTH / 2, 6)).toBe(100);
    const big = {
      ...cfg,
      baseBudget: 1_000_000,
      units: [{ unit: 'unit_big', cost: 10, weight: 1 }],
    };
    const plan = planGuards(big, strong, 1, 5, [0])[0];
    expect(plan?.guards.length).toBe(cfg.maxGuardsPerPoint);
    for (const g of plan?.guards ?? []) {
      expect(g.strengthPercent).toBe(100);
      expect(
        mulPct(MAX_HEALTH / 2, 100 + g.strengthPercent),
      ).toBeLessThanOrEqual(MAX_HEALTH);
      expect(mulPct(6, 100 + g.strengthPercent)).toBeLessThanOrEqual(
        MAX_DAMAGE,
      );
    }
    // One more percent would break the bound.
    expect(mulPct(MAX_HEALTH / 2, 100 + 101)).toBeGreaterThan(MAX_HEALTH);
  });

  test('content is validated', () => {
    const ok = JSON.parse(JSON.stringify(pointsJson)) as Record<
      string,
      unknown
    > & {
      guards: Record<string, unknown>;
    };
    expect(loadPoints(ok, { units: content.units }).ok).toBe(true);
    const bad = (patch: Record<string, unknown>): boolean =>
      loadPoints(
        { ...ok, guards: { ...ok.guards, ...patch } },
        { units: content.units },
      ).ok;
    expect(bad({ baseBudget: 0 })).toBe(false);
    expect(bad({ growthPercent: 99 })).toBe(false);
    expect(bad({ maxGuardsPerPoint: 0 })).toBe(false);
    expect(bad({ maxGuardsPerPoint: 10 })).toBe(false);
    expect(bad({ leashCells: 0 })).toBe(false);
    expect(bad({ units: [] })).toBe(false);
    expect(bad({ units: [{ unit: 'unit_nope', cost: 1, weight: 1 }] })).toBe(
      false,
    );
    // No flyers.
    expect(bad({ units: [{ unit: 'unit_drone', cost: 16, weight: 1 }] })).toBe(
      false,
    );
    expect(
      bad({
        units: [
          { unit: 'unit_soldier', cost: 10, weight: 1 },
          { unit: 'unit_soldier', cost: 10, weight: 1 },
        ],
      }),
    ).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
    const without: Record<string, unknown> = { ...ok };
    delete without['guards'];
    expect(loadPoints(without).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('placement at tick 0', () => {
  test('guards take the first IDs, in point order, on the point cell', () => {
    const zone: NeutralZone = {
      width: W,
      depth: GAP,
      features: [],
      pointsOfInterest: [
        { id: 0, band: 0, x: 3, y: 3, buff: 'poi_heal' },
        { id: 1, band: 1, x: 8, y: 3, buff: 'poi_strength' },
      ],
    };
    const input: BattleInput = {
      teamA: coreOnly(1),
      teamB: coreOnly(10),
      seed: 4,
      round: 1,
    };
    const started = startBattle(
      input,
      content,
      { sim: simConfig, mapgen },
      {
        zone: { ...zone, width: W },
      },
    );
    if (!started.ok) throw new Error(started.error.message);
    const { battle } = started;
    const spawned = battle.eventLog.filter((e) => e.type === 'guard_spawned');
    expect(spawned.length).toBeGreaterThanOrEqual(4);
    expect(spawned.every((e) => e.tick === 0)).toBe(true);
    // IDs 1.. in event order, point 0 before point 1.
    spawned.forEach((e, i) => {
      expect(e.unit).toBe(i + 1);
    });
    const points = spawned.map((e) => e.point);
    expect([...points].sort()).toEqual(points);
    const units = battle.sim.units;
    expect(
      units.every((u) => u.side === 2 && u.owner === -1 && u.target === -1),
    ).toBe(true);
    expect(units.map((u) => u.id)).toEqual(units.map((_, i) => i + 1));
    // The first guard of each point stands on its point cell.
    const first = units.find((u) => u.post === 0);
    expect(first && cellOf(first)).toEqual({ x: 3, y: BOARD + 3 });
    expect(battle.sim.spawned).toEqual([0, 0]);
    expect(battle.sim.guards?.killed).toEqual([0, 0]);
    expect(battle.sim.nextUnitId).toBe(units.length + 1);
    // Guard events come right after zone_revealed, before any tick.
    expect(battle.eventLog[0]?.type).toBe('zone_revealed');
    expect(battle.eventLog[1]?.type).toBe('guard_spawned');
    // The next spawned unit gets the next ID.
    expect(battle.sim.nextUnitId).toBeGreaterThan(spawned.length);
  });

  test('a battle without points has no guards and no guard state', () => {
    const zone: NeutralZone = {
      width: W,
      depth: GAP,
      features: [],
      pointsOfInterest: [],
    };
    const started = startBattle(
      { teamA: coreOnly(1), teamB: coreOnly(10), seed: 4, round: 3 },
      content,
      { sim: simConfig, mapgen },
      { zone },
    );
    if (!started.ok) throw new Error(started.error.message);
    expect(started.battle.sim.guards).toBeUndefined();
    expect(started.battle.sim.units).toHaveLength(0);
    expect(started.battle.sim.nextUnitId).toBe(1);
  });

  test('later rounds give stronger guards; the zone does not change', () => {
    const zone: NeutralZone = {
      width: W,
      depth: GAP,
      features: [],
      pointsOfInterest: [{ id: 0, band: 0, x: 6, y: 3, buff: 'poi_heal' }],
    };
    const start = (round: number) => {
      const s = startBattle(
        { teamA: coreOnly(1), teamB: coreOnly(10), seed: 9, round },
        content,
        { sim: simConfig, mapgen },
        { zone },
      );
      if (!s.ok) throw new Error(s.error.message);
      return s.battle;
    };
    const r1 = start(1);
    const r8 = start(8);
    const hp = (b: ReturnType<typeof start>): number =>
      b.sim.units.reduce((t, u) => t + u.hp, 0);
    expect(hp(r8)).toBeGreaterThan(hp(r1));
    expect(r1.zone).toEqual(r8.zone);
    expect(() =>
      startBattle(
        { teamA: coreOnly(1), teamB: coreOnly(10), seed: 9, round: 0 },
        content,
        { sim: simConfig, mapgen },
      ),
    ).toThrow(RangeError);
  });

  test('a guard with no room anywhere is not placed', () => {
    const s = startArenaBattle(
      coreOnly(1),
      coreOnly(10),
      GAP,
      content,
      simConfig,
    );
    // A lake on every cell around the post and on it leaves no room.
    const plan = {
      point: 0,
      guards: [{ unit: 'unit_soldier', strengthPercent: 0 }],
    };
    s.sim.gapBlocked.push({ x: 6, y: MID });
    const blocked = startArenaBattle(
      coreOnly(1),
      coreOnly(10),
      GAP,
      content,
      simConfig,
      {
        gapBlocked: [
          { x: 5, y: MID - 1 },
          { x: 6, y: MID - 1 },
          { x: 7, y: MID - 1 },
          { x: 5, y: MID },
          { x: 6, y: MID },
          { x: 7, y: MID },
          { x: 5, y: MID + 1 },
          { x: 6, y: MID + 1 },
          { x: 7, y: MID + 1 },
        ],
      },
    );
    placeGuards(blocked.sim, blocked.ctx, {
      leashCells: 3,
      posts: [POST],
      plans: [plan],
    });
    expect(blocked.sim.units).toHaveLength(0);
    expect(
      blocked.events.filter((e) => e.type === 'guard_spawned'),
    ).toHaveLength(0);
  });

  test('five guards fit on and around the point; none overlaps heavily', () => {
    const s = startArenaBattle(
      coreOnly(1),
      coreOnly(10),
      GAP,
      content,
      simConfig,
    );
    placeGuards(s.sim, s.ctx, {
      leashCells: 3,
      posts: [POST],
      plans: [
        {
          point: 0,
          guards: Array.from({ length: 5 }, () => ({
            unit: 'unit_soldier',
            strengthPercent: 0,
          })),
        },
      ],
    });
    expect(s.sim.units).toHaveLength(5);
    const r = 47;
    for (const a of s.sim.units) {
      for (const b of s.sim.units) {
        if (a.id >= b.id) continue;
        const d = Math.hypot(a.px - b.px, a.py - b.py);
        expect(d).toBeGreaterThanOrEqual(2 * r - Math.floor(r / 2));
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('behaviour (CB-8e)', () => {
  test('a soldier that walks past outside aggro range is not drawn in', () => {
    const s = scene();
    const guard = spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      x: 6,
      y: MID,
    });
    // Column 1 is 5 cells from the post: far outside the 3 cells of aggro.
    const walker = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 1,
      y: BOARD - 1,
    });
    const home = { px: guard.px, py: guard.py };
    let nearest = Infinity;
    for (let t = 0; t < 120; t++) {
      stepArena(s.sim, s.ctx);
      nearest = Math.min(
        nearest,
        Math.hypot(walker.px - guard.px, walker.py - guard.py),
      );
    }
    expect(walker.py).toBeGreaterThan((MID + 1) * 240); // it marched past
    expect(nearest).toBeGreaterThan(3 * 240);
    expect(attacksBy(s.events, guard.id)).toHaveLength(0);
    expect(attacksOn(s.events, guard.id)).toHaveLength(0);
    expect({ px: guard.px, py: guard.py }).toEqual(home);
  });

  test('a soldier inside range fights and kills a single guard', () => {
    const s = scene();
    const guard = spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_archer',
      post: 0,
      x: 6,
      y: MID,
    });
    const soldier = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 6,
      y: MID - 3,
    });
    run(s, 200);
    expect(guard.hp).toBeLessThanOrEqual(0);
    expect(s.sim.units.includes(guard)).toBe(false);
    expect(soldier.hp).toBeGreaterThan(0);
    const died = s.events.filter((e) => e.type === 'unit_died');
    expect(died).toEqual([
      expect.objectContaining({ unit: guard.id, side: 2 }),
    ]);
    // A guard death is a guard kill for the side that dealt it, not a unit loss.
    expect(s.sim.guards?.killed).toEqual([1, 0]);
    expect(s.sim.unitsDied).toEqual([0, 0]);
    expect(s.sim.spawned).toEqual([1, 0]);
  });

  test('a leashed guard drops its target and returns to its post', () => {
    const s = scene();
    const guard = spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      px: mid(10),
      py: mid(MID) + 750, // 4.5 cells from the post: beyond the leash
    });
    // An enemy right next to it, which would be attacked if it were not leashed.
    spawnUnitForTest(s.sim, s.ctx, {
      side: 1,
      def: 'unit_soldier',
      px: mid(10) - 120,
      py: mid(MID) + 750 + 90,
      allowOverlap: true,
    });
    const dist = (): number =>
      Math.hypot(guard.px - mid(POST.x), guard.py - mid(POST.y));
    expect(dist()).toBeGreaterThan(3 * 240);
    let backAt = -1;
    for (let t = 0; t < 400 && backAt < 0; t++) {
      stepArena(s.sim, s.ctx);
      if (dist() <= 3 * 240) backAt = t;
    }
    expect(backAt).toBeGreaterThan(0);
    // It never attacked while beyond its leash.
    expect(attacksBy(s.events, guard.id)).toHaveLength(0);
    // With no enemy left it settles inside the 3x3 cells of its post.
    s.sim.units.splice(s.sim.units.indexOf(s.sim.units[1] as UnitSim), 1);
    run(s, 200);
    const c = cellOf(guard);
    expect(Math.abs(c.x - POST.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.y - POST.y)).toBeLessThanOrEqual(1);
  });

  test('a guard walking back uses the cached movement field to the point', () => {
    const s = scene();
    const guard = spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      x: 6,
      y: MID,
    });
    // Push it out of its home area by hand (a lake between it and the post).
    guard.py = mid(MID + 3);
    expect(s.ctx.postFields.size).toBe(0);
    run(s, 1);
    expect(s.ctx.postFields.size).toBe(1);
    const field = s.ctx.postFields.get(0);
    run(s, 40);
    expect(s.ctx.postFields.get(0)).toBe(field);
    expect(field?.dist[MID * W + 6]).toBe(0);
    expect(cellOf(guard).y).toBeLessThan(MID + 3);
  });

  test('a guard never leaves the neutral zone', () => {
    const s = scene();
    const guard = spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      x: 6,
      y: MID,
    });
    // A runner of side 0 keeps going back and forth just outside the zone
    // edge; the guard chases it up to its leash and never into a board.
    spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_raider',
      x: 6,
      y: BOARD,
    });
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 300; t++) {
      stepArena(s.sim, s.ctx);
      lo = Math.min(lo, guard.py - 47);
      hi = Math.max(hi, guard.py + 47);
    }
    expect(lo).toBeGreaterThanOrEqual(BOARD * 240);
    expect(hi).toBeLessThanOrEqual((BOARD + GAP) * 240);
  });

  test('an archer guard hits a drone, a soldier guard cannot', () => {
    for (const [def, hits] of [
      ['unit_archer', true],
      ['unit_soldier', false],
    ] as const) {
      const s = scene();
      const guard = spawnGuardForTest(s.sim, s.ctx, {
        def,
        post: 0,
        x: 6,
        y: MID,
      });
      const drone = spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_drone',
        x: 6,
        y: MID - 2,
      });
      run(s, 60);
      expect(attacksBy(s.events, guard.id).length > 0).toBe(hits);
      expect(attacksOn(s.events, drone.id).length > 0).toBe(hits);
      // The drone shoots the guard either way (a ranged unit hits the ground).
      expect(attacksBy(s.events, drone.id).length).toBeGreaterThan(0);
    }
  });

  test('a turret ignores a guard in range', () => {
    const lab = new Lab(tiny([[3, 2, 'res_b']]));
    lab.core(8, 0);
    const source = lab.put('bld_extractor', 3, 2, 0, 3);
    const turret = lab.put('bld_turret', 3, 15, 0, 3);
    const cells: [number, number][] = [];
    for (let y = 3; y < 15; y++) cells.push([3, y]);
    lab.link(source, 'north', turret, 'south', cells);
    const make = (side: 0 | 1 | 2): Scene => {
      const s = startArenaBattle(
        lab.state,
        coreOnly(10),
        GAP,
        content,
        simConfig,
      );
      placeGuards(s.sim, s.ctx, {
        leashCells: 3,
        posts: [{ id: 0, x: 3, y: MID }],
        plans: [],
      });
      if (side === 2) {
        spawnGuardForTest(s.sim, s.ctx, {
          def: 'unit_soldier',
          post: 0,
          x: 3,
          y: BOARD + 1, // two cells from the turret: well in range
        });
      } else {
        spawnUnitForTest(s.sim, s.ctx, {
          side,
          def: 'unit_soldier',
          x: 3,
          y: BOARD + 1,
        });
      }
      return s;
    };
    const guarded = make(2);
    run(guarded, 80);
    expect(
      guarded.events.filter((e) => e.type === 'turret_fired'),
    ).toHaveLength(0);
    // The control: an enemy unit on the same cell is shot.
    const enemy = make(1);
    run(enemy, 80);
    expect(
      enemy.events.filter((e) => e.type === 'turret_fired').length,
    ).toBeGreaterThan(0);
  });

  test('units of both sides near the same guards fight them, not each other', () => {
    const s = scene();
    const guard = spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      x: 6,
      y: MID,
    });
    const a = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: MID - 2,
    });
    const b = spawnUnitForTest(s.sim, s.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 7,
      y: MID + 2,
    });
    run(s, 300);
    // Both sides hit the guard; the two sides never hit each other (they
    // start 4 cells apart behind the guard and go for it first).
    const onGuard = attacksOn(s.events, guard.id);
    expect(new Set(onGuard.map((e) => e.unit))).toEqual(new Set([a.id, b.id]));
    expect(guard.hp).toBeLessThanOrEqual(0);
    // The guard fought back at its nearest enemy.
    expect(attacksBy(s.events, guard.id).length).toBeGreaterThan(0);
    // The kill is credited to the side that dealt the most damage that tick.
    const k = s.sim.guards?.killed ?? [0, 0];
    expect(k[0] + k[1]).toBeGreaterThanOrEqual(1);
    expect(s.sim.unitsDied[0] + s.sim.unitsDied[1]).toBeLessThanOrEqual(2);
  });

  test('guards of two points never fight each other', () => {
    const s = scene();
    placeGuards(s.sim, s.ctx, {
      leashCells: 3,
      posts: [
        { id: 0, x: 3, y: MID },
        { id: 1, x: 6, y: MID },
      ],
      plans: [],
    });
    const g0 = spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      x: 3,
      y: MID,
    });
    const g1 = spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 1,
      x: 5,
      y: MID,
    });
    run(s, 100);
    expect(attacksBy(s.events, g0.id)).toHaveLength(0);
    expect(attacksBy(s.events, g1.id)).toHaveLength(0);
  });

  test('Overload does not make guards hit harder, and guards ignore buildings', () => {
    const s = scene();
    const guard = spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      x: 6,
      y: MID,
    });
    const foe = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_golem',
      x: 6,
      y: MID - 1,
    });
    // Fast-forward to a late tick: Overload would multiply a side's hits.
    s.sim.tick = 6000;
    run(s, 12);
    const hits = attacksBy(s.events, guard.id);
    expect(hits.length).toBeGreaterThan(0);
    // 6 base damage, 3 armor: the unchanged hit, not the Overload-scaled one.
    expect(hits.every((h) => h.damage === 3)).toBe(true);
    expect(foe.hp).toBeLessThan(260);
    expect(
      s.events.some(
        (e) =>
          e.type === 'unit_attacked' &&
          e.unit === guard.id &&
          e.target.kind !== 'unit',
      ),
    ).toBe(false);
  });

  test('restoring the state at any tick continues the same', () => {
    const make = (): Scene => {
      const s = scene();
      spawnGuardForTest(s.sim, s.ctx, {
        def: 'unit_soldier',
        post: 0,
        x: 6,
        y: MID,
      });
      spawnGuardForTest(s.sim, s.ctx, {
        def: 'unit_archer',
        post: 0,
        x: 7,
        y: MID,
      });
      spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_soldier',
        x: 6,
        y: MID - 3,
      });
      spawnUnitForTest(s.sim, s.ctx, {
        side: 1,
        def: 'unit_soldier',
        x: 6,
        y: MID + 3,
      });
      return s;
    };
    const a = make();
    run(a, 150);
    for (const at of [0, 17, 60]) {
      const b = make();
      run(b, at);
      const restored = JSON.parse(JSON.stringify(b.sim)) as ArenaSim;
      const c: Scene = {
        sim: restored,
        ctx: undefined as unknown as ArenaContext,
        events: [],
      };
      c.ctx = createContext(restored, c.events);
      run(c, 150 - at);
      expect(hashJson(c.sim)).toBe(hashJson(a.sim));
    }
  });

  test('a unit the guards kill is a loss, not a kill of the other side', () => {
    const zone: NeutralZone = {
      width: W,
      depth: GAP,
      features: [],
      pointsOfInterest: [{ id: 0, band: 0, x: 6, y: 3, buff: 'poi_heal' }],
    };
    const started = startBattle(
      { teamA: coreOnly(1), teamB: coreOnly(10), seed: 3, round: 1 },
      content,
      { sim: simConfig, mapgen },
      { zone },
    );
    if (!started.ok) throw new Error(started.error.message);
    const { battle } = started;
    const raider = spawnUnitForTest(battle.sim, battle.ctx, {
      side: 0,
      def: 'unit_raider',
      x: 6,
      y: BOARD + 1,
    });
    for (let t = 0; t < 200 && raider.hp > 0; t++) battle.step();
    expect(raider.hp).toBeLessThanOrEqual(0);
    const [a, b] = battle.summary().sides;
    expect(a.unitsLost).toBe(1);
    expect(b.unitsKilled).toBe(0);
    expect(battle.sim.guards?.lostToGuards).toEqual([1, 0]);
    // The guards killed nothing of the guards' own: guardsKilled is separate.
    expect(a.guardsKilled + b.guardsKilled).toBe(0);
  });

  test('guards are not in the unit counts or tiebreak counters of a battle', () => {
    const zone: NeutralZone = {
      width: W,
      depth: GAP,
      features: [],
      pointsOfInterest: [{ id: 0, band: 0, x: 6, y: 3, buff: 'poi_heal' }],
    };
    const r = simulateBattle(
      { teamA: coreOnly(1), teamB: coreOnly(10), seed: 3, round: 1 },
      content,
      { sim: simConfig, mapgen },
      { zone },
    );
    if (!r.ok) throw new Error(r.error.message);
    // Two Cores and no units but the guards: the battle ends at the time
    // limit, decided by the ladder alone (guards never decide it).
    expect(r.result.reason).toBe('tiebreak_attacker');
    expect(r.summary.sides[0].unitsSpawned).toBe(0);
    expect(r.summary.sides[0].unitsLost).toBe(0);
    expect(r.summary.sides[0].guardsKilled).toBe(0);
    const spawned = r.eventLog.filter((e) => e.type === 'guard_spawned').length;
    expect(spawned).toBeGreaterThan(0);
    expect(
      r.summary.timeline.every(
        (t) => t.sides[0].units === 0 && t.sides[1].units === 0,
      ),
    ).toBe(true);
  });
});

function createContext(sim: ArenaSim, events: ArenaEvent[]): ArenaContext {
  return createArenaContext(sim, content, simConfig, { events });
}
