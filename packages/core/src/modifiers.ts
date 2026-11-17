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
  'unit_armor_flat',
  'unit_splash_percent',
  'poi_capture_speed_percent',
  'shop_income_flat',
  'sell_refund_percent',
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
  | { readonly kind: 'turret_damage_percent'; readonly percent: number }
  /**
   * Feature-linked combat effects (issue #426).
   */
  | {
      readonly kind: 'unit_armor_flat';
      /** Armor added after the unit's own, 1 to `MAX_ARMOR_FLAT`; the total stays within `MAX_ARMOR`. */
      readonly amount: number;
      /** As for `unit_strength_percent`: absent means every unit type. */
      readonly units?: readonly string[];
    }
  | {
      readonly kind: 'unit_splash_percent';
      /** Added to the splash percent of a unit with `splash`, 1 to `MAX_SPEED_MODIFIER_PERCENT`; no effect on a unit without splash. */
      readonly percent: number;
      /** As for `unit_strength_percent`: absent means every unit type. */
      readonly units?: readonly string[];
    }
  | {
      /** Side-wide: the side's points of interest capture faster. 1 to `MAX_SPEED_MODIFIER_PERCENT`. */
      readonly kind: 'poi_capture_speed_percent';
      readonly percent: number;
    }
  /**
   * Gold effects (issue #425), non-combat: the arena ignores them. Party-wide:
   * every player gets them.
   */
  | {
      readonly kind: 'shop_income_flat';
      /** Whole gold per shop, 1 to `MAX_SHOP_INCOME_FLAT`. */
      readonly amount: number;
    }
  | {
      readonly kind: 'sell_refund_percent';
      /** Added to the base sell refund percent, 1 to `MAX_SELL_REFUND_PERCENT_ADD`. */
      readonly percent: number;
    };

/** The effect kinds the simulation ignores: they change gold only. */
export function isGoldEffect(
  e: ModifierEffect,
): e is Extract<
  ModifierEffect,
  { kind: 'shop_income_flat' | 'sell_refund_percent' }
> {
  return e.kind === 'shop_income_flat' || e.kind === 'sell_refund_percent';
}

/** The signed number of an effect: its `percent`, or the `amount` of a flat one. */
export function effectValue(e: ModifierEffect): number {
  return e.kind === 'shop_income_flat' || e.kind === 'unit_armor_flat'
    ? e.amount
    : e.percent;
}

/** A modifier as held by a team: ID and the effects it had when taken. */
export interface TeamModifier {
  readonly id: string;
  readonly effects: readonly ModifierEffect[];
}

export const MODIFIER_ID = /^mod_[a-z0-9_]+$/;
const UNIT_ID = /^unit_[a-z0-9_]+$/;

