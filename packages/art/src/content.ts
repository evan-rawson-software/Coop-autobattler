/** The few content facts the generator and its tests need. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, 'content', file), 'utf8'));
}

export interface BuildingInfo {
  id: string;
  kind: string;
  width: number;
  height: number;
  routeType?: string;
  defenseType?: string;
  effectType?: string;
  /** Footprint cell mask `[x, y]` (y up), when the footprint is not a full box. */
  cells?: [number, number][];
}
export interface ResourceInfo {
  id: string;
  color: string;
}

interface RawBuilding {
  id: string;
  kind: string;
  routeType?: string;
  defenseType?: string;
  effect?: { type: string };
  footprint: {
    width: number;
    height: number;
    cells?: [number, number][];
  };
}

export function loadBuildings(): BuildingInfo[] {
  const raw = readJson('buildings.json') as { buildings: RawBuilding[] };
  return raw.buildings.map((b) => {
    const info: BuildingInfo = {
      id: b.id,
      kind: b.kind,
      width: b.footprint.width,
      height: b.footprint.height,
    };
    if (b.footprint.cells) info.cells = b.footprint.cells;
    if (b.routeType) info.routeType = b.routeType;
    if (b.defenseType) info.defenseType = b.defenseType;
    if (b.effect) info.effectType = b.effect.type;
    return info;
  });
}

export function loadUnitIds(): string[] {
  const raw = readJson('units.json') as { units: { id: string }[] };
  return raw.units.map((u) => u.id);
}

export function loadTerrainIds(): string[] {
  const raw = readJson('terrain.json') as { features: { id: string }[] };
  return raw.features.map((f) => f.id);
}

export function loadResources(): ResourceInfo[] {
  const raw = readJson('resources.json') as { resources: ResourceInfo[] };
  return raw.resources.map((r) => ({ id: r.id, color: r.color }));
}

export function loadEventTypes(): string[] {
  const raw = readJson('events.json') as { events: { type: string }[] };
  return [...new Set(raw.events.map((e) => e.type))];
}
