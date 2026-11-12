import {
  generateThreat,
  hashJson,
  runTeamStateOps,
  type BattleInput,
  type Json,
  type ThreatInput,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import battleVectors from '../../../../golden/battle.json';
import pveVectors from '../../../../golden/pve-battle.json';
import { content } from '../content.js';
import {
  breachEntries,
  buildingRows,
  deriveMoments,
  destroyedOf,
  geometryOf,
  liveAxisMaxTick,
  mergeMarkers,
  sideStats,
  strengthSeries,
} from './derive.js';
import { reasonText } from './panels.js';
import { attackShows, isAttacking } from './draw.js';
import {
  octantOf,
  Playback,
  simulateRecord,
  type BattleRecord,
} from './playback.js';
import { battleConfig, threatsConfig } from './setup.js';
import {
  buildSample,
  formatSampleHash,
  opponentOptions,
  parseSampleHash,
  sampleReward,
} from './samples.js';
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
        // Scenario vectors (waves, free power) carry their side options.
        ...(input['sideOptions'] === undefined
          ? {}
          : {
              sideOptions: input['sideOptions'] as unknown as NonNullable<
                BattleInput['sideOptions']
              >,
            }),
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

  test('facing octants point where the unit steps (0 north, clockwise)', () => {
    // Sim y runs up the screen.
    expect(octantOf(0, 1, 0)).toBe(0);
    expect(octantOf(1, 1, 0)).toBe(1);
    expect(octantOf(1, 0, 0)).toBe(2);
    expect(octantOf(1, -1, 0)).toBe(3);
    expect(octantOf(0, -1, 0)).toBe(4);
    expect(octantOf(-1, -1, 1)).toBe(5);
    expect(octantOf(-1, 0, 1)).toBe(6);
    expect(octantOf(-1, 1, 1)).toBe(7);
    // A nudge smaller than the jitter threshold keeps the rest facing.
    expect(octantOf(0.001, -0.002, 0)).toBe(0);
    expect(octantOf(0.001, 0.002, 1)).toBe(4);
    // Near a boundary the rest facing wins; clearly past it, it does not.
    const at = (oct: number, side: number) =>
      octantOf(
        Math.sin((oct * Math.PI) / 4) * 0.1,
        Math.cos((oct * Math.PI) / 4) * 0.1,
        side,
      );
    expect(at(0.45, 0)).toBe(0);
    expect(at(0.7, 0)).toBe(1);
    expect(at(-0.45, 0)).toBe(0);
    expect(at(3.55, 1)).toBe(4);
    expect(at(3.3, 1)).toBe(3);
  });

  test('facing, motion, position and attack frame at a tick do not depend on how it was reached', () => {
    const snap = (pb: Playback) =>
      pb.sim.units.map((u) => {
        const p = { x: 0, y: 0 };
        pb.displayPos(u, p);
        return [
          u.id,
          pb.facing(u),
          pb.isMoving(u),
          isAttacking(pb, u.id),
          p.x,
          p.y,
        ];
      });
    const played = fresh();
    played.start();
    const at: Record<number, unknown> = {};
    const targets = [60, 61, 100, 150];
    let sawMoving = false;
    let sawAttack = false;
    while (!played.finished && played.tick < 150) {
      played.advance(100);
      if (targets.includes(played.tick)) at[played.tick] = snap(played);
      for (const u of played.sim.units) {
        sawMoving ||= played.isMoving(u);
        sawAttack ||= isAttacking(played, u.id);
      }
    }
    expect(sawMoving).toBe(true);
    expect(sawAttack).toBe(true);
    const scrubbed = fresh();
    for (const t of [150, 61, 100, 60]) {
      // Forward jumps and rewinds alike.
      scrubbed.seekTo(t);
      expect(snap(scrubbed)).toEqual(at[t]);
    }
    scrubbed.restart();
    scrubbed.seekTo(100);
    expect(snap(scrubbed)).toEqual(at[100]);
  });

  test('tick 0 shows no attack frame and every unit rests facing its side', () => {
    const pb = fresh();
    pb.start();
    for (const t of [0, 1, 2]) {
      pb.seekTo(t);
      for (const u of pb.sim.units) {
        expect(isAttacking(pb, u.id)).toBe(false);
        if (t === 0) expect(pb.facing(u)).toBe(u.side === 0 ? 0 : 4);
      }
    }
    expect(attackShows(0, 0)).toBe(false);
    expect(attackShows(5, 6)).toBe(true);
    expect(attackShows(5, 8)).toBe(false);
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

  test('skip, watch again and play through with more than 64 units spawned', () => {
    const stress = buildSample({
      player: 'rush',
      opponent: 'stress',
      seed: 1,
      tick: 0,
    }).battle;
    const rec = record(stress);
    expect(rec.summary.sides[0].unitsSpawned).toBeGreaterThan(64);
    const pb = new Playback(stress, content, battleConfig, rec);
    pb.skip();
    const hash = hashJson(pb.sim);
    // Used to throw "offset is out of bounds" in the track arrays.
    pb.restart();
    expect(pb.tick).toBe(0);
    pb.start();
    pb.setSpeed(4);
    let guard = 0;
    while (!pb.finished && guard++ < 100_000) pb.advance(16);
    expect(pb.finished).toBe(true);
    expect(hashJson(pb.sim)).toBe(hash);
    // And once more, skipping this time.
    pb.restart();
    pb.skip();
    expect(hashJson(pb.sim)).toBe(hash);
  }, 120_000);

  test('unit positions are eased between ticks and never allocate per call', () => {
    const pb = fresh();
    pb.start();
    pb.seekTo(250);
    const out = { x: 0, y: 0 };
    const u = pb.sim.units[0];
    expect(u).toBeDefined();
    if (u === undefined) return;
    pb.displayPos(u, out);
    // In cells: the unit's real position, to within one tick of walking.
    expect(Math.abs(out.x - u.px / 240)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(out.y - u.py / 240)).toBeLessThanOrEqual(0.5);
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
  }, 60_000);
});

describe('live chart axes', () => {
  test('the time axis has a minimum window, then grows in steps with the tick', () => {
    const tps = 10;
    expect(liveAxisMaxTick(0, tps)).toBe(600);
    expect(liveAxisMaxTick(599, tps)).toBe(600);
    expect(liveAxisMaxTick(600, tps)).toBe(600);
    expect(liveAxisMaxTick(601, tps)).toBe(900);
    expect(liveAxisMaxTick(1234, tps)).toBe(1500);
    // Never below the current position.
    for (let t = 0; t < 4000; t += 37) {
      expect(liveAxisMaxTick(t, tps)).toBeGreaterThanOrEqual(t);
    }
  });

  test('the y axis and the points cover only the samples seen so far', () => {
    const side = (h: number) => ({ units: 1, unitHealth: h, buildings: 1 });
    const timeline = [
      { tick: 0, sides: [side(10), side(20)] },
      { tick: 50, sides: [side(30), side(5)] },
      { tick: 100, sides: [side(999), side(7)] },
    ] as unknown as Parameters<typeof strengthSeries>[0];
    const early = strengthSeries(timeline, 60);
    expect(early.yMax).toBe(30);
    expect(early.own.map((p) => p.x)).toEqual([0, 50]);
    expect(strengthSeries(timeline, 0).yMax).toBe(20);
    const all = strengthSeries(timeline, Number.POSITIVE_INFINITY);
    expect(all.yMax).toBe(999);
    expect(all.foe.length).toBe(3);
  });
});

describe('result reasons', () => {
  test('every reason is worded after the rules of the core battle', () => {
    expect(reasonText('time_limit', 'Core')).toMatch(/share of its total/);
    expect(reasonText('time_limit', 'Core')).not.toMatch(/defender/i);
    expect(reasonText('tiebreak_overkill', 'Core')).toMatch(/less overkill/);
    expect(reasonText('tiebreak_overkill', 'Core')).toMatch(/same tick/);
    expect(reasonText('tiebreak_building_damage', 'Core')).toMatch(
      /equal overkill/,
    );
    expect(reasonText('tiebreak_building_damage', 'Core')).toMatch(
      /more damage to the enemy's buildings/,
    );
    expect(reasonText('tiebreak_kills', 'Core')).toMatch(/killed more/);
    expect(reasonText('tiebreak_attacker', 'Core')).toMatch(/attacker/);
    expect(reasonText('core_destroyed', 'Heart')).toMatch(/Heart/);
  });

  const side = (standing: number, hp: number, max = 100) => ({
    coresStanding: standing,
    coreHealth: hp,
    coreMaxHealth: max,
  });
  test('the result line names the deciding step of a time limit', () => {
    const byCount = reasonText('time_limit', 'Core', [
      side(2, 10),
      side(1, 90),
    ]);
    expect(byCount).toMatch(/more Cores standing wins: yours 2, theirs 1/);
    const byHealth = reasonText('time_limit', 'Core', [
      side(1, 80),
      side(1, 30),
    ]);
    expect(byHealth).toMatch(/equal Cores standing/);
    expect(byHealth).toMatch(/yours 80 \/ 100, theirs 30 \/ 100/);
  });
  test('a tie says whether it came from a double fall or the time limit', () => {
    const fall = reasonText('tiebreak_kills', 'Core', [side(0, 0), side(0, 0)]);
    expect(fall).toMatch(/same tick/);
    const limit = reasonText('tiebreak_kills', 'Core', [
      side(1, 50),
      side(1, 50),
    ]);
    expect(limit).toMatch(/Time ran out with equal Cores standing/);
    expect(limit).not.toMatch(/same tick/);
    expect(
      reasonText('tiebreak_overkill', 'Core', [side(0, 0), side(0, 0)]),
    ).toMatch(/less overkill/);
  });
});

describe('sample rewards', () => {
  const win = true;
  const loss = false;
  test('a lost PvE battle costs and pays nothing; a lost PvP battle costs a life', () => {
    expect(sampleReward('pve', loss)).toBe('No reward');
    expect(sampleReward('pve', loss)).not.toMatch(/life/);
    expect(sampleReward('versus', loss)).toMatch(/-1 life/);
    expect(sampleReward('versus', loss)).toMatch(/gold/);
    expect(sampleReward('pve', win)).toMatch(/gold/);
    expect(sampleReward('versus', win)).toMatch(/gold/);
  });
  test('each sample carries the reward of its kind', () => {
    const base = { player: 'rush', seed: 1, tick: 0 } as const;
    const pve = buildSample({ ...base, opponent: 'pve:arch_rusher:1:medium' });
    const pvp = buildSample({ ...base, opponent: 'ghost:fortify' });
    expect(pve.reward(loss)).toBe('No reward');
    expect(pvp.reward(loss)).toMatch(/life/);
  });
});

describe('breaches and markers from synthetic event logs', () => {
  const fort = buildSample({
    player: 'fortify',
    opponent: 'ghost:rush',
    seed: 1,
    tick: 0,
  }).battle;
  const base = record(fort);
  const labels = {
    side: ['Your', 'Enemy'] as const,
    coreName: 'Core',
    zoneRevealed: 'zone',
    overload: 'overload',
  };
  const idsOf = (defType: string): number[] =>
    base.initialTeams[0].buildings
      .filter((b) => {
        const d = content.buildings.get(b.def);
        return d?.kind === 'defense' && d.defenseType === defType;
      })
      .map((b) => b.id);
  const synth = (
    events: { tick: number; building: number }[],
  ): BattleRecord => ({
    ...base,
    eventLog: events.map((e) => ({
      tick: e.tick,
      type: 'building_destroyed' as const,
      side: 0,
      building: e.building,
    })),
  });

  test('a destroyed turret is a moment and a breach entry', () => {
    const turrets = idsOf('turret');
    expect(turrets.length).toBeGreaterThan(0);
    const rec = synth([{ tick: 99, building: turrets[0] ?? 0 }]);
    const moments = deriveMoments(rec, content, labels);
    const m = moments.find((x) => x.kind === 'turret');
    expect(m?.tick).toBe(100);
    expect(m?.side).toBe(0);
    expect(m?.focus).not.toBeNull();
    const entries = breachEntries(rec, content, moments, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toMatch(/^1 turret at 0:10$/i);
  });

  test('all walls and gates are listed, grouped with their time span', () => {
    const walls = idsOf('wall');
    expect(walls.length).toBeGreaterThanOrEqual(3);
    const rec = synth([
      { tick: 99, building: walls[0] ?? 0 },
      { tick: 199, building: walls[1] ?? 0 },
      { tick: 299, building: walls[2] ?? 0 },
    ]);
    const moments = deriveMoments(rec, content, labels);
    // Only the first wall is a log moment ...
    expect(moments.filter((x) => x.kind === 'breach')).toHaveLength(1);
    // ... but the list has all three.
    const entries = breachEntries(rec, content, moments, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toMatch(/^3 walls at 0:10–0:30$/i);
  });

  test('walls, turrets and the Core come out in time order', () => {
    const walls = idsOf('wall');
    const turrets = idsOf('turret');
    const rec = {
      ...synth([
        { tick: 299, building: turrets[0] ?? 0 },
        { tick: 99, building: walls[0] ?? 0 },
      ]),
    };
    const entries = breachEntries(
      rec,
      content,
      deriveMoments(rec, content, labels),
      0,
      10,
    );
    expect(entries.map((e) => e.tick)).toEqual([100, 300]);
    expect(entries[0]?.text).toMatch(/wall/i);
    expect(entries[1]?.text).toMatch(/turret/i);
  });

  test('markers at the same tick are merged into one labelled with the range', () => {
    expect(mergeMarkers([10, 20, 20, 30])).toEqual([
      { x: 10, label: '1' },
      { x: 20, label: '2–3' },
      { x: 30, label: '4' },
    ]);
    expect(mergeMarkers([5, 5, 5]).map((m) => m.label)).toEqual(['1–3']);
    expect(mergeMarkers([])).toEqual([]);
  });
});

describe('golden reproduction through the sample route', () => {
  test('the hash can carry a threat seed that reproduces a golden PvE battle', () => {
    const sel = parseSampleHash(
      '#battle?p=rush&o=pve:arch_rusher:1:medium&s=8&ts=101',
    );
    expect(sel.threatSeed).toBe(101);
    expect(parseSampleHash(formatSampleHash(sel))).toEqual(sel);
    expect(opponentOptions().some((o) => o.id === sel.opponent)).toBe(true);
    const rec = record(buildSample(sel).battle);
    const gold = (pveVectors as unknown as Vector[]).find(
      (v) => v.id === 'pve-battle.rush-vs-rusher-r1',
    );
    expect(rec.result).toEqual(gold?.expected.result.result);
    expect(rec.summary.sides[1].coreHealth).toBe(
      gold?.expected.result.summary?.sides[1]?.coreHealth,
    );
  });
});
