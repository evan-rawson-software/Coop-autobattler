/**
 * Map generation (W1-1). The algorithm is specified step by step in
 * docs/rules-reference.md ("Map generation"); keep the two in sync.
 */

import { sortedIntEntries } from './collections.js';
import {
  compareCells,
  listLegalCorePositions,
  queryMap,
  type FeatureCell,
  type GameMap,
  type MapContent,
  type ResourceNode,
} from './map.js';
import type { MapgenConfig } from './mapgen.js';
import { Rng } from './rng.js';

/** Direction steps used by lake growth and cliffs, in fixed order. */
const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface GeneratedMap {
  readonly map: GameMap;
  /** Attempts used; 1 means the first attempt was accepted. */
  readonly attempts: number;
}

interface Region {
  xLo: number;
  xHi: number;
  yLo: number;
  yHi: number;
}

class AttemptFailed extends Error {}

function fail(why: string): never {
  throw new AttemptFailed(why);
}

/** Draw an integer in [min, max]; always consumes one `nextInt`. */
function between(rng: Rng, min: number, max: number): number {
  return min + rng.nextInt(max - min + 1);
}

interface Board {
  readonly config: MapgenConfig;
  readonly width: number;
  readonly height: number;
  readonly features: Map<number, string>;
  readonly nodes: Map<number, string>;
}

const key = (b: Board, x: number, y: number): number => y * b.width + x;

function placeLakes(b: Board, rng: Rng, region: Region): void {
  const c = b.config.lakes;
  const count = between(rng, c.countMin, c.countMax);
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let t = 0; t < b.config.placementTries && !placed; t++) {
      const size = between(rng, c.sizeMin, c.sizeMax);
      const sx = between(rng, region.xLo, region.xHi);
      const sy = between(rng, region.yLo, region.yHi);
      if (b.features.has(key(b, sx, sy))) continue;
      const cells: [number, number][] = [[sx, sy]];
      const inLake = new Set<number>([key(b, sx, sy)]);
      let stuck = false;
      while (cells.length < size) {
        const candidates: [number, number][] = [];
        const seen = new Set<number>();
        for (const [cx, cy] of cells) {
          for (const [dx, dy] of DIRS) {
            const nx = cx + dx;
            const ny = cy + dy;
            const k = key(b, nx, ny);
            if (
              nx < region.xLo ||
              nx > region.xHi ||
              ny < region.yLo ||
              ny > region.yHi ||
              b.features.has(k) ||
              inLake.has(k) ||
              seen.has(k)
            ) {
              continue;
            }
            seen.add(k);
            candidates.push([nx, ny]);
          }
        }
        if (candidates.length === 0) {
          stuck = true;
          break;
        }
        const pick = candidates[rng.nextInt(candidates.length)] as [
          number,
          number,
        ];
        cells.push(pick);
        inLake.add(key(b, pick[0], pick[1]));
      }
      if (stuck) continue;
      for (const [cx, cy] of cells) b.features.set(key(b, cx, cy), c.feature);
      placed = true;
    }
    if (!placed) fail('could not place a lake');
  }
}

function placeCliffs(b: Board, rng: Rng, region: Region): void {
  const c = b.config.cliffs;
  const count = between(rng, c.countMin, c.countMax);
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let t = 0; t < b.config.placementTries && !placed; t++) {
      const length = between(rng, c.lengthMin, c.lengthMax);
      const bend = rng.nextInt(2);
      const d1 = rng.nextInt(4);
      const sx = between(rng, region.xLo, region.xHi);
      const sy = between(rng, region.yLo, region.yHi);
      const firstLen = 1 + rng.nextInt(length - 1);
      const perp = rng.nextInt(2);
      const [dx1, dy1] = DIRS[d1] as readonly [number, number];
      const [dx2, dy2] = DIRS[(d1 + (perp === 0 ? 1 : 3)) % 4] as readonly [
        number,
        number,
      ];
      const cells: [number, number][] = [];
      const straightLen = bend === 0 ? length : firstLen;
      for (let k = 0; k < straightLen; k++) {
        cells.push([sx + k * dx1, sy + k * dy1]);
      }
      if (bend === 1) {
        const lx = sx + (firstLen - 1) * dx1;
        const ly = sy + (firstLen - 1) * dy1;
        for (let k = 1; k <= length - firstLen; k++) {
          cells.push([lx + k * dx2, ly + k * dy2]);
        }
      }
      const ok = cells.every(
        ([x, y]) =>
          x >= region.xLo &&
          x <= region.xHi &&
          y >= region.yLo &&
          y <= region.yHi &&
          !b.features.has(key(b, x, y)),
      );
      if (!ok) continue;
      for (const [x, y] of cells) b.features.set(key(b, x, y), c.feature);
      placed = true;
    }
    if (!placed) fail('could not place a cliff');
  }
}

