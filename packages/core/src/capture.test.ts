/**
 * Points of interest, part 4 (CB-8f, #373): units passing near a point divert
 * to it, wait in its capture radius and capture it by staying there; the
 * capture step, its events and the summary.
 */
import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  placeGuards,
  spawnGuardForTest,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
  type GuardPost,
  type PointSim,
} from './arena-sim.js';
import { simulateBattle } from './battle.js';
import { hashJson } from './hash.js';
import type { GameMap } from './map.js';
import type { NeutralZone } from './neutral-zone.js';
import { Lab, content, mapgen, simConfig } from './testing/support.js';

const W = 12;
/** The zone is 7 rows deep. */
const GAP = 7;
const BOARD = 16;
/** The arena row of the zone's middle row (the points' row). */
const MID = BOARD + 3;
const CAP = content.points.capture;

function tiny(lakes: [number, number][] = []): GameMap {
  return {
    width: W,
    height: BOARD,
    partySize: 1,
    plotWidth: W,
    features: lakes
      .map(([x, y]) => ({ x, y, feature: 'ter_lake' }))
      .sort((a, b) => a.y - b.y || a.x - b.x),
    nodes: [],
  };
}

function coreOnly(x: number, map: GameMap = tiny()) {
  const lab = new Lab(map);
  lab.core(x, 0);
  return lab.state;
}

type Scene = { sim: ArenaSim; ctx: ArenaContext; events: ArenaEvent[] };

/**
 * An arena with the given points (default one at (3, MID)), no guards, a Core
 * of each side in the same column 1 (the units walk up that column).
 */
function scene(
  posts: GuardPost[] = [{ id: 0, x: 3, y: MID }],
  options: Parameters<typeof startArenaBattle>[5] = {},
  coreX = 10,
): Scene {
  const s = startArenaBattle(
    coreOnly(1),
    coreOnly(coreX),
    GAP,
    content,
    simConfig,
    options,
  );
  placeGuards(s.sim, s.ctx, {
    capture: CAP,
    leashCells: 3,
    posts,
    plans: [],
  });
  return s;
}

function run(s: Scene, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepArena(s.sim, s.ctx);
}

const point = (s: Scene, i = 0): PointSim => s.sim.points?.[i] as PointSim;
const captures = (
  s: Scene,
): Extract<ArenaEvent, { type: 'point_captured' }>[] =>
  s.events.filter(
    (e): e is Extract<ArenaEvent, { type: 'point_captured' }> =>
      e.type === 'point_captured',
  );
const starts = (
  s: Scene,
): Extract<ArenaEvent, { type: 'point_capture_started' }>[] =>
  s.events.filter(
    (e): e is Extract<ArenaEvent, { type: 'point_capture_started' }> =>
      e.type === 'point_capture_started',
  );

/** Step until `done` holds (at most `max` ticks); true if it did. */
function runUntil(s: Scene, done: () => boolean, max = 400): boolean {
  for (let t = 0; t < max && !done(); t++) stepArena(s.sim, s.ctx);
  return done();
}

/** Distance in cells (rounded down) of unit `id` from the centre of cell `(x, y)`. */
function distCells(s: Scene, id: number, x: number, y: number): number {
  const u = s.sim.units.find((q) => q.id === id);
  if (u === undefined) throw new Error('no such unit');
  const dx = u.px - (x * 240 + 120);
  const dy = u.py - (y * 240 + 120);
  return Math.sqrt(dx * dx + dy * dy) / 240;
}

