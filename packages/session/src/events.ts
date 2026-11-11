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
 * winner is the unanimous choice or, if the votes are split, one player's vote
 * picked at random (as for every other vote). A follow-up with `perPlayer:
 * true` (the Workshop) is not a party vote: every option carries the `player`
 * who may take it, each player chooses for themselves (or `skip`), and the
 * choices are applied together, in player order, once the last player has
 * chosen. Events never add a building to a stash.
 */
import {
  Rng,
  findModifier,
  heldModifierIds,
  pickWeightedIndex,
  raiseTier,
  withModifier,
  workshopOptions,
  type Content,
  type EventDef,
  type EventsConfig,
} from '@game/core';
import { tally, voteResolvedEffect } from './machine.js';
import {
  DEFAULT_WORKSHOP_PERCENT,
  currentWorkshopPrice,
  workshopOptionProblem,
} from './workshop-option.js';
import { streamLabels } from './streams.js';
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
  /**
   * True if every player chooses for themselves instead of the party voting
   * (the Workshop). Each option then has a numeric `player`, the only player
   * who may take it, and the id `skip` is always allowed. The handler needs
   * `chooseEach` (and may use `checkChoice`).
   */
  readonly perPlayer?: true;
  /**
   * Per-player follow-ups only: choices that are already made when the step
   * opens, one entry per player (an option id, or null for not yet chosen).
   * Used for a player who has nothing to choose but `skip`.
   */
  readonly initialVotes?: readonly (string | null)[];
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
   * True if `resolve` may return a follow-up. Wiring then requires `choose`
   * (or `chooseEach` for a per-player follow-up).
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
  /**
   * Per-player follow-ups: a reason `player` may not take `option` now, or
   * null. Called on every submission, before the choice is stored.
   */
  checkChoice?(
    ctx: EventContext,
    offer: EventOffer,
    player: number,
    option: Json,
  ): string | null;
  /**
   * Per-player follow-ups: apply every player's choice, in player order.
   * `picks[i]` is player i's chosen option, or null for `skip`.
   */
  chooseEach?(
    ctx: EventContext,
    offer: EventOffer,
    picks: readonly (Json | null)[],
  ): ChooseResult;
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
// Workshop: every player may raise one building they own by one tier (#50)

/** The id of the choice that takes no upgrade. */
export const SKIP_CHOICE = 'skip';

function workshopPercent(def: EventDef): number {
  return intParam(def, 'workshopPricePercent', 80);
}

function offerPercent(offer: EventOffer): number {
  const v = offer['workshopPricePercent'];
  return typeof v === 'number' ? v : DEFAULT_WORKSHOP_PERCENT;
}

/** True if some player owns a raisable building they can pay for. */
function anyAffordable(ctx: EventContext, percent: number): boolean {
  return ctx.state.players.some((_p, i) =>
    workshopOptions(
      ctx.state.team,
      i,
      ctx.state.perPlayer[i]?.gold ?? 0,
      ctx.content,
      percent,
    ).some((o) => o.affordable),
  );
}

