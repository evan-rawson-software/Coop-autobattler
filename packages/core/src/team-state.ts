/**
 * Team state and building placement (W1-2, CP-6, CB-26, CB-27, CB-32).
 *
 * The party's whole state for combat is one board: the map, the Core
 * position, and every placed building. All functions are pure: they return a
 * new state (sharing unchanged parts) and never mutate their input. See
 * docs/rules-reference.md, "Team state and placement".
 */

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
  coreFootprint,
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

/** Reserved for W1-3 (conduits). Always empty for now. */
export type Conduit = never;

export interface TeamState {
  readonly map: GameMap;
  /** The Core's lowest-x, lowest-y cell, or null before it is placed. */
  readonly core: Cell | null;
  /** Placed buildings, sorted by `id`. Never holds the Core. */
  readonly buildings: readonly PlacedBuilding[];
  /** Owned buildings not on the board, sorted by `id`. */
  readonly stash: readonly StashedBuilding[];
  /** The next instance ID to assign; IDs are never reused. */
  readonly nextId: number;
  /** Reserved for W1-3; kept untouched by every function (see detachConduits). */
  readonly conduits: readonly Conduit[];
}

/** What the team-state code needs from the loaded content. */
export type TeamContent = MapContent;

export type PlacementReason =
  | 'unknown_building'
  | 'invalid_rotation'
  | 'out_of_bounds'
  | 'blocked_by_feature'
  | 'overlaps_core'
  | 'overlaps_building'
  | 'overlaps_conduit'
  | 'source_needs_node'
  | 'node_reserved';

export type CoreReason =
  'core_already_placed' | CorePositionProblem | 'overlaps_building';

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
  return { map, core: null, buildings: [], stash: [], nextId: 1, conduits: [] };
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

/**
 * The absolute cells of a footprint of rotated size `(w, h)` anchored at
 * `(x, y)`: `x .. x + w - 1` by `y .. y + h - 1`, in `(y, x)` order. The
 * rotated bounding box is always anchored at the building's position.
 */
function boxCells(x: number, y: number, w: number, h: number): Cell[] {
  const out: Cell[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  }
  return out;
}

/** Cells covered by a definition at a position and rotation. */
function defCells(
  def: BuildingDef,
  x: number,
  y: number,
  rotation: Rotation,
): Cell[] {
  const fp = rotateBuilding(def, rotation).footprint;
  return boxCells(x, y, fp.width, fp.height);
}

function coreCells(
  core: Cell,
  content: Pick<TeamContent, 'buildings'>,
): Cell[] {
  const fp = coreFootprint(content.buildings);
  return boxCells(core.x, core.y, fp.width, fp.height);
}

// ---------------------------------------------------------------------------
// Placement rules

interface RuleContext {
  readonly q: MapQuery;
  readonly content: TeamContent;
  /** Cells of the Core, or empty before it is placed. */
  readonly coreKeys: ReadonlySet<number>;
  /** Whether a placed building other than the one being checked is on a cell. */
  readonly occupiedByOther: (x: number, y: number) => boolean;
}

