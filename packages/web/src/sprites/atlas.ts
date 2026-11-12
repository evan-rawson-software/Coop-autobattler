/**
 * The shared sprite module: loads the atlas (assets/sprites/atlas.json) and
 * the sheets once, lazily, and draws from them. Nothing here is imported into
 * the first paint's work: the JSON and the PNGs are separate assets fetched on
 * demand through `loadSprites()`, and every drawing helper returns quietly
 * (false) until they have arrived, so callers keep a flat fallback.
 *
 * Asset URLs come from Vite `?url` imports, so they follow the configured
 * base path (GitHub Pages) without extra work.
 */

import atlasUrl from '../../../../assets/sprites/atlas.json?url';
import buildingsUrl from '../../../../assets/sprites/buildings.png?url';
import effectsUrl from '../../../../assets/sprites/effects.png?url';
import tilesUrl from '../../../../assets/sprites/tiles.png?url';
import uiUrl from '../../../../assets/sprites/ui.png?url';
import unitsUrl from '../../../../assets/sprites/units.png?url';

export { BLOB_MASKS, blobFrame, blobMask, normalizeMask } from './autotile.js';

export interface AtlasSprite {
  sheet: string;
  x: number;
  y: number;
  /** One frame; frames sit side by side. */
  w: number;
  h: number;
  frames: number;
  /** Frames per row; absent means all frames in one row. */
  columns?: number;
  autotile?: 'blob47';
  fps: number;
  anchor: [number, number];
  category: string;
  id?: string;
  planned?: boolean;
  nineSlice?: [number, number, number, number];
  tintable?: boolean;
  note?: string;
}

export interface Atlas {
  tile: number;
  sheets: Record<string, { file: string; w: number; h: number; grid?: number }>;
  autotile: { blob47: { bits: Record<string, number>; masks: number[] } };
  tint: {
    keys: string[];
    neutral: string[];
    teamA: string[];
    teamB: string[];
    resources: Record<string, string[]>;
  };
  sprites: Record<string, AtlasSprite>;
  planned: string[];
}

export interface Sheets {
  images: Record<string, HTMLImageElement>;
  loaded: number;
  failed: string[];
}

export interface SpriteSet {
  atlas: Atlas;
  sheets: Sheets;
}

export type SpritesState = 'idle' | 'loading' | 'ready' | 'failed';

const SHEET_URLS: Record<string, string> = {
  tiles: tilesUrl,
  buildings: buildingsUrl,
  units: unitsUrl,
  effects: effectsUrl,
  ui: uiUrl,
};

let state: SpritesState = 'idle';
let current: SpriteSet | null = null;
let shared: Promise<SpriteSet | null> | null = null;
const listeners = new Set<() => void>();

/** Counters the smoke script reads through the debug hook. */
export const spriteStats = { drawn: 0, units: 0 };

export function spritesState(): SpritesState {
  return state;
}

/** The loaded atlas and sheets, or null until they have arrived (or failed). */
export function spriteSet(): SpriteSet | null {
  return current;
}

/** The atlas; throws before it has loaded (callers check `spriteSet()`). */
export function getAtlas(): Atlas {
  if (!current) throw new Error('The sprite atlas is not loaded yet.');
  return current.atlas;
}

/** Call `cb` whenever the load state changes. Returns the unsubscribe. */
export function onSpritesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function setState(next: SpritesState): void {
  state = next;
  for (const cb of [...listeners]) cb();
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = url;
  });
}

async function fetchAtlas(): Promise<Atlas | null> {
  try {
    const res = await fetch(atlasUrl);
    if (!res.ok) return null;
    return (await res.json()) as Atlas;
  } catch {
    return null;
  }
}

/**
 * Start loading (once; later calls share the same promise). Resolves with the
 * sprites, or null when the atlas or a sheet the board needs failed.
 */
