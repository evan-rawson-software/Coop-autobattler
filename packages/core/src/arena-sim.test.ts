import { describe, expect, test } from 'vitest';
import {
  createArena,
  toArena,
  toBoard,
  type Arena,
  type ArenaContent,
} from './arena.js';
import { openFor } from './arena-paths.js';
import { renderArenaAscii } from './arena-render.js';
import {
  createArenaContext,
  createArenaSim,
  runArena,
  spawnUnitForTest,
  startBattle,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import { cloneBoardSim, flowTotals } from './flow-sim.js';
import { hashJson } from './hash.js';
import { Rng } from './rng.js';
import { loadUnitsOrThrow } from './units.js';
import type { Cell, GameMap } from './map.js';
import type { TeamState } from './team-state.js';
import {
  Lab,
  bigBoard,
  content,
  got,
  randomNetwork,
  simConfig,
} from './test-support.js';

// ---------------------------------------------------------------------------
// Helpers

/** A 12 x 16 board with the given nodes and blocked cells. */
function tiny(
  nodes: [number, number, string][] = [],
  lakes: [number, number][] = [],
): GameMap {
  return {
    width: 12,
    height: 16,
    partySize: 1,
    plotWidth: 12,
    features: lakes
      .map(([x, y]) => ({ x, y, feature: 'ter_lake' }))
      .sort((a, b) => a.y - b.y || a.x - b.x),
    nodes: nodes.map(([x, y, resource]) => ({ x, y, resource })),
  };
}

/** A team with only a Core at board cell `(x, y)`. */
function coreOnly(x = 5, y = 0, map: GameMap = tiny()): TeamState {
  const lab = new Lab(map);
  lab.core(x, y);
  return lab.state;
}

const GAP = 4;
/** Arena rows: 16 + 4 + 16. */
const H = 36;

function arenaCell(side: number, x: number, y: number): Cell {
  return toArena(
    { width: 12, height: H, boardHeight: 16, gapRows: GAP },
    side,
    {
      x,
      y,
    },
  );
}

function movesOf(events: readonly ArenaEvent[], unit: number): Cell[] {
  const out: Cell[] = [];
  for (const e of events) {
    if (e.type === 'unit_moved' && e.unit === unit)
      out.push({ x: e.x, y: e.y });
  }
  return out;
}

function ofType<T extends ArenaEvent['type']>(
  events: readonly ArenaEvent[],
  type: T,
): Extract<ArenaEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<ArenaEvent, { type: T }> => e.type === type,
  );
}

function healthOf(sim: ArenaSim, side: number, building: number): number {
  const h = sim.health.find((x) => x.side === side && x.building === building);
  return got(h).hp;
}

/** Breadth-first steps from every open cell to a cell next to `goal` cells. */
function bfs(arena: Arena, goal: readonly Cell[]): Int32Array {
  const { width, height } = arena.geom;
  const dist = new Int32Array(width * height).fill(-1);
  const open = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    arena.blocked[y * width + x] === 0 &&
    arena.occupant[y * width + x] === -1;
  const queue: number[] = [];
  for (const g of goal) {
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as const) {
      const x = g.x + dx;
      const y = g.y + dy;
      if (open(x, y) && dist[y * width + x] === -1) {
        dist[y * width + x] = 0;
        queue.push(y * width + x);
      }
    }
  }
  for (let h = 0; h < queue.length; h++) {
    const k = got(queue[h]);
    const x = k % width;
    const y = Math.floor(k / width);
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as const) {
      if (open(x + dx, y + dy) && dist[(y + dy) * width + x + dx] === -1) {
        dist[(y + dy) * width + x + dx] = (dist[k] ?? 0) + 1;
        queue.push((y + dy) * width + x + dx);
      }
    }
  }
  return dist;
}

function conserved(sim: ArenaSim): void {
  for (const b of sim.boards) {
    const f = flowTotals(b);
    expect(f.produced).toBe(
      f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
    );
  }
}

// ---------------------------------------------------------------------------

describe('arena geometry', () => {
  test('toArena and toBoard invert each other', () => {
    const geom = { width: 12, height: H, boardHeight: 16, gapRows: GAP };
    for (const side of [0, 1]) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 12; x++) {
          const a = toArena(geom, side, { x, y });
          expect(toBoard(geom, side, a)).toEqual({ x, y });
          if (side === 0) expect(a).toEqual({ x, y });
          else {
            expect(a.y).toBeGreaterThanOrEqual(16 + GAP);
            expect(a.y).toBeLessThan(H);
          }
        }
      }
    }
  });

  test('boards of different sizes are rejected', () => {
    const a = coreOnly();
    const b = coreOnly(5, 0, { ...tiny(), height: 17 });
    expect(() => createArena(a, b, GAP, content)).toThrow(/same size/);
    expect(() => createArena(a, a, -1, content)).toThrow(/gapRows/);
  });

  test('terrain, buildings and the Core are mapped; conduits are not in it', () => {
    const lab = new Lab(tiny([[2, 2, 'res_a']], [[7, 10]]));
    lab.core(5, 0);
    const src = lab.put('bld_extractor', 2, 2);
    const bar = lab.put('bld_barracks', 2, 5);
    const conduit = lab.link(src, 'north', bar, 'south', [
      [2, 3],
      [2, 4],
    ]);
    expect(conduit).toBeGreaterThan(0);
    const arena = createArena(lab.state, coreOnly(), GAP, content, [
      { x: 3, y: 17 },
    ]);
    const idx = (c: Cell): number => c.y * 12 + c.x;
    // The lake at board (7, 10) of side 0 is blocked at the same cell.
    expect(arena.blocked[idx({ x: 7, y: 10 })]).toBe(1);
    expect(arena.blocked[idx({ x: 3, y: 17 })]).toBe(1);
    expect(arena.blocked.reduce((a, b) => a + b, 0)).toBe(2);
    // Buildings cover their cells; conduit cells are open ground.
    const ref = got(arena.byId[0]?.get(bar));
    expect(arena.occupant[idx({ x: 2, y: 5 })]).toBe(ref);
    expect(arena.occupant[idx({ x: 3, y: 6 })]).toBe(ref);
    expect(arena.occupant[idx({ x: 2, y: 3 })]).toBe(-1);
    expect(arena.occupant[idx({ x: 2, y: 4 })]).toBe(-1);
    expect(arena.buildings.filter((b) => b.side === 0)).toHaveLength(3);
    // Side 1's Core (board (5, 0)) is rotated to the top of the arena.
    const core1 = got(arena.buildings[got(arena.coreRef[1])]);
    expect(core1.cells).toEqual([
      { x: 5, y: 34 },
      { x: 6, y: 34 },
      { x: 5, y: 35 },
      { x: 6, y: 35 },
    ]);
    expect(() =>
      createArena(lab.state, coreOnly(), GAP, content, [{ x: 0, y: 3 }]),
    ).toThrow(/gap rows/);
  });

  test('buildings start at their tier health', () => {
    const lab = new Lab(tiny());
    lab.core(0, 0);
    const w1 = lab.put('bld_wall', 5, 5, 0, 1);
    const w3 = lab.put('bld_wall', 6, 5, 0, 3);
    const sim = createArenaSim(lab.state, coreOnly(), GAP, content, simConfig);
    expect(healthOf(sim, 0, 0)).toBe(500);
    expect(healthOf(sim, 0, w1)).toBe(100);
    expect(healthOf(sim, 0, w3)).toBe(240);
    expect(healthOf(sim, 1, 0)).toBe(500);
    expect(sim.units).toEqual([]);
    expect(sim.nextUnitId).toBe(1);
  });
});

