/**
 * Soft collision (issue #82): the push pass of the motion step, the split of
 * a push between two units, the hard push-out from solid ground, and the
 * properties that follow (order independence, half-turn mirror symmetry,
 * ground invariant over seeded dense battles, measured overlap bounds). See
 * docs/rules-reference.md, "Unit geometry" and "One battle tick", step 5.
 */
import { describe, expect, test } from 'vitest';
import type { ArenaContent } from './arena.js';
import {
  createArenaContext,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
} from './arena-sim.js';
import { fits, settleOutOfSolid, type World } from './geometry.js';
import { hashJson } from './hash.js';
import { CELL_UNITS } from './limits.js';
import type { GameMap } from './map.js';
import { Rng } from './rng.js';
import type { TeamState } from './team-state.js';
import {
  Lab,
  content,
  groundViolations,
  overlapStats,
  simConfig,
} from './test-support.js';
import { MotionScratch } from './unit-motion.js';
import { loadUnitsOrThrow } from './units.js';

const CU = CELL_UNITS;

function openWorld(cells: number): World {
  const grid = new Uint8Array(cells * cells);
  return { width: cells, height: cells, solid: [grid, grid] };
}

type Kind = 'idle' | 'mover' | 'fighter';

interface Spec {
  readonly id: number;
  readonly side: number;
  readonly at: readonly [number, number];
  readonly kind: Kind;
  /** Target of a mover. */
  readonly to?: readonly [number, number];
  readonly speed?: number | undefined;
  readonly rad?: number | undefined;
}

/** Run the motion step alone; positions come back in the order of `specs`. */
function step(
  specs: readonly Spec[],
  world: World = openWorld(12),
  percent = simConfig.separationPercent,
  cap = simConfig.separationCap,
): [number, number][] {
  const units = specs.map((u) => ({
    id: u.id,
    side: u.side,
    px: u.at[0],
    py: u.at[1],
  }));
  const s = new MotionScratch();
  s.ensure(specs.length);
  specs.forEach((u, i) => {
    s.want[i] = u.kind === 'mover' ? 1 : 0;
    s.fight[i] = u.kind === 'fighter' ? 1 : 0;
    s.tx[i] = u.to?.[0] ?? 0;
    s.ty[i] = u.to?.[1] ?? 0;
    s.speed[i] = u.speed ?? 40;
    s.rad[i] = u.rad ?? 47;
  });
  s.resolve(units, world, percent, cap, 480);
  return units.map((u) => [u.px, u.py]);
}

