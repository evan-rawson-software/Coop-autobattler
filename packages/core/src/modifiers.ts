/**
 * Run modifiers (W2-3, EC-8): small data records stored in the team state
 * (`TeamState.modifiers`) that the battle simulation reads. A modifier is an
 * ID plus a list of effects; the effects are copied into the team state when
 * the modifier is taken, so a saved run keeps its meaning if the content
 * changes later. All arithmetic is in integers (percent, rounded down).
 * See docs/rules-reference.md, "Events and run modifiers".
 */

import { sortedKeys } from './hash.js';
import { addInt } from './int.js';
import { isRecord } from './load-util.js';

/**
 * Which buildings a `building_health_percent` effect touches: a defense
 * matches its defense type (`wall`, `gate`, `turret`), any other building its
 * kind; `all` matches every building but not the Core.
 */
export const MODIFIER_TARGETS = [
  'all',
  'wall',
  'gate',
  'turret',
  'source',
  'route',
  'unit_producer',
  'economy',
] as const;
export type ModifierTarget = (typeof MODIFIER_TARGETS)[number];

/** The effect kinds the simulation understands. */
export const MODIFIER_EFFECT_KINDS = [
  'building_health_percent',
  'core_health_percent',
  'unit_strength_percent',
  'unit_move_speed_percent',
  'unit_attack_speed_percent',
  'turret_damage_percent',
] as const;
export type ModifierEffectKind = (typeof MODIFIER_EFFECT_KINDS)[number];

export type ModifierEffect =
  | {
      readonly kind: 'building_health_percent';
      readonly target: ModifierTarget;
      readonly percent: number;
    }
  | { readonly kind: 'core_health_percent'; readonly percent: number }
  | {
      readonly kind: 'unit_strength_percent';
      readonly percent: number;
      /**
       * The unit types it applies to, in the order of content/units.json, no
       * duplicates, at least one. Absent: every unit type.
       */
      readonly units?: readonly string[];
    }
  | {
      readonly kind: 'unit_move_speed_percent' | 'unit_attack_speed_percent';
      /** 1 to `MAX_SPEED_MODIFIER_PERCENT`: a speed bonus is never a drawback. */
      readonly percent: number;
      /** As for `unit_strength_percent`: absent means every unit type. */
      readonly units?: readonly string[];
    }
  | { readonly kind: 'turret_damage_percent'; readonly percent: number };

/** A modifier as held by a team: ID and the effects it had when taken. */
export interface TeamModifier {
  readonly id: string;
  readonly effects: readonly ModifierEffect[];
}

export const MODIFIER_ID = /^mod_[a-z0-9_]+$/;
const UNIT_ID = /^unit_[a-z0-9_]+$/;

/** The effect kinds that may carry `units`. */
function hasUnitsField(
  kind: unknown,
): kind is
  | 'unit_strength_percent'
  | 'unit_move_speed_percent'
  | 'unit_attack_speed_percent' {
  return (
    kind === 'unit_strength_percent' ||
    kind === 'unit_move_speed_percent' ||
    kind === 'unit_attack_speed_percent'
  );
}

/** Highest percent a single effect may give (keeps products in range). */
export const MAX_MODIFIER_PERCENT = 1000;

/**
 * Lowest percent a single effect may have: a drawback (RS-4i6). A percent is
 * an integer from this to `MAX_MODIFIER_PERCENT`, never 0.
 */
export const MIN_MODIFIER_PERCENT = -90;

/**
 * Highest percent a unit move or attack speed effect may give (issue #424).
 * Its lowest is 1: those kinds have no drawback form.
 */
export const MAX_SPEED_MODIFIER_PERCENT = 100;

/**
 * Parse one effect from untrusted data. Pushes readable errors and returns
 * undefined when it is not valid.
 */