describe('movement', () => {
  test('units route around a lake along a shortest path', () => {
    // A barrier across the gap with a way round at x = 10, 11.
    const wall: Cell[] = [];
    for (let x = 0; x <= 9; x++) wall.push({ x, y: 18 });
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
      { gapBlocked: wall },
    );
    const start = { x: 1, y: 16 };
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      ...start,
    });
    const core1 = got(ctx.arena.buildings[got(ctx.arena.coreRef[1])]);
    const dist = bfs(ctx.arena, core1.cells);
    const expected = got(dist[start.y * 12 + start.x]);
    expect(expected).toBeGreaterThan(25); // the straight way is 21
    runArena(sim, ctx, 6 * expected + 20);
    const path = movesOf(events, u.id);
    expect(path).toHaveLength(expected);
    // Every step lands on an open cell and gets one step closer.
    let prev = got(dist[start.y * 12 + start.x]);
    for (const c of path) {
      expect(ctx.arena.blocked[c.y * 12 + c.x]).toBe(0);
      expect(ctx.arena.occupant[c.y * 12 + c.x]).toBe(-1);
      const d = got(dist[c.y * 12 + c.x]);
      expect(d).toBe(prev - 1);
      prev = d;
    }
    expect(prev).toBe(0);
    // It went through the opening, not through the barrier.
    expect(path.some((c) => c.y === 18 && c.x >= 10)).toBe(true);
    // Then it attacks the Core.
    expect(
      ofType(events, 'unit_attacked').some(
        (e) => e.target.kind === 'core' && e.target.side === 1,
      ),
    ).toBe(true);
    expect(healthOf(sim, 1, 0)).toBeLessThan(500);
  });

  test('a unit moves once per moveCooldownTicks, starting after the first', () => {
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x: 5, y: 16 });
    runArena(sim, ctx, 25);
    // Soldier: 6 ticks per cell, spawned with the cooldown running: it first
    // moves in tick 6, then 12, 18, 24.
    expect(ofType(events, 'unit_moved').map((e) => e.tick)).toEqual([
      6, 12, 18, 24,
    ]);
  });

  test('ties between equal paths go to the lowest y, then lowest x of the mover', () => {
    const { sim, ctx, events } = startBattle(
      coreOnly(8, 0),
      coreOnly(8, 0),
      GAP,
      content,
      simConfig,
    );
    // Side 1's Core is at arena x 2..3; from (5, 16) going left and going up
    // are equally good: the lower y wins, so it goes left to (4, 16).
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 16,
    });
    // Its mirror image is a side 1 unit at (6, 19): the same rule in its own
    // frame sends it to (7, 19), the mirror of (4, 16).
    const b = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 6,
      y: 19,
    });
    runArena(sim, ctx, 7);
    expect(movesOf(events, a.id)).toEqual([{ x: 4, y: 16 }]);
    expect(movesOf(events, b.id)).toEqual([{ x: 7, y: 19 }]);
  });

  test('conduits never block movement or change paths', () => {
    function build(withConduit: boolean): TeamState {
      const lab = new Lab(tiny([[1, 3, 'res_b']]));
      lab.core(5, 0);
      const src = lab.put('bld_extractor', 1, 3);
      const turret = lab.put('bld_turret', 10, 15);
      if (withConduit) {
        const cells: [number, number][] = [];
        for (let y = 4; y <= 14; y++) cells.push([1, y]);
        for (let x = 2; x <= 10; x++) cells.push([x, 14]);
        lab.link(src, 'north', turret, 'south', cells);
      }
      return lab.state;
    }
    const run = (withConduit: boolean) => {
      const b = startBattle(
        coreOnly(),
        build(withConduit),
        GAP,
        content,
        simConfig,
      );
      for (const x of [3, 5, 6, 8]) {
        spawnUnitForTest(b.sim, b.ctx, {
          side: 0,
          def: 'unit_soldier',
          x,
          y: 16,
        });
      }
      for (let t = 0; t < 900; t++) {
        stepArena(b.sim, b.ctx);
        // No unit ever stands in a building or on blocked ground.
        for (const u of b.sim.units) {
          expect(b.ctx.arena.occupant[u.y * 12 + u.x]).toBe(-1);
        }
      }
      return b;
    };
    const plain = run(false);
    const wired = run(true);
    const strip = (e: ArenaEvent[]): ArenaEvent[] =>
      e.filter(
        (x) =>
          x.type === 'unit_moved' ||
          x.type === 'unit_attacked' ||
          x.type === 'unit_died',
      );
    expect(strip(wired.events)).toEqual(strip(plain.events));
    expect(strip(wired.events).length).toBeGreaterThan(50);
    // Units really walked over conduit cells (board y = 14 is arena y = 21).
    const onConduit = ofType(wired.events, 'unit_moved').filter(
      (e) => e.y === 21 && e.x >= 1 && e.x <= 10,
    );
    expect(onConduit.length).toBeGreaterThan(0);
    // The conduits are not targets: attacks only name units, buildings, Cores.
    const ids = new Set(wired.sim.teams[1].buildings.map((b) => b.id));
    for (const e of ofType(wired.events, 'unit_attacked')) {
      if (e.target.kind === 'building')
        expect(ids.has(e.target.building)).toBe(true);
    }
    expect(wired.sim.teams[1].conduits).toHaveLength(1);
  });
});

