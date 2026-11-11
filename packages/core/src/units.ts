/** Unit rules (CB-13..CB-15). All numbers are integers; times are in ticks. */

import { addInt, divFloor, mulInt } from './int.js';
import { MAX_DAMAGE, MAX_HEALTH } from './limits.js';
import {
  isRecord,
  readId,
  readInt,
  readList,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';

export type UnitId = string;
export type Targeting = 'core' | 'infrastructure' | 'defenses';

export interface UnitDef {
  readonly id: UnitId;
  readonly health: number;
  readonly damage: number;
  readonly attackCooldownTicks: number;
  /** 0 means melee (adjacent). */
  readonly rangeCells: number;
  /** Ticks per cell moved. */
  readonly moveCooldownTicks: number;
  readonly targeting: Targeting;
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

const TARGETING: readonly string[] = ['core', 'infrastructure', 'defenses'];
const ID_PATTERN = /^unit_[a-z0-9_]+$/;
const KNOWN_KEYS = new Set([
  'id',
  'health',
  'damage',
  'attackCooldownTicks',
  'rangeCells',
  'moveCooldownTicks',
  'targeting',
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
    const rangeCells = readInt(entry, 'rangeCells', 0, label, errors);
    const moveCooldownTicks = readInt(
      entry,
      'moveCooldownTicks',
      1,
      label,
      errors,
    );
    const targeting = entry['targeting'];
    if (typeof targeting !== 'string' || !TARGETING.includes(targeting)) {
      errors.push(
        `${label}: unknown targeting ${JSON.stringify(targeting)}; expected one of ${TARGETING.join(', ')}.`,
      );
    }
    rejectUnknownKeys(entry, KNOWN_KEYS, label, errors);
    if (
      errors.length === before &&
      id !== undefined &&
      health !== undefined &&
      damage !== undefined &&
      attackCooldownTicks !== undefined &&
      rangeCells !== undefined &&
      moveCooldownTicks !== undefined
    ) {
      defs.push({
        id,
        health,
        damage,
        attackCooldownTicks,
        rangeCells,
        moveCooldownTicks,
        targeting: targeting as Targeting,
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
