/**
 * The neutral zone (W1-8, CB-8, CB-8a, TA-41a): a few rows of ground between
 * the two boards of a battle, with lakes and cliffs that differ every battle.
 * The algorithm is specified in docs/rules-reference.md ("The neutral zone");
 * keep the two in sync.
 */

import { sortedIntEntries } from './collections.js';
import type { Json } from './hash.js';
import { hashJson } from './hash.js';
import type { SimulationFn } from './golden-kinds.js';
import type { Cell, FeatureCell } from './map.js';
import type { MapgenConfig } from './mapgen.js';
import { Rng } from './rng.js';
import type { TerrainConfig } from './terrain.js';

/**
 * A neutral zone as plain JSON. Zone-local coordinates: `x` along the front
 * edge, `y = 0` the row touching side 0's front edge, `y = depth - 1` the row
 * touching side 1's front edge. `features` is sorted by `(y, x)`.
 * `pointsOfInterest` is always empty for now (TA-41a: reserved so the format
 * does not change when they are added).
 */
export interface NeutralZone {
  readonly width: number;
  readonly depth: number;
  readonly features: readonly FeatureCell[];
  readonly pointsOfInterest: readonly Json[];
}

/** What the generator needs from the loaded content. */
export interface NeutralZoneContent {
  readonly terrain: TerrainConfig;
}

export interface GeneratedNeutralZone {
  readonly zone: NeutralZone;
  /** Attempts used; 1 means the first attempt was accepted. */
  readonly attempts: number;
}

/** Child-stream label of the zone under the battle seed's root generator. */
export const NEUTRAL_ZONE_STREAM = 'neutral-zone';

const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Draw an integer in [min, max]; always consumes one `nextInt`. */
function between(rng: Rng, min: number, max: number): number {
  return min + rng.nextInt(max - min + 1);
}

interface Region {
  xLo: number;
  xHi: number;
  yLo: number;
  yHi: number;
}

interface Grid {
  readonly width: number;
  readonly depth: number;
  /** Cell index `y * width + x` -> feature ID. */
  readonly features: Map<number, string>;
}

/** Place the lakes; returns why it failed, or null. */
function placeLakes(
  g: Grid,
  rng: Rng,
  region: Region,
  count: number,
  config: MapgenConfig,
  feature: string,
): string | null {
  const c = config.neutralZone.lakes;
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let t = 0; t < config.placementTries && !placed; t++) {
      const size = between(rng, c.sizeMin, c.sizeMax);
      const sx = between(rng, region.xLo, region.xHi);
      const sy = between(rng, region.yLo, region.yHi);
      if (g.features.has(sy * g.width + sx)) continue;
      const cells: [number, number][] = [[sx, sy]];
      const inLake = new Set<number>([sy * g.width + sx]);
      let stuck = false;
      while (cells.length < size) {
        const candidates: [number, number][] = [];
        const seen = new Set<number>();
        for (const [cx, cy] of cells) {
          for (const [dx, dy] of DIRS) {
            const nx = cx + dx;
            const ny = cy + dy;
            const k = ny * g.width + nx;
            if (
              nx < region.xLo ||
              nx > region.xHi ||
              ny < region.yLo ||
              ny > region.yHi ||
              g.features.has(k) ||
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
        inLake.add(pick[1] * g.width + pick[0]);
      }
      if (stuck) continue;
      for (const [cx, cy] of cells) g.features.set(cy * g.width + cx, feature);
      placed = true;
    }
    if (!placed) return 'could not place a lake';
  }
  return null;
}

/** Place the cliffs; returns why it failed, or null. */
function placeCliffs(
  g: Grid,
  rng: Rng,
  region: Region,
  count: number,
  config: MapgenConfig,
  feature: string,
): string | null {
  const c = config.neutralZone.cliffs;
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let t = 0; t < config.placementTries && !placed; t++) {
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
          !g.features.has(y * g.width + x),
      );
      if (!ok) continue;
      for (const [x, y] of cells) g.features.set(y * g.width + x, feature);
      placed = true;
    }
    if (!placed) return 'could not place a cliff';
  }
  return null;
}