describe('combat', () => {
  test('adjacent enemies hit each other simultaneously', () => {
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 16,
    });
    const b = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 5,
      y: 17,
    });
    runArena(sim, ctx, 1);
    expect(a.hp).toBe(34);
    expect(b.hp).toBe(34);
    const hits = ofType(events, 'unit_attacked');
    expect(hits.map((h) => [h.tick, h.unit, h.damage])).toEqual([
      [0, a.id, 6],
      [0, b.id, 6],
    ]);
    // Cooldown 10: the next blow comes 10 ticks later.
    runArena(sim, ctx, 9);
    expect(a.hp).toBe(34);
    runArena(sim, ctx, 1);
    expect(a.hp).toBe(28);
    // Nobody moved: units in melee hold position.
    expect(ofType(events, 'unit_moved')).toHaveLength(0);
  });

  test('a unit attacks the nearest enemy; ties go to the lowest ID', () => {
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const far = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 5,
      y: 18,
    });
    const near2 = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 6,
      y: 17,
    });
    const near1 = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 4,
      y: 17,
    });
    // The attacker is at (5, 17): both near ones are at distance 1 (the lower
    // ID wins) and the third is also at distance 1 above... put it at (5, 18).
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x: 5, y: 17 });
    runArena(sim, ctx, 1);
    const mine = ofType(events, 'unit_attacked').find((e) => e.unit === 4);
    // IDs: far = 1, near2 = 2, near1 = 3; all three are at distance 1.
    expect([far.id, near2.id, near1.id]).toEqual([1, 2, 3]);
    expect(mine?.target).toEqual({ kind: 'unit', unit: 1 });
  });

  test('two equal groups meeting annihilate each other symmetrically', () => {
    // An odd width gives a centre column, so mirrored units face each other.
    const odd = { ...tiny(), width: 11, plotWidth: 11 };
    const { sim, ctx, events } = startBattle(
      coreOnly(4, 0, odd),
      coreOnly(4, 0, odd),
      GAP,
      content,
      simConfig,
    );
    const spots: [number, number][] = [
      [5, 10],
      [5, 12],
      [5, 14],
      [5, 9],
      [5, 11],
    ];
    for (const [x, y] of spots) {
      spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x, y });
    }
    for (const [x, y] of spots) {
      spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_soldier',
        x: 10 - x,
        y: H - 1 - y,
      });
    }
    let alive0 = 5;
    for (let t = 0; t < 1500 && sim.units.length > 0; t++) {
      stepArena(sim, ctx);
      const a = sim.units.filter((u) => u.side === 0).length;
      const b = sim.units.filter((u) => u.side === 1).length;
      expect(a).toBe(b);
      alive0 = a;
    }
    expect(alive0).toBe(0);
    expect(sim.units).toHaveLength(0);
    // Deaths came in pairs on the same ticks.
    const byTick = new Map<number, number[]>();
    for (const e of ofType(events, 'unit_died')) {
      const list = byTick.get(e.tick) ?? [];
      list.push(e.unit);
      byTick.set(e.tick, list);
    }
    expect(byTick.size).toBeGreaterThan(0);
    for (const ids of byTick.values()) {
      expect(ids.filter((i) => i <= 5)).toHaveLength(
        ids.filter((i) => i > 5).length,
      );
    }
    expect(sim.unitsDied).toEqual([5, 5]);
  });

  test('a unit on cooldown holds position instead of walking away', () => {
    // A raider at a source: after its first blow it must not move on.
    const lab = new Lab(tiny([[5, 12, 'res_a']]));
    lab.core(0, 0);
    const src = lab.put('bld_extractor', 5, 12, 0, 3);
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    const at = arenaCell(1, 5, 12);
    const r = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_raider',
      x: at.x,
      y: at.y - 1,
    });
    runArena(sim, ctx, 12);
    expect(movesOf(events, r.id)).toHaveLength(0);
    const hits = ofType(events, 'unit_attacked').filter((e) => e.unit === r.id);
    expect(hits.map((h) => h.tick)).toEqual([0, 8]);
    expect(hits[0]?.target).toEqual({
      kind: 'building',
      side: 1,
      building: src,
    });
    expect(healthOf(sim, 1, src)).toBe(60 - 16);
  });
});

