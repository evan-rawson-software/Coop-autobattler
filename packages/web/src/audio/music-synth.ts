/**
 * The music synth (#451, docs/specs/08-audio.md, AU-45): plays a track of
 * `content/music.json` on the audio clock. Notes are scheduled a couple of
 * seconds ahead, bar by bar, with the Web Audio clock (never a JS timer) as
 * the time of every note, so a loop repeats with no gap and its tail rings
 * into the next round. Every note is built from one oscillator (and an
 * optional partial) through an envelope, like the effects. Nothing here
 * throws into the game: a failing note is skipped.
 */
import {
  barNotes,
  barSeconds,
  midiToHz,
  trackEndSeconds,
  trackSeconds,
  type Instrument,
  type MusicConfig,
  type Track,
  type TrackNote,
} from '@game/audio';

/** The part of `AudioContext` the synth uses (real or fake). */
export interface MusicContext {
  readonly currentTime: number;
  createGain(): GainNode;
  createOscillator(): OscillatorNode;
  createBiquadFilter(): BiquadFilterNode;
}

export interface MusicTimers {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** A playing track the engine can fade out or cut. */
export interface MusicVoice {
  fadeOut(ms: number): void;
  stop(): void;
}

/** Seconds of notes scheduled ahead of the audio clock. */
export const LOOKAHEAD_S = 2.5;
const TICK_MS = 200;
/** Where a track starts, ahead of now, so the first notes are not late. */
const START_DELAY_S = 0.05;
const CURVE_POINTS = 32;
/** Headroom: a track's notes sum, so each voice sits well under 1. */
const HEADROOM = 0.5;

/**
 * An equal-power fade of `peak`: sine up or cosine down, so two tracks that
 * cross over keep the same loudness.
 */
export function fadeCurve(peak: number, up: boolean): Float32Array {
  const c = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = (i / (CURVE_POINTS - 1)) * (Math.PI / 2);
    c[i] = peak * (up ? Math.sin(x) : Math.cos(x));
  }
  return c;
}

export class TrackPlayer implements MusicVoice {
  private readonly out: GainNode;
  private readonly track: Track;
  private readonly startAt: number;
  private readonly endAt: number;
  private readonly cache = new Map<number, TrackNote[]>();
  private nextBar = 0;
  private timer: unknown = null;
  private stopped = false;
  private stopTimer: unknown = null;
  private ended = false;

  constructor(
    private readonly ctx: MusicContext,
    destination: AudioNode,
    private readonly config: MusicConfig,
    track: Track,
    level: number,
    fadeInMs: number,
    private readonly timers: MusicTimers,
    private readonly onEnded?: () => void,
  ) {
    this.track = track;
    this.out = ctx.createGain();
    this.out.connect(destination);
    this.startAt = ctx.currentTime + START_DELAY_S;
    this.endAt = this.startAt + trackEndSeconds(track, config.instruments);
    if (fadeInMs > 0) {
      this.out.gain.setValueAtTime(0, this.startAt);
      this.out.gain.setValueCurveAtTime(
        fadeCurve(level, true),
        this.startAt,
        fadeInMs / 1000,
      );
    } else {
      this.out.gain.setValueAtTime(level, this.startAt);
    }
    this.pump();
  }

  private pump(): void {
    if (this.stopped) return;
    try {
      this.schedule();
      if (!this.track.loop && this.ctx.currentTime >= this.endAt) {
        this.finish();
        return;
      }
    } catch {
      // A broken context never breaks the game.
    }
    this.timer = this.timers.setTimer(() => {
      this.timer = null;
      this.pump();
    }, TICK_MS);
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    try {
      this.onEnded?.();
    } catch {
      // Ignored: see pump.
    }
  }

  private notesOf(bar: number): TrackNote[] {
    let n = this.cache.get(bar);
    if (n === undefined) {
      n = barNotes(this.track, bar);
      this.cache.set(bar, n);
    }
    return n;
  }

  /** Schedules every bar that starts within the look-ahead. */
  private schedule(): void {
    const t = this.track;
    const barLen = barSeconds(t);
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;
    for (;;) {
      if (!t.loop && this.nextBar >= t.bars) return;
      const start = this.startAt + this.nextBar * barLen;
      if (start > horizon) return;
      const round = Math.floor(this.nextBar / t.bars);
      const offset = round * trackSeconds(t);
      for (const note of this.notesOf(this.nextBar % t.bars)) {
        const voice = t.voices[note.voice];
        const ins = voice && this.config.instruments[voice.instrument];
        if (voice === undefined || ins === undefined) continue;
        this.note(
          ins,
          voice.gain,
          note.midi,
          this.startAt + offset + note.timeSec,
        );
      }
      this.nextBar += 1;
    }
  }

  private note(
    ins: Instrument,
    voiceGain: number,
    midi: number,
    at: number,
  ): void {
    const ctx = this.ctx;
    const env = ctx.createGain();
    const peak = ins.gain * voiceGain * HEADROOM;
    const a = ins.attackMs / 1000;
    const end = at + a + ins.decayMs / 1000;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(peak, at + a);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    let sink: AudioNode = env;
    if (ins.lowpass !== undefined) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = ins.lowpass;
      f.connect(env);
      sink = f;
    }
    env.connect(this.out);
    const hz = midiToHz(midi);
    const osc = (wave: OscillatorType, freq: number, gain: number): void => {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = freq;
      if (gain === 1) o.connect(sink);
      else {
        const g = ctx.createGain();
        g.gain.value = gain;
        o.connect(g);
        g.connect(sink);
      }
      o.start(at);
      o.stop(end + 0.05);
      o.onended = () => {
        o.disconnect();
      };
    };
    osc(ins.wave === 'saw' ? 'sawtooth' : ins.wave, hz, 1);
    if (ins.partial !== undefined)
      osc('sine', hz * ins.partial.ratio, ins.partial.gain);
  }

  fadeOut(ms: number): void {
    if (this.stopped) return;
    const g = this.out.gain;
    const t = this.ctx.currentTime;
    try {
      const now = g.value;
      g.cancelScheduledValues(t);
      g.setValueAtTime(now, t);
      if (ms > 0) g.setValueCurveAtTime(fadeCurve(now, false), t, ms / 1000);
      else g.setValueAtTime(0, t);
    } catch {
      // Ignored: the stop below ends it anyway.
    }
    if (this.stopTimer !== null) this.timers.clearTimer(this.stopTimer);
    this.stopTimer = this.timers.setTimer(() => {
      this.stopTimer = null;
      this.stop();
    }, ms + 50);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) this.timers.clearTimer(this.timer);
    if (this.stopTimer !== null) this.timers.clearTimer(this.stopTimer);
    this.timer = null;
    this.stopTimer = null;
    try {
      this.out.disconnect();
    } catch {
      // Already gone.
    }
  }
}
