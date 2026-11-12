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
  collectorRatePer1000,
  isBorderEnd,
  needPer1000,
  occupancy,
  placeFromStash,
  queryMap,
  returnToStash,
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

export type Side = 'north' | 'east' | 'south' | 'west';

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
  /** Share supply with a neighbour through border links (PP-4). */
  readonly links?: boolean;
}

/**
 * The least share of its need (percent) that the collectors feeding a
 * consumer must supply for the bot to place it (CB-10a). A bot never places
 * a consumer its collectors cannot feed at least this much.
 */
export const MIN_COVERAGE_PERCENT = 20;

/** Percent of `need` that `supply` covers (both items per 1000 ticks). */
export function coveragePercent(supply: number, need: number): number {
  return need <= 0 ? 100 : Math.floor((100 * supply) / need);
}

/** The need of a consumer building (items per 1000 ticks at top speed). */
export function consumerNeed(
  content: Content,
  def: string,
  tier: number,
): number {
  const d = content.buildings.get(def);
  return d === undefined ? 0 : needPer1000(d, tier);
}

/** What one collector of `tier` supplies (items per 1000 ticks). */
export function collectorSupply(
  content: Content,
  def: string,
  tier: number,
): number {
  const d = content.buildings.get(def);
  return d !== undefined && d.kind === 'source'
    ? collectorRatePer1000(d, tier)
    : 0;
}

export interface Plan {
  readonly team: TeamState;
  readonly out: readonly BoardIntent[];
}

export interface Env {
  readonly content: Content;
  readonly rng: Rng;
  readonly style: LayoutStyle;
  readonly player: number;
  readonly x0: number;
  readonly x1: number;
  readonly baselineSealed: number;
  /** The player's own Core (top-left cell), when placed. */
  readonly core: Cell | null;
}

/** Search window around a source output for a consumer, in cells. */
const WINDOW_X = 4;
const WINDOW_Y = 5;

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

export function defOf(env: Env, id: string): BuildingDef | undefined {
  return env.content.buildings.get(id);
}

export function sizeOf(env: Env, id: string): { w: number; h: number } {
  const fp = defOf(env, id)?.footprint;
  return { w: fp?.width ?? 1, h: fp?.height ?? 1 };
}

