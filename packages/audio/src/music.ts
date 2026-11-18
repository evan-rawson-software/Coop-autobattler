/**
 * Music tracks (`content/music.json`, AU-45) and their checks. Pure: no Node
 * API and no Web Audio, so `@game/tools` validates the content with
 * `loadMusic`, the web synth reads the notes from `trackNotes`, and the Godot
 * port can walk the same list. A track is a tracker-style pattern: bars of 16
 * steps, each step a scale degree or a rest.
 */

export const INSTRUMENT_WAVES = ['sine', 'triangle', 'square', 'saw'] as const;
export type InstrumentWave = (typeof INSTRUMENT_WAVES)[number];

export const STEPS_PER_BAR = 16;
export const BEATS_PER_BAR = 4;
/** The highest note (MIDI) a track may reach, to hold it to AU-12. */
export const MAX_MIDI = 91;
export const MIN_LOOP_SECONDS = 45;
export const MAX_LOOP_SECONDS = 90;
export const MAX_STINGER_SECONDS = 4;
export const MIN_STINGER_SECONDS = 2;
export const TRACK_ID = /^music_[a-z0-9_]+$/;
export const INSTRUMENT_ID = /^[a-z]+$/;

/** A note's voice: one oscillator (plus an optional partial) with an envelope. */
export interface Instrument {
  wave: InstrumentWave;
  attackMs: number;
  /** Time from the end of the attack until the note has died away. */
  decayMs: number;
  /** One-pole style low-pass cut-off in Hz, optional. */
  lowpass?: number;
  /** A second sine at `ratio` times the pitch (a bell's upper partial). */
  partial?: { ratio: number; gain: number };
  /** Peak level, 0 to 1. */
  gain: number;
}

export interface TrackVoice {
  instrument: string;
  /** Level of this voice, 0 to 1. */
  gain: number;
  /** Semitones added to every note; a multiple of 12. Default 0. */
  shift?: number;
  /** `bars` strings of 16 steps: a degree (`0`-`9`, `a`-`f`) or `.`. */
  pattern: string[];
}

export interface Track {
  bpm: number;
  beatsPerBar: number;
  bars: number;
  loop: boolean;
  /** MIDI note of degree 0. */
  root: number;
  /** Semitone offsets of one octave of the scale. */
  scale: number[];
  voices: TrackVoice[];
}

export interface MusicConfig {
  version: number;
  instruments: Record<string, Instrument>;
  tracks: Record<string, Track>;
}

/** One note of a track, in seconds from the start of the track. */
export interface TrackNote {
  /** Index into `track.voices`. */
  voice: number;
  timeSec: number;
  midi: number;
}

/** Seconds in one step (a sixteenth). */
export function stepSeconds(t: Pick<Track, 'bpm'>): number {
  return 60 / t.bpm / 4;
}

export function barSeconds(t: Pick<Track, 'bpm' | 'beatsPerBar'>): number {
  return (60 / t.bpm) * t.beatsPerBar;
}

/** The length of the pattern: a loop repeats after this many seconds. */
export function trackSeconds(t: Track): number {
  return barSeconds(t) * t.bars;
}

/** The degree of a pattern character, or undefined for a rest or junk. */
export function degreeOf(ch: string): number | undefined {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'a' && ch <= 'f') return ch.charCodeAt(0) - 97 + 10;
  return undefined;
}

/**
 * The MIDI note of a degree: the scale repeats every octave, so degree
 * `d` is `scale[d mod n]` plus an octave for each `n` degrees.
 */
