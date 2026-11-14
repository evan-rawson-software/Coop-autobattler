import { renderArenaAscii } from './ascii-render.js';
import { describe, expect, test } from 'vitest';
import {
  createArena,
  toArena,
  toBoard,
  type Arena,
  type ArenaContent,
} from './arena.js';
import { computeBreach, openFor } from './arena-paths.js';
import {
  createArenaContext,
  createArenaSim,
  runArena,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import { buildingDist2, fits } from './geometry.js';
import { cloneBoardSim, flowTotals } from './flow-sim.js';
import { withModifier, type TeamModifier } from './modifiers.js';
import { hashJson } from './hash.js';
import { Rng } from './rng.js';
import { CELL_UNITS, MAX_HEALTH, MAX_TICK_DAMAGE } from './limits.js';
import { loadUnitsOrThrow, maxStrengthPercent } from './units.js';
import type { Cell, GameMap } from './map.js';
import type { TeamState } from './team-state.js';
import {
  Lab,
  bigBoard,
  groundViolations,
  cellOfUnit,
  content,
  got,
  healthEntry,
  mid,
  randomNetwork,
  simConfig,
  walk,
  TIMING,
} from './testing/support.js';

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

const CU = CELL_UNITS;

function ofType<T extends ArenaEvent['type']>(
  events: readonly ArenaEvent[],
  type: T,
): Extract<ArenaEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<ArenaEvent, { type: T }> => e.type === type,
  );
}

function healthOf(sim: ArenaSim, side: number, building: number): number {
  const h = healthEntry(sim, side, building);
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
    const core1 = got(arena.buildings[got(arena.coreRef[1]?.[0])]);
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
    const w1 = lab.put('bld_wall_block', 5, 5, 0, 1);
    const w3 = lab.put('bld_wall_block', 6, 5, 0, 3);
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
    const { sim, ctx, events } = startArenaBattle(
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
    const core1 = got(ctx.arena.buildings[got(ctx.arena.coreRef[1]?.[0])]);
    const dist = bfs(ctx.arena, core1.cells);
    const expected = got(dist[start.y * 12 + start.x]);
    expect(expected).toBeGreaterThan(25); // the straight way is 21
    const path = walk(sim, ctx, u, 6 * expected + 60);
    // The circle cuts corners, so it needs at most the cells of the shortest
    // path (and, being a 4-neighbour route, not many fewer).
    expect(path.length - 1).toBeLessThanOrEqual(expected);
    expect(path.length - 1).toBeGreaterThan(expected - 6);
    // Every cell it stood in is open ground, and the field only gets closer.
    let prev = got(dist[start.y * 12 + start.x]);
    for (const c of path.slice(1)) {
      expect(ctx.arena.blocked[c.y * 12 + c.x]).toBe(0);
      expect(ctx.arena.occupant[c.y * 12 + c.x]).toBe(-1);
      const d = got(dist[c.y * 12 + c.x]);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
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

  test('a unit walks at its speed: a cell in moveCooldownTicks ticks, from tick 0', () => {
    const { sim, ctx } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 16,
    });
    // Soldier: 6 ticks per cell = 40 sub-cell units per tick, along the
    // direction of the field step (it may be diagonal), from the first tick.
    for (let t = 1; t <= 6; t++) {
      const x0 = u.px;
      const y0 = u.py;
      stepArena(sim, ctx);
      const d2 = (u.px - x0) ** 2 + (u.py - y0) ** 2;
      // A step is the speed rounded down on each axis: 39 or 40 long.
      expect(d2).toBeLessThanOrEqual(40 * 40);
      expect(d2).toBeGreaterThanOrEqual(39 * 39);
    }
    const r = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_raider',
      x: 9,
      y: 16,
    });
    const rx = r.px;
    const ry = r.py;
    stepArena(sim, ctx);
    // Raider: 4 ticks per cell = 60 per tick.
    const rd2 = (r.px - rx) ** 2 + (r.py - ry) ** 2;
    expect(rd2).toBeLessThanOrEqual(60 * 60);
    expect(rd2).toBeGreaterThanOrEqual(59 * 59);
  });

  test('a unit steers by the direction of the step and keeps its lateral offset', () => {
    const { sim, ctx } = startArenaBattle(
      coreOnly(5, 0),
      coreOnly(5, 0),
      GAP,
      content,
      { ...simConfig, aggroRangeCells: 0 },
    );
    // Side 0's Core is at the bottom; the enemy Core is straight ahead (same
    // columns), so the step is straight up and a unit near the left edge of
    // its cell stays there instead of drifting to the centre line.
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 16,
    });
    a.px = 5 * CU + 60;
    const x0 = a.px;
    const y0 = a.py;
    runArena(sim, ctx, 6);
    expect(a.px).toBe(x0);
    expect(a.py).toBe(y0 + 6 * 40);
  });

  test('ties between equal paths go forward, then to the lowest x of the mover', () => {
    const { sim, ctx } = startArenaBattle(
      coreOnly(8, 0),
      coreOnly(8, 0),
      GAP,
      content,
      { ...simConfig, aggroRangeCells: 0 },
    );
    // Both units have the same cost to the enemy Core going forward (and
    // diagonally) or sideways; the mirror image of a side 0 unit is the side 1
    // unit at the rotated position, and the rule is the same in its own frame.
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 16,
    });
    const b = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 12 - 1 - 5,
      y: H - 1 - 16,
    });
    runArena(sim, ctx, 6);
    expect(a.py).toBeGreaterThan(mid(16));
    expect(b.px).toBe(12 * CU - a.px);
    expect(b.py).toBe(H * CU - a.py);
  });

  test('conduits never block movement or change paths', () => {
    function build(withConduit: boolean): TeamState {
      const lab = new Lab(tiny([[1, 3, 'res_b']]));
      lab.core(5, 0);
      const src = lab.put('bld_extractor', 1, 3);
      const end = lab.put('bld_splitter', 10, 15);
      if (withConduit) {
        const cells: [number, number][] = [];
        for (let y = 4; y <= 14; y++) cells.push([1, y]);
        for (let x = 2; x <= 10; x++) cells.push([x, 14]);
        lab.link(src, 'north', end, 'south', cells);
      }
      return lab.state;
    }
    const run = (withConduit: boolean) => {
      const b = startArenaBattle(
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
      const trace: number[][] = [];
      const visited = new Set<string>();
      for (let t = 0; t < 900; t++) {
        stepArena(b.sim, b.ctx);
        for (const u of b.sim.units) {
          // No unit ever stands in a building or on blocked ground.
          expect(fits(b.ctx.world, u.side, 47, u.px, u.py)).toBe(true);
          trace.push([t, u.id, u.px, u.py, u.hp]);
          const c = cellOfUnit(u);
          visited.add(`${String(c.x)},${String(c.y)}`);
        }
      }
      return { b, trace, visited };
    };
    const plain = run(false);
    const wired = run(true);
    const strip = (e: ArenaEvent[]): ArenaEvent[] =>
      e.filter((x) => x.type === 'unit_attacked' || x.type === 'unit_died');
    expect(wired.trace).toEqual(plain.trace);
    expect(strip(wired.b.events)).toEqual(strip(plain.b.events));
    expect(strip(wired.b.events).length).toBeGreaterThan(20);
    // Units really walked over conduit cells (board y = 14 is arena y = 21).
    const onConduit = [...wired.visited].filter((k) => {
      const [x, y] = k.split(',').map(Number);
      return y === 21 && (x ?? -1) >= 1 && (x ?? 99) <= 10;
    });
    expect(onConduit.length).toBeGreaterThan(0);
    // The conduits are not targets: attacks only name units, buildings, Cores.
    const ids = new Set(wired.b.sim.teams[1].buildings.map((b) => b.id));
    for (const e of ofType(wired.b.events, 'unit_attacked')) {
      if (e.target.kind === 'building')
        expect(ids.has(e.target.building)).toBe(true);
    }
    expect(wired.b.sim.teams[1].conduits).toHaveLength(1);
  });
});

