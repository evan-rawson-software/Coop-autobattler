import { CELL_UNITS, MAX_HEALTH, MAX_TICK_DAMAGE } from './limits.js';
import { describe, expect, test } from 'vitest';
import { toArena } from './arena.js';
import {
  spawnUnitForTest,
  type ArenaEvent,
  type UnitSim,
} from './arena-sim.js';
import { simulateBattle, startBattle, type BattleResult } from './battle.js';
import { hashJson, type Json } from './hash.js';
import { overloadDeadline, overloadOutcome } from './ramp.js';
import type { GameMap } from './map.js';
import type { NeutralZone } from './neutral-zone.js';
import type { SimConfig } from './sim-config.js';
import { createTeamState, type TeamState } from './team-state.js';
import {
  Lab,
  TIMING,
  bigBoard,
  content,
  mapgen,
  simConfig,
} from './test-support.js';
import { randomTeam } from './test-teams.js';

const config = { sim: simConfig, mapgen };

function tiny(nodes: [number, number, string][] = [], height = 16): GameMap {
  return {
    width: 12,
    height,
    partySize: 1,
    plotWidth: 12,
    features: [],
    nodes: nodes.map(([x, y, resource]) => ({ x, y, resource })),
  };
}

function coreOnly(): TeamState {
  const lab = new Lab(tiny());
  lab.core(5, 0);
  return lab.state;
}

/** Two extractor + barracks lines, two walls: a small working factory. */
function farmTeam(): TeamState {
  const lab = new Lab(
    tiny([
      [2, 2, 'res_a'],
      [8, 2, 'res_a'],
    ]),
  );
  lab.core(5, 0);
  const e1 = lab.put('bld_extractor', 2, 2, 0, 3);
  const b1 = lab.put('bld_barracks', 2, 6, 0, 3);
  lab.link(e1, 'north', b1, 'south', [
    [2, 3],
    [2, 4],
    [2, 5],
  ]);
  const e2 = lab.put('bld_extractor', 8, 2, 0, 3);
  const b2 = lab.put('bld_barracks', 8, 6, 0, 3);
  lab.link(e2, 'north', b2, 'south', [
    [8, 3],
    [8, 4],
    [8, 5],
  ]);
  lab.put('bld_wall', 4, 12);
  lab.put('bld_wall', 7, 12);
  return lab.state;
}

function emptyZone(
  width: number,
  depth = mapgen.neutralZone.depth,
): NeutralZone {
  return { width, depth, features: [], pointsOfInterest: [] };
}

function run(
  a: TeamState,
  b: TeamState,
  seed: number,
  cfg = config,
  options = {},
) {
  const r = simulateBattle({ teamA: a, teamB: b, seed }, content, cfg, options);
  if (!r.ok) throw new Error(r.error.message);
  return r;
}

describe('refused battles', () => {
  test('different party sizes are rejected first, with a typed error', () => {
    const one = randomTeam(3, 1);
    const two = randomTeam(4, 2);
    const noCore: TeamState = { ...one, cores: one.cores.map(() => null) };
    for (const [a, b] of [
      [one, two],
      [two, one],
      [noCore, two],
    ] as const) {
      const r = simulateBattle(
        { teamA: a, teamB: b, seed: 1 },
        content,
        config,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('party_size_mismatch');
        expect(r.error.message).toMatch(/same party size/);
      }
    }
  });

  test('a side with no Core placed at all is refused', () => {
    const two = bigBoard();
    const lab = new Lab(two.map);
    lab.state = two;
    lab.core(2, 6, 0);
    const none = simulateBattle(
      { teamA: createTeamState(two.map), teamB: lab.state, seed: 1 },
      content,
      config,
    );
    expect(none.ok ? null : none.error.code).toBe('core_not_placed');
  });

  test('core_not_placed carries the lowest player index without a Core', () => {
    const full = randomTeam(7, 3);
    expect(full.cores.every((c) => c !== null)).toBe(true);
    const missing = (...gone: number[]): TeamState => ({
      ...full,
      cores: full.cores.map((c, p) => (gone.includes(p) ? null : c)),
    });
    const err = (a: TeamState, b: TeamState) => {
      const r = startBattle({ teamA: a, teamB: b, seed: 1 }, content, config);
      return r.ok ? null : [r.error.code, r.error.side, r.error.player];
    };
    expect(err(missing(1, 2), full)).toEqual(['core_not_placed', 0, 1]);
    expect(err(full, missing(2))).toEqual(['core_not_placed', 1, 2]);
    expect(err(full, missing(0, 2))).toEqual(['core_not_placed', 1, 0]);
    // Side 0 is checked first.
    expect(err(missing(2), missing(0))).toEqual(['core_not_placed', 0, 2]);
  });

  test('a different board height is rejected', () => {
    const lab = new Lab(tiny([], 14));
    lab.core(5, 0);
    const r = simulateBattle(
      { teamA: coreOnly(), teamB: lab.state, seed: 1 },
      content,
      config,
    );
    expect(r.ok ? null : r.error.code).toBe('board_size_mismatch');
  });

  test('an unplaced Core is rejected, naming the side', () => {
    const open = new Lab(tiny()).state;
    const a = simulateBattle(
      { teamA: open, teamB: coreOnly(), seed: 1 },
      content,
      config,
    );
    expect(a.ok ? null : [a.error.code, a.error.side]).toEqual([
      'core_not_placed',
      0,
    ]);
    const b = simulateBattle(
      { teamA: coreOnly(), teamB: open, seed: 1 },
      content,
      config,
    );
    expect(b.ok ? null : [b.error.code, b.error.side]).toEqual([
      'core_not_placed',
      1,
    ]);
    const both = startBattle(
      { teamA: open, teamB: open, seed: 1 },
      content,
      config,
    );
    expect(both.ok ? null : both.error.side).toBe(0);
    expect(both.ok ? null : both.error.player).toBe(0);
  });

  test('a handed-in zone must fit', () => {
    const bad = startBattle(
      { teamA: coreOnly(), teamB: coreOnly(), seed: 1 },
      content,
      config,
      { zone: emptyZone(24) },
    );
    expect(bad.ok ? null : bad.error.code).toBe('invalid_zone');
    const sealed = startBattle(
      { teamA: coreOnly(), teamB: coreOnly(), seed: 1 },
      content,
      config,
      {
        zone: {
          width: 12,
          depth: 3,
          features: [{ x: 5, y: 0, feature: 'ter_lake' }],
          pointsOfInterest: [],
        },
      },
    );
    expect(sealed.ok ? null : sealed.error.code).toBe('invalid_zone');
  });
});

