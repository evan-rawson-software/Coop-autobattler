/**
 * The Sound settings (AU-23): three volume sliders and a Mute switch. The
 * same contents open from the main menu and from the run bar. Changes apply
 * at once; a short click plays when a slider is released, and `ui.toggle`
 * when Mute changes, so the new level can be heard.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { screenText, screenTexts } from '../build/texts.js';
import { playCue } from './index.js';
import {
  audioSettingsStore,
  setMuted,
  setVolume,
  VOLUME_GROUPS,
  type VolumeGroup,
} from './settings.js';
import './sound.css';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

const LABELS: Record<VolumeGroup, string> = {
  master: 'audioMaster',
  music: 'audioMusic',
  effects: 'audioEffects',
};

/** The sliders and the Mute switch. */
export function SoundPanel() {
  const s = useStore(audioSettingsStore);
  return (
    <div class="sound-panel" data-field="sound-panel">
      {VOLUME_GROUPS.map((g) => (
        <label class="sound-row" key={g}>
          <span class="sound-label">{t(LABELS[g])}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={s[g]}
            data-field={`sound-${g}`}
            disabled={s.muted}
            onInput={(e) => {
              setVolume(g, e.currentTarget.valueAsNumber);
            }}
            onChange={() => {
              playCue('ui.click');
            }}
          />
          <output class="sound-value" data-field={`sound-${g}-value`}>
            {t('audioPercent', { value: String(s[g]) })}
          </output>
        </label>
      ))}
      <label class="sound-mute">
        <input
          type="checkbox"
          checked={s.muted}
          data-field="sound-mute"
          onChange={(e) => {
            setMuted(e.currentTarget.checked);
          }}
        />
        {t('audioMute')}
      </label>
    </div>
  );
}

/** The run bar's Sound button; opens the panel as a popover. */
export function SoundMenuItem() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  return (
    <span class="bonus-item sound-item" data-field="bar-sound" ref={root}>
      <button
        type="button"
        id="sound-button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        {t('audioButton')}
      </button>
      {open ? (
        <div class="bonus-popover sound-popover" role="dialog">
          <h3>{t('audioTitle')}</h3>
          <SoundPanel />
          <button
            type="button"
            data-action="sound-close"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t('audioClose')}
          </button>
        </div>
      ) : null}
    </span>
  );
}
