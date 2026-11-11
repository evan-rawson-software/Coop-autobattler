/**
 * The factory planner of the scripted bot (W3-2).
 *
 * Given a team state it plans board intents (`place_building`,
 * `add_conduit`) for one player. Planning runs the pure core rules on a copy
 * of the team (`placeFromStash`, `addConduit`, `sealedProducers`), so every
 * intent it returns was already checked to be legal; the bot then sends them
 * through the ordinary intent interface. Nothing here touches a run.
 */
import {
  addConduit,
  occupancy,
  placeFromStash,
  queryMap,
  rotateBuilding,
  sealedProducers,
  type BuildingDef,
  type Cell,
  type Content,
  type PlacedBuilding,
  type Rng,
  type TeamState,
} from '@game/core';
import type { BoardIntent } from './types.js';

type Side = 'north' | 'east' | 'south' | 'west';

/** How a strategy lays a factory out. */
export interface LayoutStyle {
  /** Connect extractors to the buildings that use their resource. */
  readonly connect: boolean;
  /** Place walls and gates (otherwise they stay in the stash). */
  readonly walls: boolean;
  /** Place buildings that could not be connected (otherwise they stay). */
  readonly placeLeftovers: boolean;
  /** Building definitions in the order they are connected, first first. */
  readonly priority: readonly string[];
}

interface Plan {
  readonly team: TeamState;
  readonly out: readonly BoardIntent[];
}

interface Env {
  readonly content: Content;
  readonly rng: Rng;
  readonly style: LayoutStyle;
  readonly player: number;
  readonly x0: number;
  readonly x1: number;
  readonly baselineSealed: number;
}

/** Search window around a source output for a consumer, in cells. */
const WINDOW_X = 4;
const WINDOW_Y = 5;

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

function defOf(env: Env, id: string): BuildingDef | undefined {
  return env.content.buildings.get(id);
}

function sizeOf(env: Env, id: string): { w: number; h: number } {
  const fp = defOf(env, id)?.footprint;
  return { w: fp?.width ?? 1, h: fp?.height ?? 1 };
}

function outsideCell(
  b: { x: number; y: number },
  w: number,
  h: number,
  side: Side,
  index: number,
): Cell {
  switch (side) {
    case 'north':
      return { x: b.x + index, y: b.y + h };
    case 'south':
      return { x: b.x + index, y: b.y - 1 };
    case 'east':
      return { x: b.x + w, y: b.y + index };
    case 'west':
      return { x: b.x - 1, y: b.y + index };
  }
}

function sideLength(side: Side, w: number, h: number): number {
  return side === 'north' || side === 'south' ? w : h;
}

function boxOf(env: Env, b: PlacedBuilding): { w: number; h: number } {
  const def = defOf(env, b.def);
  if (def === undefined) return { w: 1, h: 1 };
  const fp = rotateBuilding(def, b.rotation).footprint;
  return { w: fp.width, h: fp.height };
}

/** Cells that a conduit may use: open ground, no building, Core or conduit. */
function freeCells(
  env: Env,
  team: TeamState,
): (x: number, y: number) => boolean {
  const q = queryMap(team.map, env.content.terrain);
  const occ = occupancy(team, env.content);
  const used = new Set<number>();
  for (const c of team.conduits) {
    for (const cell of c.cells) used.add(cell.y * team.map.width + cell.x);
  }
  return (x, y) =>
    q.isBuildable(x, y) &&
    occ.buildingAt(x, y) === null &&
    !used.has(y * team.map.width + x);
}

/** Shortest path of free cells from `start` to any of `targets`. */
function route(
  team: TeamState,
  free: (x: number, y: number) => boolean,
  start: Cell,
  targets: readonly Cell[],
): Cell[] | null {
  const w = team.map.width;
  const key = (c: Cell): number => c.y * w + c.x;
  const goal = new Set(targets.map(key));
  if (!free(start.x, start.y)) return null;
  const prev = new Map<number, number>();
  prev.set(key(start), -1);
  const queue: Cell[] = [start];
  const dirs: readonly (readonly [number, number])[] = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
  ];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as Cell;
    if (goal.has(key(cur))) {
      const path: Cell[] = [];
      let k = key(cur);
      while (k !== -1) {
        path.push({ x: k % w, y: Math.floor(k / w) });
        k = prev.get(k) ?? -1;
      }
      return path.reverse();
    }
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= team.map.height) continue;
      const nk = ny * w + nx;
      if (prev.has(nk) || !free(nx, ny)) continue;
      prev.set(nk, key(cur));
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/** The sealed-in check; a plan that seals in a new producer is refused. */
function sealsNothingNew(env: Env, team: TeamState): boolean {
  return sealedProducers(team, env.content).length <= env.baselineSealed;
}

