/**
 * Gold, shops and the stash wired into the run (W2-2).
 *
 * `createEconomyDeps` returns a `RunDeps` whose `startingKit` and
 * `onShopEnter` hooks and `buy` / `sell` / `reroll` handlers use the pure
 * rules in `core` (shop.ts) and the numbers in an `EconomyConfig`.
 *
 * Shop data stored in `perPlayer[i].shop` (plain JSON):
 *   { offers: (Offer | null)[], stream: [u32, u32, u32, u32] }
 * `offers[slot]` is null once bought. `stream` is the saved state of that
 * player's shop RNG stream, so a re-roll takes the next draws of the same
 * stream and replaying never changes anything.
 *
 * RNG: entering a shop gives the hook the child stream `shop:r<r>:<leg>`
 * (see streams.ts). Each player's stream is `rng.child('p<i>')` of that.
 */
import {
  Rng,
  addToStash,
  buyOffer,
  rerollOffers,
  rollOffers,
  sellFromStash,
  type Content,
  type EconomyConfig,
  type MapgenConfig,
  type PlayerShop,
  type ShopOffer,
} from '@game/core';
import { createDeps } from './defaults.js';
import type {
  BattleResolver,
  Effect,
  HandlerContext,
  HandlerResult,
  IntentHandler,
  Json,
  PlayerRunState,
  RunDeps,
  RunHooks,
  RunRules,
  RunState,
  StatePatch,
} from './types.js';

/** What `perPlayer[i].shop` holds once a shop has been entered. */
export interface ShopData {
  readonly offers: readonly (ShopOffer | null)[];
  readonly stream: readonly [number, number, number, number];
}

/** The label of player `p`'s stream below the `shop:r<r>:<leg>` stream. */
export function playerShopLabel(player: number): string {
  return `p${String(player)}`;
}

/** Read a player's shop data; null if they have none (not entered a shop). */
export function readShop(p: PlayerRunState): ShopData | null {
  const s = p.shop;
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return null;
  const rec = s as Record<string, Json>;
  const offers = rec['offers'];
  const stream = rec['stream'];
  if (!Array.isArray(offers) || !Array.isArray(stream)) return null;
  return s as unknown as ShopData;
}

function withShop(
  p: PlayerRunState,
  gold: number,
  data: ShopData,
): PlayerRunState {
  return { ...p, gold, shop: data as unknown as Json };
}

/** `startingKit` and `onShopEnter` for the given economy. */
export function economyHooks(
  content: Content,
  economy: EconomyConfig,
): Pick<RunHooks, 'startingKit' | 'onShopEnter'> {
  return {
    startingKit(state: RunState, rng: Rng): StatePatch {
      let team = state.team;
      for (let owner = 0; owner < state.players.length; owner++) {
        for (const entry of economy.startingKit) {
          for (let n = 0; n < entry.count; n++) {
            // A `pick` entry draws each copy from the "kit" stream
            // (`nextInt(pick.length)`), in player, entry, copy order.
            const def =
              entry.pick === undefined
                ? entry.def
                : entry.pick[rng.nextInt(entry.pick.length)];
            if (def === undefined) {
              throw new Error('starting kit: an entry has no building.');
            }
            const r = addToStash(team, content, {
              def,
              tier: entry.tier,
              owner,
            });
            if (!r.ok) {
              throw new Error(
                `starting kit: cannot add "${def}" tier ${String(entry.tier)}: ${r.reason}`,
              );
            }
            team = r.state;
          }
        }
      }
      return {
        team,
        perPlayer: state.perPlayer.map((p) => ({
          ...p,
          gold: economy.startingGold,
        })),
      };
    },

    onShopEnter(state: RunState, rng: Rng): StatePatch {
      return {
        perPlayer: state.perPlayer.map((p, i) => {
          const stream = rng.child(playerShopLabel(i));
          const offers = rollOffers(stream, state.round, content, economy);
          return withShop(p, p.gold + economy.baseIncomePerShop, {
            offers,
            stream: stream.getState(),
          });
        }),
      };
    },
  };
}