describe('targeting', () => {
  test('a raider goes for infrastructure over a nearer wall, then for the Core', () => {
    const lab = new Lab(tiny([[8, 5, 'res_a']]));
    lab.core(5, 0);
    const wall = lab.put('bld_wall', 6, 14);
    const src = lab.put('bld_extractor', 8, 5);
    const sp = lab.put('bld_splitter', 3, 5);
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    for (const x of [6, 7]) {
      spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_raider', x, y: 16 });
    }
    runArena(sim, ctx, 700);
    const targets = ofType(events, 'unit_attacked').map((e) => e.target);
    const buildingHits = targets.flatMap((t) =>
      t.kind === 'building' ? [t.building] : [],
    );
    expect(new Set(buildingHits)).toEqual(new Set([src, sp]));
    expect(buildingHits).not.toContain(wall);
    expect(healthOf(sim, 1, wall)).toBe(100);
    expect(healthOf(sim, 1, src)).toBe(0);
    expect(healthOf(sim, 1, sp)).toBe(0);
    // Core hits only once nothing else of the infrastructure is left.
    const lastInfra = Math.max(
      ...targets.map((t, i) => (t.kind === 'building' ? i : -1)),
    );
    const firstCore = targets.findIndex((t) => t.kind === 'core');
    expect(firstCore).toBeGreaterThan(lastInfra - 1);
    expect(healthOf(sim, 1, 0)).toBeLessThan(500);
    const destroyed = ofType(events, 'building_destroyed').map(
      (e) => e.building,
    );
    expect(new Set(destroyed)).toEqual(new Set([src, sp]));
  });

  test('a unit with a defenses preference attacks walls and turrets first', () => {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    const wall = lab.put('bld_wall', 2, 14);
    const turret = lab.put('bld_turret', 9, 8);
    const sp = lab.put('bld_splitter', 6, 12);
    const custom: ArenaContent = {
      ...content,
      units: loadUnitsOrThrow({
        units: [
          {
            id: 'unit_sapper',
            health: 40,
            damage: 30,
            attackCooldownTicks: 5,
            rangeCells: 0,
            moveCooldownTicks: 2,
            targeting: 'defenses',
          },
        ],
      }),
    };
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      lab.state,
      GAP,
      custom,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_sapper', x: 6, y: 16 });
    runArena(sim, ctx, 600);
    const hit = ofType(events, 'unit_attacked').flatMap((e) =>
      e.target.kind === 'building' ? [e.target.building] : [],
    );
    expect(new Set(hit)).toEqual(new Set([wall, turret]));
    expect(hit).not.toContain(sp);
    expect(healthOf(sim, 1, sp)).toBe(20);
    expect(
      ofType(events, 'unit_attacked').some((e) => e.target.kind === 'core'),
    ).toBe(true);
  });

  test('ranged units attack from their range and then stop', () => {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    const wall = lab.put('bld_wall', 5, 14);
    const custom: ArenaContent = {
      ...content,
      units: loadUnitsOrThrow({
        units: [
          {
            id: 'unit_archer',
            health: 10,
            damage: 2,
            attackCooldownTicks: 5,
            rangeCells: 3,
            moveCooldownTicks: 2,
            targeting: 'defenses',
          },
        ],
      }),
    };
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      lab.state,
      GAP,
      custom,
      simConfig,
    );
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_archer',
      x: 6,
      y: 16,
    });
    runArena(sim, ctx, 40);
    const first = ofType(events, 'unit_attacked')[0];
    expect(first?.target).toEqual({
      kind: 'building',
      side: 1,
      building: wall,
    });
    // The wall is at arena (6, 21); the archer stops at Manhattan distance 3.
    expect(Math.abs(u.x - 6) + Math.abs(u.y - 21)).toBe(3);
  });

  test('with nothing left to attack, units wait', () => {
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const h = sim.health.find((x) => x.side === 1 && x.building === 0);
    got(h).hp = 0;
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x: 5, y: 16 });
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_raider', x: 6, y: 16 });
    runArena(sim, ctx, 50);
    expect(ofType(events, 'core_destroyed')).toEqual([
      { tick: 0, type: 'core_destroyed', side: 1 },
    ]);
    expect(ofType(events, 'unit_moved')).toHaveLength(0);
    expect(ofType(events, 'unit_attacked')).toHaveLength(0);
    expect(sim.tick).toBe(50);
    // The Core's cells are open ground again.
    expect(ctx.arena.occupant[35 * 12 + 5]).toBe(-1);
  });
});

describe('breaching sealed bases (CB-20)', () => {
  function sealed(): { lab: Lab; weak: number; strong: number } {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    for (const [x, y] of [
      [4, 0],
      [4, 1],
      [4, 2],
      [7, 0],
      [7, 1],
      [7, 2],
    ] as const) {
      lab.put('bld_wall', x, y, 0, 3);
    }
    const weak = lab.put('bld_wall', 5, 2, 0, 1);
    const strong = lab.put('bld_wall', 6, 2, 0, 3);
    return { lab, weak, strong };
  }

  test('units break through the weakest point and then reach the Core', () => {
    const { lab, weak, strong } = sealed();
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    // The walls: board (5, 2) -> arena (6, 33); board (6, 2) -> arena (5, 33).
    expect(ctx.arena.occupant[33 * 12 + 6]).toBeGreaterThanOrEqual(0);
    for (const x of [5, 6]) {
      for (const y of [22, 23]) {
        spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x, y });
      }
    }
    runArena(sim, ctx, 1200);
    const hits = ofType(events, 'unit_attacked').map((e) => e.target);
    const walls = hits.flatMap((t) =>
      t.kind === 'building' ? [t.building] : [],
    );
    // Only the weaker wall (tier 1) was ever attacked, though the other is as near.
    expect(new Set(walls)).toEqual(new Set([weak]));
    expect(healthOf(sim, 1, strong)).toBe(240);
    expect(healthOf(sim, 1, weak)).toBe(0);
    expect(ofType(events, 'building_destroyed')).toEqual([
      {
        tick: expect.any(Number) as number,
        type: 'building_destroyed',
        side: 1,
        building: weak,
      },
    ]);
    // After it fell the units went in and hit the Core.
    const fall = got(ofType(events, 'building_destroyed')[0]).tick;
    const coreHits = ofType(events, 'unit_attacked').filter(
      (e) => e.target.kind === 'core',
    );
    expect(coreHits.length).toBeGreaterThan(0);
    for (const e of coreHits) expect(e.tick).toBeGreaterThan(fall);
    expect(healthOf(sim, 1, 0)).toBeLessThan(500);
    expect(sim.teams[1].buildings.some((b) => b.id === weak)).toBe(false);
  });

  test('the cheaper route wins even when it is longer', () => {
    // Enemy base: Core in a corner, walled by a 100 hp wall at the front and a
    // 240 hp wall that is as near: the units pick by cost, not distance.
    const { lab, weak } = sealed();
    const { sim, ctx } = startBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    // A unit exactly in front of the strong wall.
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 32,
    });
    runArena(sim, ctx, 14);
    // It sidestepped towards the weak wall (arena (6, 33)) and attacked it.
    expect(u.x).toBe(6);
    expect(healthOf(sim, 1, weak)).toBeLessThan(100);
  });
});