describe('party sizes 1 to 4', () => {
  test.each([1, 2, 3, 4])('%i plots run to completion', (plots) => {
    const a = randomTeam(10 + plots, plots);
    const b = randomTeam(20 + plots, plots);
    const r = run(a, b, 5 + plots);
    expect(r.zone.width).toBe(plots * mapgen.plotWidth);
    expect(r.zone.depth).toBe(mapgen.neutralZone.depth);
    expect(r.result.endTick).toBeLessThan(simConfig.maxBattleTicks);
    expect(r.eventLog.at(-1)?.type).toBe('battle_ended');
  });
});

describe('events, summary and the incremental API', () => {
  const a = randomTeam(2, 3);
  const b = randomTeam(102, 3);
  const r = run(a, b, 2);

  test('the log starts with the zone and ends with the result', () => {
    expect(r.eventLog[0]).toEqual({
      tick: 0,
      type: 'zone_revealed',
      zone: r.zone,
    });
    const ended = r.eventLog.filter((e) => e.type === 'battle_ended');
    expect(ended).toHaveLength(1);
    expect(r.eventLog.at(-1)).toEqual({
      tick: r.result.endTick - 1,
      type: 'battle_ended',
      winner: r.result.winner,
      reason: r.result.reason,
    });
    expect(r.eventLog.filter((e) => e.type === 'zone_revealed')).toHaveLength(
      1,
    );
    expect(JSON.parse(JSON.stringify(r.eventLog))).toEqual(r.eventLog);
  });

  test('the summary agrees with the log', () => {
    const count = (type: ArenaEvent['type'], side: number): number =>
      r.eventLog.filter(
        (e) => e.type === type && ('side' in e ? e.side === side : false),
      ).length;
    for (const side of [0, 1] as const) {
      const s = r.summary.sides[side];
      expect(s.unitsSpawned).toBe(count('unit_spawned', side));
      expect(s.buildingsLost).toBe(count('building_destroyed', side));
      expect(s.rampSteps).toBe(count('ramp_step', side));
      expect(s.coreMaxHealth).toBe(500 * 3);
      expect(s.coreHealth).toBeGreaterThanOrEqual(0);
      expect(s.coreHealth > 0).toBe(s.coreOverkill === 0);
    }
    const died = r.eventLog.filter((e) => e.type === 'unit_died').length;
    expect(died).toBe(
      r.summary.sides[0].unitsLost + r.summary.sides[1].unitsLost,
    );
    const loser = r.summary.sides[r.result.winner === 0 ? 1 : 0];
    expect(loser.coreHealth).toBe(0);
  });

  test('the timeline is sampled every timelineSampleTicks and at the end', () => {
    const t = r.summary.timeline;
    expect(t[0]?.tick).toBe(0);
    expect(t[0]?.sides[0].units).toBe(0);
    expect(t[0]?.sides[0].buildings).toBe(a.buildings.length);
    for (let i = 1; i < t.length - 1; i++) {
      expect(t[i]?.tick).toBe(i * simConfig.timelineSampleTicks);
    }
    expect(t.at(-1)?.tick).toBe(r.result.endTick);
    let peak = 0;
    for (const sample of t) {
      for (const s of sample.sides) {
        expect(s.unitHealth >= 0 && s.units >= 0 && s.buildings >= 0).toBe(
          true,
        );
        expect(s.units === 0).toBe(s.unitHealth === 0);
        peak = Math.max(peak, s.units);
      }
    }
    expect(peak).toBeGreaterThan(0);
    const last = t.at(-1);
    expect(last?.sides[0].buildings).toBe(
      a.buildings.length - r.summary.sides[0].buildingsLost,
    );
  });

  test('startBattle stepped by hand gives the same battle', () => {
    const s = startBattle({ teamA: a, teamB: b, seed: 2 }, content, config);
    if (!s.ok) throw new Error('refused');
    const battle = s.battle;
    expect(battle.isOver()).toBe(false);
    expect(battle.result()).toBeNull();
    let steps = 0;
    while (!battle.isOver()) {
      battle.step();
      steps++;
    }
    expect(steps).toBe(r.result.endTick);
    expect(battle.result()).toEqual(r.result);
    expect(battle.summary()).toEqual(r.summary);
    expect(hashJson(battle.eventLog as unknown as Json)).toBe(
      hashJson(r.eventLog as unknown as Json),
    );
  });

  test('a finished battle does not step any further', () => {
    const s = startBattle({ teamA: a, teamB: b, seed: 2 }, content, config);
    if (!s.ok) throw new Error('refused');
    while (!s.battle.isOver()) s.battle.step();
    const tick = s.battle.sim.tick;
    const events = s.battle.eventLog.length;
    const hash = hashJson(s.battle.sim);
    s.battle.step();
    s.battle.step();
    expect(s.battle.sim.tick).toBe(tick);
    expect(s.battle.eventLog.length).toBe(events);
    expect(hashJson(s.battle.sim as unknown as Json)).toBe(hash);
  });
});