function slotOf(intent: HandlerContext['intent']): number | null {
  const v = intent['slot'];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function idOfIntent(intent: HandlerContext['intent']): number | null {
  const v = intent['id'];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function bad(reason: string, detail?: string): HandlerResult {
  return detail === undefined
    ? { ok: false, reason }
    : { ok: false, reason, detail };
}

function replacePlayer(
  state: RunState,
  player: number,
  next: PlayerRunState,
): RunState {
  return {
    ...state,
    perPlayer: state.perPlayer.map((p, i) => (i === player ? next : p)),
  };
}

function custom(name: string, data: Json): Effect {
  return { type: 'custom', name, data };
}

/**
 * The `buy`, `sell` and `reroll` handlers. `buy` and `reroll` are legal only
 * in `shop` (in the first `build` they are rejected with `wrong_step`, as
 * there are no offers yet). `sell` is legal in `shop` and `build`.
 * Rejections: `not_enough_gold`, `no_such_offer`, `not_in_stash`,
 * `not_owner`, `invalid_intent`.
 */
export function economyHandlers(
  content: Content,
  economy: EconomyConfig,
): Readonly<Record<string, IntentHandler>> {
  const buy: IntentHandler = {
    steps: ['shop'],
    handle({ state, player, intent }) {
      const slot = slotOf(intent);
      if (slot === null)
        return bad('invalid_intent', 'slot must be an integer');
      const me = state.perPlayer[player] as PlayerRunState;
      const data = readShop(me);
      if (data === null) return bad('no_such_offer');
      const r = buyOffer(
        { gold: me.gold, offers: data.offers },
        state.team,
        content,
        { slot, owner: player },
      );
      if (!r.ok) return bad(r.reason, r.detail);
      const next = replacePlayer(
        { ...state, team: r.team },
        player,
        withShop(me, r.shop.gold, { ...data, offers: r.shop.offers }),
      );
      const offer = data.offers[slot] as ShopOffer;
      return {
        ok: true,
        state: next,
        effects: [
          custom('bought', {
            player,
            slot,
            def: offer.def,
            tier: offer.tier,
            price: offer.price,
          }),
        ],
      };
    },
  };

  const sell: IntentHandler = {
    steps: ['build', 'shop'],
    handle({ state, player, intent }) {
      const id = idOfIntent(intent);
      if (id === null) return bad('invalid_intent', 'id must be an integer');
      const me = state.perPlayer[player] as PlayerRunState;
      const data = readShop(me);
      const shop: PlayerShop = { gold: me.gold, offers: data?.offers ?? [] };
      const r = sellFromStash(shop, state.team, content, economy, {
        id,
        owner: player,
      });
      if (!r.ok) return bad(r.reason, r.detail);
      const entry = state.team.stash.find((s) => s.id === id);
      const refund = r.shop.gold - me.gold;
      const updated: PlayerRunState =
        data === null
          ? { ...me, gold: r.shop.gold }
          : withShop(me, r.shop.gold, data);
      return {
        ok: true,
        state: replacePlayer({ ...state, team: r.team }, player, updated),
        effects: [
          custom('sold', {
            player,
            id,
            def: entry === undefined ? null : entry.def,
            refund,
          }),
        ],
      };
    },
  };

  const reroll: IntentHandler = {
    steps: ['shop'],
    handle({ state, player }) {
      const me = state.perPlayer[player] as PlayerRunState;
      const data = readShop(me);
      if (data === null) return bad('no_such_offer');
      const stream = Rng.fromState(data.stream);
      const r = rerollOffers(
        { gold: me.gold, offers: data.offers },
        stream,
        state.round,
        content,
        economy,
      );
      if (!r.ok) return bad(r.reason, r.detail);
      return {
        ok: true,
        state: replacePlayer(
          state,
          player,
          withShop(me, r.shop.gold, {
            offers: r.shop.offers,
            stream: stream.getState(),
          }),
        ),
        effects: [custom('rerolled', { player, cost: economy.rerollCost })],
      };
    },
  };

  return { buy, sell, reroll };
}

/**
 * A fully wired `RunDeps`: the economy hooks and handlers on top of
 * `createDeps`. Other hooks keep their stubs unless overridden.
 */
export function createEconomyDeps(
  content: Content,
  mapgenConfig: MapgenConfig,
  economy: EconomyConfig,
  overrides: {
    readonly rules?: RunRules;
    readonly battle?: BattleResolver;
    readonly hooks?: Partial<RunHooks>;
    readonly handlers?: Readonly<Record<string, IntentHandler>>;
  } = {},
): RunDeps {
  return createDeps(content, mapgenConfig, {
    ...overrides,
    hooks: { ...economyHooks(content, economy), ...overrides.hooks },
    handlers: { ...economyHandlers(content, economy), ...overrides.handlers },
  });
}
