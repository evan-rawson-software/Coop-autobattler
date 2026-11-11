/**
 * The acceptance step of the motion step against adversarial input: extreme
 * legal units (a fast dart, a tiny mite, a large ogre), dense layouts and
 * corridors one and two cells wide, at every relaxation depth. See
 * docs/rules-reference.md, "One battle tick", step 5.
 */
import { describe, expect, test } from 'vitest';
import type { ArenaContent } from './arena.js';
import { spawnUnitForTest, startArenaBattle, stepArena } from './arena-sim.js';
import type { World } from './geometry.js';
import { CELL_UNITS } from './limits.js';
import type { GameMap } from './map.js';
import { Rng } from './rng.js';
import type { SimConfig } from './sim-config.js';
import type { TeamState } from './team-state.js';
import { Lab, circleViolations, content, simConfig } from './test-support.js';
import { MotionScratch, type MotionUnit } from './unit-motion.js';
import { loadUnitsOrThrow } from './units.js';

const CU = CELL_UNITS;

function openWorld(cells: number): World {
  const grid = new Uint8Array(cells * cells);
  return { width: cells, height: cells, solid: [grid, grid] };
}

interface Move {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
}

/** Run the motion step alone: units `0..n-1` ascending id, all radius 60, speed 240. */
function resolve(
  moves: readonly Move[],
  passes: number,
  radius = 60,
): MotionUnit[] {
  const units: MotionUnit[] = moves.map((m, i) => ({
    id: i,
    side: 0,
    px: m.from[0],
    py: m.from[1],
  }));
  const s = new MotionScratch();
  s.ensure(moves.length);
  moves.forEach((m, i) => {
    s.want[i] = 1;
    s.tx[i] = m.to[0];
    s.ty[i] = m.to[1];
    s.speed[i] = 240;
    s.rad[i] = radius;
  });
  s.resolve(units, openWorld(12), passes, radius);
  return units;
}

describe('acceptance within a run of equal priority', () => {
  test('a mover sent back by the clash pass leaves no unit on top of it', () => {
    // A and B (equal priority, both reach their targets) want overlapping
    // spots, so the clash pass sends both back; C wants the spot next to A's
    // old position, which A's return would overlap. C must not be accepted.
    const units = resolve(
      [
        { from: [900, 1000], to: [1000, 1000] }, // A
        { from: [1050, 1200], to: [1050, 1000] }, // B
        { from: [860, 1200], to: [860, 1000] }, // C
      ],
      0,
    );
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        if (a === undefined || b === undefined) throw new Error('missing');
        const d2 = (a.px - b.px) ** 2 + (a.py - b.py) ** 2;
        expect(d2).toBeGreaterThanOrEqual(120 * 120);
      }
    }
    // A and B stay; C does not step onto A's old spot either.
    expect([units[0]?.px, units[0]?.py]).toEqual([900, 1000]);
    expect([units[1]?.px, units[1]?.py]).toEqual([1050, 1200]);
    expect([units[2]?.px, units[2]?.py]).toEqual([860, 1200]);
  });
});