describe('point state (CB-8f)', () => {
  test('every point starts uncontrolled with no progress, sorted by id', () => {
    const s = scene([
      { id: 0, x: 3, y: MID },
      { id: 1, x: 8, y: MID },
    ]);
    expect(s.sim.points).toEqual([
      { id: 0, controller: -1, progressSide: -1, progress: 0, held: [0, 0] },
      { id: 1, controller: -1, progressSide: -1, progress: 0, held: [0, 0] },
    ]);
  });

  test('the state is plain JSON and a restored battle continues the same', () => {
    const a = scene();
    spawnUnitForTest(a.sim, a.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 3,
      y: MID,
    });
    run(a, 20);
    const saved = JSON.parse(JSON.stringify(a.sim)) as ArenaSim;
    const restoredCtx = createArenaContext(saved, content, simConfig, {
      events: [],
    });
    const b: Scene = { sim: saved, ctx: restoredCtx, events: [] };
    run(a, 60);
    run(b, 60);
    expect(point(a).controller).toBe(0);
    expect(hashJson(b.sim)).toBe(hashJson(a.sim));
  });
});

describe('aggro and waiting (CB-8f)', () => {
  test('a unit outside the aggro range never diverts', () => {
    // The point is 7 columns from the units' column: they walk past.
    const s = scene([{ id: 0, x: 8, y: MID }]);
    const u = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 1,
      y: 14,
    });
    let nearest = 99;
    for (let t = 0; t < 200; t++) {
      stepArena(s.sim, s.ctx);
      nearest = Math.min(nearest, distCells(s, u.id, 8, MID));
    }
    expect(nearest).toBeGreaterThan(3);
    expect(starts(s)).toEqual([]);
    expect(point(s).progress).toBe(0);
  });

  test('a unit that passes within the aggro range diverts, stops within the capture radius and captures', () => {
    const s = scene([{ id: 0, x: 3, y: MID }]);
    const u = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 1,
      y: 15,
    });
    // Column 1 is 2 cells from column 3: the unit diverts when it comes within 3.
    expect(runUntil(s, () => starts(s).length > 0)).toBe(true);
    const d = distCells(s, u.id, 3, MID);
    expect(d).toBeLessThanOrEqual(CAP.captureRadiusCells);
    const px = u.px;
    const py = u.py;
    run(s, 5);
    // It waits (nothing pushes it in this scene).
    expect([u.px, u.py]).toEqual([px, py]);
    expect(starts(s)).toHaveLength(1);
  });

  test('flyers divert too', () => {
    const s = scene([{ id: 0, x: 3, y: MID }]);
    const u = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_drone',
      x: 1,
      y: 15,
    });
    expect(runUntil(s, () => starts(s).length > 0)).toBe(true);
    expect(distCells(s, u.id, 3, MID)).toBeLessThanOrEqual(
      CAP.captureRadiusCells,
    );
  });

  test('a lake that hides the point gives no line of sight: no diversion', () => {
    // A lake wall on the unit's side of the zone cannot be built (the lakes
    // are board terrain), so block the gap cells with the arena option.
    const s = scene([{ id: 0, x: 3, y: MID }], {
      gapBlocked: [
        { x: 2, y: MID - 1 },
        { x: 2, y: MID },
        { x: 2, y: MID + 1 },
      ],
    });
    const u = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 1,
      y: MID,
    });
    run(s, 30);
    expect(distCells(s, u.id, 3, MID)).toBeGreaterThan(
      CAP.captureRadiusCells + 1,
    );
    expect(starts(s)).toEqual([]);
  });

  test('a unit does not divert to a point its own side holds', () => {
    const s = scene([{ id: 0, x: 3, y: MID }]);
    point(s).controller = 0;
    const u = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 1,
      y: 15,
    });
    run(s, 150);
    const yCell = Math.floor(u.py / 240);
    expect(yCell).toBeGreaterThan(MID + 1);
    expect(starts(s)).toEqual([]);
  });
});

