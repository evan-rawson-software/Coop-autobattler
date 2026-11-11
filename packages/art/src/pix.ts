/** A small RGBA pixel canvas with the drawing helpers the sprite code needs. */

import { COLORS, type Rgba } from './palette.js';

export type ColorMap = Readonly<Record<string, Rgba>>;

export class Pix {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    /** Colour keys resolve through this map unless a call passes another. */
    readonly map: ColorMap = COLORS,
  ) {
    this.data = new Uint8Array(w * h * 4);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Set a pixel from a colour key (or '.' to clear). Out of range is ignored. */
  set(x: number, y: number, key: string, map: ColorMap = this.map): void {
    if (!this.inside(x, y)) return;
    const o = (y * this.w + x) * 4;
    if (key === '.') {
      this.data.fill(0, o, o + 4);
      return;
    }
    const c = map[key];
    if (!c) throw new Error(`unknown colour key '${key}'`);
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
    this.data[o + 3] = c[3];
  }

  setRgba(x: number, y: number, c: Rgba): void {
    if (!this.inside(x, y)) return;
    const o = (y * this.w + x) * 4;
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
    this.data[o + 3] = c[3];
  }

  get(x: number, y: number): Rgba {
    if (!this.inside(x, y)) return [0, 0, 0, 0];
    const o = (y * this.w + x) * 4;
    return [
      this.data[o] ?? 0,
      this.data[o + 1] ?? 0,
      this.data[o + 2] ?? 0,
      this.data[o + 3] ?? 0,
    ];
  }

  opaque(x: number, y: number): boolean {
    return this.get(x, y)[3] > 0;
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    key: string,
    map: ColorMap = this.map,
  ): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.set(x + i, y + j, key, map);
  }

  hline(x: number, y: number, len: number, key: string): void {
    this.rect(x, y, len, 1, key);
  }
  vline(x: number, y: number, len: number, key: string): void {
    this.rect(x, y, 1, len, key);
  }

  line(x0: number, y0: number, x1: number, y1: number, key: string): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, key);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Filled ellipse centred at (cx, cy) (may be half-integers) with radii rx, ry. */
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    key: string,
    map: ColorMap = this.map,
  ): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, key, map);
      }
  }

  /** Stamp a grid of colour keys; '.' and ' ' are transparent (skipped). */
  stamp(
    grid: readonly string[],
    x: number,
    y: number,
    map: ColorMap = this.map,
  ): void {
    grid.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i] ?? '.';
        if (ch === '.' || ch === ' ') continue;
        this.set(x + i, y + j, ch, map);
      }
    });
  }

  /** Copy another canvas on top (transparent pixels skipped). */
  blit(src: Pix, x: number, y: number): void {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const c = src.get(i, j);
        if (c[3] > 0) this.setRgba(x + i, y + j, c);
      }
  }

  clone(): Pix {
    const p = new Pix(this.w, this.h, this.map);
    p.data.set(this.data);
    return p;
  }

  /** Add a 1-px outline around the opaque pixels, on transparent ones. */
  outline(key: string, map: ColorMap = this.map): void {
    const src = this.clone();
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (src.opaque(x, y)) continue;
        if (
          src.opaque(x - 1, y) ||
          src.opaque(x + 1, y) ||
          src.opaque(x, y - 1) ||
          src.opaque(x, y + 1)
        )
          this.set(x, y, key, map);
      }
  }

  /** A copy with every opaque pixel mapped through `fn`. */
  mapPixels(fn: (c: Rgba) => Rgba): Pix {
    const out = new Pix(this.w, this.h, this.map);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        if (c[3] > 0) out.setRgba(x, y, fn(c));
      }
    return out;
  }
}

/** Mulberry32: tiny deterministic PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wrapped coordinate, for seamless tiling. */
export function wrap(v: number, n: number): number {
  return ((v % n) + n) % n;
}

/**
 * Draw an opaque, outlined, bevelled shape: `inside(x, y)` says which pixels
 * belong to it (it may answer true outside the canvas to let a shape run off
 * an edge, which then has no outline there). Light comes from the top-left:
 * pixels next to the top/left outline get the light key, those next to the
 * bottom/right outline the dark key. `ramp` is [dark, mid, light].
 */
export function bevelShape(
  p: Pix,
  inside: (x: number, y: number) => boolean,
  ramp: readonly [string, string, string],
  outlineKey = 'K',
): void {
  const inner = (x: number, y: number) =>
    inside(x - 1, y) &&
    inside(x + 1, y) &&
    inside(x, y - 1) &&
    inside(x, y + 1);
  const edge = (x: number, y: number) => inside(x, y) && !inner(x, y);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!inside(x, y)) continue;
      if (edge(x, y)) {
        p.set(x, y, outlineKey);
        continue;
      }
      const lightEdge = edge(x - 1, y) || edge(x, y - 1);
      const darkEdge = edge(x + 1, y) || edge(x, y + 1);
      const key =
        lightEdge && !darkEdge ? ramp[2] : darkEdge && !lightEdge ? ramp[0] : ramp[1];
      p.set(x, y, key);
    }
}

/** Rounded rectangle membership; `cut` is how many corner pixels are cut. */
export function roundRect(
  x0: number,
  y0: number,
  w: number,
  h: number,
  cut = 1,
): (x: number, y: number) => boolean {
  return (x, y) => {
    if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
    const dx = Math.min(x - x0, x0 + w - 1 - x);
    const dy = Math.min(y - y0, y0 + h - 1 - y);
    return dx + dy >= cut;
  };
}
