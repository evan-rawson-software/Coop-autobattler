/**
 * The event step (W2-3, RS-4): offers, the follow-up vote, and the handlers
 * of the event types.
 *
 * Data and code are split so that more types need no change to the state
 * machine: `content/events.json` lists event definitions (`type`, `weight`,
 * `params`) and run modifiers; an `EventHandler` per `type` says whether the
 * event can be offered, what extra data an offer carries, what happens when
 * the party picks it, and (optionally) how a follow-up choice is applied.
 * Adding a type is one handler in `defaultEventHandlers` (or the map passed to
 * `createGameDeps`) plus data rows.
 *
 * Offers are plain JSON in `pending.options`:
 *   { id, event, type, ...data }
 * and are drawn (with all their data, such as the modifiers a Shrine would
 * offer) when the event step opens, so they are stored before they are shown
 * and never change on reload. A follow-up lives in `pending.followUp`:
 *   { prompt, options: [{ id, ... }], votes: (string | null)[] }
 * The party votes with `{ type: 'event_choose', choice: <option id> }`; the
 * most votes wins, a tie goes to the host's vote (as for every other vote).
 * Events never add a building to a stash.
 */
import {
  Rng,
  findModifier,
  heldModifierIds,
  pickWeightedIndex,
  raiseTier,
  withModifier,
  type Content,
  type EventDef,
  type EventsConfig,
  type TeamState,
} from '@game/core';
import { tally } from './machine.js';
import type {
  Effect,
  HandlerResult,
  IntentHandler,
  Json,
  PlayerRunState,
  RunHooks,
  RunState,
  StatePatch,
} from './types.js';

// ---------------------------------------------------------------------------
// Types

export interface EventOffer {
  /** Unique among the offers of one event step; the vote choice. */
  readonly id: string;
  /** The `EventDef` this is an instance of. */
  readonly event: string;
  /** The handler key. */
  readonly type: string;
  readonly [data: string]: Json | undefined;
}

export interface EventContext {
  readonly state: RunState;
  readonly content: Content;
  readonly config: EventsConfig;
}

/** A choice the party still has to make after picking an event. */
export interface FollowUpSpec {
  /** What is being chosen, as a code for the presentation layer. */
  readonly prompt: string;
  /** Each has a string `id`. */
  readonly options: readonly Json[];
}

export type ChooseResult =
  | { readonly ok: true; readonly patch: StatePatch }
  | { readonly ok: false; readonly reason: string };

export interface EventHandler {
  readonly type: string;
  /** A problem with an event definition's params, or null. Checked at wiring. */
  checkParams?(def: EventDef): string | null;
  /** Can this event be offered now? (A Workshop needs a raisable building.) */
  available(ctx: EventContext, def: EventDef): boolean;
  /**
   * True if `available` is true in every state (a Windfall). Wiring requires
   * at least one event definition with such a handler, so an event step
   * always has at least one offer.
   */
  readonly alwaysAvailable?: boolean;
  /**
   * True if `resolve` may return a follow-up. Wiring then requires `choose`.
   * (`resolve` returning a follow-up without this flag is an error.)
   */
  readonly canAskFollowUp?: boolean;
  /** Extra data stored in the offer, drawn from `rng` (a child stream). */
  instantiate(
    ctx: EventContext,
    def: EventDef,
    rng: Rng,
  ): Readonly<Record<string, Json>>;
  /** The party picked this offer: apply it, or ask for a follow-up choice. */
  resolve(
    ctx: EventContext,
    offer: EventOffer,
  ): { readonly patch: StatePatch; readonly followUp: FollowUpSpec | null };
  /** Apply the follow-up option the party chose. */
  choose?(ctx: EventContext, offer: EventOffer, option: Json): ChooseResult;
}

export type EventHandlers = Readonly<Record<string, EventHandler>>;

// ---------------------------------------------------------------------------
// Helpers

