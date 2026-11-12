/**
 * Team state and building placement (W1-2, CP-6, CB-26, CB-27, CB-32).
 *
 * The party's whole state for combat is one board: the map, the Core
 * position, and every placed building. All functions are pure: they return a
 * new state (sharing unchanged parts) and never mutate their input. See
 * docs/rules-reference.md, "Team state and placement".
 */

import { allCoreCells, cellKey, coreCells, defCells } from './board-cells.js';
import {
  rotateBuilding,
  type BuildingDef,
  type BuildingId,
  type Rotation,
  type Side,
} from './buildings.js';
import { sortedKeys } from './hash.js';
import { isRecord } from './load-util.js';
import {
  loadMap,
  queryMap,
  renderMapAscii,
  validateCorePosition,
  type Cell,
  type CorePositionProblem,
  type GameMap,
  type MapContent,
  type MapQuery,
} from './map.js';
import type { MapgenConfig } from './mapgen.js';
import type { ResourceId } from './resources.js';
import { checkConduitList, parseConduits } from './conduits.js';
import { parseTeamModifiers, type TeamModifier } from './modifiers.js';

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
  /** Conduits, sorted by `id`. */
  readonly conduits: readonly Conduit[];
  /**
   * Run modifiers taken so far, in the order taken (W2-3, EC-8). The
   * simulation reads them. Omitted (not an empty list) when there are none, so
   * states without modifiers keep their hashes.
   */
  readonly modifiers?: readonly TeamModifier[];
}

