/**
 * Units as circles (issue #59, soft collision since issue #82): the ground
 * invariant, the spawn and wave-queue rules, save and restore. See
 * docs/rules-reference.md, "Unit geometry" and "One battle tick" step 5.
 */
import { describe, expect, test } from 'vitest';
import type { ArenaContent } from './arena.js';
import {
  createArenaContext,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import { startBattle } from './battle.js';
import {
  awayDivSmall,
  boxDist2,
  fits,
  isqrtFloorSmall,
  pushOutSolid,
  truncDivSmall,
  type World,
} from './geometry.js';
import { hashJson } from './hash.js';
import { awayDiv, isqrtCeil, isqrtFloor, truncDiv, divCeil } from './int.js';
import { CELL_UNITS, MAX_ARENA_CELLS } from './limits.js';
import type { GameMap } from './map.js';
import { startPveBattle } from './pve-battle.js';
import { Rng } from './rng.js';
import { buildReferenceBoard } from './reference-boards.js';
import { generateThreat } from './threat-gen.js';
import type { TeamState } from './team-state.js';
import {
  Lab,
  groundViolations,
  content,
  got,
  mapgen,
  mid,
  postContent,
  simConfig,
  threats,
  walk,
} from './test-support.js';
import { randomTeam } from './test-teams.js';
import { loadUnitsOrThrow } from './units.js';

const CU = CELL_UNITS;
const config = { sim: simConfig, mapgen };

function tiny(width = 12): GameMap {
  return {
    width,
    height: 16,
    partySize: 1,
    plotWidth: width,
    features: [],
    nodes: [],
  };
}

function coreOnly(x = 5): TeamState {
  const lab = new Lab(tiny());
  lab.core(x, 0);
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

/** The shipped units plus an ogre (too wide for one cell) and a dart (fast). */
const wideContent: ArenaContent = {
  ...content,
  units: loadUnitsOrThrow({
    units: [
      ...content.units.list(),
      {
        id: 'unit_ogre',
        health: 200,
        damage: 10,
        attackCooldownTicks: 10,
        moveCooldownTicks: 8,
        radius: 160,
        collisionRadius: 160,
        reach: 60,
        flying: false,
        attackType: 'melee',
      },
      {
        id: 'unit_dart',
        health: 30,
        damage: 1,
        attackCooldownTicks: 10,
        moveCooldownTicks: 1,
        radius: 60,
        collisionRadius: 60,
        reach: 60,
        flying: false,
        attackType: 'melee',
      },
    ],
  }),
};

/** A wall line across board row `row` of a 12 wide board with the given gap columns open. */
function wallLine(row: number, gaps: readonly number[], tier = 3): TeamState {
  const lab = new Lab(tiny());
  lab.core(5, 0);
  for (let x = 0; x < 12; x++) {
    if (!gaps.includes(x)) lab.put('bld_wall', x, row, 0, tier);
  }
  return lab.state;
}

// ---------------------------------------------------------------------------

describe('integer helpers', () => {
  test('isqrtFloor and isqrtCeil are exact around squares', () => {
    const rng = Rng.fromSeed(11);
    const roots = [0, 1, 2, 3, 7, 240, 4095, 1_966_080, 2_900_000];
    for (let k = 0; k < 400; k++) roots.push(rng.nextInt(3_000_000));
    for (const r of roots) {
      for (const n of [r * r - 1, r * r, r * r + 1]) {
        if (n < 0) continue;
        const f = isqrtFloor(n);
        expect(f * f).toBeLessThanOrEqual(n);
        expect((f + 1) * (f + 1)).toBeGreaterThan(n);
        expect(isqrtFloorSmall(n)).toBe(f);
        const c = isqrtCeil(n);
        expect(c * c).toBeGreaterThanOrEqual(n);
        expect(c === 0 || (c - 1) * (c - 1) < n).toBe(true);
      }
    }
    expect(() => isqrtFloor(-1)).toThrow(RangeError);
  });

  test('the small division helpers agree with the checked ones', () => {
    const rng = Rng.fromSeed(12);
    for (let k = 0; k < 2000; k++) {
      const a = rng.nextInt(2_000_000_000) - 1_000_000_000;
      const b = 1 + rng.nextInt(4_000_000);
      expect(awayDivSmall(a, b)).toBe(awayDiv(a, b));
      expect(truncDivSmall(a, b)).toBe(truncDiv(a, b));
    }
    expect(awayDiv(-7, 2)).toBe(-4);
    expect(awayDiv(7, 2)).toBe(4);
    expect(truncDiv(-7, 2)).toBe(-3);
    expect(divCeil(7, 2)).toBe(4);
    expect(divCeil(-7, 2)).toBe(-3);
  });

  test('the worst-case squared distance stays far inside the safe range', () => {
    const extent = MAX_ARENA_CELLS * CU;
    expect(2 * extent * extent).toBeLessThan(2 ** 53 / 1000);
  });
});

describe('circle against solid ground', () => {
  function worldWith(solid: [number, number][]): World {
    const grid = new Uint8Array(6 * 6);
    for (const [x, y] of solid) grid[y * 6 + x] = 1;
    return { width: 6, height: 6, solid: [grid, grid] };
  }

  test('touching is allowed, one unit closer is not', () => {
    const w = worldWith([[2, 2]]); // the square [480, 720] x [480, 720]
    expect(fits(w, 0, 72, 480 - 72, 600)).toBe(true);
    expect(fits(w, 0, 72, 480 - 71, 600)).toBe(false);
    // The corner (480, 480): (a, a) away is a * sqrt(2); 51 gives 72.12 (clear),
    // 50 gives 70.71 (inside).
    expect(fits(w, 0, 72, 480 - 51, 480 - 51)).toBe(true);
    expect(fits(w, 0, 72, 480 - 50, 480 - 50)).toBe(false);
  });

  test('the arena edge is solid', () => {
    const w = worldWith([]);
    expect(fits(w, 0, 72, 72, 72)).toBe(true);
    expect(fits(w, 0, 72, 71, 72)).toBe(false);
    expect(fits(w, 0, 72, 6 * CU - 72, 6 * CU - 72)).toBe(true);
    expect(fits(w, 0, 72, 6 * CU - 71, 100)).toBe(false);
  });

  test('push-out leaves the circle clear of the square, from every side', () => {
    const w = worldWith([[2, 2]]);
    const out = new Int32Array(2);
    const rng = Rng.fromSeed(13);
    for (let k = 0; k < 500; k++) {
      const x = 300 + rng.nextInt(600);
      const y = 300 + rng.nextInt(600);
      pushOutSolid(w, 0, 72, x, y, out);
      const nx = out[0] ?? 0;
      const ny = out[1] ?? 0;
      expect(boxDist2(nx, ny, 2, 2)).toBeGreaterThanOrEqual(72 * 72);
      expect(fits(w, 0, 72, nx, ny)).toBe(true);
    }
  });

  test('a centre inside the square leaves through the nearest face; ties follow the side frame', () => {
    const w = worldWith([[2, 2]]);
    const out = new Int32Array(2);
    // Exactly in the middle of the square: all four faces tie.
    pushOutSolid(w, 0, 72, 600, 600, out);
    expect([out[0], out[1]]).toEqual([480 - 72, 600]); // side 0: left first
    pushOutSolid(w, 1, 72, 600, 600, out);
    expect([out[0], out[1]]).toEqual([720 + 72, 600]); // side 1: the mirror, right
    pushOutSolid(w, 0, 72, 500, 710, out);
    expect([out[0], out[1]]).toEqual([500, 720 + 72]); // the top face is nearest
  });
});

describe('the ground invariant: nothing inside blocked ground or outside the arena', () => {
  test('random one-plot battles keep it at every tick', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = startBattle(
        { teamA: randomTeam(seed, 1), teamB: randomTeam(seed + 30, 1), seed },
        content,
        config,
      );
      if (!s.ok) throw new Error('refused');
      const { battle } = s;
      let ticks = 0;
      while (!battle.isOver() && ticks < 1500) {
        battle.step();
        ticks += 1;
        expect(groundViolations(battle.sim, battle.ctx)).toEqual([]);
      }
    }
  }, 120_000);

  test('PvE battles with queued waves keep it, whatever the ground', () => {
    for (const [arch, round] of [
      ['arch_rusher', 6],
      ['arch_fortress', 5],
      ['arch_escalator', 7],
      ['arch_boss', 8],
    ] as const) {
      const threat = generateThreat(
        {
          seed: 40 + round,
          round,
          type: 'hard',
          partySize: 1,
          archetype: arch,
        },
        content,
        { threats, mapgen },
      );
      const s = startPveBattle(
        {
          team: buildReferenceBoard('fortify', content, mapgen),
          threat,
          seed: 5,
        },
        content,
        config,
      );
      if (!s.ok) throw new Error('refused');
      const { battle } = s;
      let ticks = 0;
      while (!battle.isOver() && ticks < 1200) {
        battle.step();
        ticks += 1;
        expect(groundViolations(battle.sim, battle.ctx)).toEqual([]);
      }
    }
  }, 120_000);

  test('a dense scramble of units in a small arena keeps it, and nobody is lost', () => {
    const { sim, ctx } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      2,
      content,
      simConfig,
    );
    // Seventy soldiers and raiders of both sides packed into the gap rows.
    const rng = Rng.fromSeed(77);
    let placed = 0;
    for (let k = 0; k < 400 && placed < 70; k++) {
      try {
        spawnUnitForTest(sim, ctx, {
          side: k % 2,
          def: k % 3 === 0 ? 'unit_raider' : 'unit_soldier',
          px: 80 + rng.nextInt(12 * CU - 160),
          py: 14 * CU + rng.nextInt(7 * CU),
        });
        placed += 1;
      } catch {
        // taken
      }
    }
    expect(placed).toBeGreaterThan(40);
    for (let t = 0; t < 400; t++) {
      stepArena(sim, ctx);
      expect(groundViolations(sim, ctx)).toEqual([]);
    }
  });

  test('a fast unit never tunnels through a wall', () => {
    // Sealed base: the walls are breached, never crossed. The dart walks 240
    // sub-cell units a tick, a full cell: a naive move would jump a wall.
    const { sim, ctx } = startArenaBattle(
      coreOnly(),
      wallLine(8, [], 3),
      4,
      wideContent,
      simConfig,
    );
    const darts = [3, 5, 8].map((x) =>
      spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_dart', x, y: 17 }),
    );
    // Side 1's wall row 8 is arena row 35 - 8 = 27.
    const wallRowLow = 27 * CU;
    for (let t = 0; t < 120; t++) {
      stepArena(sim, ctx);
      for (const d of darts) {
        // Radius 60: the centre stays below the wall row's lower edge.
        expect(d.py + 60).toBeLessThanOrEqual(wallRowLow);
      }
      expect(groundViolations(sim, ctx)).toEqual([]);
    }
  });
});

