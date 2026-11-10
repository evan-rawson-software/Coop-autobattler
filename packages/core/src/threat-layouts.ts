/**
 * Procedural stronghold layouts for PvE threats (W1-9): `ring`, `line` and
 * `open`. Everything is in the stronghold's own board coordinates (`y = 0` is
 * the back row, `y = height - 1` the front row facing the party). See
 * docs/rules-reference.md, "PvE threats".
 */

import type { Cell } from './map.js';
import type { Rng } from './rng.js';
import type { LayoutId, ThreatsConfig } from './threats.js';

export interface LayoutBoard {
  readonly width: number;
  readonly height: number;
  readonly plotWidth: number;
  /** The Core footprint. */
  readonly coreWidth: number;
  readonly coreHeight: number;
}

export interface LayoutPlan {
  /** The Core's lowest-x, lowest-y cell. */
  readonly core: Cell;
  /** At most the requested number of walls, in placement-priority order. */
  readonly walls: Cell[];
  /** At most the requested number of turrets (random positions). */
  readonly turrets: Cell[];
}

interface Candidate extends Cell {
  readonly key: number;
}

/**
 * Pick `n` turret cells: candidates are grouped by ascending `key`; groups
 * are used in that order and each group that is used is shuffled once with
 * `rng.shuffle` (its cells listed by `(y, x)` first), taking from the front of
 * the shuffled group until `n` cells are chosen. A group is only shuffled if
 * cells are still needed when it is reached.
 */
function pickTurrets(cands: readonly Candidate[], n: number, rng: Rng): Cell[] {
  const keys = [...new Set(cands.map((c) => c.key))].sort((a, b) => a - b);
  const out: Cell[] = [];
  for (const key of keys) {
    if (out.length >= n) break;
    const group = rng.shuffle(
      cands.filter((c) => c.key === key).map((c) => ({ x: c.x, y: c.y })),
    );
    for (const c of group) {
      if (out.length >= n) break;
      out.push(c);
    }
  }
  return out;
}

/** Chebyshev distance from a cell to the Core's footprint (0 inside it). */
function coreDistance(
  core: Cell,
  b: LayoutBoard,
  x: number,
  y: number,
): number {
  const dx = Math.max(core.x - x, 0, x - (core.x + b.coreWidth - 1));
  const dy = Math.max(core.y - y, 0, y - (core.y + b.coreHeight - 1));
  return Math.max(dx, dy);
}

function key(c: Cell): string {
  return `${String(c.x)},${String(c.y)}`;
}

/** Turret candidates around the Core: not walls/gaps/Core, Chebyshev >= min. */
function aroundCore(
  core: Cell,
  b: LayoutBoard,
  minDistance: number,
  taken: ReadonlySet<string>,
): Candidate[] {
  const out: Candidate[] = [];
  for (let y = 0; y <= b.height - 2; y++) {
    for (let x = 0; x < b.width; x++) {
      const d = coreDistance(core, b, x, y);
      if (d < minDistance || taken.has(key({ x, y }))) continue;
      out.push({ x, y, key: d });
    }
  }
  return out;
}

function inBoard(b: LayoutBoard, x: number, y: number): boolean {
  return x >= 0 && x < b.width && y >= 0 && y <= b.height - 2;
}

/**
 * `ring`: square rings of walls around the Core, ring `k` (from 1) at
 * Chebyshev distance `firstRingDistance + (k - 1) * ringSpacing` from the Core
 * footprint, each with a gap of `gapWidth` cells in the middle of each of its
 * four sides. Cells outside the board or on the front row are skipped. Walls
 * fill ring 1 first, then ring 2, ...; inside a ring the priority is: higher
 * `y` first, then closer to the Core's middle column, then lower `x`. Turrets
 * go around the Core at Chebyshev distance at least `turretMinDistance`, the
 * nearest groups first (see `pickTurrets`), never on a wall or a gap cell of
 * a ring that holds a wall.
 */
function ring(
  b: LayoutBoard,
  cfg: ThreatsConfig['layouts']['ring'],
  nWalls: number,
  nTurrets: number,
  rng: Rng,
): LayoutPlan {
  const core: Cell = {
    x: Math.floor((b.width - b.coreWidth) / 2),
    y: cfg.coreRow,
  };
  const midX2 = 2 * core.x + b.coreWidth - 1;
  const walls: Cell[] = [];
  const gaps = new Set<string>();
  for (let k = 1; walls.length < nWalls && k <= 200; k++) {
    const d = cfg.firstRingDistance + (k - 1) * cfg.ringSpacing;
    const x0 = core.x - d;
    const x1 = core.x + b.coreWidth - 1 + d;
    const y0 = core.y - d;
    const y1 = core.y + b.coreHeight - 1 + d;
    const gx0 = x0 + Math.floor((x1 - x0 + 1 - cfg.gapWidth) / 2);
    const gy0 = y0 + Math.floor((y1 - y0 + 1 - cfg.gapWidth) / 2);
    const inGapX = (x: number): boolean => x >= gx0 && x < gx0 + cfg.gapWidth;
    const inGapY = (y: number): boolean => y >= gy0 && y < gy0 + cfg.gapWidth;
    const cells: Cell[] = [];
    const seen = new Set<string>();
    const add = (x: number, y: number): void => {
      if (seen.has(key({ x, y }))) return;
      seen.add(key({ x, y }));
      const gap = y === y0 || y === y1 ? inGapX(x) : inGapY(y);
      if (!inBoard(b, x, y)) return;
      if (gap) gaps.add(key({ x, y }));
      else cells.push({ x, y });
    };
    for (let x = x0; x <= x1; x++) add(x, y1);
    for (let y = y1 - 1; y >= y0; y--) add(x1, y);
    for (let x = x1 - 1; x >= x0; x--) add(x, y0);
    for (let y = y0 + 1; y < y1; y++) add(x0, y);
    cells.sort(
      (p, q) =>
        q.y - p.y ||
        Math.abs(2 * p.x - midX2) - Math.abs(2 * q.x - midX2) ||
        p.x - q.x,
    );
    for (const c of cells) {
      if (walls.length >= nWalls) break;
      walls.push(c);
    }
    if (cells.length === 0 && x0 < 0 && x1 >= b.width && y0 < 0) break;
  }
  const taken = new Set<string>([...walls.map(key), ...gaps]);
  const turrets = pickTurrets(
    aroundCore(core, b, cfg.turretMinDistance, taken),
    nTurrets,
    rng,
  );
  return { core, walls, turrets };
}

