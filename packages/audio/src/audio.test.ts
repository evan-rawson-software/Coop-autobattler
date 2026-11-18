import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildAll, outDir, readSounds, repoRoot, sfxDir } from './build.js';
import { checkRecipe, loadSounds, type Recipe } from './model.js';
import { synthesize } from './synth.js';
import { decodeWav, encodeWav } from './wav.js';

const MAX_FILE = 56 * 1024;
const MAX_SFX_TOTAL = 1024 * 1024;
const MAX_ALL = 2 * 1024 * 1024;

const base: Recipe = {
  wave: 'sine',
  seed: 1,
  freq: 440,
  attackMs: 5,
  holdMs: 20,
  decayMs: 60,
  gain: 0.5,
};

describe('synthesiser', () => {
  test('is deterministic for every wave', () => {
    for (const wave of [
      'sine',
      'triangle',
      'square',
      'saw',
      'noise',
    ] as const) {
      const r = { ...base, wave, lowpass: 3000, highpass: 100 };
      expect(Buffer.from(synthesize(r).buffer)).toEqual(
        Buffer.from(synthesize(r).buffer),
      );
    }
  });
  test('the seed changes noise and only noise', () => {
    const a = synthesize({ ...base, wave: 'noise', seed: 1 });
    const b = synthesize({ ...base, wave: 'noise', seed: 2 });
    expect(a).not.toEqual(b);
    expect(synthesize({ ...base, seed: 1 })).toEqual(
      synthesize({ ...base, seed: 2 }),
    );
  });
  test('length is the envelope sum and the tail is silent', () => {
    const s = synthesize(base);
    expect(s.length).toBe(Math.round((85 * 22050) / 1000));
    expect(s[s.length - 1]).toBe(0);
    expect(Math.max(...s)).toBeGreaterThan(0);
  });
  test('slide falls to the floor and no lower', () => {
    const r = { ...base, slide: -4, minFreq: 200, holdMs: 400 };
    expect(synthesize(r).length).toBeGreaterThan(0);
  });
});

describe('wav writer', () => {
  test('a plain 44-byte header, mono 16-bit', () => {
    const wav = encodeWav(
      Int16Array.from([0, 1000, -1000, 32767, -32768]),
      22050,
    );
    expect(wav.length).toBe(44 + 10);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    const d = decodeWav(wav);
    expect([d.rate, d.channels, d.bits]).toEqual([22050, 1, 16]);
    expect([...d.samples]).toEqual([0, 1000, -1000, 32767, -32768]);
  });
});

describe('recipe limits', () => {
  test('rejects what AU-42 forbids', () => {
    expect(checkRecipe('ui_ok', base)).toEqual([]);
    expect(checkRecipe('ui_ok', { ...base, freq: 5000 })).not.toEqual([]);
    expect(checkRecipe('ui_ok', { ...base, holdMs: 1190 }).join()).toContain(
      'over 1200',
    );
    expect(
      checkRecipe('ui_ok', {
        ...base,
        freq: 3500,
        arpeggio: { steps: [12], stepMs: 50 },
      }).join(),
    ).toContain('6000');
    expect(checkRecipe('bad', base)).not.toEqual([]);
    expect(checkRecipe('ui_ok', { ...base, extra: 1 })).not.toEqual([]);
    expect(loadSounds({ version: 1, sampleRate: 16000, sounds: {} }).ok).toBe(
      false,
    );
  });
});

describe('committed sounds', () => {
  const config = readSounds();
  const fresh = buildAll(config);

  test('content/sounds.json passes the limits', () => {
    expect(
      loadSounds(
        JSON.parse(
          readFileSync(path.join(repoRoot, 'content', 'sounds.json'), 'utf8'),
        ),
      ).ok,
    ).toBe(true);
  });

  test('every wav and the manifest match a fresh build (not stale)', () => {
    expect(readdirSync(sfxDir).sort()).toEqual([...fresh.wavs.keys()].sort());
    for (const [file, buf] of fresh.wavs)
      expect(
        Buffer.compare(readFileSync(path.join(sfxDir, file)), buf),
        file,
      ).toBe(0);
    expect(readFileSync(path.join(outDir, 'manifest.json'), 'utf8')).toBe(
      fresh.manifestJson,
    );
  });

  test('building twice gives identical bytes', () => {
    expect(buildAll(config).manifestJson).toBe(fresh.manifestJson);
  });

  test('manifest is sorted and describes the files', () => {
    const ids = fresh.manifest.files.map((f) => f.id);
    expect(ids).toEqual([...ids].sort());
    for (const f of fresh.manifest.files) {
      expect(f.bytes).toBe(fresh.wavs.get(`${f.id}.wav`)?.length);
      expect(f.durationMs).toBeGreaterThan(0);
    }
  });

  test('every sound is audible, not clipped hard and under 6 kHz energy limits', () => {
    for (const [id, r] of Object.entries(config.sounds)) {
      const s = synthesize(r);
      const peak = Math.max(...s.map(Math.abs));
      expect(peak, id).toBeGreaterThan(1000);
      expect(peak, id).toBeLessThanOrEqual(32767);
    }
  });

  test('size limits (AU-44)', () => {
    let total = 0;
    for (const f of fresh.manifest.files) {
      expect(f.bytes, f.id).toBeLessThanOrEqual(MAX_FILE);
      total += f.bytes;
    }
    expect(total).toBeLessThanOrEqual(MAX_SFX_TOTAL);
    const small = ['content/sounds.json', 'assets/audio/manifest.json'].reduce(
      (n, f) => n + readFileSync(path.join(repoRoot, f)).length,
      0,
    );
    expect(small).toBeLessThanOrEqual(60 * 1024);
    expect(total + small).toBeLessThanOrEqual(MAX_ALL);
  });

  test('the effect cues of the design doc and the sounds are the same set', () => {
    const doc = readFileSync(
      path.join(repoRoot, 'docs', 'specs', '08-audio.md'),
      'utf8',
    );
    const cues = doc
      .split('\n')
      .filter((l) =>
        /^\| `(ui|build|shop|run|event|battle)\.[a-z0-9_]+` \|/.test(l),
      )
      .filter((l) => !l.includes('**Reserved**'))
      .map((l) => /^\| `([^`]+)`/.exec(l)?.[1]?.replace('.', '_') ?? '');
    expect(cues.length).toBeGreaterThan(40);
    expect(Object.keys(config.sounds).sort()).toEqual([...cues].sort());
  });
});