describe('gaps and diameters', () => {
  /** Runs a unit from just in front of a wall row with the given gap. */
  function through(gaps: number[], def: string, x: number): number {
    const { sim, ctx } = startArenaBattle(
      coreOnly(),
      wallLine(8, gaps),
      4,
      wideContent,
      simConfig,
    );
    const u = spawnUnitForTest(sim, ctx, { side: 0, def, x, y: 20 });
    // Side 1's wall row 8 is arena row 27; past it is row 28.
    let furthest = u.py;
    for (let t = 0; t < 600; t++) {
      stepArena(sim, ctx);
      if (!sim.units.includes(u)) break;
      furthest = Math.max(furthest, u.py);
    }
    return furthest;
  }

  test('a soldier passes a one-cell gap, an ogre (diameter 320) does not', () => {
    // After the gap the ground leads on to side 1's Core, 7 cells further up.
    const wallTop = 28 * CU;
    expect(through([6], 'unit_soldier', 6)).toBeGreaterThan(wallTop + 200);
    expect(through([6], 'unit_ogre', 6)).toBeLessThan(27 * CU);
  });

  test('the same ogre passes a two-cell gap (diameter 320 < 480)', () => {
    const wallTop = 28 * CU;
    expect(through([5, 6], 'unit_ogre', 6)).toBeGreaterThan(wallTop + 200);
  });
});