describe('combat', () => {
  test('enemies in contact hit each other simultaneously', () => {
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    // Soldiers: radius 72 each and reach 60, so circles 204 apart (a gap of
    // 60) are in contact.
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: mid(5),
      py: mid(16),
    });
    const b = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: mid(5),
      py: mid(16) + 204,
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
    expect([a.px, a.py]).toEqual([mid(5), mid(16)]);
    expect([b.px, b.py]).toEqual([mid(5), mid(16) + 204]);
  });

  test('contact is edge to edge: one unit more than reach apart closes in first', () => {
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: mid(5),
      py: mid(16),
    });
    // 205 apart: a gap of 61, one more than the reach of 60.
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: mid(5),
      py: mid(16) + 205,
    });
    runArena(sim, ctx, 1);
    expect(ofType(events, 'unit_attacked')).toHaveLength(0);
    runArena(sim, ctx, 1);
    expect(ofType(events, 'unit_attacked').length).toBeGreaterThan(0);
  });

  test('contact on a diagonal is measured by the Euclidean distance', () => {
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    // (144, 144) apart: distance 203.6 <= 204, in contact on a diagonal; a
    // Chebyshev or Manhattan rule would disagree.
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: mid(5),
      py: mid(16),
    });
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: mid(5) + 144,
      py: mid(16) + 144,
    });
    runArena(sim, ctx, 1);
    expect(ofType(events, 'unit_attacked')).toHaveLength(2);
    const {
      sim: s2,
      ctx: c2,
      events: e2,
    } = startArenaBattle(coreOnly(), coreOnly(), GAP, content, simConfig);
    // (145, 145): 205.06 > 204, not yet in contact.
    spawnUnitForTest(s2, c2, {
      side: 0,
      def: 'unit_soldier',
      px: mid(5),
      py: mid(16),
    });
    spawnUnitForTest(s2, c2, {
      side: 1,
      def: 'unit_soldier',
      px: mid(5) + 145,
      py: mid(16) + 145,
    });
    runArena(s2, c2, 1);
    expect(ofType(e2, 'unit_attacked')).toHaveLength(0);
  });

  test('a unit attacks the nearest enemy; ties go to the lowest ID', () => {
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const x = mid(5);
    const y = mid(17);
    // Three enemies at the same distance 200 (IDs 1, 2, 3).
    const e1 = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: x,
      py: y + 200,
    });
    const e2 = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: x + 200,
      py: y,
    });
    const e3 = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: x - 200,
      py: y,
    });
    const me = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: x,
      py: y,
    });
    runArena(sim, ctx, 1);
    expect([e1.id, e2.id, e3.id, me.id]).toEqual([1, 2, 3, 4]);
    const mine = ofType(events, 'unit_attacked').find((e) => e.unit === me.id);
    expect(mine?.target).toEqual({ kind: 'unit', unit: 1 });
    // A closer enemy with a higher ID is preferred to a lower ID further away.
    const b = startArenaBattle(coreOnly(), coreOnly(), GAP, content, simConfig);
    const far = spawnUnitForTest(b.sim, b.ctx, {
      side: 1,
      def: 'unit_soldier',
      px: x,
      py: y + 200,
    });
    const near = spawnUnitForTest(b.sim, b.ctx, {
      side: 1,
      def: 'unit_soldier',
      px: x + 190,
      py: y,
    });
    const me2 = spawnUnitForTest(b.sim, b.ctx, {
      side: 0,
      def: 'unit_soldier',
      px: x,
      py: y,
    });
    runArena(b.sim, b.ctx, 1);
    expect(far.id).toBeLessThan(near.id);
    expect(
      ofType(b.events, 'unit_attacked').find((e) => e.unit === me2.id)?.target,
    ).toEqual({ kind: 'unit', unit: near.id });
  });

  test('two equal groups meeting annihilate each other symmetrically', () => {
    // An odd width gives a centre column, so mirrored units face each other.
    const odd = { ...tiny(), width: 11, plotWidth: 11 };
    const { sim, ctx, events } = startArenaBattle(
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
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: mid(5),
      py: mid(16),
    });
    // A raider of the other side with plenty of health, in contact.
    const r = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_raider',
      px: mid(5),
      py: mid(16) + 192,
    });
    r.hp = 1000;
    a.hp = 1000;
    for (let t = 0; t < 12; t++) {
      stepArena(sim, ctx);
      expect([a.px, a.py]).toEqual([mid(5), mid(16)]);
      expect([r.px, r.py]).toEqual([mid(5), mid(16) + 192]);
    }
    const mine = ofType(events, 'unit_attacked').filter((e) => e.unit === a.id);
    expect(mine.map((h) => h.tick)).toEqual([0, 10]);
    const theirs = ofType(events, 'unit_attacked').filter(
      (e) => e.unit === r.id,
    );
    expect(theirs.map((h) => h.tick)).toEqual([0, 8]);
  });
});