describe('capture progress (CB-8f)', () => {
  test('one unit captures in captureTicks, three in about a third', () => {
    const one = scene();
    spawnUnitForTest(one.sim, one.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 3,
      y: MID,
    });
    run(one, 80);
    const t1 = captures(one)[0];
    const s1 = starts(one)[0];
    expect(t1).toBeDefined();
    expect((t1?.tick ?? 0) - (s1?.tick ?? 0)).toBe(CAP.captureTicks - 1);
    expect(t1).toMatchObject({ point: 0, side: 0, previous: -1 });
    expect(point(one)).toMatchObject({
      controller: 0,
      progress: 0,
      progressSide: -1,
    });

    const three = scene();
    for (const x of [2, 3, 4]) {
      spawnUnitForTest(three.sim, three.ctx, {
        side: 0,
        def: 'unit_soldier',
        x,
        y: MID,
      });
    }
    run(three, 40);
    const t3 = captures(three)[0];
    const s3 = starts(three)[0];
    expect((t3?.tick ?? 0) - (s3?.tick ?? 0)).toBe(
      Math.ceil(CAP.captureTicks / CAP.maxCapturersCounted) - 1,
    );
  });

  test('more units than maxCapturersCounted capture no faster', () => {
    const s = scene();
    for (const [x, y] of [
      [2, MID],
      [3, MID],
      [4, MID],
      [3, MID + 1],
      [3, MID - 1],
    ] as const) {
      spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_soldier',
        x,
        y,
      });
    }
    run(s, 40);
    expect((captures(s)[0]?.tick ?? 0) - (starts(s)[0]?.tick ?? 0)).toBe(
      Math.ceil(CAP.captureTicks / CAP.maxCapturersCounted) - 1,
    );
  });

  test('a contested point makes no progress', () => {
    const s = scene();
    const a = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 3,
      y: MID - 1,
    });
    const b = spawnUnitForTest(s.sim, s.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 3,
      y: MID + 1,
    });
    // Give both a lot of health so they stay in range while they fight.
    a.hp = 100000;
    b.hp = 100000;
    run(s, 60);
    expect(s.sim.units).toHaveLength(2);
    expect(point(s)).toMatchObject({
      controller: -1,
      progressSide: -1,
      progress: 0,
    });
    expect(starts(s)).toEqual([]);
  });

  test('progress restarts when the other side starts capturing, and decays to 0 with nobody in range', () => {
    const s = scene();
    const p = point(s);
    p.progressSide = 0;
    p.progress = 20;
    run(s, 5);
    expect(p).toMatchObject({ progressSide: 0, progress: 15 });
    run(s, 15);
    expect(p).toMatchObject({ progressSide: -1, progress: 0 });
    expect(starts(s)).toEqual([]);

    // The other side starts: its progress starts at 0 and counts its units.
    p.progressSide = 0;
    p.progress = 30;
    spawnUnitForTest(s.sim, s.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 3,
      y: MID,
    });
    run(s, 1);
    expect(p).toMatchObject({ progressSide: 1, progress: 1 });
    expect(starts(s)).toEqual([
      {
        tick: s.sim.tick - 1,
        type: 'point_capture_started',
        point: 0,
        side: 1,
      },
    ]);
  });

  test('a living guard of the point stops every change, decay included', () => {
    const s = scene();
    const p = point(s);
    spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      x: 3,
      y: MID + 2,
    });
    p.progressSide = 0;
    p.progress = 10;
    run(s, 3);
    expect(p).toMatchObject({ progressSide: 0, progress: 10 });
    // Units of side 0 in range still change nothing while the guard lives.
    const u = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 3,
      y: MID - 1,
    });
    u.hp = 100000;
    run(s, 2);
    expect(p).toMatchObject({ progressSide: 0, progress: 10 });
  });

  test('units that fight guards at a point capture it once the guards are dead', () => {
    const s = scene();
    spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      x: 3,
      y: MID,
    });
    for (const x of [1, 2]) {
      spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_soldier',
        x,
        y: MID - 2,
      });
    }
    run(s, 400);
    expect(s.sim.guards?.killed[0]).toBe(1);
    expect(captures(s)).toHaveLength(1);
    expect(captures(s)[0]?.side).toBe(0);
  });

  test('a drone captures a point whose guards cannot hit it', () => {
    const s = scene();
    spawnGuardForTest(s.sim, s.ctx, {
      def: 'unit_soldier',
      post: 0,
      x: 3,
      y: MID,
    });
    const drone = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_drone',
      x: 1,
      y: 15,
    });
    const hp = drone.hp;
    run(s, 400);
    expect(drone.hp).toBe(hp);
    expect(s.sim.guards?.killed[0]).toBe(1);
    expect(captures(s)).toHaveLength(1);
    expect(point(s).controller).toBe(0);
  });
});

