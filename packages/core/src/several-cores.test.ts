/** Battles with several Cores per side (PP-9, PP-10, issue #132). */
import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  isCoreHealth,
  stepArena,
  type ArenaEvent,
  type ArenaSim,
  type UnitSim,
} from './arena-sim.js';
import { hashJson } from './hash.js';
import { CELL_UNITS } from './limits.js';
import {
  startBattle,
  simulateBattle,
  sumOverkill,
  type Battle,
} from './battle.js';
import type { GameMap } from './map.js';
import type { NeutralZone } from './neutral-zone.js';
import { MAX_TICK_DAMAGE } from './limits.js';
import { overloadDeadline, overloadOutcome } from './ramp.js';
import type { SideOptions } from './arena-sim.js';
import type { SimConfig } from './sim-config.js';
import type { TeamState } from './team-state.js';
import { Lab, content, mapgen, simConfig } from './testing/support.js';

const config = { sim: simConfig, mapgen };
const zoneOf = (width: number): NeutralZone => ({
  width,
  depth: mapgen.neutralZone.depth,
  features: [],
  pointsOfInterest: [],
});

/** A two-player board: plots of 12 columns. */
function map2(): GameMap {
  return {
    width: 24,
    height: 16,
    partySize: 2,
    plotWidth: 12,
    features: [],
    nodes: [
      { x: 2, y: 2, resource: 'res_a' },
      { x: 14, y: 2, resource: 'res_a' },
    ],
  };
}

/** Two Cores, one per player; with `farm`, a working extractor + barracks per plot. */
function team2(farm: boolean, turret = false): TeamState {
  const lab = new Lab(map2());
  lab.core(5, 0, 0);
  lab.core(17, 0, 1);
  if (turret) lab.put('bld_turret', 20, 6);
  if (farm) {
    for (const x of [2, 14]) {
      const e = lab.put('bld_extractor', x, 2, 0, 3);
      const b = lab.put('bld_barracks', x, 6, 0, 3);
      lab.link(e, 'north', b, 'south', [
        [x, 3],
        [x, 4],
        [x, 5],
      ]);
    }
  }
  return lab.state;
}

