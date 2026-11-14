/**
 * Unit owner and target Core with several Cores per side (PP-11, PP-12,
 * issue #133): the opposite Core first, then the nearest; rule b for any
 * Core in reach; retargeting; mirror symmetry; restore at any tick.
 */
import { describe, expect, test } from 'vitest';
import { computeField } from './arena-paths.js';
import {
  createArenaContext,
  createArenaSim,
  isCoreHealth,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
  type SideOptions,
} from './arena-sim.js';
import { startBattle, type Battle } from './battle.js';
import { previewEnemyPaths } from './enemy-paths.js';
import { hashJson } from './hash.js';
import { CELL_UNITS } from './limits.js';
import type { GameMap } from './map.js';
import type { NeutralZone } from './neutral-zone.js';
import { addToStash, placeFromStash, type TeamState } from './team-state.js';
import { Lab, board, content, mapgen, simConfig } from './testing/support.js';

const GAP = 4;
/** Arena rows: 16 + 4 + 16. */
const H = 36;
const W = 48;

type Plots = readonly number[];

/** A four-player board (12 columns per plot) with a node in every plot. */
function map4(partySize = 4): GameMap {
  return board(
    Array.from({ length: partySize }, (_, q): [number, number, string] => [
      12 * q + 2,
      2,
      'res_a',
    ]),
    12 * partySize,
    partySize,
  );
}

function put(
  lab: Lab,
  def: string,
  x: number,
  y: number,
  tier: number,
  owner: number,
): number {
  const s = addToStash(lab.state, content, { def, tier, owner });
  if (!s.ok) throw new Error(s.reason);
  const p = placeFromStash(s.state, content, {
    actor: owner,
    id: s.id,
    x,
    y,
    rotation: 0,
  });
  if (!p.ok) throw new Error(`${def}: ${p.reason}`);
  lab.state = p.state;
  return s.id;
}

/**
 * A team with player `q`'s Core at board column `coreX[q]` (row 0), and an
 * extractor + barracks line owned by every player in `farms`.
 */
function team(coreX: Plots, farms: Plots = [], partySize = coreX.length) {
  const lab = new Lab(map4(partySize));
  coreX.forEach((x, q) => {
    lab.core(x, 0, q);
  });
  for (const q of farms) {
    const x = 12 * q + 2;
    const e = put(lab, 'bld_extractor', x, 2, 3, q);
    const b = put(lab, 'bld_barracks', x, 6, 3, q);
    lab.link(e, 'north', b, 'south', [
      [x, 3],
      [x, 4],
      [x, 5],
    ]);
  }
  return lab.state;
}

const spread: Plots = [5, 17, 29, 41];

function start(
  teamA: TeamState,
  teamB: TeamState,
  options: { sideOptions?: [SideOptions | null, SideOptions | null] } = {},
) {
  return startArenaBattle(teamA, teamB, GAP, content, simConfig, options);
}

function runUntil(
  sim: ArenaSim,
  ctx: ArenaContext,
  stop: () => boolean,
  max = 1500,
): void {
  for (let t = 0; t < max && !stop(); t++) stepArena(sim, ctx);
  if (!stop()) throw new Error('condition not reached');
}

function hpOf(sim: ArenaSim, side: number, core: number) {
  const h = sim.health.find(
    (x) => isCoreHealth(x) && x.side === side && x.core === core,
  );
  if (h === undefined || !isCoreHealth(h)) throw new Error('no such Core');
  return h;
}

type Attack = Extract<ArenaEvent, { type: 'unit_attacked' }>;
const attacks = (events: ArenaEvent[]): Attack[] =>
  events.filter((e): e is Attack => e.type === 'unit_attacked');
const retargets = (events: ArenaEvent[]) =>
  events.filter(
    (e): e is Extract<ArenaEvent, { type: 'unit_retargeted' }> =>
      e.type === 'unit_retargeted',
  );

