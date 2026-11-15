/** Unit rules (CB-13..CB-15). All numbers are integers; times are in ticks. */

import { addInt, divFloor, mulInt } from './int.js';
import {
  CELL_UNITS,
  MAX_ARMOR,
  MAX_SPLASH_RADIUS,
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
  /**
   * Taken off every hit on this unit, at least 1 left for a hit above 0
   * (CB-5h). Optional in the file; 0 when absent.
   */
  readonly armor: number;
  /**
   * Area damage (CB-5h, issue #387). Optional in the file and absent from the
   * definition when not given; never part of a unit's saved state. When this
   * unit attacks a unit, every other opposing unit whose centre is within
   * `radiusSub` (sub-cell units) of the target's centre takes `percent`
   * percent of the hit, rounded down, before its own armor.
   */
  readonly splash?: SplashDef;
}

/** The `splash` field of a unit definition. */
export interface SplashDef {
  readonly radiusSub: number;
  readonly percent: number;
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
  'armor',
  'splash',
]);

const SPLASH_KEYS = new Set(['radiusSub', 'percent']);

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
    const armor =
      entry['armor'] === undefined
        ? 0
        : readInt(entry, 'armor', 0, label, errors, MAX_ARMOR);
    let splash: SplashDef | undefined;
    const rawSplash = entry['splash'];
    if (rawSplash !== undefined) {
      if (!isRecord(rawSplash)) {
        errors.push(`${label}: "splash" must be an object.`);
      } else {
        const sl = `${label} splash`;
        const radiusSub = readInt(
          rawSplash,
          'radiusSub',
          1,
          sl,
          errors,
          MAX_SPLASH_RADIUS,
        );
        const percent = readInt(rawSplash, 'percent', 1, sl, errors, 100);
        rejectUnknownKeys(rawSplash, SPLASH_KEYS, sl, errors);
        if (radiusSub !== undefined && percent !== undefined) {
          splash = { radiusSub, percent };
        }
      }
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
      armor !== undefined &&
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
        armor,
        ...(splash === undefined ? {} : { splash }),
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
