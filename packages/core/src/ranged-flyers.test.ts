/**
 * Ranged units and flying units (issue #59, part 2; CB-16b, CB-16c): a ranged
 * unit fires from its range and holds its place, only ranged attackers and
 * turrets can hit a flyer, flyers cross walls and lakes and do not collide
 * with ground units, and both kinds keep the mirror symmetry and the
 * restore-at-any-tick property.
 */
import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
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
