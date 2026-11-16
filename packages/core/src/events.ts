/**
 * Event and run-modifier configuration (W2-3): loaded from content/events.json.
 * See docs/rules-reference.md, "Events and run modifiers".
 *
 * An event definition names a `type` (the key of a handler in the session
 * package) and carries free-form `params` (integers and strings) that only
 * that handler reads. Adding an event of an existing type is data only;
 * adding a new type is data plus one handler. Modifier definitions are the
 * data a Shrine offers.
 */

import { sortedKeys } from './hash.js';
import {
  isRecord,
  readBool,
  readInt,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';
import {
  MODIFIER_ID,
  parseModifierEffect,
  type ModifierEffect,
} from './modifiers.js';

export interface ModifierDef {
  readonly id: string;
  /** May be taken again while already held. */
  readonly stackable: boolean;
  readonly effects: readonly ModifierEffect[];
  /** First round the Shrine may offer it (at least 1); absent means 1. */
  readonly fromRound?: number;
}

/** Highest `fromRound` a modifier definition may have. */
export const MAX_MODIFIER_FROM_ROUND = 1000;

/** Highest `fromRound` an event definition may have. */
export const MAX_EVENT_FROM_ROUND = 1000;

/**
 * Most that one next-shop effect may carry: extra offers or free re-rolls
 * (`params` of Market day, and the `count` of a saved shop effect).
 */
export const MAX_SHOP_EFFECT_COUNT = 10;

/** What `loadEvents` may check against other content. */
export interface EventsLoadContext {
  /** When given, `units` of unit-strength effects must name these units. */
  readonly units?: {
    get(id: string): unknown;
    list(): readonly { readonly id: string }[];
  };
}

export type EventParams = Readonly<Record<string, number | string>>;

export interface EventDef {
  readonly id: string;
  /** The handler key, such as `workshop`. */
  readonly type: string;
  /** Relative weight in the offer draw (at least 1). */
  readonly weight: number;
  /** First round the event may be offered (at least 1); absent means 1. */
  readonly fromRound?: number;
  readonly params: EventParams;
}

export interface EventsConfig {
  /** How many events are offered at each event step. */
  readonly offerCount: number;
  readonly events: readonly EventDef[];
  readonly modifiers: readonly ModifierDef[];
}

export type EventsLoadResult = LoadResult<EventsConfig>;

const KEYS = new Set(['$schema', 'offerCount', 'events', 'modifiers']);
const EVENT_ID = /^evt_[a-z0-9_]+$/;
const TYPE_ID = /^[a-z][a-z0-9_]*$/;

export function findEvent(
  config: EventsConfig,
  id: string,
): EventDef | undefined {
  return config.events.find((e) => e.id === id);
}

export function findModifier(
  config: EventsConfig,
  id: string,
): ModifierDef | undefined {
  return config.modifiers.find((m) => m.id === id);
}

/** Validate parsed events data (the contents of events.json). */
export function loadEvents(
  data: unknown,
  context: EventsLoadContext = {},
): EventsLoadResult {
  if (!isRecord(data)) {
    return { ok: false, errors: ['Events file must be an object.'] };
  }
  const errors: string[] = [];
  rejectUnknownKeys(data, KEYS, 'events', errors);
  const offerCount = readInt(data, 'offerCount', 1, 'events', errors);

  const events: EventDef[] = [];
  const seenEvents = new Set<string>();
  const rawEvents = data['events'];
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    errors.push('events: "events" must be a non-empty list.');
  } else {
    (rawEvents as unknown[]).forEach((e, i) => {
      const at = `events[${String(i)}]`;
      if (!isRecord(e)) {
        errors.push(`${at}: must be an object.`);
        return;
      }
      rejectUnknownKeys(
        e,
        new Set(['id', 'type', 'weight', 'fromRound', 'params']),
        at,
        errors,
      );
      const id = e['id'];
      if (typeof id !== 'string' || !EVENT_ID.test(id)) {
        errors.push(`${at}: "id" must match ${String(EVENT_ID)}.`);
      } else if (seenEvents.has(id)) {
        errors.push(`${at}: duplicate id "${id}".`);
      } else {
        seenEvents.add(id);
      }
      const type = e['type'];
      if (typeof type !== 'string' || !TYPE_ID.test(type)) {
        errors.push(`${at}: "type" must match ${String(TYPE_ID)}.`);
      }
      const weight = readInt(e, 'weight', 1, at, errors);
      const eventFrom =
        e['fromRound'] === undefined
          ? undefined
          : readInt(e, 'fromRound', 1, at, errors, MAX_EVENT_FROM_ROUND);
      const params: Record<string, number | string> = {};
      const rawParams = e['params'];
      if (rawParams !== undefined) {
        if (!isRecord(rawParams)) {
          errors.push(`${at}: "params" must be an object.`);
        } else {
          for (const k of sortedKeys(rawParams)) {
            const v = rawParams[k];
            if (
              typeof v === 'string' ||
              (typeof v === 'number' && Number.isInteger(v))
            ) {
              params[k] = v;
            } else {
              errors.push(
                `${at}.params: "${k}" must be an integer or a string.`,
              );
            }
          }
        }
      }
      if (
        typeof id === 'string' &&
        typeof type === 'string' &&
        weight !== undefined &&
        (e['fromRound'] === undefined || eventFrom !== undefined)
      ) {
        events.push(
          eventFrom === undefined
            ? { id, type, weight, params }
            : { id, type, weight, fromRound: eventFrom, params },
        );
      }
    });
  }

  const modifiers: ModifierDef[] = [];
  const seenMods = new Set<string>();
  const rawMods = data['modifiers'];
  if (!Array.isArray(rawMods)) {
    errors.push('events: "modifiers" must be a list.');
  } else {
    (rawMods as unknown[]).forEach((m, i) => {
      const at = `modifiers[${String(i)}]`;
      if (!isRecord(m)) {
        errors.push(`${at}: must be an object.`);
        return;
      }
      rejectUnknownKeys(
        m,
        new Set(['id', 'stackable', 'fromRound', 'effects']),
        at,
        errors,
      );
      const id = m['id'];
      if (typeof id !== 'string' || !MODIFIER_ID.test(id)) {
        errors.push(`${at}: "id" must match ${String(MODIFIER_ID)}.`);
      } else if (seenMods.has(id)) {
        errors.push(`${at}: duplicate id "${id}".`);
      } else {
        seenMods.add(id);
      }
      const stackable = readBool(m, 'stackable', at, errors);
      const fromRound =
        m['fromRound'] === undefined
          ? undefined
          : readInt(m, 'fromRound', 1, at, errors, MAX_MODIFIER_FROM_ROUND);
      const list = m['effects'];
      const effects: ModifierEffect[] = [];
      if (!Array.isArray(list) || list.length === 0) {
        errors.push(`${at}: "effects" must be a non-empty list.`);
      } else {
        (list as unknown[]).forEach((x, j) => {
          const effect = parseModifierEffect(
            x,
            `${at}.effects[${String(j)}]`,
            errors,
          );
          if (effect !== undefined) {
            effects.push(effect);
            if (effect.kind === 'unit_strength_percent') {
              const known = context.units;
              const listed = effect.units ?? [];
              if (known !== undefined) {
                let unknown = false;
                for (const u of listed) {
                  if (known.get(u) === undefined) {
                    unknown = true;
                    errors.push(
                      `${at}.effects[${String(j)}]: unknown unit "${u}".`,
                    );
                  }
                }
                const order = known.list().map((d) => d.id);
                const idx = listed.map((u) => order.indexOf(u));
                if (
                  !unknown &&
                  idx.some((x, k) => k > 0 && x < (idx[k - 1] ?? 0))
                ) {
                  errors.push(
                    `${at}.effects[${String(j)}]: "units" must follow the order of the units file.`,
                  );
                }
              }
            }
          }
        });
      }
      if (
        typeof id === 'string' &&
        stackable !== undefined &&
        (m['fromRound'] === undefined || fromRound !== undefined)
      ) {
        modifiers.push(
          fromRound === undefined
            ? { id, stackable, effects }
            : { id, stackable, fromRound, effects },
        );
      }
    });
  }

  if (errors.length > 0 || offerCount === undefined) {
    return { ok: false, errors };
  }
  return { ok: true, config: { offerCount, events, modifiers } };
}

/** Like loadEvents, but throws one Error listing every problem. */
export function loadEventsOrThrow(
  data: unknown,
  context: EventsLoadContext = {},
): EventsConfig {
  return unwrapOrThrow('events configuration', loadEvents(data, context));
}