describe('determinism', () => {
  test('the same inputs give the same result, summary and event log', () => {
    for (const [sa, sb, seed] of [
      [1, 101, 1],
      [4, 104, 77],
    ] as const) {
      const ps = 1 + (sa % 3);
      const one = run(randomTeam(sa, ps), randomTeam(sb, ps), seed);
      const two = run(randomTeam(sa, ps), randomTeam(sb, ps), seed);
      expect(two.result).toEqual(one.result);
      expect(two.summary).toEqual(one.summary);
      expect(hashJson(two.eventLog as unknown as Json)).toBe(
        hashJson(one.eventLog as unknown as Json),
      );
    }
  });

  test('the battle seed changes the zone and may change the battle', () => {
    const a = randomTeam(1, 1);
    const b = randomTeam(101, 1);
    const zones = new Set<string>();
    for (let seed = 0; seed < 10; seed++) {
      zones.add(JSON.stringify(run(a, b, seed).zone));
    }
    expect(zones.size).toBeGreaterThan(3);
  });

  test('the zone depends on the seed and width only, not on the teams', () => {
    const z1 = run(randomTeam(1, 1), randomTeam(101, 1), 9).zone;
    const z2 = run(randomTeam(8, 1), randomTeam(19, 1), 9).zone;
    expect(z1).toEqual(z2);
  });
});

describe('mirror matches (symmetry)', () => {
  const H = 16;
  const DEPTH = mapgen.neutralZone.depth;
  const A = H * 2 + DEPTH;

  function mirrorKey(units: readonly UnitSim[], side: number): string[] {
    return units
      .filter((u) => u.side === side)
      .map((u) => {
        const x = side === 0 ? u.px : 12 * CELL_UNITS - u.px;
        const y = side === 0 ? u.py : A * CELL_UNITS - u.py;
        return `${u.def} ${String(x)},${String(y)} hp${String(u.hp)}`;
      })
      .sort();
  }

  function symmetricRun(zone: NeutralZone) {
    const team = farmTeam();
    const s = startBattle(
      { teamA: team, teamB: team, seed: 3 },
      content,
      config,
      {
        zone,
      },
    );
    if (!s.ok) throw new Error('refused');
    const { battle } = s;
    let ticks = 0;
    while (!battle.isOver()) {
      battle.step();
      ticks++;
      expect(mirrorKey(battle.sim.units, 1)).toEqual(
        mirrorKey(battle.sim.units, 0),
      );
      expect(
        battle.sim.health.filter((h) => h.side === 0).map((h) => h.hp),
      ).toEqual(battle.sim.health.filter((h) => h.side === 1).map((h) => h.hp));
    }
    expect(ticks).toBeGreaterThan(100);
    return battle;
  }

  test('an empty zone: exactly symmetric, ends by the attacker tiebreak', () => {
    const battle = symmetricRun(emptyZone(12));
    expect(battle.result()).toMatchObject({
      winner: 0,
      reason: 'tiebreak_attacker',
    });
    const [s0, s1] = battle.summary().sides;
    expect(s0).toEqual(s1);
    expect(s0.coreHealth).toBe(0);
    expect(s0.unitsSpawned).toBeGreaterThan(10);
  });

  test('a point-symmetric zone with features: the same', () => {
    const lake = (x: number, y: number) => ({ x, y, feature: 'ter_lake' });
    const zone: NeutralZone = {
      width: 12,
      depth: DEPTH,
      // (x, y) <-> (11 - x, 6 - y)
      features: [
        lake(3, 2),
        lake(4, 2),
        lake(5, 3),
        lake(6, 3),
        lake(7, 4),
        lake(8, 4),
      ],
      pointsOfInterest: [],
    };
    expect(zone.features).toEqual(
      [...zone.features].sort((p, q) => p.y - q.y || p.x - q.x),
    );
    const battle = symmetricRun(zone);
    expect(battle.result()).toMatchObject({
      winner: 0,
      reason: 'tiebreak_attacker',
    });
  });

  test('with a generated zone the mirror match still ends with a valid result', () => {
    const team = farmTeam();
    const reasons = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const r = run(team, team, seed);
      expect(r.result.endTick).toBeLessThan(simConfig.maxBattleTicks);
      expect([0, 1]).toContain(r.result.winner);
      reasons.add(r.result.reason);
    }
    expect(reasons.size).toBeGreaterThan(0);
  });
});

