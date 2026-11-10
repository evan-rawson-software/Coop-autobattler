/** Buttons for the camera presets and zoom, overlaid on the board view. */

import type { CameraController } from './controller.js';

export function CameraControls(props: { controller: CameraController }) {
  const c = props.controller;
  return (
    <div class="camera-controls" role="group" aria-label="Camera">
      <button
        type="button"
        data-camera="center"
        onClick={() => {
          c.preset('center');
        }}
      >
        Center
      </button>
      <button
        type="button"
        data-camera="base"
        onClick={() => {
          c.preset('base');
        }}
      >
        My base
      </button>
      <button
        type="button"
        data-camera="fit"
        onClick={() => {
          c.preset('fit');
        }}
      >
        Fit
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