describe('save and restore at any tick', () => {
  test('a battle restored at a random tick continues exactly like the original', () => {
    const rng = Rng.fromSeed(5);
    for (let seed = 1; seed <= 6; seed++) {
      const a = randomTeam(seed, 1);
      const b = randomTeam(seed + 20, 1);
      const events: ArenaEvent[] = [];
      const ref = startArenaBattle(a, b, 6, content, simConfig);
      for (let t = 0; t < 700; t++) stepArena(ref.sim, ref.ctx);
      const at = 1 + rng.nextInt(698);
      const sim2 = startArenaBattle(a, b, 6, content, simConfig).sim;
      let ctx2 = createArenaContext(sim2, content, simConfig, { events });
      let s2 = sim2;
      for (let t = 0; t < 700; t++) {
        if (t === at) {
          s2 = JSON.parse(JSON.stringify(s2)) as ArenaSim;
          ctx2 = createArenaContext(s2, content, simConfig, { events });
        }
        stepArena(s2, ctx2);
      }
      expect(hashJson(s2)).toBe(hashJson(ref.sim));
    }
  }, 120_000);

  test('a battle with a waiting queue restores at any of several ticks', () => {
    // A wave of 1200 soldiers is larger than the front row can hold at once
    // (24 cells, nine positions each; as in the `battle.wave-queue` golden
    // vector): the rest waits in the `entering` queue while the row clears.
    const wide: GameMap = { ...tiny(24), plotWidth: 24 };
    const lab = new Lab(wide);
    lab.core(11, 0);
    const make = () =>
      startArenaBattle(lab.state, lab.state, 4, content, simConfig, {
        sideOptions: [
          null,
          {
            scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 1200 }],
            coreHealths: [200000],
          },
        ],
      });
    const ref = make();
    let waitingTicks = 0;
    const waitingAt: number[] = [];
    for (let t = 0; t < 300; t++) {
      stepArena(ref.sim, ref.ctx);
      if (ref.sim.entering.length > 0) {
        waitingTicks += 1;
        waitingAt.push(t);
      }
    }
    // The queue is non-empty for many ticks (about 50: the units spread
    // along the front instead of queueing in file) and has emptied by the end.
    expect(waitingTicks).toBeGreaterThanOrEqual(40);
    expect(waitingAt[0]).toBe(0);
    const ats = [0, 15, 30, 45].map(
      (k) => (waitingAt[Math.min(k, waitingTicks - 1)] ?? 0) + 1,
    );
    for (const at of ats) {
      const b = make();
      let sim = b.sim;
      let ctx = b.ctx;
      for (let t = 0; t < 300; t++) {
        if (t === at) {
          // Restore between two ticks with entries waiting.
          expect(sim.entering.length).toBeGreaterThan(0);
          sim = JSON.parse(JSON.stringify(sim)) as ArenaSim;
          ctx = createArenaContext(sim, content, simConfig);
        }
        stepArena(sim, ctx);
      }
      expect(hashJson(sim)).toBe(hashJson(ref.sim));
    }
  }, 120_000);

  test('held producers restore at any tick; the spawn cell cache is rebuilt identically, also after a destruction', () => {
    // A barracks whose only exit is blocked by two frozen boulders holds its
    // finished unit for the whole run; at tick 300 a wall is destroyed, which
    // opens another exit cell and drops the cached candidate cells.
    const lab = new Lab({
      ...tiny(),
      nodes: [{ x: 2, y: 2, resource: 'res_a' }],
    });
    lab.core(8, 0);
    const src = lab.put('bld_extractor', 2, 2, 0, 1);
    const bar = lab.put('bld_barracks', 2, 5, 0, 1);
    lab.link(src, 'north', bar, 'south', [
      [2, 3],
      [2, 4],
    ]);
    for (const [x, y] of [
      [1, 5],
      [1, 6],
      [4, 5],
      [4, 6],
      [2, 7],
      [3, 7],
      [3, 4],
    ] as const) {
      lab.put('bld_wall', x, y);
    }
    const make = () => {
      const b = startArenaBattle(
        lab.state,
        coreOnly(),
        4,
        postContent,
        simConfig,
      );
      const pins = new Map<number, [number, number]>();
      for (const [side, px, py] of [
        [0, mid(2), mid(4)],
        [1, mid(2), mid(4) - 60],
      ] as const) {
        const u = spawnUnitForTest(b.sim, b.ctx, {
          side,
          def: 'unit_boulder',
          px,
          py,
          allowOverlap: true,
        });
        pins.set(u.id, [px, py]);
      }
      return { ...b, pins };
    };
    const advance = (
      sim: ArenaSim,
      ctx: ReturnType<typeof createArenaContext>,
      pins: Map<number, [number, number]>,
      tick: number,
    ): void => {
      if (tick === 300) {
        const wall = got(
          ctx.arena.buildings.find((x) => x.def === 'bld_wall' && x.side === 0),
        );
        const h = got(
          sim.health.find(
            (x) => x.side === 0 && 'building' in x && x.building === wall.id,
          ),
        );
        h.hp = 0; // destroyed in step 6 of this tick
      }
      stepArena(sim, ctx);
      for (const u of sim.units) {
        const at = pins.get(u.id);
        if (at !== undefined) [u.px, u.py] = at;
      }
    };
    const ref = make();
    for (let t = 0; t < 340; t++) {
      advance(ref.sim, ref.ctx, ref.pins, t);
      if (t === 299) {
        // Held: the finished unit waits, nothing was spawned yet.
        const p = got(ref.sim.producers.find((x) => x.building === bar));
        expect(p.progress).toBeGreaterThanOrEqual(6);
        expect(ref.sim.units).toHaveLength(2);
      }
    }
    // The destroyed wall opened another exit: the unit came out.
    expect(ref.sim.units.length).toBeGreaterThan(2);
    for (const at of [3, 150, 299, 300, 301, 330]) {
      const b = make();
      let { sim, ctx } = b;
      for (let t = 0; t < 340; t++) {
        if (t === at) {
          sim = JSON.parse(JSON.stringify(sim)) as ArenaSim;
          ctx = createArenaContext(sim, postContent, simConfig);
        }
        advance(sim, ctx, b.pins, t);
      }
      expect(hashJson(sim)).toBe(hashJson(ref.sim));
      // The cache holds the same candidate cells (destroyed buildings are not
      // in a restored arena, so compare what is cached, not the indices).
      const cached = (c: typeof ctx) =>
        [...c.spawnCells.entries()]
          .sort((p, q) => p[0] - q[0])
          .map(([, x]) => [...x]);
      // (Rebuilt on demand, so only when the producer still had to place its
      // unit after the restore.)
      if (at <= 301) {
        expect(cached(ctx)).toEqual(cached(ref.ctx));
        expect(cached(ctx).length).toBeGreaterThan(0);
      }
    }
  }, 60_000);

  test('two runs of the same battle are identical', () => {
    const a = randomTeam(4, 2);
    const b = randomTeam(9, 2);
    const hashes = [0, 1].map(() => {
      const r = startArenaBattle(a, b, 6, content, simConfig);
      for (let t = 0; t < 500; t++) stepArena(r.sim, r.ctx);
      return [hashJson(r.sim), hashJson(r.events)];
    });
    expect(hashes[0]).toEqual(hashes[1]);
  });
});