export const workshopHandler: EventHandler = {
  type: 'workshop',
  canAskFollowUp: true,
  checkParams(def) {
    const p = def.params['workshopPricePercent'];
    return typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 100
      ? null
      : '"workshopPricePercent" must be an integer from 1 to 100';
  },
  available: (ctx, def) => anyAffordable(ctx, workshopPercent(def)),
  instantiate: (_ctx, def) => ({
    workshopPricePercent: workshopPercent(def),
  }),
  resolve(ctx, offer) {
    const { state, content } = ctx;
    const percent = offerPercent(offer);
    const options: Json[] = [];
    const initialVotes: (string | null)[] = [];
    let any = false;
    for (let player = 0; player < state.players.length; player++) {
      const mine = workshopOptions(
        state.team,
        player,
        state.perPlayer[player]?.gold ?? 0,
        content,
        percent,
      );
      const canAct = mine.some((o) => o.affordable);
      any = any || canAct;
      // A player with nothing they can pay for has only `skip`: already chosen.
      initialVotes.push(canAct ? null : SKIP_CHOICE);
      for (const o of mine) {
        options.push({
          id: `b${String(o.building)}`,
          player,
          building: o.building,
          def: o.def,
          tier: o.tier,
          newTier: o.newTier,
          price: o.price,
          placed: o.placed,
          affordable: o.affordable,
        });
      }
    }
    return {
      patch: {},
      // Nobody can act: no options, so the step is skipped.
      followUp: {
        prompt: 'workshop_building',
        options: any ? options : [],
        perPlayer: true,
        initialVotes,
      },
    };
  },
  checkChoice({ state, content }, offer, player, option) {
    // The structure is checked against the actual building; the stored price
    // and `affordable` are ignored. The price charged is computed now from
    // current content, against the player's gold at this moment.
    if (!isRecord(option) || option['player'] !== player) return 'not_owner';
    if (workshopOptionProblem(state.team, player, option) !== null) {
      return 'invalid_choice';
    }
    const price = currentWorkshopPrice(
      content,
      offerPercent(offer),
      option['def'] as string,
      option['tier'] as number,
    );
    if (price === null) return 'invalid_choice';
    const gold = state.perPlayer[player]?.gold ?? 0;
    return gold >= price ? null : 'not_enough_gold';
  },
  chooseEach({ state, content }, offer, picks) {
    let team = state.team;
    let perPlayer = state.perPlayer;
    for (let player = 0; player < picks.length; player++) {
      const pick = picks[player];
      if (pick === null || pick === undefined) continue;
      if (!isRecord(pick) || pick['player'] !== player) {
        return { ok: false, reason: 'not_owner' };
      }
      const me = perPlayer[player];
      if (me === undefined) return { ok: false, reason: 'invalid_choice' };
      // Checked against the team as it is now (earlier players' raises are
      // already applied); the stored price is ignored and the current one
      // charged.
      if (workshopOptionProblem(team, player, pick) !== null) {
        return { ok: false, reason: 'invalid_choice' };
      }
      const id = pick['building'] as number;
      const price = currentWorkshopPrice(
        content,
        offerPercent(offer),
        pick['def'] as string,
        pick['tier'] as number,
      );
      if (price === null) return { ok: false, reason: 'invalid_choice' };
      if (me.gold < price) return { ok: false, reason: 'not_enough_gold' };
      const r = raiseTier(team, { id });
      if (!r.ok) return { ok: false, reason: 'cannot_raise' };
      team = r.state;
      perPlayer = perPlayer.map((p, i) =>
        i === player ? { ...p, gold: p.gold - price } : p,
      );
    }
    return { ok: true, patch: { team, perPlayer } };
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
    if (
      h.canAskFollowUp === true &&
      h.choose === undefined &&
      h.chooseEach === undefined
    ) {
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
      // Weighted draws from the pool of available definitions: one
      // `pickWeightedIndex` draw per offer made, none wasted. After a pick,
      // every definition of the same type leaves the pool, so a type is never
      // offered twice even when the content holds several definitions of it
      // (issue #48); fewer than `offerCount` offers is deliberate when fewer
      // types are available. The instance data comes from a child stream of `rng`
      // (`<event id>:<offers so far>`), which does not advance `rng`.
      const offers: EventOffer[] = [];
      let pool = [...available];
      while (offers.length < config.offerCount && pool.length > 0) {
        const i = pickWeightedIndex(
          rng,
          pool.map((d) => d.weight),
        );
        const def = pool[i];
        if (def === undefined) break;
        pool = pool.filter((d) => d.type !== def.type);
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
      if (
        handler.canAskFollowUp !== true ||
        (handler.choose === undefined && handler.chooseEach === undefined)
      ) {
        throw new Error(
          `resolveEvent: handler "${offer.type}" returned a follow-up but does not declare canAskFollowUp with a choose function.`,
        );
      }
      if (r.followUp.perPlayer === true) {
        if (handler.chooseEach === undefined) {
          throw new Error(
            `resolveEvent: handler "${offer.type}" asked a per-player follow-up but has no chooseEach function.`,
          );
        }
        const initial = r.followUp.initialVotes;
        return {
          patch: r.patch,
          followUp: {
            prompt: r.followUp.prompt,
            perPlayer: true,
            options: r.followUp.options,
            votes: state.players.map((_p, i) => initial?.[i] ?? null),
          },
        };
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
 * A choice in a per-player follow-up (the Workshop). `skip` is always legal;
 * any other id must be an option of this player (`not_owner` for another
 * player's) that the handler accepts (`not_enough_gold`). The choice is
 * stored at once and can be changed until the last player has chosen; then
 * every choice is applied in player order. No vote is drawn.
 */
function choosePerPlayer(
  ctx: EventContext,
  handler: EventHandler | undefined,
  offer: EventOffer,
  player: number,
  choice: string,
): HandlerResult {
  const state = ctx.state;
  const pending = isRecord(state.pending) ? state.pending : {};
  const fu = pending['followUp'] as Record<string, Json>;
  const options = fu['options'] as readonly Json[];
  if (handler?.chooseEach === undefined) {
    return { ok: false, reason: 'invalid_intent', detail: 'no chooseEach' };
  }
  if (choice !== SKIP_CHOICE) {
    const option = options.find((o) => idOfOption(o) === choice);
    if (option === undefined) return { ok: false, reason: 'invalid_choice' };
    const problem = handler.checkChoice?.(ctx, offer, player, option) ?? null;
    if (problem !== null) return { ok: false, reason: problem };
  }
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
  const picks = votes.map((v): Json | null =>
    v === SKIP_CHOICE
      ? null
      : (options.find((o) => idOfOption(o) === v) ?? null),
  );
  const r = handler.chooseEach(ctx, offer, picks);
  if (!r.ok) return { ok: false, reason: r.reason };
  effects.push({
    type: 'custom',
    name: 'event_resolved',
    data: { offer: offer.id, type: offer.type, choices: votes },
  });
  return {
    ok: true,
    state: {
      ...state,
      team: r.patch.team ?? state.team,
      perPlayer: r.patch.perPlayer ?? state.perPlayer,
    },
    effects,
    advance: true,
  };
}

/**
 * The `event_choose` intent: `{ type: 'event_choose', choice: <option id> }`,
 * legal in `event_resolve`. Each player's vote counts at once and can be
 * changed until the last player has voted; then the winner (the unanimous
 * choice, or one player's vote picked at random) is applied by the offer's
 * handler and the step ends. With one player the first choice decides.
 * Rejections: `invalid_intent`, `invalid_choice`, and whatever the handler
 * reports. In a per-player follow-up (the Workshop) the choice is the player's
 * own: an option id or `skip` (see `choosePerPlayer`).
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
      if (fu['perPlayer'] === true) {
        return choosePerPlayer(
          { state, content, config },
          handlerFor(handlers, offer.type),
          offer,
          player,
          choice,
        );
      }
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
      const t = tally(
        withVote,
        votes,
        streamLabels.vote('event_follow_up', state.round, state.leg),
      );
      const winner = t.winner;
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
      effects.push(voteResolvedEffect('event', votes, t));
      effects.push({
        type: 'custom',
        name: 'event_resolved',
        data: { offer: offer.id, type: offer.type, choice: winner },
      });
      return {
        ok: true,
        state: {
          ...t.state,
          team: r.patch.team ?? t.state.team,
          perPlayer: r.patch.perPlayer ?? t.state.perPlayer,
        },
        effects,
        advance: true,
      };
    },
  };
  return { event_choose };
}
