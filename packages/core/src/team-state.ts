/**
 * Team state and building placement (W1-2, CP-6, CB-26, CB-27, CB-32).
 *
 * The party's whole state for combat is one board: the map, the Core
 * position, and every placed building. All functions are pure: they return a
 * new state (sharing unchanged parts) and never mutate their input. See
 * docs/rules-reference.md, "Team state and placement".
 */

import { sortedInts } from './collections.js';
import {
  allCoreCells,
  cellKey,
  coreCells,
  defBox,
  defCells,
} from './board-cells.js';
import {
  rotateBuilding,
  type BuildingDef,
  type BuildingId,
  type Rotation,
  type Side,
} from './buildings.js';
import { isRecord, isSafeInt, rejectUnknownKeys } from './load-util.js';
import {
  compareCells,
  loadMap,
  queryMap,
  queryTeamMap,
  validateCorePosition,
  type AddedNode,
  type Cell,
  type CorePositionProblem,
  type GameMap,
  type MapContent,
  type MapQuery,
} from './map.js';
import type { MapgenConfig } from './mapgen.js';
import type { ResourceId } from './resources.js';
import { decodeConduitId } from './conduit-ids.js';
import { checkConduitList, networkProblem, parseConduits } from './conduits.js';
import { tunnelPairs } from './tunnels.js';
import { parseTeamModifiers, type TeamModifier } from './modifiers.js';
import { SPECIALIST_ID_PATTERN, type SpecialistConfig } from './specialists.js';

// ---------------------------------------------------------------------------
// Types

/** A building on the board. `(x, y)` is its lowest-x, lowest-y cell. */
export interface PlacedBuilding {
  readonly id: number;
  readonly def: BuildingId;
  readonly tier: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
  readonly owner: number;
}

/** An owned building that is not on the board. */
export interface StashedBuilding {
  readonly id: number;
  readonly def: BuildingId;
  readonly tier: number;
  readonly owner: number;
}

/** One end of a conduit: a placed building and one of its absolute sides. */
export interface ConduitEnd {
  readonly building: number;
  readonly side: Side;
}

/**
 * A border spot (PP-4): row `y` of border `border` (between plots `border`
 * and `border + 1`). A conduit with a border end is a half of a link.
 */
export interface BorderEnd {
  readonly border: number;
  readonly y: number;
}

export function isBorderEnd(e: ConduitEnd | BorderEnd): e is BorderEnd {
  return 'border' in e;
}

/** The building end of a conduit end, or null for a border spot. */
export function buildingEnd(e: ConduitEnd | BorderEnd): ConduitEnd | null {
  return isBorderEnd(e) ? null : e;
}

/** Whether a conduit (or half) is attached to the building. */
export function conduitTouches(c: Conduit, building: number): boolean {
  return (
    (buildingEnd(c.from)?.building ?? -1) === building ||
    (buildingEnd(c.to)?.building ?? -1) === building
  );
}

/**
 * A conduit (W1-3), or a half of a border link (PP-4) when one end is a
 * border spot. `cells` is the ordered path from the cell just outside
 * the `from` side to the cell just outside the `to` side; it is empty for a
 * direct connection. `id` comes from the same counter as building IDs.
 */
export interface Conduit {
  readonly id: number;
  /**
   * The player who drew it (PP-1). An ordinary conduit joins two buildings of
   * this player; a half (PP-4) has one building end, of this player.
   */
  readonly owner: number;
  readonly from: ConduitEnd | BorderEnd;
  readonly to: ConduitEnd | BorderEnd;
  readonly cells: readonly Cell[];
}

export interface TeamState {
  readonly map: GameMap;
  /**
   * One entry per player (`map.partySize`): that player's Core, as its
   * lowest-x, lowest-y cell, or null before it is placed (PP-2).
   */
  readonly cores: readonly (Cell | null)[];
  /** Placed buildings, sorted by `id`. Never holds the Core. */
  readonly buildings: readonly PlacedBuilding[];
  /** Owned buildings not on the board, sorted by `id`. */
  readonly stash: readonly StashedBuilding[];
  /** The next instance ID to assign; IDs are never reused. */
  readonly nextId: number;
  /**
   * One counter per player (`map.partySize` entries, each starting at 1): the
   * `n` of that player's next conduit ID (`conduit-ids.ts`, issue #38).
   */
  readonly nextConduitId: readonly number[];
  /** Conduits, sorted by `id`. */
  readonly conduits: readonly Conduit[];
  /**
   * Run modifiers taken so far, in the order taken (W2-3, EC-8). The
   * simulation reads them. Omitted (not an empty list) when there are none, so
   * states without modifiers keep their hashes.
   */
  readonly modifiers?: readonly TeamModifier[];
  /**
   * Resource nodes added by the Rich vein event (RS-4i4), in the order added;
   * the generated ones stay in `map.nodes`. Read through `allNodes`. Omitted
   * (not an empty list) when there are none, so states without added nodes
   * keep their hashes.
   */
  readonly addedNodes?: readonly AddedNode[];
  /**
   * Each player's specialist (RS-13, CP-31): `map.partySize` entries, a
   * specialist ID or null before that player has picked. Omitted (not a list
   * of nulls) while nobody has picked, and in states made before specialists
   * existed, so those keep their hashes and play as they did.
   */
  readonly specialists?: readonly (string | null)[];
}

/**
 * What the team-state code needs from the loaded content. `specialists` is
 * optional: when given, a specialist ID must be in the roster.
 */
export type TeamContent = MapContent & {
  readonly specialists?: Pick<SpecialistConfig, 'get'>;
};

export type SpecialistReason = 'invalid_owner' | 'unknown_specialist';

/** The specialist ID of `player`, or null if the player has not picked. */
export function specialistOf(state: TeamState, player: number): string | null {
  return state.specialists?.[player] ?? null;
}

/**
 * Set (or change) a player's specialist (RS-13). `specialist` must be in the
 * roster when the content has one. The `specialists` list is dropped again
 * when every entry is null.
 */
export function setSpecialist(
  state: TeamState,
  content: TeamContent,
  player: number,
  specialist: string | null,
): OpResult<SpecialistReason> {
  if (!isOwner(player, state.map.partySize)) {
    return { ok: false, reason: 'invalid_owner' };
  }
  if (
    specialist !== null &&
    (typeof specialist !== 'string' ||
      (content.specialists !== undefined &&
        content.specialists.get(specialist) === undefined))
  ) {
    return {
      ok: false,
      reason: 'unknown_specialist',
      detail: specialist,
    };
  }
  const list = Array.from(
    { length: state.map.partySize },
    (_, i) => state.specialists?.[i] ?? null,
  );
  list[player] = specialist;
  if (list.every((e) => e === null)) {
    // Back to the form of a state without picks: no key at all.
    const rest: Record<string, unknown> = { ...state };
    delete rest['specialists'];
    return { ok: true, state: rest as unknown as TeamState };
  }
  return { ok: true, state: { ...state, specialists: list } };
}

