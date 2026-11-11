/**
 * Camera maths (pure). World coordinates are cells in "view space": x to the
 * right, y downwards on screen. The camera centre is a world point; `zoom` is
 * screen pixels per cell. No DOM, no state.
 */

export interface Camera {
  readonly cx: number;
  readonly cy: number;
  /** CSS pixels per cell. */
  readonly zoom: number;
}

export interface Viewport {
  /** CSS pixels. */
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface ZoomLimits {
  readonly min: number;
  readonly max: number;
}

/** Pixels per cell the camera starts at when the whole board fits. */
export const DEFAULT_ZOOM = 32;
export const MAX_ZOOM = 96;
export const MIN_ZOOM_FLOOR = 2;
/** Empty space kept around the content by `fitCamera`, in screen pixels. */
export const FIT_PADDING_PX = 12;

export function boundsCenter(b: Bounds): Point {
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
}

export function worldToScreen(cam: Camera, vp: Viewport, p: Point): Point {
  return {
    x: (p.x - cam.cx) * cam.zoom + vp.w / 2,
    y: (p.y - cam.cy) * cam.zoom + vp.h / 2,
  };
}

export function screenToWorld(cam: Camera, vp: Viewport, p: Point): Point {
  return {
    x: (p.x - vp.w / 2) / cam.zoom + cam.cx,
    y: (p.y - vp.h / 2) / cam.zoom + cam.cy,
  };
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The zoom at which `bounds` fits the viewport, with padding. */
export function fitZoom(
  vp: Viewport,
  bounds: Bounds,
  padding = FIT_PADDING_PX,
): number {
  const bw = Math.max(bounds.x1 - bounds.x0, 1e-6);
  const bh = Math.max(bounds.y1 - bounds.y0, 1e-6);
  return Math.min(
    Math.max(vp.w - 2 * padding, 1) / bw,
    Math.max(vp.h - 2 * padding, 1) / bh,
  );
}

/** Zoom limits for a viewport and content: out to half of "fit", in to 96. */
export function zoomLimits(vp: Viewport, bounds: Bounds): ZoomLimits {
  const fit = fitZoom(vp, bounds);
  const min = Math.max(MIN_ZOOM_FLOOR, Math.min(fit * 0.5, MAX_ZOOM / 2));
  return { min, max: Math.max(MAX_ZOOM, min * 2) };
}

/**
 * Keep the zoom within limits and the camera centre inside the content, so
 * the content can never be panned entirely off screen.
 */
export function clampCamera(cam: Camera, vp: Viewport, bounds: Bounds): Camera {
  const lim = zoomLimits(vp, bounds);
  return {
    zoom: clampNum(cam.zoom, lim.min, lim.max),
    cx: clampNum(cam.cx, bounds.x0, bounds.x1),
    cy: clampNum(cam.cy, bounds.y0, bounds.y1),
  };
}

/** Whole content visible and centred. */
export function fitCamera(vp: Viewport, bounds: Bounds): Camera {
  const c = boundsCenter(bounds);
  return clampCamera(
    { cx: c.x, cy: c.y, zoom: fitZoom(vp, bounds) },
    vp,
    bounds,
  );
}

/** Centre on a world point at the default zoom (or the fit zoom if smaller). */
export function focusCamera(
  vp: Viewport,
  bounds: Bounds,
  target: Point,
): Camera {
  return clampCamera(
    {
      cx: target.x,
      cy: target.y,
      zoom: Math.min(DEFAULT_ZOOM, fitZoom(vp, bounds)),
    },
    vp,
    bounds,
  );
}

/** Centre of the content at the default zoom (or the fit zoom if smaller). */
export function centerCamera(vp: Viewport, bounds: Bounds): Camera {
  return focusCamera(vp, bounds, boundsCenter(bounds));
}

/** Move the view by a screen-pixel drag: content follows the pointer. */
export function panBy(
  cam: Camera,
  vp: Viewport,
  bounds: Bounds,
  dxPx: number,
  dyPx: number,
): Camera {
  return clampCamera(
    { ...cam, cx: cam.cx - dxPx / cam.zoom, cy: cam.cy - dyPx / cam.zoom },
    vp,
    bounds,
  );
}

/**
 * Multiply the zoom by `factor` keeping the world point under `at` (a screen
 * point) fixed on screen. Limits and clamping apply afterwards.
 */
export function zoomAbout(
  cam: Camera,
  vp: Viewport,
  bounds: Bounds,
  at: Point,
  factor: number,
): Camera {
  const lim = zoomLimits(vp, bounds);
  const zoom = clampNum(cam.zoom * factor, lim.min, lim.max);
  const before = screenToWorld(cam, vp, at);
  const cx = before.x - (at.x - vp.w / 2) / zoom;
  const cy = before.y - (at.y - vp.h / 2) / zoom;
  return clampCamera({ cx, cy, zoom }, vp, bounds);
}