describe('destruction', () => {
  function network() {
    const lab = new Lab(
      tiny([
        [2, 2, 'res_a'],
        [9, 2, 'res_a'],
      ]),
    );
    lab.core(6, 0);
    const e1 = lab.put('bld_extractor', 2, 2, 0, 3);
    const sp = lab.put('bld_splitter', 2, 5);
    const b1 = lab.put('bld_barracks', 2, 6);
    const b2 = lab.put('bld_barracks', 5, 5, 90);
    const e2 = lab.put('bld_extractor', 9, 2);
    const b3 = lab.put('bld_barracks', 9, 5);
    const c1 = lab.link(e1, 'north', sp, 'south', [
      [2, 3],
      [2, 4],
    ]);
    const c2 = lab.link(sp, 'north', b1, 'south');
    const c3 = lab.link(sp, 'east', b2, 'west', [
      [3, 5],
      [4, 5],
    ]);
    const c4 = lab.link(e2, 'north', b3, 'south', [
      [9, 3],
      [9, 4],
    ]);
    return { lab, e1, sp, b1, b2, e2, b3, c: [c1, c2, c3, c4] };
  }

  test('destroying a splitter removes its conduits and starves what is downstream', () => {
    const n = network();
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      n.lab.state,
      GAP,
      content,
      simConfig,
    );
    for (let t = 0; t < 61; t++) {
      stepArena(sim, ctx);
      conserved(sim);
    }
    const before = flowTotals(got(sim.boards[1]));
    expect(before.inConduits).toBeGreaterThan(0);
    // The splitter falls on the next tick.
    got(sim.health.find((h) => h.side === 1 && h.building === n.sp)).hp = 0;
    for (let t = 0; t < 600; t++) {
      stepArena(sim, ctx);
      conserved(sim);
    }
    expect(ofType(events, 'building_destroyed')).toEqual([
      { tick: 61, type: 'building_destroyed', side: 1, building: n.sp },
    ]);
    expect(ofType(events, 'conduit_destroyed')).toEqual([
      { tick: 61, type: 'conduit_destroyed', side: 1, conduit: n.c[0] },
      { tick: 61, type: 'conduit_destroyed', side: 1, conduit: n.c[1] },
      { tick: 61, type: 'conduit_destroyed', side: 1, conduit: n.c[2] },
    ]);
    // Only the unrelated network is left.
    expect(sim.teams[1].conduits.map((c) => c.id)).toEqual([n.c[3]]);
    expect(sim.teams[1].buildings.map((b) => b.id)).toEqual([
      n.e1,
      n.b1,
      n.b2,
      n.e2,
      n.b3,
    ]);
    expect(sim.boards[1].conduits.map((c) => c.id)).toEqual([n.c[3]]);
    expect(sim.boards[1].routes).toEqual([]);
    // Items that were in the removed conduits are counted as lost.
    expect(sim.boards[1].retired?.lost).toBeGreaterThan(0);
    // The starved barracks never spawned; the unrelated one kept going.
    const spawnedBy = (id: number): number =>
      ofType(events, 'unit_spawned').filter(
        (e) => e.side === 1 && e.building === id,
      ).length;
    expect(spawnedBy(n.b1)).toBe(0);
    expect(spawnedBy(n.b2)).toBe(0);
    // Production at B3: first item delivered at tick 19 + 2 = 21, then every
    // 20 ticks; the sixth is delivered (and the unit spawned) in tick 121.
    expect(
      ofType(events, 'unit_spawned')
        .filter((e) => e.building === n.b3)
        .map((e) => e.tick),
    ).toEqual([121, 241, 361, 481, 601]);
    expect(
      ofType(events, 'delivered').filter(
        (e) => e.side === 1 && e.building === n.b1,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      ofType(events, 'delivered').filter(
        (e) => e.side === 1 && e.building === n.b1 && e.tick > 61,
      ),
    ).toHaveLength(0);
    expect(
      ofType(events, 'delivered').filter(
        (e) => e.side === 1 && e.building === n.b3 && e.tick > 400,
      ).length,
    ).toBeGreaterThan(0);
  });

  test('a destroyed source stops producing and its counters stay in the totals', () => {
    const n = network();
    const { sim, ctx } = startBattle(
      coreOnly(),
      n.lab.state,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 100);
    const produced = flowTotals(got(sim.boards[1])).produced;
    expect(produced).toBeGreaterThan(5);
    got(sim.health.find((h) => h.side === 1 && h.building === n.e1)).hp = 0;
    for (let t = 0; t < 200; t++) {
      stepArena(sim, ctx);
      conserved(sim);
    }
    expect(sim.boards[1].sources.map((s) => s.building)).toEqual([n.e2]);
    // The destroyed extractor's output is not lost from the books.
    expect(sim.boards[1].retired?.produced).toBeGreaterThan(5);
    expect(hashJson(cloneBoardSim(got(sim.boards[1])))).toBe(
      hashJson(sim.boards[1]),
    );
    expect(sim.teams[1].conduits.map((c) => c.id)).toEqual([
      n.c[1],
      n.c[2],
      n.c[3],
    ]);
  });

  test('a restored state continues exactly like the original', () => {
    const n = network();
    const a = startBattle(coreOnly(), n.lab.state, GAP, content, simConfig);
    spawnUnitForTest(a.sim, a.ctx, {
      side: 0,
      def: 'unit_raider',
      x: 2,
      y: 20,
    });
    spawnUnitForTest(a.sim, a.ctx, {
      side: 0,
      def: 'unit_raider',
      x: 3,
      y: 20,
    });
    runArena(a.sim, a.ctx, 220);
    expect(ofType(a.events, 'building_destroyed').length).toBeGreaterThan(0);
    const copy = JSON.parse(JSON.stringify(a.sim)) as ArenaSim;
    expect(hashJson(copy)).toBe(hashJson(a.sim));
    const events: ArenaEvent[] = [];
    const ctx: ArenaContext = createArenaContext(copy, content, simConfig, {
      events,
    });
    const mark = a.events.length;
    runArena(a.sim, a.ctx, 300);
    runArena(copy, ctx, 300);
    expect(hashJson(copy)).toBe(hashJson(a.sim));
    expect(hashJson(events)).toBe(hashJson(a.events.slice(mark)));
  });
});

