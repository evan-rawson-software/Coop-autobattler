import { describe, expect, test, vi } from 'vitest';
import { loadAudio, type AudioConfig } from '@game/audio';
import { rawAudio } from '@game/content';
import {
  AudioEngine,
  type AudioPort,
  type MusicVoice,
  type Voice,
} from './engine.js';
import {
  DEFAULT_AUDIO_SETTINGS,
  parseAudioSettings,
  serializeAudioSettings,
  volumeGain,
  type AudioSettings,
} from './settings.js';
import { Thinner, compareCandidates } from './thin.js';
import { WebAudioPort, type ContextLike } from './web-port.js';

const loaded = loadAudio(rawAudio);
if (!loaded.ok) throw new Error('content/audio.json does not load');
const config: AudioConfig = loaded.config;

class FakePort implements AudioPort {
  now = 1000;
  running = true;
  resumes = 0;
  suspends = 0;
  started: { sound: string; gain: number; rate: number; stopped: boolean }[] =
    [];
  gains: Record<string, number> = {};
  ramps: { factor: number; ms: number }[] = [];
  timers: { at: number; fn: () => void }[] = [];
  decoded = new Set<string>();
  loads: string[] = [];
  lengthMs = 500;

  nowMs(): number {
    return this.now;
  }
  after(ms: number, fn: () => void): () => void {
    const t = { at: this.now + ms, fn };
    this.timers.push(t);
    return () => {
      this.timers = this.timers.filter((x) => x !== t);
    };
  }
  advance(ms: number): void {
    this.now += ms;
    for (const t of this.timers.filter((x) => x.at <= this.now)) {
      this.timers = this.timers.filter((x) => x !== t);
      t.fn();
    }
  }
  resume(): Promise<boolean> {
    this.resumes += 1;
    return Promise.resolve(this.running);
  }
  suspend(): Promise<void> {
    this.suspends += 1;
    return Promise.resolve();
  }
  load(id: string): Promise<number | null> {
    this.loads.push(id);
    this.decoded.add(id);
    return Promise.resolve(this.lengthMs);
  }
  durationMs(id: string): number | undefined {
    return this.decoded.has(id) ? this.lengthMs : undefined;
  }
  play(sound: string, gain: number, rate: number): Voice {
    const v = { sound, gain, rate, stopped: false };
    this.started.push(v);
    return {
      stop: () => {
        v.stopped = true;
      },
    };
  }
  tracks: {
    id: string;
    level: number;
    fadeInMs: number;
    fadeOutMs?: number;
    stopped: boolean;
    end: () => void;
  }[] = [];
  startTrack(
    id: string,
    level: number,
    fadeInMs: number,
    onEnded?: () => void,
  ): MusicVoice {
    const t = {
      id,
      level,
      fadeInMs,
      stopped: false,
      end: () => {
        t.stopped = true;
        onEnded?.();
      },
    } as (typeof this.tracks)[number];
    this.tracks.push(t);
    return {
      fadeOut: (ms: number) => {
        t.fadeOutMs = ms;
        t.stopped = true;
      },
      stop: () => {
        t.stopped = true;
      },
    };
  }
  setGroupGain(group: string, gain: number): void {
    this.gains[group] = gain;
  }
  rampMusic(factor: number, ms: number): void {
    this.ramps.push({ factor, ms });
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function ready(
  settings: AudioSettings = DEFAULT_AUDIO_SETTINGS,
): Promise<{ e: AudioEngine; p: FakePort }> {
  const p = new FakePort();
  const e = new AudioEngine(config, p, settings);
  await e.unlock();
  // Unlock preloads every effect sound; let the decodes finish.
  await flush();
  p.advance(10_000);
  p.started = [];
  return { e, p };
}

describe('unlock', () => {
  test('nothing plays before the first gesture', async () => {
    const p = new FakePort();
    const e = new AudioEngine(config, p, DEFAULT_AUDIO_SETTINGS);
    expect(e.playCue('ui.click')).toBe(false);
    expect(p.loads).toEqual([]);
    expect(p.started).toEqual([]);
    expect(await e.unlock()).toBe(true);
    expect(e.isUnlocked).toBe(true);
    expect(p.gains['master']).toBeCloseTo(volumeGain(80));
  });

  test('a context that stays suspended is not unlocked', async () => {
    const p = new FakePort();
    p.running = false;
    const e = new AudioEngine(config, p, DEFAULT_AUDIO_SETTINGS);
    expect(await e.unlock()).toBe(false);
    expect(e.playCue('ui.click')).toBe(false);
  });

  test('no port: everything is a no-op and nothing throws', async () => {
    const e = new AudioEngine(config, null, DEFAULT_AUDIO_SETTINGS);
    expect(await e.unlock()).toBe(false);
    expect(e.playCue('ui.click')).toBe(false);
    expect(e.playThinned([{ cue: 'battle.attack' }])).toEqual([]);
    e.setHidden(true);
    e.setSettings({ ...DEFAULT_AUDIO_SETTINGS, muted: true });
  });

  test('a port that throws never breaks the game', async () => {
    const p = new FakePort();
    p.play = () => {
      throw new Error('boom');
    };
    const e = new AudioEngine(config, p, DEFAULT_AUDIO_SETTINGS);
    await e.unlock();
    e.playCue('ui.click');
    await flush();
    expect(e.playCue('ui.click')).toBe(false);
  });
});

describe('playing', () => {
  test('unlock preloads every effect sound, so the first play is heard', async () => {
    const p = new FakePort();
    const e = new AudioEngine(config, p, DEFAULT_AUDIO_SETTINGS);
    await e.unlock();
    await flush();
    expect(p.loads).toContain('ui_click');
    expect(p.loads).toContain('shop_buy');
    expect(p.loads).not.toContain('ui_hover');
    expect(e.playCue('ui.click')).toBe(true);
    expect(p.started[0]?.gain).toBeCloseTo(0.6);
  });

  test('a sound that is still decoding drops the request', async () => {
    const p = new FakePort();
    let finish: (n: number) => void = () => undefined;
    p.load = (id) => {
      p.loads.push(id);
      return new Promise((r) => {
        finish = (n) => {
          p.decoded.add(id);
          r(n);
        };
      });
    };
    const e = new AudioEngine(config, p, DEFAULT_AUDIO_SETTINGS);
    await e.unlock();
    expect(e.playCue('ui.click')).toBe(false);
    expect(p.started).toEqual([]);
    finish(500);
    await flush();
    expect(p.loads.filter((x) => x === 'ui_click').length).toBe(1);
  });

  test('the gain and pitch options apply; unknown cues are ignored', async () => {
    const { e, p } = await ready();
    expect(e.playCue('ui.click', { gain: 0.5, pitch: 9 })).toBe(true);
    expect(p.started[0]?.gain).toBeCloseTo(0.3);
    expect(p.started[0]?.rate).toBe(2);
    expect(e.playCue('no.such_cue')).toBe(false);
  });

  test('the minimum gap drops a repeat', async () => {
    const { e, p } = await ready();
    expect(e.playCue('ui.click')).toBe(true);
    p.advance(10);
    expect(e.playCue('ui.click')).toBe(false);
    p.advance(60);
    expect(e.playCue('ui.click')).toBe(true);
  });

  test('the per-cue voice limit', async () => {
    const { e, p } = await ready();
    p.lengthMs = 5000;
    p.decoded.clear();
    e.playCue('ui.click');
    await flush();
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(e.playCue('ui.click'));
      p.advance(100);
    }
    expect(results.filter(Boolean).length).toBe(
      config.cues['ui.click']?.maxVoices,
    );
  });

  test('over the global limit the lowest priority goes, a low one is dropped', async () => {
    const { e, p } = await ready();
    p.lengthMs = 60_000;
    p.decoded.clear();
    const ids = Object.keys(config.cues).filter((id) => {
      const c = config.cues[id];
      return c?.group === 'effects' && c.enabled !== false && c.priority === 1;
    });
    for (const id of ids) e.playCue(id);
    await flush();
    let n = 0;
    for (let round = 0; round < 3; round++)
      for (const id of ids) {
        p.advance(1000);
        if (e.playCue(id)) n++;
      }
    expect(e.voiceCount).toBeLessThanOrEqual(config.mix.effectVoices);
    expect(n).toBeGreaterThan(0);
    // A priority 3 cue pushes a low one out.
    const high = Object.keys(config.cues).find(
      (id) =>
        config.cues[id]?.priority === 3 && config.cues[id].group === 'effects',
    ) as string;
    p.decoded.clear();
    e.playCue(high);
    await flush();
    p.advance(5000);
    const before = e.voiceCount;
    expect(e.playCue(high)).toBe(true);
    expect(e.voiceCount).toBeLessThanOrEqual(
      Math.max(before, config.mix.effectVoices),
    );
    expect(p.started.some((v) => v.stopped)).toBe(
      before >= config.mix.effectVoices,
    );
  });

  test('mute drops cues and silences the master', async () => {
    const { e, p } = await ready();
    e.setSettings({ ...DEFAULT_AUDIO_SETTINGS, muted: true });
    expect(p.gains['master']).toBe(0);
    expect(e.playCue('ui.click')).toBe(false);
    e.setSettings(DEFAULT_AUDIO_SETTINGS);
    expect(e.playCue('ui.click')).toBe(true);
  });

  test('volume changes set the group gains at once', async () => {
    const { e, p } = await ready();
    e.setSettings({ master: 50, music: 20, effects: 100, muted: false });
    expect(p.gains['master']).toBe(0.25);
    expect(p.gains['music']).toBeCloseTo(0.04);
    expect(p.gains['effects']).toBe(1);
  });
});

describe('hidden tab and ducking', () => {
  test('hiding fades the music, stops effects and drops cues', async () => {
    const { e, p } = await ready();
    expect(e.playCue('ui.click')).toBe(true);
    e.setHidden(true);
    expect(p.started.every((v) => v.stopped)).toBe(true);
    expect(p.ramps.at(-1)?.factor).toBe(0);
    expect(e.playCue('ui.toggle')).toBe(false);
    p.advance(1000);
    expect(p.suspends).toBe(1);
    e.setHidden(false);
    await flush();
    expect(p.ramps.at(-1)?.factor).toBe(1);
    p.advance(100);
    expect(e.playCue('ui.toggle')).toBe(true);
  });

  test('a ducking cue lowers the music and releases it', async () => {
    const { e, p } = await ready();
    expect(e.playCue('run.over')).toBe(true);
    expect(p.ramps.at(-1)).toEqual({
      factor: 0.5,
      ms: config.mix.duckAttackMs,
    });
    p.advance(2000);
    expect(p.ramps.at(-1)).toEqual({
      factor: 1,
      ms: config.mix.duckReleaseMs,
    });
  });

  test('the deepest duck wins', async () => {
    const { e, p } = await ready();
    e.playCue('run.over');
    p.advance(100);
    e.playCue('run.new_best');
    expect(p.ramps.at(-1)?.factor).toBe(0.3);
  });
});

describe('thinning', () => {
  const c = (
    cue: string,
    thin: 'attack',
    priority: number,
    damage = 0,
    unit = 0,
  ) => ({
    cue,
    thin,
    priority,
    damage,
    unit,
  });

  test('best first: priority, then damage, then lowest unit', () => {
    const list = [
      c('a', 'attack', 1, 5, 2),
      c('b', 'attack', 2, 1, 9),
      c('d', 'attack', 1, 5, 1),
    ];
    list.sort(compareCandidates);
    expect(list.map((x) => x.cue)).toEqual(['b', 'd', 'a']);
  });

  test('one per class per window, scaled by the speed factor', () => {
    const t = new Thinner({ attack: 250, spawn: 333, death: 333 });
    const hits = [c('unit', 'attack', 1), c('core', 'attack', 2)];
    expect(t.pick(hits, 0).map((x) => x.cue)).toEqual(['core']);
    expect(t.pick(hits, 100)).toEqual([]);
    expect(t.pick(hits, 249)).toEqual([]);
    expect(t.pick(hits, 250).length).toBe(1);
    expect(t.pick(hits, 400, 2)).toEqual([]);
    expect(t.pick(hits, 750, 2).length).toBe(1);
  });

  test('the engine plays core hits before unit hits', async () => {
    const { e, p } = await ready();
    const started = e.playThinned([
      { cue: 'battle.attack', unit: 3 },
      { cue: 'battle.core_hit', damage: 4 },
      { cue: 'battle.attack', unit: 1 },
    ]);
    expect(started).toEqual(['battle.core_hit']);
    expect(p.started.length).toBe(1);
  });
});

describe('music (AU-39)', () => {
  const sounding = (p: FakePort): string[] =>
    p.tracks.filter((t) => !t.stopped).map((t) => t.id);

  test('the wanted loop starts at unlock, not before', async () => {
    const p = new FakePort();
    const e = new AudioEngine(config, p, DEFAULT_AUDIO_SETTINGS);
    expect(e.playCue('music.build')).toBe(false);
    expect(p.tracks).toEqual([]);
    await e.unlock();
    expect(sounding(p)).toEqual(['music_build']);
    expect(p.tracks[0]?.fadeInMs).toBe(config.mix.crossfadeMs);
    expect(p.tracks[0]?.level).toBe(1);
  });

  test('a loop already playing is not started again', async () => {
    const { e, p } = await ready();
    e.playCue('music.build');
    e.playCue('music.build');
    expect(p.tracks).toHaveLength(1);
    expect(sounding(p)).toEqual(['music_build']);
  });

  test('a battle crossfades from the workshop loop and back', async () => {
    const { e, p } = await ready();
    e.playCue('music.build');
    expect(e.playCue('music.battle')).toBe(true);
    expect(p.tracks[0]?.fadeOutMs).toBe(config.mix.crossfadeMs);
    expect(p.tracks[1]).toMatchObject({
      id: 'music_battle',
      fadeInMs: config.mix.crossfadeMs,
    });
    e.playCue('music.build');
    expect(sounding(p)).toEqual(['music_build']);
    expect(p.tracks).toHaveLength(3);
  });

  test('a stinger fades the loop out at once, then the workshop loop returns', async () => {
    const { e, p } = await ready();
    e.playCue('music.battle');
    expect(e.playCue('music.win')).toBe(true);
    const loop = p.tracks[0];
    const stinger = p.tracks[1];
    expect(loop?.fadeOutMs).toBe(config.mix.stingerFadeMs);
    expect(stinger).toMatchObject({ id: 'music_win', fadeInMs: 0 });
    expect(sounding(p)).toEqual(['music_win']);
    stinger?.end();
    expect(sounding(p)).toEqual(['music_build']);
    expect(p.tracks[2]?.fadeInMs).toBe(config.mix.crossfadeMs);
  });

  test('the build loop asked for during a stinger waits for it', async () => {
    const { e, p } = await ready();
    e.playCue('music.battle');
    e.playCue('music.loss');
    e.playCue('music.build');
    expect(sounding(p)).toEqual(['music_loss']);
    p.tracks[1]?.end();
    expect(sounding(p)).toEqual(['music_build']);
  });

  test('a new battle cuts a stinger, and only one stinger sounds', async () => {
    const { e, p } = await ready();
    e.playCue('music.battle');
    e.playCue('music.win');
    e.playCue('music.loss');
    expect(sounding(p)).toEqual(['music_loss']);
    e.playCue('music.battle');
    expect(sounding(p)).toEqual(['music_battle']);
  });

  test('a stinger that cannot sound still brings the workshop loop back', async () => {
    const { e, p } = await ready({
      ...DEFAULT_AUDIO_SETTINGS,
      music: 0,
    });
    e.playCue('music.battle');
    expect(e.playCue('music.win')).toBe(false);
    expect(sounding(p)).toEqual(['music_build']);
  });

  test('a hidden tab starts nothing, and shows the wanted loop later', async () => {
    const { e, p } = await ready();
    e.setHidden(true);
    e.playCue('music.battle');
    expect(p.tracks).toEqual([]);
    expect(e.playCue('music.win')).toBe(false);
    e.setHidden(false);
    await flush();
    expect(sounding(p)).toEqual(['music_build']);
  });

  test('a missing track or a broken port never throws', async () => {
    const p = new FakePort();
    p.startTrack = () => {
      throw new Error('boom');
    };
    const e = new AudioEngine(config, p, DEFAULT_AUDIO_SETTINGS);
    await e.unlock();
    expect(() => e.playCue('music.battle')).not.toThrow();
    expect(() => e.playCue('music.win')).not.toThrow();
  });

  test('the volume of the music cue scales the level', async () => {
    const cfg = JSON.parse(JSON.stringify(config)) as AudioConfig;
    cfg.cues['music.battle'] = {
      ...(cfg.cues['music.battle'] as AudioConfig['cues'][string]),
      volume: 60,
    };
    const p = new FakePort();
    const e = new AudioEngine(cfg, p, DEFAULT_AUDIO_SETTINGS);
    await e.unlock();
    e.playCue('music.battle');
    expect(p.tracks.at(-1)?.level).toBeCloseTo(0.6);
  });
});

const fresh = async (): Promise<typeof import('./settings.js')> => {
  vi.resetModules();
  return import('./settings.js');
};

describe('settings', () => {
  test('defaults, parse, clamp and round trip', () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('not json')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('{"v":2}')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(
      parseAudioSettings(
        '{"v":1,"master":150,"music":-5,"effects":"x","muted":true}',
      ),
    ).toEqual({ master: 100, music: 0, effects: 80, muted: true });
    const s = { master: 10, music: 20, effects: 30, muted: true };
    expect(parseAudioSettings(serializeAudioSettings(s))).toEqual(s);
  });

  test('persistence survives, and works without usable storage', async () => {
    const mem = new Map<string, string>();
    const win = {
      location: { hash: '' },
      localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
      },
    };
    (globalThis as { window?: unknown }).window = win;
    try {
      let mod = await fresh();
      mod.setVolume('music', 33);
      mod.setMuted(true);
      expect(
        parseAudioSettings(mem.get(mod.AUDIO_SETTINGS_KEY) ?? null),
      ).toMatchObject({
        music: 33,
        muted: true,
      });
      mod = await fresh();
      expect(mod.audioSettingsStore.get()).toMatchObject({
        music: 33,
        muted: true,
      });

      win.localStorage.getItem = () => {
        throw new Error('blocked');
      };
      win.localStorage.setItem = () => {
        throw new Error('blocked');
      };
      mod = await fresh();
      expect(mod.audioSettingsStore.get()).toEqual(DEFAULT_AUDIO_SETTINGS);
      mod.setVolume('master', 10);
      expect(mod.audioSettingsStore.get().master).toBe(10);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});

describe('the Web Audio port', () => {
  const deps = {
    fetchSound: () => Promise.resolve(null),
    clock: () => 0,
    setTimer: () => 0,
    clearTimer: () => undefined,
  };

  test('without an AudioContext it is unavailable and never throws', async () => {
    const port = new WebAudioPort({ ...deps, ctor: undefined });
    expect(port.available).toBe(false);
    expect(await port.resume()).toBe(false);
    expect(await port.load('x')).toBeNull();
    expect(port.play('x', 1, 1)).toBeNull();
    port.setGroupGain('master', 1);
    port.rampMusic(0, 10);
    await port.suspend();
  });

  test('a constructor that throws (a blocked context) is survivable', async () => {
    const port = new WebAudioPort({
      ...deps,
      ctor: function () {
        throw new Error('blocked');
      } as unknown as new () => ContextLike,
    });
    expect(await port.resume()).toBe(false);
    expect(port.available).toBe(false);
  });
});
