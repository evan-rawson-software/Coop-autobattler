/**
 * Ranged units and flying units (issue #59, part 2; CB-16b, CB-16c): a ranged
 * unit fires from its range and holds its place, only ranged attackers and
 * turrets can hit a flyer, flyers cross walls and lakes and do not collide
 * with ground units, and both kinds keep the mirror symmetry and the
 * restore-at-any-tick property.
 */
import { describe, expect, test } from 'vitest';
import type { ArenaContent } from './arena.js';
import {
  createArenaContext,
  isCoreHealth,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
  type SideOptions,
} from './arena-sim.js';
import { hashJson } from './hash.js';
import { CELL_UNITS } from './limits.js';
import type { GameMap } from './map.js';
import { addToStash, placeFromStash, type TeamState } from './team-state.js';
import {
  Lab,
  content,
  groundViolations,
  got,
  overlapStats,
  simConfig,
} from './test-support.js';
import { sealedProducers } from './sealed-producers.js';
import { loadUnitsOrThrow } from './units.js';

const GAP = 4;
/** Arena rows: 16 + 4 + 16; columns: 12 for one plot. */
const H = 36;
const CU = CELL_UNITS;
const mid = (c: number): number => c * CU + CU / 2;

/** A one-plot board with lakes on the given cells. */
function map1(lakes: [number, number][] = [], width = 12, plots = 1): GameMap {
  return {
    width,
    height: 16,
    partySize: plots,
    plotWidth: width / plots,
    features: lakes
      .map(([x, y]) => ({ x, y, feature: 'ter_lake' }))
      .sort((a, b) => a.y - b.y || a.x - b.x),
    nodes: [],
  };
}

/** A lake row across the whole board at board row `y`, leaving `open` columns. */
function lakeRow(
  y: number,
  width = 12,
  open: number[] = [],
): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0; x < width; x++) if (!open.includes(x)) out.push([x, y]);
  return out;
}

function coreTeam(map: GameMap, cores: number[] = [5]): TeamState {
  const lab = new Lab(map);
  cores.forEach((x, p) => {
    lab.core(x, 0, p);
  });
  return lab.state;
}

function start(
  a: TeamState,
  b: TeamState,
  options: { sideOptions?: [SideOptions | null, SideOptions | null] } = {},
) {
  return startArenaBattle(a, b, GAP, content, simConfig, options);
}

type Attack = Extract<ArenaEvent, { type: 'unit_attacked' }>;
const attacks = (events: ArenaEvent[]): Attack[] =>
  events.filter((e): e is Attack => e.type === 'unit_attacked');

function run(sim: ArenaSim, ctx: ArenaContext, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepArena(sim, ctx);
}

function unitById(sim: ArenaSim, id: number) {
  return sim.units.find((u) => u.id === id);
}