describe('the opposite Core is the first target (PP-11)', () => {
  test.each([0, 1, 2, 3])(
    'a unit of plot %i walks to the Core of the opposite plot',
    (p) => {
      const { sim, ctx, events } = start(team(spread), team(spread));
      const u = spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_soldier',
        x: 12 * p + 5,
        y: 14,
      });
      expect(u.owner).toBe(p);
      expect(u.target).toBe(3 - p);
      runUntil(sim, ctx, () =>
        attacks(events).some((a) => a.target.kind === 'core'),
      );
      const hit = attacks(events).find((a) => a.target.kind === 'core');
      expect(hit?.target).toEqual({ kind: 'core', side: 1, core: 3 - p });
    },
  );

  test('the opposite Core, even when another is nearer or has a lower index', () => {
    // Core 3 stands at arena columns 0 and 1; Core 2 at 12 and 13, right in
    // front of the unit at column 11 (plot 0, so its opposite is Core 3).
    const t = team([5, 17, 34, 46]);
    const { sim, ctx } = start(team(spread), t);
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 11,
      y: 14,
    });
    const near = (core: number) =>
      computeField(ctx.arena, 0, core).dist[14 * W + 11];
    expect(near(2)).toBeLessThan(near(3) ?? 0);
    expect(u.target).toBe(3);
  });

  test('side 1 units face the same way: opposite(p) is the same function', () => {
    const { sim, ctx } = start(team(spread), team(spread));
    // Side 1's own plot p lies at arena columns 12 * (3 - p) .. +11.
    for (let p = 0; p < 4; p++) {
      const u = spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_soldier',
        x: 12 * (3 - p) + 5,
        y: 21,
      });
      expect(u.owner).toBe(p);
      expect(u.target).toBe(3 - p);
    }
  });

  test('a solo battle: every unit targets the one enemy Core', () => {
    const solo = (): TeamState => {
      const lab = new Lab(board([[2, 2, 'res_a']], 12, 1));
      lab.core(5, 0, 0);
      put(lab, 'bld_extractor', 2, 2, 3, 0);
      return lab.state;
    };
    const { sim, ctx } = start(solo(), solo());
    for (const x of [1, 5, 10]) {
      const u = spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_raider',
        x,
        y: 14,
      });
      expect([u.owner, u.target]).toEqual([0, 0]);
    }
  });

  test('a producer owner and target are in unit_spawned', () => {
    const t = team(spread, [1]);
    const { sim, ctx, events } = start(t, team(spread));
    runUntil(sim, ctx, () => events.some((e) => e.type === 'unit_spawned'));
    const spawned = events.find((e) => e.type === 'unit_spawned');
    expect(spawned).toMatchObject({ side: 0, owner: 1, target: 2 });
    expect(sim.units[0]).toMatchObject({ owner: 1, target: 2 });
  });
});

describe('wave units (PP-11)', () => {
  test('a wave unit is owned by the plot of the column it enters on and heads for the Core opposite it', () => {
    const { sim, ctx, events } = start(team(spread), team(spread), {
      sideOptions: [
        null,
        { scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 4 }] },
      ],
    });
    stepArena(sim, ctx);
    const spawned = events.filter((e) => e.type === 'unit_spawned');
    expect(spawned.map((e) => [e.owner, e.target])).toEqual([
      [0, 3],
      [1, 2],
      [2, 1],
      [3, 0],
    ]);
  });
});

