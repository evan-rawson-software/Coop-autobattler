import { describe, expect, test } from 'vitest';
import {
  DEFAULT_ZOOM,
  centerCamera,
  clampCamera,
  fitCamera,
  fitZoom,
  focusCamera,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAbout,
  zoomLimits,
  type Bounds,
  type Viewport,
} from './camera.js';

const vp: Viewport = { w: 1000, h: 600 };
const bounds: Bounds = { x0: 0, y0: 0, x1: 24, y1: 16 };

describe('transforms', () => {
  test('world to screen and back', () => {
    const cam = { cx: 10, cy: 5, zoom: 20 };
    const p = { x: 3.5, y: 11 };
    const s = worldToScreen(cam, vp, p);
    const w = screenToWorld(cam, vp, s);
    expect(w.x).toBeCloseTo(p.x);
    expect(w.y).toBeCloseTo(p.y);
  });

  test('the camera centre is the middle of the viewport', () => {
    const s = worldToScreen({ cx: 7, cy: 3, zoom: 12 }, vp, { x: 7, y: 3 });
    expect(s).toEqual({ x: 500, y: 300 });
  });
});

describe('presets', () => {
  test('fit shows the whole content, centred', () => {
    const cam = fitCamera(vp, bounds);
    const tl = worldToScreen(cam, vp, { x: bounds.x0, y: bounds.y0 });
    const br = worldToScreen(cam, vp, { x: bounds.x1, y: bounds.y1 });
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(vp.w);
    expect(br.y).toBeLessThanOrEqual(vp.h);
    expect(cam.cx).toBe(12);
    expect(cam.cy).toBe(8);
    expect(cam.zoom).toBeCloseTo(fitZoom(vp, bounds));
  });

  test('center uses the default zoom when the content fits', () => {
    const cam = centerCamera(vp, bounds);
    expect(cam.zoom).toBe(DEFAULT_ZOOM);
    expect(cam.cx).toBe(12);
    expect(cam.cy).toBe(8);
  });

  test('center does not exceed the fit zoom for wide content', () => {
    const wide: Bounds = { x0: 0, y0: 0, x1: 96, y1: 16 };
    const cam = centerCamera(vp, wide);
    expect(cam.zoom).toBeCloseTo(fitZoom(vp, wide));
    expect(cam.zoom).toBeLessThan(DEFAULT_ZOOM);
  });

  test('focus centres on a point', () => {
    const cam = focusCamera(vp, bounds, { x: 5, y: 4 });
    expect(cam.cx).toBe(5);
    expect(cam.cy).toBe(4);
  });
});

describe('pan', () => {
  test('content follows the pointer', () => {
    const cam = { cx: 12, cy: 8, zoom: 20 };
    const next = panBy(cam, vp, bounds, 40, -20);
    expect(next.cx).toBeCloseTo(10);
    expect(next.cy).toBeCloseTo(9);
  });

  test('cannot pan the content off screen', () => {
    const cam = { cx: 12, cy: 8, zoom: 20 };
    const next = panBy(cam, vp, bounds, -1e6, 1e6);
    expect(next.cx).toBe(bounds.x1);
    expect(next.cy).toBe(bounds.y0);
  });
});

describe('zoom', () => {
  test('keeps the point under the cursor fixed', () => {
    const cam = { cx: 12, cy: 8, zoom: 20 };
    const at = { x: 300, y: 200 };
    const before = screenToWorld(cam, vp, at);
    const next = zoomAbout(cam, vp, bounds, at, 1.5);
    expect(next.zoom).toBeCloseTo(30);
    const after = screenToWorld(next, vp, at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  test('respects the limits', () => {
    const lim = zoomLimits(vp, bounds);
    const cam = { cx: 12, cy: 8, zoom: 20 };
    const at = { x: 500, y: 300 };
    expect(zoomAbout(cam, vp, bounds, at, 1e9).zoom).toBe(lim.max);
    expect(zoomAbout(cam, vp, bounds, at, 1e-9).zoom).toBe(lim.min);
  });

  test('limits are ordered', () => {
    const lim = zoomLimits(vp, bounds);
    expect(lim.min).toBeLessThan(lim.max);
    expect(lim.min).toBeLessThanOrEqual(fitZoom(vp, bounds));
  });
});

describe('clamp', () => {
  test('pulls a lost camera back inside the content', () => {
    const cam = clampCamera({ cx: -500, cy: 900, zoom: 10 }, vp, bounds);
    expect(cam.cx).toBe(bounds.x0);
    expect(cam.cy).toBe(bounds.y1);
  });
});