/** What the team-state code needs from the loaded content. */
export type TeamContent = MapContent;

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
  | 'node_reserved';

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
  const q = queryMap(state.map, content.terrain);
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
  const first = cells[0];
  const last = cells[cells.length - 1];
  if (
    first === undefined ||
    last === undefined ||
    first.x < 0 ||
    first.y < 0 ||
    last.x >= map.width ||
    last.y >= map.height
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
 * invalid_owner, not_owner (PP-1).
 */
export function eraseConduit(
  state: TeamState,
  args: { actor: number; id: number },
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
  const mine = new Set(
    coreCells(pos, content).map((c) => cellKey(state.map, c.x, c.y)),
  );
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
 * unknown_building, invalid_owner, not_owner, then those of `checkPlacement`.
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
  return {
    ok: true,
    state: {
      ...state,
      stash: state.stash.filter((s) => s.id !== item.id),
      buildings: sortById([...state.buildings, placed]),
    },
  };
}

/**
 * Move and/or rotate a placed building in one step. The building's own
 * current cells do not count as overlap. Attached conduits are removed
 * (detachConduits). Free.
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
  return { ok: true, state: detachConduits(next, item.id) };
}

/** Take a placed building off the board into the stash. Free. */
export function returnToStash(
  state: TeamState,
  _content: Pick<TeamContent, 'buildings'>,
  args: { actor: number; id: number },
): OpResult<'unknown_building' | 'invalid_owner' | 'not_owner'> {
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
  return { ok: true, state: detachConduits(next, item.id) };
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
  const q = queryMap(state.map, content.terrain);
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
  'conduits',
  'modifiers',
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

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function unknownKeys(
  rec: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
  errors: string[],
): void {
  for (const key of sortedKeys(rec)) {
    if (!allowed.has(key)) errors.push(`${at}: unknown field "${key}".`);
  }
}

/** Checks the fields shared by placed and stashed entries. */
function checkEntryCommon(
  rec: Record<string, unknown>,
  at: string,
  partySize: number,
  content: Pick<TeamContent, 'buildings'>,
  errors: string[],
): BuildingDef | undefined {
  let def: BuildingDef | undefined;
  if (!isInt(rec['id']) || rec['id'] < 1) {
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
  unknownKeys(data, STATE_KEYS, 'state', errors);

  const mapResult = loadMap(data['map'], content);
  if (!mapResult.ok) {
    for (const e of mapResult.errors) errors.push(`map: ${e}`);
    return undefined;
  }
  const map = mapResult.config;
  const q = queryMap(map, content.terrain);

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
      } else if (!isRecord(raw) || !isInt(raw['x']) || !isInt(raw['y'])) {
        errors.push(
          `cores[${String(p)}]: must be null or { x, y } of integers.`,
        );
        cores.push(null);
        coresOk = false;
      } else {
        unknownKeys(raw, new Set(['x', 'y']), `cores[${String(p)}]`, errors);
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
      unknownKeys(entry, PLACED_KEYS, at, errors);
      const def = checkEntryCommon(entry, at, map.partySize, content, errors);
      if (!isInt(entry['x']) || !isInt(entry['y'])) {
        errors.push(`${at}: "x" and "y" must be integers.`);
      }
      if (!isRotation(entry['rotation'])) {
        errors.push(`${at}: "rotation" must be 0, 90, 180 or 270.`);
      }
      if (
        def !== undefined &&
        def.kind !== 'core' &&
        isInt(entry['id']) &&
        isInt(entry['x']) &&
        isInt(entry['y']) &&
        isRotation(entry['rotation']) &&
        isTier(entry['tier']) &&
        typeof entry['def'] === 'string' &&
        isInt(entry['owner'])
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
      unknownKeys(entry, STASH_KEYS, at, errors);
      checkEntryCommon(entry, at, map.partySize, content, errors);
      if (
        isInt(entry['id']) &&
        typeof entry['def'] === 'string' &&
        isTier(entry['tier']) &&
        isInt(entry['owner'])
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
  for (const id of [...dup].sort((a, b) => a - b)) {
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
  if (!isInt(nextId) || nextId < 1) {
    errors.push('nextId: must be a positive integer.');
  } else {
    let max = 0;
    for (const id of seen) max = id > max ? id : max;
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
    if (seen.has(c.id) || conduitIds.has(c.id)) {
      errors.push(`ids: duplicate instance ID ${String(c.id)}.`);
    }
    conduitIds.add(c.id);
  }
  ordered(conduits, 'conduits');
  if (isInt(nextId) && nextId >= 1) {
    for (const c of conduits) {
      if (nextId <= c.id) {
        errors.push(
          `nextId: ${String(nextId)} must be greater than every ID (conduit ${String(c.id)}).`,
        );
      }
    }
  }
  let modifiers: readonly TeamModifier[] | undefined;
  if ('modifiers' in data && data['modifiers'] !== undefined) {
    modifiers = parseTeamModifiers(data['modifiers'], errors);
  }
  const partial: TeamState = {
    map,
    cores: coresOk ? cores : cores.map(() => null),
    buildings: placed,
    stash,
    nextId: isInt(nextId) ? nextId : 1,
    conduits,
  };
  checkConduitList(partial, content, errors);

  if (errors.length > 0 || !isInt(nextId)) return undefined;
  return {
    map,
    cores,
    buildings: placed,
    stash,
    nextId,
    conduits,
    ...(modifiers === undefined ? {} : { modifiers }),
  };
}

// ---------------------------------------------------------------------------
// ASCII renderer

const KIND_LETTERS: Readonly<Record<string, string>> = {
  source: 'S',
  route: 'R',
  unit_producer: 'U',
  defense: 'D',
  economy: 'E',
};

/**
 * Like `renderMapAscii` (front row on top), with buildings drawn over the
 * map: `S` source, `R` route, `U` unit producer, `D` defense, `E` economy,
 * `C` Core, and `*` for each conduit path cell. A final line gives the legend. The map's own characters (`.`
 * open, `~` lake, `#` cliff, lowercase letters for resource nodes) show
 * where no building stands.
 */
export function renderTeamStateAscii(
  state: TeamState,
  content: TeamContent,
): string {
  const lines = renderMapAscii(state.map, content).split('\n');
  const legend = lines.pop() ?? '';
  const grid = lines.map((l) => l.split(''));
  const paint = (c: Cell, ch: string): void => {
    const row = grid[state.map.height - 1 - c.y];
    if (row !== undefined && c.x >= 0 && c.x < row.length) row[c.x] = ch;
  };
  for (const b of state.buildings) {
    const def = content.buildings.get(b.def);
    if (def === undefined) continue;
    const ch = KIND_LETTERS[def.kind] ?? '?';
    for (const c of defCells(def, b.x, b.y, b.rotation)) paint(c, ch);
  }
  for (const conduit of state.conduits) {
    for (const c of conduit.cells) paint(c, '*');
  }
  for (const c of allCoreCells(state.cores, content)) paint(c, 'C');
  return [
    ...grid.map((r) => r.join('')),
    `${legend} | S=source R=route U=unit_producer D=defense E=economy C=core *=conduit`,
  ].join('\n');
}