export function midiOf(
  t: Pick<Track, 'root' | 'scale'>,
  degree: number,
  shift = 0,
): number {
  const n = t.scale.length;
  return (
    t.root + (t.scale[degree % n] ?? 0) + 12 * Math.floor(degree / n) + shift
  );
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Every note of one bar (0-based), by time. Pure and sorted. */
export function barNotes(t: Track, bar: number): TrackNote[] {
  const out: TrackNote[] = [];
  const step = stepSeconds(t);
  const start = bar * barSeconds(t);
  t.voices.forEach((v, voice) => {
    const row = v.pattern[bar] ?? '';
    for (let i = 0; i < STEPS_PER_BAR; i++) {
      const d = degreeOf(row[i] ?? '.');
      if (d === undefined) continue;
      out.push({
        voice,
        timeSec: start + i * step,
        midi: midiOf(t, d, v.shift ?? 0),
      });
    }
  });
  return out.sort((a, b) => a.timeSec - b.timeSec || a.voice - b.voice);
}

/** Every note of a track, by time. */
export function trackNotes(t: Track): TrackNote[] {
  const out: TrackNote[] = [];
  for (let bar = 0; bar < t.bars; bar++) out.push(...barNotes(t, bar));
  return out;
}

/**
 * When the last note has died away, in seconds from the start. A stinger
 * ends then; a loop's tail rings into its next round.
 */
export function trackEndSeconds(
  t: Track,
  instruments: Record<string, Instrument>,
): number {
  let end = trackSeconds(t);
  const notes = trackNotes(t);
  for (const n of notes) {
    const ins = instruments[t.voices[n.voice]?.instrument ?? ''];
    if (ins === undefined) continue;
    end = Math.max(end, n.timeSec + (ins.attackMs + ins.decayMs) / 1000);
  }
  return t.loop ? trackSeconds(t) : end;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function inRange(v: unknown, min: number, max: number, int = false): boolean {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= min &&
    v <= max &&
    (!int || Number.isInteger(v))
  );
}

function onlyKeys(
  errs: string[],
  at: string,
  o: Record<string, unknown>,
  known: readonly string[],
): void {
  for (const k of Object.keys(o))
    if (!known.includes(k)) errs.push(`${at}: unknown field "${k}"`);
}

function checkInstrument(errs: string[], id: string, v: unknown): void {
  const at = `instrument "${id}"`;
  if (!INSTRUMENT_ID.test(id)) errs.push(`${at}: the ID must be lower case`);
  if (!isObj(v)) {
    errs.push(`${at}: must be an object`);
    return;
  }
  onlyKeys(errs, at, v, [
    'wave',
    'attackMs',
    'decayMs',
    'lowpass',
    'partial',
    'gain',
  ]);
  if (!(INSTRUMENT_WAVES as readonly unknown[]).includes(v.wave))
    errs.push(`${at}: wave must be one of ${INSTRUMENT_WAVES.join(', ')}`);
  if (!inRange(v.attackMs, 1, 3000, true))
    errs.push(`${at}: attackMs must be an integer from 1 to 3000`);
  if (!inRange(v.decayMs, 1, 6000, true))
    errs.push(`${at}: decayMs must be an integer from 1 to 6000`);
  if (!inRange(v.gain, 0.01, 1)) errs.push(`${at}: gain must be 0.01 to 1`);
  if (v.lowpass !== undefined && !inRange(v.lowpass, 50, 6000))
    errs.push(`${at}: lowpass must be 50 to 6000`);
  if (v.partial !== undefined) {
    const p = v.partial;
    if (!isObj(p) || !inRange(p.ratio, 1, 4) || !inRange(p.gain, 0.01, 1))
      errs.push(`${at}: partial needs ratio 1 to 4 and gain 0.01 to 1`);
  }
}

function checkTrack(
  errs: string[],
  id: string,
  v: unknown,
  instruments: Record<string, unknown>,
): void {
  const at = `track "${id}"`;
  if (!TRACK_ID.test(id)) errs.push(`${at}: the ID must look like "music_x"`);
  if (!isObj(v)) {
    errs.push(`${at}: must be an object`);
    return;
  }
  onlyKeys(errs, at, v, [
    'bpm',
    'beatsPerBar',
    'bars',
    'loop',
    'root',
    'scale',
    'voices',
  ]);
  const before = errs.length;
  if (!inRange(v.bpm, 40, 220, true))
    errs.push(`${at}: bpm must be an integer from 40 to 220`);
  if (v.beatsPerBar !== BEATS_PER_BAR)
    errs.push(`${at}: beatsPerBar must be ${String(BEATS_PER_BAR)}`);
  if (!inRange(v.bars, 1, 64, true))
    errs.push(`${at}: bars must be an integer from 1 to 64`);
  if (typeof v.loop !== 'boolean')
    errs.push(`${at}: loop must be true or false`);
  if (!inRange(v.root, 24, 72, true))
    errs.push(`${at}: root must be a MIDI note from 24 to 72`);
  const scale = v.scale;
  if (
    !Array.isArray(scale) ||
    scale.length < 3 ||
    scale.length > 8 ||
    scale.some((s) => !inRange(s, 0, 11, true)) ||
    scale.some((s, i) => i > 0 && (s as number) <= (scale[i - 1] as number))
  )
    errs.push(`${at}: scale must be 3 to 8 rising semitone offsets (0 to 11)`);
  if (!Array.isArray(v.voices) || v.voices.length === 0) {
    errs.push(`${at}: voices must be a non-empty list`);
    return;
  }
  if (errs.length > before) return;
  const track = v as unknown as Track;
  track.voices.forEach((voice, i) => {
    const vat = `${at}, voice ${String(i)}`;
    if (!isObj(voice)) {
      errs.push(`${vat}: must be an object`);
      return;
    }
    onlyKeys(errs, vat, voice, ['instrument', 'gain', 'shift', 'pattern']);
    if (
      typeof voice.instrument !== 'string' ||
      !(voice.instrument in instruments)
    )
      errs.push(`${vat}: instrument "${voice.instrument}" is not defined`);
    if (!inRange(voice.gain, 0.01, 1))
      errs.push(`${vat}: gain must be 0.01 to 1`);
    const shift = (voice as { shift?: unknown }).shift;
    if (
      shift !== undefined &&
      (!inRange(shift, -36, 36, true) || (shift as number) % 12 !== 0)
    )
      errs.push(`${vat}: shift must be a multiple of 12`);
    const pattern = voice.pattern as unknown;
    if (!Array.isArray(pattern) || pattern.length !== track.bars) {
      errs.push(`${vat}: pattern must have ${String(track.bars)} bars`);
      return;
    }
    pattern.forEach((row: unknown, bar) => {
      if (typeof row !== 'string' || row.length !== STEPS_PER_BAR) {
        errs.push(
          `${vat}, bar ${String(bar + 1)}: must be ${String(STEPS_PER_BAR)} characters`,
        );
        return;
      }
      for (const ch of row) {
        if (ch === '.') continue;
        const d = degreeOf(ch);
        if (d === undefined)
          errs.push(`${vat}, bar ${String(bar + 1)}: bad character "${ch}"`);
        else if (midiOf(track, d, voice.shift ?? 0) > MAX_MIDI)
          errs.push(`${vat}, bar ${String(bar + 1)}: "${ch}" is too high`);
      }
    });
  });
}

export type LoadMusicResult =
  { ok: true; config: MusicConfig } | { ok: false; errors: string[] };

export function loadMusic(data: unknown): LoadMusicResult {
  if (!isObj(data)) return { ok: false, errors: ['must be an object'] };
  const errors: string[] = [];
  if (data.version !== 1) errors.push('version must be 1');
  onlyKeys(errors, 'music', data, [
    '$schema',
    'version',
    'instruments',
    'tracks',
  ]);
  if (!isObj(data.instruments) || Object.keys(data.instruments).length === 0)
    errors.push('instruments must be a non-empty object');
  else
    for (const [id, ins] of Object.entries(data.instruments))
      checkInstrument(errors, id, ins);
  if (!isObj(data.tracks) || Object.keys(data.tracks).length === 0)
    errors.push('tracks must be a non-empty object');
  else if (isObj(data.instruments))
    for (const [id, t] of Object.entries(data.tracks))
      checkTrack(errors, id, t, data.instruments);
  if (errors.length === 0) {
    const cfg = data as unknown as MusicConfig;
    for (const [id, t] of Object.entries(cfg.tracks)) {
      const len = trackEndSeconds(t, cfg.instruments);
      if (t.loop && (len < MIN_LOOP_SECONDS || len > MAX_LOOP_SECONDS))
        errors.push(
          `track "${id}": a loop must run ${String(MIN_LOOP_SECONDS)} to ${String(MAX_LOOP_SECONDS)} s, not ${len.toFixed(1)} s`,
        );
      if (!t.loop && (len < MIN_STINGER_SECONDS || len > MAX_STINGER_SECONDS))
        errors.push(
          `track "${id}": a stinger must run ${String(MIN_STINGER_SECONDS)} to ${String(MAX_STINGER_SECONDS)} s, not ${len.toFixed(1)} s`,
        );
    }
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, config: data as unknown as MusicConfig };
}
