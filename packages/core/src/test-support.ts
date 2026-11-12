/** Shared helpers for simulation tests: content, a board builder, networks. */
import buildingsJson from '../../../content/buildings.json';
import mapgenJson from '../../../content/mapgen.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import simJson from '../../../content/sim.json';
import terrainJson from '../../../content/terrain.json';
import threatsJson from '../../../content/threats.json';
import unitsJson from '../../../content/units.json';
import type { Side } from './buildings.js';
import {
  isCoreHealth,
  stepArena,
  type ArenaContext,
  type HealthSim,
  type ArenaSim,
  type UnitSim,
} from './arena-sim.js';
import type { ArenaContent } from './arena.js';
import { addConduit } from './conduits.js';
import { loadAllContentOrThrow } from './content.js';
import { generateMap } from './generate-map.js';
import { fits } from './geometry.js';
import { isqrtCeil } from './int.js';
import { listLegalCorePositions, type Cell, type GameMap } from './map.js';
import { loadMapgenOrThrow } from './mapgen.js';
import { Rng } from './rng.js';
import { loadSimConfigOrThrow } from './sim-config.js';
import { loadUnitsOrThrow } from './units.js';
import { CELL_UNITS } from './limits.js';
import { loadThreatsOrThrow } from './threats.js';
import {
  addToStash,
  createTeamState,
  occupancy,
  placeCore,
  placeFromStash,
  type TeamState,
} from './team-state.js';
export const content = loadAllContentOrThrow({
  resources: resourcesJson,
  terrain: terrainJson,
  units: unitsJson,
  buildings: buildingsJson,
  presentation: presentationJson,
});
export const mapgen = loadMapgenOrThrow(mapgenJson, {
  terrain: content.terrain,
});
export const simConfig = loadSimConfigOrThrow(simJson);
export const threats = loadThreatsOrThrow(threatsJson, {
  units: content.units,
  buildings: content.buildings,
});
// ---------------------------------------------------------------------------
// Helpers

/**
 * Every legal Core position of every player, sorted by `(y, x)`, with the
 * player whose plot it lies in. For tests that want one Core anywhere.
 */