/**
 * Wave queue with units of different collision radii. The front row of the
 * board has one open cell (arena column 5, row 15: lakes on both sides); the
 * offsets tried inside it scale with `120 - radius`, so the stout unit (radius
 * 90) and the bulky one (radius 100) try different positions. Two posts
 * (radius 72) are placed so that the bulky one has no free position and the
 * stout one has (a unit enters only where it overlaps nothing by more than
 * half its collision radius).
 */
describe('wave queue with mixed collision radii', () => {
  const queueContent: ArenaContent = {
    ...postContent,
    units: loadUnitsOrThrow({
      units: [
        ...postContent.units.list(),
        {
          id: 'unit_wide',
          health: 100,
          damage: 1,
          attackCooldownTicks: 10,
          moveCooldownTicks: 240,
          radius: 120,
          collisionRadius: 120,
          reach: 0,
          flying: false,
          attackType: 'melee' as const,
        },
        ...(['unit_stout', 'unit_bulky'] as const).map((id) => ({
          id,
          health: 100,
          damage: 1,
          attackCooldownTicks: 10,
          moveCooldownTicks: 240,
          radius: id === 'unit_stout' ? 90 : 100,
          collisionRadius: id === 'unit_stout' ? 90 : 100,
          reach: 0,
          flying: false,
          attackType: 'melee' as const,
        })),
      ],
    }),
  };

  function oneOpenCellRow(): TeamState {
    const features = [];
    for (let x = 0; x < 12; x++) {
      if (x !== 5) features.push({ x, y: 15, feature: 'ter_lake' });
    }
    const lab = new Lab({ ...tiny(), features });
    lab.core(8, 0);
    return lab.state;
  }

  function run(
    queue: readonly string[],
    posts: readonly (readonly [number, number])[],
  ) {
    const waves = queue.map((unit) => ({ tick: 0, unit, count: 1 }));
    const { sim, ctx } = startArenaBattle(
      oneOpenCellRow(),
      coreOnly(),
      4,
      queueContent,
      simConfig,
      { sideOptions: [{ scheduledWaves: waves }, null] },
    );
    for (const [px, py] of posts) {
      spawnUnitForTest(sim, ctx, { side: 0, def: 'unit_post', px, py });
    }
    const before = sim.units.length;
    stepArena(sim, ctx);
    // Positions as spawned, give or take the one step of a unit that already
    // started walking (speed 1).
    const entered = sim.units
      .slice(before)
      .map((u) => [u.def, Math.round(u.px / 4) * 4, Math.round(u.py / 4) * 4]);
    return { entered, waiting: sim.entering.map((e) => e.unit) };
  }

  test('a smaller unit enters where the larger one in front of it found no room', () => {
    const r = run(
      ['unit_bulky', 'unit_stout'],
      [
        [1331, 3831],
        [1355, 3612],
      ],
    );
    expect(r.entered).toEqual([['unit_stout', 1292, 3700]]);
    expect(r.waiting).toEqual(['unit_bulky']);
  });

  test('units of the same radius behind a failed one wait, in order', () => {
    const r = run(
      ['unit_bulky', 'unit_bulky', 'unit_stout'],
      [
        [1331, 3831],
        [1355, 3612],
      ],
    );
    expect(r.entered).toEqual([['unit_stout', 1292, 3700]]);
    expect(r.waiting).toEqual(['unit_bulky', 'unit_bulky']);
  });

  test('an overlap deeper than half the new unit collision radius blocks the entry, a lighter one does not', () => {
    // The wide unit (collision radius 120) has one position in the cell, its
    // centre (1320, 3720). A post (72) at distance D overlaps it by
    // 192 - D; half the radius is 60, so D = 132 is let in and D = 131 is not.
    for (const [dist, enters] of [
      [132, true],
      [200, true],
      [131, false],
      [100, false],
    ] as const) {
      const r = run(['unit_wide'], [[1320, 3720 - dist]]);
      expect(r.entered.length).toBe(enters ? 1 : 0);
      expect(r.waiting.length).toBe(enters ? 0 : 1);
    }
  });
});