function isRecord(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function handlerFor(
  handlers: EventHandlers,
  type: string,
): EventHandler | undefined {
  return Object.hasOwn(handlers, type) ? handlers[type] : undefined;
}

function intParam(def: EventDef, key: string, fallback: number): number {
  const v = def.params[key];
  return typeof v === 'number' ? v : fallback;
}

function toOffer(v: Json): EventOffer | null {
  if (
    !isRecord(v) ||
    typeof v['id'] !== 'string' ||
    typeof v['event'] !== 'string' ||
    typeof v['type'] !== 'string'
  ) {
    return null;
  }
  return v as unknown as EventOffer;
}

// ---------------------------------------------------------------------------
// Workshop: raise one owned building by one tier

interface Raisable {
  readonly id: number;
  readonly def: string;
  readonly tier: number;
  readonly owner: number;
  readonly placed: boolean;
}

function raisable(team: TeamState): Raisable[] {
  const out: Raisable[] = [];
  for (const b of team.buildings) {
    if (b.tier < 3) {
      out.push({
        id: b.id,
        def: b.def,
        tier: b.tier,
        owner: b.owner,
        placed: true,
      });
    }
  }
  for (const b of team.stash) {
    if (b.tier < 3) {
      out.push({
        id: b.id,
        def: b.def,
        tier: b.tier,
        owner: b.owner,
        placed: false,
      });
    }
  }
  return out.sort((a, b) => a.id - b.id);
}

export const workshopHandler: EventHandler = {
  type: 'workshop',
  canAskFollowUp: true,
  checkParams(def) {
    const t = def.params['tiers'];
    return t === undefined || (typeof t === 'number' && t >= 1 && t <= 2)
      ? null
      : '"tiers" must be 1 or 2';
  },
  available: ({ state }) => raisable(state.team).length > 0,
  instantiate: (_ctx, def) => ({ tiers: intParam(def, 'tiers', 1) }),
  resolve({ state }) {
    return {
      patch: {},
      followUp: {
        prompt: 'workshop_building',
        options: raisable(state.team).map((b): Json => ({
          id: `b${String(b.id)}`,
          building: b.id,
          def: b.def,
          tier: b.tier,
          owner: b.owner,
          placed: b.placed,
        })),
      },
    };
  },
  choose({ state }, offer, option) {
    const id = isRecord(option) ? option['building'] : undefined;
    if (typeof id !== 'number') return { ok: false, reason: 'invalid_choice' };
    const tiers = typeof offer['tiers'] === 'number' ? offer['tiers'] : 1;
    let team = state.team;
    let raised = 0;
    for (let i = 0; i < tiers; i++) {
      const r = raiseTier(team, { id });
      if (!r.ok) break;
      team = r.state;
      raised += 1;
    }
    return raised === 0
      ? { ok: false, reason: 'cannot_raise' }
      : { ok: true, patch: { team } };
  },
};

// ---------------------------------------------------------------------------
// Shrine: take one of several run modifiers

/** Modifier IDs the party could take now, in file order. */
function eligibleModifiers(ctx: EventContext): string[] {
  const held = new Set(heldModifierIds(ctx.state.team));
  return ctx.config.modifiers
    .filter((m) => m.stackable || !held.has(m.id))
    .map((m) => m.id);
}

export const shrineHandler: EventHandler = {
  type: 'shrine',
  canAskFollowUp: true,
  checkParams(def) {
    const c = def.params['choices'];
    return c === undefined || (typeof c === 'number' && c >= 1)
      ? null
      : '"choices" must be a positive integer';
  },
  available: (ctx) => eligibleModifiers(ctx).length > 0,
  instantiate(ctx, def, rng) {
    const eligible = eligibleModifiers(ctx);
    const n = Math.min(intParam(def, 'choices', 3), eligible.length);
    const picked = new Set(rng.shuffle(eligible).slice(0, n));
    // Canonical order (file order) so equal sets compare equal.
    return { modifiers: eligible.filter((id) => picked.has(id)) };
  },
  resolve(_ctx, offer) {
    const ids = Array.isArray(offer['modifiers']) ? offer['modifiers'] : [];
    return {
      patch: {},
      followUp: {
        prompt: 'shrine_modifier',
        options: ids.map((id): Json => ({ id: String(id) })),
      },
    };
  },
  choose(ctx, _offer, option) {
    const id = isRecord(option) ? option['id'] : undefined;
    const def =
      typeof id === 'string' ? findModifier(ctx.config, id) : undefined;
    if (def === undefined) return { ok: false, reason: 'invalid_choice' };
    if (!def.stackable && heldModifierIds(ctx.state.team).includes(def.id)) {
      return { ok: false, reason: 'already_held' };
    }
    return {
      ok: true,
      patch: {
        team: withModifier(ctx.state.team, {
          id: def.id,
          effects: def.effects,
        }),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Windfall: a fixed amount of gold to each player (no follow-up)

export const windfallHandler: EventHandler = {
  type: 'windfall',
  checkParams(def) {
    const g = def.params['gold'];
    return typeof g === 'number' && g >= 1
      ? null
      : '"gold" must be a positive integer';
  },
  available: () => true,
  alwaysAvailable: true,
  instantiate: (_ctx, def) => ({ gold: intParam(def, 'gold', 0) }),
  resolve({ state }, offer) {
    const gold = typeof offer['gold'] === 'number' ? offer['gold'] : 0;
    return {
      patch: {
        perPlayer: state.perPlayer.map((p): PlayerRunState => ({
          ...p,
          gold: p.gold + gold,
        })),
      },
      followUp: null,
    };
  },
};

/** The event types shipped with the game. Add a type by adding a handler. */
export const defaultEventHandlers: EventHandlers = {
  workshop: workshopHandler,
  shrine: shrineHandler,
  windfall: windfallHandler,
};

// ---------------------------------------------------------------------------
// Wiring

/**
 * Check the events configuration against the handlers. Returns the problems
 * (an event whose type has no handler, bad params); empty means usable.
 */
export function checkEventHandlers(
  config: EventsConfig,
  handlers: EventHandlers,
): string[] {
  const problems: string[] = [];
  for (const def of config.events) {
    const h = handlerFor(handlers, def.type);
    if (h === undefined) {
      problems.push(`event "${def.id}": no handler for type "${def.type}".`);
      continue;
    }
    const p = h.checkParams?.(def) ?? null;
    if (p !== null) problems.push(`event "${def.id}": ${p}.`);
    if (h.canAskFollowUp === true && h.choose === undefined) {
      problems.push(
        `event "${def.id}": handler "${def.type}" can ask for a follow-up but has no "choose".`,
      );
    }
  }
  const sure = config.events.some(
    (d) => handlerFor(handlers, d.type)?.alwaysAvailable === true,
  );
  if (!sure) {
    problems.push(
      'events: at least one event definition needs a handler that is always available (such as a windfall), so every event step has an offer.',
    );
  }
  return problems;
}

/** The `eventOffers` and `resolveEvent` hooks. */
export function eventHooks(
  content: Content,
  config: EventsConfig,
  handlers: EventHandlers = defaultEventHandlers,
): Pick<RunHooks, 'eventOffers' | 'resolveEvent'> {
  return {
    eventOffers(state, rng): readonly Json[] {
      const ctx: EventContext = { state, content, config };
      const available = config.events.filter(
        (d) => handlerFor(handlers, d.type)?.available(ctx, d) === true,
      );
      // Distinct event definitions, weighted, without replacement: one
      // `pickWeightedIndex` draw per offer made (min(offerCount, available)
      // draws, none wasted). A type is never offered twice (issue #48), so
      // fewer than `offerCount` offers is deliberate when fewer types are
      // available. The instance data comes from a child stream of `rng`
      // (`<event id>:<offers so far>`), which does not advance `rng`.
      const offers: EventOffer[] = [];
      const pool = [...available];
      while (offers.length < config.offerCount && pool.length > 0) {
        const i = pickWeightedIndex(
          rng,
          pool.map((d) => d.weight),
        );
        const [def] = pool.splice(i, 1);
        if (def === undefined) continue;
        const handler = handlerFor(handlers, def.type) as EventHandler;
        const data = handler.instantiate(
          ctx,
          def,
          rng.child(`${def.id}:${String(offers.length)}`),
        );
        offers.push({ id: def.id, event: def.id, type: def.type, ...data });
      }
      if (offers.length === 0) {
        throw new Error('eventOffers: no event could be offered.');
      }
      return offers as unknown as readonly Json[];
    },

    resolveEvent(state, offerJson) {
      const offer = toOffer(offerJson);
      const handler =
        offer === null ? undefined : handlerFor(handlers, offer.type);
      if (offer === null || handler === undefined) {
        throw new Error('resolveEvent: the offer has no handler.');
      }
      const r = handler.resolve({ state, content, config }, offer);
      if (r.followUp === null) return { patch: r.patch, followUp: null };
      if (handler.canAskFollowUp !== true || handler.choose === undefined) {
        throw new Error(
          `resolveEvent: handler "${offer.type}" returned a follow-up but does not declare canAskFollowUp with a choose function.`,
        );
      }
      return {
        patch: r.patch,
        followUp: {
          prompt: r.followUp.prompt,
          options: r.followUp.options,
          votes: state.players.map(() => null),
        },
      };
    },
  };
}

function idOfOption(o: Json): string | null {
  return isRecord(o) && typeof o['id'] === 'string' ? o['id'] : null;
}

/**
 * The `event_choose` intent: `{ type: 'event_choose', choice: <option id> }`,
 * legal in `event_resolve`. Each player's vote counts at once and can be
 * changed until the last player has voted; then the winner (most votes, ties
 * to the host) is applied by the offer's handler and the step ends. With one
 * player the first choice decides. Rejections: `invalid_intent`,
 * `invalid_choice`, and whatever the handler reports.
 */
export function eventChooseHandlers(
  content: Content,
  config: EventsConfig,
  handlers: EventHandlers = defaultEventHandlers,
): Readonly<Record<string, IntentHandler>> {
  const event_choose: IntentHandler = {
    steps: ['event_resolve'],
    handle({ state, player, intent }): HandlerResult {
      const pending = isRecord(state.pending) ? state.pending : {};
      const offer = toOffer(pending['offer'] ?? null);
      const fu = pending['followUp'];
      if (offer === null || !isRecord(fu) || !Array.isArray(fu['options'])) {
        return { ok: false, reason: 'invalid_intent', detail: 'no follow-up' };
      }
      const choice = intent['choice'];
      if (typeof choice !== 'string') {
        return {
          ok: false,
          reason: 'invalid_intent',
          detail: 'choice must be an id',
        };
      }
      const options = fu['options'] as readonly Json[];
      const option = options.find((o) => idOfOption(o) === choice);
      if (option === undefined) return { ok: false, reason: 'invalid_choice' };
      const votes = (fu['votes'] as readonly (Json | null)[]).map((v, i) =>
        i === player ? choice : v,
      );
      const withVote: RunState = {
        ...state,
        pending: { ...pending, followUp: { ...fu, votes } },
      };
      const effects: Effect[] = [{ type: 'vote_changed', player }];
      if (votes.some((v) => v === null)) {
        return { ok: true, state: withVote, effects };
      }
      const winner = tally(votes, state.host);
      const chosen = options.find((o) => idOfOption(o) === winner) as Json;
      const handler = handlerFor(handlers, offer.type);
      if (handler?.choose === undefined) {
        return {
          ok: false,
          reason: 'invalid_intent',
          detail: 'no choose handler',
        };
      }
      const r = handler.choose({ state, content, config }, offer, chosen);
      if (!r.ok) return { ok: false, reason: r.reason };
      effects.push({
        type: 'vote_resolved',
        topic: 'event',
        choice: winner,
      });
      effects.push({
        type: 'custom',
        name: 'event_resolved',
        data: { offer: offer.id, type: offer.type, choice: winner },
      });
      return {
        ok: true,
        state: {
          ...withVote,
          team: r.patch.team ?? withVote.team,
          perPlayer: r.patch.perPlayer ?? withVote.perPlayer,
        },
        effects,
        advance: true,
      };
    },
  };
  return { event_choose };
}