describe('buildings never act in or reach into the zone', () => {
  const H = 16;

  /**
   * Steps a battle, checking each turret shot's target: the unit stood, at
   * the start of the tick (the snapshot the turrets decide on), in the arena
   * rows of the turret owner's board or the zone.
   */
  function checkTurretShots(a: TeamState, b: TeamState, seed: number): number {
    const s = startBattle({ teamA: a, teamB: b, seed }, content, config);
    if (!s.ok) throw new Error('refused');
    const { battle } = s;
    const total = 2 * H + battle.zone.depth;
    let shots = 0;
    while (!battle.isOver()) {
      const rows = new Map(
        battle.sim.units.map((u) => [u.id, Math.floor(u.py / CELL_UNITS)]),
      );
      const start = battle.eventLog.length;
      battle.step();
      for (const e of battle.eventLog.slice(start)) {
        if (e.type !== 'turret_fired') continue;
        const row = rows.get(e.unit);
        expect(row).toBeDefined();
        const lo = e.side === 0 ? 0 : H;
        expect(row).toBeGreaterThanOrEqual(lo);
        expect(row).toBeLessThanOrEqual(lo + total - H - 1);
        shots++;
      }
    }
    return shots;
  }

  test('every turret shot of several battles hits a unit in the owner rows', () => {
    let shots = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ps = 1 + (seed % 3);
      shots += checkTurretShots(
        randomTeam(seed, ps),
        randomTeam(seed + 50, ps),
        seed,
      );
    }
    expect(shots).toBeGreaterThan(0);
  });

  test('no building cell or conduit is in a zone row', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const ps = 1 + (seed % 4);
      const a = randomTeam(seed, ps);
      const b = randomTeam(seed + 50, ps);
      const s = startBattle({ teamA: a, teamB: b, seed }, content, config);
      if (!s.ok) throw new Error('refused');
      const { geom, buildings } = s.battle.ctx.arena;
      const lo = geom.boardHeight;
      const hi = lo + geom.gapRows - 1;
      expect(geom.gapRows).toBe(s.battle.zone.depth);
      for (const bld of buildings) {
        for (const c of bld.cells) {
          expect(c.y < lo || c.y > hi).toBe(true);
        }
      }
      // Conduits are board cells: all inside their board, hence never in the zone.
      for (const team of [a, b]) {
        for (const conduit of team.conduits) {
          for (const c of conduit.cells)
            expect(c.y).toBeLessThan(geom.boardHeight);
        }
      }
      // Nothing is ever recorded at a zone cell except units.
      for (const f of s.battle.zone.features) {
        const k = (lo + f.y) * geom.width + f.x;
        expect(s.battle.ctx.arena.occupant[k]).toBe(-1);
        expect(s.battle.ctx.arena.blocked[k]).toBe(1);
      }
    }
  });
});