describe('a ranged unit fires from its range and holds its place (CB-16b)', () => {
  test('an archer shoots the Core from three cells and stays there; a soldier walks up to it', () => {
    const fire = (def: string) => {
      const { sim, ctx, events } = start(coreTeam(map1()), coreTeam(map1()));
      const u = spawnUnitForTest(sim, ctx, { side: 0, def, x: 5, y: 25 });
      let first: number | undefined;
      for (let t = 0; t < 400 && first === undefined; t++) {
        stepArena(sim, ctx);
        if (attacks(events).some((a) => a.target.kind === 'core')) first = t;
      }
      expect(first).toBeDefined();
      // The gap from the unit's centre to the Core's lower edge (row 34).
      const gap = 34 * CU - got(unitById(sim, u.id)).py;
      const where = unitById(sim, u.id);
      run(sim, ctx, 40);
      const after = unitById(sim, u.id);
      return { gap, held: after?.py === where?.py && after?.px === where?.px };
    };
    const archer = fire('unit_archer');
    const soldier = fire('unit_soldier');
    expect(archer.gap).toBeGreaterThan(2 * CU); // fired from at least two cells away
    expect(archer.gap).toBeLessThanOrEqual(720 + 66);
    expect(archer.held).toBe(true);
    expect(soldier.gap).toBeLessThanOrEqual(CU / 2); // melee: right up against it
  });

  test('units in reach come before a Core; the nearest first, ties by the lowest id', () => {
    const shoot = (swap: boolean) => {
      const { sim, ctx, events } = start(coreTeam(map1()), coreTeam(map1()));
      spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_archer',
        px: 1500,
        py: 7000,
      });
      const spots: [number, number][] = [
        [1200, 7300],
        [1800, 7300],
      ];
      if (swap) spots.reverse();
      const ids = spots.map(
        ([px, py]) =>
          spawnUnitForTest(sim, ctx, {
            side: 1,
            def: 'unit_soldier',
            px,
            py,
          }).id,
      );
      // A farther enemy and a Core in reach as well.
      spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_soldier',
        px: 1500,
        py: 7500,
      });
      stepArena(sim, ctx);
      const hit = attacks(events).find((a) => a.unit === 1);
      return { hit, ids };
    };
    for (const swap of [false, true]) {
      const { hit, ids } = shoot(swap);
      expect(hit?.target).toEqual({ kind: 'unit', unit: Math.min(...ids) });
    }
  });

  test('several Cores in reach: the target Core, else any Core in reach', () => {
    // Side 1's Cores 0 and 1 stand side by side: arena columns 12, 13 and 10, 11.
    const two = (): TeamState => coreTeam(map1([], 24, 2), [10, 12]);
    const hits = (px: number, owner: number, target: number) => {
      const { sim, ctx, events } = start(two(), two());
      spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_archer',
        px,
        py: mid(31),
        owner,
        target,
      });
      stepArena(sim, ctx);
      const t = attacks(events)[0]?.target;
      return t?.kind === 'core' ? t.core : undefined;
    };
    expect(hits(12 * CU, 0, 0)).toBe(0);
    expect(hits(12 * CU, 0, 1)).toBe(1);
    // Only Core 0 is in reach (the archer stands right of it): it is shot
    // although Core 1 is the target.
    expect(hits(14 * CU + 500, 0, 1)).toBe(0);
  });

  test('archers behind a soldier in a one-cell corridor deadlock nothing', () => {
    const lakes = lakeRow(6, 12, [5]).concat(lakeRow(7, 12, [5]));
    const { sim, ctx, events } = start(
      coreTeam(map1(lakes)),
      coreTeam(map1(lakes)),
    );
    // Side 1's corridor is arena rows 28 and 29 (board rows 7 and 6).
    const mine = [29, 28, 27, 26].map((y, k) =>
      spawnUnitForTest(sim, ctx, {
        side: 0,
        def: k === 1 || k === 2 ? 'unit_archer' : 'unit_soldier',
        x: 6,
        y,
      }),
    );
    for (const y of [32, 31]) {
      spawnUnitForTest(sim, ctx, { side: 1, def: 'unit_soldier', x: 5, y });
    }
    const rear = got(mine[3]);
    let reached: number | undefined;
    for (let t = 0; t < 900 && reached === undefined; t++) {
      stepArena(sim, ctx);
      if (
        attacks(events).some(
          (a) => a.unit === rear.id && a.target.kind === 'core',
        )
      ) {
        reached = t;
      }
    }
    expect(reached).toBeDefined();
    expect(
      attacks(events).some((a) =>
        mine.slice(1, 3).some((m) => m.id === a.unit),
      ),
    ).toBe(true);
    expect(sim.units.filter((u) => u.side === 1)).toHaveLength(0);
  });
});

