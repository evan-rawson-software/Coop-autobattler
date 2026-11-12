/**
 * The game board (W1-1): data format, validating loader, queries, Core
 * placement rules and an ASCII renderer.
 *
 * Coordinates: cells are `(x, y)`. `x` runs along the front edge, 0 to
 * `width - 1`. `y` is depth: `y = 0` is the back row, `y = height - 1` is the
 * front row (the one facing the enemy). Movement and adjacency are 4-way.
 */

import type { BuildingConfig, Footprint } from './buildings.js';
import { divFloor } from './int.js';
import {
  isRecord,
  readInt,
  rejectUnknownKeys,
  show,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';
import type { MapgenConfig } from './mapgen.js';
import type { ResourceConfig, ResourceId } from './resources.js';
import type { TerrainConfig, TerrainFeatureId } from './terrain.js';

/** A cell blocked by a natural feature. */
export type FeatureCell = {
  readonly x: number;
  readonly y: number;
  readonly feature: TerrainFeatureId;
};

/** A single-cell resource node. */
export type ResourceNode = {
  readonly x: number;
  readonly y: number;
  readonly resource: ResourceId;
};

/**
 * Plain JSON. `features` lists every cell with a natural feature, and
 * `nodes` every resource node, both sorted by `(y, x)`. Cells not listed are
 * open ground.
 */
export type GameMap = {
  readonly width: number;
  readonly height: number;
  readonly partySize: number;
  readonly plotWidth: number;
  readonly features: readonly FeatureCell[];
  readonly nodes: readonly ResourceNode[];
};

/** What the map code needs from the loaded content. */
export interface MapContent {
  readonly resources: ResourceConfig;
  readonly terrain: TerrainConfig;
  readonly buildings: BuildingConfig;
}

export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** Compare two cells by `(y, x)`. */
export function compareCells(a: Cell, b: Cell): number {
  return a.y - b.y || a.x - b.x;
}

// ---------------------------------------------------------------------------
// Queries

export interface MapQuery {
  readonly map: GameMap;
  isInBounds(x: number, y: number): boolean;
  /** The feature on a cell, or undefined for open ground. */
  featureAt(x: number, y: number): TerrainFeatureId | undefined;
  /** The resource of a node on a cell, if any. */
  nodeAt(x: number, y: number): ResourceId | undefined;
  /** No building-blocking feature (a node cell is buildable). */
  isBuildable(x: number, y: number): boolean;
  /** In bounds and not blocked by a movement-blocking feature. */
  isWalkable(x: number, y: number): boolean;
  /** Index of the plot (0-based, left to right) that column `x` belongs to. */
  plotOf(x: number): number;
}

/** Index the map once for fast queries. Throws on an unknown feature ID. */
export function queryMap(map: GameMap, terrain: TerrainConfig): MapQuery {
  const features = new Map<number, TerrainFeatureId>();
  const nodes = new Map<number, ResourceId>();
  const { width, height, plotWidth } = map;
  for (const f of map.features) features.set(f.y * width + f.x, f.feature);
  for (const n of map.nodes) nodes.set(n.y * width + n.x, n.resource);
  const inBounds = (x: number, y: number): boolean =>
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height;
  const defAt = (x: number, y: number) => {
    const id = features.get(y * width + x);
    if (id === undefined) return undefined;
    const def = terrain.get(id);
    if (def === undefined) throw new Error(`Unknown terrain feature "${id}"`);
    return def;
  };
  return {
    map,
    isInBounds: inBounds,
    featureAt: (x, y) =>
      inBounds(x, y) ? features.get(y * width + x) : undefined,
    nodeAt: (x, y) => (inBounds(x, y) ? nodes.get(y * width + x) : undefined),
    isBuildable: (x, y) =>
      inBounds(x, y) && !(defAt(x, y)?.blocksBuilding ?? false),
    isWalkable: (x, y) =>
      inBounds(x, y) && !(defAt(x, y)?.blocksMovement ?? false),
    plotOf: (x) => divFloor(x, plotWidth),
  };
}

// ---------------------------------------------------------------------------
// Core placement

export type CorePositionProblem =
  | 'out_of_bounds'
  | 'outside_own_plot'
  | 'blocked'
  | 'on_node'
  | 'too_far_forward';

export type CorePositionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CorePositionProblem };