describe('targeting (#66: every unit heads for the Core)', () => {
  test('a raider walks past sources, splitters and walls to the Core', () => {
    const lab = new Lab(tiny([[8, 5, 'res_a']]));
    lab.core(5, 0);
    const wall = lab.put('bld_wall_block', 6, 14);
    const src = lab.put('bld_extractor', 8, 5);
    const sp = lab.put('bld_splitter', 3, 5);
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    for (const x of [6, 8]) {
      spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_raider', x, y: 16 });
    }
    const before = [wall, src, sp].map((b) => healthOf(sim, 1, b));
    runArena(sim, ctx, 700);
    const targets = ofType(events, 'unit_attacked').map((e) => e.target);
    // No building but the Core is ever attacked: there is an open way.
    expect(targets.filter((t) => t.kind === 'building')).toEqual([]);
    expect(targets.some((t) => t.kind === 'core')).toBe(true);
    expect([wall, src, sp].map((b) => healthOf(sim, 1, b))).toEqual(before);
    expect(healthOf(sim, 1, 0)).toBeLessThan(500);
    expect(ofType(events, 'building_destroyed')).toEqual([]);
  });

  test('the loader rejects the removed targeting and rangeCells fields', () => {
    const base = {
      id: 'unit_x',
      health: 10,
      damage: 1,
      attackCooldownTicks: 5,
      moveCooldownTicks: 2,
      radius: 70,
      collisionRadius: 70,
      reach: 60,
      flying: false,
      attackType: 'melee',
    };
    expect(() => loadUnitsOrThrow({ units: [base] })).not.toThrow();
    expect(() =>
      loadUnitsOrThrow({ units: [{ ...base, targeting: 'core' }] }),
    ).toThrow(/targeting/);
    expect(() =>
      loadUnitsOrThrow({ units: [{ ...base, rangeCells: 0 }] }),
    ).toThrow(/rangeCells/);
  });

  test('reach is edge to edge, to the nearest point of a building', () => {
    const custom: ArenaContent = {
      ...content,
      units: loadUnitsOrThrow({
        units: [
          {
            id: 'unit_longarm',
            health: 10,
            damage: 2,
            attackCooldownTicks: 5,
            moveCooldownTicks: 2,
            radius: 72,
            collisionRadius: 72,
            reach: 480,
            flying: false,
            attackType: 'melee',
          },
        ],
      }),
    };
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      custom,
      simConfig,
    );
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_longarm',
      x: 5,
      y: 20,
    });
    const core = got(ctx.arena.buildings[got(ctx.arena.coreRef[1]?.[0])]);
    runArena(sim, ctx, 40);
    const first = got(ofType(events, 'unit_attacked')[0]);
    expect(first.target).toEqual({ kind: 'core', side: 1, core: 0 });
    // It stopped as soon as the gap to the Core was at most 480: the squared
    // distance to the nearest cell is within (480 + 72)^2 and, because it
    // walks 120 per tick, more than 120 closer-than-that is not needed.
    const d2 = buildingDist2(u.px, u.py, core);
    expect(d2).toBeLessThanOrEqual((480 + 72) ** 2);
    expect(d2).toBeGreaterThan((480 + 72 - 120) ** 2);
  });

  test('with nothing left to attack, units wait', () => {
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const h = sim.health.find(
      (x) => x.side === 1 && 'core' in x && x.core === 0,
    );
    got(h).hp = 0;
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 16,
    });
    const b = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_raider',
      x: 8,
      y: 16,
    });
    // Tick 0 still decides with the Core standing (it falls in step 6).
    runArena(sim, ctx, 1);
    const at = [a.px, a.py, b.px, b.py];
    runArena(sim, ctx, 49);
    expect(ofType(events, 'core_destroyed')).toEqual([
      { tick: 0, type: 'core_destroyed', side: 1, core: 0 },
    ]);
    expect([a.px, a.py, b.px, b.py]).toEqual(at);
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
      lab.put('bld_wall_block', x, y, 0, 3);
    }
    const weak = lab.put('bld_wall_block', 5, 2, 0, 1);
    const strong = lab.put('bld_wall_block', 6, 2, 0, 3);
    return { lab, weak, strong };
  }

  test('units break through the weakest point and then reach the Core', () => {
    const { lab, weak, strong } = sealed();
    const { sim, ctx, events } = startArenaBattle(
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
    const { sim, ctx } = startArenaBattle(
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
    runArena(sim, ctx, 30);
    // It sidestepped towards the weak wall (arena (6, 33)) and attacked it.
    expect(cellOfUnit(u).x).toBe(6);
    expect(healthOf(sim, 1, weak)).toBeLessThan(100);
  });
});