/** True when `blocked(x, y)` leaves every open cell 4-connected. */
function openCellsConnected(
  width: number,
  depth: number,
  blocked: (x: number, y: number) => boolean,
): boolean {
  const seen = new Uint8Array(width * depth);
  const stack: number[] = [];
  let open = 0;
  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      if (blocked(x, y)) continue;
      open++;
      if (stack.length === 0) {
        seen[y * width + x] = 1;
        stack.push(y * width + x);
      }
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
      if (nx < 0 || ny < 0 || nx >= width || ny >= depth) continue;
      if (blocked(nx, ny)) continue;
      const nk = ny * width + nx;
      if (seen[nk] === 1) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  return reached === open;
}

/** One attempt: the zone, or why it failed (the reason is a string). */
function attempt(
  zoneRng: Rng,
  attemptIndex: number,
  width: number,
  plots: number,
  content: NeutralZoneContent,
  config: MapgenConfig,
): NeutralZone | string {
  const nz = config.neutralZone;
  const grid: Grid = { width, depth: nz.depth, features: new Map() };
  const attemptRng = zoneRng.child(attemptIndex);
  const region: Region = {
    xLo: 1,
    xHi: width - 2,
    yLo: 1,
    yHi: nz.depth - 2,
  };
  const lakesRng = attemptRng.child('lakes');
  const cliffsRng = attemptRng.child('cliffs');
  const room = region.xLo <= region.xHi && region.yLo <= region.yHi;
  // The counts are always drawn (one nextInt each); with no room for a
  // feature (zone narrower than 3 columns or shallower than 3 rows) none is
  // placed.
  const lakeCount = between(
    lakesRng,
    nz.lakes.countMinPerPlot * plots,
    nz.lakes.countMaxPerPlot * plots,
  );
  if (room) {
    const why = placeLakes(
      grid,
      lakesRng,
      region,
      lakeCount,
      config,
      config.lakes.feature,
    );
    if (why !== null) return why;
  }
  const cliffCount = between(
    cliffsRng,
    nz.cliffs.countMinPerPlot * plots,
    nz.cliffs.countMaxPerPlot * plots,
  );
  if (room) {
    const why = placeCliffs(
      grid,
      cliffsRng,
      region,
      cliffCount,
      config,
      config.cliffs.feature,
    );
    if (why !== null) return why;
  }

  const features: FeatureCell[] = [];
  for (const [k, feature] of sortedIntEntries(grid.features)) {
    features.push({ x: k % width, y: Math.floor(k / width), feature });
  }
  features.sort((p, q) => p.y - q.y || p.x - q.x);
  const blocked = (x: number, y: number): boolean => {
    const f = grid.features.get(y * width + x);
    return f !== undefined && content.terrain.get(f)?.blocksMovement === true;
  };
  if (!openCellsConnected(width, nz.depth, blocked)) {
    return 'the open cells of the zone are not connected';
  }
  return { width, depth: nz.depth, features, pointsOfInterest: [] };
}

/**
 * Generate the neutral zone of a battle. Deterministic in all arguments, and
 * (CB-8a) in the battle seed and the width only. Retries with a new child
 * stream per attempt; throws if `maxAttempts` attempts all fail.
 */
export function generateNeutralZoneWithStats(
  battleSeed: number,
  width: number,
  content: NeutralZoneContent,
  config: MapgenConfig,
): GeneratedNeutralZone {
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(
      `Neutral zone: width must be a positive integer, got ${String(width)}.`,
    );
  }
  // Plots of front width, rounded up (a hand-made board narrower than a plot
  // still counts as one).
  const plots = Math.ceil(width / config.plotWidth);
  const zoneRng = Rng.fromSeed(battleSeed).child(NEUTRAL_ZONE_STREAM);
  let last = 'no attempt made';
  for (let a = 0; a < config.neutralZone.maxAttempts; a++) {
    const zone = attempt(zoneRng, a, width, plots, content, config);
    if (typeof zone !== 'string') return { zone, attempts: a + 1 };
    last = zone;
  }
  throw new Error(
    `generateNeutralZone: no valid zone for seed ${String(battleSeed)}, width ${String(width)} after ${String(config.neutralZone.maxAttempts)} attempts (last failure: ${last})`,
  );
}

