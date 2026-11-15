import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  createArenaSim,
  spawnUnitForTest,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
  type SideBurst,
} from './arena-sim.js';
import { Lab, board, content, got, simConfig } from './testing/support.js';
import { coreFootprint } from './map.js';
import type { TeamState } from './team-state.js';

const GAP = 7;

function empty(): TeamState {
  const lab = new Lab(board([]));
  lab.core(11, 0);
  return lab.state;
}

const BURSTS: SideBurst[] = [
  { core: 0, thresholdPercent: 75, unit: 'unit_soldier', count: 2 },
  { core: 0, thresholdPercent: 75, unit: 'unit_raider', count: 1 },
  { core: 0, thresholdPercent: 50, unit: 'unit_soldier', count: 1 },
  { core: 0, thresholdPercent: 25, unit: 'unit_soldier', count: 1 },
];

/** Side 1 has a Core of `health` and the bursts; side 0 hits for `damage`. */
function start(
  health: number,
  damage: number,
  teamB: TeamState = empty(),
): { sim: ArenaSim; ctx: ArenaContext; events: ArenaEvent[] } {
  // A soldier hits for 6: strength percent P makes it floor(6 * (100 + P) / 100).
  const strength = Math.max(0, Math.ceil((damage * 100) / 6) - 100);
  const sim = createArenaSim(empty(), teamB, GAP, content, simConfig, {
    sideOptions: [
      { unitStrengthPercent: strength },
      { coreHealths: [health], bursts: BURSTS },
    ],
  });
  const events: ArenaEvent[] = [];
  const ctx = createArenaContext(sim, content, simConfig, { events });
  return { sim, ctx, events };
}

/** Put a side 0 soldier on a free cell next to side 1's Core. */
function attacker(sim: ArenaSim, ctx: ArenaContext): void {
  const ref = got(ctx.arena.coreRef[1]?.[0]);
  const b = got(ctx.arena.buildings[ref]);
  for (const c of b.cells) {
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      try {
        spawnUnitForTest(sim, ctx, {
          side: 0,
          def: 'unit_soldier',
          x: c.x + dx,
          y: c.y + dy,
          owner: 0,
          target: 0,
        });
        return;
      } catch {
        // not open: try the next cell
      }
    }
  }
  throw new Error('no free cell next to the Core');
}

const bursts = (events: readonly ArenaEvent[]) =>
  events.filter((e) => e.type === 'burst_released');
const coreHp = (sim: ArenaSim): number =>
  got(sim.health.find((h) => h.side === 1 && 'core' in h)).hp;

