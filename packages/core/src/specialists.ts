/**
 * The starting specialists (RS-13, CB-51): loaded from content/specialists.json.
 * See docs/rules-reference.md, "Specialists".
 *
 * Each player picks one specialist before Core placement. A specialist has a
 * family, owner-scoped bonus effects and the ID of a signature building. The
 * effects and the signature building have no effect on a battle or a shop yet
 * (later steps of issue #468): this file only holds and checks the numbers.
 */

import { MODIFIER_TARGETS, type ModifierTarget } from './modifiers.js';
import {
  isRecord,
  readId,
  readInt,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';

/** The kind of building or unit a family bonus touches (CB-51). */
export const SPECIALIST_FAMILIES = [
  'logistics',
  'defense',
  'units',
  'industry',
] as const;
export type SpecialistFamily = (typeof SPECIALIST_FAMILIES)[number];

/** The owner-scoped effect kinds of a family bonus (CB-51a). */
export const SPECIALIST_EFFECT_KINDS = [
  'building_health_percent',
  'unit_health_percent',
  'source_speed_percent',
  'production_speed_percent',
] as const;
export type SpecialistEffectKind = (typeof SPECIALIST_EFFECT_KINDS)[number];

export type SpecialistEffect =
  | {
      readonly kind: 'building_health_percent';
      readonly target: ModifierTarget;
      readonly percent: number;
    }
  | {
      readonly kind: Exclude<SpecialistEffectKind, 'building_health_percent'>;
      readonly percent: number;
    };

export interface SpecialistDef {
  readonly id: string;
  readonly family: SpecialistFamily;
  /** The bonus on the owner's own buildings or units, in file order. */
  readonly effects: readonly SpecialistEffect[];
  /** The building only this specialist can buy (from a later step). */
  readonly signature: string;
}

export interface SpecialistConfig {
  /** The roster, in file order (the order the pick screen shows). */
  readonly specialists: readonly SpecialistDef[];
  /** The definition of an ID, or undefined if it is not in the roster. */
  get(id: string): SpecialistDef | undefined;
  /** The IDs of the roster, in file order. */
  ids(): readonly string[];
}

export type SpecialistsLoadResult = LoadResult<SpecialistConfig>;

export const SPECIALIST_ID_PATTERN = /^spec_[a-z0-9_]+$/;
const SIGNATURE_PATTERN = /^bld_[a-z0-9_]+$/;

/** Bounds (rules reference, "Content bounds"). */
export const MAX_SPECIALISTS = 16;
export const MAX_SPECIALIST_EFFECTS = 4;
export const MAX_SPECIALIST_PERCENT = 100;
export const MAX_SPECIALIST_ID_LENGTH = 48;

const TOP_KEYS = new Set(['$schema', 'specialists']);
const ENTRY_KEYS = new Set(['id', 'family', 'effects', 'signature']);

function loadEffect(
  raw: unknown,
  at: string,
  errors: string[],
): SpecialistEffect | undefined {
  if (!isRecord(raw)) {
    errors.push(`${at}: must be an object.`);
    return undefined;
  }
  const kind = raw['kind'];
  if (
    typeof kind !== 'string' ||
    !(SPECIALIST_EFFECT_KINDS as readonly string[]).includes(kind)
  ) {
    errors.push(
      `${at}: "kind" must be one of ${SPECIALIST_EFFECT_KINDS.join(', ')}.`,
    );
    return undefined;
  }
  const withTarget = kind === 'building_health_percent';
  rejectUnknownKeys(
    raw,
    new Set(withTarget ? ['kind', 'target', 'percent'] : ['kind', 'percent']),
    at,
    errors,
  );
  const before = errors.length;
  const percent = readInt(
    raw,
    'percent',
    1,
    at,
    errors,
    MAX_SPECIALIST_PERCENT,
  );
  if (!withTarget) {
    if (percent === undefined || errors.length > before) return undefined;
    return {
      kind: kind as Exclude<SpecialistEffectKind, 'building_health_percent'>,
      percent,
    };
  }
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
  if (percent === undefined || errors.length > before) return undefined;
  return {
    kind: 'building_health_percent',
    target: target as ModifierTarget,
    percent,
  };
}

/** Validate parsed `specialists.json`. */
export function loadSpecialists(data: unknown): SpecialistsLoadResult {
  if (!isRecord(data) || !Array.isArray(data['specialists'])) {
    return {
      ok: false,
      errors: ['Specialists file must be an object with a "specialists" list.'],
    };
  }
  const errors: string[] = [];
  rejectUnknownKeys(data, TOP_KEYS, 'specialists', errors);
  const raw = data['specialists'] as unknown[];
  if (raw.length < 1 || raw.length > MAX_SPECIALISTS) {
    errors.push(
      `specialists: must list 1 to ${String(MAX_SPECIALISTS)} specialists (got ${String(raw.length)}).`,
    );
  }
  const list: SpecialistDef[] = [];
  const ids = new Set<string>();
  const signatures = new Set<string>();
  raw.forEach((entry, i) => {
    const at = `specialists[${String(i)}]`;
    if (!isRecord(entry)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    const before = errors.length;
    rejectUnknownKeys(entry, ENTRY_KEYS, at, errors);
    const id = readId(entry, SPECIALIST_ID_PATTERN, at, errors);
    if (id !== undefined && id.length > MAX_SPECIALIST_ID_LENGTH) {
      errors.push(
        `${at} ("${id}"): id must be at most ${String(MAX_SPECIALIST_ID_LENGTH)} characters.`,
      );
    }
    if (id !== undefined) {
      if (ids.has(id)) errors.push(`${at}: duplicate id "${id}".`);
      ids.add(id);
    }
    const family = entry['family'];
    if (
      typeof family !== 'string' ||
      !(SPECIALIST_FAMILIES as readonly string[]).includes(family)
    ) {
      errors.push(
        `${at}: "family" must be one of ${SPECIALIST_FAMILIES.join(', ')}.`,
      );
    }
    const signature = entry['signature'];
    if (typeof signature !== 'string' || !SIGNATURE_PATTERN.test(signature)) {
      errors.push(
        `${at}: "signature" must be a building ID matching ${String(SIGNATURE_PATTERN)}.`,
      );
    } else {
      if (signatures.has(signature)) {
        errors.push(`${at}: duplicate signature building "${signature}".`);
      }
      signatures.add(signature);
    }
    const effects: SpecialistEffect[] = [];
    const rawEffects = entry['effects'];
    if (
      !Array.isArray(rawEffects) ||
      rawEffects.length < 1 ||
      rawEffects.length > MAX_SPECIALIST_EFFECTS
    ) {
      errors.push(
        `${at}: "effects" must list 1 to ${String(MAX_SPECIALIST_EFFECTS)} effects.`,
      );
    } else {
      (rawEffects as unknown[]).forEach((e, j) => {
        const eff = loadEffect(e, `${at}.effects[${String(j)}]`, errors);
        if (eff !== undefined) effects.push(eff);
      });
    }
    if (errors.length > before || id === undefined) return;
    list.push({
      id,
      family: family as SpecialistFamily,
      effects,
      signature: signature as string,
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  const byId = new Map(list.map((d) => [d.id, d]));
  const idList = list.map((d) => d.id);
  return {
    ok: true,
    config: {
      specialists: list,
      get: (id) => byId.get(id),
      ids: () => idList,
    },
  };
}

export function loadSpecialistsOrThrow(data: unknown): SpecialistConfig {
  return unwrapOrThrow('specialists', loadSpecialists(data));
}