describe('producers hold, waves queue', () => {
  function walledBarracks(extractorTier = 1): { lab: Lab; bar: number } {
    const lab = new Lab({
      ...tiny(),
      nodes: [{ x: 2, y: 2, resource: 'res_a' }],
    });
    lab.core(8, 0);
    const src = lab.put('bld_extractor', 2, 2, 0, extractorTier);
    const bar = lab.put('bld_barracks', 2, 5, 0, 1);
    lab.link(src, 'north', bar, 'south', [
      [2, 3],
      [2, 4],
    ]);
    for (const [x, y] of [
      [1, 5],
      [1, 6],
      [4, 5],
      [4, 6],
      [2, 7],
      [3, 7],
      [3, 4],
    ] as const) {
      lab.put('bld_wall', x, y);
    }
    return { lab, bar };
  }

  test('a finished unit with no room is held: progress stays, the buffer fills, the source stalls', () => {
    const { lab, bar } = walledBarracks();
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnly(),
      4,
      postContent,
      simConfig,
    );
    // A boulder and an enemy boulder stand on the only exit.
    const blocker = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_boulder',
      x: 2,
      y: 4,
    });
    const keeper = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_boulder',
      px: mid(2),
      py: mid(4) - 60,
      allowOverlap: true,
    });
    expect(blocker.id).toBeLessThan(keeper.id);
    // Hold both in place: freeze them by pinning their positions every tick.
    const pin = [
      [blocker, blocker.px, blocker.py],
      [keeper, keeper.px, keeper.py],
    ] as const;
    for (let t = 0; t < 400; t++) {
      stepArena(sim, ctx);
      for (const [u, x, y] of pin) {
        u.px = x;
        u.py = y;
      }
    }
    const p = got(sim.producers.find((x) => x.building === bar));
    expect(ofType(events, 'unit_spawned')).toHaveLength(0);
    expect(p.progress).toBeGreaterThanOrEqual(6); // cost of a tier 1 barracks
    expect(got(sim.boards[0].sources[0]).stalled).toBe(1);
    const consumer = got(sim.boards[0].consumers[0]);
    expect(got(consumer.inputs[0]).count).toBe(4);
    const progress = p.progress;
    for (let t = 0; t < 50; t++) {
      stepArena(sim, ctx);
      for (const [u, x, y] of pin) {
        u.px = x;
        u.py = y;
      }
    }
    expect(p.progress).toBe(progress); // nothing is drawn while a unit is held
    // The blockers go: the held unit comes out at once, from the exit cell.
    sim.units.length = 0;
    stepArena(sim, ctx);
    const out = ofType(events, 'unit_spawned');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ building: bar, px: mid(2), py: mid(4) });
    expect(p.progress).toBe(progress - 6 + 0);
  });

  test('a held producer keeps its cost while the cooldown runs down; it spawns one unit on release and waits the interval again (PP-6)', () => {
    // A tier 3 extractor (a unit's cost every 60 ticks) feeds a tier 1
    // barracks whose interval is 80: the second unit is finished while the
    // cooldown of the first still runs.
    const { lab, bar } = walledBarracks(3);
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnly(),
      4,
      postContent,
      simConfig,
    );
    const p = got(sim.producers.find((x) => x.building === bar));
    while (ofType(events, 'unit_spawned').length === 0) stepArena(sim, ctx);
    expect(p.cooldown).toBe(79);
    // Now block the exit and freeze the blockers.
    sim.units.length = 0;
    const blocker = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_boulder',
      x: 2,
      y: 4,
    });
    const keeper = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_boulder',
      px: mid(2),
      py: mid(4) - 60,
      allowOverlap: true,
    });
    const pin = [
      [blocker, blocker.px, blocker.py],
      [keeper, keeper.px, keeper.py],
    ] as const;
    const step = (): void => {
      stepArena(sim, ctx);
      for (const [u, x, y] of pin) {
        u.px = x;
        u.py = y;
      }
    };
    let finishedWithCooldown = false;
    for (let t = 0; t < 300; t++) {
      step();
      if (p.progress === 6 && p.cooldown > 0) finishedWithCooldown = true;
    }
    expect(finishedWithCooldown).toBe(true);
    // Held: the full cost, the cooldown has run out, nothing more was made.
    expect(p.progress).toBe(6);
    expect(p.cooldown).toBe(0);
    expect(ofType(events, 'unit_spawned')).toHaveLength(1);
    // Release: exactly one unit this tick (no catch-up), and a fresh cooldown.
    sim.units.length = 0;
    stepArena(sim, ctx);
    const spawns = ofType(events, 'unit_spawned');
    expect(spawns).toHaveLength(2);
    expect(p.progress).toBe(0);
    expect(p.cooldown).toBe(79);
    const releaseTick = got(spawns[1]).tick;
    // The next unit comes no earlier than the interval later.
    while (ofType(events, 'unit_spawned').length < 3) stepArena(sim, ctx);
    expect(got(ofType(events, 'unit_spawned')[2]).tick - releaseTick).toBe(80);
  });

  test('without a blocker the same barracks spawns on the first free position of its exit', () => {
    const { lab, bar } = walledBarracks();
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnly(),
      4,
      content,
      simConfig,
    );
    for (let t = 0; t < 130; t++) stepArena(sim, ctx);
    const out = ofType(events, 'unit_spawned');
    expect(out[0]).toMatchObject({ building: bar, px: mid(2), py: mid(4) });
  });

  test('units that spawn into a crowd take the next offset in the cell, then the next cell', () => {
    // A barracks with two exit cells and a post on the first one, off centre:
    // the first cell offers another free spot (an offset), a second post
    // fills it too and the unit goes to the second cell.
    const lab = new Lab({
      ...tiny(),
      nodes: [{ x: 2, y: 2, resource: 'res_a' }],
    });
    lab.core(8, 0);
    const src = lab.put('bld_extractor', 2, 2, 0, 1);
    const bar = lab.put('bld_barracks', 2, 5, 0, 1);
    lab.link(src, 'north', bar, 'south', [
      [2, 3],
      [2, 4],
    ]);
    for (const [x, y] of [
      [1, 5],
      [1, 6],
      [4, 5],
      [4, 6],
      [2, 7],
      [3, 7],
    ] as const) {
      lab.put('bld_wall', x, y);
    }
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnly(),
      4,
      postContent,
      simConfig,
    );
    // The exits are (2, 4) (a conduit cell) and (3, 4).
    const first = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_post',
      px: mid(2) - 48,
      py: mid(4) - 48,
    });
    const pins = [[first, first.px, first.py]] as const;
    for (let t = 0; t < 130; t++) {
      stepArena(sim, ctx);
      for (const [u, x, y] of pins) {
        u.px = x;
        u.py = y;
      }
    }
    const out = ofType(events, 'unit_spawned');
    expect(out).toHaveLength(1);
    const e = got(out[0]);
    expect(e.building).toBe(bar);
    // The spawn is in one of the two exit cells and overlaps the post by no
    // more than half the soldier's collision radius (23): at least
    // 72 + 47 - 23 = 96 apart.
    const cell = { x: Math.floor(e.px / CU), y: Math.floor(e.py / CU) };
    expect([2, 3]).toContain(cell.x);
    expect(cell.y).toBe(4);
    const dx = e.px - first.px;
    const dy = e.py - first.py;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(96 * 96);
  });
});