describe('production', () => {
  function farm(barracksTier: number, len: number) {
    const lab = new Lab(tiny([[2, 2, 'res_a']]));
    lab.core(8, 0);
    const src = lab.put('bld_extractor', 2, 2, 0, 1);
    const bar = lab.put('bld_barracks', 2, 3 + len, 0, barracksTier);
    const cells: [number, number][] = [];
    for (let k = 0; k < len; k++) cells.push([2, 3 + k]);
    lab.link(src, 'north', bar, 'south', cells);
    return { lab, bar };
  }

  test('a cost larger than the input buffer is met by accumulating progress', () => {
    // Tier 1 barracks costs 6, the buffer holds 4. Extractor tier 1: one item
    // per 20 ticks, first made in tick 19. Over a 2-cell conduit the k-th item
    // is delivered in tick 19 + 2 + 20 (k - 1); the sixth, in tick 121,
    // completes the first unit in that same tick. Then every 120 ticks.
    const { lab, bar } = farm(1, 2);
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 600);
    const spawns = ofType(events, 'unit_spawned');
    expect(spawns.map((e) => e.tick)).toEqual([121, 241, 361, 481]);
    expect(
      spawns.every(
        (e) => e.building === bar && e.side === 1 && e.def === 'unit_soldier',
      ),
    ).toBe(true);
    expect(sim.spawned).toEqual([0, 4]);
    // 600 ticks: items 1..30 delivered (the 30th in tick 599 is not yet); the
    // leftover progress is what has not made a unit.
    const p = got(sim.producers.find((x) => x.building === bar));
    const delivered = ofType(events, 'delivered').length;
    expect(delivered).toBe(29);
    expect(p.progress + 4 * 6).toBe(delivered);
    expect(sim.boards[1].consumers[0]?.inputs[0]?.count).toBe(0);
  });

  test('a tier 2 barracks (cost 5) over a direct-ish link spawns every 100 ticks', () => {
    const { lab } = farm(2, 1);
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 450);
    // Item k delivered in tick 19 + 1 + 20 (k - 1): the fifth in tick 100.
    expect(ofType(events, 'unit_spawned').map((e) => e.tick)).toEqual([
      100, 200, 300, 400,
    ]);
  });

  test('units spawn on the free neighbour closest to the goal, with fixed tie-breaks', () => {
    const { lab, bar } = farm(1, 2);
    const { sim, ctx, events } = startBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 125);
    const s = got(ofType(events, 'unit_spawned')[0]);
    // The barracks (side 1's board, cells (2..3, 5..6)) heads for side 0's
    // Core at arena (5..6, 0..1). Board (3, 7) and board (4, 6) are both 28
    // steps from it; the tie goes to the lower board y, so (4, 6).
    const cell = arenaCell(1, 4, 6);
    expect(s).toMatchObject({ x: cell.x, y: cell.y, building: bar });
    expect(ctx.arena.occupant[s.y * 12 + s.x]).toBe(-1);
  });
});

describe('determinism and symmetry', () => {
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

  function mirrorKey(sim: ArenaSim, side: number): string[] {
    return sim.units
      .filter((u) => u.side === side)
      .map((u) => {
        const x = side === 0 ? u.x : 11 - u.x;
        const y = side === 0 ? u.y : H - 1 - u.y;
        return `${u.def} ${String(x)},${String(y)} hp${String(u.hp)} m${String(u.moveCooldown)} a${String(u.attackCooldown)}`;
      })
      .sort();
  }

  test('a mirror match stays exactly symmetric for 700 ticks', () => {
    const team = farmTeam();
    const { sim, ctx, events } = startBattle(
      team,
      team,
      GAP,
      content,
      simConfig,
    );
    let fights = 0;
    for (let t = 0; t < 700; t++) {
      stepArena(sim, ctx);
      expect(mirrorKey(sim, 1)).toEqual(mirrorKey(sim, 0));
      expect(hashJson(sim.boards[0])).toBe(hashJson(sim.boards[1]));
      expect(
        sim.health.filter((h) => h.side === 0).map((h) => [h.building, h.hp]),
      ).toEqual(
        sim.health.filter((h) => h.side === 1).map((h) => [h.building, h.hp]),
      );
      expect(hashJson(sim.teams[0])).toBe(hashJson(sim.teams[1]));
      expect(
        sim.producers.filter((p) => p.side === 0).map((p) => p.progress),
      ).toEqual(
        sim.producers.filter((p) => p.side === 1).map((p) => p.progress),
      );
      fights += sim.units.length;
    }
    expect(sim.spawned[0]).toBe(sim.spawned[1]);
    expect(sim.spawned[0]).toBeGreaterThan(10);
    expect(sim.unitsDied[0]).toBe(sim.unitsDied[1]);
    expect(sim.unitsDied[0]).toBeGreaterThan(3);
    expect(ofType(events, 'unit_attacked').length).toBeGreaterThan(50);
    expect(fights).toBeGreaterThan(1000);
  });

  test('identical inputs give identical states and events', () => {
    const team = farmTeam();
    const a = startBattle(team, team, GAP, content, simConfig);
    const b = startBattle(team, team, GAP, content, simConfig);
    runArena(a.sim, a.ctx, 400);
    runArena(b.sim, b.ctx, 400);
    expect(hashJson(a.sim)).toBe(hashJson(b.sim));
    expect(hashJson(a.events)).toBe(hashJson(b.events));
  });
});

