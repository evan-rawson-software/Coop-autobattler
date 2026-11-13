/** `pnpm art:build`: regenerate assets/sprites/. Output is deterministic. */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildSheets, type Built } from './atlas.js';
import { decodePng, encodePng } from './png.js';
import {
  loadBuildings,
  loadResources,
  loadUnitIds,
  repoRoot,
  type BuildingInfo,
} from './content.js';
import { rampFromColor } from './palette.js';
import type { SpriteDef } from './model.js';
import { buildingSprites } from './sprites/buildings.js';
import { effectSprites } from './sprites/effects.js';
import { terrainSprites } from './sprites/terrain.js';
import { uiSprites } from './sprites/ui.js';
import { unitSprites } from './sprites/units.js';

export const outDir = path.join(repoRoot, 'assets', 'sprites');

/** The content facts the generator reads; tests inject their own. */
export interface ContentLists {
  units: readonly string[];
  buildings: readonly BuildingInfo[];
}

export function allSprites(
  content: ContentLists = {
    units: loadUnitIds(),
    buildings: loadBuildings(),
  },
): SpriteDef[] {
  return [
    ...terrainSprites(),
    ...buildingSprites(content.buildings),
    ...unitSprites(content.units),
    ...effectSprites(),
    ...uiSprites(),
  ];
}

export function buildAll(content?: ContentLists): {
  built: Built;
  atlasJson: string;
} {
  const ramps: Record<string, string[]> = {};
  for (const r of loadResources()) ramps[r.id] = rampFromColor(r.color);
  const built = buildSheets(allSprites(content), ramps);
  return { built, atlasJson: JSON.stringify(built.atlas, null, 2) + '\n' };
}

export const faviconPath = path.join(
  repoRoot,
  'packages',
  'web',
  'public',
  'favicon.png',
);

const FAVICON_SIZE = 32;

/** A 32x32 PNG of the Core building sprite, scaled up by an integer if smaller. */
export function buildFavicon(built: Built): Buffer {
  const sp = built.atlas.sprites['bld_core'];
  if (!sp) throw new Error('bld_core is missing from the atlas');
  const sheet = built.pngs.get(built.atlas.sheets[sp.sheet]?.file ?? '');
  if (!sheet) throw new Error(`sheet ${sp.sheet} is missing`);
  const src = decodePng(sheet);
  const k = Math.max(1, Math.floor(FAVICON_SIZE / Math.max(sp.w, sp.h)));
  const out = new Uint8Array(FAVICON_SIZE * FAVICON_SIZE * 4);
  const ox = Math.floor((FAVICON_SIZE - sp.w * k) / 2);
  const oy = Math.floor((FAVICON_SIZE - sp.h * k) / 2);
  for (let y = 0; y < sp.h * k; y++)
    for (let x = 0; x < sp.w * k; x++) {
      const i =
        ((sp.y + Math.floor(y / k)) * src.w + sp.x + Math.floor(x / k)) * 4;
      const o = ((oy + y) * FAVICON_SIZE + ox + x) * 4;
      out.set(src.rgba.subarray(i, i + 4), o);
    }
  return encodePng(FAVICON_SIZE, FAVICON_SIZE, out);
}

export function writeAll(): void {
  const { built, atlasJson } = buildAll();
  mkdirSync(outDir, { recursive: true });
  for (const [file, buf] of built.pngs)
    writeFileSync(path.join(outDir, file), buf);
  writeFileSync(path.join(outDir, 'atlas.json'), atlasJson);
  mkdirSync(path.dirname(faviconPath), { recursive: true });
  writeFileSync(faviconPath, buildFavicon(built));
  const n = Object.keys(built.atlas.sprites).length;
  console.log(
    `wrote ${String(built.pngs.size)} sheets and an atlas with ${String(n)} sprites to ${outDir}`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])))
  writeAll();