function withPlace(
  env: Env,
  plan: Plan,
  id: number,
  x: number,
  y: number,
): Plan | null {
  const r = placeFromStash(plan.team, env.content, { id, x, y, rotation: 0 });
  if (!r.ok) return null;
  return {
    team: r.state,
    out: [...plan.out, { type: 'place_building', id, x, y, rotation: 0 }],
  };
}

/**
 * Connect the (placed) source to the (placed) consumer: directly if they
 * face, else along the shortest free path.
 */
function withConduit(
  env: Env,
  plan: Plan,
  sourceId: number,
  consumerId: number,
): Plan | null {
  const t = plan.team;
  const s = t.buildings.find((b) => b.id === sourceId);
  const c = t.buildings.find((b) => b.id === consumerId);
  if (s === undefined || c === undefined) return null;
  const occ = occupancy(t, env.content);
  const outSide = occ.absoluteSides(s).outputs[0];
  const input = occ.absoluteSides(c).inputs[0];
  if (outSide === undefined || input === undefined) return null;
  const sb = boxOf(env, s);
  const cb = boxOf(env, c);
  const start = outsideCell(s, sb.w, sb.h, outSide, 0);
  const from = { building: s.id, side: outSide };
  const to = { building: c.id, side: input.side };
  const add = (cells: readonly Cell[]): Plan | null => {
    const r = addConduit(t, env.content, { from, to, cells });
    if (!r.ok) return null;
    return {
      team: r.state,
      out: [...plan.out, { type: 'add_conduit', from, to, cells }],
    };
  };
  const direct = add([]);
  if (direct !== null) return direct;
  const targets: Cell[] = [];
  for (let i = 0; i < sideLength(input.side, cb.w, cb.h); i++) {
    targets.push(outsideCell(c, cb.w, cb.h, input.side, i));
  }
  const path = route(t, freeCells(env, t), start, targets);
  return path === null ? null : add(path);
}

function inPlot(env: Env, x: number, w: number): boolean {
  return x >= env.x0 && x + w <= env.x1;
}

/** Positions for a consumer near a cell, nearest first. */
function nearby(env: Env, around: Cell, w: number): Cell[] {
  const out: Cell[] = [];
  for (let dy = -WINDOW_Y; dy <= WINDOW_Y; dy++) {
    for (let dx = -WINDOW_X; dx <= WINDOW_X; dx++) {
      const x = around.x + dx;
      const y = around.y + dy;
      if (y >= 1 && inPlot(env, x, w)) out.push({ x, y });
    }
  }
  return out.sort(
    (a, b) =>
      Math.abs(a.x - around.x) +
        Math.abs(a.y - around.y) -
        (Math.abs(b.x - around.x) + Math.abs(b.y - around.y)) ||
      b.y - a.y ||
      a.x - b.x,
  );
}

/** Place a stashed consumer near a placed source and connect them. */
function placeConsumerNear(
  env: Env,
  plan: Plan,
  sourceId: number,
  consumerId: number,
): Plan | null {
  const s = plan.team.buildings.find((b) => b.id === sourceId);
  const c = plan.team.stash.find((b) => b.id === consumerId);
  if (s === undefined || c === undefined) return null;
  const outSide = occupancy(plan.team, env.content).absoluteSides(s).outputs[0];
  if (outSide === undefined) return null;
  const sb = boxOf(env, s);
  const start = outsideCell(s, sb.w, sb.h, outSide, 0);
  const size = sizeOf(env, c.def);
  for (const pos of nearby(env, start, size.w)) {
    const placed = withPlace(env, plan, consumerId, pos.x, pos.y);
    if (placed === null) continue;
    const done = withConduit(env, placed, sourceId, consumerId);
    if (done !== null && sealsNothingNew(env, done.team)) return done;
  }
  return null;
}

/** Nodes of a resource inside the player's plot, free of anything. */
function freeNodes(env: Env, team: TeamState, resource: string): Cell[] {
  const nodes: Cell[] = [];
  for (const n of team.map.nodes) {
    if (n.resource === resource && n.x >= env.x0 && n.x < env.x1) {
      nodes.push({ x: n.x, y: n.y });
    }
  }
  return nodes;
}

function attached(team: TeamState): Set<number> {
  const ids = new Set<number>();
  for (const c of team.conduits) {
    ids.add(c.from.building);
    ids.add(c.to.building);
  }
  return ids;
}

function resourceOf(
  env: Env,
  team: TeamState,
  b: PlacedBuilding,
): string | undefined {
  return occupancy(team, env.content).sourceResource(b);
}