describe('breach step prices a building by its maximum health (CB-20)', () => {
  test('a damaged neighbour is not preferred over an equal healthy one', () => {
    // Core at board (5, 0) ringed by six tier 3 walls; the soldier stands on
    // the corner cell (7, 2) beside walls A (6, 2) and B (7, 1). Both have
    // the same maximum health, so the tie key decides: B is further forward
    // for the attacker (the higher arena y). A has 20 of 240 health, and the
    // test swaps nothing: a step priced by current health would go for A.
    const lab = new Lab(tiny());
    lab.core(5, 0);
    const ids = new Map<string, number>();
    for (const [x, y] of [
      [4, 0],
      [4, 1],
      [5, 2],
      [6, 2],
      [7, 1],
      [7, 0],
    ] as const) {
      ids.set(
        `${String(x)},${String(y)}`,
        lab.put('bld_wall_block', x, y, 0, 3),
      );
    }
    const a = got(ids.get('7,1'));
    const b = got(ids.get('6,2'));
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    got(
      sim.health.find(
        (h) => h.side === 1 && 'building' in h && h.building === b,
      ),
    ).hp = 20;
    const at = arenaCell(1, 7, 2);
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: at.x,
      y: at.y,
    });
    runArena(sim, ctx, 60);
    const targets = ofType(events, 'unit_attacked').map((e) => e.target);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t).toEqual({ kind: 'building', side: 1, building: a });
    }
    expect(healthOf(sim, 1, b)).toBe(20);
    expect(healthOf(sim, 1, a)).toBeLessThan(240);
  });
});

describe('breach field is a pure function of the saved state (CB-20)', () => {
  /** Side 1's Core ringed by eight tier 1 walls (every Core edge cell). */
  function ringed(): TeamState {
    const lab = new Lab(tiny());
    lab.core(5, 3);
    for (const [x, y] of [
      [5, 2],
      [6, 2],
      [5, 5],
      [6, 5],
      [4, 3],
      [4, 4],
      [7, 3],
      [7, 4],
    ] as const) {
      lab.put('bld_wall_block', x, y, 0, 1);
    }
    return lab.state;
  }

  function start(): ReturnType<typeof startArenaBattle> {
    const b = startArenaBattle(coreOnly(), ringed(), GAP, content, simConfig);
    spawnUnitForTest(b.sim, b.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 8,
      y: 20,
    });
    spawnUnitForTest(b.sim, b.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 3,
      y: 24,
    });
    return b;
  }

  function restore(sim: ArenaSim): { sim: ArenaSim; ctx: ArenaContext } {
    const copy = JSON.parse(JSON.stringify(sim)) as ArenaSim;
    return { sim: copy, ctx: createArenaContext(copy, content, simConfig) };
  }

  function wallHealth(sim: ArenaSim): number[] {
    return sim.health
      .filter((h) => h.side === 1 && 'building' in h)
      .map((h) => h.hp);
  }

  const TOTAL = 400;

  test('restoring at any tick continues exactly like a straight run', () => {
    // Reference run: every tick's hash, and when a wall first takes damage
    // and first falls.
    const ref = start();
    const hashes: string[] = [hashJson(ref.sim)];
    let damaged = -1;
    let fallen = -1;
    const full = wallHealth(ref.sim);
    for (let t = 0; t < TOTAL; t++) {
      stepArena(ref.sim, ref.ctx);
      hashes.push(hashJson(ref.sim));
      const hp = wallHealth(ref.sim);
      if (damaged < 0 && hp.some((v, i) => v < (full[i] ?? 0))) damaged = t + 1;
      if (fallen < 0 && hp.some((v) => v <= 0)) fallen = t + 1;
    }
    expect(damaged).toBeGreaterThan(0);
    expect(fallen).toBeGreaterThan(damaged);
    const ticks = new Set([
      0,
      1,
      2,
      10,
      50,
      95,
      damaged - 1,
      damaged,
      damaged + 1,
      fallen - 1,
      fallen,
      fallen + 1,
    ]);
    for (const at of [...ticks].sort((a, b) => a - b)) {
      const a = start();
      runArena(a.sim, a.ctx, at);
      const r = restore(a.sim);
      for (let t = at; t < TOTAL; t++) {
        stepArena(r.sim, r.ctx);
        expect(
          hashJson(r.sim),
          `restored at ${String(at)}, tick ${String(t + 1)}`,
        ).toBe(hashes[t + 1]);
      }
    }
  });

  test('a wall is damaged but still standing for a while (the scenario exercises the rule)', () => {
    const a = start();
    runArena(a.sim, a.ctx, TOTAL);
    expect(wallHealth(a.sim).some((v) => v > 0 && v < 100)).toBe(true);
  });
});

