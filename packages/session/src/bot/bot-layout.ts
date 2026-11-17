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
  queryTeamMap,
  allNodes,
  returnToStash,
  rotateBuilding,
  sealedProducers,
  type BuildingDef,
  type Cell,
  type Content,
  type PlacedBuilding,
  Rng,
  type TeamState,
} from '@game/core';
import type { BoardIntent } from '../rules/types.js';

/** The Grand barracks (two collectors and a Merger feed it) and the Merger (#443). */
export const GRAND_BARRACKS = 'bld_grand_barracks';
export const MERGER = 'bld_merger';
export const LANCER_HALL = 'bld_lancer_hall';
export const MORTAR = 'bld_mortar';

/** Buildings searched for a place on the whole plot, not near their collector. */
const WIDE_TRIES = 100;
const WIDE_PLACEMENT: readonly string[] = [GRAND_BARRACKS, LANCER_HALL, MORTAR];

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
  /**
   * Nodes kept free of plain collectors, by resource, until the player has a
   * Foundry or a refinery on the board: the refining chains need nodes of two
   * resources, and the bot's own economy would take them first (issue #384).
   */
  readonly reserve?: Readonly<Record<string, number>>;
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
  const q = queryTeamMap(team, env.content.terrain);
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
  wantInput?: Side,
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
  const inputs = occ.absoluteSides(c).inputs;
  const input =
    wantInput === undefined
      ? inputs[0]
      : inputs.find((i) => i.side === wantInput);
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
export function nearby(
  env: Env,
  around: Cell,
  w: number,
  wideX = WINDOW_X,
  wideY = WINDOW_Y,
): Cell[] {
  const out: Cell[] = [];
  for (let dy = -wideY; dy <= wideY; dy++) {
    for (let dx = -wideX; dx <= wideX; dx++) {
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

/**
 * Reorder the positions of a consumer by where its kind belongs (#443); the
 * order of `positions` (nearest first) decides among equals. A Lancer hall
 * goes behind or beside one of the player's placed Barracks, else along the
 * edge of the plot; a Mortar as close to the player's Core as it can be (its
 * walls are placed in front of it by `placeLoose`).
 */
function preferred(
  env: Env,
  team: TeamState,
  def: string,
  positions: Cell[],
  size: { w: number; h: number },
): Cell[] {
  if (def === LANCER_HALL) {
    const barracks = team.buildings
      .filter((b) => b.owner === env.player && b.def === 'bld_barracks')
      .map((b) => ({ b, box: boxOf(env, b) }));
    const rank = (c: Cell): number => {
      for (const { b, box } of barracks) {
        const overlapX = c.x < b.x + box.w && b.x < c.x + size.w;
        const overlapY = c.y < b.y + box.h && b.y < c.y + size.h;
        const beside =
          overlapY && (c.x + size.w === b.x || b.x + box.w === c.x);
        const behind = overlapX && c.y + size.h === b.y;
        if (beside || behind) return 0;
      }
      return c.x === env.x0 || c.x + size.w === env.x1 ? 1 : 2;
    };
    return stableByRank(positions, rank);
  }
  if (def === MORTAR && env.core !== null) {
    const core = env.core;
    return stableByRank(
      positions,
      (c) => Math.abs(c.x - core.x) + Math.abs(c.y - core.y),
    );
  }
  return positions;
}

function stableByRank(positions: Cell[], rank: (c: Cell) => number): Cell[] {
  return positions
    .map((c, seq) => ({ c, seq, r: rank(c) }))
    .sort((a, b) => a.r - b.r || a.seq - b.seq)
    .map((e) => e.c);
}

/**
 * Every way to place a stashed consumer near a placed source and connect
 * them, nearest position first.
 */
function* consumerPlacements(
  env: Env,
  plan: Plan,
  sourceId: number,
  consumerId: number,
  wantSide?: Side,
  wantInput?: Side,
): Generator<Plan> {
  const s = plan.team.buildings.find((b) => b.id === sourceId);
  const c = plan.team.stash.find((b) => b.id === consumerId);
  if (s === undefined || c === undefined) return;
  const outSide =
    wantSide ?? occupancy(plan.team, env.content).absoluteSides(s).outputs[0];
  if (outSide === undefined) return;
  const sb = boxOf(env, s);
  const start = outsideCell(s, sb.w, sb.h, outSide, 0);
  const size = sizeOf(env, c.def);
  // A Grand barracks needs a 3x3 hole, a Lancer hall a place by a Barracks or
  // at the edge, a Mortar one by the Core: all may be farther off than the
  // usual window, so the whole plot is ranked and the best WIDE_TRIES tried
  // (#443).
  const wide = WIDE_PLACEMENT.includes(c.def);
  const ranked = preferred(
    env,
    plan.team,
    c.def,
    wide
      ? nearby(env, start, size.w, env.x1 - env.x0, plan.team.map.height)
      : nearby(env, start, size.w),
    size,
  );
  for (const pos of wide ? ranked.slice(0, WIDE_TRIES) : ranked) {
    const placed = withPlace(env, plan, consumerId, pos.x, pos.y);
    if (placed === null) continue;
    const done = withConduit(
      env,
      placed,
      sourceId,
      consumerId,
      wantSide,
      wantInput,
    );
    if (done !== null && sealsNothingNew(env, done.team)) yield done;
  }
}

/** Place a stashed consumer near a placed source and connect them. */
function placeConsumerNear(
  env: Env,
  plan: Plan,
  sourceId: number,
  consumerId: number,
  wantSide?: Side,
  wantInput?: Side,
): Plan | null {
  for (const done of consumerPlacements(
    env,
    plan,
    sourceId,
    consumerId,
    wantSide,
    wantInput,
  )) {
    return done;
  }
  return null;
}

/** Nodes of a resource inside the player's plot, free of anything. */
export function freeNodes(
  env: Env,
  team: TeamState,
  resource: string,
  /** The chain step may use the nodes kept back for it. */
  forChain = false,
): Cell[] {
  const kept = forChain ? [] : reservedNodes(env, team);
  return plotNodes(env, team, resource).filter(
    (n) => !kept.some((k) => k.x === n.x && k.y === n.y),
  );
}

function plotNodes(env: Env, team: TeamState, resource: string): Cell[] {
  const nodes: Cell[] = [];
  for (const n of allNodes(team)) {
    if (n.resource === resource && n.x >= env.x0 && n.x < env.x1) {
      nodes.push({ x: n.x, y: n.y });
    }
  }
  return nodes;
}

/**
 * The nodes the style keeps back for a refining chain (`LayoutStyle.reserve`)
 * while the player has no Foundry or refinery on the board: the last nodes
 * of each resource in reading order.
 */
function reservedNodes(env: Env, team: TeamState): Cell[] {
  if (env.style.reserve === undefined) return [];
  const built = team.buildings.some(
    (b) =>
      b.owner === env.player &&
      (defOf(env, b.def)?.kind === 'refinery' ||
        b.def === 'bld_foundry' ||
        b.def === MERGER),
  );
  if (built) return [];
  const out: Cell[] = [];
  const reserve = env.style.reserve;
  for (const resource of Object.getOwnPropertyNames(reserve).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const keep = reserve[resource] ?? 0;
    const nodes = plotNodes(env, team, resource).sort(
      (a, b) => a.y - b.y || a.x - b.x,
    );
    out.push(...nodes.slice(Math.max(0, nodes.length - keep)));
  }
  return out;
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

/** The first placed Barracks of the player (where a Lancer hall wants to be), if any. */
function lancerAnchor(env: Env, team: TeamState): Cell | undefined {
  const b = team.buildings.find(
    (x) => x.owner === env.player && x.def === 'bld_barracks',
  );
  return b === undefined ? undefined : { x: b.x, y: b.y };
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
  const need = [...t.buildings, ...t.stash].find((b) => b.id === consumerId);
  if (need === undefined) return null;
  const taken = attached(t);
  // 1. A placed extractor that feeds nothing yet, and can feed this consumer.
  const sources = t.buildings.filter(
    (b) =>
      b.owner === env.player &&
      defOf(env, b.def)?.kind === 'source' &&
      !taken.has(b.id) &&
      resourceOf(env, t, b) === resource &&
      feeds(env, need, 1, b),
  );
  for (const s of sources) {
    const done = isPlaced
      ? withConduit(env, plan, s.id, consumerId)
      : placeConsumerNear(env, plan, s.id, consumerId);
    if (done !== null && sealsNothingNew(env, done.team)) return done;
  }
  // 2. A stashed extractor, put on a free node of the resource.
  const stash = t.stash.filter(
    (b) =>
      b.owner === env.player &&
      defOf(env, b.def)?.kind === 'source' &&
      feeds(env, need, 1, b),
  );
  const first = stash[0];
  if (first === undefined) return null;
  const consumer = isPlaced
    ? t.buildings.find((b) => b.id === consumerId)
    : undefined;
  let nodes = shuffle(freeNodes(env, t, resource), env.rng);
  const hall = need.def === LANCER_HALL ? lancerAnchor(env, t) : undefined;
  if (hall !== undefined) {
    // A Lancer hall's collector goes near a Barracks, so that the hall can
    // stand behind or beside it (#443).
    nodes = nodes
      .map((node, seq) => ({ node, seq }))
      .sort(
        (a, b) =>
          Math.abs(a.node.x - hall.x) +
            Math.abs(a.node.y - hall.y) -
            (Math.abs(b.node.x - hall.x) + Math.abs(b.node.y - hall.y)) ||
          a.seq - b.seq,
      )
      .map((e) => e.node);
  }
  if (consumer !== undefined) {
    // Nearest first; equal distances keep the shuffled order.
    const dist = (n: { x: number; y: number }): number =>
      Math.abs(n.x - consumer.x) + Math.abs(n.y - consumer.y);
    nodes = nodes
      .map((node, seq) => ({ node, seq }))
      .sort((a, b) => dist(a.node) - dist(b.node) || a.seq - b.seq)
      .map((e) => e.node);
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
function scanCells(
  env: Env,
  team: TeamState,
  w: number,
  h: number,
  front?: Cell,
): Cell[] {
  const around: Cell = front ??
    env.core ?? {
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

/**
 * The cell just in front (toward the enemy, the north: units walk toward
 * higher y) of a placed Mortar of the player that has fewer than two walls in
 * front of it, or undefined: the walls go there first (#443).
 */
function mortarFront(env: Env, team: TeamState): Cell | undefined {
  for (const m of team.buildings) {
    if (m.owner !== env.player || m.def !== MORTAR) continue;
    const box = boxOf(env, m);
    const top = m.y + box.h;
    const screens = team.buildings.filter((b) => {
      if (b.owner !== env.player || !isWallLike(env, b.def)) return false;
      const bb = boxOf(env, b);
      return (
        b.x < m.x + box.w + 1 &&
        m.x - 1 < b.x + bb.w &&
        b.y >= top &&
        b.y < top + 3 &&
        b.y + bb.h > top
      );
    });
    if (screens.length < 2) {
      return { x: m.x, y: Math.min(team.map.height - 2, top + 1) };
    }
  }
  return undefined;
}

function placeLoose(env: Env, plan: Plan, id: number): Plan | null {
  const item = plan.team.stash.find((b) => b.id === id);
  if (item === undefined) return null;
  const size = sizeOf(env, item.def);
  const kind = defOf(env, item.def)?.kind;
  if (kind === 'source') return null;
  // Walls and gates keep to every other cell so the screen has gaps.
  const spaced = kind === 'defense' && item.def !== 'bld_turret';
  const kept = reservedNodes(env, plan.team);
  const front =
    kind === 'defense' && spaced ? mortarFront(env, plan.team) : undefined;
  for (const pos of scanCells(env, plan.team, size.w, size.h, front)) {
    if (spaced && (pos.x + pos.y) % 2 !== 0) continue;
    // Nothing loose goes on or around a node kept for a chain: the collector
    // there needs its output side and a way out.
    if (
      kept.some(
        (k) =>
          k.x + 1 >= pos.x &&
          k.x - 1 < pos.x + size.w &&
          k.y + 3 >= pos.y &&
          k.y - 1 < pos.y + size.h,
      )
    ) {
      continue;
    }
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

/** What the shop can still use on the player's plot, by resource. */
export interface PlotRoom {
  /** Nodes with nothing on them: where a bought collector could go. */
  readonly openNodes: ReadonlyMap<string, number>;
  /** The sum of `openNodes` over every resource. */
  readonly openNodeTotal: number;
  /** Collectors already on the board, on a node of the resource. */
  readonly placedSources: ReadonlyMap<string, number>;
  /** Of those, the ones a Splitter could still share (CB-9e): feeding nothing or one consumer straight. */
  readonly shareable: ReadonlyMap<string, number>;
}

export function plotRoom(
  team: TeamState,
  player: number,
  content: Content,
  plotWidth: number,
  /** With a style that keeps nodes back for a chain: those are not open (#443). */
  style?: LayoutStyle,
): PlotRoom {
  const x0 = player * plotWidth;
  const x1 = Math.min(team.map.width, (player + 1) * plotWidth);
  const occ = occupancy(team, content);
  const kept =
    style === undefined
      ? []
      : reservedNodes(
          {
            content,
            rng: Rng.fromSeed(1),
            style,
            player,
            x0,
            x1,
            // Not read by `reservedNodes`; the sealed-in count is slow.
            baselineSealed: 0,
            core: team.cores[player] ?? null,
          },
          team,
        );
  const openNodes = new Map<string, number>();
  let openNodeTotal = 0;
  for (const n of allNodes(team)) {
    if (n.x < x0 || n.x >= x1 || occ.buildingAt(n.x, n.y) !== null) continue;
    if (kept.some((k) => k.x === n.x && k.y === n.y)) continue;
    openNodes.set(n.resource, (openNodes.get(n.resource) ?? 0) + 1);
    openNodeTotal++;
  }
  const placedSources = new Map<string, number>();
  const shareable = new Map<string, number>();
  for (const b of team.buildings) {
    if (b.owner !== player || content.buildings.get(b.def)?.kind !== 'source') {
      continue;
    }
    const r = occ.sourceResource(b);
    if (r === undefined) continue;
    placedSources.set(r, (placedSources.get(r) ?? 0) + 1);
    const out = team.conduits.filter(
      (c) => !isBorderEnd(c.from) && c.from.building === b.id,
    );
    const to = out[0]?.to;
    const direct =
      to !== undefined &&
      !isBorderEnd(to) &&
      content.buildings.get(
        team.buildings.find((x) => x.id === to.building)?.def ?? '',
      )?.kind !== 'route';
    if (out.length === 0 || (out.length === 1 && direct)) {
      shareable.set(r, (shareable.get(r) ?? 0) + 1);
    }
  }
  return { openNodes, openNodeTotal, placedSources, shareable };
}

/**
 * Can this collector feed `parts` consumers like `c` at the minimum
 * coverage? Asked of the one collector the layout is about to use, never of
 * "the best one owned": a collector that stays in the stash feeds nothing.
 */
export function feeds(
  env: Env,
  c: { def: string; tier: number },
  parts: number,
  collector: { def: string; tier: number },
): boolean {
  const share = Math.floor(
    collectorSupply(env.content, collector.def, collector.tier) / parts,
  );
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
  fits: (collector: { def: string; tier: number }) => boolean,
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
      resourceOf(env, t, b) !== resource ||
      !fits(b)
    ) {
      continue;
    }
    const next = after(plan, b.id);
    if (next !== null) starts.push(next);
  }
  const source = t.stash.find(
    (b) => b.owner === env.player && defOf(env, b.def)?.kind === 'source',
  );
  if (source === undefined || !fits(source)) return starts;
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
  const owned = [...plan.team.buildings, ...plan.team.stash];
  const a = owned.find((b) => b.id === first);
  const b = owned.find((x) => x.id === second);
  if (splitter === undefined || a === undefined || b === undefined) {
    return null;
  }
  // The collector being split must itself have room for both consumers.
  const fits = (src: { def: string; tier: number }): boolean =>
    feeds(env, a, 2, src) && feeds(env, b, 2, src);
  for (const start of splitterStarts(env, plan, resource, splitter.id, fits)) {
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
      !feeds(env, user, 2, src) ||
      !feeds(env, fresh, 2, src)
    ) {
      continue;
    }
    // The return removes every conduit of the consumer, not only the one
    // from `src`: remember the others to wire them again.
    const others = t.conduits.filter(
      (c) =>
        c.id !== only.id &&
        ((!isBorderEnd(c.from) && c.from.building === user.id) ||
          (!isBorderEnd(c.to) && c.to.building === user.id)),
    );
    // A border link half cannot be rebuilt here: leave such a consumer be.
    if (others.some((c) => isBorderEnd(c.from) || isBorderEnd(c.to))) continue;
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
    // Reconnect the consumer's other conduits from the same collectors.
    for (const c of others) {
      if (cur === null) break;
      if (
        isBorderEnd(c.from) ||
        isBorderEnd(c.to) ||
        c.to.building !== user.id
      ) {
        cur = null;
        break;
      }
      cur = withConduit(
        env,
        cur,
        c.from.building,
        user.id,
        c.from.side,
        c.to.side,
      );
    }
    if (cur !== null) return cur;
  }
  return null;
}

/** The resources a refinery makes (refined resources). */
function refinedResources(content: Content): Set<string> {
  const out = new Set<string>();
  for (const d of content.buildings.list()) {
    const o = (d as { output?: unknown }).output;
    if (d.kind === 'refinery' && typeof o === 'string') out.add(o);
  }
  return out;
}

/**
 * Buildings the plain one-collector layout must not touch (issue #384): a
 * refinery, a building with two inputs (the Foundry) and a consumer of a
 * refined resource (the Golem forge, the Spire). They are wired as a whole by
 * the chain step, or stay in the stash.
 */
export function isChainPiece(content: Content, def: string): boolean {
  const d = content.buildings.get(def);
  // The Grand barracks and its Merger are wired as a whole too (#443).
  if (def === MERGER || def === GRAND_BARRACKS) return d !== undefined;
  if (d === undefined || d.kind === 'route' || d.kind === 'source') {
    return false;
  }
  if (d.kind === 'refinery' || d.inputs.length >= 2) return true;
  const r = d.inputs[0]?.resource;
  return r !== undefined && refinedResources(content).has(r);
}

/** Free collectors of a resource: placed and unwired, or a stashed one put on a free node. */
function* collectorStarts(
  env: Env,
  plan: Plan,
  resource: string,
  near?: Cell,
): Generator<{ plan: Plan; id: number }> {
  const t = plan.team;
  const taken = attached(t);
  for (const b of t.buildings) {
    if (
      b.owner === env.player &&
      defOf(env, b.def)?.kind === 'source' &&
      !taken.has(b.id) &&
      resourceOf(env, t, b) === resource
    ) {
      yield { plan, id: b.id };
    }
  }
  const stash = t.stash.find(
    (b) => b.owner === env.player && defOf(env, b.def)?.kind === 'source',
  );
  if (stash === undefined) return;
  let nodes = shuffle(freeNodes(env, t, resource, true), env.rng);
  if (near !== undefined) {
    nodes = nodes
      .map((node, seq) => ({ node, seq }))
      .sort(
        (a, b) =>
          Math.abs(a.node.x - near.x) +
            Math.abs(a.node.y - near.y) -
            (Math.abs(b.node.x - near.x) + Math.abs(b.node.y - near.y)) ||
          a.seq - b.seq,
      )
      .map((e) => e.node);
  }
  for (const node of nodes) {
    const placed = withPlace(env, plan, stash.id, node.x, node.y);
    if (placed !== null) yield { plan: placed, id: stash.id };
  }
}

/** Most collector choices tried for one two-input building. */
const WIRE_TRIES = 150;

/**
 * Place a stashed two-input building and give each input its own collector
 * of the right resource (a placed free one, or a stashed one on a free
 * node). Conduits never cross (CB-3g): each route avoids the cells of the
 * ones before it. `finish` completes the plan (the chain's next piece) and
 * may refuse it; the first plan it accepts is returned, else null. Nothing
 * is returned half-wired.
 */
function wireTwo(
  env: Env,
  plan: Plan,
  id: number,
  finish: (p: Plan) => Plan | null,
): Plan | null {
  const item = plan.team.stash.find((b) => b.id === id);
  const inputs = item === undefined ? [] : (defOf(env, item.def)?.inputs ?? []);
  const in0 = inputs[0];
  const in1 = inputs[1];
  if (in0?.resource === undefined || in1?.resource === undefined) return null;
  let tries = 0;
  // Anchor the building next to either input's collector first: whichever
  // fits the plot.
  for (const [first, second] of [
    [in0, in1],
    [in1, in0],
  ] as const) {
    if (first.resource === undefined || second.resource === undefined) continue;
    for (const s1 of collectorStarts(env, plan, first.resource)) {
      for (const p1 of consumerPlacements(
        env,
        s1.plan,
        s1.id,
        id,
        undefined,
        first.side,
      )) {
        const c = p1.team.buildings.find((b) => b.id === id);
        if (c === undefined) continue;
        for (const s2 of collectorStarts(env, p1, second.resource, c)) {
          if (tries++ >= WIRE_TRIES) return null;
          const p2 = withConduit(
            env,
            s2.plan,
            s2.id,
            id,
            undefined,
            second.side,
          );
          if (p2 === null || !sealsNothingNew(env, p2.team)) continue;
          const done = finish(p2);
          if (done !== null) return done;
        }
      }
    }
  }
  return null;
}

/** Wire a refinery to its two collectors and its consumer, all or nothing. */
function connectChain(
  env: Env,
  plan: Plan,
  refineryId: number,
  userId: number,
): Plan | null {
  return wireTwo(env, plan, refineryId, (p) => {
    const done = placeConsumerNear(env, p, refineryId, userId);
    return done !== null && sealsNothingNew(env, done.team) ? done : null;
  });
}

/** Wire a Merger between two collectors and a Grand barracks, all or nothing (#443). */
function connectMerged(
  env: Env,
  plan: Plan,
  barracksId: number,
  mergerId: number,
): Plan | null {
  const barracks = plan.team.stash.find((b) => b.id === barracksId);
  const resource = defOf(env, barracks?.def ?? '')?.inputs[0]?.resource;
  if (resource === undefined) return null;
  let tries = 0;
  for (const s1 of collectorStarts(env, plan, resource)) {
    // The Merger beside the first collector, which enters its west side.
    for (const p1 of consumerPlacements(
      env,
      s1.plan,
      s1.id,
      mergerId,
      undefined,
      'west',
    )) {
      const m = p1.team.buildings.find((b) => b.id === mergerId);
      if (m === undefined) continue;
      for (const s2 of collectorStarts(env, p1, resource, m)) {
        if (tries++ >= WIRE_TRIES) return null;
        const p2 = withConduit(
          env,
          s2.plan,
          s2.id,
          mergerId,
          undefined,
          'east',
        );
        if (p2 === null || !sealsNothingNew(env, p2.team)) continue;
        // The Grand barracks (a free 3x3 hole) where the Merger's output reaches.
        for (const done of consumerPlacements(env, p2, mergerId, barracksId)) {
          return done;
        }
      }
    }
  }
  return null;
}

/**
 * The chain step of the layout: every Foundry in the stash with two
 * collectors, every refinery with the consumer of its output. A chain that
 * does not fit whole stays in the stash and changes nothing.
 */
function planChains(env: Env, start: Plan): Plan {
  let plan = start;
  const stashed = () => plan.team.stash.filter((b) => b.owner === env.player);
  for (const f of stashed()) {
    const d = defOf(env, f.def);
    if (d === undefined || d.kind === 'refinery' || d.inputs.length < 2) {
      continue;
    }
    const done = wireTwo(env, plan, f.id, (p) => p);
    if (done !== null) plan = done;
  }
  for (const r of stashed()) {
    const out = (defOf(env, r.def) as { output?: string } | undefined)?.output;
    if (defOf(env, r.def)?.kind !== 'refinery' || out === undefined) continue;
    const user = stashed().find(
      (b) =>
        defOf(env, b.def)?.kind === 'unit_producer' &&
        defOf(env, b.def)?.inputs.length === 1 &&
        defOf(env, b.def)?.inputs[0]?.resource === out,
    );
    if (user === undefined) continue;
    const done = connectChain(env, plan, r.id, user.id);
    if (done !== null) plan = done;
  }
  for (const g of stashed()) {
    if (g.def !== GRAND_BARRACKS) continue;
    const merger = stashed().find((b) => b.def === MERGER);
    if (merger === undefined) continue;
    const done = connectMerged(env, plan, g.id, merger.id);
    if (done !== null) plan = done;
  }
  return plan;
}

/**
 * Would a refinery chain (or a Foundry) be placed whole on the player's plot?
 * A dry run of the layout with `extra` (the offer, the partner piece it
 * lacks, two collectors) added to the stash: true when every chain piece of
 * `extra` gets a place on the board.
 */
export function chainPlaceable(
  team: TeamState,
  player: number,
  content: Content,
  plotWidth: number,
  style: LayoutStyle,
  extra: readonly { def: string; tier: number }[],
): boolean {
  const trial = withStashed(team, player, extra);
  const intents = planLayout(
    trial,
    player,
    content,
    plotWidth,
    { ...style, placeLeftovers: false },
    Rng.fromSeed(1),
  );
  const placed = new Set<number>();
  for (const i of intents) if (i.type === 'place_building') placed.add(i.id);
  return trial.stash
    .filter((b) => b.id >= team.nextId && isChainPiece(content, b.def))
    .every((b) => placed.has(b.id));
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
        d.inputs.length > 0 &&
        !isChainPiece(env.content, b.def)
      );
    })
    .sort(
      (a, b) => rank(a.def) - rank(b.def) || b.tier - a.tier || a.id - b.id,
    );
}

/** What a bought building is for: collectors, consumers or Splitters. */
export type ProbeKind = 'collector' | 'consumer' | 'splitter';

function kindMatches(content: Content, def: string, kind: ProbeKind): boolean {
  const d = content.buildings.get(def);
  if (d === undefined) return false;
  switch (kind) {
    case 'collector':
      return d.kind === 'source';
    case 'splitter':
      return def === 'bld_splitter';
    case 'consumer':
      return d.kind !== 'route' && d.kind !== 'source' && d.inputs.length > 0;
  }
}

/** The team with `items` added to `player`'s stash (a copy, for a dry run). */
function withStashed(
  team: TeamState,
  player: number,
  items: readonly { def: string; tier: number }[],
): TeamState {
  let id = team.nextId;
  const stash = [...team.stash];
  for (const it of items) {
    stash.push({ id: id++, def: it.def, tier: it.tier, owner: player });
  }
  return { ...team, stash, nextId: id };
}

/**
 * How many of `kind` the layout step would put on the board for `player`
 * from the stash as it is, with `extra` added to it first: the same planner
 * the bot's layout step runs (`planLayout`), on a copy of the team. Placing
 * leftovers is off: only what the planner connects counts.
 */
export function plannedPlacements(
  team: TeamState,
  player: number,
  content: Content,
  plotWidth: number,
  style: LayoutStyle,
  kind: ProbeKind,
  extra: readonly { def: string; tier: number }[],
): number {
  const trial = withStashed(team, player, extra);
  const intents = planLayout(
    trial,
    player,
    content,
    plotWidth,
    { ...style, placeLeftovers: false },
    Rng.fromSeed(1),
  );
  const stashed = new Map(trial.stash.map((b) => [b.id, b.def]));
  let n = 0;
  for (const i of intents) {
    if (i.type !== 'place_building') continue;
    const def = stashed.get(i.id);
    if (def !== undefined && kindMatches(content, def, kind)) n++;
  }
  return n;
}

/**
 * Would a bought `offer` be placed, and connected, on the player's plot now?
 * A dry run: the layout plan with the offer in the stash against the plan
 * without it; the offer counts when it raises the number of buildings of its
 * kind that get placed. `context` is stashed in both plans (a consumer to
 * feed for a collector, a Splitter to share it for a consumer), so that
 * buildings that only work together can each be bought first.
 */
export function wouldPlace(
  team: TeamState,
  player: number,
  content: Content,
  plotWidth: number,
  style: LayoutStyle,
  kind: ProbeKind,
  offer: { def: string; tier: number },
  context: readonly { def: string; tier: number }[] = [],
  /** Plans without the offer, kept by the caller for one team state. */
  memo?: Map<string, number>,
): boolean {
  const key = `${kind}|${context.map((c) => `${c.def}:${String(c.tier)}`).join(',')}`;
  let base = memo?.get(key);
  if (base === undefined) {
    base = plannedPlacements(
      team,
      player,
      content,
      plotWidth,
      style,
      kind,
      context,
    );
    memo?.set(key, base);
  }
  const more = plannedPlacements(
    team,
    player,
    content,
    plotWidth,
    style,
    kind,
    [...context, offer],
  );
  return more > base;
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
    plan = planChains(env, plan);
    const consumers = consumersOf(env, plan.team, rank);
    for (const c of consumers) {
      if (attached(plan.team).has(c.id)) continue;
      const input = defOf(env, c.def)?.inputs[0];
      const resource = input?.resource;
      if (resource === undefined) continue;
      // One collector for two such consumers, through a Splitter. Whether a
      // collector feeds a consumer is asked of that collector in the connect
      // steps: a consumer none of them can feed stays in the stash.
      let paired: Plan | null = null;
      for (const m of consumers) {
        if (
          m.id === c.id ||
          attached(plan.team).has(m.id) ||
          defOf(env, m.def)?.inputs[0]?.resource !== resource
        ) {
          continue;
        }
        paired = connectPair(env, plan, c.id, m.id, resource);
        if (paired !== null) break;
      }
      if (paired !== null) {
        plan = paired;
        continue;
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
      // Nor does any bot leave a refinery on the board unwired (a weak bot
      // can be handed one by an event).
      .filter((b) => defOf(env, b.def)?.kind !== 'refinery')
      // Nor a Tunnel end: the bot has no use for them and an unpaired end
      // does nothing (#443).
      .filter((b) => {
        const d = defOf(env, b.def);
        return !(d?.kind === 'route' && d.routeType.startsWith('tunnel'));
      })
      .sort((a, b) => rank(a.def) - rank(b.def) || a.id - b.id);
    for (const b of loose) {
      const done = placeLoose(env, plan, b.id);
      if (done !== null) plan = done;
    }
  }
  return [...plan.out];
}
