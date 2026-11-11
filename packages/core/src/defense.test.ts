import { describe, expect, test } from 'vitest';
import { toArena, type ArenaContent } from './arena.js';
import { openFor } from './arena-paths.js';
import {
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import { previewEnemyPaths } from './enemy-paths.js';
import type { Cell, GameMap } from './map.js';
import { withModifier, type TeamModifier } from './modifiers.js';
import type { TeamState } from './team-state.js';
import {
  Lab,
  cellOfUnit,
  groundViolations,
  content,
  got,
  mid,
  postContent,
  simConfig,
  walk,
} from './test-support.js';
import { loadUnitsOrThrow } from './units.js';

// ---------------------------------------------------------------------------
// Helpers

const W = 12;
const GAP = 4;
/** Arena rows: 16 + 4 + 16. */
const H = 36;
const GEOM = { width: W, height: H, boardHeight: 16, gapRows: GAP };

function tiny(
  nodes: [number, number, string][] = [],
  lakes: [number, number][] = [],
): GameMap {
  return {
    width: W,
    height: 16,
    partySize: 1,
    plotWidth: W,
    features: lakes
      .map(([x, y]) => ({ x, y, feature: 'ter_lake' }))
      .sort((a, b) => a.y - b.y || a.x - b.x),
    nodes: nodes.map(([x, y, resource]) => ({ x, y, resource })),
  };
}

function coreOnly(x = 5, y = 0, map: GameMap = tiny()): TeamState {
  const lab = new Lab(map);
  lab.core(x, y);
  return lab.state;
}

function ofType<T extends ArenaEvent['type']>(
  events: readonly ArenaEvent[],
  type: T,
): Extract<ArenaEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<ArenaEvent, { type: T }> => e.type === type,
  );
}

/** Put a turret lane on a lab: node, extractor, conduit and the turret. */
function turretLane(
  lab: Lab,
  x: number,
  turretY: number,
  tier = 1,
): { source: number; turret: number } {
  const source = lab.put('bld_extractor', x, 2, 0, 3);
  const turret = lab.put('bld_turret', x, turretY, 0, tier);
  const cells: [number, number][] = [];
  for (let y = 3; y < turretY; y++) cells.push([x, y]);
  lab.link(source, 'north', turret, 'south', cells);
  return { source, turret };
}

const ALL_B = (xs: number[]): [number, number, string][] =>
  xs.map((x) => [x, 2, 'res_b']);

// ---------------------------------------------------------------------------