export function loadSprites(): Promise<SpriteSet | null> {
  if (shared) return shared;
  setState('loading');
  shared = (async () => {
    const names = Object.keys(SHEET_URLS);
    const [atlas, imgs] = await Promise.all([
      fetchAtlas(),
      Promise.all(names.map((n) => loadImage(SHEET_URLS[n] ?? ''))),
    ]);
    const images: Record<string, HTMLImageElement> = {};
    const failed: string[] = [];
    names.forEach((n, i) => {
      const img = imgs[i];
      if (img) images[n] = img;
      else failed.push(n);
    });
    if (!atlas || !images['tiles'] || !images['buildings']) {
      setState('failed');
      return null;
    }
    current = {
      atlas,
      sheets: { images, loaded: names.length - failed.length, failed },
    };
    setState('ready');
    return current;
  })();
  return shared;
}

/** Old name used by the preview page: the sheets once everything loaded. */
export function loadSheets(): Promise<Sheets> {
  return loadSprites().then(
    (s) =>
      s?.sheets ?? { images: {}, loaded: 0, failed: Object.keys(SHEET_URLS) },
  );
}

export function spriteOf(name: string): AtlasSprite {
  const s = current?.atlas.sprites[name];
  if (!s) throw new Error(`no sprite named ${name}`);
  return s;
}

/** The sprite if the atlas has loaded and knows the name. */
export function findSprite(name: string): AtlasSprite | undefined {
  return current?.atlas.sprites[name];
}

/** Top-left of frame `f` of a sprite on its sheet. */
export function frameOrigin(sp: AtlasSprite, f: number): [number, number] {
  const cols = sp.columns ?? sp.frames;
  return [sp.x + (f % cols) * sp.w, sp.y + Math.floor(f / cols) * sp.h];
}

/** The frame of an animated sprite at `timeMs` (frame 0 when static). */
export function animFrame(sp: AtlasSprite, timeMs: number): number {
  if (sp.fps <= 0 || sp.frames <= 1) return 0;
  return Math.floor((timeMs / 1000) * sp.fps) % sp.frames;
}

export type Ramp = readonly string[];

// ---------------------------------------------------------------------------
// Tinting: swap the three neutral greys for a ramp, once per variant, in an
// offscreen canvas that is cached. Never any pixel work per frame.

/** Cache key of one tinted frame. */
export function tintKey(name: string, frame: number, ramp: Ramp): string {
  return `${name}#${String(frame)}#${ramp.join(',')}`;
}

/** Look `key` up in `cache`, making and storing the value on a miss. */
export function memo<V>(cache: Map<string, V>, key: string, make: () => V): V {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = make();
  cache.set(key, v);
  return v;
}

const tintCache = new Map<string, HTMLCanvasElement>();
const cropCache = new Map<string, HTMLCanvasElement>();

/** Number of cached tinted frames (for tests and the debug hook). */
export function tintCacheSize(): number {
  return tintCache.size;
}