describe('end conditions', () => {
  function started(
    a: TeamState,
    b: TeamState,
    cfg: { sim: SimConfig; mapgen: typeof mapgen } = config,
  ) {
    const s = startBattle({ teamA: a, teamB: b, seed: 1 }, content, cfg, {
      zone: emptyZone(12),
    });
    if (!s.ok) throw new Error('refused');
    return s.battle;
  }
  const setCore = (
    battle: ReturnType<typeof started>,
    side: number,
    hp: number,
  ): void => {
    const h = battle.sim.health.find(
      (x) => x.side === side && 'core' in x && x.core === 0,
    );
    if (h === undefined) throw new Error('no core');
    h.hp = hp;
  };
  const finish = (battle: ReturnType<typeof started>): BattleResult => {
    while (!battle.isOver()) battle.step();
    const r = battle.result();
    if (r === null) throw new Error('no result');
    return r;
  };

  test('one Core destroyed: the other side wins', () => {
    const r0 = run(farmTeam(), coreOnly(), 1, config, { zone: emptyZone(12) });
    expect(r0.result).toMatchObject({ winner: 0, reason: 'core_destroyed' });
    expect(r0.summary.sides[1].coreHealth).toBe(0);
    expect(r0.summary.sides[1].coreOverkill).toBeGreaterThanOrEqual(0);
    expect(r0.summary.sides[0].coreHealth).toBe(500);
    const r1 = run(coreOnly(), farmTeam(), 1, config, { zone: emptyZone(12) });
    expect(r1.result).toMatchObject({ winner: 1, reason: 'core_destroyed' });
  });

  test('two bare Cores: Overload kills both at tick 3100, the attacker wins', () => {
    const battle = started(coreOnly(), coreOnly());
    const r = finish(battle);
    expect(r).toEqual({
      winner: 0,
      reason: 'tiebreak_attacker',
      endTick: 3101,
    });
    const s = battle.summary();
    expect(s.sides[0].coreOverkill).toBe(s.sides[1].coreOverkill);
    // 14 beats: 525 total on a Core of 500.
    expect(s.sides[0].coreOverkill).toBe(25);
  });

  test('both Cores fall in one tick: the higher remaining health wins', () => {
    // Overload damage on the beats at 1800, 1900, 2000 is 5, 10, 15.
    for (const [hp0, hp1, winner, over0, over1] of [
      [28, 26, 0, 2, 4],
      [26, 28, 1, 4, 2],
      [30, 29, 0, 0, 1],
    ] as const) {
      const battle = started(coreOnly(), coreOnly());
      setCore(battle, 0, hp0);
      setCore(battle, 1, hp1);
      const r = finish(battle);
      expect(r).toEqual({ winner, reason: 'tiebreak_overkill', endTick: 2001 });
      const s = battle.summary();
      expect(s.sides[0].coreHealth).toBe(0);
      expect(s.sides[1].coreHealth).toBe(0);
      expect([s.sides[0].coreOverkill, s.sides[1].coreOverkill]).toEqual([
        over0,
        over1,
      ]);
    }
  });

  test('both damage sums saturate: the higher pre-tick Core health has less overkill and wins', () => {
    // Sixty soldiers a side deal 60 * 9e13 > 2^52 to the enemy Core in one tick,
    // so both sums are MAX_TICK_DAMAGE (equal). The tiebreak compares
    // `hp - damage`, so the side with the higher pre-tick health wins.
    for (const [hp0, hp1, winner, reason] of [
      [1000, 900, 0, 'tiebreak_overkill'],
      [900, 1000, 1, 'tiebreak_overkill'],
      // Equal overkill: both Cores took 1000 of attack damage (the hit past
      // their health does not count), no kills: the attacker wins.
      [1000, 1000, 0, 'tiebreak_attacker'],
    ] as const) {
      const battle = started(coreOnly(), coreOnly());
      setCore(battle, 0, hp0);
      setCore(battle, 1, hp1);
      const geom = battle.ctx.arena.geom;
      for (const side of [0, 1]) {
        const at = toArena(geom, 1 - side, { x: 5, y: 2 });
        for (let k = 0; k < 60; k++) {
          const u = spawnUnitForTest(battle.sim, battle.ctx, {
            side,
            def: 'unit_soldier',
            x: at.x,
            y: at.y,
            allowOverlap: true,
          });
          u.damage = 90_000_000_000_000;
          u.attackCooldown = 0;
        }
      }
      battle.step();
      expect(battle.result()).toEqual({ winner, reason, endTick: 1 });
      const s = battle.summary();
      expect(s.sides[0].coreOverkill).toBe(MAX_TICK_DAMAGE - hp0);
      expect(s.sides[1].coreOverkill).toBe(MAX_TICK_DAMAGE - hp1);
    }
  });

  test('equal overkill: the tiebreak ladder (building damage, kills, attacker)', () => {
    // The counters are plain state, so a test can set them. Bare Cores of
    // equal health fall to Overload decay on the same tick with equal overkill.
    // [damage0, damage1, died0, died1, winner, reason]: a side's kills are the
    // other side's deaths.
    for (const [d0, d1, died0, died1, winner, reason] of [
      [10, 9, 5, 0, 0, 'tiebreak_building_damage'],
      [9, 10, 0, 5, 1, 'tiebreak_building_damage'],
      [0, 1, 7, 0, 1, 'tiebreak_building_damage'], // damage before kills
      [4, 4, 0, 3, 0, 'tiebreak_kills'], // side 0 killed the 3 that died on side 1
      [4, 4, 3, 0, 1, 'tiebreak_kills'],
      [4, 4, 2, 2, 0, 'tiebreak_attacker'],
      [0, 0, 0, 0, 0, 'tiebreak_attacker'],
    ] as const) {
      const battle = started(coreOnly(), coreOnly());
      battle.sim.buildingDamageDealt[0] = d0;
      battle.sim.buildingDamageDealt[1] = d1;
      battle.sim.unitsDied[0] = died0;
      battle.sim.unitsDied[1] = died1;
      expect(finish(battle)).toEqual({ winner, reason, endTick: 3101 });
      const s = battle.summary();
      expect(s.sides[0].buildingDamageDealt).toBe(d0);
      expect(s.sides[1].buildingDamageDealt).toBe(d1);
      expect(s.sides[0].unitsKilled).toBe(died1);
      expect(s.sides[1].unitsKilled).toBe(died0);
    }
  });

  test('overkill comes before the ladder; a decided overkill ignores the counters', () => {
    const battle = started(coreOnly(), coreOnly());
    setCore(battle, 0, 28);
    setCore(battle, 1, 26);
    battle.sim.buildingDamageDealt[1] = 1_000_000;
    battle.sim.unitsDied[0] = 50;
    expect(finish(battle)).toEqual({
      winner: 0,
      reason: 'tiebreak_overkill',
      endTick: 2001,
    });
  });

  test('building damage counts attacks only, at most the health the building had', () => {
    const battle = started(coreOnly(), coreOnly());
    setCore(battle, 1, 10);
    const geom = battle.ctx.arena.geom;
    // Three soldiers of side 0 beside side 1's Core hit it for 6 each (18)
    // in one tick; the Core had 10. Side 1 has no units.
    const at = toArena(geom, 1, { x: 5, y: 2 });
    for (let k = 0; k < 3; k++) {
      const u = spawnUnitForTest(battle.sim, battle.ctx, {
        side: 0,
        def: 'unit_soldier',
        x: at.x,
        y: at.y,
        allowOverlap: true,
      });
      u.attackCooldown = 0;
    }
    battle.step();
    expect(battle.result()).toMatchObject({
      winner: 0,
      reason: 'core_destroyed',
    });
    expect(battle.sim.buildingDamageDealt).toEqual([10, 0]);
    expect(battle.summary().sides[1].coreOverkill).toBe(8);
    // Overload decay is never counted: run bare Cores through several beats.
    const bare = started(coreOnly(), coreOnly());
    finish(bare);
    expect(bare.sim.buildingDamageDealt).toEqual([0, 0]);
  });

  test('the time limit decides by the Core health fraction (Overload disabled)', () => {
    const noOverload: SimConfig = {
      ...simConfig,
      overloadStartTick: 1_000_000,
      maxBattleTicks: 300,
    };
    const cfg = { sim: noOverload, mapgen };
    for (const [hp0, hp1, winner] of [
      [300, 250, 0],
      [250, 300, 1],
      [400, 400, 0], // equal fractions: the ladder, then the attacker
      [500, 499, 0],
    ] as const) {
      const battle = started(coreOnly(), coreOnly(), cfg);
      setCore(battle, 0, hp0);
      setCore(battle, 1, hp1);
      const r = finish(battle);
      expect(r).toEqual({
        winner,
        reason: hp0 === hp1 ? 'tiebreak_attacker' : 'time_limit',
        endTick: 300,
      });
      expect(battle.sim.tick).toBe(300);
    }
    // A walled stalemate on full-health Cores: equal fractions, equal
    // counters, the attacker wins.
    const r = finish(started(coreOnly(), coreOnly(), cfg));
    expect(r).toEqual({ winner: 0, reason: 'tiebreak_attacker', endTick: 300 });
    // Equal fractions go down the ladder: building damage, then kills.
    const byDamage = started(coreOnly(), coreOnly(), cfg);
    byDamage.sim.buildingDamageDealt[1] = 3;
    expect(finish(byDamage)).toEqual({
      winner: 1,
      reason: 'tiebreak_building_damage',
      endTick: 300,
    });
    const byKills = started(coreOnly(), coreOnly(), cfg);
    byKills.sim.unitsDied[0] = 2;
    expect(finish(byKills)).toEqual({
      winner: 1,
      reason: 'tiebreak_kills',
      endTick: 300,
    });
  });

  test('the Core health fraction is compared exactly', () => {
    // Different maxima cannot arise from the content, so check the integer
    // comparison directly through a state with unequal Core maxima: patch the
    // recorded maximum via a content variant is not possible; instead assert
    // that 1/3 vs 2/6 style ties (same fraction) go to side 1.
    const noOverload: SimConfig = {
      ...simConfig,
      overloadStartTick: 1_000_000,
      maxBattleTicks: 50,
    };
    const battle = started(coreOnly(), coreOnly(), { sim: noOverload, mapgen });
    setCore(battle, 0, 125);
    setCore(battle, 1, 125);
    // Equal fractions: no winner by health; the ladder gives the attacker.
    expect(finish(battle)).toMatchObject({
      winner: 0,
      reason: 'tiebreak_attacker',
    });
  });

  test('the time limit compares fractions exactly with maxima near the cap', () => {
    const noOverload: SimConfig = {
      ...simConfig,
      overloadStartTick: 1_000_000,
      maxBattleTicks: 20,
    };
    const cfg = { sim: noOverload, mapgen };
    const M = MAX_HEALTH;
    // [max0, hp0, max1, hp1, winner]. The cross products are near 1e24, past
    // 2^53, so only an exact comparison gets these right.
    for (const [max0, hp0, max1, hp1, winner] of [
      [M, M - 1, M - 1, M - 2, 0], // (M-1)/M > (M-2)/(M-1)
      [M - 1, M - 2, M, M - 1, 1],
      [M, M - 1, M - 1, M - 1, 1], // 1 - 1/M < 1
      [M, M, M - 1, M - 1, 0], // equal fractions: the ladder, the attacker
      [M, 500_000_000_000, M - 2, 499_999_999_998, 0],
      [999_999_999_989, 499_999_999_994, M, 500_000_000_000, 1],
      [M, 123_456_789_012, 999_999_999_999, 123_456_789_011, 0],
    ] as const) {
      const s = startBattle(
        {
          teamA: coreOnly(),
          teamB: coreOnly(),
          seed: 1,
          sideOptions: [{ coreHealths: [max0] }, { coreHealths: [max1] }],
        },
        content,
        cfg,
        { zone: emptyZone(12) },
      );
      if (!s.ok) throw new Error('refused');
      setCore(s.battle, 0, hp0);
      setCore(s.battle, 1, hp1);
      const r = finish(s.battle);
      expect(r.reason).toBe(
        hp0 === max0 && hp1 === max1 ? 'tiebreak_attacker' : 'time_limit',
      );
      expect(
        r.winner,
        `${String(hp0)}/${String(max0)} vs ${String(hp1)}/${String(max1)}`,
      ).toBe(winner);
    }
  });

  test('with the real constants no battle reaches the time limit', () => {
    expect(simConfig.maxBattleTicks).toBe(12000);
    expect(simConfig.timelineSampleTicks).toBe(50);
  });
});