function start(
  a: TeamState,
  b: TeamState,
  sideOptions?: [SideOptions | null, SideOptions | null],
  cfg: SimConfig = simConfig,
): Battle {
  const r = startBattle(
    {
      teamA: a,
      teamB: b,
      seed: 1,
      ...(sideOptions === undefined ? {} : { sideOptions }),
    },
    content,
    { sim: cfg, mapgen },
    { zone: zoneOf(a.map.width) },
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.battle;
}

function runToEnd(battle: Battle): void {
  while (!battle.isOver()) battle.step();
}

function events<T extends ArenaEvent['type']>(
  battle: Battle,
  type: T,
): Extract<ArenaEvent, { type: T }>[] {
  return battle.eventLog.filter(
    (e): e is Extract<ArenaEvent, { type: T }> => e.type === type,
  );
}

/** Cumulative Overload decay after beat `n` (5 * n * (n + 1) / 2 with the shipped step). */
function decayAfter(n: number): number {
  return (simConfig.overloadCoreDamageStep * n * (n + 1)) / 2;
}

describe('several Cores per side', () => {
  test('the health list holds the Cores by player before the buildings', () => {
    const b = start(team2(true), team2(true));
    expect(b.sim.health.slice(0, 2)).toEqual([
      { side: 0, core: 0, hp: 500, remaining: 500, fellTick: null },
      { side: 0, core: 1, hp: 500, remaining: 500, fellTick: null },
    ]);
    expect(b.sim.health.filter(isCoreHealth)).toHaveLength(4);
    expect(b.sim.health[2]).toHaveProperty('building');
  });

  test('a battle does not end when one Core falls, only when a side has none', () => {
    const b = start(team2(false), team2(false), [
      null,
      { coreHealths: [20, 500] },
    ]);
    runToEnd(b);
    const fall = events(b, 'core_destroyed');
    // Side 1's player-0 Core falls at the first beats; the battle goes on.
    expect(fall[0]).toMatchObject({ side: 1, core: 0 });
    const first = fall[0]?.tick ?? 0;
    expect(first).toBe(2000);
    expect(b.result()?.endTick).toBeGreaterThan(first + 1000);
    // All remaining Cores fall together at tick 3100 (every Core 500).
    const last = fall.filter((e) => e.tick > first);
    expect(last).toHaveLength(3);
    for (const e of last) expect(e.tick).toBe(3100);
    expect(b.result()?.endTick).toBe(3101);
    expect(b.summary().sides[1].cores.map((c) => c.destroyedTick)).toEqual([
      first,
      3100,
    ]);
  });

  test('every living Core takes the full Overload amount; a destroyed one nothing', () => {
    const b = start(team2(false), team2(false), [
      null,
      { coreHealths: [20, 500] },
    ]);
    runToEnd(b);
    const hits = events(b, 'overload_core_damage');
    const at = (tick: number) =>
      hits.filter((e) => e.tick === tick).map((e) => [e.side, e.core]);
    expect(at(1800)).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    // 20 health: gone after beat 3 (5 + 10 + 15); no more hits for it.
    const gone = events(b, 'core_destroyed')[0]?.tick ?? 0;
    expect(gone).toBe(2000);
    expect(at(2100)).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
    for (const e of hits.filter((h) => h.tick === 2100)) {
      expect(e.damage).toBe(5 * 4);
    }
  });

  test('with every Core at 500 all Cores of both sides fall at tick 3100', () => {
    const solo = (): TeamState => {
      const lab = new Lab({
        ...map2(),
        width: 12,
        partySize: 1,
        plotWidth: 12,
      });
      lab.core(5, 0, 0);
      return lab.state;
    };
    for (const [a, b, cores] of [
      [solo(), solo(), 2],
      [team2(false), team2(false), 4],
    ] as const) {
      const battle = start(a, b);
      runToEnd(battle);
      const fall = events(battle, 'core_destroyed');
      expect(fall).toHaveLength(cores);
      for (const e of fall) expect(e.tick).toBe(3100);
      expect(battle.result()).toMatchObject({
        winner: 0,
        reason: 'tiebreak_attacker',
        endTick: 3101,
      });
    }
  });

  test('a player whose Core fell keeps producing, shooting and feeding', () => {
    // Side 0 has a turret that needs no feeding; its Core of player 1 is the
    // one every enemy unit heads for (the opposite of plot 0 is Core 1).
    const b = start(team2(true, true), team2(true), [
      { coreHealths: [500, 20], freePower: true },
      null,
    ]);
    const fired = () => events(b, 'turret_fired').length;
    while (!b.isOver() && events(b, 'core_destroyed').length === 0) b.step();
    const fell = events(b, 'core_destroyed')[0];
    expect(fell).toMatchObject({ side: 0, core: 1 });
    const producers = b.sim.producers.length;
    const buildings = b.sim.teams[0].buildings.length;
    const spawned = b.sim.spawned[0];
    const shots = fired();
    for (let i = 0; i < 400 && !b.isOver(); i++) b.step();
    expect(b.sim.producers).toHaveLength(producers);
    expect(b.sim.teams[0].buildings).toHaveLength(buildings);
    expect(b.sim.spawned[0]).toBeGreaterThan(spawned);
    // The turret keeps shooting after its owner's Core is gone (PP-9).
    expect(fired()).toBeGreaterThan(shots);
    expect(events(b, 'conduit_destroyed')).toEqual([]);
  });
});

describe('the tiebreak ladder with several Cores (PP-10)', () => {
  /** A test-only time limit before Overload, and Cores set by hand. */
  const short: SimConfig = { ...simConfig, maxBattleTicks: 50 };
  function limited(hp0: [number, number], hp1: [number, number]): Battle {
    const b = start(team2(false), team2(false), undefined, short);
    const set = (side: number, list: [number, number]): void => {
      for (const h of b.sim.health) {
        if (isCoreHealth(h) && h.side === side) h.hp = list[h.core] ?? 0;
      }
    };
    set(0, hp0);
    set(1, hp1);
    return b;
  }

  test('rung 1: more Cores standing wins, also for the defender', () => {
    const a = limited([500, 0], [500, 500]);
    runToEnd(a);
    expect(a.result()).toMatchObject({ winner: 1, reason: 'time_limit' });
    const b = limited([500, 500], [0, 500]);
    runToEnd(b);
    expect(b.result()).toMatchObject({ winner: 0, reason: 'time_limit' });
  });

  test('rung 2: equal Cores standing, the larger share of total Core health wins', () => {
    const a = limited([500, 100], [500, 400]);
    runToEnd(a);
    expect(a.result()).toMatchObject({ winner: 1, reason: 'time_limit' });
    // 600/1000 against 600/1000: equal, falls through to the attacker.
    const b = limited([500, 100], [100, 500]);
    runToEnd(b);
    expect(b.result()).toMatchObject({
      winner: 0,
      reason: 'tiebreak_attacker',
    });
  });

  test('rung 3: both sides lose their last Core in one tick, less overkill wins', () => {
    // Beat n takes decayAfter(n) in all; pick n so the Cores fall on the same beat.
    const n = 14;
    const hit = decayAfter(n);
    expect(decayAfter(n - 1)).toBeLessThan(hit - 8);
    // Side 0: overkill 0 + 3; side 1: 0 + 0 -> the defender wins this rung.
    const b = start(team2(false), team2(false), [
      { coreHealths: [hit - 0, hit - 3] },
      { coreHealths: [hit - 0, hit - 0] },
    ]);
    runToEnd(b);
    expect(b.result()).toMatchObject({
      winner: 1,
      reason: 'tiebreak_overkill',
    });
    expect(b.summary().sides[0].coreOverkill).toBe(3);
    expect(b.summary().sides[1].coreOverkill).toBe(0);
  });

  test('rung 3 counts only the Cores that fell in the final tick', () => {
    const n = 14;
    const hit = decayAfter(n);
    // Side 0's first Core fell at beat 10 with overkill; it must add nothing.
    const early = decayAfter(10) - 1;
    const b = start(team2(false), team2(false), [
      { coreHealths: [early, hit - 1] },
      { coreHealths: [hit - 5, hit - 5] },
    ]);
    runToEnd(b);
    const sides = b.summary().sides;
    expect(sides[0].coreOverkill).toBe(1);
    expect(sides[1].coreOverkill).toBe(10);
    expect(b.result()).toMatchObject({
      winner: 0,
      reason: 'tiebreak_overkill',
    });
    expect(overloadDeadline(simConfig, hit).decayDestroysTick).toBe(3100);
  });

  test('the overkill sum saturates and never wraps', () => {
    expect(sumOverkill([])).toBe(0);
    expect(sumOverkill([3, 4])).toBe(7);
    const big = MAX_TICK_DAMAGE - 1;
    expect(sumOverkill([big, big, big, big])).toBe(MAX_TICK_DAMAGE);
    expect(sumOverkill([big, 5])).toBe(MAX_TICK_DAMAGE);
  });
});

describe('summary and helpers', () => {
  test('the summary lists every Core and totals', () => {
    const b = start(team2(false), team2(false));
    runToEnd(b);
    const s = b.summary().sides[0];
    expect(s.cores).toHaveLength(2);
    expect(s.cores[0]).toMatchObject({ player: 0, health: 0, maxHealth: 500 });
    expect(s.coresStanding).toBe(0);
    expect(s.coreMaxHealth).toBe(1000);
    expect(s.coreHealth).toBe(0);
    expect(s.coreOverkill).toBe(2 * 25);
  });

  test('overloadOutcome compares the last-Core ticks of two lists', () => {
    expect(overloadOutcome(simConfig, [500, 500], [500, 500])).toEqual({
      first: 'both',
      tick: 3100,
    });
    // The last Core of side a is the 500 one (3100); side b's is at 2100.
    expect(overloadOutcome(simConfig, [42, 500], [42, 42])).toEqual({
      first: 'b',
      tick: 2100,
    });
    expect(
      simulateBattle(
        { teamA: team2(false), teamB: team2(false), seed: 1 },
        content,
        config,
        { zone: zoneOf(24) },
      ).ok,
    ).toBe(true);
  });
});

describe('mirror and restore with several Cores per side', () => {
  const opts = (): [SideOptions, SideOptions] => [
    { coreHealths: [500, 20], freePower: true },
    { coreHealths: [500, 20], freePower: true },
  ];
  const A = 16 * 2 + mapgen.neutralZone.depth;
  const mirrorKey = (units: readonly UnitSim[], side: number): string[] =>
    units
      .filter((u) => u.side === side)
      .map((u) => {
        const x = side === 0 ? u.px : 24 * CELL_UNITS - u.px;
        const y = side === 0 ? u.py : A * CELL_UNITS - u.py;
        return `${u.def} ${String(x)},${String(y)} hp${String(u.hp)} o${String(u.owner)} t${String(u.target)}`;
      })
      .sort();

  test('equal teams stay mirror images tick by tick while a Core of each side falls', () => {
    const b = start(team2(true, true), team2(true, true), opts());
    let fell = -1;
    for (let t = 0; t < 3000 && !b.isOver(); t++) {
      b.step();
      expect(mirrorKey(b.sim.units, 1), `tick ${String(t)}`).toEqual(
        mirrorKey(b.sim.units, 0),
      );
      const hp = (s: number) =>
        b.sim.health.filter((h) => h.side === s).map((h) => h.hp);
      expect(hp(1)).toEqual(hp(0));
      if (fell < 0 && events(b, 'core_destroyed').length > 0) fell = t;
    }
    // The Cores 1 fell first, then the units retargeted: the check ran across both.
    expect(fell).toBeGreaterThan(0);
    expect(
      events(b, 'core_destroyed')
        .slice(0, 2)
        .map((e) => [e.side, e.core]),
    ).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  test('restoring the arena at any sampled tick around the first fall continues like the straight run', () => {
    const make = (): Battle =>
      start(team2(true, true), team2(true), [opts()[0], null]);
    const ref = make();
    const hashes = [hashJson(ref.sim)];
    let fell = -1;
    for (let t = 0; t < 1500 && !ref.isOver(); t++) {
      ref.step();
      hashes.push(hashJson(ref.sim));
      if (fell < 0 && events(ref, 'core_destroyed').length > 0) fell = t + 1;
    }
    expect(fell).toBeGreaterThan(5);
    const total = hashes.length - 1;
    for (const at of [0, 1, fell - 2, fell - 1, fell, fell + 1, fell + 40]) {
      const a = make();
      for (let t = 0; t < at; t++) a.step();
      const copy = JSON.parse(JSON.stringify(a.sim)) as ArenaSim;
      const ctx = createArenaContext(copy, content, simConfig);
      for (let t = at; t < total; t++) {
        stepArena(copy, ctx);
        expect(
          hashJson(copy),
          `restored at ${String(at)}, tick ${String(t + 1)}`,
        ).toBe(hashes[t + 1]);
      }
    }
  });
});

describe('Core overkill and fall tick survive a restore (issue #157)', () => {
  test('a Core that fell before the restore point keeps its overkill and fall tick', () => {
    const make = (): Battle =>
      start(team2(true, true), team2(true), [
        { coreHealths: [500, 20], freePower: true },
        null,
      ]);
    const ref = make();
    let fellEvent = -1;
    for (let t = 0; t < 1500 && !ref.isOver() && fellEvent < 0; t++) {
      ref.step();
      const e = events(ref, 'core_destroyed')[0];
      if (e !== undefined) fellEvent = e.tick;
    }
    expect(fellEvent).toBeGreaterThan(0);
    // Run on, so the restore point is well after the fall.
    for (let t = 0; t < 30 && !ref.isOver(); t++) ref.step();
    const overkill = ref.ctx.coreRemaining.map((row) => row.slice());
    // The dead Core really had overkill, or the test would pass vacuously.
    expect(overkill[0]?.[1]).toBeLessThan(0);
    const copy = JSON.parse(JSON.stringify(ref.sim)) as ArenaSim;
    const ctx = createArenaContext(copy, content, simConfig);
    expect(ctx.coreRemaining).toEqual(overkill);
    const dead = copy.health.find(
      (h) => isCoreHealth(h) && h.side === 0 && h.core === 1,
    );
    expect(dead !== undefined && isCoreHealth(dead) && dead.fellTick).toBe(
      fellEvent,
    );
  });
});

describe('economy bonuses through real unit production (PP-8, issue #175)', () => {
  test("player 1's producer makes a unit without the Armory of player 0; player 0's producer makes a stronger one", () => {
    const lab = new Lab(map2());
    lab.core(5, 0, 0);
    lab.core(17, 0, 1);
    lab.put('bld_armory', 8, 10, 0, 3);
    for (const x of [2, 14]) {
      const e = lab.put('bld_extractor', x, 2, 0, 3);
      const b = lab.put('bld_barracks', x, 6, 0, 3);
      lab.link(e, 'north', b, 'south', [
        [x, 3],
        [x, 4],
        [x, 5],
      ]);
    }
    const b = start(lab.state, team2(false));
    for (const r of b.sim.ramps) r.steps = 10;
    while (!b.isOver() && b.sim.units.length < 2 && b.sim.tick < 600) b.step();
    const spawned = events(b, 'unit_spawned').filter((e) => e.side === 0);
    const by = (owner: number) =>
      b.sim.units.find((u) =>
        spawned.some((e) => e.unit === u.id && e.owner === owner),
      );
    const mine = by(0);
    const partner = by(1);
    if (mine === undefined || partner === undefined) {
      throw new Error('both producers should have spawned a unit');
    }
    const base = content.units.get(mine.def);
    expect(base).toBeDefined();
    expect(partner.hp).toBe(base?.health);
    expect(mine.hp).toBeGreaterThan(partner.hp);
  });
});