describe('Core bursts (MM-9d)', () => {
  test('the state has no burst queue without bursts', () => {
    const sim = createArenaSim(empty(), empty(), GAP, content, simConfig, {
      sideOptions: [null, { coreHealths: [100] }],
    });
    expect('bursting' in sim).toBe(false);
  });

  test('two thresholds crossed in one tick fire together, highest first; units spawn on the next tick, with no producer or ramp bonus', () => {
    // Health 100, lines 75 / 50 / 25. One hit of 66 takes it to 34.
    const { sim, ctx, events } = start(100, 66);
    attacker(sim, ctx);
    let hitTick = -1;
    for (let t = 0; t < 40 && hitTick < 0; t++) {
      stepArena(sim, ctx);
      if (coreHp(sim) < 100) hitTick = sim.tick - 1;
    }
    expect(coreHp(sim)).toBe(34);
    expect(bursts(events)).toEqual([
      {
        tick: hitTick,
        type: 'burst_released',
        side: 1,
        core: 0,
        thresholdPercent: 75,
        units: [
          { unit: 'unit_soldier', count: 2 },
          { unit: 'unit_raider', count: 1 },
        ],
      },
      {
        tick: hitTick,
        type: 'burst_released',
        side: 1,
        core: 0,
        thresholdPercent: 50,
        units: [{ unit: 'unit_soldier', count: 1 }],
      },
    ]);
    // Nothing of side 1 has spawned yet: a step takes effect from the next tick.
    expect(
      events.filter((e) => e.type === 'unit_spawned' && e.side === 1),
    ).toHaveLength(0);
    expect(sim.bursting).toHaveLength(4);
    stepArena(sim, ctx);
    const spawned = events.filter(
      (e) => e.type === 'unit_spawned' && e.side === 1,
    );
    expect(spawned.map((e) => e.type === 'unit_spawned' && e.def)).toEqual([
      'unit_soldier',
      'unit_soldier',
      'unit_raider',
      'unit_soldier',
    ]);
    for (const e of spawned) {
      if (e.type !== 'unit_spawned') continue;
      expect(e.tick).toBe(hitTick + 1);
      expect(e.building).toBe(0);
      expect(e.owner).toBe(0);
      expect(e.target).toBe(0);
    }
    expect(sim.bursting).toHaveLength(0);
    const base = got(content.units.get('unit_soldier'));
    const mine = sim.units.filter(
      (u) => u.side === 1 && u.def === 'unit_soldier',
    );
    expect(mine.map((u) => u.hp)).toEqual(mine.map(() => base.health));
  });

  test('a threshold fires once; a Core destroyed with thresholds left fires them all', () => {
    // Health 100, a hit of 150 from above every line: all three at once.
    const { sim, ctx, events } = start(100, 150);
    attacker(sim, ctx);
    for (let t = 0; t < 40 && coreHp(sim) > 0; t++) stepArena(sim, ctx);
    expect(coreHp(sim)).toBe(0);
    expect(bursts(events).map((e) => e.thresholdPercent)).toEqual([75, 50, 25]);
    for (let t = 0; t < 5; t++) stepArena(sim, ctx);
    expect(bursts(events)).toHaveLength(3);
  });

  test('the line is floor(starting * threshold / 100), and "at or below" fires', () => {
    // Health 7: lines 5, 3 and 1; a hit of 6 leaves 1, at or below all three.
    const a = start(7, 6);
    attacker(a.sim, a.ctx);
    for (let t = 0; t < 40 && coreHp(a.sim) === 7; t++) stepArena(a.sim, a.ctx);
    expect(coreHp(a.sim)).toBe(1);
    expect(bursts(a.events)).toHaveLength(3);
    // Health 12: lines 9, 6 and 3; a hit of 6 leaves exactly 6: the 75 and 50
    // lines fire (6 <= 6), the 25 line (3) does not.
    const b = start(12, 6);
    attacker(b.sim, b.ctx);
    for (let t = 0; t < 40 && coreHp(b.sim) === 12; t++)
      stepArena(b.sim, b.ctx);
    expect(coreHp(b.sim)).toBe(6);
    expect(bursts(b.events).map((e) => e.thresholdPercent)).toEqual([75, 50]);
  });

  test('units wait, in order, while no position near the Core is free; they spawn when room appears', () => {
    // A Core walled in on every side: nothing can leave it.
    const lab = new Lab(board([]));
    lab.core(11, 0);
    const fp = coreFootprint(content.buildings);
    for (let y = 0; y <= fp.height; y++) {
      for (let x = 10; x <= 11 + fp.width; x++) {
        const inside = x >= 11 && x < 11 + fp.width && y < fp.height;
        if (!inside) lab.put('bld_wall_block', x, y);
      }
    }
    const { sim, ctx, events } = start(100, 66, lab.state);
    const queue = got(sim.bursting);
    queue.push(
      { side: 1, core: 0, unit: 'unit_soldier' },
      { side: 1, core: 0, unit: 'unit_raider' },
      { side: 1, core: 0, unit: 'unit_soldier' },
    );
    for (let t = 0; t < 5; t++) stepArena(sim, ctx);
    expect(sim.units.filter((u) => u.side === 1)).toHaveLength(0);
    expect(sim.bursting?.map((e) => e.unit)).toEqual([
      'unit_soldier',
      'unit_raider',
      'unit_soldier',
    ]);
    // Knock a wall down: the units leave in order as room appears.
    const wall = got(
      sim.health.find((h) => h.side === 1 && !('core' in h) && h.hp > 0),
    );
    wall.hp = 0;
    for (let t = 0; t < 30 && (sim.bursting?.length ?? 0) > 0; t++) {
      stepArena(sim, ctx);
    }
    expect(sim.bursting).toHaveLength(0);
    expect(
      events
        .filter((e) => e.type === 'unit_spawned' && e.side === 1)
        .map((e) => e.type === 'unit_spawned' && e.def),
    ).toEqual(['unit_soldier', 'unit_raider', 'unit_soldier']);
  });

  test('the state with units waiting can be saved and restored mid-battle', () => {
    const run = (restoreAt: number): string => {
      let { sim, ctx } = start(100, 66);
      attacker(sim, ctx);
      for (let t = 0; t < 60; t++) {
        if (t === restoreAt) {
          sim = JSON.parse(JSON.stringify(sim)) as ArenaSim;
          ctx = createArenaContext(sim, content, simConfig);
        }
        stepArena(sim, ctx);
      }
      return JSON.stringify(sim);
    };
    const plain = run(-1);
    for (const at of [1, 10, 20, 30]) expect(run(at)).toBe(plain);
  });
});
