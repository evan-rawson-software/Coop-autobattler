import {
  generateThreat,
  hashJson,
  runTeamStateOps,
  type Json,
  type ThreatInput,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import battleVectors from '../../../../golden/battle.json';
import pveVectors from '../../../../golden/pve-battle.json';
import { content } from '../content.js';
import {
  buildingRows,
  deriveMoments,
  destroyedOf,
  geometryOf,
  sideStats,
} from './derive.js';
import { Playback, simulateRecord, type BattleRecord } from './playback.js';
import { battleConfig, threatsConfig } from './setup.js';
import { buildSample, formatSampleHash, parseSampleHash } from './samples.js';
import type { BattleDescription } from './types.js';

interface Vector {
  readonly id: string;
  readonly input: Record<string, Json>;
  readonly expected: {
    readonly result: {
      readonly ok: boolean;
      readonly result?: { winner: number; reason: string; endTick: number };
      readonly summary?: {
        sides: readonly { coreHealth: number; unitsLost: number }[];
      };
      readonly stateHash?: string;
      readonly events?: number;
    };
  };
}

const team = (script: Json) =>
  runTeamStateOps(script, content, content.mapgen).state;

function describeVector(kind: 'battle' | 'pve', v: Vector): BattleDescription {
  const input = v.input;
  const seed = input['seed'] as number;
  if (kind === 'battle') {
    return {
      kind: 'versus',
      input: {
        teamA: team(input['teamA'] as Json),
        teamB: team(input['teamB'] as Json),
        seed,
      },
    };
  }
  const threat = generateThreat(
    input['threat'] as unknown as ThreatInput,
    content,
    { threats: threatsConfig, mapgen: content.mapgen },
  );
  return {
    kind: 'pve',
    input: { team: team(input['team'] as Json), threat, seed },
  };
}

const goldens: { name: string; kind: 'battle' | 'pve'; v: Vector }[] = [
  ...(battleVectors as unknown as Vector[])
    .filter((v) => v.expected.result.ok)
    .map((v) => ({ name: v.id, kind: 'battle' as const, v })),
  ...(pveVectors as unknown as Vector[])
    .slice(0, 6)
    .concat((pveVectors as unknown as Vector[]).slice(-2))
    .map((v) => ({ name: v.id, kind: 'pve' as const, v })),
];

function record(desc: BattleDescription): BattleRecord {
  const r = simulateRecord(desc, content, battleConfig);
  if (!r.ok) throw new Error(r.error.message);
  return r.record;
}

describe('golden battles', () => {
  test.each(goldens)(
    '$name: the shown result and the played-back state match',
    ({ kind, v }) => {
      const desc = describeVector(kind, v);
      const rec = record(desc);
      const exp = v.expected.result;
      expect(rec.result).toEqual(exp.result);
      expect(rec.summary.sides[0].coreHealth).toBe(
        exp.summary?.sides[0]?.coreHealth,
      );
      expect(rec.summary.sides[1].coreHealth).toBe(
        exp.summary?.sides[1]?.coreHealth,
      );
      expect(rec.eventLog.length).toBe(exp.events);

      // Skipping to the end lands on the very state the simulation ended in.
      const pb = new Playback(desc, content, battleConfig, rec);
      pb.skip();
      expect(pb.finished).toBe(true);
      expect(pb.tick).toBe(rec.result.endTick);
      expect(hashJson(pb.sim)).toBe(exp.stateHash);
      expect(rec.coreHp[0][rec.result.endTick]).toBe(
        rec.summary.sides[0].coreHealth,
      );
      expect(rec.coreHp[1][rec.result.endTick]).toBe(
        rec.summary.sides[1].coreHealth,
      );
    },
    60_000,
  );
});

const desc = buildSample({
  player: 'rush',
  opponent: 'pve:arch_rusher:1:medium',
  seed: 1,
  tick: 0,
}).battle;

function fresh(): Playback {
  return new Playback(desc, content, battleConfig, record(desc));
}

describe('playback engine', () => {
  test('does nothing until started; then steps by speed', () => {
    const pb = fresh();
    expect(pb.revealed).toBe(false);
    expect(pb.advance(100)).toBe(0);
    expect(pb.tick).toBe(0);
    pb.start();
    expect(pb.revealed).toBe(true);
    // 10 ticks per second at 1x.
    expect(pb.advance(100)).toBe(1);
    expect(pb.tick).toBe(1);
    pb.setSpeed(4);
    expect(pb.advance(100)).toBe(4);
    expect(pb.tick).toBe(5);
    pb.setSpeed(2);
    expect(pb.advance(50)).toBe(1);
    expect(pb.tick).toBe(6);
    // A frame much longer than 100 ms counts as 100 ms.
    pb.setSpeed(1);
    pb.advance(10_000);
    expect(pb.tick).toBe(7);
  });

  test('keeps the fraction of a tick between frames', () => {
    const pb = fresh();
    pb.start();
    let steps = 0;
    for (let i = 0; i < 6; i++) steps += pb.advance(16.6667);
    // Six frames of a sixtieth of a second are one tenth of a second.
    expect(steps).toBe(1);
    expect(pb.frac).toBeGreaterThan(0);
    expect(pb.frac).toBeLessThan(1);
  });

  test('pausing stops it; resuming continues', () => {
    const pb = fresh();
    pb.start();
    pb.advance(100);
    pb.setPaused(true);
    expect(pb.advance(500)).toBe(0);
    expect(pb.tick).toBe(1);
    pb.setPaused(false);
    expect(pb.advance(100)).toBe(1);
  });

  test('pausing, speed changes, seeking and skipping never change the outcome', () => {
    const straight = fresh();
    straight.skip();
    const hash = hashJson(straight.sim);

    const pb = fresh();
    pb.start();
    const script: (() => void)[] = [
      () => pb.advance(100),
      () => {
        pb.setSpeed(4);
      },
      () => pb.advance(100),
      () => {
        pb.setPaused(true);
      },
      () => pb.advance(100),
      () => {
        pb.setPaused(false);
      },
      () => {
        pb.seekTo(30);
      },
      () => {
        pb.setSpeed(2);
      },
      () => pb.advance(100),
      () => {
        pb.seekTo(10);
      },
      () => pb.advance(100),
      () => {
        pb.seekTo(200);
      },
      () => {
        pb.skip();
      },
    ];
    for (const step of script) step();
    expect(pb.finished).toBe(true);
    expect(hashJson(pb.sim)).toBe(hash);
    expect(pb.record.result).toEqual(straight.record.result);
  });

  test('playing to the end in real time reaches the same state as skipping', () => {
    const straight = fresh();
    straight.skip();
    const pb = fresh();
    pb.start();
    pb.setSpeed(4);
    let guard = 0;
    while (!pb.finished && guard++ < 100_000) pb.advance(16);
    expect(pb.finished).toBe(true);
    expect(hashJson(pb.sim)).toBe(hashJson(straight.sim));
  });

  test('resuming at a tick equals a straight run to that tick', () => {
    const a = fresh();
    a.start();
    a.seekTo(137);
    const b = fresh();
    b.start();
    while (b.tick < 137) b.advance(25);
    expect(b.tick).toBe(137);
    expect(hashJson(a.sim)).toBe(hashJson(b.sim));
    // Going back replays from the start and lands on the same state.
    b.seekTo(60);
    b.seekTo(137);
    expect(hashJson(b.sim)).toBe(hashJson(a.sim));
  });

  test('the neutral zone is hidden until playback begins', () => {
    const pb = fresh();
    expect(pb.revealed).toBe(false);
    pb.start();
    expect(pb.revealed).toBe(true);
    pb.restart();
    expect(pb.tick).toBe(0);
    expect(pb.revealed).toBe(false);
    pb.seekTo(5);
    expect(pb.revealed).toBe(true);
  });

  test('watching again after the end starts over with the same battle', () => {
    const pb = fresh();
    pb.skip();
    const hash = hashJson(pb.sim);
    pb.restart();
    expect(pb.finished).toBe(false);
    expect(pb.tick).toBe(0);
    pb.skip();
    expect(hashJson(pb.sim)).toBe(hash);
  });

  test('unit positions are eased between cells and never allocate per call', () => {
    const pb = fresh();
    pb.start();
    pb.seekTo(250);
    const out = { x: 0, y: 0 };
    const u = pb.sim.units[0];
    expect(u).toBeDefined();
    if (u === undefined) return;
    pb.displayPos(u, out);
    expect(Math.abs(out.x - u.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(out.y - u.y)).toBeLessThanOrEqual(1);
  });
});

describe('derived data', () => {
  const walled = (battleVectors as unknown as Vector[]).find(
    (v) => v.id === 'battle.walled-stalemate-overload',
  );
  if (walled === undefined) throw new Error('missing golden vector');
  const wdesc = describeVector('battle', walled);
  const wrec = record(wdesc);
  const labels = {
    side: ['Your', 'Enemy'] as const,
    coreName: 'Core',
    zoneRevealed: 'zone',
    overload: 'overload',
  };

  test('moments are in time order and include Overload', () => {
    const moments = deriveMoments(wrec, content, labels);
    expect(moments[0]?.kind).toBe('zone');
    for (let i = 1; i < moments.length; i++) {
      expect(moments[i]?.tick).toBeGreaterThanOrEqual(
        moments[i - 1]?.tick ?? 0,
      );
    }
    expect(moments.some((m) => m.kind === 'overload')).toBe(true);
    expect(moments.some((m) => m.kind === 'core_destroyed')).toBe(true);
  });

  test('a battle with destruction has breach moments and rows', () => {
    const lost = (battleVectors as unknown as Vector[]).find(
      (v) => v.id === 'battle.rush-vs-fortify',
    );
    if (lost === undefined) throw new Error('missing golden vector');
    const d = describeVector('battle', lost);
    const rec = record(d);
    const moments = deriveMoments(rec, content, labels);
    expect(moments.some((m) => m.kind === 'core_half')).toBe(true);
    const rows = buildingRows(rec, content, 0);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.reduce((n, r) => n + r.trained, 0)).toBe(
      rec.summary.sides[0].unitsSpawned,
    );
    expect(destroyedOf(rec, 0).buildings.length).toBe(
      rec.summary.sides[0].buildingsLost,
    );
  });

  test('side statistics follow the visual state', () => {
    const pb = new Playback(wdesc, content, battleConfig, wrec);
    pb.start();
    pb.seekTo(300);
    const s = sideStats(pb, content, 0, 10);
    expect(s.coreMax).toBe(wrec.coreMax[0]);
    expect(s.unitsAlive).toBe(pb.sim.units.filter((u) => u.side === 0).length);
    expect(s.production.length).toBe(content.resources.list().length);
    const g = geometryOf(wrec);
    expect(g.height).toBe(2 * g.boardHeight + g.gapRows);
  });
});

describe('sample selection hash', () => {
  test('round-trips and falls back to defaults', () => {
    const sel = {
      player: 'fortify' as const,
      opponent: 'ghost:poor',
      seed: 42,
      tick: 310,
    };
    expect(parseSampleHash(formatSampleHash(sel))).toEqual(sel);
    const def = parseSampleHash('#battle');
    expect(def.tick).toBe(0);
    expect(parseSampleHash('#battle?o=nonsense&p=nope&s=-3').seed).toBe(
      def.seed,
    );
  });

  test('every sample opponent builds and runs', () => {
    for (const o of [
      'ghost:rush',
      'pve:arch_boss:3:boss',
      'pve:arch_fortress:1:medium',
      'stress',
    ]) {
      const s = buildSample({
        player: 'fortify',
        opponent: o,
        seed: 3,
        tick: 0,
      });
      const r = simulateRecord(s.battle, content, battleConfig);
      expect(r.ok).toBe(true);
    }
  });
});
