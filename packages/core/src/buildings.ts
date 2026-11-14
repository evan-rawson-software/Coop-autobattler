/**
 * Building rules (CB-9, CB-26c, CB-26d): kinds, footprints, tiers, and which
 * sides take resources in or send them out at rotation 0.
 *
 * Tiers: every bought building has exactly three tiers, each the same
 * building with better numbers (same footprint, same inputs/outputs). The
 * `core` kind is not bought and has no tiers to speak of, so it has exactly
 * one entry in `tiers`, holding only `health` (no `price`). The loader
 * enforces both counts.
 *
 * Route buildings carry whatever resource they are fed (CB-5b), so their
 * inputs name no resource. Every other building that has inputs names the
 * resource each side accepts. A building may list several inputs (CB-5a).
 */

import { sortedKeys } from './hash.js';
import { mulDiv } from './int.js';
import { MAX_DAMAGE, MAX_HEALTH } from './limits.js';
import type { ResourceConfig, ResourceId } from './resources.js';
import type { UnitConfig, UnitId } from './units.js';
import {
  isRecord,
  readInt,
  readId,
  readList,
  show,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';

export type BuildingId = string;
export type Side = 'north' | 'east' | 'south' | 'west';
export type Rotation = 0 | 90 | 180 | 270;
export type BuildingKind =
  'source' | 'route' | 'unit_producer' | 'defense' | 'economy' | 'core';
export type RouteType = 'splitter' | 'merger' | 'crossover';
export type DefenseType = 'wall' | 'gate' | 'turret';
export type EconomyEffectType = 'source_speed' | 'unit_strength';

/** One cell of a footprint, relative to the footprint's top-left corner. */
export interface FootprintCell {
  readonly x: number;
  readonly y: number;
}

export interface Footprint {
  readonly width: number;
  readonly height: number;
  /**
   * Cells actually covered inside the `width` x `height` box (tetromino walls,
   * issue #291). Omitted = every cell of the box. When present: sorted by
   * `(y, x)`, non-empty, no duplicates, 4-connected, every row and column of
   * the box used.
   */
  readonly cells?: readonly FootprintCell[];
}

/** The covered cells of a footprint in `(y, x)` order (the full box when it has no mask). */
export function footprintCellList(fp: Footprint): FootprintCell[] {
  if (fp.cells !== undefined) return fp.cells.map((c) => ({ x: c.x, y: c.y }));
  const out: FootprintCell[] = [];
  for (let y = 0; y < fp.height; y++) {
    for (let x = 0; x < fp.width; x++) out.push({ x, y });
  }
  return out;
}

/**
 * A footprint rotated clockwise (as drawn with north, increasing `y`, at the
 * top) by `rotation` degrees. Width and height swap
 * at 90 and 270; a mask is rotated cell by cell and stays normalised to the
 * rotated box's top-left corner (the box is anchored at the building's
 * position). A footprint without a mask stays without one.
 */
export function rotateFootprint(fp: Footprint, rotation: Rotation): Footprint {
  const swap = rotation === 90 || rotation === 270;
  const width = swap ? fp.height : fp.width;
  const height = swap ? fp.width : fp.height;
  if (fp.cells === undefined) return { width, height };
  const w = fp.width;
  const h = fp.height;
  const cells = fp.cells
    .map((c) => {
      if (rotation === 90) return { x: c.y, y: w - 1 - c.x };
      if (rotation === 180) return { x: w - 1 - c.x, y: h - 1 - c.y };
      if (rotation === 270) return { x: h - 1 - c.y, y: c.x };
      return { x: c.x, y: c.y };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return { width, height, cells };
}

export interface BuildingInput {
  readonly side: Side;
  /** Absent on route buildings, which carry whatever they are fed. */
  readonly resource?: ResourceId;
}

export interface TierBase {
  readonly health: number;
  readonly price: number;
}
export interface SourceTier extends TierBase {
  /** Ticks between producing one unit of the node's resource. */
  readonly intervalTicks: number;
}
export interface UnitProducerTier extends TierBase {
  /** Resource units consumed to spawn one unit. */
  readonly costPerUnit: number;
  /** Minimum ticks between two units made (PP-6). */
  readonly productionIntervalTicks: number;
}
export interface TurretTier extends TierBase {
  readonly damage: number;
  readonly rangeCells: number;
  readonly cooldownTicks: number;
  /** Resource units consumed per shot. */
  readonly costPerShot: number;
}
export interface EconomyTier extends TierBase {
  /** Resource units consumed per upgrade step. */
  readonly costPerStep: number;
  /** Minimum ticks between two upgrade steps (PP-6). */
  readonly stepIntervalTicks: number;
  /** Integer percent gained per step. */
  readonly stepPercent: number;
  /** Cap on steps (SC-8). */
  readonly maxSteps: number;
}
export interface CoreTier {
  readonly health: number;
}

export type Tiers3<T> = readonly [T, T, T];

interface BuildingCommon {
  readonly id: BuildingId;
  /** Cells at rotation 0. */
  readonly footprint: Footprint;
  /** Sides that accept a resource at rotation 0. */
  readonly inputs: readonly BuildingInput[];
  /** Sides that emit at rotation 0. */
  readonly outputs: readonly Side[];
}

export interface SourceBuildingDef extends BuildingCommon {
  readonly kind: 'source';
  readonly tiers: Tiers3<SourceTier>;
}
export interface RouteBuildingDef extends BuildingCommon {
  readonly kind: 'route';
  readonly routeType: RouteType;
  readonly tiers: Tiers3<TierBase>;
}
export interface UnitProducerBuildingDef extends BuildingCommon {
  readonly kind: 'unit_producer';
  readonly unit: UnitId;
  readonly tiers: Tiers3<UnitProducerTier>;
}
export interface WallOrGateBuildingDef extends BuildingCommon {
  readonly kind: 'defense';
  readonly defenseType: 'wall' | 'gate';
  readonly tiers: Tiers3<TierBase>;
}
export interface TurretBuildingDef extends BuildingCommon {
  readonly kind: 'defense';
  readonly defenseType: 'turret';
  readonly tiers: Tiers3<TurretTier>;
}
export interface EconomyBuildingDef extends BuildingCommon {
  readonly kind: 'economy';
  readonly effect: { readonly type: EconomyEffectType };
  readonly tiers: Tiers3<EconomyTier>;
}
export interface CoreBuildingDef extends BuildingCommon {
  readonly kind: 'core';
  readonly tiers: readonly [CoreTier];
}

export type DefenseBuildingDef = WallOrGateBuildingDef | TurretBuildingDef;

export type BuildingDef =
  | SourceBuildingDef
  | RouteBuildingDef
  | UnitProducerBuildingDef
  | DefenseBuildingDef
  | EconomyBuildingDef
  | CoreBuildingDef;

export interface BuildingConfig {
  get(id: BuildingId): BuildingDef | undefined;
  /** Every building, in file order. */
  list(): readonly BuildingDef[];
}

export interface BuildingLoadContext {
  readonly resources: ResourceConfig;
  readonly units: UnitConfig;
}

export type BuildingLoadResult = LoadResult<BuildingConfig>;

// ---------------------------------------------------------------------------
// Rotation

const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];
const ROTATIONS: readonly number[] = [0, 90, 180, 270];

/** Rotate a side clockwise by a rotation (0, 90, 180, 270 degrees). */
export function rotateSide(side: Side, rotation: Rotation): Side {
  const steps = ROTATIONS.indexOf(rotation);
  if (steps < 0) {
    throw new Error(
      `Invalid rotation ${String(rotation)}; expected 0, 90, 180, or 270.`,
    );
  }
  const rotated = SIDES[(SIDES.indexOf(side) + steps) % 4];
  if (rotated === undefined) throw new Error(`Unknown side "${side}".`);
  return rotated;
}

export function oppositeSide(side: Side): Side {
  return rotateSide(side, 180);
}

export interface RotatedBuilding {
  readonly footprint: Footprint;
  /** Absolute sides that accept a resource. */
  readonly inputs: readonly BuildingInput[];
  /** Absolute sides that emit. */
  readonly outputs: readonly Side[];
}

/**
 * Where a building's footprint and sides end up when rotated clockwise by
 * `rotation` degrees. Width and height swap at 90 and 270. Input order and
 * output order are kept.
 */
export function rotateBuilding(
  def: Pick<BuildingDef, 'footprint' | 'inputs' | 'outputs'>,
  rotation: Rotation,
): RotatedBuilding {
  return {
    footprint: rotateFootprint(def.footprint, rotation),
    inputs: def.inputs.map((input) => ({
      ...input,
      side: rotateSide(input.side, rotation),
    })),
    outputs: def.outputs.map((side) => rotateSide(side, rotation)),
  };
}

// ---------------------------------------------------------------------------
// Loading

/**
 * Reads and checks a footprint cell mask: pairs `[x, y]` inside the box, no
 * duplicates, 4-connected, every row and column used. Returns the cells sorted
 * by `(y, x)`; failures are appended to `errors`.
 */
function readCellMask(
  value: unknown,
  width: number | undefined,
  height: number | undefined,
  label: string,
  errors: string[],
): FootprintCell[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label}: "cells" must be a non-empty array of [x, y] pairs.`);
    return undefined;
  }
  const cells: FootprintCell[] = [];
  let ok = true;
  for (const [i, raw] of (value as unknown[]).entries()) {
    if (
      !Array.isArray(raw) ||
      raw.length !== 2 ||
      !Number.isInteger(raw[0]) ||
      !Number.isInteger(raw[1])
    ) {
      errors.push(
        `${label}: cells[${String(i)}] must be an [x, y] pair of integers.`,
      );
      ok = false;
      continue;
    }
    const x = raw[0] as number;
    const y = raw[1] as number;
    if (
      width !== undefined &&
      height !== undefined &&
      (x < 0 || y < 0 || x >= width || y >= height)
    ) {
      errors.push(
        `${label}: cell [${String(x)}, ${String(y)}] is outside the ${String(width)}x${String(height)} box.`,
      );
      ok = false;
      continue;
    }
    if (cells.some((c) => c.x === x && c.y === y)) {
      errors.push(`${label}: duplicate cell [${String(x)}, ${String(y)}].`);
      ok = false;
      continue;
    }
    cells.push({ x, y });
  }
  if (!ok || width === undefined || height === undefined) return undefined;
  const rows = new Set(cells.map((c) => c.y));
  const cols = new Set(cells.map((c) => c.x));
  if (rows.size !== height || cols.size !== width) {
    errors.push(
      `${label}: "cells" must use every row and column of the ${String(width)}x${String(height)} box.`,
    );
    return undefined;
  }
  const first = cells[0] as FootprintCell;
  const seen = new Set<string>([`${String(first.x)},${String(first.y)}`]);
  const stack: FootprintCell[] = [first];
  while (stack.length > 0) {
    const c = stack.pop() as FootprintCell;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const k = `${String(nx)},${String(ny)}`;
      if (seen.has(k) || !cells.some((o) => o.x === nx && o.y === ny)) continue;
      seen.add(k);
      stack.push({ x: nx, y: ny });
    }
  }
  if (seen.size !== cells.length) {
    errors.push(`${label}: "cells" must be 4-connected.`);
    return undefined;
  }
  return cells.sort((a, b) => a.y - b.y || a.x - b.x);
}

const ID_PATTERN = /^bld_[a-z0-9_]+$/;
const RESOURCE_ID_PATTERN = /^res_[a-z0-9_]+$/;
const KINDS: readonly string[] = [
  'source',
  'route',
  'unit_producer',
  'defense',
  'economy',
  'core',
];
const ROUTE_TYPES: readonly string[] = ['splitter', 'merger', 'crossover'];
const DEFENSE_TYPES: readonly string[] = ['wall', 'gate', 'turret'];
const EFFECT_TYPES: readonly string[] = ['source_speed', 'unit_strength'];

const COMMON_KEYS = ['id', 'kind', 'footprint', 'tiers', 'inputs', 'outputs'];
/** Fields that belong to one kind only. */
const KIND_FIELDS: Readonly<Record<string, string>> = {
  routeType: 'route',
  unit: 'unit_producer',
  defenseType: 'defense',
  effect: 'economy',
};

/** Upper bounds of per-tier fields (see `limits.ts`). */
const TIER_MAX: Readonly<Record<string, number>> = {
  health: MAX_HEALTH,
  damage: MAX_DAMAGE,
};

/** Per-tier integer fields (name -> minimum) by kind, beyond the common ones. */
function tierFields(
  kind: string,
  defenseType: unknown,
): Record<string, number> | undefined {
  const bought = { health: 1, price: 0 };
  switch (kind) {
    case 'source':
      return { ...bought, intervalTicks: 1 };
    case 'route':
      return bought;
    case 'unit_producer':
      return { ...bought, costPerUnit: 1, productionIntervalTicks: 1 };
    case 'defense':
      return defenseType === 'turret'
        ? {
            ...bought,
            damage: 1,
            rangeCells: 1,
            cooldownTicks: 1,
            costPerShot: 1,
          }
        : bought;
    case 'economy':
      return {
        ...bought,
        costPerStep: 1,
        stepIntervalTicks: 1,
        stepPercent: 1,
        maxSteps: 1,
      };
    case 'core':
      return { health: 1 };
    default:
      return undefined;
  }
}

function parseSide(value: unknown): Side | undefined {
  return SIDES.find((s) => s === value);
}

function toTiers3<T>(tiers: readonly T[]): Tiers3<T> {
  const [a, b, c] = tiers;
  if (a === undefined || b === undefined || c === undefined) {
    throw new Error('Internal error: expected three tiers.');
  }
  return [a, b, c];
}

interface IoRule {
  readonly resource: 'required' | 'forbidden';
  readonly inputs: readonly [number, number];
  readonly outputs: readonly [number, number];
  readonly what: string;
}

function ioRule(kind: string, subtype: string | undefined): IoRule | undefined {
  const none = [0, 0] as const;
  switch (kind) {
    case 'source':
      return {
        resource: 'forbidden',
        inputs: none,
        outputs: [1, 1],
        what: 'a source',
      };
    case 'route':
      if (subtype === 'splitter') {
        return {
          resource: 'forbidden',
          inputs: [1, 1],
          outputs: [2, 3],
          what: 'a splitter',
        };
      }
      if (subtype === 'merger') {
        return {
          resource: 'forbidden',
          inputs: [2, 3],
          outputs: [1, 1],
          what: 'a merger',
        };
      }
      if (subtype === 'crossover') {
        return {
          resource: 'forbidden',
          inputs: [2, 2],
          outputs: [2, 2],
          what: 'a crossover',
        };
      }
      return undefined;
    case 'unit_producer':
      return {
        resource: 'required',
        inputs: [1, 4],
        outputs: none,
        what: 'a unit producer',
      };
    case 'defense':
      if (subtype === 'turret') {
        return {
          resource: 'required',
          inputs: [1, 4],
          outputs: none,
          what: 'a turret',
        };
      }
      return {
        resource: 'forbidden',
        inputs: none,
        outputs: none,
        what: subtype === 'gate' ? 'a gate' : 'a wall',
      };
    case 'economy':
      return {
        resource: 'required',
        inputs: [1, 4],
        outputs: none,
        what: 'an economy building',
      };
    case 'core':
      return {
        resource: 'forbidden',
        inputs: none,
        outputs: none,
        what: 'the core',
      };
    default:
      return undefined;
  }
}

function describeRange(range: readonly [number, number], noun: string): string {
  const [min, max] = range;
  const plural = (n: number): string =>
    `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
  if (min === max) return `exactly ${plural(min)}`;
  return `${String(min)} to ${plural(max)}`;
}

function parseBuilding(
  entry: unknown,
  at: string,
  ctx: BuildingLoadContext,
  seen: Set<string>,
  errors: string[],
): BuildingDef | undefined {
  if (!isRecord(entry)) {
    errors.push(`${at}: must be an object.`);
    return undefined;
  }
  const before = errors.length;
  const id = readId(entry, ID_PATTERN, at, errors);
  const label = id === undefined ? at : `${at} ("${id}")`;
  if (id !== undefined) {
    if (seen.has(id)) errors.push(`${label}: duplicate id "${id}".`);
    seen.add(id);
  }

  const kindValue = entry['kind'];
  const kind =
    typeof kindValue === 'string' && KINDS.includes(kindValue)
      ? kindValue
      : undefined;
  if (kind === undefined) {
    errors.push(
      `${label}: unknown kind ${JSON.stringify(kindValue)}; expected one of ${KINDS.join(', ')}.`,
    );
  }

  // Fields: required for this kind, forbidden on other kinds, or unknown.
  for (const key of sortedKeys(entry)) {
    if (COMMON_KEYS.includes(key)) continue;
    const owner = KIND_FIELDS[key];
    if (owner === undefined) {
      errors.push(`${label}: unknown field "${key}".`);
    } else if (kind !== undefined && owner !== kind) {
      errors.push(
        `${label}: field "${key}" is only valid on kind "${owner}", not "${kind}".`,
      );
    }
  }

  // Footprint.
  let footprint: Footprint | undefined;
  const fp = entry['footprint'];
  if (!isRecord(fp)) {
    errors.push(
      `${label}: "footprint" must be an object with width and height.`,
    );
  } else {
    const width = readInt(fp, 'width', 1, `${label} footprint`, errors);
    const height = readInt(fp, 'height', 1, `${label} footprint`, errors);
    for (const key of sortedKeys(fp)) {
      if (key !== 'width' && key !== 'height' && key !== 'cells') {
        errors.push(`${label} footprint: unknown field "${key}".`);
      }
    }
    let cells: FootprintCell[] | undefined;
    if (fp['cells'] !== undefined) {
      cells = readCellMask(
        fp['cells'],
        width,
        height,
        `${label} footprint`,
        errors,
      );
    }
    if (width !== undefined && height !== undefined) {
      footprint =
        cells === undefined ? { width, height } : { width, height, cells };
    }
  }

  // Kind-specific scalar fields.
  let routeType: RouteType | undefined;
  let unit: UnitId | undefined;
  let defenseType: DefenseType | undefined;
  let effectType: EconomyEffectType | undefined;
  if (kind === 'route') {
    const v = entry['routeType'];
    if (typeof v === 'string' && ROUTE_TYPES.includes(v)) {
      routeType = v as RouteType;
    } else {
      errors.push(
        `${label}: a route building needs "routeType" (${ROUTE_TYPES.join(', ')}); got ${show(v)}.`,
      );
    }
  }
  if (kind === 'unit_producer') {
    const v = entry['unit'];
    if (typeof v !== 'string' || v === '') {
      errors.push(`${label}: a unit producer needs a "unit" ID.`);
    } else if (ctx.units.get(v) === undefined) {
      errors.push(`${label}: unknown unit ID "${v}" in "unit".`);
    } else {
      unit = v;
    }
  }
  if (kind === 'defense') {
    const v = entry['defenseType'];
    if (typeof v === 'string' && DEFENSE_TYPES.includes(v)) {
      defenseType = v as DefenseType;
    } else {
      errors.push(
        `${label}: a defense building needs "defenseType" (${DEFENSE_TYPES.join(', ')}); got ${show(v)}.`,
      );
    }
  }
  if (kind === 'economy') {
    const v = entry['effect'];
    if (!isRecord(v)) {
      errors.push(`${label}: an economy building needs an "effect" object.`);
    } else {
      const t = v['type'];
      if (typeof t === 'string' && EFFECT_TYPES.includes(t)) {
        effectType = t as EconomyEffectType;
      } else {
        errors.push(
          `${label}: effect.type must be one of ${EFFECT_TYPES.join(', ')}; got ${show(t)}.`,
        );
      }
      for (const key of sortedKeys(v)) {
        if (key !== 'type') {
          errors.push(`${label}: effect: unknown field "${key}".`);
        }
      }
    }
  }

  // Inputs and outputs.
  const inputs: BuildingInput[] = [];
  const outputs: Side[] = [];
  const rawInputs = entry['inputs'];
  if (!Array.isArray(rawInputs)) {
    errors.push(`${label}: "inputs" must be a list (it may be empty).`);
  } else {
    (rawInputs as unknown[]).forEach((raw, i) => {
      const where = `${label} inputs[${String(i)}]`;
      if (!isRecord(raw)) {
        errors.push(`${where}: must be an object with a side.`);
        return;
      }
      const side = parseSide(raw['side']);
      if (side === undefined) {
        errors.push(
          `${where}: "side" must be one of ${SIDES.join(', ')}; got ${show(raw['side'])}.`,
        );
      }
      for (const key of sortedKeys(raw)) {
        if (key !== 'side' && key !== 'resource') {
          errors.push(`${where}: unknown field "${key}".`);
        }
      }
      const resource = raw['resource'];
      let resourceId: ResourceId | undefined;
      if (resource !== undefined) {
        if (
          typeof resource !== 'string' ||
          !RESOURCE_ID_PATTERN.test(resource)
        ) {
          errors.push(`${where}: "resource" must be a resource ID.`);
        } else if (ctx.resources.get(resource) === undefined) {
          errors.push(`${where}: unknown resource ID "${resource}".`);
        }
        // Keep it even when unknown (already reported), to avoid a second error.
        if (typeof resource === 'string') resourceId = resource;
      }
      if (side !== undefined) {
        inputs.push(
          resourceId === undefined ? { side } : { side, resource: resourceId },
        );
      }
    });
  }
  const rawOutputs = entry['outputs'];
  if (!Array.isArray(rawOutputs)) {
    errors.push(`${label}: "outputs" must be a list (it may be empty).`);
  } else {
    (rawOutputs as unknown[]).forEach((raw, i) => {
      const side = parseSide(raw);
      if (side === undefined) {
        errors.push(
          `${label} outputs[${String(i)}]: must be one of ${SIDES.join(', ')}; got ${show(raw)}.`,
        );
      } else {
        outputs.push(side);
      }
    });
  }
  const inputCount = Array.isArray(rawInputs) ? rawInputs.length : 0;
  const outputCount = Array.isArray(rawOutputs) ? rawOutputs.length : 0;

  // Layout rules for this kind. Only run on well-formed lists.
  const ioWellFormed =
    inputs.length === inputCount && outputs.length === outputCount;
  const subtype = kind === 'route' ? routeType : defenseType;
  const rule =
    kind === undefined || (kind === 'route' && routeType === undefined)
      ? undefined
      : ioRule(kind, subtype);
  if (rule !== undefined && ioWellFormed && Array.isArray(rawInputs)) {
    if (inputs.length < rule.inputs[0] || inputs.length > rule.inputs[1]) {
      errors.push(
        `${label}: ${rule.what} needs ${describeRange(rule.inputs, 'input')}; found ${String(inputs.length)}.`,
      );
    }
    if (outputs.length < rule.outputs[0] || outputs.length > rule.outputs[1]) {
      errors.push(
        `${label}: ${rule.what} needs ${describeRange(rule.outputs, 'output')}; found ${String(outputs.length)}.`,
      );
    }
    for (const input of inputs) {
      if (rule.resource === 'required' && input.resource === undefined) {
        errors.push(
          `${label}: input on the ${input.side} side must name a "resource" (${rule.what} consumes a specific resource).`,
        );
      }
      if (rule.resource === 'forbidden' && input.resource !== undefined) {
        errors.push(
          `${label}: input on the ${input.side} side must not name a "resource" (${rule.what} does not consume a specific resource).`,
        );
      }
    }
    const inputSides = new Set<Side>();
    const inputSideList: Side[] = []; // each side once, in input order
    for (const input of inputs) {
      if (inputSides.has(input.side)) {
        errors.push(`${label}: more than one input on the ${input.side} side.`);
      } else {
        inputSides.add(input.side);
        inputSideList.push(input.side);
      }
    }
    const outputSides = new Set<Side>();
    for (const side of outputs) {
      if (outputSides.has(side)) {
        errors.push(`${label}: more than one output on the ${side} side.`);
      }
      outputSides.add(side);
    }
    for (const side of SIDES) {
      if (inputSides.has(side) && outputSides.has(side)) {
        errors.push(
          `${label}: the ${side} side is both an input and an output.`,
        );
      }
    }
    if (kind === 'route' && routeType === 'crossover') {
      for (const side of inputSideList) {
        if (!outputSides.has(oppositeSide(side))) {
          errors.push(
            `${label}: crossover input on the ${side} side needs an output on the ${oppositeSide(side)} side (a straight-through path).`,
          );
        }
      }
    }
  }

  // Tiers.
  const wantedFields =
    kind === undefined ? undefined : tierFields(kind, defenseType);
  const wantedCount = kind === 'core' ? 1 : 3;
  const tierRecords: Record<string, number>[] = [];
  const rawTiers = entry['tiers'];
  if (!Array.isArray(rawTiers)) {
    errors.push(`${label}: "tiers" must be a list.`);
  } else {
    if (kind !== undefined && rawTiers.length !== wantedCount) {
      errors.push(
        `${label}: ${kind === 'core' ? 'the core is not bought and needs exactly 1 tier entry' : 'a building needs exactly 3 tiers'}; found ${String(rawTiers.length)}.`,
      );
    }
    if (wantedFields !== undefined) {
      (rawTiers as unknown[]).forEach((raw, i) => {
        const where = `${label} tiers[${String(i)}]`;
        if (!isRecord(raw)) {
          errors.push(`${where}: must be an object.`);
          return;
        }
        const rec: Record<string, number> = {};
        let ok = true;
        for (const key of sortedKeys(wantedFields)) {
          const min = wantedFields[key] ?? 0;
          const max = TIER_MAX[key];
          const value = readInt(raw, key, min, where, errors, max);
          if (value === undefined) ok = false;
          else rec[key] = value;
        }
        for (const key of sortedKeys(raw)) {
          if (!(key in wantedFields)) {
            ok = false;
            errors.push(
              `${where}: field "${key}" is not valid for ${kind === 'defense' && defenseType !== undefined ? defenseType : String(kind)}; expected ${sortedKeys(wantedFields).join(', ')}.`,
            );
          }
        }
        if (ok) tierRecords.push(rec);
      });
    }
  }

  if (errors.length > before) return undefined;
  if (
    id === undefined ||
    kind === undefined ||
    footprint === undefined ||
    tierRecords.length !== wantedCount
  ) {
    return undefined;
  }
  const num = (t: Record<string, number> | undefined, key: string): number =>
    t?.[key] ?? 0;
  const common = { id, footprint, inputs, outputs };
  const mapTiers = <T>(f: (t: Record<string, number>) => T): T[] =>
    tierRecords.map(f);
  const base = (t: Record<string, number>): TierBase => ({
    health: num(t, 'health'),
    price: num(t, 'price'),
  });

  switch (kind) {
    case 'source':
      return {
        ...common,
        kind,
        tiers: toTiers3(
          mapTiers((t) => ({
            ...base(t),
            intervalTicks: num(t, 'intervalTicks'),
          })),
        ),
      };
    case 'route':
      if (routeType === undefined) return undefined;
      return { ...common, kind, routeType, tiers: toTiers3(mapTiers(base)) };
    case 'unit_producer':
      if (unit === undefined) return undefined;
      return {
        ...common,
        kind,
        unit,
        tiers: toTiers3(
          mapTiers((t) => ({
            ...base(t),
            costPerUnit: num(t, 'costPerUnit'),
            productionIntervalTicks: num(t, 'productionIntervalTicks'),
          })),
        ),
      };
    case 'defense':
      if (defenseType === 'turret') {
        return {
          ...common,
          kind,
          defenseType,
          tiers: toTiers3(
            mapTiers((t) => ({
              ...base(t),
              damage: num(t, 'damage'),
              rangeCells: num(t, 'rangeCells'),
              cooldownTicks: num(t, 'cooldownTicks'),
              costPerShot: num(t, 'costPerShot'),
            })),
          ),
        };
      }
      if (defenseType === undefined) return undefined;
      return {
        ...common,
        kind,
        defenseType,
        tiers: toTiers3(mapTiers(base)),
      };
    case 'economy':
      if (effectType === undefined) return undefined;
      return {
        ...common,
        kind,
        effect: { type: effectType },
        tiers: toTiers3(
          mapTiers((t) => ({
            ...base(t),
            costPerStep: num(t, 'costPerStep'),
            stepIntervalTicks: num(t, 'stepIntervalTicks'),
            stepPercent: num(t, 'stepPercent'),
            maxSteps: num(t, 'maxSteps'),
          })),
        ),
      };
    default: {
      const tier = tierRecords[0];
      return {
        ...common,
        kind: 'core',
        tiers: [{ health: num(tier, 'health') }],
      };
    }
  }
}

/**
 * Validate parsed building data (the contents of buildings.json) against
 * the already-loaded resources and units.
 */
export function loadBuildings(
  data: unknown,
  context: BuildingLoadContext,
): BuildingLoadResult {
  const list = readList(data, 'buildings', 'Building');
  if ('error' in list) return { ok: false, errors: [list.error] };
  const errors: string[] = [];
  if (list.entries.length === 0) errors.push('"buildings" must not be empty.');

  const defs: BuildingDef[] = [];
  const seen = new Set<string>();
  list.entries.forEach((entry, index) => {
    const def = parseBuilding(
      entry,
      `buildings[${String(index)}]`,
      context,
      seen,
      errors,
    );
    if (def !== undefined) defs.push(def);
  });

  if (errors.length > 0) return { ok: false, errors };
  const byId = new Map(defs.map((d) => [d.id, d]));
  return { ok: true, config: { get: (id) => byId.get(id), list: () => defs } };
}

/** Like loadBuildings, but throws one Error listing every problem. */
export function loadBuildingsOrThrow(
  data: unknown,
  context: BuildingLoadContext,
): BuildingConfig {
  return unwrapOrThrow('building configuration', loadBuildings(data, context));
}

/**
 * The cost and the minimum time between productions of a consumer tier
 * (PP-6): `costPerUnit` / `productionIntervalTicks` for a unit producer,
 * `costPerShot` / `cooldownTicks` for a turret, `costPerStep` /
 * `stepIntervalTicks` for an economy building. `undefined` for a building
 * that consumes nothing (CB-10c) or a tier that does not exist.
 */
export function productionOf(
  def: BuildingDef,
  tier: number,
): { readonly cost: number; readonly interval: number } | undefined {
  switch (def.kind) {
    case 'unit_producer': {
      const t = def.tiers[tier - 1];
      return t && { cost: t.costPerUnit, interval: t.productionIntervalTicks };
    }
    case 'economy': {
      const t = def.tiers[tier - 1];
      return t && { cost: t.costPerStep, interval: t.stepIntervalTicks };
    }
    case 'defense': {
      if (def.defenseType !== 'turret') return undefined;
      const t = def.tiers[tier - 1];
      return t && { cost: t.costPerShot, interval: t.cooldownTicks };
    }
    default:
      return undefined;
  }
}

/**
 * Items per 1000 ticks a consumer takes at its top speed (PP-6):
 * `floor(1000 * cost / interval)`; 0 for a building that consumes nothing.
 */
export function needPer1000(def: BuildingDef, tier: number): number {
  const p = productionOf(def, tier);
  return p === undefined ? 0 : mulDiv(1000, p.cost, p.interval);
}

/**
 * The same need as items per second in hundredths, rounded down (PP-6):
 * `floor(100 * cost * ticksPerSecond / interval)`.
 */
export function needHundredthsPerSecond(
  def: BuildingDef,
  tier: number,
  ticksPerSecond: number,
): number {
  const p = productionOf(def, tier);
  return p === undefined
    ? 0
    : mulDiv(mulDiv(100, p.cost, 1), ticksPerSecond, p.interval);
}