export type PlacementReason =
  | 'unknown_building'
  | 'invalid_owner'
  | 'not_owner'
  | 'invalid_rotation'
  | 'out_of_bounds'
  | 'outside_own_plot'
  | 'blocked_by_feature'
  | 'overlaps_core'
  | 'overlaps_building'
  | 'overlaps_conduit'
  | 'source_needs_node'
  | 'node_reserved'
  | 'resource_mismatch'
  | 'would_loop';

export type CoreReason =
  | 'invalid_owner'
  | 'core_already_placed'
  | CorePositionProblem
  | 'overlaps_building'
  | 'overlaps_conduit';

export type StashReason =
  'unknown_definition' | 'core_not_allowed' | 'invalid_tier' | 'invalid_owner';

export type OpFailure<R extends string> = {
  readonly ok: false;
  readonly reason: R;
  readonly detail?: string;
};
export type OpResult<R extends string> =
  { readonly ok: true; readonly state: TeamState } | OpFailure<R>;

export type AddToStashResult =
  | { readonly ok: true; readonly state: TeamState; readonly id: number }
  | OpFailure<StashReason>;

export type AddItemToStashResult =
  | {
      readonly ok: true;
      readonly state: TeamState;
      /** The first building's ID (the entrance of a Tunnel). */
      readonly id: number;
      /** Every building added, in order. */
      readonly ids: readonly number[];
    }
  | OpFailure<StashReason>;

export type AnyReason = PlacementReason | CoreReason | StashReason;

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

// ---------------------------------------------------------------------------
// Construction

/** An empty state: no Core, no buildings, `nextId` 1. */
export function createTeamState(map: GameMap): TeamState {
  return {
    map,
    cores: new Array<null>(map.partySize).fill(null),
    buildings: [],
    stash: [],
    nextId: 1,
    nextConduitId: new Array<number>(map.partySize).fill(1),
    conduits: [],
  };
}

function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/**
 * Add a building of definition `def` to a player's stash. Rejects unknown
 * definitions, kind `core`, a tier outside 1 to 3, or an owner outside
 * `0 .. partySize - 1`. Returns the assigned instance ID.
 */
export function addToStash(
  state: TeamState,
  content: Pick<TeamContent, 'buildings'>,
  args: { def: string; tier: number; owner: number },
): AddToStashResult {
  const def = content.buildings.get(args.def);
  if (def === undefined) {
    return { ok: false, reason: 'unknown_definition', detail: args.def };
  }
  if (def.kind === 'core') return { ok: false, reason: 'core_not_allowed' };
  if (!isTier(args.tier)) return { ok: false, reason: 'invalid_tier' };
  if (!isOwner(args.owner, state.map.partySize)) {
    return { ok: false, reason: 'invalid_owner' };
  }
  const id = state.nextId;
  return {
    ok: true,
    id,
    state: {
      ...state,
      stash: [
        ...state.stash,
        { id, def: def.id, tier: args.tier, owner: args.owner },
      ],
      nextId: id + 1,
    },
  };
}

/**
 * Add one shop item to a player's stash: the building `def`, and, for a Tunnel
 * entrance, its exit as well (CB-9g: one item, two buildings, each its own
 * stash entry of the same tier). The entrance's entry comes first. Same
 * rejections as `addToStash`; nothing is added when any fails.
 */
export function addItemToStash(
  state: TeamState,
  content: Pick<TeamContent, 'buildings'>,
  args: { def: string; tier: number; owner: number },
): AddItemToStashResult {
  const first = addToStash(state, content, args);
  if (!first.ok) return first;
  const def = content.buildings.get(args.def);
  const partner =
    def !== undefined && def.kind === 'route' ? def.partner : undefined;
  if (partner === undefined) {
    return { ok: true, state: first.state, id: first.id, ids: [first.id] };
  }
  const second = addToStash(first.state, content, { ...args, def: partner });
  if (!second.ok) return second;
  return {
    ok: true,
    state: second.state,
    id: first.id,
    ids: [first.id, second.id],
  };
}

function isTier(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3;
}

function isOwner(v: unknown, partySize: number): v is number {
  return (
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < partySize
  );
}

// ---------------------------------------------------------------------------
// Geometry

// ---------------------------------------------------------------------------
// Placement rules

interface RuleContext {
  readonly q: MapQuery;
  readonly content: TeamContent;
  /** Cells of the Core, or empty before it is placed. */
  readonly coreKeys: ReadonlySet<number>;
  /** Whether a placed building other than the one being checked is on a cell. */
  readonly occupiedByOther: (x: number, y: number) => boolean;
  /** Cells of conduits that count as obstacles. */
  readonly conduitKeys: ReadonlySet<number>;
}

function makeContext(
  state: TeamState,
  content: TeamContent,
  occupiedByOther: (x: number, y: number) => boolean,
  conduitKeys: ReadonlySet<number>,
): RuleContext {
  const q = queryTeamMap(state, content.terrain);
  const coreKeys = new Set<number>();
  for (const c of allCoreCells(state.cores, content)) {
    coreKeys.add(cellKey(state.map, c.x, c.y));
  }
  return { q, content, coreKeys, occupiedByOther, conduitKeys };
}

/**
 * Check a placement for a building of player `owner`. Rules are checked in
 * this fixed order and the first failure is reported: invalid_rotation,
 * out_of_bounds, outside_own_plot, blocked_by_feature, overlaps_core,
 * overlaps_building, overlaps_conduit, source_needs_node, node_reserved.
 * (`unknown_building` and `not_owner` are checked by the caller, first.)
 */
