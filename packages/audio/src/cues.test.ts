import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { repoRoot } from './build.js';
import { cueSounds, loadAudio, type AudioConfig } from './cues.js';
import { loadSounds } from './model.js';

const read = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));

const sounds = loadSounds(read('content/sounds.json'));
const soundIds = new Set(sounds.ok ? Object.keys(sounds.config.sounds) : []);
const audioData = read('content/audio.json') as AudioConfig;

describe('content/audio.json', () => {
  test('loads, with every sound known', () => {
    const r = loadAudio(audioData, { soundIds });
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  test('every generated sound is played by an enabled cue', () => {
    const used = new Set<string>();
    for (const [id, c] of Object.entries(audioData.cues))
      if (c.group === 'effects' && c.enabled !== false)
        for (const s of cueSounds(id, c)) used.add(s);
    // ui.hover is off in the first release but keeps its sound.
    used.add('ui_hover');
    expect([...soundIds].filter((s) => !used.has(s))).toEqual([]);
  });

  test('defaults match AU-21', () => {
    expect(audioData.groups).toEqual({ master: 80, music: 50, effects: 80 });
  });
});

describe('loadAudio', () => {
  const clone = (): AudioConfig =>
    JSON.parse(JSON.stringify(audioData)) as AudioConfig;
  const errorsOf = (d: unknown): string =>
    JSON.stringify(
      (
        loadAudio(d, { soundIds, eventTypes: new Set(['unit_died']) }) as {
          errors?: string[];
        }
      ).errors ?? [],
    );

  test('rejects an unknown sound', () => {
    const d = clone();
    d.cues['shop.buy'] = {
      ...(d.cues['shop.buy'] as object),
      sound: 'nope_nothing',
    } as never;
    expect(errorsOf(d)).toContain('nope_nothing');
  });

  test('rejects a battle row with an unknown event or cue', () => {
    const d = clone();
    d.battleMap.push({ event: 'made_up', when: {}, cue: 'battle.nothing' });
    expect(errorsOf(d)).toContain('made_up');
    expect(errorsOf(d)).toContain('battle.nothing');
  });

  test('rejects out-of-range numbers and unknown fields', () => {
    const d = clone();
    (d.cues['ui.click'] as unknown as Record<string, unknown>)['volume'] = 150;
    (d.cues['ui.click'] as unknown as Record<string, unknown>)['loud'] = 1;
    expect(errorsOf(d)).toContain('volume');
    expect(errorsOf(d)).toContain('loud');
  });

  test('rejects non-objects', () => {
    expect(loadAudio(null).ok).toBe(false);
  });
});
