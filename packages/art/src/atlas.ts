/** Packs sprites into sheets and builds the atlas JSON. Deterministic. */

import { PALETTE, TINT_KEYS, TINT_NEUTRAL, TEAM_A, TEAM_B } from './palette.js';
import { Pix } from './pix.js';
import { encodePng } from './png.js';
import type { SheetName, SpriteDef } from './model.js';

export const TILE = 16;
export const SHEET_WIDTH = 320;
export const GUTTER = 1;
export const SHEET_NAMES: readonly SheetName[] = [
  'terrain',
  'buildings',
  'units',
  'effects',
  'ui',
];

export interface AtlasSprite {
  sheet: string;
  x: number;
  y: number;
  /** Width and height of ONE frame. */
  w: number;
  h: number;
  frames: number;
  fps: number;
  anchor: [number, number];
  category: string;
  id?: string;
  planned?: true;
  nineSlice?: [number, number, number, number];
  tintable?: true;
  note?: string;
}

export interface Atlas {
  version: 1;
  tile: number;
  /** Frames of one sprite sit side by side; sprites are separated by this gutter. */
  gutter: number;
  filter: 'nearest';
  sheets: Record<string, { file: string; w: number; h: number }>;
  palette: { key: string; name: string; hex: string }[];
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

export interface Built {
  atlas: Atlas;
  pngs: Map<string, Buffer>;
}

export function buildSheets(
  defs: readonly SpriteDef[],
  resourceRamps: Record<string, string[]>,
): Built {
  const sprites: Record<string, AtlasSprite> = {};
  const pngs = new Map<string, Buffer>();
  const sheets: Atlas['sheets'] = {};
  const seen = new Set<string>();
  for (const sheetName of SHEET_NAMES) {
    const list = defs.filter((d) => d.sheet === sheetName);
    // Shelf packing in definition order.
    const placed: { def: SpriteDef; x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const def of list) {
      if (seen.has(def.name)) throw new Error(`duplicate sprite ${def.name}`);
      seen.add(def.name);
      const first = def.frames[0];
      if (!first) throw new Error(`no frames: ${def.name}`);
      const w = first.w * def.frames.length;
      if (w > SHEET_WIDTH) throw new Error(`${def.name} is wider than a sheet`);
      if (x > 0 && x + w > SHEET_WIDTH) {
        x = 0;
        y += rowH + GUTTER;
        rowH = 0;
      }
      placed.push({ def, x, y });
      x += w + GUTTER;
      rowH = Math.max(rowH, first.h);
    }
    const height = Math.ceil((y + rowH) / 4) * 4;
    const sheet = new Pix(SHEET_WIDTH, height);
    for (const { def, x: px, y: py } of placed) {
      def.frames.forEach((f, i) => {
        sheet.blit(f, px + i * f.w, py);
      });
      const first = def.frames[0] as Pix;
      const entry: AtlasSprite = {
        sheet: sheetName,
        x: px,
        y: py,
        w: first.w,
        h: first.h,
        frames: def.frames.length,
        fps: def.fps,
        anchor: [def.anchor[0], def.anchor[1]],
        category: def.category,
      };
      if (def.id !== undefined) entry.id = def.id;
      if (def.planned) entry.planned = true;
      if (def.nineSlice)
        entry.nineSlice = [...def.nineSlice] as [number, number, number, number];
      if (def.tintable) entry.tintable = true;
      if (def.note) entry.note = def.note;
      sprites[def.name] = entry;
    }
    sheets[sheetName] = { file: `${sheetName}.png`, w: SHEET_WIDTH, h: height };
    pngs.set(`${sheetName}.png`, encodePng(SHEET_WIDTH, height, sheet.data));
  }
  const atlas: Atlas = {
    version: 1,
    tile: TILE,
    gutter: GUTTER,
    filter: 'nearest',
    sheets,
    palette: PALETTE.map((p) => ({ key: p.key, name: p.name, hex: p.hex })),
    tint: {
      keys: [...TINT_KEYS],
      neutral: [...TINT_NEUTRAL],
      teamA: [...TEAM_A],
      teamB: [...TEAM_B],
      resources: resourceRamps,
    },
    sprites,
    planned: defs.filter((d) => d.planned).map((d) => d.name),
  };
  return { atlas, pngs };
}