function checkPlacement(
  ctx: RuleContext,
  def: BuildingDef,
  x: unknown,
  y: unknown,
  rotation: unknown,
  owner: number,
): OpFailure<PlacementReason> | null {
  if (!isRotation(rotation)) return { ok: false, reason: 'invalid_rotation' };
  const map = ctx.q.map;
  if (typeof x !== 'number' || typeof y !== 'number') {
    return { ok: false, reason: 'out_of_bounds' };
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { ok: false, reason: 'out_of_bounds' };
  }
  const cells = defCells(def, x, y, rotation);
  const box = defBox(def, x, y, rotation);
  if (
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.w > map.width ||
    box.y + box.h > map.height
  ) {
    return { ok: false, reason: 'out_of_bounds' };
  }
  for (const c of cells) {
    if (ctx.q.plotOf(c.x) !== owner) {
      return {
        ok: false,
        reason: 'outside_own_plot',
        detail: `(${String(c.x)}, ${String(c.y)})`,
      };
    }
  }
  for (const c of cells) {
    if (!ctx.q.isBuildable(c.x, c.y)) {
      return {
        ok: false,
        reason: 'blocked_by_feature',
        detail: `(${String(c.x)}, ${String(c.y)})`,
      };
    }
  }
  for (const c of cells) {
    if (ctx.coreKeys.has(cellKey(map, c.x, c.y))) {
      return {
        ok: false,
        reason: 'overlaps_core',
        detail: `(${String(c.x)}, ${String(c.y)})`,
      };
    }
  }
  for (const c of cells) {
    if (ctx.occupiedByOther(c.x, c.y)) {
      return {
        ok: false,
        reason: 'overlaps_building',
        detail: `(${String(c.x)}, ${String(c.y)})`,
      };
    }
  }
  for (const c of cells) {
    if (ctx.conduitKeys.has(cellKey(map, c.x, c.y))) {
      return {
        ok: false,
        reason: 'overlaps_conduit',
        detail: `(${String(c.x)}, ${String(c.y)})`,
      };
    }
  }
  if (def.kind === 'source') {
    let resource: ResourceId | undefined;
    for (const c of cells) {
      const r = ctx.q.nodeAt(c.x, c.y);
      if (r === undefined || (resource !== undefined && r !== resource)) {
        return {
          ok: false,
          reason: 'source_needs_node',
          detail: `(${String(c.x)}, ${String(c.y)})`,
        };
      }
      resource = r;
    }
  } else {
    for (const c of cells) {
      if (ctx.q.nodeAt(c.x, c.y) !== undefined) {
        return {
          ok: false,
          reason: 'node_reserved',
          detail: `(${String(c.x)}, ${String(c.y)})`,
        };
      }
    }
  }
  return null;
}

/** A lookup of cells covered by placed buildings, optionally skipping one. */
function buildingCellIndex(
  state: TeamState,
  content: TeamContent,
): Map<number, number> {
  const index = new Map<number, number>();
  for (const b of state.buildings) {
    const def = content.buildings.get(b.def);
    if (def === undefined) continue;
    for (const c of defCells(def, b.x, b.y, b.rotation)) {
      if (
        c.x >= 0 &&
        c.y >= 0 &&
        c.x < state.map.width &&
        c.y < state.map.height
      ) {
        index.set(cellKey(state.map, c.x, c.y), b.id);
      }
    }
  }
  return index;
}

