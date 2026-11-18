/**
 * The audio module any screen can call. `playCue` is a no-op until the first
 * user gesture unlocks the context, and wherever Web Audio is missing; it
 * never throws. `installAudio` (called once at start-up) wires the unlock
 * gesture, the tab visibility and the settings to the engine.
 */
import { loadAudio, type AudioConfig } from '@game/audio';
import { rawAudio } from '@game/content';
import manifest from '../../../../assets/audio/manifest.json';
import { AudioEngine, type PlayOptions } from './engine.js';
import { audioSettingsStore } from './settings.js';
import { installUiSounds } from './ui-sounds.js';
import { WebAudioPort, type ContextLike } from './web-port.js';

const files = new Map<string, string>(
  manifest.files.map((f) => [f.id, f.file] as const),
);

function soundUrl(id: string): string | null {
  const file = files.get(id);
  return file === undefined
    ? null
    : new URL(`audio/${file}`, document.baseURI).href;
}

async function fetchSound(id: string): Promise<ArrayBuffer | null> {
  const url = soundUrl(id);
  if (url === null) return null;
  const res = await fetch(url);
  return res.ok ? res.arrayBuffer() : null;
}

let config: AudioConfig | null | undefined;

/** The cue table and mix (`content/audio.json`), or null when invalid. */
export function readConfig(): AudioConfig | null {
  if (config === undefined) {
    const r = loadAudio(rawAudio);
    config = r.ok ? r.config : null;
  }
  return config;
}

function createPort(): WebAudioPort {
  const w = window as unknown as {
    AudioContext?: new () => ContextLike;
    webkitAudioContext?: new () => ContextLike;
  };
  return new WebAudioPort({
    ctor: w.AudioContext ?? w.webkitAudioContext,
    fetchSound,
    clock: () => performance.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => {
      window.clearTimeout(h as number);
    },
  });
}

let engine: AudioEngine | null = null;

/** The engine, or null where the content or Web Audio is missing. */
export function getAudioEngine(): AudioEngine | null {
  return engine;
}

/** Play a cue by its ID (`shop.buy`). Never throws; silent when unavailable. */
export function playCue(id: string, options?: PlayOptions): boolean {
  return engine?.playCue(id, options) ?? false;
}

const UNLOCK_EVENTS = ['pointerdown', 'keydown'] as const;

/** Wires the engine to the page. Safe to call more than once. */
export function installAudio(): void {
  if (engine !== null || typeof window === 'undefined') return;
  const cfg = readConfig();
  if (cfg === null) return;
  const port = createPort();
  const e = new AudioEngine(
    cfg,
    port.available ? port : null,
    audioSettingsStore.get(),
  );
  engine = e;
  audioSettingsStore.subscribe((s) => {
    e.setSettings(s);
  });
  const onGesture = (): void => {
    void e.unlock().then((ok) => {
      if (!ok) return;
      for (const ev of UNLOCK_EVENTS)
        document.removeEventListener(ev, onGesture, true);
    });
  };
  for (const ev of UNLOCK_EVENTS)
    document.addEventListener(ev, onGesture, true);
  const onVisibility = (): void => {
    e.setHidden(document.visibilityState === 'hidden');
  };
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();
  installUiSounds(document, playCue);
}