export function legalCoresAnyPlot(
  m: GameMap,
): { player: number; x: number; y: number }[] {
  const out: { player: number; x: number; y: number }[] = [];
  for (let player = 0; player < m.partySize; player++) {
    for (const c of listLegalCorePositions(m, content, mapgen, player)) {
      out.push({ player, x: c.x, y: c.y });
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function got<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing value');
  return v;
}

/** An open 24 x 16 board with the given nodes. */
export function board(
  nodes: [number, number, string][],
  width = 24,
  partySize = 1,
): GameMap {
  return {
    width,
    height: 16,
    partySize,
    plotWidth: width / partySize,
    features: [],
    nodes: nodes.map(([x, y, resource]) => ({ x, y, resource })),
  };
}

export type Pairs = [number, number][];

export class Lab {
  state: TeamState;
  /** `with` lets a test build on a variant of the content. */
  constructor(
    map: GameMap,
    private readonly with_: typeof content = content,
  ) {
    this.state = createTeamState(map);
  }
  put(def: string, x: number, y: number, rotation = 0, tier = 1): number {
    const s = addToStash(this.state, this.with_, { def, tier, owner: 0 });
    if (!s.ok) throw new Error(s.reason);
    const p = placeFromStash(s.state, this.with_, { id: s.id, x, y, rotation });
    if (!p.ok) throw new Error(`${def}: ${p.reason}`);
    this.state = p.state;
    return s.id;
  }
  /** Place player `player`'s Core with its lowest-x, lowest-y cell at `(x, y)`. */
  core(x: number, y: number, player = 0): void {
    const r = placeCore(this.state, this.with_, mapgen, player, { x, y });
    if (!r.ok) throw new Error(`core: ${r.reason}`);
    this.state = r.state;
  }
  link(
    from: number,
    fromSide: Side,
    to: number,
    toSide: Side,
    cells: Pairs = [],
  ): number {
    const r = addConduit(this.state, this.with_, {
      from: { building: from, side: fromSide },
      to: { building: to, side: toSide },
      cells: cells.map(([x, y]) => ({ x, y })),
    });
    if (!r.ok) throw new Error(`link: ${r.reason} ${r.detail ?? ''}`);
    this.state = r.state;
    return r.id;
  }
}

/** A shortest free path between the cells outside two sides, or null. */
export function route(
  state: TeamState,
  from: Cell[],
  to: Cell[],
  occ: ReturnType<typeof occupancy>,
  used: Set<number>,
): Cell[] | null {
  const { width, height } = state.map;
  const free = (c: Cell): boolean =>
    c.x >= 0 &&
    c.y >= 0 &&
    c.x < width &&
    c.y < height &&
    occ.buildingAt(c.x, c.y) === null &&
    !used.has(c.y * width + c.x) &&
    !state.map.features.some((f) => f.x === c.x && f.y === c.y);
  const goal = new Set(to.map((c) => c.y * width + c.x));
  const prev = new Map<number, number>();
  const queue: Cell[] = [];
  for (const c of from) {
    if (free(c) && !prev.has(c.y * width + c.x)) {
      prev.set(c.y * width + c.x, -1);
      queue.push(c);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = got(queue[head]);
    const k = c.y * width + c.x;
    if (goal.has(k)) {
      const out: Cell[] = [];
      for (let at = k; at !== -1; at = got(prev.get(at))) {
        out.push({ x: at % width, y: Math.floor(at / width) });
      }
      return out.reverse();
    }
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as const) {
      const n = { x: c.x + dx, y: c.y + dy };
      const nk = n.y * width + n.x;
      if (free(n) && !prev.has(nk)) {
        prev.set(nk, k);
        queue.push(n);
      }
    }
  }
  return null;
}

/** Cells just outside a building's side, in increasing coordinate order. */
export function outside(cells: Cell[], side: Side): Cell[] {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const [x0, x1, y0, y1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const out: Cell[] = [];
  if (side === 'north')
    for (let x = x0; x <= x1; x++) out.push({ x, y: y1 + 1 });
  if (side === 'south')
    for (let x = x0; x <= x1; x++) out.push({ x, y: y0 - 1 });
  if (side === 'east')
    for (let y = y0; y <= y1; y++) out.push({ x: x1 + 1, y });
  if (side === 'west')
    for (let y = y0; y <= y1; y++) out.push({ x: x0 - 1, y });
  return out;
}

/** A random valid network on a generated map (sources on nodes, BFS conduits). */
export function randomNetwork(
  seed: number,
  options: { core?: boolean } = {},
): TeamState {
  const partySize = 1 + (seed % 3);
  const m = generateMap(seed, partySize, content, mapgen);
  const rng = Rng.fromSeed(seed * 7919);
  let s = createTeamState(m);
  if (options.core === true) {
    const at = legalCoresAnyPlot(m)[0];
    if (at !== undefined) {
      const c = placeCore(s, content, mapgen, at.player, at);
      if (c.ok) s = c.state;
    }
  }
  const defs = content.buildings
    .list()
    .filter((b) => b.kind !== 'core')
    .map((b) => b.id);
  const sources = defs.filter(
    (d) => content.buildings.get(d)?.kind === 'source',
  );
  const rest = defs.filter((d) => content.buildings.get(d)?.kind !== 'source');
  for (let step = 0; step < 150; step++) {
    const roll = rng.nextInt(10);
    if (roll <= 4) {
      const wantSource = rng.nextInt(3) === 0;
      const def = wantSource
        ? got(sources[rng.nextInt(sources.length)])
        : got(rest[rng.nextInt(rest.length)]);
      const a = addToStash(s, content, {
        def,
        tier: 1 + rng.nextInt(3),
        owner: rng.nextInt(partySize),
      });
      if (!a.ok) continue;
      const n = got(m.nodes[rng.nextInt(m.nodes.length)]);
      const p = wantSource
        ? { x: n.x, y: n.y }
        : { x: rng.nextInt(m.width), y: rng.nextInt(m.height) };
      const placed = placeFromStash(a.state, content, {
        id: a.id,
        x: p.x,
        y: p.y,
        rotation: [0, 90, 180, 270][rng.nextInt(4)] as number,
      });
      s = placed.ok ? placed.state : a.state;
    } else if (s.buildings.length >= 2) {
      const occ = occupancy(s, content);
      const a = got(s.buildings[rng.nextInt(s.buildings.length)]);
      const b = got(s.buildings[rng.nextInt(s.buildings.length)]);
      const outs = occ.absoluteSides(a).outputs;
      const ins = occ.absoluteSides(b).inputs;
      if (outs.length === 0 || ins.length === 0) continue;
      const fromSide = got(outs[rng.nextInt(outs.length)]);
      const toSide = got(ins[rng.nextInt(ins.length)]).side;
      const used = new Set<number>();
      for (const c of s.conduits) {
        for (const k of c.cells) used.add(k.y * m.width + k.x);
      }
      const cells = route(
        s,
        outside(occ.cellsOf(a), fromSide),
        outside(occ.cellsOf(b), toSide),
        occ,
        used,
      );
      const r = addConduit(s, content, {
        from: { building: a.id, side: fromSide },
        to: { building: b.id, side: toSide },
        cells: cells ?? [],
      });
      if (r.ok) s = r.state;
    }
  }
  return s;
}

/**
 * A four-plot (96 x 16) board of 48 modules: a source, a two-cell conduit, a
 * splitter, a barracks directly north of the splitter and a barracks reached
 * through a one-cell conduit east. 48 sources, 48 splitters and 96 consumers.
 */
export function bigBoard(): TeamState {
  const nodes: [number, number, string][] = [];
  for (let col = 0; col < 24; col++) {
    for (const y0 of [0, 8]) nodes.push([col * 4, y0, 'res_a']);
  }
  const lab = new Lab(board(nodes, 96, 4));
  for (let col = 0; col < 24; col++) {
    for (const y0 of [0, 8]) {
      const x0 = col * 4;
      const src = lab.put('bld_extractor', x0, y0);
      const sp = lab.put('bld_splitter', x0, y0 + 3);
      const a = lab.put('bld_barracks', x0, y0 + 4);
      const b = lab.put('bld_barracks', x0 + 2, y0 + 2, 90);
      lab.link(src, 'north', sp, 'south', [
        [x0, y0 + 1],
        [x0, y0 + 2],
      ]);
      lab.link(sp, 'north', a, 'south');
      lab.link(sp, 'east', b, 'west', [[x0 + 1, y0 + 3]]);
    }
  }
  return lab.state;
}

/** The collision radius of a unit, from the battle's own content (test-only units included). */
function collisionRadiusOf(ctx: ArenaContext, u: UnitSim): number {
  const def = ctx.content.units.get(u.def);
  if (def === undefined) {
    throw new Error(`groundViolations: unknown unit type "${u.def}".`);
  }
  return def.collisionRadius;
}

/**
 * The violations of the ground invariant in a battle state: a unit whose
 * collision circle does not fit for its side (blocked ground, a building that
 * blocks it, outside the arena). Units may overlap each other (soft
 * collision, issue #82): see `overlapStats`. Throws on a unit of an unknown
 * type. Empty when the state is good.
 */
export function groundViolations(sim: ArenaSim, ctx: ArenaContext): string[] {
  const out: string[] = [];
  for (const u of sim.units) {
    if (!fits(ctx.world, u.side, collisionRadiusOf(ctx, u), u.px, u.py)) {
      out.push(
        `unit ${String(u.id)} does not fit at ${String(u.px)},${String(u.py)}`,
      );
    }
  }
  return out;
}

/** How much the collision circles of a battle state overlap. */
export interface OverlapStats {
  /** Number of overlapping pairs. */
  readonly pairs: number;
  /** Number of pairs overlapping by more than half the sum of their radii. */
  readonly deep: number;
  /** Deepest overlap: `Ra + Rb - ceil(distance)`, sub-cell units (0 if none). */
  readonly maxDepth: number;
  /** The deepest overlap as a percent of the sum of the two radii (rounded down). */
  readonly maxPercent: number;
}

/** The overlaps in a battle state (every pair, found through a coarse grid). */
export function overlapStats(sim: ArenaSim, ctx: ArenaContext): OverlapStats {
  const units = sim.units;
  const cell = 2 * ctx.maxRadius;
  const buckets = new Map<number, number[]>();
  const key = (gx: number, gy: number): number => gx * 65536 + gy;
  const rad = units.map((u) => collisionRadiusOf(ctx, u));
  units.forEach((u, i) => {
    const k = key(Math.floor(u.px / cell), Math.floor(u.py / cell));
    const list = buckets.get(k);
    if (list === undefined) buckets.set(k, [i]);
    else list.push(i);
  });
  let pairs = 0;
  let deep = 0;
  let maxDepth = 0;
  let maxPercent = 0;
  units.forEach((u, i) => {
    const gx = Math.floor(u.px / cell);
    const gy = Math.floor(u.py / cell);
    for (let x = gx - 1; x <= gx + 1; x++) {
      for (let y = gy - 1; y <= gy + 1; y++) {
        for (const j of buckets.get(key(x, y)) ?? []) {
          if (j <= i) continue;
          const v = got(units[j]);
          const r = got(rad[i]) + got(rad[j]);
          const d2 = (u.px - v.px) ** 2 + (u.py - v.py) ** 2;
          if (d2 >= r * r) continue;
          pairs += 1;
          const depth = r - isqrtCeil(d2);
          if (2 * depth > r) deep += 1;
          if (depth > maxDepth) maxDepth = depth;
          const pct = Math.floor((100 * depth) / r);
          if (pct > maxPercent) maxPercent = pct;
        }
      }
    }
  });
  return { pairs, deep, maxDepth, maxPercent };
}

/** The centre coordinate of arena cell column or row `c`. */
export const mid = (c: number): number => c * CELL_UNITS + CELL_UNITS / 2;

/** The arena cell holding a unit's centre. */
export function cellOfUnit(u: { px: number; py: number }): Cell {
  return {
    x: Math.floor(u.px / CELL_UNITS),
    y: Math.floor(u.py / CELL_UNITS),
  };
}

/**
 * Step `ticks` ticks and return the distinct cells the unit's centre visited,
 * starting with its first cell (units do not emit movement events).
 */
export function walk(
  sim: ArenaSim,
  ctx: ArenaContext,
  u: UnitSim,
  ticks: number,
): Cell[] {
  const path = [cellOfUnit(u)];
  for (let t = 0; t < ticks; t++) {
    stepArena(sim, ctx);
    if (!sim.units.includes(u)) break;
    const c = cellOfUnit(u);
    const last = got(path[path.length - 1]);
    if (c.x !== last.x || c.y !== last.y) path.push(c);
  }
  return path;
}

/**
 * The content plus `unit_post`, a unit that practically stands still (one
 * sub-cell unit per tick), has plenty of health and does no damage: a target
 * dummy for turret and aggro tests.
 */
export const postContent: ArenaContent = {
  ...content,
  units: loadUnitsOrThrow({
    units: [
      ...content.units.list(),
      {
        id: 'unit_post',
        health: 1000,
        damage: 0,
        attackCooldownTicks: 1000,
        moveCooldownTicks: 240,
        radius: 72,
        collisionRadius: 72,
        reach: 0,
        flying: false,
        attackType: 'melee',
      },
      {
        // Fills a cell: no unit finds a free spot inside the cell it stands on.
        id: 'unit_boulder',
        health: 1000,
        damage: 0,
        attackCooldownTicks: 1000,
        moveCooldownTicks: 240,
        radius: 120,
        collisionRadius: 120,
        reach: 0,
        flying: false,
        attackType: 'melee',
      },
    ],
  }),
};

/**
 * Wall-time limits in tests are multiplied by this. CI sets
 * CI_RELAXED_TIMING=1 (shared runners are slow and noisy), which makes it 3;
 * locally it is 1, the strict limits.
 */
export const TIMING =
  (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env['CI_RELAXED_TIMING'] === '1'
    ? 3
    : 1;

/**
 * The health entry of a building by instance ID; `building` 0 means the
 * side's Core of player `core` (default 0).
 */
export function healthEntry(
  sim: ArenaSim,
  side: number,
  building: number,
  core = 0,
): HealthSim | undefined {
  return sim.health.find((h) =>
    building === 0
      ? isCoreHealth(h) && h.side === side && h.core === core
      : !isCoreHealth(h) && h.side === side && h.building === building,
  );
}
