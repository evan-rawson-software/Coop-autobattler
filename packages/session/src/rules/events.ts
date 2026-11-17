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
 * true` (the Workshop, the Drill) is not a party vote: every option carries the `player`
 * who may take it, each player chooses for themselves (or `skip`), and the
 * choices are applied together, in player order, once the last player has
 * chosen. Events never add a building to a stash.
 */
import {
  Rng,
  addNode,
  addableNodeCells,
  findModifier,
  MAX_SHOP_EFFECT_COUNT,
  heldModifierIds,
  offerWeightsAt,
  pickWeightedIndex,
  rareOfferDefs,
  raiseTier,
  withModifier,
  workshopOptions,
  type Content,
  type EconomyConfig,
  type EventDef,
  type EventsConfig,
  type MapgenConfig,
} from '@game/core';
import { tally, voteResolvedEffect } from './machine.js';
import {
  SKIP_CHOICE,
  eligibleModifiers,
  richVeinCell,
  richVeinChoice,
} from './event-shared.js';
import { caravanHandler, chooseDraft, isDraft } from './caravan.js';
import { addShopEffect, setHeldOffer } from './shop-effects.js';
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
  /**
   * The map rules (added-node cap and front margin). Absent when the hooks
   * were built without them: Rich vein is then never available.
   */
  readonly mapgen?: MapgenConfig;
  /**
   * The shop rules (offer weights). Absent when the hooks were built without
   * them: Blueprint is then never available.
   */
  readonly economy?: EconomyConfig;
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
  /**
   * A draft (the Caravan): the players choose one at a time in `order`, from
   * `items`. `options` is empty. The handler needs `drafts`.
   */
  readonly draft?: {
    readonly items: readonly Json[];
    readonly order: readonly number[];
  };
}

export type ChooseResult =
  | {
      readonly ok: true;
      readonly patch: StatePatch;
      /**
       * Per-player follow-ups: what was actually applied for each player, in
       * player order. Recorded in the `event_resolved` effect as `applied`.
       */
      readonly applied?: readonly Json[];
    }
  | { readonly ok: false; readonly reason: string };

export interface EventHandler {
  readonly type: string;
  /** A problem with an event definition's params, or null. Checked at wiring. */
  checkParams?(def: EventDef): string | null;
  /**
   * Can this event be offered now? (A Workshop needs a raisable building.)
   * Only asked for definitions whose `fromRound` has come (RS-4g).
   */
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
  /**
   * True if `resolve` may return a draft follow-up (the Caravan), in which
   * players choose in turn; `caravan.ts` applies the picks.
   */
  readonly drafts?: boolean;
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
   * Per-player follow-ups with a very large choice space (Rich vein): the
   * option a choice id names for `player`, when it is not one of the stored
   * options, or undefined. The result is then handed to `checkChoice`.
   */
  optionOf?(
    ctx: EventContext,
    offer: EventOffer,
    player: number,
    choice: string,
  ): Json | undefined;
  /**
   * Per-player follow-ups: apply every player's choice, in player order.
   * `picks[i]` is player i's chosen option, or null for `skip`. A stored
   * pick that no longer holds is applied as a skip, never rejected: only the
   * submitting player's own choice can cause a rejection (`checkChoice`).
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

export { SKIP_CHOICE, richVeinCell, richVeinChoice };

/** The follow-up prompt of the Drill (the Workshop's is `workshop_building`). */
export const DRILL_PROMPT = 'drill_building';

function workshopPercent(def: EventDef): number {
  return intParam(def, 'workshopPricePercent', 80);
}

function offerPercent(offer: EventOffer): number {
  const v = offer['workshopPricePercent'];
  return typeof v === 'number' ? v : DEFAULT_WORKSHOP_PERCENT;
}

/** What differs between the per-player "raise one building" events. */
interface UpgradeEventSpec {
  readonly type: string;
  /** The follow-up prompt code. */
  readonly prompt: string;
  /** The share of the shop price a raise costs, from the definition. */
  percentOfDef(def: EventDef): number;
  /** The same, from the stored offer. */
  percentOfOffer(offer: EventOffer): number;
  /** Which building definitions may be raised (all, or only collectors). */
  only(content: Content): ((def: string) => boolean) | undefined;
  checkParams?(def: EventDef): string | null;
  /** Extra data stored in the offer. */
  instantiate(def: EventDef): Readonly<Record<string, Json>>;
}

/**
 * A per-player follow-up in which each player may raise one of their own
 * buildings by one tier (Workshop, Drill). Options, validation and
 * application are shared; the spec gives the filter and the price.
 */
function upgradeHandler(spec: UpgradeEventSpec): EventHandler {
  const optionsOf = (
    ctx: EventContext,
    player: number,
    percent: number,
  ): ReturnType<typeof workshopOptions> =>
    workshopOptions(
      ctx.state.team,
      player,
      ctx.state.perPlayer[player]?.gold ?? 0,
      ctx.content,
      percent,
      spec.only(ctx.content),
    );
  return {
    type: spec.type,
    canAskFollowUp: true,
    ...(spec.checkParams === undefined
      ? {}
      : { checkParams: (def: EventDef) => spec.checkParams?.(def) ?? null }),
    // Some player owns a raisable building they can pay for.
    available: (ctx, def) =>
      ctx.state.players.some((_p, i) =>
        optionsOf(ctx, i, spec.percentOfDef(def)).some((o) => o.affordable),
      ),
    instantiate: (_ctx, def) => spec.instantiate(def),
    resolve(ctx, offer) {
      const { state } = ctx;
      const percent = spec.percentOfOffer(offer);
      const options: Json[] = [];
      const initialVotes: (string | null)[] = [];
      let any = false;
      for (let player = 0; player < state.players.length; player++) {
        const mine = optionsOf(ctx, player, percent);
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
          prompt: spec.prompt,
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
      if (
        workshopOptionProblem(
          state.team,
          player,
          option,
          spec.only(content),
        ) !== null
      ) {
        return 'invalid_choice';
      }
      const price = currentWorkshopPrice(
        content,
        spec.percentOfOffer(offer),
        option['def'] as string,
        option['tier'] as number,
      );
      if (price === null) return 'invalid_choice';
      const gold = state.perPlayer[player]?.gold ?? 0;
      return gold >= price ? null : 'not_enough_gold';
    },
    chooseEach({ state, content }, offer, picks) {
      // Every stored pick is re-checked against current content and the
      // player's current gold. One that no longer holds (cannot be paid, the
      // building is no longer eligible) is applied as a skip: no charge, no
      // upgrade. Nobody's submission is rejected for another player's pick.
      let team = state.team;
      let perPlayer = state.perPlayer;
      const applied: Json[] = [];
      for (let player = 0; player < picks.length; player++) {
        const pick = picks[player];
        if (pick === null || pick === undefined) {
          applied.push({ player, result: 'skip' });
          continue;
        }
        const dropped = (reason: string): Json => ({
          player,
          result: 'skip',
          dropped: true,
          reason,
        });
        const me = perPlayer[player];
        if (
          me === undefined ||
          !isRecord(pick) ||
          pick['player'] !== player ||
          workshopOptionProblem(team, player, pick, spec.only(content)) !== null
        ) {
          applied.push(dropped('invalid_choice'));
          continue;
        }
        const id = pick['building'] as number;
        const price = currentWorkshopPrice(
          content,
          spec.percentOfOffer(offer),
          pick['def'] as string,
          pick['tier'] as number,
        );
        if (price === null) {
          applied.push(dropped('invalid_choice'));
          continue;
        }
        if (me.gold < price) {
          applied.push(dropped('not_enough_gold'));
          continue;
        }
        const r = raiseTier(team, { id });
        if (!r.ok) {
          applied.push(dropped('cannot_raise'));
          continue;
        }
        team = r.state;
        perPlayer = perPlayer.map((p, i) =>
          i === player ? { ...p, gold: p.gold - price } : p,
        );
        applied.push({
          player,
          result: 'upgrade',
          building: id,
          def: pick['def'] as string,
          newTier: pick['newTier'] as number,
          price,
        });
      }
      return { ok: true, patch: { team, perPlayer }, applied };
    },
  };
}

export const workshopHandler: EventHandler = upgradeHandler({
  type: 'workshop',
  prompt: 'workshop_building',
  percentOfDef: workshopPercent,
  percentOfOffer: offerPercent,
  only: () => undefined,
  checkParams(def) {
    const p = def.params['workshopPricePercent'];
    return typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 100
      ? null
      : '"workshopPricePercent" must be an integer from 1 to 100';
  },
  instantiate: (def) => ({ workshopPricePercent: workshopPercent(def) }),
});

/** Drill (RS-4i2): the same follow-up, for collectors only, at price 0. */
export const drillHandler: EventHandler = upgradeHandler({
  type: 'drill',
  prompt: DRILL_PROMPT,
  percentOfDef: () => 0,
  percentOfOffer: () => 0,
  only: (content) => (def) => content.buildings.get(def)?.kind === 'source',
  instantiate: () => ({}),
});

// ---------------------------------------------------------------------------
// Shrine: take one of several run modifiers

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
    if (ctx.state.round < (def.fromRound ?? 1)) {
      return { ok: false, reason: 'not_unlocked' };
    }
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

// ---------------------------------------------------------------------------
// Market day: each player's next shop has extra offers and free re-rolls

function shopCountProblem(def: EventDef, key: string): string | null {
  const v = def.params[key];
  return typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 1 &&
    v <= MAX_SHOP_EFFECT_COUNT
    ? null
    : `"${key}" must be an integer from 1 to ${String(MAX_SHOP_EFFECT_COUNT)}`;
}

export const marketDayHandler: EventHandler = {
  type: 'market_day',
  checkParams: (def) =>
    shopCountProblem(def, 'extraOffers') ??
    shopCountProblem(def, 'freeRerolls'),
  available: () => true,
  instantiate: (_ctx, def) => ({
    extraOffers: intParam(def, 'extraOffers', 0),
    freeRerolls: intParam(def, 'freeRerolls', 0),
  }),
  resolve({ state }, offer) {
    const extra =
      typeof offer['extraOffers'] === 'number' ? offer['extraOffers'] : 0;
    const free =
      typeof offer['freeRerolls'] === 'number' ? offer['freeRerolls'] : 0;
    return {
      patch: {
        perPlayer: state.perPlayer.map((p) =>
          addShopEffect(
            addShopEffect(p, 'extra_offers', extra),
            'free_rerolls',
            free,
          ),
        ),
      },
      followUp: null,
    };
  },
};

// ---------------------------------------------------------------------------
// Pact (RS-4i6): a strong modifier with a drawback, taken without a follow-up

/** Pacts the party does not hold yet, in file order (each is held once). */
function freePacts(ctx: EventContext): string[] {
  const held = new Set(heldModifierIds(ctx.state.team));
  return ctx.config.modifiers
    .filter((m) => m.pact === true && !held.has(m.id))
    .map((m) => m.id);
}

export const pactHandler: EventHandler = {
  type: 'pact',
  // Some pact is not held.
  available: (ctx) => freePacts(ctx).length > 0,
  // One pact, drawn from the offer's child stream, named in the offer.
  instantiate(ctx, _def, rng) {
    const free = freePacts(ctx);
    return { pact: rng.pick(free) };
  },
  // Voting for the Pact takes it: the modifier is added like a Shrine's.
  resolve({ state, config }, offer) {
    const id = typeof offer['pact'] === 'string' ? offer['pact'] : '';
    const def = findModifier(config, id);
    if (
      def === undefined ||
      def.pact !== true ||
      heldModifierIds(state.team).includes(id)
    ) {
      return { patch: {}, followUp: null };
    }
    return {
      patch: {
        team: withModifier(state.team, { id: def.id, effects: def.effects }),
      },
      followUp: null,
    };
  },
};

// ---------------------------------------------------------------------------
// Rich vein (RS-4i4): every player may add a resource node to their own plot

/** The follow-up prompt of Rich vein. */
export const RICH_VEIN_PROMPT = 'rich_vein_cell';

function offerResource(offer: EventOffer): string {
  const r = offer['resource'];
  return typeof r === 'string' ? r : '';
}

export const richVeinHandler: EventHandler = {
  type: 'rich_vein',
  canAskFollowUp: true,
  checkParams: (def) =>
    def.resourceWeights === undefined ? '"resourceWeights" is required' : null,
  // Some player is under the cap and has a legal cell.
  available: (ctx) =>
    ctx.mapgen !== undefined &&
    ctx.state.players.some(
      (_p, i) =>
        ctx.mapgen !== undefined &&
        addableNodeCells(ctx.state.team, ctx.content, ctx.mapgen, i).length > 0,
    ),
  // One base resource, weighted, drawn from the offer's child stream.
  instantiate(ctx, def, rng) {
    const weights = def.resourceWeights ?? {};
    const ids = ctx.content.resources
      .listBase()
      .map((r) => r.id)
      .filter((id) => (weights[id] ?? 0) > 0);
    const i = pickWeightedIndex(
      rng,
      ids.map((id) => weights[id] ?? 0),
    );
    return { resource: ids[i] ?? '' };
  },
  resolve(ctx) {
    const { state, mapgen } = ctx;
    const options: Json[] = [];
    const initialVotes: (string | null)[] = [];
    for (let player = 0; player < state.players.length; player++) {
      const cells =
        mapgen === undefined
          ? []
          : addableNodeCells(state.team, ctx.content, mapgen, player);
      // A player with no legal cell has only `skip`: already chosen.
      initialVotes.push(cells.length > 0 ? null : SKIP_CHOICE);
      if (cells.length > 0) {
        options.push({
          id: `cells${String(player)}`,
          player,
          cells: cells.map((c): Json => [c.x, c.y]),
        });
      }
    }
    return {
      patch: {},
      followUp: {
        prompt: RICH_VEIN_PROMPT,
        options,
        perPlayer: true,
        initialVotes,
      },
    };
  },
  optionOf(_ctx, _offer, player, choice) {
    const cell = richVeinCell(choice);
    return cell === null ? undefined : { id: choice, player, ...cell };
  },
  checkChoice({ state, content, mapgen }, offer, player, option) {
    if (!isRecord(option) || option['player'] !== player) return 'not_owner';
    const x = option['x'];
    const y = option['y'];
    if (
      mapgen === undefined ||
      typeof x !== 'number' ||
      typeof y !== 'number'
    ) {
      return 'invalid_choice';
    }
    const r = addNode(state.team, content, mapgen, {
      owner: player,
      x,
      y,
      resource: offerResource(offer),
      round: state.round,
    });
    return r.ok ? null : r.reason;
  },
  chooseEach({ state, content, mapgen }, offer, picks) {
    // Each stored pick is re-checked against the team as it is now (after the
    // earlier players' nodes). One that is no longer legal is applied as a
    // skip, never rejected.
    let team = state.team;
    const applied: Json[] = [];
    for (let player = 0; player < picks.length; player++) {
      const pick = picks[player];
      if (pick === null || pick === undefined) {
        applied.push({ player, result: 'skip' });
        continue;
      }
      const x = isRecord(pick) ? pick['x'] : undefined;
      const y = isRecord(pick) ? pick['y'] : undefined;
      if (
        mapgen === undefined ||
        !isRecord(pick) ||
        pick['player'] !== player ||
        typeof x !== 'number' ||
        typeof y !== 'number'
      ) {
        applied.push({
          player,
          result: 'skip',
          dropped: true,
          reason: 'invalid_choice',
        });
        continue;
      }
      const resource = offerResource(offer);
      const r = addNode(team, content, mapgen, {
        owner: player,
        x,
        y,
        resource,
        round: state.round,
      });
      if (!r.ok) {
        applied.push({
          player,
          result: 'skip',
          dropped: true,
          reason: r.reason,
        });
        continue;
      }
      team = r.state;
      applied.push({ player, result: 'node', x, y, resource });
    }
    return { ok: true, patch: { team }, applied };
  },
};

// ---------------------------------------------------------------------------
// Blueprint (RS-4i5): each player picks a rare building held in their next shop

/** The follow-up prompt of Blueprint. */
export const BLUEPRINT_PROMPT = 'blueprint_building';

/** Most buildings one player may be offered (`choices`). */
export const MAX_BLUEPRINT_CHOICES = 10;

function blueprintParam(
  def: EventDef,
  key: string,
  max: number,
): string | null {
  const v = def.params[key];
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max
    ? null
    : `"${key}" must be an integer from 1 to ${String(max)}`;
}

/** The choice id of building `def` for `player`: `p<player>:<def>`. */
export function blueprintChoice(player: number, def: string): string {
  return `p${String(player)}:${def}`;
}

/** The buildings the offer holds for `player`, as stored (empty if none). */
function blueprintsOf(offer: EventOffer, player: number): string[] {
  const all: Json | undefined = offer['blueprints'];
  const mine = Array.isArray(all)
    ? (all[player] as Json | undefined)
    : undefined;
  return Array.isArray(mine)
    ? mine.filter((d): d is string => typeof d === 'string')
    : [];
}

export const blueprintHandler: EventHandler = {
  type: 'blueprint',
  canAskFollowUp: true,
  checkParams: (def) =>
    blueprintParam(def, 'choices', MAX_BLUEPRINT_CHOICES) ??
    blueprintParam(def, 'maxOfferWeight', 1000),
  // At least one rare building: one the shop can offer at this round (the
  // same `fromRound` gate the shop roll uses) with a weight at most
  // `maxOfferWeight`.
  available: (ctx, def) =>
    ctx.economy !== undefined &&
    rareOfferDefs(
      ctx.economy,
      ctx.state.round,
      intParam(def, 'maxOfferWeight', 0),
    ).length > 0,
  // Per player, up to `choices` distinct rare buildings drawn without
  // replacement, weighted by their offer weight, from `rng.child(player)`
  // (`rng` is the offer's child stream `<event id>:<index>`).
  instantiate(ctx, def, rng) {
    const economy = ctx.economy;
    if (economy === undefined) return { blueprints: [] };
    const weights = offerWeightsAt(economy, ctx.state.round);
    const pool = rareOfferDefs(
      economy,
      ctx.state.round,
      intParam(def, 'maxOfferWeight', 0),
    ).map((d) => ({
      def: d,
      weight: weights.find((w) => w.def === d)?.weight ?? 0,
    }));
    const n = Math.min(intParam(def, 'choices', 3), pool.length);
    const blueprints: Json[] = ctx.state.players.map((_p, player) => {
      const stream = rng.child(player);
      let left = pool;
      const picked: string[] = [];
      while (picked.length < n) {
        const i = pickWeightedIndex(
          stream,
          left.map((e) => e.weight),
        );
        const e = left[i];
        if (e === undefined) break;
        picked.push(e.def);
        left = left.filter((x) => x.def !== e.def);
      }
      return picked;
    });
    return { blueprints };
  },
  resolve(ctx, offer) {
    const { state } = ctx;
    const options: Json[] = [];
    const initialVotes: (string | null)[] = [];
    for (let player = 0; player < state.players.length; player++) {
      const mine = blueprintsOf(offer, player);
      // A player with nothing offered has only `skip`: already chosen.
      initialVotes.push(mine.length > 0 ? null : SKIP_CHOICE);
      for (const def of mine) {
        options.push({ id: blueprintChoice(player, def), player, def });
      }
    }
    return {
      patch: {},
      followUp: {
        prompt: BLUEPRINT_PROMPT,
        options,
        perPlayer: true,
        initialVotes,
      },
    };
  },
  checkChoice(_ctx, offer, player, option) {
    if (!isRecord(option) || option['player'] !== player) return 'not_owner';
    const def = option['def'];
    return typeof def === 'string' && blueprintsOf(offer, player).includes(def)
      ? null
      : 'invalid_choice';
  },
  chooseEach({ state, content }, offer, picks) {
    // Each pick must still name a building of that player's list and one the
    // shop can sell at tier 1; one that does not is applied as a skip.
    const applied: Json[] = [];
    const perPlayer = state.perPlayer.map((p, player): PlayerRunState => {
      const pick = picks[player];
      if (pick === null || pick === undefined) {
        applied.push({ player, result: 'skip' });
        return p;
      }
      const def = isRecord(pick) ? pick['def'] : undefined;
      if (
        !isRecord(pick) ||
        pick['player'] !== player ||
        typeof def !== 'string' ||
        !blueprintsOf(offer, player).includes(def) ||
        content.buildings.get(def) === undefined
      ) {
        applied.push({
          player,
          result: 'skip',
          dropped: true,
          reason: 'invalid_choice',
        });
        return p;
      }
      applied.push({ player, result: 'blueprint', def });
      return setHeldOffer(p, def);
    });
    return { ok: true, patch: { perPlayer }, applied };
  },
};

/** The event types shipped with the game. Add a type by adding a handler. */
export const defaultEventHandlers: EventHandlers = {
  workshop: workshopHandler,
  drill: drillHandler,
  shrine: shrineHandler,
  windfall: windfallHandler,
  market_day: marketDayHandler,
  pact: pactHandler,
  rich_vein: richVeinHandler,
  blueprint: blueprintHandler,
  caravan: caravanHandler,
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
      h.chooseEach === undefined &&
      h.drafts !== true
    ) {
      problems.push(
        `event "${def.id}": handler "${def.type}" can ask for a follow-up but has no "choose".`,
      );
    }
  }
  for (const def of config.events) {
    if (
      handlerFor(handlers, def.type)?.alwaysAvailable === true &&
      (def.fromRound ?? 1) > 1
    ) {
      problems.push(
        `event "${def.id}": an always-available event must not have a "fromRound" above 1.`,
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
  mapgen?: MapgenConfig,
  economy?: EconomyConfig,
): Pick<RunHooks, 'eventOffers' | 'resolveEvent'> {
  return {
    eventOffers(state, rng): readonly Json[] {
      const ctx: EventContext = {
        state,
        content,
        config,
        ...(mapgen === undefined ? {} : { mapgen }),
        ...(economy === undefined ? {} : { economy }),
      };
      // The pool: definitions whose first round has come (RS-4g) and whose
      // handler says available. Decided before the draw.
      const available = config.events.filter(
        (d) =>
          state.round >= (d.fromRound ?? 1) &&
          handlerFor(handlers, d.type)?.available(ctx, d) === true,
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
      const r = handler.resolve(
        {
          state,
          content,
          config,
          ...(mapgen === undefined ? {} : { mapgen }),
          ...(economy === undefined ? {} : { economy }),
        },
        offer,
      );
      if (r.followUp === null) return { patch: r.patch, followUp: null };
      if (r.followUp.draft !== undefined) {
        if (handler.canAskFollowUp !== true || handler.drafts !== true) {
          throw new Error(
            `resolveEvent: handler "${offer.type}" returned a draft but does not declare drafts.`,
          );
        }
        return {
          patch: r.patch,
          followUp: {
            prompt: r.followUp.prompt,
            mode: 'draft',
            items: [...r.followUp.draft.items],
            order: [...r.followUp.draft.order],
            taken: r.followUp.draft.order.map(() => null),
          },
        };
      }
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
 * every choice is applied in player order, each re-checked against current
 * content and that player's gold now (one that can no longer be paid is
 * applied as a skip and flagged in the effect's `applied`). Only the
 * submitting player's own choice is checked at submission. No vote is drawn.
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
    const option =
      options.find((o) => idOfOption(o) === choice) ??
      handler.optionOf?.(ctx, offer, player, choice);
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
  const picks = votes.map((v, i): Json | null =>
    v === SKIP_CHOICE || typeof v !== 'string'
      ? null
      : (options.find((o) => idOfOption(o) === v) ??
        handler.optionOf?.(ctx, offer, i, v) ??
        null),
  );
  const r = handler.chooseEach(ctx, offer, picks);
  if (!r.ok) return { ok: false, reason: r.reason };
  effects.push({
    type: 'custom',
    name: 'event_resolved',
    data: {
      offer: offer.id,
      type: offer.type,
      choices: votes,
      applied: r.applied ?? [],
    },
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
  mapgen?: MapgenConfig,
  economy?: EconomyConfig,
): Readonly<Record<string, IntentHandler>> {
  const withMap = (state: RunState): EventContext => ({
    state,
    content,
    config,
    ...(mapgen === undefined ? {} : { mapgen }),
    ...(economy === undefined ? {} : { economy }),
  });
  const event_choose: IntentHandler = {
    steps: ['event_resolve'],
    handle({ state, player, intent }): HandlerResult {
      const pending = isRecord(state.pending) ? state.pending : {};
      const offer = toOffer(pending['offer'] ?? null);
      const fu = pending['followUp'];
      if (
        offer === null ||
        !isRecord(fu) ||
        (!Array.isArray(fu['options']) && !isDraft(fu))
      ) {
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
      if (isDraft(fu)) {
        return chooseDraft(withMap(state), offer, player, choice);
      }
      const options = fu['options'] as readonly Json[];
      if (fu['perPlayer'] === true) {
        return choosePerPlayer(
          withMap(state),
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
      const r = handler.choose(withMap(state), offer, chosen);
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