function placeNodes(b: Board, rng: Rng, content: MapContent, x0: number): void {
  const { common, rare } = b.config.nodesPerPlot;
  for (const res of content.resources.listBase()) {
    const n = res.rarity === 'rare' ? rare : common;
    for (let i = 0; i < n; i++) {
      const candidates: number[] = [];
      for (let y = 0; y < b.height; y++) {
        for (let x = x0; x < x0 + b.config.plotWidth; x++) {
          if (b.features.has(key(b, x, y))) continue;
          const crowded =
            b.nodes.has(key(b, x, y)) ||
            (x > 0 && b.nodes.has(key(b, x - 1, y))) ||
            (x < b.width - 1 && b.nodes.has(key(b, x + 1, y))) ||
            (y > 0 && b.nodes.has(key(b, x, y - 1))) ||
            (y < b.height - 1 && b.nodes.has(key(b, x, y + 1)));
          if (!crowded) candidates.push(key(b, x, y));
        }
      }
      if (candidates.length === 0) fail('no room for a resource node');
      const pick = candidates[rng.nextInt(candidates.length)] as number;
      b.nodes.set(pick, res.id);
    }
  }
}

function attempt(
  rootRng: Rng,
  attemptIndex: number,
  partySize: number,
  content: MapContent,
  config: MapgenConfig,
): GameMap {
  const width = partySize * config.plotWidth;
  const height = config.plotDepth;
  const b: Board = {
    config,
    width,
    height,
    features: new Map(),
    nodes: new Map(),
  };
  const attemptRng = rootRng.child(attemptIndex);
  for (let p = 0; p < partySize; p++) {
    const plotRng = attemptRng.child(p);
    const x0 = p * config.plotWidth;
    const region: Region = {
      xLo: Math.max(x0, config.sideMargin),
      xHi: Math.min(x0 + config.plotWidth - 1, width - 1 - config.sideMargin),
      yLo: config.backMargin,
      yHi: height - 1 - config.frontMargin,
    };
    placeLakes(b, plotRng.child('lakes'), region);
    placeCliffs(b, plotRng.child('cliffs'), region);
    placeNodes(b, plotRng.child('nodes'), content, x0);
  }

  const features: FeatureCell[] = [];
  for (const [k, feature] of sortedIntEntries(b.features)) {
    features.push({ x: k % width, y: Math.floor(k / width), feature });
  }
  features.sort(compareCells);
  const nodes: ResourceNode[] = [];
  for (const [k, resource] of sortedIntEntries(b.nodes)) {
    nodes.push({ x: k % width, y: Math.floor(k / width), resource });
  }
  nodes.sort(compareCells);
  const map: GameMap = {
    width,
    height,
    partySize,
    plotWidth: config.plotWidth,
    features,
    nodes,
  };
  const problem = checkFairness(map, content, config);
  if (problem !== undefined) fail(problem);
  return map;
}

