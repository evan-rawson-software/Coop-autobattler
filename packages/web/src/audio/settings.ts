/**
 * The player's sound settings (AU-21, AU-22): master, music and effects
 * volume (0 to 100) and a mute switch, kept per browser in `localStorage`.
 * Presentation only: not part of a save, a run or a replay. Without usable
 * storage the settings live in memory for the page's lifetime.
 */
import { createStore, type Store } from '../app-state.js';
import { DEFAULT_PREFIX } from '../run/local-storage-store.js';

export const AUDIO_SETTINGS_KEY = `${DEFAULT_PREFIX}audio`;

export interface AudioSettings {
  readonly master: number;
  readonly music: number;
  readonly effects: number;
  readonly muted: boolean;
}

export type VolumeGroup = 'master' | 'music' | 'effects';
export const VOLUME_GROUPS: readonly VolumeGroup[] = [
  'master',
  'music',
  'effects',
];

/** The defaults of AU-21; `content/audio.json` repeats them for Godot. */
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 80,
  music: 50,
  effects: 80,
  muted: false,
};

function clampVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(0, Math.round(v)));
}

/** A stored value as settings; anything missing or invalid is the default. */
export function parseAudioSettings(
  raw: string | null,
  defaults: AudioSettings = DEFAULT_AUDIO_SETTINGS,
): AudioSettings {
  if (raw === null) return defaults;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      return defaults;
    const o = v as Record<string, unknown>;
    if (o['v'] !== 1) return defaults;
    return {
      master: clampVolume(o['master'], defaults.master),
      music: clampVolume(o['music'], defaults.music),
      effects: clampVolume(o['effects'], defaults.effects),
      muted: o['muted'] === true,
    };
  } catch {
    return defaults;
  }
}

export function serializeAudioSettings(s: AudioSettings): string {
  return JSON.stringify({
    v: 1,
    master: s.master,
    music: s.music,
    effects: s.effects,
    muted: s.muted,
  });
}

function read(): AudioSettings {
  try {
    return parseAudioSettings(window.localStorage.getItem(AUDIO_SETTINGS_KEY));
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

function write(s: AudioSettings): void {
  try {
    window.localStorage.setItem(AUDIO_SETTINGS_KEY, serializeAudioSettings(s));
  } catch {
    // Storage is unavailable: the settings last for this page only.
  }
}

/** The settings. Reads storage once, at load. */
export const audioSettingsStore: Store<AudioSettings> = createStore(read());

export function setVolume(group: VolumeGroup, value: number): void {
  const now = audioSettingsStore.get();
  const v = clampVolume(value, now[group]);
  if (v === now[group]) return;
  const next = { ...now, [group]: v };
  audioSettingsStore.set(next);
  write(next);
}

export function setMuted(muted: boolean): void {
  const now = audioSettingsStore.get();
  if (now.muted === muted) return;
  const next = { ...now, muted };
  audioSettingsStore.set(next);
  write(next);
}

/** The gain of a volume setting: squared, so the slider feels even (AU-21). */
export function volumeGain(volume: number): number {
  const x = Math.min(100, Math.max(0, volume)) / 100;
  return x * x;
}