describe('rendering', () => {
  test('side 1 is on top, units are digits and * where sides meet', () => {
    const lab = new Lab(tiny([[2, 2, 'res_a']], [[7, 10]]));
    lab.core(5, 0);
    lab.put('bld_extractor', 2, 2);
    lab.put('bld_barracks', 2, 6);
    const { sim, ctx } = startBattle(
      lab.state,
      coreOnly(),
      2,
      content,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x: 4, y: 12 });
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x: 9, y: 16 });
    spawnUnitForTest(sim, ctx, { side: 1, def: 'unit_soldier', x: 9, y: 16 });
    spawnUnitForTest(sim, ctx, { side: 1, def: 'unit_soldier', x: 3, y: 20 });
    const text = renderArenaAscii(sim, content);
    const body = text.split('\n').slice(0, -1).join('\n');
    expect(body).toBe(
      [
        '.....cc.....',
        '.....cc.....',
        '............',
        '............',
        '............',
        '............',
        '............',
        '............',
        '............',
        '............',
        '............',
        '............',
        '............',
        '...1........',
        '............',
        '............',
        '............',
        '.........*..',
        '............',
        '............',
        '............',
        '....0.......',
        '............',
        '.......~....',
        '............',
        '............',
        '..UU........',
        '..UU........',
        '............',
        '............',
        '............',
        '..S.........',
        '.....CC.....',
        '.....CC.....',
      ].join('\n'),
    );
    expect(text.split('\n').pop()).toContain('legend');
  });
});

describe('stress', () => {
  test('several hundred units on a four-plot arena for 1000 ticks', () => {
    const team = (() => {
      const state = bigBoard();
      const lab = new Lab(state.map);
      lab.state = state;
      lab.core(40, 6);
      return lab.state;
    })();
    const { sim, ctx } = startBattle(team, team, 8, content, simConfig);
    // 150 units on each side in the open ground between the bases; they meet
    // within the first 30 ticks.
    for (let k = 0; k < 300; k++) {
      const side = k % 2;
      spawnUnitForTest(sim, ctx, {
        side,
        def: k % 3 === 0 ? 'unit_raider' : 'unit_soldier',
        x: (k >> 1) % 96,
        y: side === 0 ? 17 : 22,
      });
    }
    let peak = 0;
    const t0 = Date.now();
    for (let t = 0; t < 1000; t++) {
      stepArena(sim, ctx);
      if (sim.units.length > peak) peak = sim.units.length;
    }
    const ms = Date.now() - t0;
    expect(peak).toBeGreaterThanOrEqual(300);
    expect(sim.units.length).toBeGreaterThanOrEqual(300);
    expect(
      ms,
      `1000 arena ticks with up to ${String(peak)} units took ${String(ms)} ms`,
    ).toBeLessThan(60000);
    conserved(sim);
  });
});

/** Per-tick invariants of a battle (shared by the property tests). */
function checkTick(sim: ArenaSim, ctx: ArenaContext): void {
  const { width } = ctx.arena.geom;
  let prev = 0;
  for (const u of sim.units) {
    expect(u.id).toBeGreaterThan(prev);
    prev = u.id;
    const k = u.y * width + u.x;
    expect(ctx.arena.blocked[k]).toBe(0);
    expect(openFor(ctx.arena, u.side, k)).toBe(true);
    expect(Number.isInteger(u.hp)).toBe(true);
    expect(u.hp).toBeGreaterThan(0);
  }
  for (const h of sim.health) {
    expect(Number.isInteger(h.hp)).toBe(true);
    expect(h.hp).toBeGreaterThanOrEqual(0);
  }
  // No destroyed building is left in a team state or a flow plan.
  for (const side of [0, 1] as const) {
    const alive = new Set(
      sim.health
        .filter((h) => h.side === side && h.building > 0 && h.hp > 0)
        .map((h) => h.building),
    );
    const team = got(sim.teams[side]);
    expect(team.buildings.map((x) => x.id).sort((p, q) => p - q)).toEqual(
      [...alive].sort((p, q) => p - q),
    );
    const board = got(sim.boards[side]);
    for (const s of board.sources) expect(alive.has(s.building)).toBe(true);
    for (const r of board.routes) expect(alive.has(r.building)).toBe(true);
    for (const c of board.consumers) expect(alive.has(c.building)).toBe(true);
    const conduitIds = team.conduits.map((c) => c.id);
    expect(board.conduits.map((c) => c.id)).toEqual(conduitIds);
    for (const c of team.conduits) {
      expect(alive.has(c.from.building)).toBe(true);
      expect(alive.has(c.to.building)).toBe(true);
    }
  }
  conserved(sim);
}

/**
 * One tick with the turret-fire invariant: every `turret_fired` event of the
 * tick names a unit of the other side that stood, before the tick's moves,
 * inside the arena rows of the turret owner's own board and within range.
 */
