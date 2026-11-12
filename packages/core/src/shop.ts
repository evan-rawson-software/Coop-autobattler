/**
 * Pure shop rules (W2-2): rolling offers, buying, selling and re-rolling.
 * The algorithm and draw order are in docs/rules-reference.md ("Shops and
 * gold"). Everything here works on plain data and never mutates its input.
 */

import type { BuildingConfig, BuildingId } from './buildings.js';
import type { EconomyConfig, TierOddsRow } from './economy.js';
import { mulPct } from './int.js';
import type { Rng } from './rng.js';
import { addToStash, removeFromStash, type TeamState } from './team-state.js';
import { pickWeightedIndex } from './weighted.js';

/** One item for sale. `price` is the building tier's price in gold. */
export interface ShopOffer {
  readonly slot: number;
  readonly def: BuildingId;
  readonly tier: number;
  readonly price: number;
}

/**
 * One player's gold and offers. `offers[i]` is the offer in slot `i`, or
 * null once it was bought (it stays empty until the next roll).
 */
export interface PlayerShop {
  readonly gold: number;
  readonly offers: readonly (ShopOffer | null)[];
}

export interface ShopContent {
  readonly buildings: BuildingConfig;
}

export type ShopReason =
  'not_enough_gold' | 'no_such_offer' | 'not_in_stash' | 'not_owner';

export type ShopFailure = {
  readonly ok: false;
  readonly reason: ShopReason;
  readonly detail?: string;
};

export type ShopResult =
  | {
      readonly ok: true;
      readonly shop: PlayerShop;
      readonly team: TeamState;
    }
  | ShopFailure;

/** The tier-odds row for a round: the largest `fromRound` not above it. */
export function tierOddsFor(
  round: number,
  tierOdds: readonly TierOddsRow[],
): TierOddsRow {
  let row = tierOdds[0];
  for (const candidate of tierOdds) {
    if (candidate.fromRound <= round) row = candidate;
  }
  if (row === undefined) throw new RangeError('tierOdds must not be empty');
  return row;
}

/** The price of one tier of a building; throws on an unknown building/tier. */
export function tierPrice(
  content: ShopContent,
  def: BuildingId,
  tier: number,
): number {
  const b = content.buildings.get(def);
  const t = b === undefined ? undefined : b.tiers[tier - 1];
  if (t === undefined || !('price' in t)) {
    throw new RangeError(`no purchasable tier ${String(tier)} of "${def}"`);
  }
  return (t as { readonly price: number }).price;
}

/**
 * Roll a full set of offers. For slot 0 up to `shopOfferCount - 1`, in this
 * order: one draw picks the building by `offerWeights` (one `nextInt(sum of
 * weights)`), then one draw picks the tier by the applicable `tierOdds` row
 * (one `nextInt(sum of its weights)`). Duplicates across slots are allowed.
 */
export function rollOffers(
  rng: Rng,
  round: number,
  content: ShopContent,
  economy: EconomyConfig,
): ShopOffer[] {
  const buildingWeights = economy.offerWeights.map((w) => w.weight);
  const tierWeights = tierOddsFor(round, economy.tierOdds).weights;
  const offers: ShopOffer[] = [];
  for (let slot = 0; slot < economy.shopOfferCount; slot++) {
    const entry = economy.offerWeights[pickWeightedIndex(rng, buildingWeights)];
    const tier = pickWeightedIndex(rng, tierWeights) + 1;
    if (entry === undefined) throw new RangeError('offerWeights is empty');
    offers.push({
      slot,
      def: entry.def,
      tier,
      price: tierPrice(content, entry.def, tier),
    });
  }
  return offers;
}

/**
 * Buy the offer in `slot` for player `owner`. The building goes to that
 * player's stash as a new separate entry (buildings never merge). The slot
 * becomes empty.
 */
export function buyOffer(
  shop: PlayerShop,
  team: TeamState,
  content: ShopContent,
  args: { slot: number; owner: number },
): ShopResult {
  const offer = Number.isInteger(args.slot) ? shop.offers[args.slot] : null;
  if (offer === undefined || offer === null) {
    return { ok: false, reason: 'no_such_offer' };
  }
  if (shop.gold < offer.price) return { ok: false, reason: 'not_enough_gold' };
  const added = addToStash(team, content, {
    def: offer.def,
    tier: offer.tier,
    owner: args.owner,
  });
  if (!added.ok) {
    return { ok: false, reason: 'no_such_offer', detail: added.reason };
  }
  return {
    ok: true,
    team: added.state,
    shop: {
      gold: shop.gold - offer.price,
      offers: shop.offers.map((o, i) => (i === args.slot ? null : o)),
    },
  };
}

/** Gold returned for selling one tier of a building. */
export function sellValue(
  content: ShopContent,
  economy: Pick<EconomyConfig, 'sellRefundPercent'>,
  def: BuildingId,
  tier: number,
): number {
  return mulPct(tierPrice(content, def, tier), economy.sellRefundPercent);
}

/**
 * Sell a stash entry of player `owner`. Only stash entries can be sold (not
 * placed buildings), and only your own. Refunds `sellRefundPercent` percent
 * of the tier's price, rounded down.
 */
export function sellFromStash(
  shop: PlayerShop,
  team: TeamState,
  content: ShopContent,
  economy: Pick<EconomyConfig, 'sellRefundPercent'>,
  args: { id: number; owner: number },
): ShopResult {
  const entry = team.stash.find((s) => s.id === args.id);
  if (entry === undefined) return { ok: false, reason: 'not_in_stash' };
  if (entry.owner !== args.owner) return { ok: false, reason: 'not_owner' };
  const removed = removeFromStash(team, {
    actor: args.owner,
    id: args.id,
  });
  if (!removed.ok) return { ok: false, reason: 'not_in_stash' };
  return {
    ok: true,
    team: removed.state,
    shop: {
      gold: shop.gold + sellValue(content, economy, entry.def, entry.tier),
      offers: shop.offers,
    },
  };
}

/**
 * Pay `rerollCost` and replace all offers with a fresh roll from `rng`. On
 * failure nothing is drawn from `rng`.
 */
export function rerollOffers(
  shop: PlayerShop,
  rng: Rng,
  round: number,
  content: ShopContent,
  economy: EconomyConfig,
): { readonly ok: true; readonly shop: PlayerShop } | ShopFailure {
  if (shop.gold < economy.rerollCost) {
    return { ok: false, reason: 'not_enough_gold' };
  }
  return {
    ok: true,
    shop: {
      gold: shop.gold - economy.rerollCost,
      offers: rollOffers(rng, round, content, economy),
    },
  };
}