describe('choosing a target when the opposite Core is gone', () => {
  /** A battle in which the given enemy (side 1) Cores are already destroyed. */
  function without(a: TeamState, b: TeamState, dead: number[]) {
    const sim = createArenaSim(a, b, GAP, content, simConfig);
    for (const q of dead) hpOf(sim, 1, q).hp = 0;
    const events: ArenaEvent[] = [];
    const ctx = createArenaContext(sim, content, simConfig, { events });
    return { sim, ctx, events };
  }

  test('a unit produced after its opposite Core fell picks the nearest from where it appears', () => {
    // Plot 1 owns the barracks; its opposite is Core 2. With Core 2 gone, the
    // exit near arena column 14 is nearest to Core 3 (columns 5 and 6), not
    // the lowest-indexed Core 0 and not the opposite one.
    const { sim, ctx, events } = without(team(spread, [1]), team(spread), [2]);
    runUntil(sim, ctx, () => events.some((e) => e.type === 'unit_spawned'));
    expect(events.find((e) => e.type === 'unit_spawned')).toMatchObject({
      owner: 1,
      target: 3,
    });
  });

  test('the nearest Core is by movement distance', () => {
    const { sim, ctx } = without(team(spread), team(spread), [3]);
    const near = (x: number, want: number): void => {
      const u = spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_soldier',
        x,
        y: 14,
        owner: 0,
      });
      expect(u.target).toBe(want);
    };
    near(4, 2); // Core 2 (columns 17, 18) is nearer than Core 1 and Core 0
    near(26, 1);
    near(40, 0);
  });

  test('a tie goes to the Core whose plot is nearer to the opposite plot', () => {
    // Cores 1 and 2 are equally far from column 23 of the arena.
    const { sim, ctx } = without(
      team([5, 17, 30, 41]),
      team([5, 17, 30, 41]),
      [3],
    );
    const cell = 20 * W + 23;
    const f1 = computeField(ctx.arena, 0, 1).dist[cell];
    const f2 = computeField(ctx.arena, 0, 2).dist[cell];
    expect(f1).toBeGreaterThan(0);
    expect(f1).toBe(f2);
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 23,
      y: 20,
      owner: 0,
    });
    // |2 - 3| = 1 against |1 - 3| = 2.
    expect(u.target).toBe(2);
  });

  test('an exact tie: nearer plot to the opposite, then the larger index', () => {
    // Cores 0 and 2 are equally far from the column 27 cells of every row.
    const t = team([9, 17, 30, 41]);
    // Opposite of owner 2 is Core 1 (gone): Cores 0 and 2 are both one plot
    // away, so the larger index, 2, wins.
    const a = createArenaSim(t, t, GAP, content, simConfig);
    hpOf(a, 1, 1).hp = 0;
    const ctx = createArenaContext(a, content, simConfig);
    const cell = 20 * W + 27;
    const f0 = computeField(ctx.arena, 0, 0).dist[cell];
    const f2 = computeField(ctx.arena, 0, 2).dist[cell];
    expect(f0).toBeGreaterThan(0);
    expect(f0).toBe(f2);
    const u = spawnUnitForTest(a, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 27,
      y: 20,
      owner: 2,
    });
    expect(u.target).toBe(2);
    // Opposite of owner 0 is Core 3: Core 2 is one plot away, Core 0 three.
    const v = spawnUnitForTest(a, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 27,
      y: 22,
      owner: 3,
    });
    // Owner 3 (opposite 0, alive) heads for Core 0 outright.
    expect(v.target).toBe(0);
  });
});

describe('retargeting (PP-11)', () => {
  test('a unit whose target fell takes the nearest Core, and keeps it until it falls', () => {
    const { sim, ctx, events } = start(team(spread), team(spread));
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 14,
    });
    // Plot 3's unit heads for Core 0: it is not touched when Core 3 falls.
    const b = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 41,
      y: 14,
    });
    expect([a.target, b.target]).toEqual([3, 0]);
    hpOf(sim, 1, 3).hp = 5;
    runUntil(sim, ctx, () => retargets(events).length > 0);
    const fell = events.findIndex(
      (e) => e.type === 'core_destroyed' && e.core === 3,
    );
    const first = events.findIndex((e) => e.type === 'unit_retargeted');
    expect(fell).toBeGreaterThanOrEqual(0);
    expect(first).toBeGreaterThan(fell); // after the destruction events
    expect(retargets(events).map((e) => [e.unit, e.target])).toEqual([
      [a.id, 2],
    ]);
    expect(b.target).toBe(0);
    // Core 2 falls too: from the walk to it, Core 1 is the nearest.
    hpOf(sim, 1, 2).hp = 5;
    runUntil(sim, ctx, () => retargets(events).length > 1);
    expect(retargets(events).map((e) => [e.unit, e.target])).toEqual([
      [a.id, 2],
      [a.id, 1],
    ]);
    expect(a.target).toBe(1);
    expect(b.target).toBe(0);
  });

  test('no unit retargets while its target stands, whatever else falls', () => {
    const { sim, ctx, events } = start(team(spread), team(spread));
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 14,
    });
    hpOf(sim, 1, 0).hp = 1;
    hpOf(sim, 1, 1).hp = 1;
    for (let i = 0; i < 20; i++) stepArena(sim, ctx);
    // Overload is far away; fell two other Cores by hand.
    hpOf(sim, 1, 0).hp = 0;
    hpOf(sim, 1, 1).hp = 0;
    stepArena(sim, ctx);
    expect(events.filter((e) => e.type === 'core_destroyed')).toHaveLength(2);
    expect(retargets(events)).toEqual([]);
    expect(u.target).toBe(3);
  });
});