/** The footprint of the building of kind `core`. Throws if there is none. */
export function coreFootprint(buildings: BuildingConfig): Footprint {
  const core = buildings.list().find((b) => b.kind === 'core');
  if (core === undefined) throw new Error('No building of kind "core".');
  return core.footprint;
}

function checkCore(
  q: MapQuery,
  fp: Footprint,
  config: MapgenConfig,
  player: number,
  x: number,
  y: number,
): CorePositionResult {
  const { width, height } = q.map;
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x + fp.width > width ||
    y + fp.height > height
  ) {
    return { ok: false, reason: 'out_of_bounds' };
  }
  if (q.plotOf(x) !== player || q.plotOf(x + fp.width - 1) !== player) {
    return { ok: false, reason: 'outside_own_plot' };
  }
  for (let dy = 0; dy < fp.height; dy++) {
    for (let dx = 0; dx < fp.width; dx++) {
      if (!q.isBuildable(x + dx, y + dy))
        return { ok: false, reason: 'blocked' };
    }
  }
  for (let dy = 0; dy < fp.height; dy++) {
    for (let dx = 0; dx < fp.width; dx++) {
      if (q.nodeAt(x + dx, y + dy) !== undefined) {
        return { ok: false, reason: 'on_node' };
      }
    }
  }
  if (y + fp.height > height - config.coreFrontClearance) {
    return { ok: false, reason: 'too_far_forward' };
  }
  return { ok: true };
}

/**
 * Whether player `player`'s Core may stand with its lowest-x, lowest-y
 * footprint cell at `position` (PP-2). Checks in this order: out_of_bounds,
 * outside_own_plot, blocked, on_node, too_far_forward.
 */
export function validateCorePosition(
  map: GameMap,
  content: MapContent,
  config: MapgenConfig,
  player: number,
  position: Cell,
): CorePositionResult {
  return checkCore(
    queryMap(map, content.terrain),
    coreFootprint(content.buildings),
    config,
    player,
    position.x,
    position.y,
  );
}