function stepChecked(
  sim: ArenaSim,
  ctx: ArenaContext,
  events: ArenaEvent[],
): number {
  const before = new Map(
    sim.units.map((u) => [u.id, { y: u.y, side: u.side }]),
  );
  const start = events.length;
  const { boardHeight, height } = ctx.arena.geom;
  stepArena(sim, ctx);
  let shots = 0;
  for (const e of events.slice(start)) {
    if (e.type !== 'turret_fired') continue;
    shots += 1;
    const u = got(before.get(e.unit));
    expect(u.side).toBe(1 - e.side);
    const lo = e.side === 0 ? 0 : height - boardHeight;
    expect(u.y).toBeGreaterThanOrEqual(lo);
    expect(u.y).toBeLessThanOrEqual(lo + boardHeight - 1);
  }
  return shots;
}

/**
 * A 12 x 16 board with random lakes, walls and gates, several powered turret
 * lanes (an extractor, a conduit and a turret) and a barracks lane.
 */
function defenseBoard(seed: number): TeamState {
  const rng = Rng.fromSeed(seed * 104729);
  const bx = rng.nextInt(10);
  const cols = rng
    .shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    .filter((x) => x !== bx && x !== bx + 1);
  const lanes = [bx, ...cols.slice(0, 3)];
  const lakes: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const x = rng.nextInt(12);
    const y = 5 + rng.nextInt(8);
    if (
      !lanes.includes(x) &&
      x !== bx + 1 &&
      !lakes.some(([a, b]) => a === x && b === y)
    )
      lakes.push([x, y]);
  }
  const lab = new Lab(
    tiny(
      lanes.map((x, i) => [x, 2, i === 0 ? 'res_a' : 'res_b']),
      lakes,
    ),
  );
  lab.core(1 + rng.nextInt(9), 0);
  lanes.forEach((x, i) => {
    const src = lab.put('bld_extractor', x, 2, 0, 1 + rng.nextInt(3));
    if (i === 0) {
      const rax = lab.put('bld_barracks', x, 6, 0, 1 + rng.nextInt(3));
      lab.link(src, 'north', rax, 'south', [
        [x, 3],
        [x, 4],
        [x, 5],
      ]);
      return;
    }
    const ty = 9 + rng.nextInt(6);
    const turret = lab.put('bld_turret', x, ty, 0, 1 + rng.nextInt(3));
    const cells: [number, number][] = [];
    for (let y = 3; y < ty; y++) cells.push([x, y]);
    lab.link(src, 'north', turret, 'south', cells);
  });
  for (let k = 0; k < 14; k++) {
    try {
      lab.put(
        rng.nextInt(3) === 0 ? 'bld_gate' : 'bld_wall',
        rng.nextInt(12),
        4 + rng.nextInt(11),
        0,
        1 + rng.nextInt(3),
      );
    } catch {
      // The cell was taken; skip.
    }
  }
  return lab.state;
}

describe('property: turrets and gates', () => {
  test(
    'no turret fires outside its owner rows; invariants hold',
    { timeout: 120000 },
    () => {
      let shots = 0;
      let gates = 0;
      let died = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const a = defenseBoard(seed);
        const b = defenseBoard(seed + 40);
        gates += [a, b].reduce(
          (n, t) => n + t.buildings.filter((x) => x.def === 'bld_gate').length,
          0,
        );
        const { sim, ctx, events } = startBattle(
          a,
          b,
          seed % 4,
          content,
          simConfig,
        );
        const { width, height } = ctx.arena.geom;
        for (let k = 0; k < 28; k++) {
          const side = k % 2;
          const x = (k * 5 + seed) % width;
          const y = side === 0 ? 14 + (k % 6) : height - 15 - (k % 6);
          const idx = y * width + x;
          if (!openFor(ctx.arena, side, idx)) continue;
          spawnUnitForTest(sim, ctx, {
            side,
            def: k % 3 === 0 ? 'unit_raider' : 'unit_soldier',
            x,
            y,
          });
        }
        for (let t = 0; t < 400; t++) {
          shots += stepChecked(sim, ctx, events);
          checkTick(sim, ctx);
        }
        died += sim.unitsDied[0] + sim.unitsDied[1];
      }
      expect(shots).toBeGreaterThan(30);
      expect(gates).toBeGreaterThan(3);
      expect(died).toBeGreaterThan(10);
    },
  );
});

describe('property: random battles', () => {
  test('invariants hold every tick', { timeout: 120000 }, () => {
    let spawned = 0;
    let destroyed = 0;
    let died = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const a = randomNetwork(seed, { core: true });
      const b = randomNetwork(seed + 3, { core: true });
      const { sim, ctx, events } = startBattle(
        a,
        b,
        seed % 4,
        content,
        simConfig,
      );
      // Extra units so that fights start early.
      const { width, height } = ctx.arena.geom;
      for (let k = 0; k < 24; k++) {
        const side = k % 2;
        const x = (k * 5 + seed) % width;
        const y = side === 0 ? 8 + (k % 8) : height - 9 - (k % 8);
        const idx = y * width + x;
        if (
          ctx.arena.blocked[idx] === 1 ||
          (ctx.arena.occupant[idx] ?? -1) >= 0
        )
          continue;
        spawnUnitForTest(sim, ctx, {
          side,
          def: k % 3 === 0 ? 'unit_raider' : 'unit_soldier',
          x,
          y,
        });
      }
      for (let t = 0; t < 300; t++) {
        stepChecked(sim, ctx, events);
        checkTick(sim, ctx);
      }
      spawned += sim.spawned[0] + sim.spawned[1];
      died += sim.unitsDied[0] + sim.unitsDied[1];
      destroyed += sim.health.filter((h) => h.hp === 0).length;
    }
    expect(spawned).toBeGreaterThan(200);
    expect(died).toBeGreaterThan(20);
    expect(destroyed).toBeGreaterThan(3);
  });
});
