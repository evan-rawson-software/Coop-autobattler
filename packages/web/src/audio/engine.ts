/**
 * The audio engine (AU-20 to AU-35): pure logic behind an injected port, so
 * tests run with a fake clock and a fake context and never listen. Every
 * entry point is safe to call anywhere: with no port, before the first
 * gesture, while the tab is hidden or when the context fails, it does
 * nothing and never throws.
 */
import { cueSounds, type AudioConfig, type Cue } from '@game/audio';
import {
  volumeGain,
  type AudioSettings,
  type VolumeGroup,
} from './settings.js';
import { Thinner, type ThinCandidate } from './thin.js';

/** A sounding effect; `stop` cuts it short. */
export interface Voice {
  stop(): void;
}

/** What the engine needs from Web Audio. */
export interface AudioPort {
  /** A millisecond clock. */
  nowMs(): number;
  /** Runs `fn` after `ms`; the result cancels it. */
  after(ms: number, fn: () => void): () => void;
  /** Creates the context on the first call and resumes it. True if running. */
  resume(): Promise<boolean>;
  suspend(): Promise<void>;
  /** Decodes a sound; its length in ms, or null when it cannot be had. */
  load(soundId: string): Promise<number | null>;
  /** The length of a decoded sound in ms, undefined until it is loaded. */
  durationMs(soundId: string): number | undefined;
  /** Starts a decoded sound at `gain` and playback `rate`. */
  play(soundId: string, gain: number, rate: number): Voice | null;
  /** Sets the gain of a node (a gain is already squared, AU-21). */
  setGroupGain(group: VolumeGroup, gain: number): void;
  /** Ramps the music duck/hide factor over `ms`. */
  rampMusic(factor: number, ms: number): void;
}

export interface PlayOptions {
  /** A factor on the cue's volume, default 1. */
  gain?: number;
  /** Playback rate, default 1 (0.5 to 2). */
  pitch?: number;
  /** A factor on the cue's `minGapMs`, default 1 (AU-37: slower at speed). */
  gapFactor?: number;
}

/** Time the music takes to fade out when the tab is hidden. */
export const HIDE_FADE_MS = 250;
const SUSPEND_DELAY_MS = 300;
const SHOW_FADE_MS = 300;

interface Sounding {
  readonly cue: string;
  readonly priority: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly voice: Voice;
}

interface ActiveDuck {
  readonly gain: number;
  until: number;
}

export class AudioEngine {
  private unlocked = false;
  private unlocking: Promise<boolean> | null = null;
  private dead = false;
  private hidden = false;
  private settings: AudioSettings;
  private voices: Sounding[] = [];
  private readonly lastStart = new Map<string, number>();
  private readonly turn = new Map<string, number>();
  private readonly failed = new Set<string>();
  private readonly loading = new Set<string>();
  private ducks: ActiveDuck[] = [];
  private duckFactor = 1;
  private cancelSuspend: (() => void) | null = null;
  private cancelDuck: (() => void) | null = null;
  private readonly thinner: Thinner;

  constructor(
    private readonly config: AudioConfig,
    private readonly port: AudioPort | null,
    settings: AudioSettings,
  ) {
    this.settings = settings;
    this.thinner = new Thinner(config.mix.thinWindowMs);
  }

  /** True once a gesture has started the context. */
  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** The number of effects sounding now. */
  get voiceCount(): number {
    this.prune();
    return this.voices.length;
  }

  /**
   * Creates and resumes the context. Call it from a user gesture. Safe to
   * call again; resolves true once audio is running.
   */
  unlock(): Promise<boolean> {
    if (this.port === null || this.dead) return Promise.resolve(false);
    if (this.unlocked) return Promise.resolve(true);
    if (this.unlocking !== null) return this.unlocking;
    const port = this.port;
    let started: Promise<boolean>;
    try {
      started = port.resume();
    } catch {
      this.dead = true;
      return Promise.resolve(false);
    }
    this.unlocking = started.then(
      (ok) => {
        this.unlocking = null;
        if (!ok) return false;
        this.unlocked = true;
        this.applyGroups();
        this.preload();
        if (this.hidden) this.hide();
        return true;
      },
      () => {
        this.unlocking = null;
        return false;
      },
    );
    return this.unlocking;
  }