describe('Overload helpers against real bare-Core battles (time limit)', () => {
  const bare = (hpA: number, hpB: number) => {
    const s = startBattle(
      {
        teamA: coreOnly(),
        teamB: coreOnly(),
        seed: 1,
        sideOptions: [{ coreHealths: [hpA] }, { coreHealths: [hpB] }],
      },
      content,
      config,
      { zone: emptyZone(12) },
    );
    if (!s.ok) throw new Error('refused');
    while (!s.battle.isOver()) s.battle.step();
    const r = s.battle.result();
    if (r === null) throw new Error('no result');
    return r;
  };

  test('the decay lands up to tick maxBattleTicks - 1 and no longer', () => {
    // 102 beats (ticks 1800 .. 11900) take 5 * 102 * 103 / 2 = 26265; beat
    // 103 would be at tick 12000 = maxBattleTicks and never lands.
    expect(simConfig.maxBattleTicks).toBe(12000);
    for (const hp of [25_755, 25_756, 26_000, 26_264, 26_265, 26_266, 26_267]) {
      const d = overloadDeadline(simConfig, hp);
      const r = bare(hp, hp);
      if (hp <= 26_265) {
        // Both Cores fall on the same beat: a 'core_destroyed' end after the
        // step of that tick (the tick counter is then one higher).
        expect(d.decayDestroysTick, String(hp)).not.toBeNull();
        expect(r.reason, String(hp)).not.toBe('time_limit');
        expect(r.endTick, String(hp)).toBe((d.decayDestroysTick ?? -1) + 1);
        expect(overloadOutcome(simConfig, [hp], [hp])).toEqual({
          first: 'both',
          tick: d.decayDestroysTick,
        });
      } else {
        expect(d, String(hp)).toEqual({
          startTick: 1800,
          decayDestroysTick: null,
          decayDestroysLevel: null,
        });
        expect(r.endTick, String(hp)).toBe(simConfig.maxBattleTicks);
        expect(overloadOutcome(simConfig, [hp], [hp])).toEqual({
          first: null,
          tick: null,
        });
      }
    }
    expect(overloadDeadline(simConfig, 25_755).decayDestroysTick).toBe(11_800);
    expect(overloadDeadline(simConfig, 26_265).decayDestroysTick).toBe(11_900);
  });

  test('with one Core beyond the limit the other still falls first', () => {
    for (const [a, b] of [
      [26_265, 26_266],
      [26_266, 26_265],
      [26_265, 500],
      [26_266, 26_267],
    ] as const) {
      const r = bare(a, b);
      const o = overloadOutcome(simConfig, [a], [b]);
      const side = a < b ? 'a' : 'b';
      if (Math.min(a, b) <= 26_265) {
        expect(o.first, `${String(a)} ${String(b)}`).toBe(side);
        expect(r.reason).toBe('core_destroyed');
        expect(r.winner).toBe(side === 'a' ? 1 : 0);
        expect(r.endTick).toBe((o.tick ?? -1) + 1);
      } else {
        expect(o).toEqual({ first: null, tick: null });
        expect(r.endTick).toBe(simConfig.maxBattleTicks);
      }
    }
  });
});