describe('the push of one overlapping pair (percent 75, cap 40, radii 47 + 47)', () => {
  // Centres 60 apart on x: overlap 94 - 60 = 34, total push ceil(0.75 * 34)
  // = 26 (a cap of 40 does not bind).
  const A = [1000, 1000] as const;
  const B = [1060, 1000] as const;

  test('two idle allies share the push equally', () => {
    const out = step([
      { id: 1, side: 0, at: A, kind: 'idle' },
      { id: 2, side: 0, at: B, kind: 'idle' },
    ]);
    // Each takes 3/6 of 26 = 13 along x.
    expect(out).toEqual([
      [987, 1000],
      [1073, 1000],
    ]);
  });

  test('an idle ally gives way completely to a mover, who is not pushed back', () => {
    // The mover walks 20 towards +x and lands at 1020; B is at 1080, so the
    // pair is 60 apart again.
    const out = step([
      {
        id: 1,
        side: 0,
        at: [1000, 1000],
        kind: 'mover',
        to: [1100, 1000],
        speed: 20,
      },
      { id: 2, side: 0, at: [1080, 1000], kind: 'idle' },
    ]);
    // Mover weight 0, idle weight 1: the idle ally takes all 26.
    expect(out).toEqual([
      [1020, 1000],
      [1080 + 26, 1000],
    ]);
  });

  test('an idle ally also gives way completely to a fighter', () => {
    const out = step([
      { id: 1, side: 0, at: A, kind: 'fighter' },
      { id: 2, side: 0, at: B, kind: 'idle' },
    ]);
    expect(out).toEqual([[...A], [1060 + 26, 1000]]);
  });

  test('an ally fighter takes 1/3 of the push from an ally mover', () => {
    const out = step([
      {
        id: 1,
        side: 0,
        at: [1000, 1000],
        kind: 'mover',
        to: [1100, 1000],
        speed: 20,
      },
      { id: 2, side: 0, at: [1080, 1000], kind: 'fighter' },
    ]);
    // Mover 2/3: 60 * 52 / 180 = 17.3 -> 18. Fighter 1/3: 60 * 26 / 180 = 8.7 -> 9.
    expect(out).toEqual([
      [1020 - 18, 1000],
      [1080 + 9, 1000],
    ]);
  });

  test('an enemy fighter is not pushed by an enemy: the mover takes it all', () => {
    const out = step([
      {
        id: 1,
        side: 0,
        at: [1000, 1000],
        kind: 'mover',
        to: [1100, 1000],
        speed: 20,
      },
      { id: 2, side: 1, at: [1080, 1000], kind: 'fighter' },
    ]);
    expect(out).toEqual([
      [1020 - 26, 1000],
      [1080, 1000],
    ]);
  });

  test('an enemy that is not fighting shares the push equally, whether it moves or waits', () => {
    const out = step([
      { id: 1, side: 0, at: A, kind: 'idle' },
      { id: 2, side: 1, at: B, kind: 'idle' },
    ]);
    // Weights 1 and 1: 60 * 13 / 60 = 13 each.
    expect(out).toEqual([
      [987, 1000],
      [1073, 1000],
    ]);
  });

  test('two enemy fighters share the push, so a pressed-together pair separates (#103)', () => {
    // Overlap 34, 75 percent = 26 (rounded up), each takes half: 13.
    const out = step([
      { id: 1, side: 0, at: A, kind: 'fighter' },
      { id: 2, side: 1, at: B, kind: 'fighter' },
    ]);
    expect(out).toEqual([
      [987, 1000],
      [1073, 1000],
    ]);
  });

  test('an enemy mover does not push a fighter: it gives way alone', () => {
    const out = step([
      { id: 1, side: 0, at: A, kind: 'fighter' },
      { id: 2, side: 1, at: B, kind: 'idle' },
    ]);
    expect(out[0]).toEqual([...A]);
    expect(out[1]?.[0]).toBeGreaterThan(B[0]);
  });

  test('the total is capped: a deep overlap moves a pair apart by the cap, not more', () => {
    // 10 apart: overlap 84, 75 percent = 63, capped to 40: 20 each.
    const out = step([
      { id: 1, side: 0, at: [1000, 1000], kind: 'idle' },
      { id: 2, side: 0, at: [1010, 1000], kind: 'idle' },
    ]);
    expect(out).toEqual([
      [980, 1000],
      [1030, 1000],
    ]);
  });

  test('the percent is rounded up: a 1 unit overlap still moves the pair', () => {
    // 93 apart: overlap 1, total ceil(0.75) = 1, each unit takes 1/2: 0.5 -> 1.
    const out = step([
      { id: 1, side: 0, at: [1000, 1000], kind: 'idle' },
      { id: 2, side: 0, at: [1093, 1000], kind: 'idle' },
    ]);
    expect(out).toEqual([
      [999, 1000],
      [1094, 1000],
    ]);
  });

  test('units that merely touch are not pushed; percent 0 turns the push off', () => {
    expect(
      step([
        { id: 1, side: 0, at: [1000, 1000], kind: 'idle' },
        { id: 2, side: 0, at: [1094, 1000], kind: 'idle' },
      ]),
    ).toEqual([
      [1000, 1000],
      [1094, 1000],
    ]);
    expect(
      step(
        [
          { id: 1, side: 0, at: A, kind: 'idle' },
          { id: 2, side: 0, at: B, kind: 'idle' },
        ],
        openWorld(12),
        0,
        40,
      ),
    ).toEqual([[...A], [...B]]);
  });

  test('pushes of several neighbours are summed', () => {
    // Unit 2 between 1 and 3, 60 from each: the pushes cancel.
    const out = step([
      { id: 1, side: 0, at: [940, 1000], kind: 'idle' },
      { id: 2, side: 0, at: [1000, 1000], kind: 'idle' },
      { id: 3, side: 0, at: [1060, 1000], kind: 'idle' },
    ]);
    expect(out[1]).toEqual([1000, 1000]);
    expect(out[0]?.[0]).toBe(940 - 13);
    expect(out[2]?.[0]).toBe(1060 + 13);
  });
});

