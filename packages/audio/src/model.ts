/**
 * Sound recipes (`content/sounds.json`, AU-42) and their checks. Pure: no
 * Node API, so `@game/tools` can use `loadSounds` to validate the content.
 */

export const WAVES = ['sine', 'triangle', 'square', 'saw', 'noise'] as const;
export type Wave = (typeof WAVES)[number];

export interface Recipe {
  wave: Wave;
  /** The only source of noise (a fixed generator). */
  seed: number;
  /** Start frequency in Hz. */
  freq: number;
  /** Octaves per second; negative falls. */
  slide?: number;
  /** Floor in Hz that stops a falling slide. */
  minFreq?: number;
  /** Pulse width of `square`, 0 to 1. */
  duty?: number;
  attackMs: number;
  holdMs: number;
  decayMs: number;
  vibrato?: { depth: number; rateHz: number };
  arpeggio?: { steps: number[]; stepMs: number };
  lowpass?: number;
  highpass?: number;
  /** Peak level before the cue volume, 0 to 1. */
  gain: number;
}

export interface SoundsConfig {
  version: number;
  sampleRate: number;
  sounds: Record<string, Recipe>;
}

export const SAMPLE_RATE = 22050;
export const MAX_LENGTH_MS = 1200;
export const MAX_HZ = 6000;
export const SOUND_ID = /^[a-z]+_[a-z0-9_]+$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(
  errs: string[],
  where: string,
  v: unknown,
  min: number,
  max: number,
  integer = false,
): v is number {
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  ) {
    errs.push(
      `${where} must be ${integer ? 'an integer' : 'a number'} from ${String(min)} to ${String(max)}`,
    );
    return false;
  }
  return true;
}

/** Highest pitch (Hz) a recipe can reach, to hold it to AU-12. */
export function peakFreq(r: Recipe): number {
  const length = (r.attackMs + r.holdMs + r.decayMs) / 1000;
  const octaves =
    Math.max(0, (r.slide ?? 0) * length) +
    Math.max(0, ...(r.arpeggio?.steps ?? [0])) / 12 +
    (r.vibrato?.depth ?? 0) / 12;
  return r.freq * Math.pow(2, octaves);
}

export function checkRecipe(id: string, r: unknown): string[] {
  const errs: string[] = [];
  const at = `sound "${id}"`;
  if (!SOUND_ID.test(id)) errs.push(`${at}: the ID must look like "ui_click"`);
  if (!isObj(r)) return [`${at}: must be an object`];
  const known = new Set([
    'wave',
    'seed',
    'freq',
    'slide',
    'minFreq',
    'duty',
    'attackMs',
    'holdMs',
    'decayMs',
    'vibrato',
    'arpeggio',
    'lowpass',
    'highpass',
    'gain',
  ]);
  for (const k of Object.keys(r))
    if (!known.has(k)) errs.push(`${at}: unknown field "${k}"`);
  if (!(WAVES as readonly unknown[]).includes(r.wave))
    errs.push(`${at}: wave must be one of ${WAVES.join(', ')}`);
  num(errs, `${at}: seed`, r.seed, 0, 0xffffffff, true);
  num(errs, `${at}: freq`, r.freq, 40, 4000);
  if (r.slide !== undefined) num(errs, `${at}: slide`, r.slide, -8, 8);
  if (r.minFreq !== undefined) num(errs, `${at}: minFreq`, r.minFreq, 20, 4000);
  if (r.duty !== undefined) num(errs, `${at}: duty`, r.duty, 0.05, 0.95);
  num(errs, `${at}: attackMs`, r.attackMs, 1, MAX_LENGTH_MS, true);
  num(errs, `${at}: holdMs`, r.holdMs, 0, MAX_LENGTH_MS, true);
  num(errs, `${at}: decayMs`, r.decayMs, 1, MAX_LENGTH_MS, true);
  num(errs, `${at}: gain`, r.gain, 0.01, 1);
  if (r.lowpass !== undefined)
    num(errs, `${at}: lowpass`, r.lowpass, 50, MAX_HZ);
  if (r.highpass !== undefined)
    num(errs, `${at}: highpass`, r.highpass, 20, MAX_HZ);
  if (r.vibrato !== undefined) {
    if (!isObj(r.vibrato)) errs.push(`${at}: vibrato must be an object`);
    else {
      num(errs, `${at}: vibrato.depth`, r.vibrato.depth, 0, 12);
      num(errs, `${at}: vibrato.rateHz`, r.vibrato.rateHz, 0.5, 40);
    }
  }
  if (r.arpeggio !== undefined) {
    const a = r.arpeggio;
    if (!isObj(a) || !Array.isArray(a.steps) || a.steps.length === 0)
      errs.push(`${at}: arpeggio needs a non-empty "steps" array`);
    else {
      for (const s of a.steps as unknown[])
        num(errs, `${at}: arpeggio step`, s, -36, 36, true);
      num(errs, `${at}: arpeggio.stepMs`, a.stepMs, 10, MAX_LENGTH_MS, true);
    }
  }
  if (errs.length > 0) return errs;
  const rec = r as unknown as Recipe;
  const total = rec.attackMs + rec.holdMs + rec.decayMs;
  if (total > MAX_LENGTH_MS)
    errs.push(
      `${at}: the envelope is ${String(total)} ms, over ${String(MAX_LENGTH_MS)}`,
    );
  if (peakFreq(rec) > MAX_HZ)
    errs.push(`${at}: the pitch can pass ${String(MAX_HZ)} Hz (AU-12)`);
  return errs;
}

export type LoadResult =
  { ok: true; config: SoundsConfig } | { ok: false; errors: string[] };

export function loadSounds(data: unknown): LoadResult {
  if (!isObj(data)) return { ok: false, errors: ['must be an object'] };
  const errors: string[] = [];
  if (data.version !== 1) errors.push('version must be 1');
  if (data.sampleRate !== SAMPLE_RATE)
    errors.push(`sampleRate must be ${String(SAMPLE_RATE)}`);
  if (!isObj(data.sounds) || Object.keys(data.sounds).length === 0)
    return {
      ok: false,
      errors: [...errors, 'sounds must be a non-empty object'],
    };
  for (const [id, r] of Object.entries(data.sounds))
    errors.push(...checkRecipe(id, r));
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, config: data as unknown as SoundsConfig };
}