describe('flyers (CB-16c)', () => {
  const wallMap = (): GameMap => map1(lakeRow(8));

  test('a drone crosses a lake line that stops a soldier', () => {
    const go = (def: string) => {
      const { sim, ctx, events } = start(
        coreTeam(wallMap()),
        coreTeam(wallMap()),
      );
      const u = spawnUnitForTest(sim, ctx, { side: 0, def, x: 5, y: 22 });
      let over = false;
      for (let t = 0; t < 600; t++) {
        stepArena(sim, ctx);
        // Board row 8 of side 1 is arena row 27.
        if (Math.floor(got(unitById(sim, u.id)).py / CU) === 27) over = true;
      }
      expect(groundViolations(sim, ctx)).toEqual([]);
      return {
        over,
        core: attacks(events).some(
          (a) => a.unit === u.id && a.target.kind === 'core',
        ),
        py: got(unitById(sim, u.id)).py,
      };
    };
    const drone = go('unit_drone');
    expect(drone.over).toBe(true);
    expect(drone.core).toBe(true);
    const soldier = go('unit_soldier');
    expect(soldier.over).toBe(false);
    expect(soldier.core).toBe(false);
    expect(soldier.py).toBeLessThan(27 * CU);
  });

  test('flyers and ground units do not push each other; flyers keep their own distance', () => {
    const alone = start(coreTeam(map1()), coreTeam(map1()));
    spawnUnitForTest(alone.sim, alone.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 10,
    });
    run(alone.sim, alone.ctx, 30);
    const { sim, ctx } = start(coreTeam(map1()), coreTeam(map1()));
    const s = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 10,
    });
    // On the same spot, plus two drones that start on top of each other.
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_drone', x: 5, y: 10 });
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_drone',
      x: 5,
      y: 10,
      allowOverlap: true,
    });
    run(sim, ctx, 30);
    expect(got(unitById(sim, s.id)).px).toBe(got(alone.sim.units[0]).px);
    expect(got(unitById(sim, s.id)).py).toBe(got(alone.sim.units[0]).py);
    // The ground soldier overlaps no ground unit; the drones part (flyers
    // collide with flyers only, by their small circles).
    expect(overlapStats(sim, ctx).pairs).toBe(0);
    const [d1, d2] = sim.units.filter((u) => u.def === 'unit_drone');
    expect(
      Math.hypot(got(d1).px - got(d2).px, got(d1).py - got(d2).py),
    ).toBeGreaterThan(0);
  });

  test('melee units cannot hit a flyer and carry on; a drone hits ground and air', () => {
    const { sim, ctx, events } = start(coreTeam(map1()), coreTeam(map1()));
    const soldier = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: mid(5),
      py: mid(24),
    });
    const drone = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_drone',
      px: mid(5) + 40,
      py: mid(24) + 200,
    });
    const start0 = soldier.py;
    run(sim, ctx, 20);
    const hits = attacks(events);
    expect(hits.some((a) => a.unit === soldier.id)).toBe(false);
    // The soldier did not wait for the drone: it moved on towards the Core.
    expect(got(unitById(sim, soldier.id)).py).toBeGreaterThan(start0 + 400);
    // The drone shoots the soldier (a ground target).
    expect(
      hits.some(
        (a) =>
          a.unit === drone.id &&
          a.target.kind === 'unit' &&
          a.target.unit === soldier.id,
      ),
    ).toBe(true);
  });

  test('archers, drones and turrets hit a flyer; the drone hits another drone', () => {
    const hit = (shooter: string): boolean => {
      const { sim, ctx, events } = start(coreTeam(map1()), coreTeam(map1()));
      const s = spawnUnitForTest(sim, ctx, {
        side: 0,
        def: shooter,
        px: mid(5),
        py: mid(24),
      });
      const d = spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_drone',
        px: mid(5),
        py: mid(24) + 400,
      });
      run(sim, ctx, 2);
      return attacks(events).some(
        (a) =>
          a.unit === s.id && a.target.kind === 'unit' && a.target.unit === d.id,
      );
    };
    expect(hit('unit_archer')).toBe(true);
    expect(hit('unit_drone')).toBe(true);
    expect(hit('unit_soldier')).toBe(false);
    expect(hit('unit_raider')).toBe(false);

    // A powered turret on the front row fires at a drone in the neutral zone.
    const lab = new Lab(map1());
    lab.core(5, 0);
    const added = addToStash(lab.state, content, {
      def: 'bld_turret',
      tier: 3,
      owner: 0,
    });
    if (!added.ok) throw new Error(added.reason);
    const placed = placeFromStash(added.state, content, {
      actor: 0,
      id: added.id,
      x: 5,
      y: 15,
      rotation: 0,
    });
    if (!placed.ok) throw new Error(placed.reason);
    const { sim, ctx, events } = start(placed.state, coreTeam(map1()), {
      sideOptions: [{ freePower: true }, null],
    });
    const drone = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_drone',
      px: mid(5),
      py: mid(17),
    });
    run(sim, ctx, 12);
    expect(
      events.some((e) => e.type === 'turret_fired' && e.unit === drone.id),
    ).toBe(true);
  });

  test('flyers choose a Core like ground units: the opposite one, then the next', () => {
    const two = (): TeamState => coreTeam(map1([], 24, 2), [5, 17]);
    const { sim, ctx, events } = start(two(), two(), {
      sideOptions: [null, { coreHealths: [500, 12] }],
    });
    // Plot 0 faces side 1's Core 1.
    const drone = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_drone',
      x: 5,
      y: 20,
    });
    expect([drone.owner, drone.target]).toEqual([0, 1]);
    let fell = -1;
    for (let t = 0; t < 900 && fell < 0; t++) {
      stepArena(sim, ctx);
      if (events.some((e) => e.type === 'core_destroyed')) fell = t;
    }
    expect(fell).toBeGreaterThan(0);
    const first = attacks(events).find((a) => a.target.kind === 'core');
    expect(first?.target).toEqual({ kind: 'core', side: 1, core: 1 });
    expect(unitById(sim, drone.id)?.target).toBe(0);
    run(sim, ctx, 600);
    const later = attacks(events).filter(
      (a) =>
        a.target.kind === 'core' && a.target.core === 0 && a.unit === drone.id,
    );
    expect(later.length).toBeGreaterThan(0);
  });
});

