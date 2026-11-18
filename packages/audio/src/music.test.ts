import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { repoRoot } from './build.js';
import { loadAudio, cueSounds, type AudioConfig } from './cues.js';
import {
  barNotes,
  type Track,
  type TrackVoice,
  degreeOf,
  loadMusic,
  midiOf,
  midiToHz,
  trackEndSeconds,
  trackNotes,
  trackSeconds,
  type MusicConfig,
} from './music.js';

const read = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));

const loaded = loadMusic(read('content/music.json'));
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const music = loaded.config;

const tr = (m: MusicConfig, id: string): Track => m.tracks[id] as Track;
const clone = (): MusicConfig =>
  JSON.parse(JSON.stringify(music)) as MusicConfig;

describe('content/music.json', () => {
  test('has the four tracks of AU-45', () => {
    expect(Object.keys(music.tracks).sort()).toEqual([
      'music_battle',
      'music_build',
      'music_loss',
      'music_win',
    ]);
  });

  test('loops run 45 to 90 s, stingers 2 to 4 s', () => {
    for (const [id, t] of Object.entries(music.tracks)) {
      const s = trackEndSeconds(t, music.instruments);
      if (t.loop) {
        expect(s, id).toBeGreaterThanOrEqual(45);
        expect(s, id).toBeLessThanOrEqual(90);
        expect(trackSeconds(t)).toBe(s);
      } else {
        expect(s, id).toBeGreaterThanOrEqual(2);
        expect(s, id).toBeLessThanOrEqual(4);
      }
    }
  });

  test('the loops are the calm one and a livelier one', () => {
    const calm = music.tracks['music_build'];
    const busy = music.tracks['music_battle'];
    if (calm === undefined || busy === undefined) throw new Error('missing');
    expect(busy.bpm).toBeGreaterThan(calm.bpm);
    expect(trackNotes(busy).length).toBeGreaterThan(
      trackNotes(calm).length * 2,
    );
  });

  test('every music cue names a track and every track has a cue', () => {
    const audio = read('content/audio.json') as AudioConfig;
    const r = loadAudio(audio, {
      trackIds: new Set(Object.keys(music.tracks)),
    });
    expect(r.ok ? [] : r.errors).toEqual([]);
    const used = new Set<string>();
    for (const [id, c] of Object.entries(audio.cues))
      if (c.group === 'music') for (const s of cueSounds(id, c)) used.add(s);
    expect([...used].sort()).toEqual(Object.keys(music.tracks).sort());
  });

  test('stays within the size budget (AU-44: music data 30 KB)', () => {
    expect(
      statSync(path.join(repoRoot, 'content/music.json')).size,
    ).toBeLessThan(30 * 1024);
  });

  test('a music cue naming a missing track is refused', () => {
    const audio = read('content/audio.json') as AudioConfig;
    const r = loadAudio(audio, { trackIds: new Set(['music_build']) });
    expect(r.ok).toBe(false);
  });
});

describe('notes', () => {
  test('degrees and pitch', () => {
    expect(degreeOf('0')).toBe(0);
    expect(degreeOf('9')).toBe(9);
    expect(degreeOf('a')).toBe(10);
    expect(degreeOf('f')).toBe(15);
    expect(degreeOf('.')).toBeUndefined();
    const t = { root: 48, scale: [0, 2, 4, 7, 9] };
    expect(midiOf(t, 0)).toBe(48);
    expect(midiOf(t, 3)).toBe(55);
    expect(midiOf(t, 5)).toBe(60);
    expect(midiOf(t, 7)).toBe(64);
    expect(midiOf(t, 0, -12)).toBe(36);
    expect(midiToHz(69)).toBeCloseTo(440);
  });

  test('are a pure, sorted function of the track', () => {
    const t = music.tracks['music_battle'];
    if (t === undefined) throw new Error('missing');
    expect(trackNotes(t)).toEqual(trackNotes(t));
    const times = trackNotes(t).map((n) => n.timeSec);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(barNotes(t, 1)[0]?.timeSec).toBeGreaterThanOrEqual((60 / 112) * 4);
  });

  test('every note is in the scale of its track', () => {
    for (const t of Object.values(music.tracks))
      for (const n of trackNotes(t)) {
        const pc = (((n.midi - t.root) % 12) + 12) % 12;
        expect(t.scale).toContain(pc);
      }
  });
});

describe('loadMusic', () => {
  const errs = (d: unknown): string => {
    const r = loadMusic(d);
    return r.ok ? '' : r.errors.join('\n');
  };

  test('refuses what is wrong', () => {
    expect(errs(null)).toContain('object');
    let m = clone();
    m.version = 2;
    expect(errs(m)).toContain('version');
    m = clone();
    (tr(m, 'music_build').voices[0] as TrackVoice).instrument = 'kazoo';
    expect(errs(m)).toContain('kazoo');
    m = clone();
    (tr(m, 'music_build').voices[0] as TrackVoice).pattern[0] = '0..';
    expect(errs(m)).toContain('16 characters');
    m = clone();
    (tr(m, 'music_build').voices[0] as TrackVoice).pattern[0] =
      'z...............';
    expect(errs(m)).toContain('bad character');
    m = clone();
    (tr(m, 'music_build').voices[0] as TrackVoice).pattern.pop();
    expect(errs(m)).toContain('16 bars');
    m = clone();
    tr(m, 'music_build').bars = 2;
    for (const v of tr(m, 'music_build').voices) v.pattern.length = 2;
    expect(errs(m)).toContain('a loop must run');
    m = clone();
    tr(m, 'music_win').bpm = 40;
    expect(errs(m)).toContain('stinger');
    m = clone();
    (tr(m, 'music_build').voices[0] as TrackVoice).shift = 7;
    expect(errs(m)).toContain('multiple of 12');
    m = clone();
    (tr(m, 'music_build').voices[0] as TrackVoice).shift = 48;
    expect(errs(m)).toContain('multiple of 12');
    m = clone();
    (m.instruments['pluck'] as { attackMs: number }).attackMs = 0;
    expect(errs(m)).toContain('attackMs');
  });
});
