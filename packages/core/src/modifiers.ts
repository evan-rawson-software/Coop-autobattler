/**
 * Run modifiers (W2-3, EC-8): small data records stored in the team state
 * (`TeamState.modifiers`) that the battle simulation reads. A modifier is an
 * ID plus a list of effects; the effects are copied into the team state when
 * the modifier is taken, so a saved run keeps its meaning if the content
 * changes later. All arithmetic is in integers (percent, rounded down).
 * See docs/rules-reference.md, "Events and run modifiers".
 */

import { sortedKeys } from './hash.js';
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
  | { readonly kind: 'unit_strength_percent'; readonly percent: number }
  | { readonly kind: 'turret_damage_percent'; readonly percent: number };

/** A modifier as held by a team: ID and the effects it had when taken. */
export interface TeamModifier {
  readonly id: string;
  readonly effects: readonly ModifierEffect[];
}

export const MODIFIER_ID = /^mod_[a-z0-9_]+$/;

/** Highest percent a single effect may give (keeps products in range). */
export const MAX_MODIFIER_PERCENT = 1000;

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
      : new Set(['kind', 'percent']);
  for (const key of sortedKeys(raw)) {
    if (!allowed.has(key)) errors.push(`${at}: unknown field "${key}".`);
  }
  const percent = raw['percent'];
  const percentOk =
    typeof percent === 'number' &&
    Number.isInteger(percent) &&
    percent >= 1 &&
    percent <= MAX_MODIFIER_PERCENT;
  if (!percentOk) {
    errors.push(
      `${at}: "percent" must be an integer from 1 to ${String(MAX_MODIFIER_PERCENT)}.`,
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
  if (
    kind === 'core_health_percent' ||
    kind === 'unit_strength_percent' ||
    kind === 'turret_damage_percent'
  ) {
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

/** Sum of the percents of effects of `kind` (and `target`, if given). */
export function modifierPercent(
  team: HasModifiers,
  kind: ModifierEffectKind,
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
      total += e.percent;
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