  /** The settings changed: the group gains follow at once. */
  setSettings(settings: AudioSettings): void {
    this.settings = settings;
    this.applyGroups();
  }

  private applyGroups(): void {
    if (this.port === null || !this.unlocked) return;
    const s = this.settings;
    try {
      this.port.setGroupGain('master', s.muted ? 0 : volumeGain(s.master));
      this.port.setGroupGain('music', volumeGain(s.music));
      this.port.setGroupGain('effects', volumeGain(s.effects));
    } catch {
      // A broken context never breaks the game.
    }
    if (s.muted) this.stopAll();
  }

  /** The tab was hidden or shown (AU-32). */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (!this.unlocked || this.port === null) return;
    if (hidden) this.hide();
    else this.show();
  }

  private hide(): void {
    const port = this.port;
    if (port === null) return;
    this.stopAll();
    this.cancelSuspend?.();
    try {
      port.rampMusic(0, HIDE_FADE_MS);
      this.cancelSuspend = port.after(SUSPEND_DELAY_MS, () => {
        this.cancelSuspend = null;
        if (this.hidden) void port.suspend().catch(() => undefined);
      });
    } catch {
      // Ignored: see applyGroups.
    }
  }

  private show(): void {
    const port = this.port;
    if (port === null) return;
    this.cancelSuspend?.();
    this.cancelSuspend = null;
    const back = (): void => {
      try {
        port.rampMusic(this.targetFactor(), SHOW_FADE_MS);
      } catch {
        // Ignored.
      }
    };
    try {
      void port.resume().then(back, () => undefined);
    } catch {
      // Ignored.
    }
  }

  /**
   * Plays a cue. Returns true when a sound started. Dropped, never queued,
   * when audio is not unlocked, the tab is hidden, sound is muted, the cue
   * is off, inside its gap or over a voice limit (AU-27, AU-28).
   */
  playCue(id: string, options: PlayOptions = {}): boolean {
    try {
      return this.play(id, options);
    } catch {
      return false;
    }
  }

  private play(id: string, options: PlayOptions): boolean {
    const port = this.port;
    if (port === null || !this.unlocked || this.hidden) return false;
    const cue = this.config.cues[id];
    if (cue === undefined || cue.group !== 'effects') return false;
    if (cue.enabled === false) return false;
    if (this.settings.muted) return false;
    const level = (cue.volume / 100) * (options.gain ?? 1);
    if (
      level <= 0 ||
      volumeGain(this.settings.master) === 0 ||
      volumeGain(this.settings.effects) === 0
    )
      return false;
    const now = port.nowMs();
    const last = this.lastStart.get(id);
    if (
      last !== undefined &&
      now - last < cue.minGapMs * Math.max(1, options.gapFactor ?? 1)
    )
      return false;
    this.prune(now);
    if (this.voices.filter((v) => v.cue === id).length >= cue.maxVoices)
      return false;

    const sounds = cueSounds(id, cue);
    const n = this.turn.get(id) ?? 0;
    const sound = sounds[n % sounds.length];
    if (sound === undefined || this.failed.has(sound)) return false;
    const length = port.durationMs(sound);
    if (length === undefined) {
      // Still decoding (or not preloaded): dropped, a late sound is worse.
      this.fetchSound(sound);
      return false;
    }
    const rate = Math.min(2, Math.max(0.5, options.pitch ?? 1));
    if (!this.makeRoom(cue, now)) return false;

    const voice = port.play(sound, level, rate);
    if (voice === null) return false;
    this.turn.set(id, n + 1);
    this.lastStart.set(id, now);
    this.voices.push({
      cue: id,
      priority: cue.priority,
      startMs: now,
      endMs: now + length / rate,
      voice,
    });
    if (cue.duck !== undefined) this.addDuck(cue.duck.gain, cue.duck.holdMs);
    return true;
  }

  /** Frees a voice for `cue` if the global limit is reached (AU-27). */
  private makeRoom(cue: Cue, now: number): boolean {
    if (this.voices.length < this.config.mix.effectVoices) return true;
    let lowest = 4;
    for (const v of this.voices) lowest = Math.min(lowest, v.priority);
    if (cue.priority <= lowest) return false;
    let victim: Sounding | undefined;
    for (const v of this.voices) {
      if (v.priority !== lowest) continue;
      if (
        victim === undefined ||
        v.endMs - now < victim.endMs - now ||
        (v.endMs === victim.endMs && v.startMs < victim.startMs)
      )
        victim = v;
    }
    if (victim === undefined) return false;
    this.stopVoice(victim);
    return true;
  }

  private stopVoice(v: Sounding): void {
    this.voices = this.voices.filter((x) => x !== v);
    try {
      v.voice.stop();
    } catch {
      // Already ended.
    }
  }

  private stopAll(): void {
    for (const v of this.voices) {
      try {
        v.voice.stop();
      } catch {
        // Already ended.
      }
    }
    this.voices = [];
  }

  private prune(now = this.port?.nowMs() ?? 0): void {
    this.voices = this.voices.filter((v) => v.endMs > now);
  }

  /**
   * Decodes every effect sound in the background right after unlock (AU-31),
   * so the first play of each is heard. A request that arrives while its
   * sound is still decoding is dropped, as a late sound is worse than none.
   */
  private preload(): void {
    for (const [id, cue] of Object.entries(this.config.cues)) {
      if (cue.group !== 'effects' || cue.enabled === false) continue;
      for (const sound of cueSounds(id, cue)) this.fetchSound(sound);
    }
  }

  private fetchSound(sound: string): void {
    const port = this.port;
    if (port === null || this.loading.has(sound)) return;
    if (this.failed.has(sound) || port.durationMs(sound) !== undefined) return;
    this.loading.add(sound);
    void port
      .load(sound)
      .then((len) => {
        if (len === null) this.failed.add(sound);
      })
      .catch(() => {
        this.failed.add(sound);
      })
      .finally(() => {
        this.loading.delete(sound);
      });
  }

  /**
   * A batch of cues from one frame, thinned (AU-34): for each class not
   * inside its window the best one plays. Cues that are not thinned play
   * directly. `windowFactor` is the speed factor of AU-37. Returns the cue
   * IDs that started.
   */
  playThinned(
    candidates: readonly {
      cue: string;
      damage?: number;
      unit?: number;
    }[],
    windowFactor = 1,
  ): string[] {
    const port = this.port;
    if (port === null) return [];
    const thin: ThinCandidate[] = [];
    const started: string[] = [];
    for (const c of candidates) {
      const cue = this.config.cues[c.cue];
      if (cue === undefined) continue;
      if (cue.thin === undefined) {
        if (this.playCue(c.cue, { gapFactor: windowFactor }))
          started.push(c.cue);
        continue;
      }
      thin.push({
        cue: c.cue,
        thin: cue.thin,
        priority: cue.priority,
        ...(c.damage === undefined ? {} : { damage: c.damage }),
        ...(c.unit === undefined ? {} : { unit: c.unit }),
      });
    }
    if (!this.unlocked || this.hidden || this.settings.muted) return started;
    for (const t of this.thinner.pick(thin, port.nowMs(), windowFactor))
      if (this.playCue(t.cue, { gapFactor: windowFactor })) started.push(t.cue);
    return started;
  }

  // Ducking (AU-35): the deepest active duck wins; they do not multiply.

  private addDuck(gain: number, holdMs: number): void {
    const port = this.port;
    if (port === null) return;
    this.ducks.push({ gain, until: port.nowMs() + holdMs });
    this.refreshDuck();
  }

  private targetFactor(): number {
    if (this.hidden) return 0;
    return this.duckFactor;
  }

  private refreshDuck(): void {
    const port = this.port;
    if (port === null) return;
    const now = port.nowMs();
    this.ducks = this.ducks.filter((d) => d.until > now);
    const next = this.ducks.reduce((m, d) => Math.min(m, d.gain), 1);
    const mix = this.config.mix;
    if (next !== this.duckFactor) {
      const falling = next < this.duckFactor;
      this.duckFactor = next;
      if (!this.hidden)
        port.rampMusic(next, falling ? mix.duckAttackMs : mix.duckReleaseMs);
    }
    this.cancelDuck?.();
    this.cancelDuck = null;
    if (this.ducks.length > 0) {
      const soonest = Math.min(...this.ducks.map((d) => d.until));
      this.cancelDuck = port.after(Math.max(0, soonest - now), () => {
        this.cancelDuck = null;
        try {
          this.refreshDuck();
        } catch {
          // Ignored: a broken context never breaks the game.
        }
      });
    }
  }
}