describe('coinciding centres are separated symmetrically', () => {
  const rot = (v: number): number => 12 * CU - v;

  /** Two units whose centres coincide at (700, 700) after the step. */
  function coincide(
    kind: 'anchored' | 'movers',
    sides: readonly [number, number],
    ids: readonly [number, number],
    mirrored: boolean,
  ): { id: number; side: number; px: number; py: number }[] {
    const flip = mirrored ? 1 : 0;
    const s0 = (sides[0] + flip) % 2;
    const s1 = (sides[1] + flip) % 2;
    const at = (x: number, y: number): [number, number] =>
      mirrored ? [rot(x), rot(y)] : [x, y];
    const [ax, ay] = at(560, 700); // first unit: 140 from the spot
    const [bx, by] = at(700, 700); // second unit's start or the spot
    const [cx, cy] = at(700, 560);
    const units = [
      {
        id: ids[0] + (mirrored ? 4 : 0),
        side: s0,
        px: ax,
        py: ay,
      },
      {
        id: ids[1] + (mirrored ? 4 : 0),
        side: s1,
        px: kind === 'anchored' ? bx : cx,
        py: kind === 'anchored' ? by : cy,
      },
    ];
    const s = new MotionScratch();
    s.ensure(2);
    // The first unit walks to (700, 700); the second stands there, or walks
    // there too from the other side (equal distance, equal priority).
    const [tx, ty] = at(700, 700);
    s.want[0] = 1;
    s.tx[0] = tx;
    s.ty[0] = ty;
    s.want[1] = kind === 'movers' ? 1 : 0;
    s.tx[1] = tx;
    s.ty[1] = ty;
    for (let i = 0; i < 2; i++) {
      s.speed[i] = 140;
      s.rad[i] = 60;
    }
    s.resolve(units, openWorld(12), 4, 60);
    return units;
  }

  test('the rule gives the same result in the mirrored battle, for every side and id combination', () => {
    let checked = 0;
    for (const kind of ['anchored', 'movers'] as const) {
      for (const sides of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ] as const) {
        for (const ids of [
          [1, 2],
          [1, 3],
          [2, 3],
          [2, 4],
          [5, 8],
        ] as const) {
          const plain = coincide(kind, sides, ids, false);
          const mirror = coincide(kind, sides, ids, true);
          // The centres did coincide and were pushed apart.
          const [p, q] = plain;
          if (p === undefined || q === undefined) throw new Error('missing');
          const d2 = (p.px - q.px) ** 2 + (p.py - q.py) ** 2;
          expect(d2).toBeGreaterThanOrEqual(120 * 120);
          for (let i = 0; i < 2; i++) {
            expect(mirror[i]?.px).toBe(rot(plain[i]?.px ?? 0));
            expect(mirror[i]?.py).toBe(rot(plain[i]?.py ?? 0));
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(40);
  });

  test('the sign is taken in the frame of the pushed unit', () => {
    // Mover id 1 (odd sum with 2: axis y) onto an anchored id 2.
    const a = coincide('anchored', [0, 0], [1, 2], false);
    expect(a[0]?.py).toBe(700 - 120);
    // The same pair with the mover on side 1: pushed the other way.
    const b = coincide('anchored', [1, 0], [1, 2], false);
    expect(b[0]?.py).toBe(700 + 120);
    // A higher id than the anchored unit: positive for side 0.
    const c = coincide('anchored', [0, 0], [2, 1], false);
    expect(c[0]?.py).toBe(700 + 120);
  });
});

// ---------------------------------------------------------------------------

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

/** One dense random battle; returns the first violations found, or none. */
function runOne(seed: number, passes: number, ticks: number): string[] {
  const rng = Rng.fromSeed(seed);
  const config: SimConfig = { ...simConfig, separationPasses: passes };
  const { sim, ctx } = startArenaBattle(
    corridorBoard(rng),
    corridorBoard(rng),
    2 + rng.nextInt(4),
    extremeContent,
    config,
  );
  const height = ctx.arena.geom.height;
  const yc = rng.nextInt(height * CU);
  const want = 25 + rng.nextInt(60);
  const mix = MIXES[seed % MIXES.length] ?? [];
  // Half of the runs start units on cell centres: darts then reach the same
  // targets exactly, which makes runs of equal priority.
  const snap = seed % 2 === 0;
  let placed = 0;
  for (let k = 0; k < 600 && placed < want; k++) {
    try {
      spawnUnitForTest(sim, ctx, {
        side: rng.nextInt(2),
        def: mix[rng.nextInt(mix.length)] ?? 'unit_mite',
        px: snap ? rng.nextInt(12) * CU + CU / 2 : rng.nextInt(12 * CU),
        py: Math.max(
          0,
          Math.min(height * CU - 1, yc + rng.nextInt(7 * CU) - 3 * CU),
        ),
      });
      placed += 1;
    } catch {
      // not open or taken
    }
  }
  for (let t = 0; t < ticks; t++) {
    stepArena(sim, ctx);
    const v = circleViolations(sim, ctx);
    if (v.length > 0) {
      return v.map(
        (m) =>
          `seed ${String(seed)} passes ${String(passes)} tick ${String(t)}: ${m}`,
      );
    }
  }
  return [];
}

describe('the invariant for extreme units in dense layouts', () => {
  test('circleViolations sees units of test-only content', () => {
    const { sim, ctx } = startArenaBattle(
      corridorBoard(Rng.fromSeed(1)),
      corridorBoard(Rng.fromSeed(2)),
      3,
      extremeContent,
      simConfig,
    );
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_ogre',
      px: 600,
      py: 4200,
    });
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_mite',
      px: 600 + 190,
      py: 4200,
      allowOverlap: true,
    });
    expect(circleViolations(sim, ctx)).toEqual([]);
    a.px += 100; // the mite (20) and the ogre (170) now overlap
    expect(circleViolations(sim, ctx)).toHaveLength(1);
  });

  test('no overlap, nothing inside blocked ground, over thousands of seeded runs', () => {
    const failures: string[] = [];
    let runs = 0;
    for (let seed = 1; seed <= 850 && failures.length < 5; seed++) {
      for (const passes of [0, 1, 2, 4]) {
        failures.push(...runOne(seed, passes, 28).slice(0, 1));
        runs += 1;
      }
    }
    expect(runs).toBeGreaterThanOrEqual(3400);
    expect(failures).toEqual([]);
  }, 600_000);
});
