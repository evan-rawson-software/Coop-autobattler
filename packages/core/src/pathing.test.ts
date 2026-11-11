/**
 * Pathing and steering (issue #82, part 2): the 8-direction movement field,
 * forward tie-breaks, steering by direction, sliding past an ally that holds
 * its place, and the properties that must keep holding (half-turn symmetry,
 * restore at any tick, units never in solid ground). See
 * docs/rules-reference.md, "Goals and movement fields" and "Steering".
 */
import { describe, expect, test } from 'vitest';
import { computeField, fieldStep, tieKey } from './arena-paths.js';
import {
  createArenaContext,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaSim,
} from './arena-sim.js';
import { hashJson } from './hash.js';
import { CELL_UNITS } from './limits.js';
import type { GameMap } from './map.js';
import type { TeamState } from './team-state.js';
import {
  Lab,
  content,
  groundViolations,
  mid,
  postContent,
  simConfig,
} from './test-support.js';

const CU = CELL_UNITS;
const W = 12;
const GAP = 4;
/** Arena rows: 16 + 4 + 16. */
const H = 36;

function tiny(): GameMap {
  return {
    width: W,
    height: 16,
    partySize: 1,
    plotWidth: W,
    features: [],
    nodes: [],
  };
}

/** A team with only a Core at board cell `(x, 0)`. */
function coreOnly(x = 5): TeamState {
  const lab = new Lab(tiny());
  lab.core(x, 0);
  return lab.state;
}

const noAggro = { ...simConfig, aggroRangeCells: 0 };

describe('the movement field (8 directions)', () => {
  // Side 1's Core covers arena (5..6, 34..35); the face cells for side 0 are
  // (5, 33), (6, 33), (4, 34), (4, 35), (7, 34), (7, 35).
  function field(team1: TeamState = coreOnly()) {
    const { ctx } = startArenaBattle(coreOnly(), team1, GAP, content, simConfig);
    return { arena: ctx.arena, f: computeField(ctx.arena, 0) };
  }
  const at = (x: number, y: number): number => y * W + x;

  test('costs are 10 for a straight step and 14 for a diagonal one', () => {
    const { f } = field();
    expect(f.dist[at(5, 33)]).toBe(0);
    expect(f.dist[at(5, 31)]).toBe(20);
    expect(f.dist[at(4, 32)]).toBe(14);
    expect(f.dist[at(3, 31)]).toBe(28);
    // Open ground: two diagonals and fifteen straight steps from (3, 16).
    expect(f.dist[at(3, 16)]).toBe(2 * 14 + 15 * 10);
  });

  test('a diagonal step does not cut a corner through a solid cell', () => {
    // A wall of side 1 on arena (5, 32): board (6, 3).
    const lab = new Lab(tiny());
    lab.core(5, 0);
    lab.put('bld_wall', 6, 3);
    const { arena, f } = field(lab.state);
    // (4, 32) cannot step diagonally to (5, 33): the wall at (5, 32) is in the
    // way of the corner, so it goes through (4, 33): 10 + 10.
    expect(f.dist[at(4, 32)]).toBe(20);
    expect(fieldStep(arena, 0, f, at(4, 32))).toBe(at(4, 33));
    // The wall itself is not walkable.
    expect(f.dist[at(5, 32)]).toBe(-1);
  });

  test('every free side of the Core is a goal', () => {
    const { f } = field();
    for (const [x, y] of [
      [5, 33],
      [6, 33],
      [4, 34],
      [4, 35],
      [7, 34],
      [7, 35],
    ] as const) {
      expect(f.dist[at(x, y)]).toBe(0);
    }
  });

  test('the field of a mirrored battle is the half turn of the other', () => {
    const team = coreOnly();
    const { ctx } = startArenaBattle(team, team, GAP, content, simConfig);
    const f0 = computeField(ctx.arena, 0);
    const f1 = computeField(ctx.arena, 1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(f1.dist[at(W - 1 - x, H - 1 - y)]).toBe(f0.dist[at(x, y)]);
      }
    }
  });

  test('ties go forward first, then to the lowest x of the mover', () => {
    const { arena } = field();
    // Side 0: forward is +y.
    expect(tieKey(arena, 0, 5, 11)).toBeLessThan(tieKey(arena, 0, 4, 10));
    expect(tieKey(arena, 0, 4, 10)).toBeLessThan(tieKey(arena, 0, 6, 10));
    expect(tieKey(arena, 0, 6, 10)).toBeLessThan(tieKey(arena, 0, 5, 9));
    // Side 1 is the same in its own frame: forward is -y, lowest own x is the
    // highest arena x.
    expect(tieKey(arena, 1, 5, 9)).toBeLessThan(tieKey(arena, 1, 6, 10));
    expect(tieKey(arena, 1, 6, 10)).toBeLessThan(tieKey(arena, 1, 4, 10));
    expect(tieKey(arena, 1, 4, 10)).toBeLessThan(tieKey(arena, 1, 5, 11));
  });
});