function sortById<T extends { id: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------
// Conduits attached to buildings

/** The cells of the given conduits, as cell keys. Out-of-bounds cells are skipped. */
function conduitCellKeys(
  map: GameMap,
  conduits: readonly Conduit[],
  skipBuilding?: number,
): Set<number> {
  const keys = new Set<number>();
  for (const c of conduits) {
    if (skipBuilding !== undefined && conduitTouches(c, skipBuilding)) {
      continue;
    }
    for (const cell of c.cells) {
      if (
        cell.x >= 0 &&
        cell.y >= 0 &&
        cell.x < map.width &&
        cell.y < map.height
      ) {
        keys.add(cellKey(map, cell.x, cell.y));
      }
    }
  }
  return keys;
}

/**
 * Remove every conduit whose `from` or `to` is the given building. Moving,
 * rotating or returning a building does this. Returns the same state object
 * when nothing is attached.
 */
export function detachConduits(
  state: TeamState,
  buildingId: number,
): TeamState {
  const kept = state.conduits.filter((c) => !conduitTouches(c, buildingId));
  return kept.length === state.conduits.length
    ? state
    : { ...state, conduits: kept };
}

/** Whether `actor` is an integer player index of this board. */
function isActor(state: TeamState, actor: unknown): actor is number {
  return (
    typeof actor === 'number' &&
    Number.isInteger(actor) &&
    actor >= 0 &&
    actor < state.map.partySize
  );
}

/**
 * Delete one conduit by ID. Free. Reasons, in order: unknown_conduit,
 * invalid_owner, not_owner (PP-1). With `reclaimId` (undo of an add, RS-5g)
 * the newest ID is handed back: if the conduit is the owner's newest (its
 * counter value is one below the owner's counter), that counter goes back by
 * one; otherwise the counters are left alone.
 */
export function eraseConduit(
  state: TeamState,
  args: { actor: number; id: number; reclaimId?: boolean },
): OpResult<'unknown_conduit' | 'invalid_owner' | 'not_owner'> {
  const conduit = state.conduits.find((c) => c.id === args.id);
  if (conduit === undefined) return { ok: false, reason: 'unknown_conduit' };
  if (!isActor(state, args.actor))
    return { ok: false, reason: 'invalid_owner' };
  if (conduit.owner !== args.actor) return { ok: false, reason: 'not_owner' };
  return {
    ok: true,
    state: {
      ...state,
      conduits: state.conduits.filter((c) => c.id !== args.id),
      nextConduitId:
        args.reclaimId === true &&
        decodeConduitId(conduit.id).n ===
          (state.nextConduitId[conduit.owner] ?? 0) - 1
          ? state.nextConduitId.map((n, i) => (i === conduit.owner ? n - 1 : n))
          : state.nextConduitId,
    },
  };
}

// ---------------------------------------------------------------------------
// Operations

/**
 * Place player `actor`'s Core. It works once per player (PP-2). Reasons, in
 * order: invalid_owner, core_already_placed, then those of
 * `validateCorePosition` (out_of_bounds, outside_own_plot, blocked, on_node,
 * too_far_forward), then overlaps_building, overlaps_conduit.
 */
export function placeCore(
  state: TeamState,
  content: TeamContent,
  config: MapgenConfig,
  actor: number,
  pos: { x: number; y: number },
): OpResult<CoreReason> {
  if (!Number.isInteger(actor) || actor < 0 || actor >= state.cores.length) {
    return { ok: false, reason: 'invalid_owner' };
  }
  if (state.cores[actor] !== null) {
    return { ok: false, reason: 'core_already_placed' };
  }
  const check = validateCorePosition(state.map, content, config, actor, pos);
  if (!check.ok) return { ok: false, reason: check.reason };
  const mine = coreCells(pos, content).map((c) => cellKey(state.map, c.x, c.y));
  const index = buildingCellIndex(state, content);
  for (const k of mine) {
    if (index.has(k)) return { ok: false, reason: 'overlaps_building' };
  }
  const onConduit = conduitCellKeys(state.map, state.conduits);
  for (const k of mine) {
    if (onConduit.has(k)) return { ok: false, reason: 'overlaps_conduit' };
  }
  const cores = state.cores.map((c, p) =>
    p === actor ? { x: pos.x, y: pos.y } : c,
  );
  return { ok: true, state: { ...state, cores } };
}

/** invalid_owner, then not_owner, for an `actor` acting on `owner`'s building. */
function checkActor(
  state: TeamState,
  actor: unknown,
  owner: number,
): OpFailure<'invalid_owner' | 'not_owner'> | null {
  if (!isActor(state, actor)) return { ok: false, reason: 'invalid_owner' };
  if (actor !== owner) return { ok: false, reason: 'not_owner' };
  return null;
}

/**
 * Place a stashed building on the board. Free. Reasons, in order:
 * unknown_building, invalid_owner, not_owner, then those of `checkPlacement`,
 * then, for a Tunnel end only, resource_mismatch and would_loop (the pair it
 * brings into being is a conduit segment, CB-9g).
 */
export function placeFromStash(
  state: TeamState,
  content: TeamContent,
  args: { actor: number; id: number; x: number; y: number; rotation: number },
): OpResult<PlacementReason> {
  const item = state.stash.find((s) => s.id === args.id);
  const def = item === undefined ? undefined : content.buildings.get(item.def);
  if (item === undefined || def === undefined) {
    return { ok: false, reason: 'unknown_building' };
  }
  const denied = checkActor(state, args.actor, item.owner);
  if (denied !== null) return denied;
  const index = buildingCellIndex(state, content);
  const ctx = makeContext(
    state,
    content,
    (x, y) => index.has(cellKey(state.map, x, y)),
    conduitCellKeys(state.map, state.conduits),
  );
  const failure = checkPlacement(
    ctx,
    def,
    args.x,
    args.y,
    args.rotation,
    item.owner,
  );
  if (failure !== null) return failure;
  const placed: PlacedBuilding = {
    id: item.id,
    def: item.def,
    tier: item.tier,
    x: args.x,
    y: args.y,
    rotation: args.rotation as Rotation,
    owner: item.owner,
  };
  const next: TeamState = {
    ...state,
    stash: state.stash.filter((s) => s.id !== item.id),
    buildings: sortById([...state.buildings, placed]),
  };
  const pairing = tunnelNetworkFailure(next, content, def);
  if (pairing !== null) return pairing;
  return { ok: true, state: next };
}

/**
 * A Tunnel end that is placed or moved can bring a pair into being, and the
 * pair is a conduit segment (CB-9g): it must not close a loop (CB-9c) or carry
 * a resource a building at the other end refuses (CB-5b). Other buildings
 * cannot change the pairing, so they are not checked.
 */
function tunnelNetworkFailure(
  next: TeamState,
  content: TeamContent,
  def: BuildingDef,
): OpFailure<'resource_mismatch' | 'would_loop'> | null {
  if (
    def.kind !== 'route' ||
    (def.routeType !== 'tunnel_in' && def.routeType !== 'tunnel_out')
  ) {
    return null;
  }
  const problem = networkProblem(next, content);
  if (problem === null) return null;
  return {
    ok: false,
    reason: problem.reason,
    ...(problem.detail === undefined ? {} : { detail: problem.detail }),
  };
}

/**
 * Move and/or rotate a placed building in one step. The building's own
 * current cells do not count as overlap. Attached conduits are removed
 * (detachConduits). Free. A Tunnel end is checked as in `placeFromStash`.
 */
export function moveBuilding(
  state: TeamState,
  content: TeamContent,
  args: { actor: number; id: number; x: number; y: number; rotation: number },
): OpResult<PlacementReason> {
  const item = state.buildings.find((b) => b.id === args.id);
  const def = item === undefined ? undefined : content.buildings.get(item.def);
  if (item === undefined || def === undefined) {
    return { ok: false, reason: 'unknown_building' };
  }
  const denied = checkActor(state, args.actor, item.owner);
  if (denied !== null) return denied;
  const index = buildingCellIndex(state, content);
  const ctx = makeContext(
    state,
    content,
    (x, y) => {
      const other = index.get(cellKey(state.map, x, y));
      return other !== undefined && other !== item.id;
    },
    // Conduits attached to the moving building are detached on success, so
    // they do not block it.
    conduitCellKeys(state.map, state.conduits, item.id),
  );
  const failure = checkPlacement(
    ctx,
    def,
    args.x,
    args.y,
    args.rotation,
    item.owner,
  );
  if (failure !== null) return failure;
  const moved: PlacedBuilding = {
    ...item,
    x: args.x,
    y: args.y,
    rotation: args.rotation as Rotation,
  };
  const next: TeamState = {
    ...state,
    buildings: state.buildings.map((b) => (b.id === item.id ? moved : b)),
  };
  const detached = detachConduits(next, item.id);
  const pairing = tunnelNetworkFailure(detached, content, def);
  if (pairing !== null) return pairing;
  return { ok: true, state: detached };
}

/**
 * Take a placed building off the board into the stash. Free. Taking a Tunnel
 * end away can let another end pair in its place (a nearer exit hid a farther
 * one): that is refused with `would_loop` or `resource_mismatch` when the new
 * pair would close a loop or carry a resource its end refuses (CB-9g).
 */
export function returnToStash(
  state: TeamState,
  content: TeamContent,
  args: { actor: number; id: number },
): OpResult<
  | 'unknown_building'
  | 'invalid_owner'
  | 'not_owner'
  | 'would_loop'
  | 'resource_mismatch'
> {
  const item = state.buildings.find((b) => b.id === args.id);
  if (item === undefined) return { ok: false, reason: 'unknown_building' };
  const denied = checkActor(state, args.actor, item.owner);
  if (denied !== null) return denied;
  const next: TeamState = {
    ...state,
    buildings: state.buildings.filter((b) => b.id !== item.id),
    stash: sortById([
      ...state.stash,
      { id: item.id, def: item.def, tier: item.tier, owner: item.owner },
    ]),
  };
  const detached = detachConduits(next, item.id);
  const def = content.buildings.get(item.def);
  if (def !== undefined) {
    const pairing = tunnelNetworkFailure(detached, content, def);
    if (pairing !== null) return pairing;
  }
  return { ok: true, state: detached };
}

export type RaiseTierReason = 'unknown_building' | 'invalid_tier';

/**
 * Raise one owned building (placed or in the stash) by one tier, never above
 * 3 (the Workshop event, W2-3); a building already at tier 3 gives
 * `invalid_tier`. Position, rotation, owner and conduits stay as
 * they are. This never adds a building.
 */
export function raiseTier(
  state: TeamState,
  args: { id: number },
): OpResult<RaiseTierReason> {
  const placed = state.buildings.find((b) => b.id === args.id);
  if (placed !== undefined) {
    if (placed.tier >= 3) return { ok: false, reason: 'invalid_tier' };
    return {
      ok: true,
      state: {
        ...state,
        buildings: state.buildings.map((b) =>
          b.id === args.id ? { ...b, tier: b.tier + 1 } : b,
        ),
      },
    };
  }
  const stashed = state.stash.find((b) => b.id === args.id);
  if (stashed === undefined) return { ok: false, reason: 'unknown_building' };
  if (stashed.tier >= 3) return { ok: false, reason: 'invalid_tier' };
  return {
    ok: true,
    state: {
      ...state,
      stash: state.stash.map((b) =>
        b.id === args.id ? { ...b, tier: b.tier + 1 } : b,
      ),
    },
  };
}

/** Delete a stash entry (used later for selling). */
export function removeFromStash(
  state: TeamState,
  args: { actor: number; id: number },
): OpResult<'unknown_building' | 'invalid_owner' | 'not_owner'> {
  const item = state.stash.find((s) => s.id === args.id);
  if (item === undefined) return { ok: false, reason: 'unknown_building' };
  const denied = checkActor(state, args.actor, item.owner);
  if (denied !== null) return denied;
  return {
    ok: true,
    state: { ...state, stash: state.stash.filter((s) => s.id !== args.id) },
  };
}

// ---------------------------------------------------------------------------
// Queries

export interface Occupancy {
  /** The placed building on a cell, `'core'` for the Core, else null. */
  buildingAt(
    x: number,
    y: number,
  ): PlacedBuilding | { readonly core: number } | null;
  /** The absolute cells a placed building covers, in `(y, x)` order. */
  cellsOf(instance: PlacedBuilding): Cell[];
  /** Absolute input sides (with resources) and output sides at its rotation. */
  absoluteSides(instance: PlacedBuilding): {
    readonly inputs: readonly { side: Side; resource?: ResourceId }[];
    readonly outputs: readonly Side[];
  };
  /** The resource a placed source produces (its node's), else undefined. */
  sourceResource(instance: PlacedBuilding): ResourceId | undefined;
}

/**
 * Index a (valid) state once for cell lookups. Throws on a building whose
 * definition is unknown; run `validateTeamState` on untrusted data first.
 */
export function occupancy(state: TeamState, content: TeamContent): Occupancy {
  const q = queryTeamMap(state, content.terrain);
  const defOf = (b: PlacedBuilding): BuildingDef => {
    const def = content.buildings.get(b.def);
    if (def === undefined) throw new Error(`Unknown building "${b.def}".`);
    return def;
  };
  const cellsOf = (b: PlacedBuilding): Cell[] =>
    defCells(defOf(b), b.x, b.y, b.rotation);
  const byCell = new Map<number, PlacedBuilding>();
  for (const b of state.buildings) {
    for (const c of cellsOf(b)) byCell.set(cellKey(state.map, c.x, c.y), b);
  }
  const coreAt = new Map<number, number>(); // cell -> player
  state.cores.forEach((core, p) => {
    if (core === null) return;
    for (const c of coreCells(core, content)) {
      coreAt.set(cellKey(state.map, c.x, c.y), p);
    }
  });
  return {
    buildingAt: (x, y) => {
      if (!q.isInBounds(x, y)) return null;
      const k = cellKey(state.map, x, y);
      const b = byCell.get(k);
      if (b !== undefined) return b;
      const p = coreAt.get(k);
      return p === undefined ? null : { core: p };
    },
    cellsOf,
    absoluteSides: (b) => {
      const r = rotateBuilding(defOf(b), b.rotation);
      return { inputs: r.inputs, outputs: r.outputs };
    },
    sourceResource: (b) => {
      if (defOf(b).kind !== 'source') return undefined;
      return q.nodeAt(b.x, b.y);
    },
  };
}

// ---------------------------------------------------------------------------
// Added nodes (Rich vein, RS-4i4)

export type AddNodeReason =
  | 'invalid_owner'
  | 'unknown_resource'
  | 'invalid_round'
  | 'out_of_bounds'
  | 'outside_own_plot'
  | 'front_row'
  | 'blocked_by_feature'
  | 'node_here'
  | 'overlaps_core'
  | 'overlaps_building'
  | 'overlaps_conduit'
  | 'plot_full';

/**
 * The cell rules of an added node that do not depend on the buildings: in
 * bounds, in the owner's plot, not on the plot's front `frontMargin` rows, no
 * natural feature that blocks building, no generated node, no added node,
 * not a Core cell. `taken` holds the keys of generated and added nodes.
 */
function nodeCellProblem(
  map: GameMap,
  q: MapQuery,
  config: MapgenConfig,
  taken: ReadonlySet<number>,
  coreKeys: ReadonlySet<number>,
  owner: number,
  x: number,
  y: number,
): AddNodeReason | null {
  if (!q.isInBounds(x, y)) return 'out_of_bounds';
  if (q.plotOf(x) !== owner) return 'outside_own_plot';
  if (y > map.height - 1 - config.frontMargin) return 'front_row';
  if (!q.isBuildable(x, y)) return 'blocked_by_feature';
  const k = cellKey(map, x, y);
  if (taken.has(k)) return 'node_here';
  if (coreKeys.has(k)) return 'overlaps_core';
  return null;
}

function nodeKeys(state: TeamState): Set<number> {
  const keys = new Set<number>();
  for (const n of state.map.nodes) keys.add(cellKey(state.map, n.x, n.y));
  for (const n of state.addedNodes ?? []) {
    keys.add(cellKey(state.map, n.x, n.y));
  }
  return keys;
}

function coreKeysOf(state: TeamState, content: TeamContent): Set<number> {
  const keys = new Set<number>();
  for (const c of allCoreCells(state.cores, content)) {
    keys.add(cellKey(state.map, c.x, c.y));
  }
  return keys;
}

/** How many nodes were added to a player's plot. */
export function addedNodeCount(state: TeamState, owner: number): number {
  let n = 0;
  for (const a of state.addedNodes ?? []) if (a.owner === owner) n++;
  return n;
}

/**
 * Every cell where `owner` may add a node now, in `(y, x)` order: the cell
 * rules of `nodeCellProblem`, plus no placed building and no conduit on it.
 * Empty once the plot holds `maxAddedNodesPerPlot` added nodes.
 */
export function addableNodeCells(
  state: TeamState,
  content: TeamContent,
  config: MapgenConfig,
  owner: number,
): Cell[] {
  if (!isOwner(owner, state.map.partySize)) return [];
  if (addedNodeCount(state, owner) >= config.maxAddedNodesPerPlot) return [];
  const map = state.map;
  const q = queryTeamMap(state, content.terrain);
  const taken = nodeKeys(state);
  const coreKeys = coreKeysOf(state, content);
  const occ = occupancy(state, content);
  const onConduit = conduitCellKeys(map, state.conduits);
  const out: Cell[] = [];
  const x0 = owner * map.plotWidth;
  for (let y = 0; y <= map.height - 1 - config.frontMargin; y++) {
    for (let x = x0; x < x0 + map.plotWidth; x++) {
      if (
        nodeCellProblem(map, q, config, taken, coreKeys, owner, x, y) ===
          null &&
        occ.buildingAt(x, y) === null &&
        !onConduit.has(cellKey(map, x, y))
      ) {
        out.push({ x, y });
      }
    }
  }
  return out.sort(compareCells);
}

/**
 * Add a node of `resource` to `owner`'s plot at `(x, y)` (Rich vein). Rules,
 * first failure reported: invalid_owner, unknown_resource (not a base
 * resource), invalid_round, then the cell rules (out_of_bounds,
 * outside_own_plot, front_row, blocked_by_feature, node_here, overlaps_core),
 * overlaps_building, overlaps_conduit, and plot_full (the plot already holds
 * `maxAddedNodesPerPlot` added nodes).
 */
export function addNode(
  state: TeamState,
  content: TeamContent,
  config: MapgenConfig,
  args: {
    readonly owner: number;
    readonly x: number;
    readonly y: number;
    readonly resource: ResourceId;
    readonly round: number;
  },
): OpResult<AddNodeReason> {
  const { owner, x, y, resource, round } = args;
  const map = state.map;
  if (!isOwner(owner, map.partySize))
    return { ok: false, reason: 'invalid_owner' };
  if (!content.resources.listBase().some((r) => r.id === resource)) {
    return { ok: false, reason: 'unknown_resource', detail: resource };
  }
  if (!isSafeInt(round) || round < 1)
    return { ok: false, reason: 'invalid_round' };
  if (!isSafeInt(x) || !isSafeInt(y))
    return { ok: false, reason: 'out_of_bounds' };
  const q = queryTeamMap(state, content.terrain);
  const cell = nodeCellProblem(
    map,
    q,
    config,
    nodeKeys(state),
    coreKeysOf(state, content),
    owner,
    x,
    y,
  );
  if (cell !== null) return { ok: false, reason: cell };
  if (occupancy(state, content).buildingAt(x, y) !== null) {
    return { ok: false, reason: 'overlaps_building' };
  }
  if (conduitCellKeys(map, state.conduits).has(cellKey(map, x, y))) {
    return { ok: false, reason: 'overlaps_conduit' };
  }
  if (addedNodeCount(state, owner) >= config.maxAddedNodesPerPlot) {
    return { ok: false, reason: 'plot_full' };
  }
  return {
    ok: true,
    state: {
      ...state,
      addedNodes: [
        ...(state.addedNodes ?? []),
        { x, y, resource, owner, round },
      ],
    },
  };
}

/**
 * Parse the `specialists` field of untrusted data: omitted, or exactly one
 * entry per player, each null or a specialist ID of the roster (when the
 * content has one). An all-null list is refused: the field is omitted then.
 */
function parseSpecialists(
  raw: unknown,
  partySize: number,
  content: TeamContent,
  errors: string[],
): readonly (string | null)[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length !== partySize) {
    errors.push(
      `specialists: must be a list of ${String(partySize)} entries (one per player), or omitted.`,
    );
    return undefined;
  }
  const out: (string | null)[] = [];
  raw.forEach((e: unknown, i) => {
    if (e === null) {
      out.push(null);
    } else if (typeof e !== 'string' || !SPECIALIST_ID_PATTERN.test(e)) {
      errors.push(
        `specialists[${String(i)}]: must be null or a specialist ID.`,
      );
      out.push(null);
    } else if (
      content.specialists !== undefined &&
      content.specialists.get(e) === undefined
    ) {
      errors.push(`specialists[${String(i)}]: unknown specialist "${e}".`);
      out.push(null);
    } else {
      out.push(e);
    }
  });
  if (out.every((e) => e === null)) {
    errors.push('specialists: must be omitted when nobody has picked.');
    return undefined;
  }
  return out;
}