/** The percent effect kinds that may carry `units` (`unit_armor_flat` does too, with `amount`). */
function hasUnitsField(
  kind: unknown,
): kind is
  | 'unit_strength_percent'
  | 'unit_move_speed_percent'
  | 'unit_attack_speed_percent'
  | 'unit_splash_percent' {
  return (
    kind === 'unit_strength_percent' ||
    kind === 'unit_move_speed_percent' ||
    kind === 'unit_attack_speed_percent' ||
    kind === 'unit_splash_percent'
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

/** Highest `amount` of a `unit_armor_flat` effect (issue #426); lowest 1. */
export const MAX_ARMOR_FLAT = 10;

/** Highest `amount` of a `shop_income_flat` effect (issue #425); lowest 1. */
export const MAX_SHOP_INCOME_FLAT = 10;

/** Highest `percent` of a `sell_refund_percent` effect (issue #425); lowest 1. */
export const MAX_SELL_REFUND_PERCENT_ADD = 90;

/**
 * The most the sell refund percent can reach through modifiers, so that
 * selling never refunds the full price (issue #425).
 */
export const SELL_REFUND_PERCENT_CAP = 90;

/**
 * The `units` field of an effect: undefined when absent, false (with an
 * error pushed) when invalid, else the list.
 */
function parseUnitsList(
  rawUnits: unknown,
  at: string,
  errors: string[],
): readonly string[] | undefined | false {
  if (rawUnits === undefined) return undefined;
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
    return false;
  }
  if (new Set(ids).size !== ids.length) {
    errors.push(`${at}: "units" must not list a unit twice.`);
    return false;
  }
  return ids;
}

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
      : kind === 'shop_income_flat'
        ? new Set(['kind', 'amount'])
        : kind === 'unit_armor_flat'
          ? new Set(['kind', 'amount', 'units'])
          : hasUnitsField(kind)
            ? new Set(['kind', 'percent', 'units'])
            : new Set(['kind', 'percent']);
  for (const key of sortedKeys(raw)) {
    if (!allowed.has(key)) errors.push(`${at}: unknown field "${key}".`);
  }
  if (kind === 'shop_income_flat' || kind === 'unit_armor_flat') {
    const amount = raw['amount'];
    const max =
      kind === 'shop_income_flat' ? MAX_SHOP_INCOME_FLAT : MAX_ARMOR_FLAT;
    let amountOk = true;
    if (
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > max
    ) {
      errors.push(
        `${at}: "amount" of ${kind} must be an integer from 1 to ${String(max)}.`,
      );
      amountOk = false;
    }
    if (kind === 'shop_income_flat') {
      return amountOk ? { kind, amount: amount as number } : undefined;
    }
    const units = parseUnitsList(raw['units'], at, errors);
    if (!amountOk || units === false) return undefined;
    return units === undefined
      ? { kind, amount: amount as number }
      : { kind, amount: amount as number, units };
  }
  const percent = raw['percent'];
  const percentOk =
    typeof percent === 'number' &&
    Number.isInteger(percent) &&
    percent !== 0 &&
    percent >= MIN_MODIFIER_PERCENT &&
    percent <= MAX_MODIFIER_PERCENT;
  if (!percentOk && kind !== 'sell_refund_percent') {
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
    const units = parseUnitsList(raw['units'], at, errors);
    const unitsOk = units !== false;
    if (!percentOk || !rangeOk || !unitsOk) return undefined;
    return units === undefined ? { kind, percent } : { kind, percent, units };
  }
  if (kind === 'sell_refund_percent') {
    if (
      typeof percent !== 'number' ||
      !Number.isInteger(percent) ||
      percent < 1 ||
      percent > MAX_SELL_REFUND_PERCENT_ADD
    ) {
      errors.push(
        `${at}: "percent" of ${kind} must be an integer from 1 to ${String(MAX_SELL_REFUND_PERCENT_ADD)}.`,
      );
      return undefined;
    }
    return { kind, percent };
  }
  if (kind === 'poi_capture_speed_percent') {
    if (percentOk && percent >= 1 && percent <= MAX_SPEED_MODIFIER_PERCENT) {
      return { kind, percent };
    }
    if (percentOk) {
      errors.push(
        `${at}: "percent" of ${kind} must be an integer from 1 to ${String(MAX_SPEED_MODIFIER_PERCENT)}.`,
      );
    }
    return undefined;
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
 * `extra` is an owner-scoped percent (a specialist's effect, EC-8a) that
 * joins the sum before the floor, so the Shrine effects and the specialist's
 * are summed and applied once.
 */
export function modifierPercent(
  team: HasModifiers,
  kind: ModifierEffectKind,
  minSum: number,
  target?: string,
  extra = 0,
): number {
  let total = extra;
  for (const m of team.modifiers ?? []) {
    for (const e of m.effects) {
      if (
        e.kind !== kind ||
        e.kind === 'shop_income_flat' ||
        e.kind === 'unit_armor_flat'
      ) {
        continue;
      }
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

/**
 * Gold a shop adds on top of `baseIncomePerShop`: the sum of the held
 * `shop_income_flat` amounts (issue #425), checked like `modifierPercent`.
 * Party-wide: every player gets it.
 */
export function shopIncomeBonus(team: HasModifiers): number {
  let total = 0;
  for (const m of team.modifiers ?? []) {
    for (const e of m.effects) {
      if (e.kind !== 'shop_income_flat') continue;
      try {
        total = addInt(total, e.amount);
      } catch {
        throw new RangeError(
          `Modifier shop_income_flat: the amount sum must be an integer within the safe bound ${String(Number.MAX_SAFE_INTEGER)} (adding ${String(e.amount)} to ${String(total)}).`,
        );
      }
    }
  }
  return total;
}

/**
 * The sell refund percent a team gets: `base` (`sellRefundPercent`) plus the
 * held `sell_refund_percent` effects, capped at `SELL_REFUND_PERCENT_CAP`
 * (issue #425). With no such effect it is `base` itself; the cap never lowers
 * the base.
 */
export function sellRefundPercentFor(team: HasModifiers, base: number): number {
  let add = 0;
  for (const m of team.modifiers ?? []) {
    for (const e of m.effects) {
      if (e.kind !== 'sell_refund_percent') continue;
      try {
        add = addInt(add, e.percent);
      } catch {
        throw new RangeError(
          `Modifier sell_refund_percent: the percent sum must be an integer within the safe bound ${String(Number.MAX_SAFE_INTEGER)} (adding ${String(e.percent)} to ${String(add)}).`,
        );
      }
    }
  }
  if (add === 0) return base;
  return Math.max(base, Math.min(base + add, SELL_REFUND_PERCENT_CAP));
}

/**
 * Sum of the `unit_splash_percent` effects that apply to unit type `unitId`
 * (issue #426), added to the unit's splash percent. Never negative. Checked
 * like `modifierPercent`.
 */
export function unitSplashPercent(team: HasModifiers, unitId: string): number {
  let total = 0;
  for (const m of team.modifiers ?? []) {
    for (const e of m.effects) {
      if (e.kind !== 'unit_splash_percent') continue;
      if (e.units !== undefined && !e.units.includes(unitId)) continue;
      total = checkedAdd(total, e.percent, e.kind);
    }
  }
  return total;
}

/**
 * Sum of the `unit_armor_flat` amounts that apply to unit type `unitId`
 * (issue #426), added to the unit's armor (the total is capped at
 * `MAX_ARMOR` where it is applied).
 */
export function unitArmorBonus(team: HasModifiers, unitId: string): number {
  let total = 0;
  for (const m of team.modifiers ?? []) {
    for (const e of m.effects) {
      if (e.kind !== 'unit_armor_flat') continue;
      if (e.units !== undefined && !e.units.includes(unitId)) continue;
      total = checkedAdd(total, e.amount, e.kind);
    }
  }
  return total;
}

/**
 * Sum of the team's `poi_capture_speed_percent` effects (issue #426): the
 * side-wide capture speed bonus. 0 without any.
 */
export function captureSpeedPercent(team: HasModifiers): number {
  let total = 0;
  for (const m of team.modifiers ?? []) {
    for (const e of m.effects) {
      if (e.kind !== 'poi_capture_speed_percent') continue;
      total = checkedAdd(total, e.percent, e.kind);
    }
  }
  return total;
}

function checkedAdd(total: number, add: number, kind: string): number {
  try {
    return addInt(total, add);
  } catch {
    throw new RangeError(
      `Modifier ${kind}: the sum must be an integer within the safe bound ${String(Number.MAX_SAFE_INTEGER)} (adding ${String(add)} to ${String(total)}).`,
    );
  }
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