describe('an army advances on a wide front', () => {
  function columns(sim: ArenaSim): number {
    return new Set(
      sim.units.filter((u) => u.side === 0).map((u) => Math.floor(u.px / CU)),
    ).size;
  }

  test('twelve soldiers abreast keep their columns on the way to the Core', () => {
    const { sim, ctx } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      content,
      noAggro,
    );
    for (let x = 0; x < W; x++) {
      spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_soldier', x, y: 16 });
    }
    expect(columns(sim)).toBe(12);
    for (let t = 0; t < 60; t++) stepArena(sim, ctx);
    // Ten cells on: the outer units close in on the Core along diagonals,
    // but they have not been funnelled into the Core's columns (they were,
    // before: two or three columns).
    expect(columns(sim)).toBeGreaterThanOrEqual(6);
    for (const u of sim.units) expect(u.py).toBeGreaterThan(mid(16) + 5 * CU);
    expect(groundViolations(sim, ctx)).toEqual([]);
  });

  test('a restored battle continues exactly like the straight run', () => {
    const make = () => {
      const b = startArenaBattle(coreOnly(), coreOnly(), GAP, content, noAggro);
      for (let x = 0; x < W; x++) {
        spawnUnitForTest(b.sim, b.ctx, {
          side: 0,
          def: 'unit_soldier',
          x,
          y: 16,
        });
      }
      return b;
    };
    const ref = make();
    for (let t = 0; t < 200; t++) stepArena(ref.sim, ref.ctx);
    for (const at of [1, 7, 33, 90, 150]) {
      const b = make();
      let sim = b.sim;
      let ctx = b.ctx;
      for (let t = 0; t < 200; t++) {
        if (t === at) {
          sim = JSON.parse(JSON.stringify(sim)) as ArenaSim;
          ctx = createArenaContext(sim, content, noAggro);
        }
        stepArena(sim, ctx);
      }
      expect(hashJson(sim)).toBe(hashJson(ref.sim));
    }
  });
});

describe('sliding past an ally that holds its place', () => {
  // A target dummy of side 1 at (6, 24) and soldiers of side 0 below it in a
  // line: the first fights, the others used to queue behind it.
  function queue(count: number) {
    const b = startArenaBattle(
      coreOnly(),
      coreOnly(),
      GAP,
      postContent,
      simConfig,
    );
    const post = spawnUnitForTest(b.sim, b.ctx, {
      side: 1,
      def: 'unit_post',
      x: 6,
      y: 24,
    });
    const soldiers = [];
    for (let i = 0; i < count; i++) {
      soldiers.push(
        spawnUnitForTest(b.sim, b.ctx, {
          side: 0,
          def: 'unit_soldier',
          px: mid(6),
          py: mid(24) - 9 * CU - i * 100,
        }),
      );
    }
    return { ...b, post, soldiers };
  }

  test('followers reach the target instead of queueing behind the first', () => {
    const { sim, ctx, events, soldiers } = queue(5);
    for (let t = 0; t < 200; t++) stepArena(sim, ctx);
    const attackers = new Set(
      events.filter((e) => e.type === 'unit_attacked').map((e) => e.unit),
    );
    // At least four of the five soldiers hit the target.
    for (const s of soldiers.slice(0, 4)) expect(attackers.has(s.id)).toBe(true);
    expect(groundViolations(sim, ctx)).toEqual([]);
  });

  test('a follower directly behind a fighter steps aside, towards the positive x of its own frame', () => {
    for (const side of [0, 1]) {
      const b = startArenaBattle(
        coreOnly(),
        coreOnly(),
        GAP,
        postContent,
        simConfig,
      );
      // The target dummy of the other side, a fighter at contact range
      // (centre distance 190 < 60 + 72 + 72) and a follower 100 behind it,
      // all on one line. Side 1 is the half turn of side 0.
      const f = side === 0 ? 1 : -1;
      const cx = side === 0 ? mid(6) : W * CU - mid(6);
      const cy = side === 0 ? mid(24) : H * CU - mid(24);
      spawnUnitForTest(b.sim, b.ctx, {
        side: 1 - side,
        def: 'unit_post',
        px: cx,
        py: cy,
      });
      const fighter = spawnUnitForTest(b.sim, b.ctx, {
        side,
        def: 'unit_soldier',
        px: cx,
        py: cy - f * 190,
      });
      const follower = spawnUnitForTest(b.sim, b.ctx, {
        side,
        def: 'unit_soldier',
        px: cx,
        py: cy - f * 290,
      });
      stepArena(b.sim, b.ctx);
      // The fighter holds its place (the follower may nudge it a little); the
      // follower moved forward and sideways (positive x of its own frame:
      // arena +x for side 0, -x for side 1).
      expect(Math.abs(fighter.px - cx)).toBeLessThan(10);
      expect(Math.abs(fighter.py - (cy - f * 190))).toBeLessThan(10);
      expect((follower.px - cx) * f).toBeGreaterThan(0);
      expect((follower.py - (cy - f * 290)) * f).toBeGreaterThan(0);
    }
  });

  test('a head-on group stays exactly half-turn symmetric', () => {
    const b = startArenaBattle(coreOnly(), coreOnly(), GAP, content, simConfig);
    for (let i = 0; i < 6; i++) {
      const x = 3 + (i % 3);
      const y = 12 + Math.floor(i / 3);
      spawnUnitForTest(b.sim, b.ctx, { side: 0, def: 'unit_soldier', x, y });
      spawnUnitForTest(b.sim, b.ctx, {
        side: 1,
        def: 'unit_soldier',
        x: W - 1 - x,
        y: H - 1 - y,
      });
    }
    const key = (sim: ArenaSim, side: number): string[] =>
      sim.units
        .filter((u) => u.side === side)
        .map((u) => {
          const x = side === 0 ? u.px : W * CU - u.px;
          const y = side === 0 ? u.py : H * CU - u.py;
          return `${String(x)},${String(y)} hp${String(u.hp)}`;
        })
        .sort();
    for (let t = 0; t < 400; t++) {
      stepArena(b.sim, b.ctx);
      expect(key(b.sim, 1)).toEqual(key(b.sim, 0));
    }
  });
});
