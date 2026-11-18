/** `pnpm audio:build`: regenerate assets/audio/. Output is deterministic. */

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSounds, type SoundsConfig } from './model.js';
import { sampleCount, synthesize } from './synth.js';
import { encodeWav } from './wav.js';

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
export const outDir = path.join(repoRoot, 'assets', 'audio');
export const sfxDir = path.join(outDir, 'sfx');
export const soundsPath = path.join(repoRoot, 'content', 'sounds.json');

export function readSounds(file = soundsPath): SoundsConfig {
  const r = loadSounds(JSON.parse(readFileSync(file, 'utf8')) as unknown);
  if (!r.ok)
    throw new Error(`content/sounds.json is invalid:\n${r.errors.join('\n')}`);
  return r.config;
}

export interface ManifestFile {
  id: string;
  file: string;
  bytes: number;
  durationMs: number;
  sha256: string;
}

export interface Built {
  /** File name (under sfx/) to bytes. */
  wavs: Map<string, Buffer>;
  manifest: { version: 1; sampleRate: number; files: ManifestFile[] };
  manifestJson: string;
}

export function buildAll(config: SoundsConfig = readSounds()): Built {
  const wavs = new Map<string, Buffer>();
  const files: ManifestFile[] = [];
  for (const [id, recipe] of Object.entries(config.sounds).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const wav = encodeWav(
      synthesize(recipe, config.sampleRate),
      config.sampleRate,
    );
    const file = `${id}.wav`;
    wavs.set(file, wav);
    files.push({
      id,
      file: `sfx/${file}`,
      bytes: wav.length,
      durationMs: Math.round(
        (sampleCount(recipe, config.sampleRate) * 1000) / config.sampleRate,
      ),
      sha256: createHash('sha256').update(wav).digest('hex'),
    });
  }
  const manifest = {
    version: 1 as const,
    sampleRate: config.sampleRate,
    files,
  };
  return {
    wavs,
    manifest,
    manifestJson: JSON.stringify(manifest, null, 2) + '\n',
  };
}

export function writeAll(): void {
  const { wavs, manifestJson } = buildAll();
  mkdirSync(sfxDir, { recursive: true });
  // Remove files of sounds that no longer exist.
  for (const f of readdirSync(sfxDir))
    if (f.endsWith('.wav') && !wavs.has(f)) rmSync(path.join(sfxDir, f));
  let total = 0;
  for (const [file, buf] of wavs) {
    writeFileSync(path.join(sfxDir, file), buf);
    total += buf.length;
  }
  writeFileSync(path.join(outDir, 'manifest.json'), manifestJson);
  console.log(
    `wrote ${String(wavs.size)} sounds (${String(total)} bytes) and manifest.json to ${outDir}`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])))
  writeAll();
