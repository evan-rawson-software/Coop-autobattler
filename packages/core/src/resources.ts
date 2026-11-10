/** Resource configuration (TA-27a): loaded from already-parsed data. */

export type ResourceId = string;
export type Rarity = 'common' | 'rare';

export interface ResourceDef {
  readonly id: ResourceId;
  readonly name: string;
  readonly rarity: Rarity;
  readonly color?: string;
  readonly icon?: string;
  /** Present on refined resources only: one or two source resource IDs. */
  readonly refinedFrom?: readonly ResourceId[];
}

export interface ResourceConfig {
  /** Look up a resource by ID; undefined if unknown. */
  get(id: ResourceId): ResourceDef | undefined;
  /** Every resource, in file order. */
  list(): readonly ResourceDef[];
  /** Resources without `refinedFrom`, in file order. */
  listBase(): readonly ResourceDef[];
  /** Display name for an ID; throws if the ID is unknown. */
  displayName(id: ResourceId): string;
}

export type ResourceLoadResult =
  | { readonly ok: true; readonly config: ResourceConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

const RARITIES: readonly string[] = ['common', 'rare'];
const ID_PATTERN = /^res_[a-z0-9_]+$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const KNOWN_KEYS = new Set([
  'id',
  'name',
  'rarity',
  'color',
  'icon',
  'refinedFrom',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function makeConfig(defs: readonly ResourceDef[]): ResourceConfig {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const base = defs.filter((d) => d.refinedFrom === undefined);
  return {
    get: (id) => byId.get(id),
    list: () => defs,
    listBase: () => base,
    displayName: (id) => {
      const def = byId.get(id);
      if (!def) throw new Error(`Unknown resource ID "${id}"`);
      return def.name;
    },
  };
}

/** Validate parsed resource data (the contents of resources.json). */
export function loadResources(data: unknown): ResourceLoadResult {
  const errors: string[] = [];
  if (!isRecord(data) || !Array.isArray(data['resources'])) {
    return {
      ok: false,
      errors: ['Resource file must be an object with a "resources" array.'],
    };
  }
  const entries: unknown[] = data['resources'];
  if (entries.length === 0) errors.push('"resources" must not be empty.');

  const defs: ResourceDef[] = [];
  const seen = new Set<string>();
  const parsedRefs: { label: string; id: string; refs: unknown[] }[] = [];

  entries.forEach((entry, index) => {
    const at = `resources[${String(index)}]`;
    if (!isRecord(entry)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    const { id, name, rarity, color, icon, refinedFrom } = entry;
    let label = at;
    if (typeof id !== 'string' || id === '') {
      errors.push(`${at}: missing or empty "id".`);
    } else {
      label = `${at} ("${id}")`;
      if (!ID_PATTERN.test(id)) {
        errors.push(`${label}: id must match ${String(ID_PATTERN)}.`);
      }
      if (seen.has(id)) errors.push(`${label}: duplicate id "${id}".`);
      seen.add(id);
    }
    if (typeof name !== 'string' || name.trim() === '') {
      errors.push(`${label}: missing or empty "name".`);
    }
    if (typeof rarity !== 'string' || !RARITIES.includes(rarity)) {
      errors.push(
        `${label}: unknown rarity ${JSON.stringify(rarity)}; expected one of ${RARITIES.join(', ')}.`,
      );
    }
    if (
      color !== undefined &&
      (typeof color !== 'string' || !COLOR_PATTERN.test(color))
    ) {
      errors.push(`${label}: "color" must be a string like "#aabbcc".`);
    }
    if (icon !== undefined && (typeof icon !== 'string' || icon === '')) {
      errors.push(`${label}: "icon" must be a non-empty string.`);
    }
    for (const key of Object.keys(entry)) {
      if (!KNOWN_KEYS.has(key))
        errors.push(`${label}: unknown field "${key}".`);
    }
    if (refinedFrom !== undefined) {
      if (!Array.isArray(refinedFrom) || refinedFrom.length === 0) {
        errors.push(`${label}: "refinedFrom" must be a non-empty list of IDs.`);
      } else {
        const refs: unknown[] = refinedFrom;
        if (refs.length > 2) {
          errors.push(
            `${label}: "refinedFrom" has ${String(refs.length)} entries; at most 2 are allowed.`,
          );
        }
        parsedRefs.push({
          label,
          id: typeof id === 'string' ? id : '',
          refs,
        });
      }
    }
    if (
      typeof id === 'string' &&
      typeof name === 'string' &&
      typeof rarity === 'string' &&
      RARITIES.includes(rarity)
    ) {
      defs.push({
        id,
        name,
        rarity: rarity as Rarity,
        ...(typeof color === 'string' ? { color } : {}),
        ...(typeof icon === 'string' ? { icon } : {}),
        ...(Array.isArray(refinedFrom)
          ? {
              refinedFrom: (refinedFrom as unknown[]).filter(
                (r): r is string => typeof r === 'string',
              ),
            }
          : {}),
      });
    }
  });

  for (const { label, id, refs } of parsedRefs) {
    for (const ref of refs) {
      if (typeof ref !== 'string') {
        errors.push(`${label}: "refinedFrom" entries must be strings.`);
      } else if (ref === id) {
        errors.push(`${label}: lists itself in "refinedFrom".`);
      } else if (!seen.has(ref)) {
        errors.push(
          `${label}: "refinedFrom" has unknown resource ID "${ref}".`,
        );
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: makeConfig(defs) };
}

/** Like loadResources, but throws one Error listing every problem. */
export function loadResourcesOrThrow(data: unknown): ResourceConfig {
  const result = loadResources(data);
  if (!result.ok) {
    throw new Error(
      `Invalid resource configuration:\n- ${result.errors.join('\n- ')}`,
    );
  }
  return result.config;
}