/** Connect one consumer (placed or stashed) to a source of its resource. */
function connectConsumer(
  env: Env,
  plan: Plan,
  consumerId: number,
  resource: string,
): Plan | null {
  const t = plan.team;
  const isPlaced = t.buildings.some((b) => b.id === consumerId);
  const taken = attached(t);
  // 1. A placed extractor that feeds nothing yet.
  const sources = t.buildings.filter(
    (b) =>
      b.owner === env.player &&
      defOf(env, b.def)?.kind === 'source' &&
      !taken.has(b.id) &&
      resourceOf(env, t, b) === resource,
  );
  for (const s of sources) {
    const done = isPlaced
      ? withConduit(env, plan, s.id, consumerId)
      : placeConsumerNear(env, plan, s.id, consumerId);
    if (done !== null && sealsNothingNew(env, done.team)) return done;
  }
  // 2. A stashed extractor, put on a free node of the resource.
  const stash = t.stash.filter(
    (b) => b.owner === env.player && defOf(env, b.def)?.kind === 'source',
  );
  const first = stash[0];
  if (first === undefined) return null;
  const consumer = isPlaced
    ? t.buildings.find((b) => b.id === consumerId)
    : undefined;
  let nodes = shuffle(freeNodes(env, t, resource), env.rng);
  if (consumer !== undefined) {
    nodes = nodes.sort(
      (a, b) =>
        Math.abs(a.x - consumer.x) +
        Math.abs(a.y - consumer.y) -
        (Math.abs(b.x - consumer.x) + Math.abs(b.y - consumer.y)),
    );
  }
  for (const node of nodes) {
    const placed = withPlace(env, plan, first.id, node.x, node.y);
    if (placed === null) continue;
    const done = isPlaced
      ? withConduit(env, placed, first.id, consumerId)
      : placeConsumerNear(env, placed, first.id, consumerId);
    if (done !== null && sealsNothingNew(env, done.team)) return done;
  }
  return null;
}

/** Scan order for loose buildings: front rows first, from a random column. */
function scanCells(env: Env, team: TeamState, w: number, h: number): Cell[] {
  const span = Math.max(1, env.x1 - env.x0);
  const offset = env.rng.nextInt(span);
  const out: Cell[] = [];
  for (let y = team.map.height - 1 - h; y >= 1; y--) {
    for (let i = 0; i < span; i++) {
      const x = env.x0 + ((i + offset) % span);
      if (inPlot(env, x, w)) out.push({ x, y });
    }
  }
  return out;
}

function placeLoose(env: Env, plan: Plan, id: number): Plan | null {
  const item = plan.team.stash.find((b) => b.id === id);
  if (item === undefined) return null;
  const size = sizeOf(env, item.def);
  const kind = defOf(env, item.def)?.kind;
  if (kind === 'source') return null;
  // Walls and gates keep to every other cell so the screen has gaps.
  const spaced = kind === 'defense' && item.def !== 'bld_turret';
  for (const pos of scanCells(env, plan.team, size.w, size.h)) {
    if (spaced && (pos.x + pos.y) % 2 !== 0) continue;
    const placed = withPlace(env, plan, id, pos.x, pos.y);
    if (placed !== null && sealsNothingNew(env, placed.team)) return placed;
  }
  return null;
}

function isWallLike(env: Env, def: string): boolean {
  const d = defOf(env, def);
  return d?.kind === 'defense' && d.defenseType !== 'turret';
}

/**
 * The board intents that lay out `player`'s stash. Returns the list in the
 * order to send it; empty when there is nothing to do or nothing fits.
 */
export function planLayout(
  team: TeamState,
  player: number,
  content: Content,
  plotWidth: number,
  style: LayoutStyle,
  rng: Rng,
): BoardIntent[] {
  const env: Env = {
    content,
    rng,
    style,
    player,
    x0: player * plotWidth,
    x1: Math.min(team.map.width, (player + 1) * plotWidth),
    baselineSealed: sealedProducers(team, content).length,
  };
  let plan: Plan = { team, out: [] };
  const rank = (def: string): number => {
    const i = style.priority.indexOf(def);
    return i === -1 ? style.priority.length : i;
  };
  if (style.connect) {
    const consumers = [...team.buildings, ...team.stash]
      .filter((b) => {
        const d = defOf(env, b.def);
        return (
          b.owner === player &&
          d !== undefined &&
          d.kind !== 'route' &&
          d.kind !== 'source' &&
          d.inputs.length > 0
        );
      })
      .sort(
        (a, b) => rank(a.def) - rank(b.def) || b.tier - a.tier || a.id - b.id,
      );
    for (const c of consumers) {
      if (attached(plan.team).has(c.id)) continue;
      const input = defOf(env, c.def)?.inputs[0];
      const resource = input?.resource;
      if (resource === undefined) continue;
      const done = connectConsumer(env, plan, c.id, resource);
      if (done !== null) plan = done;
    }
  }
  if (style.placeLeftovers) {
    const loose = plan.team.stash
      .filter((b) => b.owner === player)
      .filter((b) => style.walls || !isWallLike(env, b.def))
      .sort((a, b) => rank(a.def) - rank(b.def) || a.id - b.id);
    for (const b of loose) {
      const done = placeLoose(env, plan, b.id);
      if (done !== null) plan = done;
    }
  }
  return [...plan.out];
}
