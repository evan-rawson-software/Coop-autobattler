/**
 * The sprite atlas (assets/sprites/atlas.json) and sheets, plus the few
 * drawing helpers the preview needs. Asset URLs come from Vite imports, so
 * they follow the configured base path (GitHub Pages) without extra work.
 */

import atlasJson from '../../../../assets/sprites/atlas.json';
import buildingsUrl from '../../../../assets/sprites/buildings.png?url';
import effectsUrl from '../../../../assets/sprites/effects.png?url';
import terrainUrl from '../../../../assets/sprites/terrain.png?url';
import uiUrl from '../../../../assets/sprites/ui.png?url';
import unitsUrl from '../../../../assets/sprites/units.png?url';

export interface AtlasSprite {
  sheet: string;
  x: number;
  y: number;
  /** One frame; frames sit side by side. */
  w: number;
  h: number;
  frames: number;
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
  sheets: Record<string, { file: string; w: number; h: number }>;
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

export const atlas = atlasJson as unknown as Atlas;

const SHEET_URLS: Record<string, string> = {
  terrain: terrainUrl,
  buildings: buildingsUrl,
  units: unitsUrl,
  effects: effectsUrl,
  ui: uiUrl,
};

export interface Sheets {
  images: Record<string, HTMLImageElement>;
  loaded: number;
  failed: string[];
}

export function loadSheets(): Promise<Sheets> {
  const names = Object.keys(SHEET_URLS);
  const images: Record<string, HTMLImageElement> = {};
  const failed: string[] = [];
  let loaded = 0;
  return Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            loaded++;
            images[name] = img;
            resolve();
          };
          img.onerror = () => {
            failed.push(name);
            resolve();
          };
          img.src = SHEET_URLS[name] ?? '';
        }),
    ),
  ).then(() => ({ images, loaded, failed }));
}

export function spriteOf(name: string): AtlasSprite {
  const s = atlas.sprites[name];
  if (!s) throw new Error(`no sprite named ${name}`);
  return s;
}

export type Ramp = readonly string[];

const tintCache = new Map<string, HTMLCanvasElement>();

function rgbOf(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** One frame with the neutral tint ramp swapped for `ramp` (cached). */
function tintedFrame(
  sheets: Sheets,
  name: string,
  frame: number,
  ramp: Ramp,
): HTMLCanvasElement {
  const key = `${name}#${String(frame)}#${ramp.join(',')}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const sp = spriteOf(name);
  const c = document.createElement('canvas');
  c.width = sp.w;
  c.height = sp.h;
  const ctx = c.getContext('2d');
  const img = sheets.images[sp.sheet];
  if (ctx && img) {
    ctx.drawImage(img, sp.x + frame * sp.w, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    const data = ctx.getImageData(0, 0, sp.w, sp.h);
    const from = atlas.tint.neutral.map(rgbOf);
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
  }
  tintCache.set(key, c);
  return c;
}

export interface DrawOpts {
  /** Swap the tint ramp (needs a tintable sprite). */
  ramp?: Ramp;
  /** Quarter turns clockwise about the sprite centre. */
  rot?: 0 | 1 | 2 | 3;
  alpha?: number;
}

/** Draw one frame with its top-left at (x, y), scaled by an integer. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sheets: Sheets,
  name: string,
  frame: number,
  x: number,
  y: number,
  scale: number,
  opts: DrawOpts = {},
): void {
  const sp = spriteOf(name);
  const f = ((frame % sp.frames) + sp.frames) % sp.frames;
  const w = sp.w * scale;
  const h = sp.h * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  if (opts.rot) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((opts.rot * Math.PI) / 2);
    ctx.translate(-w / 2, -h / 2);
  } else {
    ctx.translate(x, y);
  }
  if (opts.ramp) {
    ctx.drawImage(tintedFrame(sheets, name, f, opts.ramp), 0, 0, w, h);
  } else {
    const img = sheets.images[sp.sheet];
    if (img) ctx.drawImage(img, sp.x + f * sp.w, sp.y, sp.w, sp.h, 0, 0, w, h);
  }
  ctx.restore();
}

/** Draw a 9-slice stretched to (dw x dh) destination pixels. */
export function drawNine(
  ctx: CanvasRenderingContext2D,
  sheets: Sheets,
  name: string,
  x: number,
  y: number,
  dw: number,
  dh: number,
  scale: number,
): void {
  const sp = spriteOf(name);
  const img = sheets.images[sp.sheet];
  if (!img || !sp.nineSlice) return;
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
}

/** Fill a rectangle by tiling a sprite's first frame. */
export function drawTiled(
  ctx: CanvasRenderingContext2D,
  sheets: Sheets,
  name: string,
  cols: number,
  rows: number,
  scale: number,
): void {
  const sp = spriteOf(name);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      drawFrame(
        ctx,
        sheets,
        name,
        0,
        i * sp.w * scale,
        j * sp.h * scale,
        scale,
      );
}
