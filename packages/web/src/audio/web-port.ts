/**
 * The Web Audio side of the engine's port. The graph (AU-20):
 * `effects` and `duck -> music` both feed `master -> destination`. The duck
 * gain carries the ducking and the tab-hidden fade; the music synth (#451)
 * connects to `musicInput`. Every constructor and fetch is injected, so tests
 * run against a fake context.
 */
import type { AudioPort, Voice } from './engine.js';
import type { VolumeGroup } from './settings.js';

/** The part of `AudioContext` the port uses (real or fake). */
export interface ContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: AudioNode;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

export interface WebPortDeps {
  /** The context constructor; undefined where Web Audio does not exist. */
  readonly ctor: (new () => ContextLike) | undefined;
  /** The bytes of a sound's file, or null when there is no such file. */
  readonly fetchSound: (soundId: string) => Promise<ArrayBuffer | null>;
  readonly clock: () => number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

/** Smoothing for gain changes, in seconds, so a slider does not click. */
const SMOOTH_S = 0.02;

export class WebAudioPort implements AudioPort {
  private ctx: ContextLike | null = null;
  private failed = false;
  private master: GainNode | null = null;
  private groups: Record<'music' | 'effects', GainNode | null> = {
    music: null,
    effects: null,
  };
  private duck: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Gains set before the context exists. */
  private readonly pending = new Map<VolumeGroup, number>();

  constructor(private readonly deps: WebPortDeps) {}

  /** True where the browser has Web Audio at all. */
  get available(): boolean {
    return this.deps.ctor !== undefined && !this.failed;
  }

  /** Where the music synth connects (the music group), once unlocked. */
  get musicInput(): AudioNode | null {
    return this.duck;
  }

  get context(): ContextLike | null {
    return this.ctx;
  }

  nowMs(): number {
    return this.deps.clock();
  }

  after(ms: number, fn: () => void): () => void {
    const h = this.deps.setTimer(fn, ms);
    return () => {
      this.deps.clearTimer(h);
    };
  }

  private ensure(): ContextLike | null {
    if (this.ctx !== null) return this.ctx;
    const Ctor = this.deps.ctor;
    if (Ctor === undefined || this.failed) return null;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      const music = ctx.createGain();
      const effects = ctx.createGain();
      const duck = ctx.createGain();
      duck.connect(music);
      music.connect(master);
      effects.connect(master);
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.groups = { music, effects };
      this.duck = duck;
      for (const [g, v] of this.pending) this.setGroupGain(g, v);
      return ctx;
    } catch {
      this.failed = true;
      return null;
    }
  }

  async resume(): Promise<boolean> {
    const ctx = this.ensure();
    if (ctx === null) return false;
    try {
      await ctx.resume();
    } catch {
      return false;
    }
    return ctx.state === 'running';
  }

  async suspend(): Promise<void> {
    await this.ctx?.suspend();
  }

  async load(soundId: string): Promise<number | null> {
    const ctx = this.ctx;
    if (ctx === null) return null;
    if (this.buffers.has(soundId)) return this.durationMs(soundId) ?? null;
    try {
      const bytes = await this.deps.fetchSound(soundId);
      if (bytes === null) return null;
      const buffer = await ctx.decodeAudioData(bytes);
      this.buffers.set(soundId, buffer);
      return buffer.duration * 1000;
    } catch {
      return null;
    }
  }

  durationMs(soundId: string): number | undefined {
    const b = this.buffers.get(soundId);
    return b === undefined ? undefined : b.duration * 1000;
  }

  play(soundId: string, gain: number, rate: number): Voice | null {
    const ctx = this.ctx;
    const effects = this.groups.effects;
    const buffer = this.buffers.get(soundId);
    if (ctx === null || effects === null || buffer === undefined) return null;
    const source = ctx.createBufferSource();
    const level = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    level.gain.value = gain;
    source.connect(level);
    level.connect(effects);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
    };
    source.start();
    return {
      stop: () => {
        try {
          source.stop();
        } catch {
          // Not started or already stopped.
        }
      },
    };
  }

  setGroupGain(group: VolumeGroup, gain: number): void {
    const ctx = this.ctx;
    const node = group === 'master' ? this.master : this.groups[group];
    if (ctx === null || node === null) {
      this.pending.set(group, gain);
      return;
    }
    node.gain.setTargetAtTime(gain, ctx.currentTime, SMOOTH_S);
  }

  rampMusic(factor: number, ms: number): void {
    const ctx = this.ctx;
    const duck = this.duck;
    if (ctx === null || duck === null) return;
    const t = ctx.currentTime;
    const param = duck.gain;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(factor, t + Math.max(ms, 1) / 1000);
  }
}
