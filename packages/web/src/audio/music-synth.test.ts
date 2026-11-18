import { describe, expect, test } from 'vitest';
import { loadMusic, trackEndSeconds, trackSeconds } from '@game/audio';
import { rawMusic } from '@game/content';
import { LOOKAHEAD_S, TrackPlayer, fadeCurve } from './music-synth.js';
import { WebAudioPort, type ContextLike } from './web-port.js';

const loaded = loadMusic(rawMusic);
if (!loaded.ok) throw new Error('content/music.json does not load');
const music = loaded.config;

interface Param {
  value: number;
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
  setValueCurveAtTime(c: Float32Array, t: number, d: number): void;
  cancelScheduledValues(t: number): void;
}

/** A fake context that records what the synth builds, never makes sound. */
class FakeCtx {
  currentTime = 0;
  oscillators: { freq: number; type: string; start: number; stop: number }[] =
    [];
  gains: { curves: { at: number; dur: number }[]; sets: number[] }[] = [];
  disconnected = 0;
  private param(rec: {
    curves: { at: number; dur: number }[];
    sets: number[];
  }): Param {
    return {
      value: 1,
      setValueAtTime: (v) => void rec.sets.push(v),
      linearRampToValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
      setValueCurveAtTime: (_c, at, dur) => void rec.curves.push({ at, dur }),
      cancelScheduledValues: () => undefined,
    };
  }
  createGain(): GainNode {
    const rec = { curves: [], sets: [] as number[] };
    this.gains.push(rec);
    const count = (): void => {
      this.disconnected += 1;
    };
    return {
      gain: this.param(rec),
      connect: () => undefined,
      disconnect: count,
    } as unknown as GainNode;
  }
  createBiquadFilter(): BiquadFilterNode {
    return {
      type: 'lowpass',
      frequency: { value: 0 },
      connect: () => undefined,
    } as unknown as BiquadFilterNode;
  }
  createOscillator(): OscillatorNode {
    const rec = { freq: 0, type: '', start: 0, stop: 0 };
    this.oscillators.push(rec);
    const o = {
      frequency: {
        set value(v: number) {
          rec.freq = v;
        },
      },
      set type(v: string) {
        rec.type = v;
      },
      connect: () => undefined,
      disconnect: () => undefined,
      start: (t: number) => void (rec.start = t),
      stop: (t: number) => void (rec.stop = t),
      onended: null,
    };
    return o as unknown as OscillatorNode;
  }
}

class Timers {
  list: { fn: () => void; ms: number; alive: boolean }[] = [];
  setTimer(fn: () => void, ms: number): unknown {
    const t = { fn, ms, alive: true };
    this.list.push(t);
    return t;
  }
  clearTimer(h: unknown): void {
    (h as { alive: boolean }).alive = false;
  }
  /** Runs the live timers once. */
  fire(): void {
    const live = this.list.filter((t) => t.alive);
    this.list = [];
    for (const t of live) t.fn();
  }
}

function player(
  id: keyof typeof music.tracks,
  fadeInMs: number,
  onEnded?: () => void,
): { p: TrackPlayer; ctx: FakeCtx; timers: Timers } {
  const ctx = new FakeCtx();
  const timers = new Timers();
  const track = music.tracks[id];
  if (track === undefined) throw new Error(id);
  const p = new TrackPlayer(
    ctx,
    {} as unknown as AudioNode,
    music,
    track,
    1,
    fadeInMs,
    timers,
    onEnded,
  );
  return { p, ctx, timers };
}

describe('fadeCurve', () => {
  test('equal power: the two halves of a crossfade sum to constant power', () => {
    const up = fadeCurve(1, true);
    const down = fadeCurve(1, false);
    expect(up[0]).toBeCloseTo(0);
    expect(up.at(-1)).toBeCloseTo(1);
    expect(down[0]).toBeCloseTo(1);
    expect(down.at(-1)).toBeCloseTo(0);
    for (let i = 0; i < up.length; i++)
      expect((up[i] ?? 0) ** 2 + (down[i] ?? 0) ** 2).toBeCloseTo(1);
  });
});

