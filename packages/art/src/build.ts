/** `pnpm art:build`: regenerate assets/sprites/. Output is deterministic. */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildSheets, type Built } from './atlas.js';
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

export function writeAll(): void {
  const { built, atlasJson } = buildAll();
  mkdirSync(outDir, { recursive: true });
  for (const [file, buf] of built.pngs)
    writeFileSync(path.join(outDir, file), buf);
  writeFileSync(path.join(outDir, 'atlas.json'), atlasJson);
  const n = Object.keys(built.atlas.sprites).length;
  console.log(
    `wrote ${String(built.pngs.size)} sheets and an atlas with ${String(n)} sprites to ${outDir}`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])))
  writeAll();