/** Every legal Core position in player `player`'s plot, sorted by `(y, x)`. */
export function listLegalCorePositions(
  map: GameMap,
  content: MapContent,
  config: MapgenConfig,
  player: number,
): Cell[] {
  const q = queryMap(map, content.terrain);
  const fp = coreFootprint(content.buildings);
  const out: Cell[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (checkCore(q, fp, config, player, x, y).ok) out.push({ x, y });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loader

export type MapLoadResult = LoadResult<GameMap>;

const MAP_KEYS = new Set([
  '$schema',
  'width',
  'height',
  'partySize',
  'plotWidth',
  'features',
  'nodes',
]);

/** Validate parsed map data (structure and references, not fairness). */
export function loadMap(
  data: unknown,
  content: Pick<MapContent, 'resources' | 'terrain'>,
): MapLoadResult {
  if (!isRecord(data)) return { ok: false, errors: ['Map must be an object.'] };
  const errors: string[] = [];
  rejectUnknownKeys(data, MAP_KEYS, 'map', errors);
  const width = readInt(data, 'width', 1, 'map', errors);
  const height = readInt(data, 'height', 1, 'map', errors);
  const partySize = readInt(data, 'partySize', 1, 'map', errors);
  const plotWidth = readInt(data, 'plotWidth', 1, 'map', errors);
  if (
    width !== undefined &&
    partySize !== undefined &&
    plotWidth !== undefined &&
    width !== partySize * plotWidth
  ) {
    errors.push('map: "width" must equal "partySize" * "plotWidth".');
  }

  const cellList = (
    key: string,
    valueKey: string,
    known: (id: string) => boolean,
    what: string,
  ): { x: number; y: number; value: string }[] => {
    const list = data[key];
    if (!Array.isArray(list)) {
      errors.push(`map: "${key}" must be an array.`);
      return [];
    }
    const out: { x: number; y: number; value: string }[] = [];
    const seen = new Set<string>();
    let prev: { x: number; y: number } | undefined;
    (list as unknown[]).forEach((entry, i) => {
      const at = `${key}[${String(i)}]`;
      if (!isRecord(entry)) {
        errors.push(`${at}: must be an object.`);
        return;
      }
      rejectUnknownKeys(entry, new Set(['x', 'y', valueKey]), at, errors);
      const x = readInt(entry, 'x', 0, at, errors);
      const y = readInt(entry, 'y', 0, at, errors);
      const value = entry[valueKey];
      if (typeof value !== 'string' || !known(value)) {
        errors.push(`${at}: unknown ${what} ${show(value)}.`);
      }
      if (x === undefined || y === undefined || typeof value !== 'string')
        return;
      if (
        width !== undefined &&
        height !== undefined &&
        (x >= width || y >= height)
      ) {
        errors.push(
          `${at}: (${String(x)}, ${String(y)}) is outside the board.`,
        );
      }
      const k = `${String(x)},${String(y)}`;
      if (seen.has(k)) errors.push(`${at}: duplicate cell (${k}).`);
      else if (prev !== undefined && compareCells(prev, { x, y }) > 0) {
        errors.push(`${at}: not sorted by (y, x).`);
      }
      seen.add(k);
      prev = { x, y };
      out.push({ x, y, value });
    });
    return out;
  };

  const features = cellList(
    'features',
    'feature',
    (id) => content.terrain.get(id) !== undefined,
    'feature',
  );
  const nodes = cellList(
    'nodes',
    'resource',
    (id) => content.resources.get(id) !== undefined,
    'resource',
  );
  const featureKeys = new Set(
    features.map((f) => `${String(f.x)},${String(f.y)}`),
  );
  for (const n of nodes) {
    if (featureKeys.has(`${String(n.x)},${String(n.y)}`)) {
      errors.push(
        `nodes: (${String(n.x)}, ${String(n.y)}) is on a feature cell.`,
      );
    }
  }

  if (
    errors.length > 0 ||
    width === undefined ||
    height === undefined ||
    partySize === undefined ||
    plotWidth === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    config: {
      width,
      height,
      partySize,
      plotWidth,
      features: features.map((f) => ({ x: f.x, y: f.y, feature: f.value })),
      nodes: nodes.map((n) => ({ x: n.x, y: n.y, resource: n.value })),
    },
  };
}

/** Like loadMap, but throws one Error listing every problem. */
export function loadMapOrThrow(
  data: unknown,
  content: Pick<MapContent, 'resources' | 'terrain'>,
): GameMap {
  return unwrapOrThrow('map', loadMap(data, content));
}

// ---------------------------------------------------------------------------
// ASCII renderer

const FEATURE_CHARS: Readonly<Record<string, string>> = {
  ter_lake: '~',
  ter_cliff: '#',
};

function resourceLetter(index: number): string {
  return index < 26 ? String.fromCharCode(97 + index) : '*';
}

/**
 * One character per cell, front row (`y = height - 1`) first so the enemy is
 * above: `.` open, `~` lake, `#` cliff (`?` any other feature), and a letter
 * per resource node: `a` for the first resource in the resource list, `b` for
 * the second, and so on. The last line is a legend.
 */
export function renderMapAscii(map: GameMap, content: MapContent): string {
  const resourceIds = content.resources.list().map((r) => r.id);
  const grid: string[][] = [];
  for (let y = 0; y < map.height; y++) {
    grid.push(new Array<string>(map.width).fill('.'));
  }
  const put = (x: number, y: number, ch: string): void => {
    const row = grid[y];
    if (row !== undefined && x >= 0 && x < map.width) row[x] = ch;
  };
  for (const f of map.features) put(f.x, f.y, FEATURE_CHARS[f.feature] ?? '?');
  for (const n of map.nodes) {
    put(n.x, n.y, resourceLetter(resourceIds.indexOf(n.resource)));
  }
  const lines: string[] = [];
  for (let y = map.height - 1; y >= 0; y--)
    lines.push((grid[y] ?? []).join(''));
  const letters = resourceIds.map((id, i) => `${resourceLetter(i)}=${id}`);
  lines.push(
    `legend: .=open ~=lake #=cliff ${letters.join(' ')} (front row on top)`,
  );
  return lines.join('\n');
}