describe('coinciding centres are separated along both axes, the sign chosen by ids and sides', () => {
  const P: readonly [number, number] = [700, 700];

  test('allies: the lower id towards negative, the higher towards positive (side 0), on both axes', () => {
    for (const ids of [
      [1, 2],
      [1, 3],
    ] as const) {
      const out = step([
        { id: ids[0], side: 0, at: P, kind: 'idle' },
        { id: ids[1], side: 0, at: P, kind: 'idle' },
      ]);
      // total min(40, ceil(0.75 * 94)) = 40, each 1/2: 20.
      expect(out).toEqual([
        [680, 680],
        [720, 720],
      ]);
    }
  });

  test('allies of side 1 take the sign in their own frame: the other way round', () => {
    const out = step([
      { id: 1, side: 1, at: P, kind: 'idle' },
      { id: 2, side: 1, at: P, kind: 'idle' },
    ]);
    expect(out).toEqual([
      [720, 720],
      [680, 680],
    ]);
  });

  test('enemies: side 0 goes towards positive, side 1 towards negative, whatever the ids', () => {
    for (const ids of [
      [5, 6],
      [6, 5],
      [4, 7],
      [7, 4],
    ] as const) {
      const out = step([
        { id: ids[0], side: 0, at: P, kind: 'idle' },
        { id: ids[1], side: 1, at: P, kind: 'idle' },
      ]);
      expect(out).toEqual([
        [720, 720],
        [680, 680],
      ]);
    }
  });

  test('a fighter that an enemy sits on does not move: the other unit takes it all', () => {
    const out = step([
      { id: 1, side: 0, at: P, kind: 'fighter' },
      { id: 2, side: 1, at: P, kind: 'idle' },
    ]);
    expect(out[0]).toEqual([700, 700]);
    expect(out[1]).toEqual([700 - 40, 700 - 40]);
  });

  test('two allied fighters each take the whole total from each other', () => {
    const out = step([
      { id: 1, side: 0, at: [1000, 1000], kind: 'fighter' },
      { id: 2, side: 0, at: [1060, 1000], kind: 'fighter' },
    ]);
    // Total 26 each, away from the other.
    expect(out).toEqual([
      [974, 1000],
      [1086, 1000],
    ]);
  });
});

describe('a pile against a wall comes apart', () => {
  /** A wall column at cell x = 6 in a 12 x 12 world. */
  const grid = new Uint8Array(12 * 12);
  for (let y = 0; y < 12; y++) grid[y * 12 + 6] = 1;
  const world: World = { width: 12, height: 12, solid: [grid, grid] };
  const face = 6 * CU;
  type P2 = readonly [number, number];

  /** Run `ticks` steps with positions carried over. */
  function run(specs: readonly Spec[], ticks: number): [number, number][][] {
    let cur = specs;
    const history: [number, number][][] = [];
    for (let t = 0; t < ticks; t++) {
      const out = step(cur, world);
      history.push(out);
      cur = cur.map((u, i) => ({ ...u, at: out[i] ?? u.at }));
    }
    return history;
  }

  const dist = (a: P2 | undefined, b: P2 | undefined): number =>
    Math.hypot((a?.[0] ?? 0) - (b?.[0] ?? 0), (a?.[1] ?? 0) - (b?.[1] ?? 0));

  test('a coincident pair against the wall, with a crowd walking into it, separates within 3 ticks', () => {
    // Ids 1 and 3 (even sum: the old rule pushed along x, into the wall).
    const at: P2 = [face - 47, 1000];
    const specs: Spec[] = [
      { id: 1, side: 0, at, kind: 'idle' },
      { id: 3, side: 0, at, kind: 'idle' },
      ...[5, 7, 9].map((id, k): Spec => ({
        id,
        side: 0,
        at: [face - 47 - 70, 1000 + (k - 1) * 20],
        kind: 'mover',
        to: [face, 1000],
      })),
    ];
    const h = run(specs, 12);
    const apart = h.findIndex((o) => dist(o[0], o[1]) >= 47);
    expect(apart).toBeGreaterThanOrEqual(0);
    expect(apart).toBeLessThanOrEqual(2);
  });

  test('allied fighters at the wall, with movers behind them, are not crushed together for more than a few ticks', () => {
    const specs: Spec[] = [
      { id: 1, side: 0, at: [face - 47, 1000], kind: 'fighter' },
      { id: 3, side: 0, at: [face - 47, 1020], kind: 'fighter' },
      ...[5, 7, 9, 11, 13, 15, 17, 19].map((id, k): Spec => ({
        id,
        side: 0,
        at: [face - 47 - 50 - 40 * (k % 2), 980 + 25 * k],
        kind: 'mover',
        to: [face, 1010],
      })),
    ];
    const h = run(specs, 60);
    // Overlap deeper than half the radius sum (94): centres closer than 47.
    const deep = h.filter((o) => dist(o[0], o[1]) < 47).length;
    expect(deep).toBeLessThanOrEqual(4);
  });

  test('the mirror image of a coincident group gives the mirrored result', () => {
    const rot = (v: number): number => 12 * CU - v;
    const open = openWorld(12);
    // Ids 1 <-> 2 and 3 <-> 4 are twins on opposite sides.
    const a = step(
      [
        { id: 1, side: 0, at: [900, 700], kind: 'idle' },
        { id: 3, side: 0, at: [900, 700], kind: 'idle' },
        { id: 2, side: 1, at: [900, 700], kind: 'idle' },
      ],
      open,
    );
    const b = step(
      [
        { id: 2, side: 1, at: [rot(900), rot(700)], kind: 'idle' },
        { id: 4, side: 1, at: [rot(900), rot(700)], kind: 'idle' },
        { id: 1, side: 0, at: [rot(900), rot(700)], kind: 'idle' },
      ],
      open,
    );
    for (let i = 0; i < 3; i++) {
      expect(b[i]).toEqual([rot(a[i]?.[0] ?? 0), rot(a[i]?.[1] ?? 0)]);
    }
  });
});