export function outsideCell(
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

export function sideLength(side: Side, w: number, h: number): number {
  return side === 'north' || side === 'south' ? w : h;
}

export function boxOf(env: Env, b: PlacedBuilding): { w: number; h: number } {
  const def = defOf(env, b.def);
  if (def === undefined) return { w: 1, h: 1 };
  const fp = rotateBuilding(def, b.rotation).footprint;
  return { w: fp.width, h: fp.height };
}

/** Cells that a conduit may use: open ground, no building, Core or conduit. */
export function freeCells(
  env: Env,
  team: TeamState,
): (x: number, y: number) => boolean {
  const q = queryMap(team.map, env.content.terrain);
  const occ = occupancy(team, env.content);
  const used = new Set<number>();
  for (const c of team.conduits) {
    for (const cell of c.cells) used.add(cell.y * team.map.width + cell.x);
  }
  const fp = env.content.buildings.get('bld_core')?.footprint;
  for (const core of team.cores) {
    if (core === null) continue;
    for (let dy = 0; dy < (fp?.height ?? 2); dy++) {
      for (let dx = 0; dx < (fp?.width ?? 2); dx++) {
        used.add((core.y + dy) * team.map.width + core.x + dx);
      }
    }
  }
  return (x, y) =>
    q.isBuildable(x, y) &&
    occ.buildingAt(x, y) === null &&
    !used.has(y * team.map.width + x);
}

/** Shortest path of free cells from `start` to any of `targets`. */
export function route(
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

export function withPlace(
  env: Env,
  plan: Plan,
  id: number,
  x: number,
  y: number,
): Plan | null {
  const r = placeFromStash(plan.team, env.content, {
    actor: env.player,
    id,
    x,
    y,
    rotation: 0,
  });
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
  wantSide?: Side,
): Plan | null {
  const t = plan.team;
  const s = t.buildings.find((b) => b.id === sourceId);
  const c = t.buildings.find((b) => b.id === consumerId);
  if (s === undefined || c === undefined) return null;
  const occ = occupancy(t, env.content);
  const outSide = wantSide ?? occ.absoluteSides(s).outputs[0];
  if (
    wantSide !== undefined &&
    !occ.absoluteSides(s).outputs.includes(wantSide)
  )
    return null;
  const input = occ.absoluteSides(c).inputs[0];
  if (outSide === undefined || input === undefined) return null;
  const sb = boxOf(env, s);
  const cb = boxOf(env, c);
  const start = outsideCell(s, sb.w, sb.h, outSide, 0);
  const from = { building: s.id, side: outSide };
  const to = { building: c.id, side: input.side };
  const add = (cells: readonly Cell[]): Plan | null => {
    const r = addConduit(t, env.content, {
      actor: env.player,
      from,
      to,
      cells,
    });
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
export function nearby(env: Env, around: Cell, w: number): Cell[] {
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
  wantSide?: Side,
): Plan | null {
  const s = plan.team.buildings.find((b) => b.id === sourceId);
  const c = plan.team.stash.find((b) => b.id === consumerId);
  if (s === undefined || c === undefined) return null;
  const outSide =
    wantSide ?? occupancy(plan.team, env.content).absoluteSides(s).outputs[0];
  if (outSide === undefined) return null;
  const sb = boxOf(env, s);
  const start = outsideCell(s, sb.w, sb.h, outSide, 0);
  const size = sizeOf(env, c.def);
  for (const pos of nearby(env, start, size.w)) {
    const placed = withPlace(env, plan, consumerId, pos.x, pos.y);
    if (placed === null) continue;
    const done = withConduit(env, placed, sourceId, consumerId, wantSide);
    if (done !== null && sealsNothingNew(env, done.team)) return done;
  }
  return null;
}

/** Nodes of a resource inside the player's plot, free of anything. */
export function freeNodes(env: Env, team: TeamState, resource: string): Cell[] {
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
    if (!isBorderEnd(c.from)) ids.add(c.from.building);
    if (!isBorderEnd(c.to)) ids.add(c.to.building);
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

/**
 * Scan order for loose buildings: the cells of the player's plot nearest to
 * their own Core first (ties broken by the bot's generator), so walls and
 * turrets gather around it.
 */
function scanCells(env: Env, team: TeamState, w: number, h: number): Cell[] {
  const around: Cell = env.core ?? {
    x: Math.floor((env.x0 + env.x1) / 2),
    y: team.map.height - 1,
  };
  const out: { c: Cell; d: number }[] = [];
  for (let y = team.map.height - 1 - h; y >= 1; y--) {
    for (let x = env.x0; x < env.x1; x++) {
      if (!inPlot(env, x, w)) continue;
      const d = Math.abs(x - around.x) + Math.abs(y - around.y);
      out.push({ c: { x, y }, d: d * 4 + env.rng.nextInt(4) });
    }
  }
  return out
    .sort((a, b) => a.d - b.d || b.c.y - a.c.y || a.c.x - b.c.x)
    .map((e) => e.c);
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

export function makeEnv(
  team: TeamState,
  player: number,
  content: Content,
  plotWidth: number,
  style: LayoutStyle,
  rng: Rng,
): Env {
  return {
    content,
    rng,
    style,
    player,
    x0: player * plotWidth,
    x1: Math.min(team.map.width, (player + 1) * plotWidth),
    baselineSealed: sealedProducers(team, content).length,
    core: team.cores[player] ?? null,
  };
}

/** The best collector the player owns, as a supply (items per 1000 ticks). */
export function bestOwnedSupply(
  team: TeamState,
  player: number,
  content: Content,
): number {
  let best = 0;
  for (const b of [...team.buildings, ...team.stash]) {
    if (b.owner !== player) continue;
    best = Math.max(best, collectorSupply(content, b.def, b.tier));
  }
  return best;
}

/** Can one such collector feed `parts` consumers at the minimum coverage? */
export function feeds(
  env: Env,
  team: TeamState,
  c: { def: string; tier: number },
  parts: number,
): boolean {
  const supply = bestOwnedSupply(team, env.player, env.content);
  const share = Math.floor(supply / parts);
  return (
    coveragePercent(share, consumerNeed(env.content, c.def, c.tier)) >=
    MIN_COVERAGE_PERCENT
  );
}

const SPLIT_SIDES: readonly Side[] = ['north', 'east', 'west'];

/**
 * Where a pair can start: a collector already on the board that feeds
 * nothing yet (the Splitter goes on the cell after its output), or a new
 * collector from the stash on a free node of the resource. Each start is the
 * plan with the collector and the Splitter placed and joined (CB-9e).
 */
function splitterStarts(
  env: Env,
  plan: Plan,
  resource: string,
  splitterId: number,
): Plan[] {
  const t = plan.team;
  const taken = attached(t);
  const starts: Plan[] = [];
  const after = (p: Plan, sourceId: number): Plan | null => {
    const src = p.team.buildings.find((b) => b.id === sourceId);
    if (src === undefined) return null;
    const side = occupancy(p.team, env.content).absoluteSides(src).outputs[0];
    if (side !== 'north') return null;
    const box = boxOf(env, src);
    const cell = outsideCell(src, box.w, box.h, side, 0);
    const s2 = withPlace(env, p, splitterId, cell.x, cell.y);
    return s2 && withConduit(env, s2, sourceId, splitterId);
  };
  for (const b of t.buildings) {
    if (
      b.owner !== env.player ||
      defOf(env, b.def)?.kind !== 'source' ||
      taken.has(b.id) ||
      resourceOf(env, t, b) !== resource
    ) {
      continue;
    }
    const next = after(plan, b.id);
    if (next !== null) starts.push(next);
  }
  const source = t.stash.find(
    (b) => b.owner === env.player && defOf(env, b.def)?.kind === 'source',
  );
  if (source === undefined) return starts;
  for (const node of shuffle(freeNodes(env, t, resource), env.rng)) {
    const s1 = withPlace(env, plan, source.id, node.x, node.y);
    const next = s1 && after(s1, source.id);
    if (next !== null) starts.push(next);
  }
  return starts;
}

/**
 * One collector feeds two consumers through a Splitter placed directly after
 * it (CB-9e): a collector already on the board with a free output, or a new
 * one on a free node. Nothing is planned unless both consumers fit.
 */
function connectPair(
  env: Env,
  plan: Plan,
  first: number,
  second: number,
  resource: string,
): Plan | null {
  const splitter = plan.team.stash.find(
    (b) =>
      b.owner === env.player &&
      (defOf(env, b.def) as { routeType?: string } | undefined)?.routeType ===
        'splitter',
  );
  if (splitter === undefined) return null;
  for (const start of splitterStarts(env, plan, resource, splitter.id)) {
    let cur: Plan | null = start;
    const used = new Set<Side>();
    for (const id of [first, second]) {
      const base: Plan = cur;
      const isPlaced: boolean = base.team.buildings.some((b) => b.id === id);
      let done: Plan | null = null;
      for (const side of SPLIT_SIDES) {
        if (used.has(side)) continue;
        const tried: Plan | null = isPlaced
          ? withConduit(env, base, splitter.id, id, side)
          : placeConsumerNear(env, base, splitter.id, id, side);
        if (tried !== null && sealsNothingNew(env, tried.team)) {
          done = tried;
          used.add(side);
          break;
        }
      }
      if (done === null) {
        cur = null;
        break;
      }
      cur = done;
    }
    if (cur !== null) return cur;
  }
  return null;
}

/**
 * A collector already on the board that feeds one consumer directly shares
 * with a second: the old consumer is taken back (free, its conduit goes with
 * it), a Splitter goes after the collector and both consumers are placed
 * behind it again (CB-9e). Used when no free node is left for a collector.
 */
function connectShare(
  env: Env,
  plan: Plan,
  newId: number,
  resource: string,
): Plan | null {
  const t = plan.team;
  const splitter = t.stash.find(
    (b) =>
      b.owner === env.player &&
      (defOf(env, b.def) as { routeType?: string } | undefined)?.routeType ===
        'splitter',
  );
  const fresh = t.stash.find((b) => b.id === newId);
  if (splitter === undefined || fresh === undefined) return null;
  if (!feeds(env, t, fresh, 2)) return null;
  for (const src of t.buildings) {
    if (
      src.owner !== env.player ||
      defOf(env, src.def)?.kind !== 'source' ||
      resourceOf(env, t, src) !== resource
    ) {
      continue;
    }
    const out = t.conduits.filter(
      (c) => !isBorderEnd(c.from) && c.from.building === src.id,
    );
    const only = out[0];
    if (out.length !== 1 || only === undefined || isBorderEnd(only.to)) {
      continue;
    }
    const user = t.buildings.find(
      (b) => b.id === (only.to as { building: number }).building,
    );
    if (
      user === undefined ||
      defOf(env, user.def)?.kind === 'route' ||
      !feeds(env, t, user, 2)
    ) {
      continue;
    }
    const taken = returnToStash(t, env.content, {
      actor: env.player,
      id: user.id,
    });
    if (!taken.ok) continue;
    const base: Plan = {
      team: taken.state,
      out: [...plan.out, { type: 'return_building', id: user.id }],
    };
    const box = boxOf(env, src);
    const side = occupancy(base.team, env.content).absoluteSides(src)
      .outputs[0];
    if (side !== 'north') continue;
    const cell = outsideCell(src, box.w, box.h, side, 0);
    const s1 = withPlace(env, base, splitter.id, cell.x, cell.y);
    const s2 = s1 && withConduit(env, s1, src.id, splitter.id);
    if (s2 === null) continue;
    const used = new Set<Side>();
    let cur: Plan | null = s2;
    for (const id of [user.id, newId]) {
      const from: Plan = cur;
      const isPlaced = from.team.buildings.some((b) => b.id === id);
      let done: Plan | null = null;
      for (const sd of SPLIT_SIDES) {
        if (used.has(sd)) continue;
        const tried: Plan | null = isPlaced
          ? withConduit(env, from, splitter.id, id, sd)
          : placeConsumerNear(env, from, splitter.id, id, sd);
        if (tried !== null && sealsNothingNew(env, tried.team)) {
          done = tried;
          used.add(sd);
          break;
        }
      }
      if (done === null) {
        cur = null;
        break;
      }
      cur = done;
    }
    if (cur !== null) return cur;
  }
  return null;
}

function consumersOf(env: Env, team: TeamState, rank: (d: string) => number) {
  return [...team.buildings, ...team.stash]
    .filter((b) => {
      const d = defOf(env, b.def);
      return (
        b.owner === env.player &&
        d !== undefined &&
        d.kind !== 'route' &&
        d.kind !== 'source' &&
        d.inputs.length > 0
      );
    })
    .sort(
      (a, b) => rank(a.def) - rank(b.def) || b.tier - a.tier || a.id - b.id,
    );
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
  const env = makeEnv(team, player, content, plotWidth, style, rng);
  let plan: Plan = { team, out: [] };
  const rank = (def: string): number => {
    const i = style.priority.indexOf(def);
    return i === -1 ? style.priority.length : i;
  };
  if (style.connect) {
    const consumers = consumersOf(env, team, rank);
    for (const c of consumers) {
      if (attached(plan.team).has(c.id)) continue;
      const input = defOf(env, c.def)?.inputs[0];
      const resource = input?.resource;
      if (resource === undefined) continue;
      // Supply awareness: a consumer its collectors cannot feed is not placed.
      if (!feeds(env, plan.team, c, 1)) continue;
      // One collector for two such consumers, through a Splitter.
      const mate = consumers.find(
        (m) =>
          m.id !== c.id &&
          !attached(plan.team).has(m.id) &&
          defOf(env, m.def)?.inputs[0]?.resource === resource &&
          feeds(env, plan.team, c, 2) &&
          feeds(env, plan.team, m, 2),
      );
      if (mate !== undefined) {
        const pair = connectPair(env, plan, c.id, mate.id, resource);
        if (pair !== null) {
          plan = pair;
          continue;
        }
      }
      const done =
        connectConsumer(env, plan, c.id, resource) ??
        connectShare(env, plan, c.id, resource);
      if (done !== null) plan = done;
    }
  }
  if (style.placeLeftovers) {
    const loose = plan.team.stash
      .filter((b) => b.owner === player)
      .filter((b) => style.walls || !isWallLike(env, b.def))
      // A bot that connects does not place consumers it could not feed.
      .filter(
        (b) => !style.connect || (defOf(env, b.def)?.inputs.length ?? 0) === 0,
      )
      .sort((a, b) => rank(a.def) - rank(b.def) || a.id - b.id);
    for (const b of loose) {
      const done = placeLoose(env, plan, b.id);
      if (done !== null) plan = done;
    }
  }
  return [...plan.out];
}