describe('rule b: any enemy Core in reach (CB-15c)', () => {
  test('a unit attacks a Core that is not its target, holds, then walks on', () => {
    const { sim, ctx, events } = start(team(spread), team(spread));
    // Core 2 occupies arena columns 17 and 18, rows 34 and 35.
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 17,
      y: 33,
      owner: 0,
    });
    expect(u.target).toBe(3);
    hpOf(sim, 1, 2).hp = 15;
    const px = u.px;
    const py = u.py;
    for (let i = 0; i < 12; i++) stepArena(sim, ctx);
    expect(attacks(events).map((a) => a.target)).toEqual([
      { kind: 'core', side: 1, core: 2 },
      { kind: 'core', side: 1, core: 2 },
    ]);
    expect([u.px, u.py, u.target]).toEqual([px, py, 3]); // holds its place
    runUntil(sim, ctx, () => events.some((e) => e.type === 'core_destroyed'));
    expect(retargets(events)).toEqual([]);
    const x0 = u.px;
    runUntil(sim, ctx, () =>
      attacks(events).some(
        (a) => a.target.kind === 'core' && a.target.core === 3,
      ),
    );
    expect(u.px).toBeLessThan(x0); // it walked on towards Core 3
    expect(u.target).toBe(3);
  });

  test('an enemy unit in contact comes before the Core in reach', () => {
    const { sim, ctx, events } = start(team(spread), team(spread));
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 17,
      y: 33,
      owner: 0,
    });
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: 17 * CELL_UNITS + CELL_UNITS / 2 + 150,
      py: 33 * CELL_UNITS + CELL_UNITS / 2,
    });
    stepArena(sim, ctx);
    const first = attacks(events).find((a) => a.unit === 1);
    expect(first?.target).toEqual({ kind: 'unit', unit: 2 });
  });

  describe('with two Cores in reach', () => {
    // Side 1's Cores 0 and 1 stand side by side: arena columns 36, 37 and
    // 34, 35. A unit on the line between them, one row in front, reaches both.
    const adjacent = team([10, 12, 29, 41]);
    function attacked(
      owner: number,
      target: number,
      shift = 0,
    ): number | undefined {
      const { sim, ctx, events } = start(team(spread), adjacent);
      spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_soldier',
        px: 36 * CELL_UNITS + shift,
        py: 33 * CELL_UNITS + CELL_UNITS / 2,
        owner,
        target,
      });
      stepArena(sim, ctx);
      const hit = attacks(events)[0]?.target;
      return hit?.kind === 'core' ? hit.core : undefined;
    }

    test('the target Core if it is one of them', () => {
      expect(attacked(0, 0)).toBe(0); // the key alone would say Core 1
      expect(attacked(3, 1)).toBe(1); // the key alone would say Core 0
    });

    test('else the nearest, ties by the nearer plot to the opposite', () => {
      expect(attacked(0, 3)).toBe(1); // tie: |1 - 3| < |0 - 3|
      expect(attacked(3, 2)).toBe(0); // tie: |0 - 0| < |1 - 0|
      expect(attacked(3, 2, -20)).toBe(1); // 20 units nearer to Core 1
      expect(attacked(0, 3, 20)).toBe(0); // 20 units nearer to Core 0
    });
  });
});

describe('enemy-path preview (PP-12)', () => {
  test('one path per front-row column to the Core of the plot it is in', () => {
    const paths = previewEnemyPaths(team(spread), content, simConfig);
    expect(paths).toHaveLength(48);
    for (const p of paths) expect(p.core).toBe(Math.floor(p.entry.x / 12));
    // Each walks towards its own Core: it ends next to that Core.
    const end = paths[5]?.cells.at(-1);
    expect(end?.x).toBeGreaterThanOrEqual(4);
    expect(end?.x).toBeLessThanOrEqual(7);
    const far = paths[41]?.cells.at(-1);
    expect(far?.x).toBeGreaterThanOrEqual(40);
    expect(far?.x).toBeLessThanOrEqual(43);
  });

  test('plots without a placed Core still get a path, to the Core a unit would choose', () => {
    const lab = new Lab(map4());
    lab.core(5, 0, 0);
    lab.core(41, 0, 3);
    const paths = previewEnemyPaths(lab.state, content, simConfig);
    expect(paths).toHaveLength(48);
    const { sim, ctx } = start(lab.state, team(spread));
    for (const p of paths) {
      // An enemy unit entering in this column of the arena (side 1, own
      // plot opposite the column's plot).
      const u = spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_soldier',
        x: p.entry.x,
        y: 20,
        allowOverlap: true,
      });
      expect(p.core).toBe(u.target);
      expect([0, 3]).toContain(p.core);
    }
    expect(paths.some((p) => p.core === 0)).toBe(true);
    expect(paths.some((p) => p.core === 3)).toBe(true);
  });

  test('with one Core placed in a party of four, every column has a path to it', () => {
    const lab = new Lab(map4());
    lab.core(17, 0, 1);
    const paths = previewEnemyPaths(lab.state, content, simConfig);
    expect(paths).toHaveLength(48);
    for (const p of paths) expect(p.core).toBe(1);
  });
});