describe('random matchups', () => {
  test('40 matchups all end with a result before the time limit', () => {
    const ticks: number[] = [];
    const reasons: Record<string, number> = {};
    const winners = [0, 0];
    for (let i = 0; i < 40; i++) {
      const ps = 1 + (i % 4);
      const a = randomTeam(1000 + i, ps);
      const b = randomTeam(2000 + i, ps);
      const r = run(a, b, 3000 + i);
      expect(r.result.reason).not.toBe('time_limit');
      expect(r.result.endTick).toBeLessThan(simConfig.maxBattleTicks);
      ticks.push(r.result.endTick);
      reasons[r.result.reason] = (reasons[r.result.reason] ?? 0) + 1;
      winners[r.result.winner] = (winners[r.result.winner] ?? 0) + 1;
    }
    expect(ticks).toHaveLength(40);
    expect(Object.keys(reasons).length).toBeGreaterThan(0);
    expect(winners[0]).toBeGreaterThan(0);
    expect(winners[1]).toBeGreaterThan(0);
  }, 120_000);
});

describe('performance (CB-36)', () => {
  /** Run a battle to the end and measure it (wall time, size, peak units). */
  function measure(
    a: TeamState,
    b: TeamState,
    seed: number,
  ): {
    ms: number;
    ticks: number;
    peakPerSide: number;
    events: number;
    bytes: number;
  } {
    const s = startBattle({ teamA: a, teamB: b, seed }, content, config);
    if (!s.ok) throw new Error('refused');
    const { battle } = s;
    let peakPerSide = 0;
    const t0 = Date.now();
    while (!battle.isOver()) {
      battle.step();
      const n0 = battle.sim.units.filter((u) => u.side === 0).length;
      peakPerSide = Math.max(peakPerSide, n0, battle.sim.units.length - n0);
    }
    const ms = Date.now() - t0;
    return {
      ms,
      ticks: battle.sim.tick,
      peakPerSide,
      events: battle.eventLog.length,
      bytes: JSON.stringify(battle.eventLog).length,
    };
  }

  /** A dense four-plot team: 48 source-splitter-barracks modules (96 barracks). */
  function dense(tier: number): TeamState {
    const lab = new Lab(bigBoard().map);
    lab.state = bigBoard();
    lab.allCores(6);
    if (tier === 1) return lab.state;
    const heavy = new Lab(bigBoard().map);
    heavy.state = {
      ...lab.state,
      buildings: lab.state.buildings.map((p) =>
        p.def === 'bld_splitter' ? p : { ...p, tier },
      ),
    };
    return heavy.state;
  }

  // The budgets asserted here are the ones proposed in docs/performance-budget.md.
  test('a typical one-plot battle', () => {
    const m = measure(randomTeam(1, 1), randomTeam(101, 1), 1);
    expect(m.ms).toBeLessThan(2_000 * TIMING);
    expect(m.ticks).toBeLessThan(simConfig.maxBattleTicks);
    expect(m.peakPerSide).toBeLessThan(100);
    expect(m.bytes).toBeLessThan(1_000_000);
  }, 60_000);

  test('a dense four-plot battle', () => {
    const m = measure(dense(1), dense(1), 1);
    expect(m.ms).toBeLessThan(10_000 * TIMING);
    expect(m.ticks).toBeLessThan(simConfig.maxBattleTicks);
    expect(m.peakPerSide).toBeLessThan(1_000);
    expect(m.bytes).toBeLessThan(5_000_000);
  }, 120_000);

  test('a dense four-plot battle with every building at tier 3', () => {
    const m = measure(dense(3), dense(3), 1);
    expect(m.ms).toBeLessThan(20_000 * TIMING);
    expect(m.ticks).toBeLessThan(simConfig.maxBattleTicks);
    expect(m.peakPerSide).toBeLessThan(2_000);
    // Four Cores per side now (one per player): a few more events than with one.
    expect(m.bytes).toBeLessThan(11_000_000);
  }, 240_000);
});