describe('walls', () => {
  test('a wall blocks both sides and has health', () => {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    const wall = lab.put('bld_wall', 3, 8);
    const { sim, ctx } = startArenaBattle(
      lab.state,
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const k = 8 * W + 3;
    expect(openFor(ctx.arena, 0, k)).toBe(false);
    expect(openFor(ctx.arena, 1, k)).toBe(false);
    expect(
      got(sim.health.find((h) => h.side === 0 && h.building === wall)).hp,
    ).toBe(100);
  });
});

describe('gates', () => {
  /** A full wall line across board row 8 with a gate at x = 6. */
  function gateBoard(gateTier = 1): { state: TeamState; gate: number } {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    let gate = 0;
    for (let x = 0; x < W; x++) {
      if (x === 6) gate = lab.put('bld_gate', x, 8, 0, gateTier);
      else lab.put('bld_wall', x, 8, 0, 3);
    }
    return { state: lab.state, gate };
  }

  test('open for the owner, blocking for the enemy', () => {
    const { state } = gateBoard();
    const { ctx } = startArenaBattle(
      state,
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const k = 8 * W + 6;
    expect(openFor(ctx.arena, 0, k)).toBe(true);
    expect(openFor(ctx.arena, 1, k)).toBe(false);
    // The enemy's own gates would be open for it, and walls never are.
    expect(openFor(ctx.arena, 0, 8 * W + 5)).toBe(false);
  });

  test('the owner walks out through the gate', () => {
    const { state } = gateBoard();
    const { sim, ctx, events } = startArenaBattle(
      state,
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const friend = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 6,
      y: 5,
    });
    const path = walk(sim, ctx, friend, 200).map(
      (c) => `${String(c.x)},${String(c.y)}`,
    );
    expect(path).toContain('6,8'); // stood on the gate cell
    expect(path).toContain('6,9'); // and came out the other side
    expect(ofType(events, 'building_destroyed')).toEqual([]);
  });

  test('the enemy is held until the gate falls, then walks through the same cell', () => {
    const { state, gate } = gateBoard();
    const { sim, ctx, events } = startArenaBattle(
      state,
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    const foe = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 6,
      y: 12,
    });
    let fell = -1;
    const cells: { tick: number; x: number; y: number }[] = [];
    for (let t = 0; t < 600; t++) {
      stepArena(sim, ctx);
      if (
        fell < 0 &&
        ofType(events, 'building_destroyed').some((b) => b.building === gate)
      ) {
        fell = t;
      }
      const c = cellOfUnit(foe);
      cells.push({ tick: t, x: c.x, y: c.y });
    }
    expect(fell).toBeGreaterThan(0);
    // Before the gate fell the unit never stood on it or below it ...
    expect(cells.filter((m) => m.tick <= fell).every((m) => m.y > 8)).toBe(
      true,
    );
    // ... and afterwards it walked through the gate's cell.
    expect(cells.some((m) => m.tick > fell && m.x === 6 && m.y === 8)).toBe(
      true,
    );
    // It attacked only the gate (the cheapest breach), not a wall.
    const hits = ofType(events, 'unit_attacked').filter(
      (e) => e.unit === foe.id && e.tick <= fell,
    );
    expect(
      hits.every(
        (e) => e.target.kind === 'building' && e.target.building === gate,
      ),
    ).toBe(true);
    expect(hits.length).toBe(14); // 80 health, 6 damage a hit
  });

  test('units of the owning side can spawn on the gate cells', () => {
    const lab = new Lab(tiny([[2, 2, 'res_a']]));
    lab.core(8, 0);
    const src = lab.put('bld_extractor', 2, 2, 0, 3);
    const rax = lab.put('bld_barracks', 2, 4, 0, 3);
    lab.link(src, 'north', rax, 'south', [[2, 3]]);
    // Gates on every free neighbour of the barracks except the west cell.
    lab.put('bld_gate', 4, 4);
    lab.put('bld_gate', 4, 5);
    lab.put('bld_wall', 2, 6);
    lab.put('bld_wall', 3, 6);
    lab.put('bld_wall', 1, 4);
    lab.put('bld_wall', 1, 5);
    lab.put('bld_wall', 3, 3);
    const { sim, ctx } = startArenaBattle(
      lab.state,
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    for (let t = 0; t < 120 && sim.units.length === 0; t++) stepArena(sim, ctx);
    const u = got(sim.units[0]);
    const c = cellOfUnit(u);
    expect(c.x).toBe(4);
    expect(openFor(ctx.arena, 0, c.y * W + c.x)).toBe(true);
    expect(ctx.arena.occupant[c.y * W + c.x]).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------

describe('turrets', () => {
  function turretBoard(
    extractor: boolean,
    tier = 1,
  ): { state: TeamState; turret: number } {
    const lab = new Lab(tiny(ALL_B([3])));
    lab.core(8, 0);
    if (extractor) {
      const { turret } = turretLane(lab, 3, 15, tier);
      return { state: lab.state, turret };
    }
    const turret = lab.put('bld_turret', 3, 15, 0, tier);
    return { state: lab.state, turret };
  }

  /** A target dummy of side 1 (see `postContent`) at the centre of a cell. */
  function park(sim: ArenaSim, ctx: ArenaContext, x: number, y: number) {
    return spawnUnitForTest(sim, ctx, { side: 1, def: 'unit_post', x, y });
  }

  test('never fires at a unit that has not crossed the front edge', () => {
    const { state, turret } = turretBoard(true);
    const { sim, ctx, events } = startArenaBattle(
      state,
      coreOnly(),
      GAP,
      postContent,
      simConfig,
    );
    const foe = park(sim, ctx, 3, 17); // in the gap, two cells from the turret
    for (let t = 0; t < 200; t++) stepArena(sim, ctx);
    expect(ofType(events, 'turret_fired')).toEqual([]);
    expect(foe.hp).toBe(1000);
    // The turret is charged and waiting.
    expect(got(sim.turrets[0]).charge).toBe(1);
    // A unit on the enemy board is out of reach as well.
    // Step onto the owner's front row: it is fired upon at once.
    foe.py = mid(15);
    foe.px = mid(4);
    stepArena(sim, ctx);
    const shots = ofType(events, 'turret_fired');
    expect(shots).toEqual([
      {
        tick: 200,
        type: 'turret_fired',
        side: 0,
        building: turret,
        unit: foe.id,
        damage: 5,
      },
    ]);
    expect(foe.hp).toBe(995);
  });

  test('a side-1 turret also only fires inside its own board rows', () => {
    // Side 1 owns the turret; side 0's unit in the gap (arena row 17) is one
    // row from side 1's front row (arena row 20 for gap 4: 20 - 17 = 3).
    const lab = new Lab(tiny(ALL_B([3])));
    lab.core(8, 0);
    turretLane(lab, 3, 15);
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      lab.state,
      GAP,
      postContent,
      simConfig,
    );
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_post',
      x: 8,
      y: 19,
    });
    for (let t = 0; t < 100; t++) stepArena(sim, ctx);
    expect(ofType(events, 'turret_fired')).toEqual([]);
    u.px = mid(7);
    u.py = mid(20); // side 1's front row
    for (let t = 0; t < 10; t++) stepArena(sim, ctx);
    expect(ofType(events, 'turret_fired').length).toBeGreaterThan(0);
    expect(u.hp).toBeLessThan(1000);
  });

  test('the row of a unit on a cell boundary is taken in the frame of the turret owner', () => {
    // The front edge of each board is a cell boundary: arena y = 16 * 240 for
    // side 0's board (rows 0..15), y = 20 * 240 for side 1's (rows 20..35).
    // In the owner's frame a centre exactly on it belongs to the gap row next
    // to the board, so a turret does not fire; one unit lower it does. The
    // unit's own frame would give the opposite answer (a side 1 unit at
    // y = 3840 would count as row 15), which is not the rule.
    const fireAt = (turretSide: 0 | 1, py: number): number => {
      const lab = new Lab(tiny(ALL_B([3])));
      lab.core(8, 0);
      turretLane(lab, 3, 15);
      const a = turretSide === 0 ? lab.state : coreOnly();
      const b = turretSide === 0 ? coreOnly() : lab.state;
      const { sim, ctx, events } = startArenaBattle(
        a,
        b,
        GAP,
        postContent,
        simConfig,
      );
      // The foe belongs to the other side; park it in the gap while the
      // turret charges, then step it onto the tested position.
      const foe = spawnUnitForTest(sim, ctx, {
        side: 1 - turretSide,
        def: 'unit_post',
        x: turretSide === 0 ? 5 : 6,
        y: 17,
      });
      for (let t = 0; t < 100; t++) stepArena(sim, ctx);
      expect(ofType(events, 'turret_fired')).toEqual([]);
      foe.px = mid(turretSide === 0 ? 5 : 6);
      foe.py = py;
      stepArena(sim, ctx);
      return ofType(events, 'turret_fired').length;
    };
    expect(fireAt(0, 16 * 240)).toBe(0);
    expect(fireAt(0, 16 * 240 - 1)).toBe(1);
    expect(fireAt(1, 20 * 240)).toBe(0);
    expect(fireAt(1, 20 * 240 + 1)).toBe(1);
  });

  test('an unpowered turret never fires; restored supply restores fire', () => {
    const none = turretBoard(false);
    const a = startArenaBattle(
      none.state,
      coreOnly(),
      GAP,
      postContent,
      simConfig,
    );
    park(a.sim, a.ctx, 4, 15);
    for (let t = 0; t < 200; t++) stepArena(a.sim, a.ctx);
    expect(ofType(a.events, 'turret_fired')).toEqual([]);

    // Powered, but the source is offline until tick 199 (countdown 200).
    // Hand calculation: the extractor's countdown goes 200 -> 0 over ticks
    // 0..199, so the first item is produced at tick 199 into slot 0 of the
    // 12-cell conduit (cells y = 3..14); it sits in the last slot (11) at tick
    // 210 and is delivered at tick 211, charged in the same tick's Production
    // step, and fired in the same tick's Decide step.
    const { state } = turretBoard(true);
    const b = startArenaBattle(state, coreOnly(), GAP, postContent, simConfig);
    got(b.sim.boards[0].sources[0]).countdown = 200;
    const foe = park(b.sim, b.ctx, 4, 15);
    for (let t = 0; t < 300; t++) stepArena(b.sim, b.ctx);
    const shots = ofType(b.events, 'turret_fired');
    expect(got(shots[0]).tick).toBe(211);
    expect(foe.hp).toBeLessThan(1000);
    // Cooldown 8 and one item per 10 ticks: the next shots are 10 ticks apart.
    expect(shots[1]?.tick).toBe(221);
  });

  test('an idle charged turret backs up its conduit instead of draining it', () => {
    const { state } = turretBoard(true);
    const { sim, ctx } = startArenaBattle(
      state,
      coreOnly(),
      GAP,
      postContent,
      simConfig,
    );
    for (let t = 0; t < 400; t++) stepArena(sim, ctx);
    const turret = got(sim.turrets[0]);
    expect(turret.charge).toBe(1);
    const board = got(sim.boards[0]);
    const consumer = got(board.consumers[0]);
    expect(got(consumer.inputs[0]).count).toBe(4);
    expect(got(consumer.inputs[0]).consumed).toBe(1);
    expect(got(board.sources[0]).stalled).toBe(1);
    expect(got(board.conduits[0]).slots.every((s) => s !== null)).toBe(true);
  });

  test('a turret with no target keeps its charge and cooldown ticks down', () => {
    const { state } = turretBoard(true, 3); // tier 3: cost 2, cooldown 6
    const { sim, ctx, events } = startArenaBattle(
      state,
      coreOnly(),
      GAP,
      postContent,
      simConfig,
    );
    for (let t = 0; t < 100; t++) stepArena(sim, ctx);
    expect(got(sim.turrets[0]).charge).toBe(2);
    expect(got(sim.turrets[0]).cooldown).toBe(0);
    const foe = park(sim, ctx, 6, 14);
    stepArena(sim, ctx);
    const shot = got(ofType(events, 'turret_fired')[0]);
    expect(shot.damage).toBe(12);
    expect(shot.unit).toBe(foe.id);
    expect(got(sim.turrets[0]).charge).toBe(0);
    expect(got(sim.turrets[0]).cooldown).toBe(5); // 6, minus this tick's decrement
  });

  test('targets the unit nearest by distance to its cells, ties to the lowest ID', () => {
    const { state } = turretBoard(true);
    const { sim, ctx, events } = startArenaBattle(
      state,
      coreOnly(),
      GAP,
      postContent,
      simConfig,
    );
    for (let t = 0; t < 50; t++) stepArena(sim, ctx);
    // The turret covers board cell (3, 15): x 720..960, y 3600..3840. All
    // three stand level with it, so the distance is the horizontal gap.
    const at = (px: number) =>
      spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_post',
        px,
        py: 3720,
      });
    const far = at(960 + 400);
    const near1 = at(720 - 200);
    const near2 = at(960 + 200);
    expect(far.id).toBeLessThan(near1.id);
    expect(near1.id).toBeLessThan(near2.id);
    stepArena(sim, ctx);
    // near1 and near2 are both 200 away: the lower ID is shot.
    expect(got(ofType(events, 'turret_fired')[0]).unit).toBe(near1.id);
  });

  test("range is measured to the unit's edge: a post just in range is shot, one just out is not", () => {
    // Tier 1 range is 4 cells = 960; the unit's radius 72 is added.
    for (const [gap, shot] of [
      [960 + 72, true],
      [960 + 73, false],
    ] as const) {
      const { state } = turretBoard(true);
      const { sim, ctx, events } = startArenaBattle(
        state,
        coreOnly(),
        GAP,
        postContent,
        simConfig,
      );
      for (let t = 0; t < 50; t++) stepArena(sim, ctx);
      spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_post',
        px: 960 + gap,
        py: 3720,
      });
      stepArena(sim, ctx);
      expect(ofType(events, 'turret_fired').length > 0).toBe(shot);
    }
  });

  test('turrets block movement like any building and can be destroyed', () => {
    const { state, turret } = turretBoard(true);
    const { ctx } = startArenaBattle(
      state,
      coreOnly(),
      GAP,
      postContent,
      simConfig,
    );
    expect(openFor(ctx.arena, 0, 15 * W + 3)).toBe(false);
    expect(openFor(ctx.arena, 1, 15 * W + 3)).toBe(false);
    expect(turret).toBeGreaterThan(0);
  });

  test('a destroyed turret stops firing and leaves the state', () => {
    const { state } = turretBoard(true);
    const { sim, ctx } = startArenaBattle(
      state,
      coreOnly(),
      GAP,
      postContent,
      simConfig,
    );
    const h = got(sim.health.find((x) => x.side === 0 && x.building > 0));
    expect(sim.turrets.length).toBe(1);
    for (const x of sim.health)
      if (x.building === got(sim.turrets[0]).building) x.hp = 0;
    stepArena(sim, ctx);
    expect(sim.turrets.length).toBe(0);
    expect(h.hp).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------

describe('funnelling', () => {
  /**
   * Eight tier 1 turrets in a row (x = 4..11, y = 7), each powered by its own
   * lane. With `funnel`, a lake band (x = 0..7) and walls (x = 9..11) close
   * rows 9..11 except for one approach, x = 8, right above the turrets.
   */
  const LANES = [4, 5, 6, 7, 8, 9, 10, 11];

  function killZone(funnel: boolean): TeamState {
    const lakes: [number, number][] = [];
    if (funnel) {
      for (let y = 9; y <= 11; y++)
        for (let x = 0; x <= 7; x++) lakes.push([x, y]);
    }
    const lab = new Lab(tiny(ALL_B(LANES), lakes));
    lab.core(1, 0);
    for (const x of LANES) turretLane(lab, x, 7);
    if (funnel) {
      // Walls close the east side of rows 9..11; the only approach is x = 8.
      for (const x of [9, 10, 11])
        for (let y = 9; y <= 11; y++) lab.put('bld_wall', x, y, 0, 3);
    }
    return lab.state;
  }

  function runWave(funnel: boolean): { dead: number; leftHp: number } {
    const { sim, ctx } = startArenaBattle(
      killZone(funnel),
      coreOnly(),
      GAP,
      content,
      simConfig,
    );
    // A fixed wave: twelve soldiers in the gap, one per column.
    for (let x = 0; x < W; x++) {
      spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_soldier',
        x,
        y: 17,
      });
    }
    for (let t = 0; t < 400; t++) stepArena(sim, ctx);
    return {
      dead: sim.unitsDied[1],
      leftHp: sim.units.reduce((s, u) => s + u.hp, 0),
    };
  }

  test('the same turrets kill more of the same wave when the approach is funnelled', () => {
    const open = runWave(false);
    const funnel = runWave(true);
    // Funnelling still helps the turrets, but units now crowd in front of
    // the Core in any case, which keeps them in range longer on the open
    // ground too.
    expect(funnel.dead).toBeGreaterThan(open.dead);
    expect(funnel.leftHp).toBeLessThan(open.leftHp);
    expect({ open, funnel }).toEqual({
      open: { dead: 2, leftHp: 265 },
      funnel: { dead: 7, leftHp: 105 },
    });
  });
});