describe('symmetry and restore with both new kinds', () => {
  const lakes = lakeRow(5, 12, [3, 8]).concat(lakeRow(9, 12, [5]));
  const mk = (): TeamState => coreTeam(map1(lakes));
  const W = 12;
  const roster: [string, number, number][] = [
    ['unit_soldier', 3, 20],
    ['unit_soldier', 8, 21],
    ['unit_archer', 4, 19],
    ['unit_archer', 7, 18],
    ['unit_drone', 2, 17],
    ['unit_drone', 9, 16],
    ['unit_raider', 5, 22],
  ];

  function battle() {
    const b = start(mk(), mk());
    for (const [def, x, y] of roster) {
      spawnUnitForTest(b.sim, b.ctx, { side: 0, def, x, y });
    }
    for (const [def, x, y] of roster) {
      // The same cell, seen from side 1's half-turned frame.
      spawnUnitForTest(b.sim, b.ctx, {
        side: 1,
        def,
        x: W - 1 - x,
        y: H - 1 - y,
      });
    }
    return b;
  }

  function key(sim: ArenaSim, side: number): string[] {
    return sim.units
      .filter((u) => u.side === side)
      .map((u) => {
        const x = side === 0 ? u.px : W * CU - u.px;
        const y = side === 0 ? u.py : H * CU - u.py;
        return `${u.def} ${String(x)},${String(y)} hp${String(u.hp)}`;
      })
      .sort();
  }

  test('the mirrored battle stays exactly symmetric, tick by tick', () => {
    const { sim, ctx, events } = battle();
    for (let t = 0; t < 700; t++) {
      stepArena(sim, ctx);
      expect(key(sim, 1)).toEqual(key(sim, 0));
      expect(groundViolations(sim, ctx)).toEqual([]);
    }
    expect(attacks(events).length).toBeGreaterThan(20);
    // Ids follow the roster order, side 0 then side 1: archers 3, 4, 10, 11
    // and drones 5, 6, 12, 13 all took part.
    for (const group of [
      [3, 4, 10, 11],
      [5, 6, 12, 13],
    ]) {
      expect(attacks(events).some((e) => group.includes(e.unit))).toBe(true);
    }
  });

  test('saving and restoring at any tick continues identically', () => {
    const a = battle();
    run(a.sim, a.ctx, 500);
    const want = hashJson(a.sim);
    const wantEvents = a.events.map((e) => hashJson(e));
    for (const at of [0, 1, 7, 40, 111, 250, 499]) {
      const b = battle();
      run(b.sim, b.ctx, at);
      const seen = b.events.length;
      const restored = JSON.parse(JSON.stringify(b.sim)) as ArenaSim;
      const events: ArenaEvent[] = [];
      const ctx = createArenaContext(restored, content, simConfig, { events });
      run(restored, ctx, 500 - at);
      expect(hashJson(restored)).toBe(want);
      expect(events.map((e) => hashJson(e))).toEqual(wantEvents.slice(seen));
    }
  });
});