describe('resuming and retaking (CB-8f)', () => {
  test('diverted units resume their march after the capture', () => {
    const s = scene();
    const u = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 1,
      y: 15,
    });
    run(s, 200);
    expect(point(s).controller).toBe(0);
    expect(distCells(s, u.id, 3, MID)).toBeGreaterThan(
      CAP.pointAggroRangeCells,
    );
    // It walks on up the column towards the enemy Core.
    expect(Math.floor(u.py / 240)).toBeGreaterThan(MID + 2);
  });

  test('the point is retaken by the other side later in the same battle', () => {
    const s = scene();
    spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 3,
      y: MID,
    });
    run(s, 70);
    expect(point(s).controller).toBe(0);
    // Let the capturer walk on, then a side-1 unit arrives.
    run(s, 100);
    spawnUnitForTest(s.sim, s.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 3,
      y: MID,
    });
    run(s, 70);
    expect(captures(s).map((e) => [e.side, e.previous])).toEqual([
      [0, -1],
      [1, 0],
    ]);
    expect(point(s).controller).toBe(1);
    // Held ticks: side 0 from its capture until the retake.
    const [h0, h1] = point(s).held;
    expect(h0).toBeGreaterThan(100);
    expect(h1).toBeGreaterThan(0);
    expect(h0 + h1).toBeLessThan(s.sim.tick);
  });

  test('PvE wave units capture too', () => {
    // A wave of side 1 (as a threat sends) walks down the zone past a point.
    const s = scene([{ id: 0, x: 3, y: MID }], {
      sideOptions: [
        null,
        { scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 6 }] },
      ],
    });
    run(s, 400);
    expect(captures(s).some((e) => e.side === 1)).toBe(true);
  });
});

describe('battle level (CB-8f)', () => {
  test('a battle on a zone with a point reports the point in the summary and the timeline', () => {
    const zone: NeutralZone = {
      width: W,
      depth: GAP,
      features: [],
      pointsOfInterest: [{ id: 0, band: 0, x: 3, y: 3, buff: 'poi_heal' }],
    };
    const r = simulateBattle(
      {
        teamA: coreOnly(1),
        teamB: coreOnly(10),
        seed: 1,
        round: 1,
        sideOptions: [
          { scheduledWaves: [{ tick: 0, unit: 'unit_soldier', count: 4 }] },
          null,
        ],
      },
      content,
      { sim: simConfig, mapgen },
      { zone },
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.summary.points).toHaveLength(1);
    const p = r.summary.points?.[0];
    expect(p?.id).toBe(0);
    expect(r.summary.timeline.every((t) => t.points?.length === 1)).toBe(true);
    const events = r.eventLog.filter((e) => e.type === 'point_captured');
    if (events.length > 0) {
      expect(p?.controller).toBeGreaterThanOrEqual(0);
    }
  });

  test('a zone with no point has no points in the state or the summary', () => {
    const zone: NeutralZone = {
      width: W,
      depth: GAP,
      features: [],
      pointsOfInterest: [],
    };
    const r = simulateBattle(
      { teamA: coreOnly(1), teamB: coreOnly(10), seed: 1, round: 1 },
      content,
      { sim: simConfig, mapgen },
      { zone },
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.summary.points).toBeUndefined();
    expect(r.summary.timeline[0]).not.toHaveProperty('points');
  });
});