function rgbOf(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** One frame cut out of its sheet, optionally tinted (cached). */
export function frameCanvas(
  set: SpriteSet,
  name: string,
  frame: number,
  ramp?: Ramp,
): HTMLCanvasElement | null {
  const sp = set.atlas.sprites[name];
  const img = sp ? set.sheets.images[sp.sheet] : undefined;
  if (!sp || !img) return null;
  const f = ((frame % sp.frames) + sp.frames) % sp.frames;
  if (!ramp) {
    return memo(cropCache, `${name}#${String(f)}`, () => {
      const c = newCanvas(sp.w, sp.h);
      const [ox, oy] = frameOrigin(sp, f);
      c.getContext('2d')?.drawImage(img, ox, oy, sp.w, sp.h, 0, 0, sp.w, sp.h);
      return c;
    });
  }
  return memo(tintCache, tintKey(name, f, ramp), () => {
    const c = newCanvas(sp.w, sp.h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return c;
    const [ox, oy] = frameOrigin(sp, f);
    ctx.drawImage(img, ox, oy, sp.w, sp.h, 0, 0, sp.w, sp.h);
    const data = ctx.getImageData(0, 0, sp.w, sp.h);
    const from = set.atlas.tint.neutral.map(rgbOf);
    const to = ramp.map(rgbOf);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const v =
        ((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0);
      const k = from.indexOf(v);
      const target = k >= 0 ? to[k] : undefined;
      if (target !== undefined) {
        px[i] = (target >> 16) & 255;
        px[i + 1] = (target >> 8) & 255;
        px[i + 2] = target & 255;
      }
    }
    ctx.putImageData(data, 0, 0);
    return c;
  });
}

export interface DrawOpts {
  /** Frame index (default 0; wrapped). */
  frame?: number;
  /** Swap the tint ramp (needs a tintable sprite). */
  ramp?: Ramp;
  /** Quarter turns clockwise about the sprite centre. */
  rot?: 0 | 1 | 2 | 3;
  /** Mirror top to bottom (before rotating). */
  flipV?: boolean;
  alpha?: number;
}

function blit(
  ctx: CanvasRenderingContext2D,
  set: SpriteSet,
  name: string,
  x: number,
  y: number,
  scale: number,
  opts: DrawOpts,
): boolean {
  const sp = set.atlas.sprites[name];
  if (!sp) return false;
  const src = frameCanvas(set, name, opts.frame ?? 0, opts.ramp);
  if (!src) return false;
  const w = sp.w * scale;
  const h = sp.h * scale;
  ctx.imageSmoothingEnabled = false;
  const plain = !opts.rot && !opts.flipV && opts.alpha === undefined;
  if (plain) {
    ctx.drawImage(src, x, y, w, h);
  } else {
    ctx.save();
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    ctx.translate(x + w / 2, y + h / 2);
    if (opts.rot) ctx.rotate((opts.rot * Math.PI) / 2);
    if (opts.flipV) ctx.scale(1, -1);
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  spriteStats.drawn += 1;
  return true;
}

/**
 * Draw one frame of a sprite with its top-left at (x, y); `scale` is
 * destination pixels per sprite pixel. Returns false (drawing nothing) when
 * the sprites are not loaded or the name or sheet is unknown.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  scale: number,
  opts: DrawOpts = {},
): boolean {
  return current ? blit(ctx, current, name, x, y, scale, opts) : false;
}

/** The same with an explicit sheet set (the preview page passes its own). */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  _sheets: Sheets,
  name: string,
  frame: number,
  x: number,
  y: number,
  scale: number,
  opts: DrawOpts = {},
): void {
  if (current) blit(ctx, current, name, x, y, scale, { ...opts, frame });
}

/** Fill a rectangle with a sprite repeated at `scale`, anchored at (x, y). */
export function fillTiled(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): boolean {
  if (!current) return false;
  const src = frameCanvas(current, name, 0);
  if (!src) return false;
  const pat = ctx.createPattern(src, 'repeat');
  if (!pat) return false;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w / scale, h / scale);
  ctx.restore();
  spriteStats.drawn += 1;
  return true;
}

/** Draw a 9-slice stretched to (dw x dh) destination pixels. */
export function drawNine(
  ctx: CanvasRenderingContext2D,
  _sheets: Sheets,
  name: string,
  x: number,
  y: number,
  dw: number,
  dh: number,
  scale: number,
): void {
  if (!current) return;
  const sp = current.atlas.sprites[name];
  const img = sp ? current.sheets.images[sp.sheet] : undefined;
  if (!sp || !img || !sp.nineSlice) return;
  const [l, t, r, b] = sp.nineSlice;
  const sx = [0, l, sp.w - r, sp.w];
  const sy = [0, t, sp.h - b, sp.h];
  const dx = [0, l * scale, dw - r * scale, dw];
  const dy = [0, t * scale, dh - b * scale, dh];
  ctx.imageSmoothingEnabled = false;
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const s0x = sx[i] ?? 0;
      const s0y = sy[j] ?? 0;
      const sw = (sx[i + 1] ?? 0) - s0x;
      const sh = (sy[j + 1] ?? 0) - s0y;
      const d0x = dx[i] ?? 0;
      const d0y = dy[j] ?? 0;
      const w = (dx[i + 1] ?? 0) - d0x;
      const h = (dy[j + 1] ?? 0) - d0y;
      if (sw <= 0 || sh <= 0 || w <= 0 || h <= 0) continue;
      ctx.drawImage(
        img,
        sp.x + s0x,
        sp.y + s0y,
        sw,
        sh,
        x + d0x,
        y + d0y,
        w,
        h,
      );
    }
  spriteStats.drawn += 1;
}