export function parseModifierEffect(
  raw: unknown,
  at: string,
  errors: string[],
): ModifierEffect | undefined {
  if (!isRecord(raw)) {
    errors.push(`${at}: must be an object.`);
    return undefined;
  }
  const kind = raw['kind'];
  const allowed =
    kind === 'building_health_percent'
      ? new Set(['kind', 'target', 'percent'])
      : hasUnitsField(kind)
        ? new Set(['kind', 'percent', 'units'])
        : new Set(['kind', 'percent']);
  for (const key of sortedKeys(raw)) {
    if (!allowed.has(key)) errors.push(`${at}: unknown field "${key}".`);
  }
  const percent = raw['percent'];
  const percentOk =
    typeof percent === 'number' &&
    Number.isInteger(percent) &&
    percent !== 0 &&
    percent >= MIN_MODIFIER_PERCENT &&
    percent <= MAX_MODIFIER_PERCENT;
  if (!percentOk) {
    errors.push(
      `${at}: "percent" must be an integer from ${String(MIN_MODIFIER_PERCENT)} to ${String(MAX_MODIFIER_PERCENT)}, not 0.`,
    );
  }
  if (kind === 'building_health_percent') {
    const target = raw['target'];
    if (
      typeof target !== 'string' ||
      !(MODIFIER_TARGETS as readonly string[]).includes(target)
    ) {
      errors.push(
        `${at}: "target" must be one of ${MODIFIER_TARGETS.join(', ')}.`,
      );
      return undefined;
    }
    return percentOk
      ? { kind, target: target as ModifierTarget, percent }
      : undefined;
  }
  if (hasUnitsField(kind)) {
    const speed = kind !== 'unit_strength_percent';
    const rangeOk =
      !speed ||
      (percentOk && percent >= 1 && percent <= MAX_SPEED_MODIFIER_PERCENT);
    if (percentOk && !rangeOk) {
      errors.push(
        `${at}: "percent" of ${kind} must be an integer from 1 to ${String(MAX_SPEED_MODIFIER_PERCENT)}.`,
      );
    }
    const rawUnits = raw['units'];
    let units: readonly string[] | undefined;
    let unitsOk = true;
    if (rawUnits !== undefined) {
      const list = Array.isArray(rawUnits) ? (rawUnits as unknown[]) : [];
      const ids = list.filter((u): u is string => typeof u === 'string');
      if (
        !Array.isArray(rawUnits) ||
        list.length === 0 ||
        ids.length !== list.length ||
        !ids.every((u) => UNIT_ID.test(u))
      ) {
        errors.push(
          `${at}: "units" must be a non-empty array of unit IDs (${String(UNIT_ID)}).`,
        );
        unitsOk = false;
      } else if (new Set(ids).size !== ids.length) {
        errors.push(`${at}: "units" must not list a unit twice.`);
        unitsOk = false;
      } else {
        units = ids;
      }
    }
    if (!percentOk || !rangeOk || !unitsOk) return undefined;
    return units === undefined ? { kind, percent } : { kind, percent, units };
  }
  if (kind === 'core_health_percent' || kind === 'turret_damage_percent') {
    return percentOk ? { kind, percent } : undefined;
  }
  errors.push(
    `${at}: unknown effect kind ${JSON.stringify(kind)} (expected ${MODIFIER_EFFECT_KINDS.join(', ')}).`,
  );
  return undefined;
}