describe('movement is a function of the state', () => {
  test('a column of units walks as fast as one unit alone, without gaps opening', () => {
    // Four soldiers in a column, each 150 behind the next, all walking the
    // same way: nobody has to wait, so they keep their spacing.
    const { sim, ctx } = startArenaBattle(coreOnly(), coreOnly(), 4, content, {
      ...simConfig,
      aggroRangeCells: 0,
    });
    const column = [0, 1, 2, 3].map((k) =>
      spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_soldier',
        px: mid(5),
        py: mid(14) - k * 150,
      }),
    );
    const before = column.map((u) => u.py);
    for (let t = 0; t < 30; t++) {
      stepArena(sim, ctx);
      expect(groundViolations(sim, ctx)).toEqual([]);
    }
    const moved = column.map((u, i) => Math.abs(u.py - (before[i] ?? 0)));
    // 30 ticks at 40 a tick, all of them (up to the first turn).
    for (const m of moved) expect(m).toBeGreaterThan(900);
    expect(Math.max(...moved) - Math.min(...moved)).toBeLessThanOrEqual(80);
  });

  test('walk() reports distinct cells in order', () => {
    const { sim, ctx } = startArenaBattle(
      coreOnly(),
      coreOnly(),
      4,
      content,
      simConfig,
    );
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 14,
    });
    const path = walk(sim, ctx, u, 30);
    expect(path.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < path.length; i++) {
      const p = got(path[i - 1]);
      const q = got(path[i]);
      expect(Math.abs(p.x - q.x) + Math.abs(p.y - q.y)).toBeGreaterThan(0);
    }
  });
});