describe('TrackPlayer', () => {
  test('schedules only the look-ahead, then more as the clock moves', () => {
    const { ctx, timers } = player('music_build', 1500);
    const first = ctx.oscillators.length;
    expect(first).toBeGreaterThan(0);
    const latest = (): number =>
      Math.max(...ctx.oscillators.map((o) => o.start));
    expect(latest()).toBeLessThanOrEqual(ctx.currentTime + LOOKAHEAD_S + 3.1);
    ctx.currentTime = 10;
    timers.fire();
    expect(ctx.oscillators.length).toBeGreaterThan(first);
    expect(latest()).toBeGreaterThan(10);
  });

  test('a loop wraps with no gap: round two starts on the loop length', () => {
    const { ctx, timers } = player('music_build', 0);
    const track = music.tracks['music_build'];
    if (track === undefined) throw new Error('missing');
    const len = trackSeconds(track);
    const starts = (): number[] => ctx.oscillators.map((o) => o.start);
    const first = Math.min(...starts());
    // Advance the clock in 200 ms ticks to just past the end of round one.
    for (let t = 0; ctx.currentTime < len + 2; t++) {
      ctx.currentTime += 0.2;
      timers.fire();
    }
    const again = starts().filter((s) => s >= first + len - 1e-6);
    expect(again.length).toBeGreaterThan(0);
    // The very first note of the track repeats exactly one loop later.
    const firstNotes = starts().filter((s) => Math.abs(s - first) < 1e-9);
    const repeats = starts().filter((s) => Math.abs(s - (first + len)) < 1e-9);
    expect(repeats.length).toBe(firstNotes.length);
  });

  test('scheduled notes are deterministic', () => {
    const a = player('music_battle', 0);
    const b = player('music_battle', 0);
    expect(a.ctx.oscillators).toEqual(b.ctx.oscillators);
  });

  test('a stinger schedules its bars, ends once, and stops', () => {
    let ended = 0;
    const { ctx, timers, p } = player('music_win', 0, () => (ended += 1));
    const track = music.tracks['music_win'];
    if (track === undefined) throw new Error('missing');
    const end = trackEndSeconds(track, music.instruments);
    expect(end).toBeGreaterThan(2);
    expect(end).toBeLessThanOrEqual(4);
    ctx.currentTime = 1;
    timers.fire();
    expect(ended).toBe(0);
    ctx.currentTime = end + 1;
    timers.fire();
    timers.fire();
    expect(ended).toBe(1);
    // Every note was scheduled once: no round two.
    expect(Math.max(...ctx.oscillators.map((o) => o.start))).toBeLessThan(
      end + 0.2,
    );
    expect(timers.list.filter((t) => t.alive)).toEqual([]);
    p.stop();
  });

  test('fade in uses one equal-power curve; fade out is a curve then a stop', () => {
    const { ctx, timers, p } = player('music_battle', 1500);
    expect(ctx.gains[0]?.curves[0]?.dur).toBeCloseTo(1.5);
    p.fadeOut(400);
    expect(ctx.gains[0]?.curves).toHaveLength(2);
    expect(ctx.gains[0]?.curves[1]?.dur).toBeCloseTo(0.4);
    const before = ctx.oscillators.length;
    timers.fire(); // the stop timer
    expect(ctx.disconnected).toBeGreaterThan(0);
    ctx.currentTime = 30;
    timers.fire();
    expect(ctx.oscillators.length).toBe(before);
  });

  test('stop is safe to repeat', () => {
    const { p } = player('music_build', 0);
    p.stop();
    expect(() => {
      p.stop();
      p.fadeOut(10);
    }).not.toThrow();
  });
});

describe('the Web Audio port music', () => {
  test('startTrack is null without a context, a track or the music data', () => {
    const deps = {
      fetchSound: () => Promise.resolve(null),
      clock: () => 0,
      setTimer: () => 0,
      clearTimer: () => undefined,
    };
    const none = new WebAudioPort({ ...deps, ctor: undefined, music });
    expect(none.startTrack('music_build', 1, 0)).toBeNull();
    const ctx = new FakeCtx();
    const full = {
      currentTime: 0,
      state: 'running',
      destination: {} as AudioNode,
      resume: () => Promise.resolve(),
      suspend: () => Promise.resolve(),
      createBufferSource: () => ({}) as AudioBufferSourceNode,
      decodeAudioData: () => Promise.reject(new Error('no')),
      createGain: ctx.createGain.bind(ctx),
      createOscillator: ctx.createOscillator.bind(ctx),
      createBiquadFilter: ctx.createBiquadFilter.bind(ctx),
    } as unknown as ContextLike;
    const port = new WebAudioPort({
      ...deps,
      ctor: function () {
        return full;
      } as unknown as new () => ContextLike,
      music,
    });
    expect(port.startTrack('music_build', 1, 0)).toBeNull(); // not unlocked
    return port.resume().then(() => {
      expect(port.startTrack('music_nope', 1, 0)).toBeNull();
      expect(port.startTrack('music_build', 1, 0)).not.toBeNull();
    });
  });
});