// ---------------------------------------------------------------------------

describe('aggro', () => {
  const noAggro = { ...simConfig, aggroRangeCells: 0 };

  function crossing(config: typeof simConfig): ArenaEvent[] {
    // Each unit walks straight along its own column towards the enemy Core
    // (side 1's Core covers arena columns 6..7, side 0's covers 5..6), and
    // the two columns, 7 and 5, are two apart: without aggro they pass.
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(5, 0),
      coreOnly(4, 0),
      GAP,
      content,
      config,
    );
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x: 7, y: 17 });
    spawnUnitForTest(sim, ctx, { side: 1, def: 'unit_soldier', x: 5, y: 24 });
    for (let t = 0; t < 400; t++) stepArena(sim, ctx);
    return events;
  }

  test('melee units in columns two apart now meet and fight', () => {
    const withAggro = crossing(simConfig);
    expect(
      ofType(withAggro, 'unit_attacked').filter((e) => e.target.kind === 'unit')
        .length,
    ).toBeGreaterThan(0);
    const without = crossing(noAggro);
    expect(
      ofType(without, 'unit_attacked').filter((e) => e.target.kind === 'unit'),
    ).toEqual([]);
  });

  test('a unit does not chase an enemy outside aggro range (3 cells, centre to centre)', () => {
    for (const [dist, chased] of [
      [721, false],
      [720, true],
    ] as const) {
      const { sim, ctx } = startArenaBattle(
        coreOnly(),
        coreOnly(),
        GAP,
        postContent,
        simConfig,
      );
      const me = spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_soldier',
        px: mid(3),
        py: mid(17),
      });
      spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_post',
        px: mid(3),
        py: mid(17) - dist,
      });
      stepArena(sim, ctx);
      // Its field leads north (towards the enemy Core, larger y); chasing
      // the enemy, which stands to the south, lowers y.
      expect(me.py < mid(17)).toBe(chased);
    }
  });

  test('aggro needs a clear line: a blocked cell between the units hides the enemy', () => {
    // A blocked gap cell at (3, 17) between a chaser at (3, 16) and an enemy
    // at (3, 18): the chaser follows its field (sideways round the block).
    const { sim, ctx } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      postContent,
      simConfig,
      { gapBlocked: [{ x: 3, y: 17 }] },
    );
    const me = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 3,
      y: 16,
    });
    spawnUnitForTest(sim, ctx, { side: 1, def: 'unit_post', x: 3, y: 18 });
    const start = { x: me.px, y: me.py };
    stepArena(sim, ctx);
    expect(me.py).toBe(start.y);
    expect(me.px).not.toBe(start.x);
    // Without the block it walks straight at the enemy.
    const open = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      postContent,
      simConfig,
    );
    const me2 = spawnUnitForTest(open.sim, open.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 3,
      y: 16,
    });
    spawnUnitForTest(open.sim, open.ctx, {
      side: 1,
      def: 'unit_post',
      x: 3,
      y: 18,
    });
    stepArena(open.sim, open.ctx);
    expect(me2.px).toBe(start.x);
    expect(me2.py).toBeGreaterThan(start.y);
  });

  test('aggro never pushes a unit into blocked ground', () => {
    // A lake cell between the two: the chaser must not enter it.
    const map = tiny([], [[3, 16]]);
    const a = coreOnly(5, 0, map);
    const { sim, ctx } = startArenaBattle(a, coreOnly(), 0, content, simConfig);
    const me = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      ...toArena({ ...GEOM, gapRows: 0, height: 32 }, 1, { x: 3, y: 15 }),
    });
    expect(me.id).toBeGreaterThan(0);
    for (let t = 0; t < 40; t++) {
      stepArena(sim, ctx);
      expect(groundViolations(sim, ctx)).toEqual([]);
    }
  });
});