// ---------------------------------------------------------------------------
// Random scenarios: order independence and half-turn mirror symmetry

function randomScenario(rng: Rng, n: number): Spec[] {
  const specs: Spec[] = [];
  for (let k = 0; k < n; k++) {
    const kind =
      (['idle', 'mover', 'fighter'] as const)[rng.nextInt(3)] ?? 'idle';
    // A cluster in a 3 x 3 cell area; some pairs on the very same spot.
    const clone = k > 0 && rng.nextInt(6) === 0 ? specs[k - 1] : undefined;
    const at: [number, number] = clone
      ? [clone.at[0], clone.at[1]]
      : [4 * CU + rng.nextInt(3 * CU), 4 * CU + rng.nextInt(3 * CU)];
    specs.push({
      id: k + 1,
      side: rng.nextInt(2),
      at,
      kind,
      to: [4 * CU + rng.nextInt(3 * CU), 4 * CU + rng.nextInt(3 * CU)],
      speed: 20 + rng.nextInt(60),
      rad: [39, 47, 60, 72][rng.nextInt(4)] ?? 47,
    });
  }
  return specs;
}

/** The side of the odd id `2m - 1`; remembered so its partner `2m` gets the other. */
const pairSides = new Map<number, number>();
function pairSide(rng: Rng, id: number): number {
  const odd = id % 2 === 1 ? id : id - 1;
  let side = pairSides.get(odd);
  if (side === undefined) {
    side = rng.nextInt(2);
    pairSides.set(odd, side);
  }
  return side;
}

