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
import { addConduit } from './conduits.js';
import { loadAllContentOrThrow } from './content.js';
import { generateMap } from './generate-map.js';
import { listLegalCorePositions, type Cell, type GameMap } from './map.js';
import { loadMapgenOrThrow } from './mapgen.js';
import { Rng } from './rng.js';
import { loadSimConfigOrThrow } from './sim-config.js';
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
  /** Place the Core with its lowest-x, lowest-y cell at `(x, y)`. */
  core(x: number, y: number): void {
    const r = placeCore(this.state, this.with_, mapgen, { x, y });
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
    const at = listLegalCorePositions(m, content, mapgen)[0];
    if (at !== undefined) {
      const c = placeCore(s, content, mapgen, at);
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
