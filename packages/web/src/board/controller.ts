/**
 * Holds the camera for one board view and applies presets. Plain module, no
 * DOM: the view feeds it the viewport and layout and listens for changes.
 */

import {
  centerCamera,
  clampCamera,
  fitCamera,
  focusCamera,
  panBy,
  zoomAbout,
  type Bounds,
  type Camera,
  type Point,
  type Viewport,
} from './camera.js';

export type CameraPreset = 'center' | 'base' | 'fit';

export class CameraController {
  private cam: Camera = { cx: 0, cy: 0, zoom: 1 };
  private vp: Viewport = { w: 0, h: 0 };
  private bounds: Bounds = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private base: Point | null = null;
  private resetKey: unknown = Symbol('none');
  private pendingReset = true;
  /** The preset a new layout key puts the camera at. */
  resetPreset: CameraPreset = 'center';
  /**
   * When set, a reset also zooms to this many pixels per cell (within the
   * zoom limits), even where the whole board would fit at a smaller zoom.
   */
  startZoom: number | null = null;
  /**
   * When true, a resize re-applies the reset preset until the user pans or
   * zooms (the layout around the view may still be settling at first).
   */
  refitOnResize = false;
  private following = false;
  private readonly listeners = new Set<() => void>();

  get camera(): Camera {
    return this.cam;
  }

  get viewport(): Viewport {
    return this.vp;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private set(cam: Camera): void {
    if (
      cam.cx === this.cam.cx &&
      cam.cy === this.cam.cy &&
      cam.zoom === this.cam.zoom
    ) {
      return;
    }
    this.cam = cam;
    this.emit();
  }

  private get ready(): boolean {
    return this.vp.w > 0 && this.vp.h > 0;
  }

  /** Describe the content. A new `key` puts the camera back at Center. */
  setLayout(bounds: Bounds, base: Point | null, key: unknown): void {
    this.bounds = bounds;
    this.base = base;
    if (key !== this.resetKey) {
      this.resetKey = key;
      this.pendingReset = true;
    }
    this.settle();
  }

  setViewport(vp: Viewport): void {
    if (vp.w === this.vp.w && vp.h === this.vp.h) return;
    this.vp = vp;
    if (this.refitOnResize && this.following) {
      this.pendingReset = true;
    }
    this.settle();
  }

  private settle(): void {
    if (!this.ready) return;
    if (this.pendingReset) {
      this.pendingReset = false;
      this.preset(this.resetPreset);
      if (this.startZoom !== null) {
        this.set(
          clampCamera(
            { ...this.cam, zoom: this.startZoom },
            this.vp,
            this.bounds,
          ),
        );
      }
      this.following = true;
      this.emit();
      return;
    }
    this.set(clampCamera(this.cam, this.vp, this.bounds));
  }

  preset(name: CameraPreset): void {
    if (!this.ready) return;
    this.following = false;
    let cam: Camera;
    if (name === 'fit') cam = fitCamera(this.vp, this.bounds);
    else if (name === 'base' && this.base)
      cam = focusCamera(this.vp, this.bounds, this.base);
    else {
      cam = centerCamera(this.vp, this.bounds);
      // Centre returns to the start view: the start zoom, when one is set.
      if (name === 'center' && this.startZoom !== null)
        cam = clampCamera(
          { ...cam, zoom: this.startZoom },
          this.vp,
          this.bounds,
        );
    }
    this.set(cam);
  }

  /** Centre on a view-space point (keeps the zoom if it is already closer). */
  focusAt(p: Point): void {
    if (!this.ready) return;
    this.following = false;
    const z = this.cam.zoom;
    const next = focusCamera(this.vp, this.bounds, p);
    this.set(z > next.zoom ? { ...next, zoom: z } : next);
  }

  pan(dxPx: number, dyPx: number): void {
    if (!this.ready) return;
    this.following = false;
    this.set(panBy(this.cam, this.vp, this.bounds, dxPx, dyPx));
  }

  zoomAt(at: Point, factor: number): void {
    if (!this.ready) return;
    this.following = false;
    this.set(zoomAbout(this.cam, this.vp, this.bounds, at, factor));
  }

  /** Zoom about the middle of the view (buttons). */
  zoomCentre(factor: number): void {
    this.zoomAt({ x: this.vp.w / 2, y: this.vp.h / 2 }, factor);
  }
}