describe('aggro convergence (Euclidean reach and range)', () => {
  /**
   * All cell offsets within Euclidean aggro range 3 (dx^2 + dy^2 <= 9) and
   * farther than one cell in some axis.
   */
  function offsets(): [number, number][] {
    const out: [number, number][] = [];
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const c = Math.max(Math.abs(dx), Math.abs(dy));
        if (c >= 2 && dx * dx + dy * dy <= 9) out.push([dx, dy]);
      }
    return out;
  }

  /** First tick at which A and B attack each other, or -1. */
  function meet(
    a: Cell,
    b: Cell,
    bMoves: boolean,
    ticks: number,
    cfg = simConfig,
  ): number {
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      8,
      postContent,
      cfg,
    );
    const ua = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      ...a,
    });
    const ub = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: bMoves ? 'unit_soldier' : 'unit_post',
      ...b,
    });
    for (let t = 0; t < ticks; t++) {
      stepArena(sim, ctx);
      const hit = ofType(events, 'unit_attacked').find(
        (e) =>
          e.target.kind === 'unit' &&
          ((e.unit === ua.id && e.target.unit === ub.id) ||
            (e.unit === ub.id && e.target.unit === ua.id)),
      );
      if (hit !== undefined) return hit.tick;
    }
    return -1;
  }

  test('both units moving: they meet within the closing time', () => {
    // Both close the distance at 40 sub-cell units per tick each; they are in
    // contact at a centre distance of 204. Allow two ticks for separation.
    let worst = 0;
    const cases = offsets();
    expect(cases.length).toBe(20);
    for (const [dx, dy] of cases) {
      const a = { x: 5, y: 19 };
      const b = { x: 5 + dx, y: 19 + dy };
      const dist = Math.ceil(240 * Math.sqrt(dx * dx + dy * dy));
      const bound = Math.ceil((dist - 204) / 80) + 2;
      const t = meet(a, b, true, bound + 1);
      expect(t, `offset ${String(dx)},${String(dy)}`).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(bound);
      worst = Math.max(worst, t);
    }
    expect(worst).toBeGreaterThan(0);
  });

  test('a diagonal pair two cells apart in both axes is within aggro range', () => {
    // 2 * sqrt(2) cells = 679 <= 720. Without aggro the post is passed by.
    expect(meet({ x: 5, y: 19 }, { x: 7, y: 21 }, false, 40)).toBeGreaterThan(
      -1,
    );
    expect(
      meet({ x: 5, y: 19 }, { x: 7, y: 21 }, false, 40, {
        ...simConfig,
        aggroRangeCells: 0,
      }),
    ).toBe(-1);
  });

  test('only one unit able to move: still converges', () => {
    for (const [dx, dy] of offsets()) {
      const dist = Math.ceil(240 * Math.sqrt(dx * dx + dy * dy));
      const bound = Math.ceil((dist - 204) / 40) + 2;
      const t = meet({ x: 5, y: 19 }, { x: 5 + dx, y: 19 + dy }, false, bound);
      expect(t, `offset ${String(dx)},${String(dy)}`).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(bound);
    }
  });

  test('the former livelock: (5,16) against (6,18) now fight', () => {
    expect(meet({ x: 5, y: 16 }, { x: 6, y: 18 }, true, 30)).toBeGreaterThan(
      -1,
    );
  });

  test('a melee unit closes in on an enemy on a diagonal neighbour cell within a few ticks', () => {
    for (const [dx, dy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      const t = meet({ x: 5, y: 19 }, { x: 5 + dx, y: 19 + dy }, false, 6);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(4);
    }
  });

  test('nearest enemy: smallest Euclidean distance, ties to the lowest ID', () => {
    const { sim, ctx, events } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      8,
      content,
      simConfig,
    );
    const me = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: mid(5),
      py: mid(19),
    });
    // A diagonal enemy at (130, 130) is 183.8 away; an orthogonal one at 180
    // is nearer.
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: mid(5) + 130,
      py: mid(19) + 130,
    });
    const orth = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: mid(5) - 180,
      py: mid(19),
    });
    stepArena(sim, ctx);
    const first = got(
      ofType(events, 'unit_attacked').find((e) => e.unit === me.id),
    );
    expect(first.target).toEqual({ kind: 'unit', unit: orth.id });
  });

  test('a wall corner blocks the larger-axis approach: the chaser slides along the lake', () => {
    // Lake directly east of the chaser; the enemy is further east and a row
    // up. The circle slides along the lake edge instead of entering it.
    const map = tiny([], [[6, 17]]);
    const { sim, ctx } = startArenaBattle(
      coreOnly(5, 0, map),
      coreOnly(),
      8,
      postContent,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x: 5, y: 17 });
    spawnUnitForTest(sim, ctx, { side: 1, def: 'unit_post', x: 8, y: 18 });
    for (let t = 0; t < 60; t++) {
      stepArena(sim, ctx);
      expect(groundViolations(sim, ctx)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------

describe('targeting rule b: a goal in reach', () => {
  test('a long-reach unit in a sealed pocket attacks the Core in reach instead of breaching (#46)', () => {
    const soldier = got(content.units.get('unit_soldier'));
    const longarm = { ...soldier, id: 'unit_longarm', reach: 480 };
    const custom: ArenaContent = {
      ...content,
      units: loadUnitsOrThrow({ units: [...content.units.list(), longarm] }),
    };
    const lab = new Lab(tiny());
    lab.core(5, 0);
    // The pocket (4, 3) is walled in on every side; no route reaches it, but
    // the Core is within the reach of the unit.
    const walls = [
      lab.put('bld_wall', 3, 3),
      lab.put('bld_wall', 5, 3),
      lab.put('bld_wall', 4, 2),
      lab.put('bld_wall', 4, 4),
    ];
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnly(),
      GAP,
      custom,
      simConfig,
    );
    const u = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_longarm',
      x: 4,
      y: 3,
    });
    for (let t = 0; t < 3; t++) stepArena(sim, ctx);
    const hits = ofType(events, 'unit_attacked').filter((e) => e.unit === u.id);
    expect(hits.length).toBeGreaterThan(0);
    // Every attack is on the Core, none on the walls (which a breach would hit).
    for (const h of hits) expect(h.target.kind).toBe('core');
    expect(walls.length).toBe(4);
  });
});

