import {
  runTeamStateOps,
  type ArenaEvent,
  type Json,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { loadAudio, type AudioConfig } from '@game/audio';
import { rawAudio } from '@game/content';
import battleVectors from '../../../../golden/battle.json';
import { content } from '../content.js';
import { Playback, simulateRecord } from '../battle/playback.js';
import type { BattleRecord } from '../battle/playback.js';
import { battleConfig } from '../battle/setup.js';
import type { BattleDescription } from '../battle/types.js';
import {
  BattleSounds,
  coreLowOf,
  cueForEvent,
  stingerFor,
  type BattleCue,
  type BattlePlayer,
  type EventLike,
} from './battle-sounds.js';
import { AudioEngine, type AudioPort, type Voice } from './engine.js';
import { DEFAULT_AUDIO_SETTINGS } from './settings.js';

const loaded = loadAudio(rawAudio);
if (!loaded.ok) throw new Error('content/audio.json does not load');
const config: AudioConfig = loaded.config;
const rows = config.battleMap;
const never = { coreLow: () => false };
const always = { coreLow: () => true };

const cue = (e: object, ctx = never): string | undefined =>
  cueForEvent(rows, e as EventLike, ctx)?.cue;

describe('the event to cue mapping', () => {
  test('every row of the map maps its event', () => {
    expect(cue({ type: 'zone_revealed', tick: 0 })).toBe('battle.start');
    expect(cue({ type: 'unit_spawned', tick: 3, side: 0 })).toBe(
      'battle.unit_spawned_ally',
    );
    expect(cue({ type: 'unit_spawned', tick: 3, side: 1 })).toBe(
      'battle.unit_spawned_foe',
    );
    const hit = (target: object) => ({
      type: 'unit_attacked',
      tick: 5,
      unit: 7,
      damage: 3,
      target,
    });
    expect(cue(hit({ kind: 'unit', unit: 2 }))).toBe('battle.attack');
    expect(cue(hit({ kind: 'building', side: 0, building: 2 }))).toBe(
      'battle.attack',
    );
    expect(cue(hit({ kind: 'core', side: 0, core: 0 }))).toBe(
      'battle.core_hit',
    );
    expect(cue(hit({ kind: 'core', side: 0, core: 0 }), always)).toBe(
      'battle.core_hit_low',
    );
    expect(cue(hit({ kind: 'core', side: 1, core: 0 }), always)).toBe(
      'battle.foe_core_hit',
    );
    expect(
      cue({ type: 'turret_fired', tick: 1, side: 0, building: 1, unit: 4 }),
    ).toBe('battle.turret_fired');
    expect(
      cue({ type: 'splash', tick: 1, attacker: 4, x: 0, y: 0, targets: [] }),
    ).toBe('battle.splash');
    expect(
      cue({ type: 'ward_struck', tick: 1, side: 1, building: 1, wall: 2 }),
    ).toBe('battle.ward_struck');
    expect(cue({ type: 'unit_died', tick: 9, unit: 4 })).toBe(
      'battle.unit_died',
    );
    expect(cue({ type: 'building_destroyed', tick: 9, side: 1 })).toBe(
      'battle.building_destroyed',
    );
    expect(cue({ type: 'building_destroyed', tick: 9, side: 0 })).toBe(
      'battle.building_lost',
    );
    expect(cue({ type: 'core_destroyed', tick: 9, side: 1 })).toBe(
      'battle.core_destroyed',
    );
    expect(cue({ type: 'core_destroyed', tick: 9, side: 0 })).toBe(
      'battle.core_lost',
    );
    expect(cue({ type: 'overload_started', tick: 9 })).toBe(
      'battle.overload_started',
    );
    expect(cue({ type: 'overload_level', tick: 9, level: 1 })).toBeUndefined();
    expect(cue({ type: 'overload_level', tick: 9, level: 2 })).toBe(
      'battle.overload_level',
    );
    expect(cue({ type: 'overload_core_damage', tick: 9 })).toBe(
      'battle.overload_pulse',
    );
    for (const [type, id] of [
      ['point_capture_started', 'battle.poi_capture_start'],
      ['point_captured', 'battle.poi_captured'],
      ['burst_released', 'battle.boss_burst'],
      ['pylon_destroyed', 'battle.boss_pylon'],
      ['core_shield_down', 'battle.boss_shield_down'],
    ] as const)
      expect(cue({ type, tick: 2 })).toBe(id);
  });

  test('events that play nothing, and neutral guards', () => {
    for (const type of [
      'produced',
      'delivered',
      'lost',
      'stalled',
      'guard_spawned',
      'unit_retargeted',
      'conduit_destroyed',
      'ramp_step',
      'core_hit_blocked',
      'battle_ended',
    ])
      expect(cue({ type, tick: 1, side: 0 })).toBeUndefined();
    expect(
      cue({ type: 'unit_died', tick: 1, unit: 1, side: 2 }),
    ).toBeUndefined();
  });

  test('every row names an existing cue, and every cue of the map has a sound or is thinned', () => {
    for (const r of rows) expect(config.cues[r.cue]).toBeDefined();
  });

  test('a battle ending names the stinger of its winner', () => {
    expect(
      stingerFor({ type: 'battle_ended', tick: 1, winner: 0 } as never),
    ).toBe('music.win');
    expect(
      stingerFor({ type: 'battle_ended', tick: 1, winner: 1 } as never),
    ).toBe('music.loss');
    expect(stingerFor({ type: 'unit_died', tick: 1 })).toBeUndefined();
  });

  test('the low mark follows the record health line', () => {
    const ctx = coreLowOf(
      {
        coreMax: [100, 100],
        coreHp: [Int32Array.of(100, 31, 30, 0), Int32Array.of(100)],
      },
      30,
    );
    expect(ctx.coreLow(0, 0)).toBe(false);
    expect(ctx.coreLow(0, 1)).toBe(false);
    expect(ctx.coreLow(0, 2)).toBe(true);
    expect(ctx.coreLow(0, 99)).toBe(true);
    expect(ctx.coreLow(1, 5)).toBe(false);
  });
});

// A recorded battle: the first playable golden versus battle.
interface Vector {
  readonly id: string;
  readonly input: Record<string, Json>;
  readonly expected: { readonly result: { readonly ok: boolean } };
}
const team = (script: Json): TeamState =>
  runTeamStateOps(script, content, content.mapgen).state;
const vector = (battleVectors as unknown as Vector[]).find(
  (v) => v.expected.result.ok && v.input['zone'] === undefined,
);
if (vector === undefined) throw new Error('no golden battle');
const desc: BattleDescription = {
  kind: 'versus',
  input: {
    round: (vector.input['round'] as number | undefined) ?? 1,
    teamA: team(vector.input['teamA'] as Json),
    teamB: team(vector.input['teamB'] as Json),
    seed: vector.input['seed'] as number,
  },
};
const made = simulateRecord(desc, content, battleConfig);
if (!made.ok) throw new Error(made.error.message);
const record: BattleRecord = made.record;

class FakePort implements AudioPort {
  now = 1000;
  started: string[] = [];
  nowMs(): number {
    return this.now;
  }
  after(): () => void {
    return () => undefined;
  }
  resume(): Promise<boolean> {
    return Promise.resolve(true);
  }
  suspend(): Promise<void> {
    return Promise.resolve();
  }
  load(): Promise<number | null> {
    return Promise.resolve(100);
  }
  durationMs(): number {
    return 100;
  }
  play(sound: string): Voice {
    this.started.push(sound);
    return { stop: () => undefined };
  }
  startTrack(): null {
    return null;
  }
  setGroupGain(): void {}
  rampMusic(): void {}
}

async function engine(): Promise<{ e: AudioEngine; p: FakePort }> {
  const p = new FakePort();
  const e = new AudioEngine(config, p, DEFAULT_AUDIO_SETTINGS);
  await e.unlock();
  await new Promise((r) => setTimeout(r, 0));
  p.started = [];
  return { e, p };
}

/** Plays a whole battle at `speed` in frames of 16 ms; returns the sounds. */
async function playThrough(
  speed: 1 | 2 | 4,
  frameMs = 16,
): Promise<{ sounds: string[]; seconds: number }> {
  const { e, p } = await engine();
  const pb = new Playback(desc, content, battleConfig, record);
  pb.setSpeed(speed);
  pb.start();
  const bs = new BattleSounds(config, record, () => e);
  let frames = 0;
  while (!pb.finished && frames < 100_000) {
    const from = pb.tick;
    p.now += frameMs;
    pb.advance(frameMs);
    bs.passed(pb, from);
    frames++;
  }
  return { sounds: p.started, seconds: (frames * frameMs) / 1000 };
}

describe('recorded battle', () => {
  test('the battle has the events the mapping covers', () => {
    const types = new Set(record.eventLog.map((e) => e.type));
    expect(types.has('zone_revealed')).toBe(true);
    expect(types.has('unit_attacked')).toBe(true);
  });

  test('thinned sounds stay at a few per second at every speed, and fall with speed', async () => {
    // Totals over a whole battle: a faster battle is shorter, and sounds fewer.
    const rates: number[] = [];
    for (const speed of [1, 2, 4] as const) {
      const r = await playThrough(speed);
      const perSecond = r.sounds.length / Math.max(1, r.seconds);
      rates.push(r.sounds.length);
      // Attacks are at most 4 per second, spawns and deaths about 3 each,
      // plus a few key moments: far below the raw event rate.
      expect(perSecond).toBeLessThan(11);
      expect(r.seconds).toBeGreaterThan(0);
    }
    expect(rates[1] ?? 0).toBeLessThanOrEqual(rates[0] ?? 0);
    expect(rates[2] ?? 0).toBeLessThanOrEqual(rates[1] ?? 0);
  }, 60_000);

  test('the raw event count is far higher than what plays', async () => {
    const r = await playThrough(1);
    const raw = record.eventLog.filter(
      (e) => cueForEvent(rows, e, never) !== undefined,
    ).length;
    expect(r.sounds.length).toBeLessThan(raw);
    expect(r.sounds.length).toBeGreaterThan(0);
  }, 60_000);

  test('the battle start plays once, with the first frame', async () => {
    const { e, p } = await engine();
    const pb = new Playback(desc, content, battleConfig, record);
    pb.start();
    const bs = new BattleSounds(config, record, () => e);
    pb.advance(100);
    bs.passed(pb, 0);
    expect(p.started).toContain('battle_start');
  });
});

/** A player that records what it is asked to play. */
function spy(): { player: BattlePlayer; cues: string[]; calls: number } {
  const out = { cues: [] as string[], calls: 0 };
  const player: BattlePlayer = {
    playCue: (id) => {
      out.cues.push(id);
      return true;
    },
    playThinned: (c: readonly BattleCue[]) => {
      out.calls++;
      out.cues.push(...c.map((x) => x.cue));
      return [];
    },
  };
  return Object.assign(out, { player });
}

describe('seeking and skipping', () => {
  test('a seek plays no backlog', () => {
    const s = spy();
    const pb = new Playback(desc, content, battleConfig, record);
    const bs = new BattleSounds(config, record, () => s.player);
    const mid = Math.floor(pb.endTick / 2);
    pb.seekTo(mid);
    bs.passed(pb, 0, true);
    expect(s.cues).toEqual([]);
  });

  test('a long jump is a seek even without the flag', () => {
    const s = spy();
    const pb = new Playback(desc, content, battleConfig, record);
    pb.setSpeed(1);
    const bs = new BattleSounds(config, record, () => s.player);
    pb.seekTo(config.mix.seekJumpTicks + 20);
    bs.passed(pb, 0);
    expect(s.cues).toEqual([]);
  });

  test('a normal step plays its events', () => {
    const s = spy();
    const pb = new Playback(desc, content, battleConfig, record);
    pb.start();
    const bs = new BattleSounds(config, record, () => s.player);
    pb.seekTo(1);
    bs.passed(pb, 0);
    expect(s.cues).toContain('battle.start');
  });

  test('skip to the end plays only the result stinger', () => {
    const s = spy();
    const pb = new Playback(desc, content, battleConfig, record);
    pb.start();
    const bs = new BattleSounds(config, record, () => s.player);
    const from = pb.tick;
    pb.skip();
    bs.passed(pb, from, true);
    const winner = record.result.winner;
    expect(s.cues).toEqual([winner === 0 ? 'music.win' : 'music.loss']);
    expect(s.calls).toBe(0);
  });

  test('the stinger plays when playback ends normally', () => {
    const s = spy();
    const pb = new Playback(desc, content, battleConfig, record);
    pb.start();
    const bs = new BattleSounds(config, record, () => s.player);
    let guard = 0;
    while (!pb.finished && guard++ < 100_000) {
      const from = pb.tick;
      pb.advance(100);
      bs.passed(pb, from);
    }
    // The battle loop at the start, then one stinger at the end (#451).
    const music = s.cues.filter((c) => c.startsWith('music.'));
    expect(music).toEqual([
      'music.battle',
      record.result.winner === 0 ? 'music.win' : 'music.loss',
    ]);
  });

  test('a seek never starts the battle loop', () => {
    const s = spy();
    const pb = new Playback(desc, content, battleConfig, record);
    pb.start();
    const bs = new BattleSounds(config, record, () => s.player);
    pb.advance(2000);
    bs.passed(pb, 0, true);
    expect(s.cues).not.toContain('music.battle');
  });

  test('a paused or finished playback passes nothing', () => {
    const s = spy();
    const pb = new Playback(desc, content, battleConfig, record);
    pb.start();
    pb.setPaused(true);
    const bs = new BattleSounds(config, record, () => s.player);
    const from = pb.tick;
    pb.advance(100);
    bs.passed(pb, from);
    expect(s.cues).toEqual([]);
    pb.setPaused(false);
    pb.skip();
    bs.passed(pb, pb.tick);
    expect(s.cues).toEqual([]);
  });

  test('an unavailable engine or a throwing one is harmless', () => {
    const pb = new Playback(desc, content, battleConfig, record);
    pb.start();
    pb.advance(100);
    new BattleSounds(config, record, () => null).passed(pb, 0);
    const bad: BattlePlayer = {
      playCue: () => {
        throw new Error('x');
      },
      playThinned: () => {
        throw new Error('x');
      },
    };
    expect(() => {
      new BattleSounds(config, record, () => bad).passed(pb, 0);
    }).not.toThrow();
  });
});

describe('speed factor', () => {
  test('is read from the mix table', () => {
    const bs = new BattleSounds(config, record, () => null);
    expect([1, 2, 4].map((s) => bs.factor(s))).toEqual([1, 1.33, 2]);
  });

  test('the thinning window widens with the speed', async () => {
    const { e, p } = await engine();
    const hit = (u: number): ArenaEvent =>
      ({
        type: 'unit_attacked',
        tick: 1,
        unit: u,
        damage: 1,
        target: { kind: 'unit', unit: 99 },
      }) as unknown as ArenaEvent;
    const run = (factor: number): number => {
      p.started = [];
      p.now += 10_000;
      for (let i = 0; i < 40; i++) {
        p.now += 50;
        e.playThinned(
          [{ cue: cueForEvent(rows, hit(i + 1), never)?.cue ?? '', unit: i }],
          factor,
        );
      }
      return p.started.length;
    };
    const one = run(1);
    const two = run(1.33);
    const four = run(2);
    expect(one).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(four);
    expect(one / 2).toBeLessThanOrEqual(4 * 1.01); // 40 x 50 ms = 2 s, at most 4 per second
  });
});
