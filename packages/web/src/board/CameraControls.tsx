/** Buttons for the camera presets and zoom, overlaid on the board view. */

import { screenText, screenTexts } from '../build/texts.js';
import type { CameraController } from './controller.js';

const t = (key: string): string => screenText(screenTexts, key);

export function CameraControls(props: {
  controller: CameraController;
  /** Battle screen: centre the camera on the enemy's base. */
  onEnemyBase?: (() => void) | undefined;
}) {
  const c = props.controller;
  return (
    <div class="camera-controls" role="group" aria-label={t('uiCameraPanel')}>
      <button
        type="button"
        data-camera="center"
        onClick={() => {
          c.preset('center');
        }}
      >
        {t('uiCameraCenter')}
      </button>
      <button
        type="button"
        data-camera="base"
        onClick={() => {
          c.preset('base');
        }}
      >
        {t('uiCameraMyBase')}
      </button>
      {props.onEnemyBase === undefined ? null : (
        <button
          type="button"
          data-camera="enemy-base"
          onClick={props.onEnemyBase}
        >
          {t('uiCameraTheirBase')}
        </button>
      )}
      <button
        type="button"
        data-camera="fit"
        onClick={() => {
          c.preset('fit');
        }}
      >
        {t('uiCameraFit')}
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        data-camera="zoom-in"
        onClick={() => {
          c.zoomCentre(1.25);
        }}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        data-camera="zoom-out"
        onClick={() => {
          c.zoomCentre(0.8);
        }}
      >
        &minus;
      </button>
    </div>
  );
}
