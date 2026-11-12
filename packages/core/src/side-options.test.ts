import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  createArenaSim,
  spawnUnitForTest,
  stepArena,
  type ArenaEvent,
  type SideOptions,
} from './arena-sim.js';
import { CELL_UNITS } from './limits.js';
import {
  Lab,
  board,
  groundViolations,
  content,
  got,
  simConfig,
} from './test-support.js';
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

/** The arena cells (of the centres) of the units spawned in the events. */
function spawns(events: readonly ArenaEvent[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const e of events) {
    if (e.type === 'unit_spawned') {
      out.push({
        x: Math.floor(e.px / CELL_UNITS),
        y: Math.floor(e.py / CELL_UNITS),
      });
    }
  }
  return out;
}

describe('side options: scheduled waves', () => {
  test('wave units get no unit_strength ramp bonus, though the side has an Armory (PP-8, issue #175)', () => {
    const lab = new Lab(board([]));
    lab.core(11, 0);
    lab.put('bld_armory', 0, 6, 0, 3);
    const { sim, ctx } = start(lab.state, {
      scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 2 }],
    });
    for (const r of sim.ramps) r.steps = 10;
    stepArena(sim, ctx);
    expect(sim.units).toHaveLength(2);
    const base = got(content.units.get('unit_soldier'));
    expect(sim.units.map((u) => [u.hp, u.damage])).toEqual([
      [base.health, base.damage],
      [base.health, base.damage],
    ]);
    // The same Armory does strengthen a unit made for its owner.
    const owned = spawnUnitForTest(sim, ctx, {
      side: 1,
      owner: 0,
      def: 'unit_soldier',
      x: 3,
      y: 30,
    });
    expect(owned.hp).toBeGreaterThan(base.health);
  });

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

  test('a wave of a fully blocked row waits in the queue, none is dropped', () => {
    const lab = new Lab(board([]));
    lab.core(11, 0);
    for (let x = 0; x < W; x++) lab.put('bld_wall', x, 15);
    const { sim, ctx } = start(lab.state, {
      scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 3 }],
    });
    for (let t = 0; t < 5; t++) stepArena(sim, ctx);
    expect(sim.units).toHaveLength(0);
    expect(sim.entering).toHaveLength(3);
    expect(sim.spawned).toEqual([0, 0]);
  });

  test('units that do not fit wait and enter on later ticks in queue order; none is dropped', () => {
    // 1200 soldiers want the 24 columns of one row: a cell holds nine circles
    // (collision radius 47, positions 73 apart), so the rest enter as the
    // front clears.
    const count = 1200;
    const { sim, ctx, events } = start(empty(), {
      scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count }],
    });
    // A Core that does not fall keeps the units busy (queueing in front of it).
    got(
      sim.health.find((h) => h.side === 0 && 'core' in h && h.core === 0),
    ).hp = 10 ** 12;
    const wanted: number[] = [];
    for (let i = 0; i < count; i++) {
      wanted.push(Math.floor(((2 * i + 1) * W) / (2 * count)));
    }
    stepArena(sim, ctx);
    const first = sim.units.length;
    expect(first).toBeGreaterThan(10);
    expect(first).toBeLessThan(count);
    expect(sim.entering).toHaveLength(count - first);
    // The waiting entries keep their order: a subsequence of the wanted list.
    const waiting = sim.entering.map((e) => e.col);
    let at = 0;
    for (const c of wanted) if (waiting[at] === c) at += 1;
    expect(at).toBe(waiting.length);
    for (let t = 0; t < 600 && sim.entering.length > 0; t++) {
      stepArena(sim, ctx);
      expect(groundViolations(sim, ctx)).toEqual([]);
    }
    expect(sim.entering).toHaveLength(0);
    expect(sim.spawned).toEqual([0, count]);
    expect(spawns(events)).toHaveLength(count);
  });

  test('the state with a waiting queue can be saved and restored mid-battle', () => {
    const run = (restoreAt: number): string => {
      const { sim, ctx } = start(empty(), {
        scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 80 }],
      });
      got(
        sim.health.find((h) => h.side === 0 && 'core' in h && h.core === 0),
      ).hp = 10 ** 12;
      let s = sim;
      let c = ctx;
      for (let t = 0; t < 40; t++) {
        if (t === restoreAt) {
          s = JSON.parse(JSON.stringify(s)) as typeof sim;
          c = createArenaContext(s, content, simConfig);
        }
        stepArena(s, c);
      }
      return JSON.stringify(s);
    };
    expect(run(7)).toBe(run(-1));
    expect(run(25)).toBe(run(-1));
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
    const { sim } = start(empty(), { coreHealths: [77] });
    const core = (side: number) =>
      sim.health.find((h) => h.side === side && 'core' in h && h.core === 0)
        ?.hp;
    expect(core(0)).toBe(500);
    expect(core(1)).toBe(77);
  });

  test('without options the state has no sideOptions field', () => {
    const sim = createArenaSim(empty(), empty(), GAP, content, simConfig);
    expect('sideOptions' in sim).toBe(false);
  });

  test('turrets fire with no flow, at units on their board or in the zone, never on the enemy board', () => {
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
    expect(run(true, 22)).toBe(1); // in the gap, distance 1 (PP-13)
    expect(run(false, 24)).toBe(0); // unpowered
  });
});