/**
 * `line`: a wall line across the whole board on row `lineRow`, with up to
 * `maxRows` rows (`lineRow`, `lineRow - 1`, ...), and one gap of `gapWidth`
 * cells per plot. The gap of plot `p` starts at `p * plotWidth + gapMargin +
 * rng.nextInt(plotWidth - 2 * gapMargin - gapWidth + 1)` (one draw per plot,
 * plots in order, drawn first). Walls fill row `lineRow` first, then the next
 * row; inside a row the cells nearest to a gap come first, then lower `x`.
 * Turrets stand behind the line (rows below `lineRow`, never in a gap column),
 * at Chebyshev distance at least `turretMinDistance` from the Core, nearest
 * to the line first (row groups, see `pickTurrets`).
 */
function line(
  b: LayoutBoard,
  cfg: ThreatsConfig['layouts']['line'],
  partySize: number,
  nWalls: number,
  nTurrets: number,
  rng: Rng,
): LayoutPlan {
  const core: Cell = {
    x: Math.floor((b.width - b.coreWidth) / 2),
    y: cfg.coreRow,
  };
  if (cfg.lineRow > b.height - 2) {
    throw new RangeError(
      'Threat layout "line": lineRow is on or past the front row.',
    );
  }
  const span = b.plotWidth - 2 * cfg.gapMargin - cfg.gapWidth + 1;
  if (span < 1) {
    throw new RangeError(
      'Threat layout "line": a plot is too narrow for its gap.',
    );
  }
  const gapStarts: number[] = [];
  for (let p = 0; p < partySize; p++) {
    gapStarts.push(p * b.plotWidth + cfg.gapMargin + rng.nextInt(span));
  }
  const inGap = (x: number): boolean =>
    gapStarts.some((g) => x >= g && x < g + cfg.gapWidth);
  const gapDistance = (x: number): number =>
    Math.min(
      ...gapStarts.map((g) =>
        x < g ? g - x : x >= g + cfg.gapWidth ? x - (g + cfg.gapWidth - 1) : 0,
      ),
    );
  const walls: Cell[] = [];
  for (let r = 0; r < cfg.maxRows && walls.length < nWalls; r++) {
    const y = cfg.lineRow - r;
    if (y < 0) break;
    const row: Cell[] = [];
    for (let x = 0; x < b.width; x++) if (!inGap(x)) row.push({ x, y });
    row.sort((p, q) => gapDistance(p.x) - gapDistance(q.x) || p.x - q.x);
    for (const c of row) {
      if (walls.length >= nWalls) break;
      walls.push(c);
    }
  }
  const taken = new Set<string>(walls.map(key));
  const cands: Candidate[] = [];
  for (let y = 0; y < cfg.lineRow; y++) {
    for (let x = 0; x < b.width; x++) {
      if (inGap(x) || taken.has(key({ x, y }))) continue;
      if (coreDistance(core, b, x, y) < cfg.turretMinDistance) continue;
      cands.push({ x, y, key: cfg.lineRow - y });
    }
  }
  return { core, walls, turrets: pickTurrets(cands, nTurrets, rng) };
}

/** `open`: no walls; turrets around the Core as for `ring`. */
function open(
  b: LayoutBoard,
  cfg: ThreatsConfig['layouts']['open'],
  nTurrets: number,
  rng: Rng,
): LayoutPlan {
  const core: Cell = {
    x: Math.floor((b.width - b.coreWidth) / 2),
    y: cfg.coreRow,
  };
  const turrets = pickTurrets(
    aroundCore(core, b, cfg.turretMinDistance, new Set()),
    nTurrets,
    rng,
  );
  return { core, walls: [], turrets };
}

/**
 * Lay out a stronghold: the Core position and at most `nWalls` walls and
 * `nTurrets` turrets (fewer when the layout has no room; the generator turns
 * the unspent budget into Core health). Randomness only from `rng`.
 */
export function layoutStronghold(
  layout: LayoutId,
  config: ThreatsConfig['layouts'],
  board: LayoutBoard,
  partySize: number,
  nWalls: number,
  nTurrets: number,
  rng: Rng,
): LayoutPlan {
  switch (layout) {
    case 'ring':
      return ring(board, config.ring, nWalls, nTurrets, rng);
    case 'line':
      return line(board, config.line, partySize, nWalls, nTurrets, rng);
    case 'open':
      return open(board, config.open, nTurrets, rng);
  }
}
