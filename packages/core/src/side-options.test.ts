import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  createArenaSim,
  spawnUnitForTest,
  stepArena,
  type ArenaEvent,
  type SideOptions,
} from './arena-sim.js';
import { Lab, board, content, got, simConfig } from './test-support.js';
import type { TeamState } from './team-state.js';

/** Arena rows for 16 + 7 + 16 with a 24 wide board. */
const W = 24;
const GAP = 7;

function empty(): TeamState {
  const lab = new Lab(board([]));
  lab.core(11, 0);
  return lab.state;
}

function start(
  teamB: TeamState,
  options: SideOptions,
): {
  sim: ReturnType<typeof createArenaSim>;
  ctx: ReturnType<typeof createArenaContext>;
  events: ArenaEvent[];
} {
  const sim = createArenaSim(empty(), teamB, GAP, content, simConfig, {
    sideOptions: [null, options],
  });
  const events: ArenaEvent[] = [];
  const ctx = createArenaContext(sim, content, simConfig, { events });
  return { sim, ctx, events };
}

function spawns(events: readonly ArenaEvent[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const e of events) {
    if (e.type === 'unit_spawned') out.push({ x: e.x, y: e.y });
  }
  return out;
}

describe('side options: scheduled waves', () => {
  test('units arrive on the front row at the wave tick, evenly across the width', () => {
    const { sim, ctx, events } = start(empty(), {
      scheduledWaves: [{ tick: 3, unit: 'unit_soldier', count: 4 }],
    });
    for (let t = 0; t < 3; t++) stepArena(sim, ctx);
    expect(sim.units).toHaveLength(0);
    stepArena(sim, ctx);
    expect(sim.units).toHaveLength(4);
    // Side 1's front row is arena row 16 + GAP; own-frame columns 3, 9, 15, 21.
    const ys = spawns(events).map((s) => s.y);
    expect(ys).toEqual([23, 23, 23, 23]);
    const own = spawns(events).map((s) => W - 1 - s.x);
    expect(own).toEqual([3, 9, 15, 21]);
    expect(
      events
        .filter((e) => e.type === 'unit_spawned')
        .every((e) => e.building === 0),
    ).toBe(true);
    expect(sim.spawned).toEqual([0, 4]);
  });

  test('the start column moves with the wave index', () => {
    const { sim, ctx, events } = start(empty(), {
      scheduledWaves: [
        { tick: 1, unit: 'unit_soldier', count: 1 },
        { tick: 2, unit: 'unit_soldier', count: 1 },
      ],
    });
    for (let t = 0; t < 3; t++) stepArena(sim, ctx);
    const own = spawns(events).map((s) => W - 1 - s.x);
    // floor(24 / 2) = 12, then + 7.
    expect(own).toEqual([12, 19]);
  });

  test('a blocked column is replaced by the nearest open front-row cell', () => {
    const lab = new Lab(board([]));
    lab.core(11, 0);
    // Walls on the front row (board y = 15) of side 1, own-frame columns 12, 11, 13.
    for (const x of [11, 12, 13]) lab.put('bld_wall', x, 15);
    const { sim, ctx, events } = start(lab.state, {
      scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 1 }],
    });
    stepArena(sim, ctx);
    const only = got(spawns(events)[0]);
    // Wanted 12 (blocked); 11 and 13 are blocked too; distance 2: lower x first.
    expect(W - 1 - only.x).toBe(10);
    // The spawn cell is open for side 1.
    expect(ctx.arena.blocked[only.y * W + only.x]).toBe(0);
    expect(ctx.arena.occupant[only.y * W + only.x]).toBe(-1);
  });

  test('a wave of a fully blocked row spawns nothing', () => {
    const lab = new Lab(board([]));
    lab.core(11, 0);
    for (let x = 0; x < W; x++) lab.put('bld_wall', x, 15);
    const { sim, ctx } = start(lab.state, {
      scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 3 }],
    });
    stepArena(sim, ctx);
    expect(sim.units).toHaveLength(0);
  });
});

describe('side options: strength, free power, Core health', () => {
  test('unitStrengthPercent scales health and damage of spawned units', () => {
    const { sim, ctx } = start(empty(), {
      scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 1 }],
      unitStrengthPercent: 150,
    });
    stepArena(sim, ctx);
    const u = got(sim.units[0]);
    // Soldier: 40 health, 6 damage; +150 percent.
    expect(u.hp).toBe(100);
    expect(u.damage).toBe(15);
  });

  test('the Core health override applies to that side only', () => {
    const { sim } = start(empty(), { coreHealth: 77 });
    const core = (side: number) =>
      sim.health.find((h) => h.side === side && h.building === 0)?.hp;
    expect(core(0)).toBe(500);
    expect(core(1)).toBe(77);
  });

  test('without options the state has no sideOptions field', () => {
    const sim = createArenaSim(empty(), empty(), GAP, content, simConfig);
    expect('sideOptions' in sim).toBe(false);
  });

  test('turrets fire with no flow, and only at units on their own board', () => {
    const lab = new Lab(board([]));
    lab.core(11, 0);
    lab.put('bld_turret', 5, 15); // front row of side 1
    const run = (free: boolean, unitY: number): number => {
      const { sim, ctx, events } = start(
        lab.state,
        free ? { freePower: true } : {},
      );
      expect(sim.boards[1].sources).toHaveLength(0);
      // The turret is at arena (18, 23); put a side 0 unit at row unitY.
      spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_soldier',
        x: 18,
        y: unitY,
      });
      stepArena(sim, ctx);
      return events.filter((e) => e.type === 'turret_fired').length;
    };
    expect(run(true, 24)).toBe(1); // on the turret's board, distance 1
    expect(run(true, 22)).toBe(0); // in the gap, distance 1: not its board
    expect(run(false, 24)).toBe(0); // unpowered
  });
});