describe('Hangar spawning, flyer targeting by distance, test-only units (issue #59 follow-ups)', () => {
  /** A Hangar (or Barracks) at (2,5) walled in; fed by an Extractor at (2,2). */
  function walledProducer(producer: string, resource: string): TeamState {
    const lab = new Lab({
      width: 24,
      height: 16,
      partySize: 1,
      plotWidth: 24,
      features: [],
      nodes: [{ x: 2, y: 2, resource }],
    });
    lab.core(8, 0);
    const src = lab.put('bld_extractor', 2, 2);
    const prod = lab.put(producer, 2, 5);
    lab.link(src, 'north', prod, 'south', [
      [2, 3],
      [2, 4],
    ]);
    for (const [x, y] of [
      [1, 5],
      [1, 6],
      [4, 5],
      [4, 6],
      [2, 7],
      [3, 7],
      [3, 4],
    ] as const) {
      lab.put('bld_wall', x, y);
    }
    return lab.state;
  }

  /** A producer at (3,5) with a ring of walls and nothing else. */
  function ringed(producer: string): TeamState {
    const lab = new Lab(map1([], 24));
    lab.core(8, 0);
    lab.put(producer, 3, 5);
    for (let x = 2; x <= 5; x++) {
      lab.put('bld_wall', x, 4);
      lab.put('bld_wall', x, 7);
    }
    lab.put('bld_wall', 2, 5);
    lab.put('bld_wall', 2, 6);
    lab.put('bld_wall', 5, 5);
    lab.put('bld_wall', 5, 6);
    return lab.state;
  }

  test('a walled-in Hangar is never sealed, a walled-in Barracks is', () => {
    expect(sealedProducers(ringed('bld_hangar'), content)).toEqual([]);
    expect(sealedProducers(ringed('bld_barracks'), content)).toHaveLength(1);
    // Without unit content the old ground rule applies.
    expect(
      sealedProducers(ringed('bld_hangar'), {
        resources: content.resources,
        terrain: content.terrain,
        buildings: content.buildings,
      }),
    ).toHaveLength(1);
  });

  test('a walled-in Hangar spawns drones on the cells next to it; they fly out', () => {
    const { sim, ctx, events } = start(
      walledProducer('bld_hangar', 'res_b'),
      coreTeam(map1([], 24)),
    );
    run(sim, ctx, 1500);
    const spawned = events.filter((e) => e.type === 'unit_spawned');
    expect(spawned.length).toBeGreaterThan(2);
    // Every drone starts on a cell next to the Hangar (columns 1 to 4, rows 4 to 7).
    for (const e of spawned) {
      const cx = Math.floor(e.px / CU);
      const cy = Math.floor(e.py / CU);
      expect(cx >= 1 && cx <= 4 && cy >= 4 && cy <= 7).toBe(true);
    }
    expect(attacks(events).some((a) => a.target.kind === 'core')).toBe(true);
    // The first one stands on a wall cell, closed to ground units.
    const first = got(spawned[0]);
    expect([first.px, first.py]).toEqual([mid(3), mid(7)]);
  });

  /** A Range and a walled-in Hangar, both fed; the same board on both sides. */
  function producing(): TeamState {
    const lab = new Lab({
      width: 24,
      height: 16,
      partySize: 1,
      plotWidth: 24,
      features: [],
      nodes: [
        { x: 2, y: 2, resource: 'res_a' },
        { x: 14, y: 2, resource: 'res_b' },
      ],
    });
    lab.core(8, 0);
    const a = lab.put('bld_extractor', 2, 2);
    const range = lab.put('bld_range', 2, 5);
    lab.link(a, 'north', range, 'south', [
      [2, 3],
      [2, 4],
    ]);
    const b = lab.put('bld_extractor', 14, 2);
    const hangar = lab.put('bld_hangar', 14, 5);
    lab.link(b, 'north', hangar, 'south', [
      [14, 3],
      [14, 4],
    ]);
    for (const [x, y] of [
      [13, 5],
      [13, 6],
      [16, 5],
      [16, 6],
      [14, 7],
      [15, 7],
      [15, 4],
    ] as const) {
      lab.put('bld_wall', x, y);
    }
    return lab.state;
  }

  test('producers of archers and drones keep the mirror symmetry and restore at any tick', () => {
    const W = 24;
    const battle = () => start(producing(), producing());
    const key = (sim: ArenaSim, side: number): string[] =>
      sim.units
        .filter((u) => u.side === side)
        .map((u) => {
          const x = side === 0 ? u.px : W * CU - u.px;
          const y = side === 0 ? u.py : H * CU - u.py;
          return `${u.def} ${String(x)},${String(y)} hp${String(u.hp)}`;
        })
        .sort();
    const a = battle();
    for (let t = 0; t < 1200; t++) {
      stepArena(a.sim, a.ctx);
      expect(key(a.sim, 1)).toEqual(key(a.sim, 0));
    }
    const defs = new Set(a.sim.units.map((u) => u.def));
    expect(defs.has('unit_archer') && defs.has('unit_drone')).toBe(true);
    const want = hashJson(a.sim);
    const wantEvents = a.events.map((e) => hashJson(e));
    for (const at of [1, 150, 331, 777]) {
      const b = battle();
      run(b.sim, b.ctx, at);
      const seen = b.events.length;
      const restored = JSON.parse(JSON.stringify(b.sim)) as ArenaSim;
      const events: ArenaEvent[] = [];
      const ctx = createArenaContext(restored, content, simConfig, { events });
      run(restored, ctx, 1200 - at);
      expect(hashJson(restored)).toBe(want);
      expect(events.map((e) => hashJson(e))).toEqual(wantEvents.slice(seen));
    }
  });

  test('a drone crosses a wall line and a row of buildings without attacking them', () => {
    const board = (): TeamState => {
      const lab = new Lab(map1());
      lab.core(5, 0);
      for (let x = 0; x < 12; x++) lab.put('bld_wall', x, 8);
      for (let x = 0; x < 12; x += 2) lab.put('bld_barracks', x, 5);
      return lab.state;
    };
    const { sim, ctx, events } = start(coreTeam(map1()), board());
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_drone',
      x: 8,
      y: 22,
    });
    run(sim, ctx, 400);
    const mine = attacks(events).filter((a) => a.unit === u.id);
    expect(mine.length).toBeGreaterThan(5);
    expect(mine.every((a) => a.target.kind === 'core')).toBe(true);
    expect(groundViolations(sim, ctx)).toEqual([]);
  });

  test('when its Core falls a flyer picks the next one by straight-line distance, not by the ground fields', () => {
    // Three plots; a lake line across side 1's whole board: every Core ranks
    // alike on the ground. A flyer of plot 1 (opposite Core 1) stands at the
    // right of its plot, nearer to Core 0 than to Core 2; the ground tie rule
    // takes the higher index.
    const lakes = lakeRow(8, 36);
    const mk = (): TeamState => coreTeam(map1(lakes, 36, 3), [5, 17, 29]);
    const pick = (def: string): number => {
      const { sim, ctx } = start(mk(), mk());
      const u = spawnUnitForTest(sim, ctx, {
        side: 0,
        def,
        px: mid(23),
        py: mid(22),
      });
      expect([u.owner, u.target]).toEqual([1, 1]);
      got(
        sim.health.find((x) => isCoreHealth(x) && x.side === 1 && x.core === 1),
      ).hp = 0;
      stepArena(sim, ctx);
      return got(unitById(sim, u.id)).target;
    };
    expect(pick('unit_drone')).toBe(0);
    expect(pick('unit_soldier')).toBe(2);
  });

  test('a flyer notices an enemy behind a lake wall that a ground unit with the same reach does not', () => {
    // Test-only units whose reach (60) is far below the aggro range (3 cells),
    // so only the aggro branch can move them. The enemy stands off the path
    // to the Core, behind a lake line.
    const withScouts: ArenaContent = {
      ...content,
      units: loadUnitsOrThrow({
        units: [
          ...content.units.list(),
          ...[true, false].map((flying) => ({
            id: flying ? 'unit_airscout' : 'unit_landscout',
            health: 30,
            damage: 1,
            attackCooldownTicks: 10,
            moveCooldownTicks: 4,
            radius: 66,
            collisionRadius: 40,
            reach: 60,
            flying,
            attackType: flying ? 'ranged' : 'melee',
          })),
        ],
      }),
    };
    // Side 1's board column 9 is arena column 2: a lake wall between the
    // scout (column 3) and the enemy (column 1).
    const lakeColumn: [number, number][] = Array.from(
      { length: 16 },
      (_, y): [number, number] => [9, y],
    );
    const go = (def: string): number => {
      const b = startArenaBattle(
        coreTeam(map1()),
        coreTeam(map1(lakeColumn)),
        GAP,
        withScouts,
        simConfig,
      );
      const scout = spawnUnitForTest(b.sim, b.ctx, {
        side: 0,
        def,
        x: 3,
        y: 28,
      });
      const post = spawnUnitForTest(b.sim, b.ctx, {
        side: 1,
        def: 'unit_soldier',
        x: 1,
        y: 28,
      });
      const [px, py] = [post.px, post.py];
      for (let t = 0; t < 15; t++) {
        stepArena(b.sim, b.ctx);
        post.px = px;
        post.py = py;
      }
      return got(unitById(b.sim, scout.id)).px;
    };
    // Heading for the enemy at column 1 moves the scout left; heading for
    // the Core (column 6 or 7) moves it right.
    expect(go('unit_airscout')).toBeLessThan(mid(3) - 100);
    expect(go('unit_landscout')).toBeGreaterThan(mid(3));
  });
});
