/** Unit rules (CB-13..CB-15). All numbers are integers; times are in ticks. */

import { addInt, divFloor, mulInt } from './int.js';
import {
  CELL_UNITS,
  MAX_DAMAGE,
  MAX_HEALTH,
  MAX_UNIT_RADIUS,
  MAX_UNIT_REACH,
} from './limits.js';
import {
  isRecord,
  readBool,
  readId,
  readInt,
  readList,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';

export type UnitId = string;
export type AttackType = 'melee' | 'ranged';

export interface UnitDef {
  readonly id: UnitId;
  readonly health: number;
  readonly damage: number;
  readonly attackCooldownTicks: number;
  /** Ticks to walk one cell; the speed is `unitSpeed(def)`. */
  readonly moveCooldownTicks: number;
  /**
   * Radius of the body, in sub-cell units (`CELL_UNITS` per cell): used for
   * reach, aggro and turret range, and for drawing.
   */
  readonly radius: number;
  /** Radius of the circle that may not overlap anything, sub-cell units. */
  readonly collisionRadius: number;
  /**
   * Most the gap between this unit's circle and its target (a unit's circle
   * or the nearest point of a building) may be for it to attack, in sub-cell
   * units.
   */
  readonly reach: number;
  /**
   * A flying unit ignores walls, lakes and cliffs and collides only with
   * other flying units (issue #59, "Ranged units and flyers"). Always ranged.
   */
  readonly flying: boolean;
  /**
   * `melee` units cannot hit flying units; `ranged` units can (a ranged
   * unit's `reach` is its range).
   */
  readonly attackType: AttackType;
}

/** Sub-cell units a unit walks per tick: `floor(CELL_UNITS / moveCooldownTicks)`. */
export function unitSpeed(def: UnitDef): number {
  return divFloor(CELL_UNITS, def.moveCooldownTicks);
}

/**
 * The largest strength percent `P` for which `unitStats` keeps this unit
 * within the stat bounds: the largest `P` with `floor(health * (100 + P) /
 * 100) <= MAX_HEALTH` and the same for damage and `MAX_DAMAGE`. Exact:
 * `floor(v * (100 + P) / 100) <= M` holds iff `v * (100 + P) <= 100 * M + 99`.
 * A unit with 0 damage does not limit damage.
 */
export function maxStrengthPercent(def: UnitDef): number {
  const room = (value: number, max: number): number =>
    value === 0
      ? Number.MAX_SAFE_INTEGER
      : divFloor(addInt(mulInt(100, max), 99), value) - 100;
  return Math.min(room(def.health, MAX_HEALTH), room(def.damage, MAX_DAMAGE));
}

export interface UnitConfig {
  get(id: UnitId): UnitDef | undefined;
  /** Every unit, in file order. */
  list(): readonly UnitDef[];
}

export type UnitLoadResult = LoadResult<UnitConfig>;

const ID_PATTERN = /^unit_[a-z0-9_]+$/;
const KNOWN_KEYS = new Set([
  'id',
  'health',
  'damage',
  'attackCooldownTicks',
  'moveCooldownTicks',
  'radius',
  'collisionRadius',
  'reach',
  'flying',
  'attackType',
]);

/** Validate parsed unit data (the contents of units.json). */
export function loadUnits(data: unknown): UnitLoadResult {
  const list = readList(data, 'units', 'Unit');
  if ('error' in list) return { ok: false, errors: [list.error] };
  const errors: string[] = [];
  if (list.entries.length === 0) errors.push('"units" must not be empty.');

  const defs: UnitDef[] = [];
  const seen = new Set<string>();
  list.entries.forEach((entry, index) => {
    const at = `units[${String(index)}]`;
    if (!isRecord(entry)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    const before = errors.length;
    const id = readId(entry, ID_PATTERN, at, errors);
    const label = id === undefined ? at : `${at} ("${id}")`;
    if (id !== undefined) {
      if (seen.has(id)) errors.push(`${label}: duplicate id "${id}".`);
      seen.add(id);
    }
    const health = readInt(entry, 'health', 1, label, errors, MAX_HEALTH);
    const damage = readInt(entry, 'damage', 0, label, errors, MAX_DAMAGE);
    const attackCooldownTicks = readInt(
      entry,
      'attackCooldownTicks',
      1,
      label,
      errors,
    );
    const moveCooldownTicks = readInt(
      entry,
      'moveCooldownTicks',
      1,
      label,
      errors,
      CELL_UNITS,
    );
    const radius = readInt(entry, 'radius', 1, label, errors, MAX_UNIT_RADIUS);
    const collisionRadius = readInt(
      entry,
      'collisionRadius',
      1,
      label,
      errors,
      MAX_UNIT_RADIUS,
    );
    const reach = readInt(entry, 'reach', 0, label, errors, MAX_UNIT_REACH);
    const flying = readBool(entry, 'flying', label, errors);
    const attackType = entry['attackType'];
    if (attackType !== 'melee' && attackType !== 'ranged') {
      errors.push(
        `${label}: unknown attackType ${JSON.stringify(attackType)}; expected "melee" or "ranged".`,
      );
    } else if (flying === true && attackType !== 'ranged') {
      errors.push(`${label}: a "flying" unit must have attackType "ranged".`);
    }
    rejectUnknownKeys(entry, KNOWN_KEYS, label, errors);
    if (
      errors.length === before &&
      id !== undefined &&
      health !== undefined &&
      damage !== undefined &&
      attackCooldownTicks !== undefined &&
      moveCooldownTicks !== undefined &&
      radius !== undefined &&
      collisionRadius !== undefined &&
      reach !== undefined &&
      flying !== undefined &&
      (attackType === 'melee' || attackType === 'ranged')
    ) {
      defs.push({
        id,
        health,
        damage,
        attackCooldownTicks,
        moveCooldownTicks,
        radius,
        collisionRadius,
        reach,
        flying,
        attackType,
      });
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  const byId = new Map(defs.map((d) => [d.id, d]));
  return { ok: true, config: { get: (id) => byId.get(id), list: () => defs } };
}

/** Like loadUnits, but throws one Error listing every problem. */
export function loadUnitsOrThrow(data: unknown): UnitConfig {
  return unwrapOrThrow('unit configuration', loadUnits(data));
}
