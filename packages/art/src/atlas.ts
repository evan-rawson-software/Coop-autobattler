/** Packs sprites into sheets and builds the atlas JSON. Deterministic. */

import { BLOB47, N, NE, E, SE, S, SW, W, NW } from './autotile.js';
import { PALETTE, TINT_KEYS, TINT_NEUTRAL, TEAM_A, TEAM_B } from './palette.js';
import { Pix } from './pix.js';
import { encodePng } from './png.js';
import type { SheetName, SpriteDef } from './model.js';

export const TILE = 16;
export const SHEET_WIDTH = 320;
export const GUTTER = 1;
/** Sheets laid out on an exact TILE grid with no gutter (one Godot TileSet source). */
export const GRID_SHEETS: ReadonlySet<SheetName> = new Set<SheetName>([
  'tiles',
]);
export const SHEET_NAMES: readonly SheetName[] = [
  'tiles',
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
  /** Frames per row; absent means all frames in one row. */
  columns?: number;
  autotile?: 'blob47';
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
  /** Empty pixels between sprites on free-form sheets (grid sheets have none). */
  gutter: number;
  filter: 'nearest';
  /** `grid` is the cell size of a sheet whose sprites all sit on that grid. */
  sheets: Record<string, { file: string; w: number; h: number; grid?: number }>;
  autotile: {
    blob47: { bits: Record<string, number>; masks: number[] };
  };
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
    const grid = GRID_SHEETS.has(sheetName);
    const placed: { def: SpriteDef; x: number; y: number }[] = [];
    // Shelf packing in definition order. Grid sheets pack whole cells with no
    // gutter; free-form sheets keep GUTTER pixels between sprites.
    const gap = grid ? 0 : GUTTER;
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const def of list) {
      if (seen.has(def.name)) throw new Error(`duplicate sprite ${def.name}`);
      seen.add(def.name);
      const first = def.frames[0];
      if (!first) throw new Error(`no frames: ${def.name}`);
      if (grid && (first.w % TILE !== 0 || first.h % TILE !== 0))
        throw new Error(`${def.name} is not a multiple of ${String(TILE)} px`);
      const cols = def.columns ?? def.frames.length;
      const rows = Math.ceil(def.frames.length / cols);
      const w = first.w * cols;
      const h = first.h * rows;
      if (w > SHEET_WIDTH) throw new Error(`${def.name} is wider than a sheet`);
      if (x > 0 && x + w > SHEET_WIDTH) {
        x = 0;
        y += rowH + gap;
        rowH = 0;
      }
      placed.push({ def, x, y });
      x += w + gap;
      rowH = Math.max(rowH, h);
    }
    const height = grid ? y + rowH : Math.ceil((y + rowH) / 4) * 4;
    const sheet = new Pix(SHEET_WIDTH, height);
    for (const { def, x: px, y: py } of placed) {
      const first = def.frames[0] as Pix;
      const cols = def.columns ?? def.frames.length;
      def.frames.forEach((f, i) => {
        sheet.blit(f, px + (i % cols) * f.w, py + Math.floor(i / cols) * f.h);
      });
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
      if (def.columns !== undefined) entry.columns = def.columns;
      if (def.autotile) entry.autotile = def.autotile;
      if (def.id !== undefined) entry.id = def.id;
      if (def.planned) entry.planned = true;
      if (def.nineSlice)
        entry.nineSlice = [...def.nineSlice] as [
          number,
          number,
          number,
          number,
        ];
      if (def.tintable) entry.tintable = true;
      if (def.note) entry.note = def.note;
      sprites[def.name] = entry;
    }
    sheets[sheetName] = {
      file: `${sheetName}.png`,
      w: SHEET_WIDTH,
      h: height,
      ...(grid ? { grid: TILE } : {}),
    };
    pngs.set(`${sheetName}.png`, encodePng(SHEET_WIDTH, height, sheet.data));
  }
  const atlas: Atlas = {
    version: 1,
    tile: TILE,
    gutter: GUTTER,
    filter: 'nearest',
    sheets,
    autotile: {
      blob47: {
        bits: { N, NE, E, SE, S, SW, W, NW },
        masks: [...BLOB47],
      },
    },
    palette: PALETTE.map((p) => ({ key: p.key, name: p.name, hex: p.hex })),
    tint: {
      keys: [...TINT_KEYS],
      neutral: [...TINT_NEUTRAL],
      teamA: [...TEAM_A],
      teamB: [...TEAM_B],
      resources: resourceRamps,
    },
    sprites,
    planned: [
      ...new Set(defs.filter((d) => d.planned).map((d) => d.id ?? d.name)),
    ],
  };
  return { atlas, pngs };
}