/** Four farms and four Cores of different health: units fell Cores early. */
const weak: [SideOptions, SideOptions] = [
  { coreHealths: [30, 500, 500, 60] },
  { coreHealths: [30, 500, 500, 60] },
];

function fourPlots(): TeamState {
  return team(spread, [0, 1, 2, 3]);
}

describe('symmetry and restore with several Cores', () => {
  function key(sim: ArenaSim, side: number): string[] {
    return sim.units
      .filter((u) => u.side === side)
      .map((u) => {
        const x = side === 0 ? u.px : W * CELL_UNITS - u.px;
        const y = side === 0 ? u.py : H * CELL_UNITS - u.py;
        return `${u.def} ${String(x)},${String(y)} hp${String(u.hp)} o${String(u.owner)} t${String(u.target)}`;
      })
      .sort();
  }

  test('a mirrored four-plot battle stays exactly symmetric through retargets', () => {
    const { sim, ctx, events } = start(fourPlots(), fourPlots(), {
      sideOptions: weak,
    });
    for (let t = 0; t < 1500; t++) {
      stepArena(sim, ctx);
      expect(key(sim, 1)).toEqual(key(sim, 0));
      expect(sim.health.filter((h) => h.side === 0).map((h) => h.hp)).toEqual(
        sim.health.filter((h) => h.side === 1).map((h) => h.hp),
      );
    }
    const falls = events.filter((e) => e.type === 'core_destroyed');
    expect(falls.length).toBeGreaterThanOrEqual(2);
    const re = retargets(events);
    expect(re.length).toBeGreaterThan(0);
  });

  test('a mirrored two-plot battle, through a real Battle, is symmetric', () => {
    const zone: NeutralZone = {
      width: 24,
      depth: mapgen.neutralZone.depth,
      features: [],
      pointsOfInterest: [],
    };
    const mk = () => team([5, 17], [0, 1]);
    const r = startBattle(
      {
        teamA: mk(),
        teamB: mk(),
        seed: 1,
        sideOptions: [{ coreHealths: [30, 500] }, { coreHealths: [30, 500] }],
      },
      content,
      { sim: simConfig, mapgen },
      { zone },
    );
    if (!r.ok) throw new Error(r.error.message);
    const b: Battle = r.battle;
    while (!b.isOver()) {
      b.step();
      const half = (side: number) =>
        b.sim.health.filter((h) => h.side === side).map((h) => h.hp);
      expect(half(0)).toEqual(half(1));
    }
    expect(b.eventLog.some((e) => e.type === 'unit_retargeted')).toBe(true);
    expect(b.result()?.winner).toBeDefined();
  });

  test('restoring at any sampled tick around a retarget continues identically', () => {
    const opts = { sideOptions: weak };
    const a = start(fourPlots(), fourPlots(), opts);
    runUntil(a.sim, a.ctx, () =>
      a.events.some((e) => e.type === 'unit_retargeted'),
    );
    const retargetAt = a.sim.tick;
    const end = retargetAt + 250;
    for (let t = a.sim.tick; t < end; t++) stepArena(a.sim, a.ctx);
    const want = hashJson(a.sim);
    const wantEvents = a.events.map((e) => hashJson(e));
    const ticks = [
      0,
      1,
      retargetAt - 40,
      retargetAt - 2,
      retargetAt - 1,
      retargetAt,
      retargetAt + 1,
      retargetAt + 100,
    ];
    for (const at of ticks) {
      const b = start(fourPlots(), fourPlots(), opts);
      for (let t = 0; t < at; t++) stepArena(b.sim, b.ctx);
      const seen = b.events.length;
      const restored = JSON.parse(JSON.stringify(b.sim)) as ArenaSim;
      const events: ArenaEvent[] = [];
      const ctx = createArenaContext(restored, content, simConfig, { events });
      for (let t = at; t < end; t++) stepArena(restored, ctx);
      expect(hashJson(restored)).toBe(want);
      expect(events.map((e) => hashJson(e))).toEqual(wantEvents.slice(seen));
    }
  });
});