/** Parse a team's `modifiers` list. Never returns an empty list. */
export function parseTeamModifiers(
  raw: unknown,
  errors: string[],
): readonly TeamModifier[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push('modifiers: must be an array.');
    return undefined;
  }
  if (raw.length === 0) {
    errors.push('modifiers: must be omitted when empty.');
    return undefined;
  }
  const out: TeamModifier[] = [];
  const before = errors.length;
  (raw as unknown[]).forEach((m, i) => {
    const at = `modifiers[${String(i)}]`;
    if (!isRecord(m)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    for (const key of sortedKeys(m)) {
      if (key !== 'id' && key !== 'effects') {
        errors.push(`${at}: unknown field "${key}".`);
      }
    }
    const id = m['id'];
    if (typeof id !== 'string' || !MODIFIER_ID.test(id)) {
      errors.push(`${at}: "id" must match ${String(MODIFIER_ID)}.`);
    }
    const list = m['effects'];
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${at}: "effects" must be a non-empty array.`);
      return;
    }
    const effects: ModifierEffect[] = [];
    (list as unknown[]).forEach((e, j) => {
      const effect = parseModifierEffect(
        e,
        `${at}.effects[${String(j)}]`,
        errors,
      );
      if (effect !== undefined) effects.push(effect);
    });
    if (typeof id === 'string') out.push({ id, effects });
  });
  return errors.length > before ? undefined : out;
}

/** A team with optional modifiers; all the simulation needs to read. */
export interface HasModifiers {
  readonly modifiers?: readonly TeamModifier[];
}

/**
 * The sum a battle applies: `sum` raised to `minSum` (the content's
 * `minModifierSumPercent`, at most 0) if it is lower. A sum that is not below
 * the bound is returned as it is, so all-positive modifiers are unaffected.
 */
export function clampModifierSum(sum: number, minSum: number): number {
  return sum < minSum ? minSum : sum;
}

/**
 * Sum of the percents of effects of `kind` (and `target`, if given), raised
 * to `minSum` if lower (EC-8), checked: a sum beyond the safe-integer bound
 * (2^53 - 1) throws a RangeError naming the kind and the bound.
 */
export function modifierPercent(
  team: HasModifiers,
  kind: ModifierEffectKind,
  minSum: number,
  target?: string,
): number {
  let total = 0;
  for (const m of team.modifiers ?? []) {
    for (const e of m.effects) {
      if (e.kind !== kind) continue;
      if (
        e.kind === 'building_health_percent' &&
        target !== undefined &&
        e.target !== 'all' &&
        e.target !== target
      ) {
        continue;
      }
      try {
        total = addInt(total, e.percent);
      } catch {
        throw new RangeError(
          `Modifier ${kind}: the percent sum must be an integer within the safe bound ${String(Number.MAX_SAFE_INTEGER)} (adding ${String(e.percent)} to ${String(total)}).`,
        );
      }
    }
  }
  return clampModifierSum(total, minSum);
}

/**
 * Sum of the `unit_strength_percent` effects that apply to unit type
 * `unitId`: every effect without `units`, plus every effect whose `units`
 * lists it, raised to `minSum` if lower (EC-8). Checked like
 * `modifierPercent`.
 */
export function unitStrengthPercent(
  team: HasModifiers,
  unitId: string,
  minSum: number,
): number {
  let total = 0;
  for (const m of team.modifiers ?? []) {
    for (const e of m.effects) {
      if (e.kind !== 'unit_strength_percent') continue;
      if (e.units !== undefined && !e.units.includes(unitId)) continue;
      try {
        total = addInt(total, e.percent);
      } catch {
        throw new RangeError(
          `Modifier unit_strength_percent: the percent sum must be an integer within the safe bound ${String(Number.MAX_SAFE_INTEGER)} (adding ${String(e.percent)} to ${String(total)}).`,
        );
      }
    }
  }
  return clampModifierSum(total, minSum);
}

/**
 * Sum of the `unit_move_speed_percent` or `unit_attack_speed_percent` effects
 * that apply to unit type `unitId` (no `units`, or `units` listing it). These
 * kinds are never negative, so there is no sum floor. Checked like
 * `modifierPercent`.
 */
export function unitSpeedPercent(
  team: HasModifiers,
  kind: 'unit_move_speed_percent' | 'unit_attack_speed_percent',
  unitId: string,
): number {
  let total = 0;
  for (const m of team.modifiers ?? []) {
    for (const e of m.effects) {
      if (e.kind !== kind) continue;
      if (e.units !== undefined && !e.units.includes(unitId)) continue;
      try {
        total = addInt(total, e.percent);
      } catch {
        throw new RangeError(
          `Modifier ${kind}: the percent sum must be an integer within the safe bound ${String(Number.MAX_SAFE_INTEGER)} (adding ${String(e.percent)} to ${String(total)}).`,
        );
      }
    }
  }
  return total;
}

/** The ids of the modifiers a team holds, in the order taken. */
export function heldModifierIds(team: HasModifiers): readonly string[] {
  return (team.modifiers ?? []).map((m) => m.id);
}

/** A copy of the team with `modifier` added (the field is created if needed). */
export function withModifier<T extends HasModifiers>(
  team: T,
  modifier: TeamModifier,
): T {
  return { ...team, modifiers: [...(team.modifiers ?? []), modifier] };
}
