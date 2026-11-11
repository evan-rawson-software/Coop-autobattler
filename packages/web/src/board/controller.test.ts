import { describe, expect, test } from 'vitest';
import { DEFAULT_ZOOM } from './camera.js';
import { CameraController } from './controller.js';

describe('Center preset', () => {
  test('returns to the start view, including the start zoom', () => {
    const wide = { x0: 0, y0: 0, x1: 96, y1: 16 };
    const c = new CameraController();
    c.startZoom = DEFAULT_ZOOM;
    c.setViewport({ w: 1000, h: 600 });
    c.setLayout(wide, null, 'k');
    const start = c.camera;
    c.preset('fit');
    expect(c.camera.zoom).not.toBe(start.zoom);
    c.preset('center');
    expect(c.camera).toEqual(start);
  });

  test('without a start zoom it keeps the default-or-fit zoom', () => {
    const c = new CameraController();
    c.setViewport({ w: 1000, h: 600 });
    c.setLayout({ x0: 0, y0: 0, x1: 96, y1: 16 }, null, 'k');
    c.preset('center');
    expect(c.camera.zoom).toBeLessThan(DEFAULT_ZOOM);
  });
});