/** Generate the neutral zone of a battle; see `generateNeutralZoneWithStats`. */
export function generateNeutralZone(
  battleSeed: number,
  width: number,
  content: NeutralZoneContent,
  config: MapgenConfig,
): NeutralZone {
  return generateNeutralZoneWithStats(battleSeed, width, content, config).zone;
}

/**
 * The constraints of a zone, checked from scratch: returns a description of
 * the first violation, or undefined. Used by tests and to check a zone that is
 * handed in (the test-only option of `startBattle`).
 */
export function neutralZoneProblem(
  zone: NeutralZone,
  content: NeutralZoneContent,
): string | undefined {
  const { width, depth } = zone;
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(depth)) {
    return 'width and depth must be integers';
  }
  if (depth < 0) return 'depth must not be negative';
  const at = new Map<number, string>();
  let prev: FeatureCell | undefined;
  for (const f of zone.features) {
    if (
      !Number.isInteger(f.x) ||
      !Number.isInteger(f.y) ||
      f.x < 0 ||
      f.x >= width ||
      f.y < 0 ||
      f.y >= depth
    ) {
      return `feature at (${String(f.x)}, ${String(f.y)}) is outside the zone`;
    }
    if (content.terrain.get(f.feature) === undefined) {
      return `unknown feature "${f.feature}"`;
    }
    if (prev !== undefined && (f.y - prev.y || f.x - prev.x) <= 0) {
      return 'features are not sorted by (y, x) without repeats';
    }
    prev = f;
    at.set(f.y * width + f.x, f.feature);
    if (f.y === 0 || f.y === depth - 1) {
      return `feature at (${String(f.x)}, ${String(f.y)}) is in a front-edge row`;
    }
    if (f.x === 0 || f.x === width - 1) {
      return `feature at (${String(f.x)}, ${String(f.y)}) is in an edge column`;
    }
  }
  const blocked = (x: number, y: number): boolean => {
    const f = at.get(y * width + x);
    return f !== undefined && content.terrain.get(f)?.blocksMovement === true;
  };
  if (!openCellsConnected(width, depth, blocked)) {
    return 'the open cells are not connected';
  }
  return undefined;
}

/**
 * The zone's blocked cells (those with a `blocksMovement` feature) as arena
 * cells, for a board of `boardHeight` rows: zone row `y` is arena row
 * `boardHeight + y`.
 */
export function zoneBlockedCells(
  zone: NeutralZone,
  boardHeight: number,
  content: NeutralZoneContent,
): Cell[] {
  const out: Cell[] = [];
  for (const f of zone.features) {
    if (content.terrain.get(f.feature)?.blocksMovement === true) {
      out.push({ x: f.x, y: boardHeight + f.y });
    }
  }
  return out;
}

/** ASCII picture of a zone, `y = 0` (side 0's edge) first: `~` lake, `#` cliff, `?` other, `.` open. */
export function renderNeutralZoneAscii(
  zone: NeutralZone,
  lakeFeature: string,
  cliffFeature: string,
): string {
  const rows: string[] = [];
  for (let y = 0; y < zone.depth; y++) {
    let row = '';
    for (let x = 0; x < zone.width; x++) {
      const f = zone.features.find((c) => c.x === x && c.y === y)?.feature;
      row +=
        f === undefined
          ? '.'
          : f === lakeFeature
            ? '~'
            : f === cliffFeature
              ? '#'
              : '?';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/**
 * Golden-vector kind `neutral-zone`. Input `{ seed, partySize }`; the width is
 * `partySize * plotWidth`. Result `{ zone, hash, attempts }`.
 */
export function makeNeutralZoneKind(
  content: NeutralZoneContent,
  config: MapgenConfig,
): SimulationFn {
  return (input: Json) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('neutral-zone: input must be an object');
    }
    const o = input as Record<string, Json>;
    const seed = o['seed'];
    const partySize = o['partySize'];
    if (typeof seed !== 'number' || typeof partySize !== 'number') {
      throw new TypeError('neutral-zone: seed and partySize must be numbers');
    }
    const { zone, attempts } = generateNeutralZoneWithStats(
      seed,
      partySize * config.plotWidth,
      content,
      config,
    );
    return {
      result: {
        zone: zone as unknown as Json,
        hash: hashJson(zone),
        attempts,
      },
    };
  };
}