describe('maximum health includes run modifiers (breach cost and start agree)', () => {
  const stoutWalls: TeamModifier = {
    id: 'mod_test_walls',
    effects: [
      { kind: 'building_health_percent', target: 'wall', percent: 150 },
    ],
  };
  const hardCore: TeamModifier = {
    id: 'mod_test_core',
    effects: [{ kind: 'core_health_percent', percent: 50 }],
  };
  const drilled: TeamModifier = {
    id: 'mod_test_drill',
    effects: [{ kind: 'unit_strength_percent', percent: 25 }],
  };

  function ringedTeam(): TeamState {
    const lab = new Lab(tiny());
    lab.core(5, 3);
    for (const [x, y] of [
      [5, 2],
      [6, 2],
      [5, 5],
      [6, 5],
      [4, 3],
      [4, 4],
      [7, 3],
      [7, 4],
    ] as const) {
      lab.put('bld_wall_block', x, y, 0, 1);
    }
    return lab.state;
  }

  function modified(): { a: TeamState; b: TeamState } {
    return {
      a: withModifier(withModifier(coreOnly(), hardCore), drilled),
      b: withModifier(withModifier(ringedTeam(), stoutWalls), hardCore),
    };
  }

  function begin(a: TeamState, b: TeamState) {
    const r = startArenaBattle(a, b, GAP, content, simConfig, {
      sideOptions: [{}, { coreHealths: [500] }],
    });
    spawnUnitForTest(r.sim, r.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 8,
      y: 20,
    });
    spawnUnitForTest(r.sim, r.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 3,
      y: 24,
    });
    return r;
  }

  test('starting health and breach cost use the same modified maximum', () => {
    const plain = begin(coreOnly(), ringedTeam());
    const { a, b } = modified();
    const mod = begin(a, b);
    let walls = 0;
    for (const bld of mod.ctx.arena.buildings) {
      const h =
        bld.kind === 'core'
          ? healthEntry(mod.sim, bld.side, 0, bld.player)
          : healthEntry(mod.sim, bld.side, bld.id);
      // At tick 0 a building is at full health, which is its maximum.
      expect(h?.hp).toBe(mod.ctx.maxHealth[bld.ref]);
      if (bld.side === 1 && bld.kind === 'core') {
        // Override 500, then +50 percent.
        expect(h?.hp).toBe(750);
      }
      if (bld.side === 1 && bld.defenseType === 'wall') {
        walls += 1;
        const base = plain.ctx.maxHealth[bld.ref] ?? 0;
        expect(base).toBeGreaterThan(0);
        expect(h?.hp).toBe(Math.floor((base * 250) / 100));
      }
    }
    expect(walls).toBe(8);
    // The breach field the units steer by is built from that maximum.
    const per = simConfig.breachHealthPerCost;
    const baseCost = simConfig.breachBaseCost;
    const expected = computeBreach(
      mod.ctx.arena,
      0,
      0,
      (ref) => mod.sim.health[mod.ctx.healthIndex[ref] ?? 0]?.hp ?? 0,
      baseCost,
      per,
    );
    const plainField = computeBreach(
      plain.ctx.arena,
      0,
      0,
      (ref) => plain.ctx.maxHealth[ref] ?? 0,
      baseCost,
      per,
    );
    const actual = computeBreach(
      mod.ctx.arena,
      0,
      0,
      (ref) => mod.ctx.maxHealth[ref] ?? 0,
      baseCost,
      per,
    );
    expect(Array.from(actual)).toEqual(Array.from(expected));
    expect(Math.max(...actual)).toBeGreaterThan(Math.max(...plainField));
    stepArena(mod.sim, mod.ctx);
    const field = got(mod.ctx.breach[0]?.[0]);
    expect(Array.from(field)).toEqual(Array.from(expected));
  });

  test('restoring at any tick continues exactly, modifiers on both sides', () => {
    const run = () => {
      const { a, b } = modified();
      return begin(a, b);
    };
    const total = 300;
    const ref = run();
    const hashes: string[] = [hashJson(ref.sim)];
    for (let t = 0; t < total; t++) {
      stepArena(ref.sim, ref.ctx);
      hashes.push(hashJson(ref.sim));
    }
    for (const at of [0, 1, 2, 10, 50, 95, 150, 299]) {
      const x = run();
      runArena(x.sim, x.ctx, at);
      const copy = JSON.parse(JSON.stringify(x.sim)) as ArenaSim;
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

  test('modified values past the content bounds fail at setup with a RangeError', () => {
    const core = withModifier(coreOnly(), {
      id: 'mod_test_big',
      effects: [{ kind: 'core_health_percent', percent: 100 }],
    });
    const half = MAX_HEALTH / 2;
    expect(() =>
      createArenaSim(core, coreOnly(), GAP, content, simConfig, {
        sideOptions: [{ coreHealths: [half + 1000] }, {}],
      }),
    ).toThrow(/maximum health 1000000002000 with modifiers exceeds/);
    // Fine without the modifier, and at exactly the cap with it.
    expect(() =>
      createArenaSim(coreOnly(), coreOnly(), GAP, content, simConfig, {
        sideOptions: [{ coreHealths: [half + 1000] }, {}],
      }),
    ).not.toThrow();
    expect(() =>
      createArenaSim(core, coreOnly(), GAP, content, simConfig, {
        sideOptions: [{ coreHealths: [half] }, {}],
      }),
    ).not.toThrow();
    // Unit strength: base option plus modifier must keep every unit in bounds.
    const limit = content.units
      .list()
      .reduce((m, d) => Math.min(m, maxStrengthPercent(d)), Infinity);
    const edge = withModifier(coreOnly(), {
      id: 'mod_test_str',
      effects: [{ kind: 'unit_strength_percent', percent: 2 }],
    });
    expect(() =>
      createArenaSim(edge, coreOnly(), GAP, content, simConfig, {
        sideOptions: [{ unitStrengthPercent: limit - 2 }, {}],
      }),
    ).not.toThrow();
    expect(() =>
      createArenaSim(edge, coreOnly(), GAP, content, simConfig, {
        sideOptions: [{ unitStrengthPercent: limit - 1 }, {}],
      }),
    ).toThrow(RangeError);
  });

  test('a turret-damage percent too large to scale exactly fails at setup with a named RangeError (#69)', () => {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    lab.put('bld_turret', 10, 15);
    const withPercent = (percent: number): TeamState =>
      withModifier(lab.state, {
        id: 'mod_test_turret',
        effects: [{ kind: 'turret_damage_percent', percent }],
      });
    const build = (percent: number): unknown =>
      createArenaSim(withPercent(percent), coreOnly(), GAP, content, simConfig);
    // Exact scaling, but past MAX_DAMAGE.
    expect(() => build(1e14)).toThrow(/Turret damage .* exceeds the maximum/);
    // The product with (100 + percent) would not be a safe integer.
    expect(() => build(2e15)).toThrow(
      /Modifier turret_damage_percent: the percent sum 2000000000000000 is too large/,
    );
    expect(() => build(2e15)).toThrow(RangeError);
    expect(() => build(1000)).not.toThrow();
  });

  test('a wall-health modifier changes the breach cost by the modified maximum', () => {
    const per = simConfig.breachHealthPerCost;
    const field = (team: TeamState): number => {
      const r = startArenaBattle(coreOnly(), team, GAP, content, simConfig);
      const f = computeBreach(
        r.ctx.arena,
        0,
        0,
        (ref) => r.ctx.maxHealth[ref] ?? 0,
        simConfig.breachBaseCost,
        per,
      );
      return Math.max(...f);
    };
    const plain = field(ringedTeam());
    const stout = field(withModifier(ringedTeam(), stoutWalls));
    const wall = (hp: number): number =>
      simConfig.breachBaseCost + Math.ceil(hp / per);
    const base = got(content.buildings.get('bld_wall_block')).tiers[0].health;
    expect(stout - plain).toBe(
      wall(Math.floor((base * 250) / 100)) - wall(base),
    );
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
    const { sim, ctx, events } = startArenaBattle(
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
    got(
      sim.health.find(
        (h) => h.side === 1 && 'building' in h && h.building === n.sp,
      ),
    ).hp = 0;
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
    // 20 ticks; the fifth is delivered (and the unit spawned) in tick 101.
    expect(
      ofType(events, 'unit_spawned')
        .filter((e) => e.building === n.b3)
        .map((e) => e.tick),
    ).toEqual([101, 201, 301, 401, 501, 601]);
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
    const { sim, ctx } = startArenaBattle(
      coreOnly(),
      n.lab.state,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 100);
    const produced = flowTotals(got(sim.boards[1])).produced;
    expect(produced).toBeGreaterThan(5);
    got(
      sim.health.find(
        (h) => h.side === 1 && 'building' in h && h.building === n.e1,
      ),
    ).hp = 0;
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
    const a = startArenaBattle(
      coreOnly(),
      n.lab.state,
      GAP,
      content,
      simConfig,
    );
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
    expect(ofType(a.events, 'unit_attacked').length).toBeGreaterThan(0);
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
    // Tier 1 barracks costs 5, the buffer holds 4. Extractor tier 1: one item
    // per 20 ticks, first made in tick 19. Over a 2-cell conduit the k-th item
    // is delivered in tick 19 + 2 + 20 (k - 1); the fifth, in tick 101,
    // completes the first unit in that same tick. Then every 100 ticks.
    const { lab, bar } = farm(1, 2);
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 600);
    const spawns = ofType(events, 'unit_spawned');
    expect(spawns.map((e) => e.tick)).toEqual([101, 201, 301, 401, 501]);
    expect(
      spawns.every(
        (e) => e.building === bar && e.side === 1 && e.def === 'unit_soldier',
      ),
    ).toBe(true);
    expect(sim.spawned).toEqual([0, 5]);
    // 600 ticks: items 1..30 delivered (the 30th in tick 599 is not yet); the
    // leftover progress is what has not made a unit.
    const p = got(sim.producers.find((x) => x.building === bar));
    const delivered = ofType(events, 'delivered').length;
    expect(delivered).toBe(29);
    expect(p.progress + 5 * 5).toBe(delivered);
    expect(sim.boards[1].consumers[0]?.inputs[0]?.count).toBe(0);
  });

  test('a tier 2 barracks (cost 5) over a direct-ish link spawns every 100 ticks', () => {
    const { lab } = farm(2, 1);
    const { sim, ctx, events } = startArenaBattle(
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
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      lab.state,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 125);
    const s = got(ofType(events, 'unit_spawned')[0]);
    // The barracks (side 1's board, cells (2..3, 5..6)) heads for side 0's
    // Core at arena (5..6, 0..1). Board (3, 7) and board (4, 6) have the same
    // field distance; the tie goes to the more forward one (the higher board
    // y), so (3, 7).
    const cell = arenaCell(1, 3, 7);
    // The unit appears at the centre of that cell.
    expect(s).toMatchObject({
      px: mid(cell.x),
      py: mid(cell.y),
      building: bar,
    });
    expect(ctx.arena.occupant[cell.y * 12 + cell.x]).toBe(-1);
  });
});

describe('determinism and symmetry', () => {
  /** With `turrets`, also a powered tier 3 turret at the front edge (x = 10). */
  function farmTeam(turrets = false): TeamState {
    const lab = new Lab(
      tiny([
        [2, 2, 'res_a'],
        [8, 2, 'res_a'],
        ...(turrets ? ([[10, 2, 'res_b']] as [number, number, string][]) : []),
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
    lab.put('bld_wall_block', 4, 12);
    lab.put('bld_wall_block', 7, 12);
    if (turrets) {
      const src = lab.put('bld_extractor', 10, 2, 0, 3);
      const turret = lab.put('bld_turret', 10, 13, 0, 3);
      const cells: [number, number][] = [];
      for (let y = 3; y < 13; y++) cells.push([10, y]);
      lab.link(src, 'north', turret, 'south', cells);
    }
    return lab.state;
  }

  function mirrorKey(sim: ArenaSim, side: number): string[] {
    return sim.units
      .filter((u) => u.side === side)
      .map((u) => {
        const x = side === 0 ? u.px : 12 * CU - u.px;
        const y = side === 0 ? u.py : H * CU - u.py;
        return `${u.def} ${String(x)},${String(y)} hp${String(u.hp)} a${String(u.attackCooldown)}`;
      })
      .sort();
  }

  test('a mirror match stays exactly symmetric for 700 ticks', () => {
    const team = farmTeam();
    const { sim, ctx, events } = startArenaBattle(
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
        sim.health
          .filter((h) => h.side === 0)
          .map((h) => ['building' in h ? h.building : 0, h.hp]),
      ).toEqual(
        sim.health
          .filter((h) => h.side === 1)
          .map((h) => ['building' in h ? h.building : 0, h.hp]),
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

  test('a mirror match stays exactly symmetric while turrets shoot into the gap (PP-13)', () => {
    const team = farmTeam(true);
    const { sim, ctx, events } = startArenaBattle(
      team,
      team,
      GAP,
      content,
      simConfig,
    );
    const { boardHeight, gapRows } = ctx.arena.geom;
    const inGap = [0, 0];
    for (let t = 0; t < 700; t++) {
      const rows = new Map(sim.units.map((u) => [u.id, Math.floor(u.py / CU)]));
      const start = events.length;
      stepArena(sim, ctx);
      for (const e of events.slice(start)) {
        if (e.type !== 'turret_fired') continue;
        const y = got(rows.get(e.unit));
        if (y >= boardHeight && y < boardHeight + gapRows) {
          inGap[e.side === 0 ? 0 : 1] = (inGap[e.side === 0 ? 0 : 1] ?? 0) + 1;
        }
      }
      expect(mirrorKey(sim, 1)).toEqual(mirrorKey(sim, 0));
      expect(hashJson(sim.boards[0])).toBe(hashJson(sim.boards[1]));
      expect(sim.health.filter((h) => h.side === 0).map((h) => h.hp)).toEqual(
        sim.health.filter((h) => h.side === 1).map((h) => h.hp),
      );
    }
    // Shots land in the gap, and the same number for both sides.
    expect(inGap[0]).toBeGreaterThan(0);
    expect(inGap[1]).toBe(inGap[0]);
  });

  test('identical inputs give identical states and events', () => {
    const team = farmTeam();
    const a = startArenaBattle(team, team, GAP, content, simConfig);
    const b = startArenaBattle(team, team, GAP, content, simConfig);
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
    const { sim, ctx } = startArenaBattle(
      lab.state,
      coreOnly(),
      2,
      content,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x: 4, y: 12 });
    // Two circles of different sides with centres in the same cell.
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: 9 * CU + 40,
      py: mid(16),
    });
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: 9 * CU + 190,
      py: mid(16),
    });
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

describe('damage sums beyond 32 bits (int.ts contract)', () => {
  /** A side 1 Core with the given health, and `n` side 0 soldiers beside it. */
  function pile(n: number, damage: number, coreHp: number) {
    const b = startArenaBattle(coreOnly(), coreOnly(), GAP, content, simConfig);
    const at = arenaCell(1, 5, 2);
    for (let k = 0; k < n; k++) {
      const u = spawnUnitForTest(b.sim, b.ctx, {
        side: 0,
        def: 'unit_soldier',
        x: at.x,
        y: at.y,
        allowOverlap: true,
      });
      u.damage = damage;
      u.attackCooldown = 0;
    }
    got(
      b.sim.health.find((h) => h.side === 1 && 'core' in h && h.core === 0),
    ).hp = coreHp;
    return b;
  }

  test('twelve hits of 2e8 on a building sum to 2.4e9 exactly (no wrap)', () => {
    const { sim, ctx } = pile(12, 200_000_000, 1_000_000_000_000);
    stepArena(sim, ctx);
    expect(healthOf(sim, 1, 0)).toBe(1_000_000_000_000 - 12 * 200_000_000);
    expect(ctx.coreRemaining[1]?.[0]).toBe(
      1_000_000_000_000 - 12 * 200_000_000,
    );
  });

  test('twelve hits of 2e8 on a unit sum to 2.4e9 exactly (no wrap)', () => {
    const b = startArenaBattle(coreOnly(), coreOnly(), GAP, content, simConfig);
    const victim = spawnUnitForTest(b.sim, b.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 4,
      y: 18,
    });
    victim.hp = 1_000_000_000_000;
    for (let k = 0; k < 12; k++) {
      const u = spawnUnitForTest(b.sim, b.ctx, {
        side: 0,
        def: 'unit_soldier',
        x: 4,
        y: 18,
        allowOverlap: true,
      });
      u.damage = 200_000_000;
    }
    stepArena(b.sim, b.ctx);
    expect(victim.hp).toBe(1_000_000_000_000 - 12 * 200_000_000);
  });

  test('a per-tick sum past the safe-integer limit saturates, never wraps', () => {
    // 101 hits of 9e13 sum to 9.09e15 > 2^53 - 1 unsaturated; the sum stops
    // at MAX_TICK_DAMAGE, and the Core's overkill is that cap exactly.
    const { sim, ctx } = pile(101, 90_000_000_000_000, 2 ** 52);
    stepArena(sim, ctx);
    expect(healthOf(sim, 1, 0)).toBe(0);
    expect(ctx.coreRemaining[1]?.[0]).toBe(2 ** 52 - MAX_TICK_DAMAGE);
    const more = pile(120, 90_000_000_000_000, 5);
    stepArena(more.sim, more.ctx);
    expect(more.ctx.coreRemaining[1]?.[0]).toBe(5 - MAX_TICK_DAMAGE);
  });

  test('Overload that would push a hit past MAX_HIT fails at setup', () => {
    const a = { state: coreOnly() };
    const wild = { ...simConfig, overloadDamageStepPercent: 2 ** 46 };
    expect(() => createArenaSim(a.state, a.state, GAP, content, wild)).toThrow(
      RangeError,
    );
    const wildCore = { ...simConfig, overloadCoreDamageStep: 2 ** 45 };
    expect(() =>
      createArenaSim(a.state, a.state, GAP, content, wildCore),
    ).toThrow(/Overload Core damage/);
    expect(() =>
      createArenaSim(a.state, a.state, GAP, content, simConfig),
    ).not.toThrow();
  });
});

describe('stress', () => {
  test(
    'several hundred units on a four-plot arena for 1000 ticks',
    { timeout: 60000 },
    () => {
      const team = (() => {
        const state = bigBoard();
        const lab = new Lab(state.map);
        lab.state = state;
        lab.core(40, 6, 1);
        return lab.state;
      })();
      const { sim, ctx } = startArenaBattle(team, team, 8, content, simConfig);
      // 150 units on each side in the open ground between the bases; they meet
      // within the first 30 ticks.
      for (let k = 0; k < 300; k++) {
        const side = k % 2;
        spawnUnitForTest(sim, ctx, {
          side,
          def: k % 3 === 0 ? 'unit_raider' : 'unit_soldier',
          x: (k >> 1) % 96,
          y: (side === 0 ? 17 : 22) + (k >> 1 >= 96 ? 1 : 0),
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
      ).toBeLessThan(60000 * TIMING);
      conserved(sim);
    },
  );
});

/** Per-tick invariants of a battle (shared by the property tests). */
function checkTick(sim: ArenaSim, ctx: ArenaContext): void {
  let prev = 0;
  for (const u of sim.units) {
    expect(u.id).toBeGreaterThan(prev);
    prev = u.id;
    expect(Number.isInteger(u.px) && Number.isInteger(u.py)).toBe(true);
    expect(Number.isInteger(u.hp)).toBe(true);
    expect(u.hp).toBeGreaterThan(0);
  }
  expect(groundViolations(sim, ctx)).toEqual([]);
  for (const h of sim.health) {
    expect(Number.isInteger(h.hp)).toBe(true);
    expect(h.hp).toBeGreaterThanOrEqual(0);
  }
  // No destroyed building is left in a team state or a flow plan.
  for (const side of [0, 1] as const) {
    const alive = new Set(
      sim.health.flatMap((h) =>
        h.side === side && 'building' in h && h.hp > 0 ? [h.building] : [],
      ),
    );
    const team = got(sim.teams[side]);
    expect(team.buildings.map((x) => x.id).sort((p, q) => p - q)).toEqual(
      [...alive].sort((p, q) => p - q),
    );
    const board = got(sim.boards[side]);
    for (const s of board.sources) expect(alive.has(s.building)).toBe(true);
    for (const r of sim.ramps.filter((x) => x.side === side)) {
      expect(alive.has(r.building)).toBe(true);
      expect(Number.isInteger(r.charge) && r.charge >= 0).toBe(true);
      expect(Number.isInteger(r.steps) && r.steps >= 0).toBe(true);
    }
    for (const r of board.routes) expect(alive.has(r.building)).toBe(true);
    for (const c of board.consumers) expect(alive.has(c.building)).toBe(true);
    const conduitIds = team.conduits.map((c) => c.id);
    expect(board.conduits.map((c) => c.id)).toEqual(conduitIds);
    for (const c of team.conduits) {
      expect(alive.has((c.from as { building: number }).building)).toBe(true);
      expect(alive.has((c.to as { building: number }).building)).toBe(true);
    }
  }
  conserved(sim);
}

/**
 * One tick with the turret-fire invariant: every `turret_fired` event of the
 * tick names a unit of the other side that stood, before the tick's moves,
 * inside the arena rows of the turret owner's own board or the gap and within
 * range.
 */
function stepChecked(
  sim: ArenaSim,
  ctx: ArenaContext,
  events: ArenaEvent[],
): number {
  const before = new Map(
    sim.units.map((u) => [u.id, { y: Math.floor(u.py / CU), side: u.side }]),
  );
  const start = events.length;
  const { boardHeight, gapRows } = ctx.arena.geom;
  stepArena(sim, ctx);
  let shots = 0;
  for (const e of events.slice(start)) {
    if (e.type !== 'turret_fired') continue;
    shots += 1;
    const u = got(before.get(e.unit));
    expect(u.side).toBe(1 - e.side);
    // PP-13: owner board rows and gap rows, never the enemy board.
    const lo = e.side === 0 ? 0 : boardHeight;
    expect(u.y).toBeGreaterThanOrEqual(lo);
    expect(u.y).toBeLessThanOrEqual(lo + boardHeight + gapRows - 1);
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
        rng.nextInt(3) === 0 ? 'bld_gate' : 'bld_wall_block',
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
        const { sim, ctx, events } = startArenaBattle(
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
          try {
            spawnUnitForTest(sim, ctx, {
              side,
              def: k % 3 === 0 ? 'unit_raider' : 'unit_soldier',
              x,
              y,
            });
          } catch {
            // That spot is taken by another unit: skip it.
          }
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
    let died = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const a = randomNetwork(seed, { core: true });
      const b = randomNetwork(seed + 3, { core: true });
      const { sim, ctx, events } = startArenaBattle(
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
        try {
          spawnUnitForTest(sim, ctx, {
            side,
            def: k % 3 === 0 ? 'unit_raider' : 'unit_soldier',
            x,
            y,
          });
        } catch {
          // That spot is taken by another unit: skip it.
        }
      }
      for (let t = 0; t < 300; t++) {
        stepChecked(sim, ctx, events);
        checkTick(sim, ctx);
      }
      spawned += sim.spawned[0] + sim.spawned[1];
      died += sim.unitsDied[0] + sim.unitsDied[1];
    }
    expect(spawned).toBeGreaterThan(200);
    expect(died).toBeGreaterThan(20);
  });
});