const ADDED_NODE_KEYS = new Set(['x', 'y', 'resource', 'owner', 'round']);

/** Parse the `addedNodes` field of untrusted data (shape only). */
function parseAddedNodes(
  raw: unknown,
  errors: string[],
): readonly AddedNode[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('addedNodes: must be a non-empty list, or omitted.');
    return undefined;
  }
  const out: AddedNode[] = [];
  (raw as unknown[]).forEach((e, i) => {
    const at = `addedNodes[${String(i)}]`;
    if (!isRecord(e)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    rejectUnknownKeys(e, ADDED_NODE_KEYS, at, errors);
    if (
      isSafeInt(e['x']) &&
      isSafeInt(e['y']) &&
      isSafeInt(e['owner']) &&
      isSafeInt(e['round']) &&
      typeof e['resource'] === 'string'
    ) {
      out.push({
        x: e['x'],
        y: e['y'],
        resource: e['resource'],
        owner: e['owner'],
        round: e['round'],
      });
    } else {
      errors.push(
        `${at}: "x", "y", "owner" and "round" must be integers and "resource" a resource ID.`,
      );
    }
  });
  return out;
}

/**
 * Re-check the added nodes of a state: each in its owner's plot on a legal
 * cell, no cell twice, a base resource, at most `maxAddedNodesPerPlot` per
 * plot, rounds not decreasing. (A building or conduit on the cell is judged
 * by the placement rules, which see the node.)
 */
