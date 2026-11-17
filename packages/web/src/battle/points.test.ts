import {
  CELL_UNITS,
  type ArenaEvent,
  type ArenaSim,
  type BattleSummary,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { deriveMoments, clock, geometryOf } from './derive.js';
import { describeUnitAt } from './unit-hover.js';
import { Playback, simulateRecord } from './playback.js';
import {
  bonusLines,
  buffName,
  buffText,
  captureNotice,
  guardAndHealLines,
  pointRow,
  pointsNow,
  statusText,
  summaryRows,
  type PointNow,
  type PointsSource,
} from './points.js';
import { buildSample } from './samples.js';
import { battleConfig } from './setup.js';

const STRENGTH = { kind: 'unit_strength', strengthPercent: 20 } as const;
const HEAL = {
  kind: 'heal',
  healIntervalTicks: 10,
  healRadiusCells: 3,
  healAmount: 2,
} as const;

const now = (over: Partial<PointNow>): PointNow => ({
  id: 1,
  number: 2,
  x: 5.5,
  y: 20.5,
  buff: HEAL,
  controller: -1,
  progressSide: -1,
  progress: 0,
  guards: 0,
  contested: false,
  status: 'open',
  captureRadius: 2,
  ...over,
});

describe('the words of a point', () => {
  test('names and describes the two buffs in plain words', () => {
    expect(buffName(STRENGTH)).toBe('Strength point');
    expect(buffName(HEAL)).toBe('Healing point');
    expect(buffText(STRENGTH, 20)).toBe(
      'New units are 20% stronger (health and damage) while it is held.',
    );
    expect(buffText(HEAL, 20)).toBe(
      'Units of the holder within 3 cells regain 2 health every 0.5 seconds.',
    );
  });

  test('says what the point is doing, from the viewer side', () => {
    expect(statusText(now({ status: 'guarded', guards: 1 }))).toBe(
      'guarded, 1 guard left',
    );
    expect(statusText(now({ status: 'guarded', guards: 4 }))).toBe(
      'guarded, 4 guards left',
    );
    expect(statusText(now({ status: 'open' }))).toBe('nobody holds it');
    expect(
      statusText(now({ status: 'capturing', progressSide: 0, progress: 0.6 })),
    ).toBe('you are capturing it, 60%');
    expect(
      statusText(now({ status: 'capturing', progressSide: 1, progress: 0.25 })),
    ).toBe('they are capturing it, 25%');
    expect(statusText(now({ status: 'contested' }))).toContain('contested');
    expect(statusText(now({ status: 'held', controller: 0 }))).toBe(
      'held by you',
    );
    expect(statusText(now({ status: 'held', controller: 1 }))).toBe(
      'held by them',
    );
    expect(pointRow(now({ status: 'held', controller: 0 }))).toBe(
      'Point 2, Healing point: held by you',
    );
  });

  test('a capture notice names the side and the effect', () => {
    const e = (
      side: number,
    ): Extract<ArenaEvent, { type: 'point_captured' }> => ({
      tick: 10,
      type: 'point_captured',
      point: 1,
      side,
      previous: -1,
    });
    expect(captureNotice(e(0), STRENGTH)).toBe(
      'Your side took point 2: stronger new units',
    );
    expect(captureNotice(e(1), HEAL)).toBe(
      'Their side took point 2: healing for nearby units',
    );
  });
});

/** A minimal state: one strength and one healing point, held as given. */
function fakeSim(held: readonly [number, number]): PointsSource & ArenaSim {
  const base = {
    units: [],
    points: [
      {
        id: 0,
        controller: held[0],
        progressSide: -1,
        progress: 0,
        held: [0, 0],
        buff: STRENGTH,
      },
      {
        id: 1,
        controller: held[1],
        progressSide: -1,
        progress: 0,
        held: [0, 0],
        buff: HEAL,
      },
    ],
    guards: {
      leashCells: 3,
      capture: {
        captureTicks: 50,
        maxCapturersCounted: 3,
        captureRadiusCells: 2,
        pointAggroRangeCells: 3,
      },
      posts: [
        { id: 0, x: 4, y: 20 },
        { id: 1, x: 12, y: 20 },
      ],
      killed: [0, 0],
      lostToGuards: [0, 0],
      maxPointStrengthPercent: 40,
      healed: [0, 0],
    },
  };
  return base as unknown as PointsSource & ArenaSim;
}

describe('the bonuses of a side', () => {
  test('lists the strength and each held healing point; none when nothing is held', () => {
    expect(bonusLines(fakeSim([-1, -1]), 0, 20)).toEqual([]);
    expect(bonusLines(fakeSim([0, 1]), 0, 20)).toEqual([
      'New units +20% health and damage',
    ]);
    expect(bonusLines(fakeSim([0, 1]), 1, 20)).toEqual([
      'Healing near point 2: units within 3 cells regain 2 health every 0.5 seconds',
    ]);
  });

  test('points of the state are numbered from 1 and start open', () => {
    const pts = pointsNow(fakeSim([-1, 0]));
    expect(pts.map((p) => [p.number, p.status, p.x, p.y])).toEqual([
      [1, 'open', 4.5, 20.5],
      [2, 'held', 12.5, 20.5],
    ]);
  });

  test('a state without points gives none', () => {
    expect(pointsNow({ units: [] })).toEqual([]);
  });
});

describe('the summary of the points', () => {
  const summary = {
    sides: [
      { guardsKilled: 3, healedHp: 48 },
      { guardsKilled: 1, healedHp: 0 },
    ],
    timeline: [],
    points: [
      { id: 0, controller: 0, pointHeldTicks: [3200, 1000] },
      { id: 1, controller: -1, pointHeldTicks: [0, 0] },
    ],
  } as unknown as BattleSummary;
  const zone = {
    width: 24,
    depth: 7,
    features: [],
    pointsOfInterest: [
      { id: 0, band: 0, x: 4, y: 3, buff: 'poi_strength' },
      { id: 1, band: 1, x: 12, y: 3, buff: 'poi_heal' },
    ],
  };

  test('one line per point: buff, final holder and how long each side held it', () => {
    const rows = summaryRows(summary, content, zone, 20, clock);
    expect(rows.map((r) => r.line)).toEqual([
      'Point 1, Strength point: held by you at the end. Held: you 2:40, them 0:50.',
      'Point 2, Healing point: never captured. Held: you 0:00, them 0:00.',
    ]);
    expect(rows[1]?.buff).toContain('regain 2 health');
  });

  test('guards killed and health healed per side', () => {
    expect(guardAndHealLines(summary)).toEqual([
      'Guards killed · You 3 · Them 1',
      'Health healed · You 48 · Them 0',
    ]);
  });
});

describe('a battle with a point', () => {
  const sample = buildSample({
    player: 'rush',
    opponent: 'ghost:fortify',
    seed: 2,
    tick: 0,
  });
  const made = simulateRecord(sample.battle, content, battleConfig);
  if (!made.ok) throw new Error('the sample must simulate');
  const record = made.record;

  test('the point starts guarded and is taken by the end', () => {
    const pb = new Playback(sample.battle, content, battleConfig, record);
    const at0 = pointsNow(pb.sim);
    expect(at0).toHaveLength(1);
    expect(at0[0]?.status).toBe('guarded');
    pb.seekTo(pb.endTick);
    const end = pointsNow(pb.sim);
    expect(end[0]?.status).toBe('held');
    expect(end[0]?.controller).toBe(record.summary.points?.[0]?.controller);
  });

  test('the capture is a notice in the log, at the tick after the event', () => {
    const moments = deriveMoments(record, content, {
      side: ['Your', 'Enemy'],
      coreName: 'Core',
      zoneRevealed: 'Battle starts',
      overload: 'Overload',
    });
    const taken = moments.filter((m) => m.kind === 'point');
    const ev = record.eventLog.filter((e) => e.type === 'point_captured');
    expect(taken).toHaveLength(ev.length);
    expect(taken[0]?.tick).toBe((ev[0]?.tick ?? 0) + 1);
    expect(taken[0]?.text).toMatch(/^(Your|Their) side took point 1: /);
    expect(taken[0]?.focus).not.toBeNull();
  });
});

describe('the tooltip of a point and of a guard', () => {
  const sample = buildSample({
    player: 'rush',
    opponent: 'ghost:fortify',
    seed: 2,
    tick: 0,
  });
  const made = simulateRecord(sample.battle, content, battleConfig);
  if (!made.ok) throw new Error('the sample must simulate');
  const pb = new Playback(sample.battle, content, battleConfig, made.record);
  const geo = geometryOf(made.record);
  const at = pointsNow(pb.sim)[0];
  if (at === undefined) throw new Error('the sample has a point');
  const view = { x: at.x, y: geo.height - at.y };

  test('a point says its buff and who holds it, once the zone is shown', () => {
    pb.start();
    const { points, guards } = pb.sim;
    if (points === undefined || guards === undefined) throw new Error('points');
    const info = describeUnitAt(
      {
        sim: { units: [], points, guards },
        displayPos: () => undefined,
        ticksPerSecond: 20,
      },
      geo,
      content,
      view,
    );
    expect(info?.tone).toBe('point');
    expect(info?.title).toMatch(/^(Strength|Healing) point 1$/);
    // No units in this state, so no guard stands at it.
    expect(info?.lines.at(-1)).toBe('nobody holds it');
  });

  test('a guard is neutral, not an enemy, and hidden before the zone is shown', () => {
    const guard = pb.sim.units.find((u) => u.side === 2);
    if (guard === undefined) throw new Error('a guard');
    const shown = describeUnitAt(pb, geo, content, {
      x: guard.px / CELL_UNITS,
      y: geo.height - guard.py / CELL_UNITS,
    });
    expect(shown?.lines[0]).toMatch(/^Neutral guard · Health /);
    expect(shown?.tone).toBe('point');
    const hidden = describeUnitAt(
      {
        sim: pb.sim,
        revealed: false,
        displayPos: (u, o) => {
          pb.displayPos(u, o);
        },
      },
      geo,
      content,
      {
        x: guard.px / CELL_UNITS,
        y: geo.height - guard.py / CELL_UNITS,
      },
    );
    expect(hidden).toBeNull();
  });
});