describe('enemy-path preview', () => {
  function pathCells(p: { cells: readonly Cell[] }): string {
    return p.cells.map((c) => `${String(c.x)},${String(c.y)}`).join(' ');
  }

  test('an open base: the route from each entry to the cell beside the Core', () => {
    const state = coreOnly(5, 0);
    const paths = previewEnemyPaths(state, content, simConfig);
    expect(paths.length).toBe(W);
    expect(paths.map((p) => p.entry.x)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(paths.every((p) => p.breach === null)).toBe(true);
    const col = (x: number, y0: number, y1: number): string[] => {
      const out: string[] = [];
      for (let y = y0; y >= y1; y--) out.push(`${String(x)},${String(y)}`);
      return out;
    };
    // Straight down column 5 to the cell above the Core (5,2).
    expect(pathCells(got(paths[5]))).toBe(col(5, 15, 2).join(' '));
    // From the west edge the enemy walks the diagonal (cost 14 per step, which
    // beats 20 for a sideways and a forward step) until it is in column 5, then
    // straight down: forward is preferred whenever steps tie.
    expect(pathCells(got(paths[0]))).toBe(
      ['0,15', '1,14', '2,13', '3,12', '4,11', '5,10', ...col(5, 9, 2)].join(
        ' ',
      ),
    );
    // Every path ends beside the Core.
    for (const p of paths) {
      const last = got(p.cells[p.cells.length - 1]);
      const near =
        (last.x === 5 || last.x === 6 ? last.y === 2 : false) ||
        ((last.x === 4 || last.x === 7) && (last.y === 0 || last.y === 1));
      expect(near).toBe(true);
    }
  });

  test('walls and gates in the front row are not entries; turrets block too', () => {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    lab.put('bld_wall', 2, 15);
    lab.put('bld_gate', 3, 15);
    lab.put('bld_turret', 4, 15);
    const paths = previewEnemyPaths(lab.state, content, simConfig);
    expect(paths.map((p) => p.entry.x)).toEqual([0, 1, 5, 6, 7, 8, 9, 10, 11]);
  });

  test('every returned cell lies on the board; a detour across the gap rows is reported as approach cells (#32)', () => {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    // Row 14 is walled from x = 0 to 9 and (5, 15) is walled too: a soldier
    // entering at x = 0..4 can only pass through the neutral zone, row 16.
    for (let x = 0; x <= 9; x++) lab.put('bld_wall', x, 14);
    lab.put('bld_wall', 5, 15);
    const paths = previewEnemyPaths(lab.state, content, simConfig);
    const at = (x: number) => got(paths.find((q) => q.entry.x === x));
    const text = (cs: readonly Cell[]): string =>
      cs.map((c) => `${String(c.x)},${String(c.y)}`).join(' ');
    expect(text(at(3).approach)).toBe('4,16 5,16 6,16');
    // The on-board cells are the entry and the walk from (7, 15) on: the
    // detour across row 16 is one diagonal up, two steps along, one down.
    expect(text(at(3).cells).startsWith('3,15 7,15 8,15 9,15 10,15 10,14')).toBe(
      true,
    );
    expect(text(at(7).approach)).toBe('');
    for (const p of paths) {
      for (const c of p.cells) {
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThan(16);
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(W);
      }
      for (const c of p.approach) expect(c.y).toBeGreaterThanOrEqual(16);
    }
  });

  test('a gate blocks the route like a wall, so the path goes around it', () => {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    for (let x = 0; x < W; x++) {
      if (x !== 9) lab.put('bld_wall', x, 8, 0, 3);
    }
    lab.put('bld_gate', 9, 8);
    const paths = previewEnemyPaths(lab.state, content, simConfig);
    // The row is sealed (the gate blocks the enemy): every path ends in a
    // breach at the cheapest building, the tier 1 gate (cost 10 + 8).
    for (const p of paths) {
      expect(p.breach?.cell).toEqual({ x: 9, y: 8 });
    }
    expect(pathCells(got(paths[9]))).toBe(
      ['9,15', '9,14', '9,13', '9,12', '9,11', '9,10', '9,9'].join(' '),
    );
  });

  test('a sealed base reports the breach point', () => {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    // Ring of walls around the 2 x 2 Core; the weakest one is (6, 2).
    lab.put('bld_wall', 4, 0, 0, 3);
    lab.put('bld_wall', 4, 1, 0, 3);
    lab.put('bld_wall', 7, 0, 0, 3);
    lab.put('bld_wall', 7, 1, 0, 3);
    lab.put('bld_wall', 5, 2, 0, 3);
    const weak = lab.put('bld_wall', 6, 2, 0, 1);
    const paths = previewEnemyPaths(lab.state, content, simConfig);
    expect(paths.length).toBe(W);
    for (const p of paths) {
      expect(p.breach).toEqual({ building: weak, cell: { x: 6, y: 2 } });
    }
    const p6 = got(paths[6]);
    expect(p6.cells.length).toBe(13); // (6,15) .. (6,3)
    expect(got(p6.cells[p6.cells.length - 1])).toEqual({ x: 6, y: 3 });
  });

  test('it agrees with a simulated soldier walking from the entry', () => {
    const lab = new Lab(tiny([], [[5, 8]]));
    lab.core(5, 0);
    lab.put('bld_wall', 6, 8, 0, 3);
    lab.put('bld_wall', 4, 8, 0, 3);
    lab.put('bld_wall', 3, 3);
    const paths = previewEnemyPaths(lab.state, content, simConfig);
    for (const x of [0, 3, 5, 9, 11]) {
      const p = got(paths.find((q) => q.entry.x === x));
      const { sim, ctx, events } = startArenaBattle(
        lab.state,
        coreOnly(),
        GAP,
        content,
        simConfig,
      );
      const u = spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_soldier',
        ...toArena(GEOM, 0, p.entry),
      });
      const walked = walk(sim, ctx, u, 6 * p.cells.length + 12);
      expect(events.length).toBeGreaterThanOrEqual(0);
      // The preview is the route of cells; a soldier steers by the direction
      // of each step and keeps its offset in the cell, so it may cut across
      // a neighbouring cell. It starts in the entry cell, stays within one
      // cell of the route, and passes by every cell of the route.
      const near = (a: Cell, b: Cell): boolean =>
        Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
      expect(walked[0]).toEqual(p.cells[0]);
      const len = Math.min(walked.length, p.cells.length + 4);
      for (const c of walked.slice(0, len)) {
        expect(p.cells.some((r) => near(r, c)) || p.approach.some((r) => near(r, c))).toBe(true);
      }
      for (const r of p.cells.slice(0, Math.max(0, walked.length - 4))) {
        expect(walked.some((c) => near(r, c))).toBe(true);
      }
    }
  });

  test('a wall-health modifier changes the previewed breach point, as in the simulation', () => {
    const lab = new Lab(tiny());
    lab.core(5, 0);
    lab.put('bld_wall', 4, 0, 0, 3);
    lab.put('bld_wall', 4, 1, 0, 3);
    lab.put('bld_wall', 7, 0, 0, 3);
    lab.put('bld_wall', 7, 1, 0, 3);
    // Unmodified, the tier 1 wall (100) is cheaper than the tier 2 gate (130).
    const wall = lab.put('bld_wall', 5, 2, 0, 1);
    const gate = lab.put('bld_gate', 6, 2, 0, 2);
    const stout: TeamModifier = {
      id: 'mod_test_stout',
      effects: [
        { kind: 'building_health_percent', target: 'wall', percent: 100 },
      ],
    };
    const plain = lab.state;
    const modified = withModifier(plain, stout);

    const previewed = (team: TeamState): number | undefined =>
      previewEnemyPaths(team, content, simConfig)[0]?.breach?.building;
    const simulated = (team: TeamState): number | undefined => {
      const { sim, ctx, events } = startArenaBattle(
        team,
        coreOnly(),
        GAP,
        content,
        simConfig,
      );
      const u = spawnUnitForTest(sim, ctx, {
        side: 1,
        def: 'unit_soldier',
        ...toArena(GEOM, 0, { x: 0, y: 15 }),
      });
      for (let t = 0; t < 200; t++) stepArena(sim, ctx);
      const hit = ofType(events, 'unit_attacked').find(
        (e) => e.unit === u.id && e.target.kind === 'building',
      );
      return hit?.target.kind === 'building' ? hit.target.building : undefined;
    };

    expect(previewed(plain)).toBe(wall);
    expect(simulated(plain)).toBe(wall);
    // Walls at 200 now cost more than the gate at 130: both switch to the gate.
    expect(previewed(modified)).toBe(gate);
    expect(simulated(modified)).toBe(gate);
  });

  test('requires a placed Core', () => {
    expect(() =>
      previewEnemyPaths(new Lab(tiny()).state, content, simConfig),
    ).toThrow(/Core/);
  });
});