describe('properties of the push pass over random clusters', () => {
  test('the result does not depend on the order of the unit array', () => {
    const rng = Rng.fromSeed(11);
    for (let run = 0; run < 400; run++) {
      const specs = randomScenario(rng, 4 + rng.nextInt(24));
      const plain = step(specs);
      const order = rng.shuffle(specs.map((_, i) => i));
      const shuffled = step(order.map((i) => specs[i] as Spec));
      order.forEach((orig, pos) => {
        expect(shuffled[pos]).toEqual(plain[orig]);
      });
    }
  });

  test('a mirrored scenario (sides swapped, a half turn about the centre of the arena) gives the mirrored result', () => {
    // Mirror image of unit id `k`: id `k + 1` if k is odd, `k - 1` if even (in
    // a mirror match the two sides alternate in spawn order), rotated 180
    // degrees about the middle of the 12 x 12 cell world, on the other side.
    const rot = (v: number): number => 12 * CU - v;
    const twin = (id: number): number => (id % 2 === 1 ? id + 1 : id - 1);
    const rng = Rng.fromSeed(12);
    for (let run = 0; run < 400; run++) {
      pairSides.clear();
      const n = 2 * (2 + rng.nextInt(12));
      const specs = randomScenario(rng, n).map((u) => ({
        ...u,
        // Ids 2m - 1 and 2m are on opposite sides, as in a mirror match.
        side: u.id % 2 === 1 ? pairSide(rng, u.id) : 1 - pairSide(rng, u.id),
      }));
      // Build the mirror: unit k's image is the unit with id twin(k).
      const mirror: Spec[] = [];
      for (const u of specs) {
        mirror[twin(u.id) - 1] = {
          id: twin(u.id),
          side: 1 - u.side,
          at: [rot(u.at[0]), rot(u.at[1])],
          kind: u.kind,
          to: [rot(u.to?.[0] ?? 0), rot(u.to?.[1] ?? 0)],
          speed: u.speed,
          rad: u.rad,
        };
      }
      const plain = step(specs);
      const flipped = step(mirror);
      specs.forEach((u, i) => {
        const j = twin(u.id) - 1;
        expect(flipped[j]).toEqual([
          rot(plain[i]?.[0] ?? 0),
          rot(plain[i]?.[1] ?? 0),
        ]);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Solid ground

describe('hard push-out from solid ground', () => {
  /** A 6 x 6 world with a wall column and some pillars (both sides alike). */
  function wallWorld(rng: Rng): World {
    const grid = new Uint8Array(36);
    for (let k = 0; k < 8; k++) grid[rng.nextInt(36)] = 1;
    const g2 = Uint8Array.from(grid);
    // Side 1 has a few more solid cells (a building of side 0 blocks it).
    for (let k = 0; k < 3; k++) g2[rng.nextInt(36)] = 1;
    return { width: 6, height: 6, solid: [grid, g2] };
  }

  test('settleOutOfSolid ends where the circle fits when the fallback fits, and is idempotent', () => {
    const rng = Rng.fromSeed(21);
    const out = new Int32Array(2);
    const again = new Int32Array(2);
    let moved = 0;
    for (let run = 0; run < 3000; run++) {
      const world = wallWorld(rng);
      const side = rng.nextInt(2);
      const r = [20, 39, 47, 72, 110][rng.nextInt(5)] ?? 47;
      // A fitting fallback.
      let fx = 0;
      let fy = 0;
      let found = false;
      for (let k = 0; k < 200 && !found; k++) {
        fx = rng.nextInt(6 * CU);
        fy = rng.nextInt(6 * CU);
        found = fits(world, side, r, fx, fy);
      }
      if (!found) continue;
      // Any target, also far outside the arena.
      const x = rng.nextInt(10 * CU) - 2 * CU;
      const y = rng.nextInt(10 * CU) - 2 * CU;
      settleOutOfSolid(world, side, r, x, y, fx, fy, out);
      expect(fits(world, side, r, out[0] ?? 0, out[1] ?? 0)).toBe(true);
      if (out[0] !== x || out[1] !== y) moved += 1;
      // Idempotent: a second application changes nothing, whatever the
      // fallback.
      settleOutOfSolid(world, side, r, out[0] ?? 0, out[1] ?? 0, fx, fy, again);
      expect([again[0], again[1]]).toEqual([out[0], out[1]]);
    }
    expect(moved).toBeGreaterThan(1000);
  });

  test('a unit pushed into a wall by a mover ends outside it', () => {
    // A wall column at cell x = 6; the idle ally is 10 units from its face,
    // and a mover coming from the left pushes it into the wall.
    const grid = new Uint8Array(12 * 12);
    for (let y = 0; y < 12; y++) grid[y * 12 + 6] = 1;
    const world: World = { width: 12, height: 12, solid: [grid, grid] };
    const face = 6 * CU;
    const out = step(
      [
        {
          id: 1,
          side: 0,
          at: [face - 47 - 60, 1000],
          kind: 'mover',
          to: [face, 1000],
          speed: 40,
        },
        { id: 2, side: 0, at: [face - 47 - 10, 1000], kind: 'idle' },
      ],
      world,
    );
    expect(out[1]?.[0]).toBeLessThanOrEqual(face - 47);
    expect(fits(world, 0, 47, out[1]?.[0] ?? 0, out[1]?.[1] ?? 0)).toBe(true);
    expect(fits(world, 0, 47, out[0]?.[0] ?? 0, out[0]?.[1] ?? 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A waiting ally is not a wall

describe('a waiting ally does not block a mover for long', () => {
  /** A corridor `width` cells wide and 12 long, running along +y, in a 12 x 12 world. */
  function corridor(width: number): World {
    const grid = new Uint8Array(12 * 12).fill(1);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < width; x++) grid[y * 12 + 3 + x] = 0;
    }
    return { width: 12, height: 12, solid: [grid, grid] };
  }

  /**
   * Ticks until a mover that starts 2 cells behind a waiting ally and walks
   * to a target 8 cells ahead (the ally in its way, `offset` to the side) is
   * at its target. Alone it needs 48 ticks (40 units a tick).
   */
  function ticksToReach(width: number, offset: number): number {
    const world = corridor(width);
    const cx = 3 * CU + (width * CU) / 2;
    const units = [
      { id: 1, side: 0, px: cx, py: 2 * CU },
      { id: 2, side: 0, px: cx + offset, py: 4 * CU },
    ];
    const s = new MotionScratch();
    s.ensure(2);
    s.want[0] = 1;
    s.tx[0] = cx;
    s.ty[0] = 10 * CU;
    s.speed[0] = 40;
    s.rad[0] = 47;
    s.rad[1] = 47;
    for (let t = 1; t <= 300; t++) {
      s.resolve(units, world, 75, 40, 480);
      const a = units[0];
      const b = units[1];
      if (a === undefined || b === undefined) throw new Error('missing');
      expect(fits(world, 0, 47, a.px, a.py)).toBe(true);
      expect(fits(world, 0, 47, b.px, b.py)).toBe(true);
      if (a.py === 10 * CU) return t;
    }
    return 300;
  }

  test('in a corridor two cells wide a waiting ally costs the mover at most 2 ticks', () => {
    for (const offset of [0, 20, -20, 100, -100]) {
      expect(ticksToReach(2, offset)).toBeLessThanOrEqual(48 + 2);
    }
  });

  test('in a corridor one cell wide the ally gives way too: at most 2 ticks lost', () => {
    expect(ticksToReach(1, 0)).toBeLessThanOrEqual(48 + 2);
    expect(ticksToReach(1, 30)).toBeLessThanOrEqual(48 + 2);
  });
});

// ---------------------------------------------------------------------------
// The ground invariant over seeded dense battles

/** Extreme but legal units: a dart (240 per tick), a mite (radius 20), an ogre. */
const extremeContent: ArenaContent = {
  ...content,
  units: loadUnitsOrThrow({
    units: [
      ...content.units.list(),
      {
        id: 'unit_dart',
        health: 60,
        damage: 1,
        attackCooldownTicks: 10,
        moveCooldownTicks: 1,
        radius: 60,
        collisionRadius: 60,
        reach: 60,
        flying: false,
        attackType: 'melee',
      },
      {
        id: 'unit_mite',
        health: 40,
        damage: 1,
        attackCooldownTicks: 8,
        moveCooldownTicks: 5,
        radius: 20,
        collisionRadius: 20,
        reach: 20,
        flying: false,
        attackType: 'melee',
      },
      {
        id: 'unit_ogre',
        health: 400,
        damage: 3,
        attackCooldownTicks: 12,
        moveCooldownTicks: 9,
        radius: 170,
        collisionRadius: 170,
        reach: 60,
        flying: false,
        attackType: 'melee',
      },
    ],
  }),
};

function tinyMap(): GameMap {
  return {
    width: 12,
    height: 16,
    partySize: 1,
    plotWidth: 12,
    features: [],
    nodes: [],
  };
}

/** A board with wall rows that leave gaps one or two cells wide, plus pillars. */
function corridorBoard(rng: Rng): TeamState {
  const lab = new Lab(tinyMap());
  lab.core(5, 0);
  for (let row = 4; row <= 14; row += 2 + rng.nextInt(2)) {
    const gap = 1 + rng.nextInt(2);
    const at = rng.nextInt(12 - gap + 1);
    for (let x = 0; x < 12; x++) {
      if (x >= at && x < at + gap) continue;
      try {
        lab.put('bld_wall', x, row, 0, 3);
      } catch {
        // occupied
      }
    }
  }
  for (let k = rng.nextInt(5); k > 0; k--) {
    try {
      lab.put('bld_wall', rng.nextInt(12), 4 + rng.nextInt(11), 0, 3);
    } catch {
      // occupied
    }
  }
  return lab.state;
}

/** Unit mixes: a seed picks one, so some runs are all darts or all mites. */
const MIXES: readonly (readonly string[])[] = [
  ['unit_dart', 'unit_dart', 'unit_mite'],
  ['unit_dart', 'unit_mite', 'unit_mite', 'unit_mite', 'unit_ogre'],
  ['unit_dart', 'unit_dart', 'unit_dart', 'unit_ogre'],
  ['unit_mite'],
  ['unit_dart', 'unit_soldier', 'unit_raider', 'unit_mite'],
];

/** A dense random battle, ready to step. */
function denseBattle(seed: number) {
  const rng = Rng.fromSeed(seed);
  const { sim, ctx } = startArenaBattle(
    corridorBoard(rng),
    corridorBoard(rng),
    2 + rng.nextInt(4),
    extremeContent,
    simConfig,
  );
  const height = ctx.arena.geom.height;
  const yc = rng.nextInt(height * CU);
  const want = 25 + rng.nextInt(60);
  const mix = MIXES[seed % MIXES.length] ?? [];
  // Half of the runs start units on cell centres: darts then reach the same
  // targets exactly, so units pile up on the same spots.
  const snap = seed % 2 === 0;
  let placed = 0;
  for (let k = 0; k < 600 && placed < want; k++) {
    try {
      spawnUnitForTest(sim, ctx, {
        side: rng.nextInt(2),
        def: mix[rng.nextInt(mix.length)] ?? 'unit_mite',
        px: snap ? rng.nextInt(12) * CU + CU / 2 : rng.nextInt(12 * CU),
        py: snap
          ? Math.max(
              0,
              Math.min(height - 1, Math.floor(yc / CU) + rng.nextInt(7) - 3),
            ) *
              CU +
            CU / 2
          : Math.max(
              0,
              Math.min(height * CU - 1, yc + rng.nextInt(7 * CU) - 3 * CU),
            ),
        allowOverlap: true,
      });
      placed += 1;
    } catch {
      // not open
    }
  }
  return { sim, ctx };
}

/** One dense random battle; returns the first violations found, or none. */
function runOne(seed: number, ticks: number): string[] {
  const { sim, ctx } = denseBattle(seed);
  for (let t = 0; t < ticks; t++) {
    stepArena(sim, ctx);
    const v = groundViolations(sim, ctx);
    if (v.length > 0) {
      return v.map((m) => `seed ${String(seed)} tick ${String(t)}: ${m}`);
    }
  }
  return [];
}

describe('the ground invariant for extreme units in dense layouts', () => {
  test('groundViolations sees a unit inside a wall and throws on an unknown type', () => {
    const { sim, ctx } = startArenaBattle(
      corridorBoard(Rng.fromSeed(1)),
      corridorBoard(Rng.fromSeed(2)),
      3,
      extremeContent,
      simConfig,
    );
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_mite',
      px: 600,
      py: 4200,
    });
    expect(groundViolations(sim, ctx)).toEqual([]);
    a.px = -5;
    expect(groundViolations(sim, ctx)).toHaveLength(1);
    a.px = 600;
    (a as { def: string }).def = 'unit_typo';
    expect(() => groundViolations(sim, ctx)).toThrow(/unknown unit type/);
  });

  test('overlapStats counts the overlapping pairs and their depth', () => {
    const { sim, ctx } = startArenaBattle(
      corridorBoard(Rng.fromSeed(1)),
      corridorBoard(Rng.fromSeed(2)),
      3,
      extremeContent,
      simConfig,
    );
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_ogre',
      px: 600,
      py: 4200,
    });
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_mite',
      px: 600 + 150,
      py: 4200,
      allowOverlap: true,
    });
    // 170 + 20 = 190 against 150 apart: depth 40 (21 percent).
    expect(overlapStats(sim, ctx)).toEqual({
      pairs: 1,
      deep: 0,
      maxDepth: 40,
      maxPercent: 21,
    });
  });

  test('nothing is ever inside blocked ground or outside the arena, over thousands of seeded runs', () => {
    const failures: string[] = [];
    let runs = 0;
    for (let seed = 1; seed <= 2400 && failures.length < 5; seed++) {
      failures.push(...runOne(seed, 28).slice(0, 1));
      runs += 1;
    }
    expect(runs).toBe(2400);
    expect(failures).toEqual([]);
  }, 600_000);

  test('the same holds for longer runs (120 ticks) in the corridors', () => {
    const failures: string[] = [];
    for (let seed = 5000; seed < 5300 && failures.length < 5; seed++) {
      failures.push(...runOne(seed, 120).slice(0, 1));
    }
    expect(failures).toEqual([]);
  }, 600_000);

  test('a run restored at any tick continues exactly like the straight run', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const total = 45;
      const straight = denseBattle(seed);
      for (let t = 0; t < total; t++) stepArena(straight.sim, straight.ctx);
      const first = denseBattle(seed);
      const at = 1 + (seed % 40);
      for (let t = 0; t < at; t++) stepArena(first.sim, first.ctx);
      const sim = JSON.parse(JSON.stringify(first.sim)) as typeof first.sim;
      const ctx = createArenaContext(sim, extremeContent, simConfig);
      for (let t = at; t < total; t++) stepArena(sim, ctx);
      expect(hashJson(sim)).toBe(hashJson(straight.sim));
    }
  });
});

// ---------------------------------------------------------------------------
// Measured overlap bounds

describe('overlap is bounded', () => {
  const W = 12;

  function coreOnly(): TeamState {
    const lab = new Lab(tinyMap());
    lab.core(5, 0);
    return lab.state;
  }

  function wallLine(row: number, gaps: readonly number[]): TeamState {
    const lab = new Lab(tinyMap());
    lab.core(5, 0);
    for (let x = 0; x < W; x++) {
      if (!gaps.includes(x)) lab.put('bld_wall', x, row, 0, 3);
    }
    return lab.state;
  }

  /**
   * 60 soldiers of side 0 start (touching at most) in rows `y0 .. y1` of the
   * arena; returns the deepest overlap seen in ticks `t0 .. t1`.
   */
  function crowd(
    enemy: TeamState,
    seed: number,
    y0: number,
    y1: number,
    t0: number,
    t1: number,
  ) {
    const { sim, ctx } = startArenaBattle(
      coreOnly(),
      enemy,
      4,
      content,
      simConfig,
    );
    const rng = Rng.fromSeed(seed);
    let placed = 0;
    for (let k = 0; k < 3000 && placed < 60; k++) {
      try {
        spawnUnitForTest(sim, ctx, {
          side: 0,
          def: 'unit_soldier',
          px: 60 + rng.nextInt(W * CU - 120),
          py: y0 * CU + rng.nextInt((y1 - y0) * CU),
        });
        placed += 1;
      } catch {
        // taken
      }
    }
    expect(placed).toBe(60);
    let depth = 0;
    let percent = 0;
    let deepMax = 0;
    let deepSum = 0;
    for (let t = 1; t <= t1; t++) {
      stepArena(sim, ctx);
      expect(groundViolations(sim, ctx)).toEqual([]);
      if (t < t0) continue;
      const st = overlapStats(sim, ctx);
      depth = Math.max(depth, st.maxDepth);
      percent = Math.max(percent, st.maxPercent);
      deepMax = Math.max(deepMax, st.deep);
      deepSum += st.deep;
    }
    return { depth, percent, deepMax, deepMean: deepSum / (t1 - t0 + 1) };
  }

  test('open ground: after 40 ticks no two soldiers overlap by more than 25 percent of the sum of their radii', () => {
    // Measured over seeds 1 to 8: at most 20 percent (19 units of 94).
    let worst = 0;
    for (let seed = 1; seed <= 8; seed++) {
      worst = Math.max(worst, crowd(coreOnly(), seed, 2, 8, 40, 120).percent);
    }
    expect(worst).toBeLessThanOrEqual(25);
  });

  test('a crush at a choke (one or two cells wide): few deep overlaps, but centres can coincide for a tick', () => {
    // Measured over seeds 1 to 8 for the whole run to tick 300 (which also
    // includes the pile in front of the Core), of 60 soldiers: at most 34
    // pairs overlap by more than half the radius sum at once, 1.2 on
    // average, and the deepest overlap reaches the full radius sum for a tick
    // now and then (centres coincide, the push of a coincident pair separates
    // them in the next tick). A crowd that keeps walking into a choke
    // compresses until the push cap balances it.
    let deepMax = 0;
    let deepMean = 0;
    let worstPct = 0;
    let runs = 0;
    for (let seed = 1; seed <= 8; seed++) {
      for (const gaps of [[5], [5, 6]]) {
        const r = crowd(wallLine(8, gaps), seed, 18, 26, 20, 300);
        deepMax = Math.max(deepMax, r.deepMax);
        deepMean += r.deepMean;
        runs += 1;
        worstPct = Math.max(worstPct, r.percent);
      }
    }
    expect(deepMax).toBeLessThanOrEqual(40);
    expect(deepMean / runs).toBeLessThanOrEqual(1.5);
    // Centres come (almost) together now and then (how long pairs stay stacked
    // is pinned on whole battles in stacking.test.ts).
    expect(worstPct).toBeGreaterThanOrEqual(90);
  });

  test('overlap is temporary: a crowd whose target is gone is clear of overlap within 20 ticks', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { sim, ctx } = startArenaBattle(
        coreOnly(),
        coreOnly(),
        4,
        content,
        simConfig,
      );
      // The enemy Core is gone before the first tick: nobody has a goal.
      for (const h of sim.health) {
        if (h.side === 1 && 'core' in h && h.core === 0) h.hp = 0;
      }
      const rng = Rng.fromSeed(seed);
      let placed = 0;
      for (let k = 0; k < 3000 && placed < 60; k++) {
        try {
          spawnUnitForTest(sim, ctx, {
            side: 0,
            def: 'unit_soldier',
            px: 600 + rng.nextInt(6 * CU),
            py: 8 * CU + rng.nextInt(6 * CU),
            allowOverlap: true,
          });
          placed += 1;
        } catch {
          // not open
        }
      }
      expect(placed).toBe(60);
      expect(overlapStats(sim, ctx).pairs).toBeGreaterThan(5);
      for (let t = 0; t < 20; t++) stepArena(sim, ctx);
      expect(overlapStats(sim, ctx).pairs).toBe(0);
      expect(hashJson(sim)).toBe(hashJson(JSON.parse(JSON.stringify(sim))));
    }
  });
});