function checkAddedNodes(
  nodes: readonly AddedNode[],
  map: GameMap,
  content: TeamContent,
  config: MapgenConfig,
  coresOk: boolean,
  coreKeys: ReadonlySet<number>,
  errors: string[],
): void {
  const q = queryMap(map, content.terrain);
  const taken = new Set<number>();
  for (const n of map.nodes) taken.add(cellKey(map, n.x, n.y));
  const perOwner = new Map<number, number>();
  const base = new Set(content.resources.listBase().map((r) => r.id));
  let lastRound = 0;
  nodes.forEach((n, i) => {
    const at = `addedNodes[${String(i)}]`;
    if (!isOwner(n.owner, map.partySize)) {
      errors.push(
        `${at}: "owner" must be an integer from 0 to ${String(map.partySize - 1)}.`,
      );
      return;
    }
    if (!base.has(n.resource)) {
      errors.push(`${at}: "${n.resource}" is not a base resource.`);
    }
    if (n.round < 1) errors.push(`${at}: "round" must be at least 1.`);
    if (n.round < lastRound) errors.push(`${at}: rounds must not decrease.`);
    lastRound = Math.max(lastRound, n.round);
    const problem = nodeCellProblem(
      map,
      q,
      config,
      taken,
      coresOk ? coreKeys : new Set<number>(),
      n.owner,
      n.x,
      n.y,
    );
    if (problem !== null) {
      errors.push(
        `${at}: illegal cell (${String(n.x)}, ${String(n.y)}): ${problem}.`,
      );
    } else {
      taken.add(cellKey(map, n.x, n.y));
    }
    const count = (perOwner.get(n.owner) ?? 0) + 1;
    perOwner.set(n.owner, count);
    if (count === config.maxAddedNodesPerPlot + 1) {
      errors.push(
        `${at}: player ${String(n.owner)} has more than ${String(config.maxAddedNodesPerPlot)} added nodes.`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Whole-state validation

export type ValidateTeamStateResult =
  | { readonly ok: true; readonly state: TeamState }
  | { readonly ok: false; readonly errors: readonly string[] };

const STATE_KEYS = new Set([
  'map',
  'cores',
  'buildings',
  'stash',
  'nextId',
  'nextConduitId',
  'conduits',
  'modifiers',
  'addedNodes',
  'specialists',
]);
const PLACED_KEYS = new Set([
  'id',
  'def',
  'tier',
  'x',
  'y',
  'rotation',
  'owner',
]);
const STASH_KEYS = new Set(['id', 'def', 'tier', 'owner']);

/** Checks the fields shared by placed and stashed entries. */
function checkEntryCommon(
  rec: Record<string, unknown>,
  at: string,
  partySize: number,
  content: Pick<TeamContent, 'buildings'>,
  errors: string[],
): BuildingDef | undefined {
  let def: BuildingDef | undefined;
  if (!isSafeInt(rec['id']) || rec['id'] < 1) {
    errors.push(`${at}: "id" must be a positive integer.`);
  }
  const defId = rec['def'];
  if (typeof defId !== 'string') {
    errors.push(`${at}: "def" must be a building ID.`);
  } else {
    def = content.buildings.get(defId);
    if (def === undefined) errors.push(`${at}: unknown building "${defId}".`);
    else if (def.kind === 'core') {
      errors.push(`${at}: buildings of kind "core" are not allowed here.`);
    }
  }
  if (!isTier(rec['tier'])) errors.push(`${at}: "tier" must be 1, 2 or 3.`);
  if (!isOwner(rec['owner'], partySize)) {
    errors.push(
      `${at}: "owner" must be an integer from 0 to ${String(partySize - 1)}.`,
    );
  }
  return def;
}

/**
 * Validate untrusted data as a team state, re-checking everything
 * independently of how it was built. Never throws. On success returns a
 * normalised copy of the state.
 */
export function validateTeamState(
  data: unknown,
  content: TeamContent,
  config: MapgenConfig,
): ValidateTeamStateResult {
  const errors: string[] = [];
  try {
    const state = validateInner(data, content, config, errors);
    if (errors.length === 0 && state !== undefined) return { ok: true, state };
  } catch (e) {
    errors.push(
      `state: could not be checked (${e instanceof Error ? e.message : 'unknown error'}).`,
    );
  }
  if (errors.length === 0) errors.push('state: invalid.');
  return { ok: false, errors };
}

/**
 * Tunnel pairs (CB-9g) are derived from placement, so a state cannot store a
 * wrong one; this re-checks the derived pairing anyway (it is the one the
 * flow uses): every pair has an entrance and an exit of one owner, both in
 * that owner's plot, and no end is in two pairs (an exit claimed twice).
 * Ends outside the owner's plot are refused by the placement rules.
 */
function checkTunnelPairs(
  state: TeamState,
  content: TeamContent,
  errors: string[],
): void {
  const pairs = tunnelPairs(state, content);
  if (pairs.length === 0) return;
  const q = queryTeamMap(state, content.terrain);
  const owner = new Map(state.buildings.map((b) => [b.id, b]));
  const entrances = new Set<number>();
  const exits = new Set<number>();
  for (const p of pairs) {
    const a = owner.get(p.entrance);
    const b = owner.get(p.exit);
    if (
      a === undefined ||
      b === undefined ||
      a.owner !== b.owner ||
      q.plotOf(a.x) !== a.owner ||
      q.plotOf(b.x) !== b.owner
    ) {
      errors.push(
        `tunnels: the pair of building ${String(p.entrance)} and ${String(p.exit)} is not inside one owner's plot.`,
      );
    }
    if (entrances.has(p.entrance)) {
      errors.push(`tunnels: entrance ${String(p.entrance)} is in two pairs.`);
    }
    if (exits.has(p.exit)) {
      errors.push(`tunnels: exit ${String(p.exit)} is claimed twice.`);
    }
    entrances.add(p.entrance);
    exits.add(p.exit);
  }
}

function validateInner(
  data: unknown,
  content: TeamContent,
  config: MapgenConfig,
  errors: string[],
): TeamState | undefined {
  if (!isRecord(data)) {
    errors.push('state: must be an object.');
    return undefined;
  }
  rejectUnknownKeys(data, STATE_KEYS, 'state', errors);

  const mapResult = loadMap(data['map'], content);
  if (!mapResult.ok) {
    for (const e of mapResult.errors) errors.push(`map: ${e}`);
    return undefined;
  }
  const map = mapResult.config;
  const addedNodes = parseAddedNodes(data['addedNodes'], errors);
  const q = queryMap(map, content.terrain, addedNodes ?? []);

  // Cores
  const cores: (Cell | null)[] = [];
  let coresOk = true;
  const rawCores = data['cores'];
  if (!Array.isArray(rawCores) || rawCores.length !== map.partySize) {
    errors.push(
      `cores: must be a list of ${String(map.partySize)} entries (one per player).`,
    );
    coresOk = false;
  } else {
    rawCores.forEach((raw: unknown, p) => {
      if (raw === null) {
        cores.push(null);
      } else if (
        !isRecord(raw) ||
        !isSafeInt(raw['x']) ||
        !isSafeInt(raw['y'])
      ) {
        errors.push(
          `cores[${String(p)}]: must be null or { x, y } of integers.`,
        );
        cores.push(null);
        coresOk = false;
      } else {
        rejectUnknownKeys(
          raw,
          new Set(['x', 'y']),
          `cores[${String(p)}]`,
          errors,
        );
        const core = { x: raw['x'], y: raw['y'] };
        cores.push(core);
        const check = validateCorePosition(map, content, config, p, core);
        if (!check.ok) {
          errors.push(
            `cores[${String(p)}]: illegal position (${String(core.x)}, ${String(core.y)}): ${check.reason}.`,
          );
          coresOk = false;
        }
      }
    });
  }

  // Lists
  const placed: PlacedBuilding[] = [];
  const stash: StashedBuilding[] = [];
  const defs = new Map<number, BuildingDef>();
  const rawBuildings = data['buildings'];
  if (!Array.isArray(rawBuildings)) {
    errors.push('buildings: must be an array.');
  } else {
    (rawBuildings as unknown[]).forEach((entry, i) => {
      const at = `buildings[${String(i)}]`;
      if (!isRecord(entry)) {
        errors.push(`${at}: must be an object.`);
        return;
      }
      rejectUnknownKeys(entry, PLACED_KEYS, at, errors);
      const def = checkEntryCommon(entry, at, map.partySize, content, errors);
      if (!isSafeInt(entry['x']) || !isSafeInt(entry['y'])) {
        errors.push(`${at}: "x" and "y" must be integers.`);
      }
      if (!isRotation(entry['rotation'])) {
        errors.push(`${at}: "rotation" must be 0, 90, 180 or 270.`);
      }
      if (
        def !== undefined &&
        def.kind !== 'core' &&
        isSafeInt(entry['id']) &&
        isSafeInt(entry['x']) &&
        isSafeInt(entry['y']) &&
        isRotation(entry['rotation']) &&
        isTier(entry['tier']) &&
        typeof entry['def'] === 'string' &&
        isSafeInt(entry['owner'])
      ) {
        placed.push({
          id: entry['id'],
          def: entry['def'],
          tier: entry['tier'],
          x: entry['x'],
          y: entry['y'],
          rotation: entry['rotation'],
          owner: entry['owner'],
        });
        defs.set(entry['id'], def);
      }
    });
  }
  const rawStash = data['stash'];
  if (!Array.isArray(rawStash)) {
    errors.push('stash: must be an array.');
  } else {
    (rawStash as unknown[]).forEach((entry, i) => {
      const at = `stash[${String(i)}]`;
      if (!isRecord(entry)) {
        errors.push(`${at}: must be an object.`);
        return;
      }
      rejectUnknownKeys(entry, STASH_KEYS, at, errors);
      checkEntryCommon(entry, at, map.partySize, content, errors);
      if (
        isSafeInt(entry['id']) &&
        typeof entry['def'] === 'string' &&
        isTier(entry['tier']) &&
        isSafeInt(entry['owner'])
      ) {
        stash.push({
          id: entry['id'],
          def: entry['def'],
          tier: entry['tier'],
          owner: entry['owner'],
        });
      }
    });
  }

  // IDs: unique across both lists, canonical order, nextId.
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const e of [...placed, ...stash]) {
    if (seen.has(e.id)) dup.add(e.id);
    seen.add(e.id);
  }
  for (const id of sortedInts(dup)) {
    errors.push(`ids: duplicate instance ID ${String(id)}.`);
  }
  const ordered = (list: readonly { id: number }[], name: string): void => {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (a !== undefined && b !== undefined && a.id >= b.id) {
        errors.push(`${name}: not sorted by ascending id.`);
        return;
      }
    }
  };
  ordered(placed, 'buildings');
  ordered(stash, 'stash');
  const nextId = data['nextId'];
  if (!isSafeInt(nextId) || nextId < 1) {
    errors.push('nextId: must be a positive integer.');
  } else {
    let max = 0;
    for (const e of [...placed, ...stash]) max = e.id > max ? e.id : max;
    if (nextId <= max) {
      errors.push(
        `nextId: ${String(nextId)} must be greater than every ID (largest is ${String(max)}).`,
      );
    }
  }

  // Placement rules for every building, against the others and the Core.
  const coreKeys = new Set<number>();
  if (coresOk) {
    for (const c of allCoreCells(cores, content)) {
      coreKeys.add(cellKey(map, c.x, c.y));
    }
  }
  if (addedNodes !== undefined) {
    checkAddedNodes(
      addedNodes,
      map,
      content,
      config,
      coresOk,
      coreKeys,
      errors,
    );
  }
  const index = new Map<number, number>(); // cell -> array position
  placed.forEach((b, i) => {
    const def = defs.get(b.id);
    if (def === undefined) return;
    for (const c of defCells(def, b.x, b.y, b.rotation)) {
      if (c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height) {
        const k = cellKey(map, c.x, c.y);
        if (!index.has(k)) index.set(k, i);
      }
    }
  });
  placed.forEach((b, i) => {
    const def = content.buildings.get(b.def);
    if (def === undefined) return;
    const ctx: RuleContext = {
      q,
      content,
      coreKeys,
      occupiedByOther: (x, y) => {
        const at = index.get(cellKey(map, x, y));
        return at !== undefined && at !== i;
      },
      conduitKeys: new Set<number>(),
    };
    const failure = checkPlacement(ctx, def, b.x, b.y, b.rotation, b.owner);
    if (failure !== null) {
      errors.push(
        `buildings[${String(i)}] (id ${String(b.id)}): ${failure.reason}${failure.detail === undefined ? '' : ` at ${failure.detail}`}.`,
      );
    }
  });

  // Conduits: parsed hostilely, then every rule re-checked (conduits.ts).
  const conduits = parseConduits(data['conduits'], errors);
  const conduitIds = new Set<number>();
  for (const c of conduits) {
    if (conduitIds.has(c.id)) {
      errors.push(`ids: duplicate instance ID ${String(c.id)} (conduits).`);
    }
    conduitIds.add(c.id);
    if (decodeConduitId(c.id).n < 1) {
      errors.push(`conduits: ID ${String(c.id)} has a number below 1.`);
    }
    if (decodeConduitId(c.id).owner !== c.owner) {
      errors.push(
        `conduits: ID ${String(c.id)} does not belong to its owner ${String(c.owner)}.`,
      );
    }
  }
  ordered(conduits, 'conduits');
  const rawCounters = data['nextConduitId'];
  let nextConduitId: number[] | undefined;
  if (
    !Array.isArray(rawCounters) ||
    rawCounters.length !== map.partySize ||
    !rawCounters.every((n) => isSafeInt(n) && n >= 1)
  ) {
    errors.push(
      `nextConduitId: must be a list of ${String(map.partySize)} positive integers.`,
    );
  } else {
    nextConduitId = rawCounters as number[];
    for (const c of conduits) {
      const counter = nextConduitId[c.owner];
      if (counter !== undefined && counter <= decodeConduitId(c.id).n) {
        errors.push(
          `nextConduitId: ${String(counter)} must be greater than every conduit number of player ${String(c.owner)} (conduit ${String(c.id)}).`,
        );
      }
    }
  }
  let modifiers: readonly TeamModifier[] | undefined;
  if ('modifiers' in data && data['modifiers'] !== undefined) {
    modifiers = parseTeamModifiers(data['modifiers'], errors);
  }
  const specialists = parseSpecialists(
    data['specialists'],
    map.partySize,
    content,
    errors,
  );
  const partial: TeamState = {
    map,
    cores: coresOk ? cores : cores.map(() => null),
    buildings: placed,
    stash,
    nextId: isSafeInt(nextId) ? nextId : 1,
    nextConduitId: nextConduitId ?? new Array<number>(map.partySize).fill(1),
    conduits,
  };
  checkConduitList(partial, content, errors);
  checkTunnelPairs(partial, content, errors);

  if (errors.length > 0 || !isSafeInt(nextId) || nextConduitId === undefined) {
    return undefined;
  }
  return {
    map,
    cores,
    buildings: placed,
    stash,
    nextId,
    nextConduitId,
    conduits,
    ...(modifiers === undefined ? {} : { modifiers }),
    ...(addedNodes === undefined ? {} : { addedNodes }),
    ...(specialists === undefined ? {} : { specialists }),
  };
}