/** Returns a description of the first violated constraint, or undefined. */
function checkFairness(
  map: GameMap,
  content: MapContent,
  config: MapgenConfig,
): string | undefined {
  const q = queryMap(map, content.terrain);
  const { width, height } = map;
  // Buildable share per plot.
  for (let p = 0; p < map.partySize; p++) {
    let buildable = 0;
    for (let y = 0; y < height; y++) {
      for (let x = p * map.plotWidth; x < (p + 1) * map.plotWidth; x++) {
        if (q.isBuildable(x, y)) buildable++;
      }
    }
    if (buildable * 100 < config.minBuildablePercent * map.plotWidth * height) {
      return `plot ${String(p)} has too little buildable ground`;
    }
  }
  // Every walkable cell reachable from the front row.
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  let walkable = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (q.isWalkable(x, y)) walkable++;
  }
  for (let x = 0; x < width; x++) {
    if (q.isWalkable(x, height - 1)) {
      seen[(height - 1) * width + x] = 1;
      stack.push((height - 1) * width + x);
    }
  }
  let reached = 0;
  for (let k = stack.pop(); k !== undefined; k = stack.pop()) {
    reached++;
    const x = k % width;
    const y = Math.floor(k / width);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!q.isWalkable(nx, ny)) continue;
      const nk = ny * width + nx;
      if (seen[nk] === 1) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  if (reached !== walkable) return 'a walkable cell is cut off from the front';
  // PP-15: inside every plot, every walkable cell of the plot is reachable
  // from that plot's own front row through cells of that plot only.
  for (let p = 0; p < map.partySize; p++) {
    const x0 = p * map.plotWidth;
    const x1 = x0 + map.plotWidth;
    const inPlot = new Uint8Array(width * height);
    const todo: number[] = [];
    let cells = 0;
    for (let y = 0; y < height; y++) {
      for (let x = x0; x < x1; x++) if (q.isWalkable(x, y)) cells++;
    }
    for (let x = x0; x < x1; x++) {
      if (q.isWalkable(x, height - 1)) {
        inPlot[(height - 1) * width + x] = 1;
        todo.push((height - 1) * width + x);
      }
    }
    let count = 0;
    for (let k = todo.pop(); k !== undefined; k = todo.pop()) {
      count++;
      const x = k % width;
      const y = Math.floor(k / width);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < x0 || nx >= x1 || !q.isWalkable(nx, ny)) continue;
        const nk = ny * width + nx;
        if (inPlot[nk] === 1) continue;
        inPlot[nk] = 1;
        todo.push(nk);
      }
    }
    if (count !== cells) {
      return `a walkable cell of plot ${String(p)} is cut off from that plot's front`;
    }
  }
  // A legal Core position inside every plot.
  for (let p = 0; p < map.partySize; p++) {
    if (listLegalCorePositions(map, content, config, p).length === 0) {
      return `plot ${String(p)} has no legal Core position`;
    }
  }
  return undefined;
}

/**
 * Generate a board. Deterministic in all arguments. Retries with a new child
 * stream per attempt; throws if `config.maxAttempts` attempts all fail.
 */
export function generateMapWithStats(
  seed: number,
  partySize: number,
  content: MapContent,
  config: MapgenConfig,
): GeneratedMap {
  if (
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > config.maxPartySize
  ) {
    throw new RangeError(
      `partySize must be an integer from 1 to ${String(config.maxPartySize)}, got ${String(partySize)}`,
    );
  }
  const root = Rng.fromSeed(seed);
  let last = 'no attempt made';
  for (let a = 0; a < config.maxAttempts; a++) {
    try {
      return {
        map: attempt(root, a, partySize, content, config),
        attempts: a + 1,
      };
    } catch (error) {
      if (!(error instanceof AttemptFailed)) throw error;
      last = error.message;
    }
  }
  throw new Error(
    `generateMap: no valid map for seed ${String(seed)}, party size ${String(partySize)} after ${String(config.maxAttempts)} attempts (last failure: ${last})`,
  );
}

/** Generate a board; see `generateMapWithStats`. */
export function generateMap(
  seed: number,
  partySize: number,
  content: MapContent,
  config: MapgenConfig,
): GameMap {
  return generateMapWithStats(seed, partySize, content, config).map;
}