function cellKey(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

function makeContext(
  state: TeamState,
  content: TeamContent,
  occupiedByOther: (x: number, y: number) => boolean,
): RuleContext {
  const q = queryMap(state.map, content.terrain);
  const coreKeys = new Set<number>();
  if (state.core !== null) {
    for (const c of coreCells(state.core, content)) {
      coreKeys.add(cellKey(state.map, c.x, c.y));
    }
  }
  return { q, content, coreKeys, occupiedByOther };
}

/**
 * Check a placement. Rules are checked in this fixed order and the first
 * failure is reported: invalid_rotation, out_of_bounds, blocked_by_feature,
 * overlaps_core, overlaps_building, overlaps_conduit, source_needs_node,
 * node_reserved. (`unknown_building` is checked by the caller, first.)
 */
function checkPlacement(
  ctx: RuleContext,
  def: BuildingDef,
  x: unknown,
  y: unknown,
  rotation: unknown,
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
  // overlaps_conduit: nothing to check until W1-3 (state.conduits is empty).
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
// Conduit hook (W1-3)

/**
 * INTERNAL HOOK for W1-3. Rule: moving, rotating or returning a building
 * removes every conduit attached to it. Conduits do not exist yet, so this
 * returns the state unchanged. `moveBuilding` and `returnToStash` call it.
 */
export function detachConduits(
  state: TeamState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- W1-3 hook
  _buildingId: number,
): TeamState {
  return state;
}

// ---------------------------------------------------------------------------
// Operations

/**
 * Place the Core once. Reasons, in order: core_already_placed, then those of
 * `validateCorePosition` (out_of_bounds, blocked, on_node, too_far_forward),
 * then overlaps_building.
 */
export function placeCore(
  state: TeamState,
  content: TeamContent,
  config: MapgenConfig,
  pos: { x: number; y: number },
): OpResult<CoreReason> {
  if (state.core !== null) return { ok: false, reason: 'core_already_placed' };
  const check = validateCorePosition(state.map, content, config, pos);
  if (!check.ok) return { ok: false, reason: check.reason };
  const mine = new Set(
    coreCells(pos, content).map((c) => cellKey(state.map, c.x, c.y)),
  );
  const index = buildingCellIndex(state, content);
  for (const k of mine) {
    if (index.has(k)) return { ok: false, reason: 'overlaps_building' };
  }
  return { ok: true, state: { ...state, core: { x: pos.x, y: pos.y } } };
}

/** Place a stashed building on the board. Free. */
export function placeFromStash(
  state: TeamState,
  content: TeamContent,
  args: { id: number; x: number; y: number; rotation: number },
): OpResult<PlacementReason> {
  const item = state.stash.find((s) => s.id === args.id);
  const def = item === undefined ? undefined : content.buildings.get(item.def);
  if (item === undefined || def === undefined) {
    return { ok: false, reason: 'unknown_building' };
  }
  const index = buildingCellIndex(state, content);
  const ctx = makeContext(state, content, (x, y) =>
    index.has(cellKey(state.map, x, y)),
  );
  const failure = checkPlacement(ctx, def, args.x, args.y, args.rotation);
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
  args: { id: number; x: number; y: number; rotation: number },
): OpResult<PlacementReason> {
  const item = state.buildings.find((b) => b.id === args.id);
  const def = item === undefined ? undefined : content.buildings.get(item.def);
  if (item === undefined || def === undefined) {
    return { ok: false, reason: 'unknown_building' };
  }
  const index = buildingCellIndex(state, content);
  const ctx = makeContext(state, content, (x, y) => {
    const other = index.get(cellKey(state.map, x, y));
    return other !== undefined && other !== item.id;
  });
  const failure = checkPlacement(ctx, def, args.x, args.y, args.rotation);
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
  args: { id: number },
): OpResult<'unknown_building'> {
  const item = state.buildings.find((b) => b.id === args.id);
  if (item === undefined) return { ok: false, reason: 'unknown_building' };
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

/** Delete a stash entry (used later for selling). */
export function removeFromStash(
  state: TeamState,
  args: { id: number },
): OpResult<'unknown_building'> {
  if (!state.stash.some((s) => s.id === args.id)) {
    return { ok: false, reason: 'unknown_building' };
  }
  return {
    ok: true,
    state: { ...state, stash: state.stash.filter((s) => s.id !== args.id) },
  };
}

// ---------------------------------------------------------------------------
// Queries

export interface Occupancy {
  /** The placed building on a cell, `'core'` for the Core, else null. */
  buildingAt(x: number, y: number): PlacedBuilding | 'core' | null;
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
  const coreKeys = new Set<number>();
  if (state.core !== null) {
    for (const c of coreCells(state.core, content)) {
      coreKeys.add(cellKey(state.map, c.x, c.y));
    }
  }
  return {
    buildingAt: (x, y) => {
      if (!q.isInBounds(x, y)) return null;
      const k = cellKey(state.map, x, y);
      return byCell.get(k) ?? (coreKeys.has(k) ? 'core' : null);
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
  'core',
  'buildings',
  'stash',
  'nextId',
  'conduits',
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

  // Core
  let core: Cell | null = null;
  const rawCore = data['core'];
  if (rawCore !== null) {
    if (!isRecord(rawCore) || !isInt(rawCore['x']) || !isInt(rawCore['y'])) {
      errors.push('core: must be null or an object { x, y } of integers.');
    } else {
      unknownKeys(rawCore, new Set(['x', 'y']), 'core', errors);
      core = { x: rawCore['x'], y: rawCore['y'] };
      const check = validateCorePosition(map, content, config, core);
      if (!check.ok) {
        errors.push(
          `core: illegal position (${String(core.x)}, ${String(core.y)}): ${check.reason}.`,
        );
      }
    }
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

  // Conduits (W1-3 will define them).
  const conduits = data['conduits'];
  if (!Array.isArray(conduits) || conduits.length !== 0) {
    errors.push('conduits: must be an empty array.');
  }

  // Placement rules for every building, against the others and the Core.
  const coreKeys = new Set<number>();
  if (core !== null && errors.every((e) => !e.startsWith('core:'))) {
    for (const c of coreCells(core, content)) {
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
    };
    const failure = checkPlacement(ctx, def, b.x, b.y, b.rotation);
    if (failure !== null) {
      errors.push(
        `buildings[${String(i)}] (id ${String(b.id)}): ${failure.reason}${failure.detail === undefined ? '' : ` at ${failure.detail}`}.`,
      );
    }
  });

  if (errors.length > 0 || !isInt(nextId)) return undefined;
  return {
    map,
    core,
    buildings: placed,
    stash,
    nextId,
    conduits: [],
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
 * `C` Core. A final line gives the legend. The map's own characters (`.`
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
  if (state.core !== null) {
    for (const c of coreCells(state.core, content)) paint(c, 'C');
  }
  return [
    ...grid.map((r) => r.join('')),
    `${legend} | S=source R=route U=unit_producer D=defense E=economy C=core`,
  ].join('\n');
}
