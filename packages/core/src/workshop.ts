/**
 * Workshop rules (RS-4a, issue #50): each player may raise one building they
 * own by one tier for a share of the shop price of the tier it is raised to.
 * Pure functions; the event handler in the session package wires them to the
 * run. See docs/rules-reference.md, "Events (RS-4)".
 */
import type { BuildingId } from './buildings.js';
import { mulPct } from './int.js';
import { tierPrice, type ShopContent } from './shop.js';
import type { TeamState } from './team-state.js';

/** One building a player could raise. */
export interface WorkshopOption {
  /** The building's instance id. */
  readonly building: number;
  readonly def: BuildingId;
  /** The current tier (1 or 2). */
  readonly tier: number;
  /** The tier after the raise (`tier + 1`, at most 3). */
  readonly newTier: number;
  /** Gold the owner pays: see `workshopPrice`. */
  readonly price: number;
  /** True if the building is on the board, false if it is in the stash. */
  readonly placed: boolean;
  /** True if the owner's gold covers `price`. */
  readonly affordable: boolean;
}

/**
 * The Workshop price of raising a building of `def` to `newTier`:
 * `floor(shopPrice(def, newTier) * percent / 100)`, using the same price
 * function as the shop (`tierPrice`). Rounds down.
 */
export function workshopPrice(
  content: ShopContent,
  def: BuildingId,
  newTier: number,
  percent: number,
): number {
  return mulPct(tierPrice(content, def, newTier), percent);
}

/**
 * Every building `player` owns (placed or in the stash) that is below tier 3
 * and has a purchasable next tier, in instance id order, with its price and
 * whether `gold` covers it.
 */
export function workshopOptions(
  team: TeamState,
  player: number,
  gold: number,
  content: ShopContent,
  percent: number,
): WorkshopOption[] {
  const out: WorkshopOption[] = [];
  const add = (
    b: { id: number; def: BuildingId; tier: number; owner: number },
    placed: boolean,
  ): void => {
    if (b.owner !== player || b.tier >= 3) return;
    const def = content.buildings.get(b.def);
    const next = def === undefined ? undefined : def.tiers[b.tier];
    if (next === undefined || !('price' in next)) return;
    const price = workshopPrice(content, b.def, b.tier + 1, percent);
    out.push({
      building: b.id,
      def: b.def,
      tier: b.tier,
      newTier: b.tier + 1,
      price,
      placed,
      affordable: gold >= price,
    });
  };
  for (const b of team.buildings) add(b, true);
  for (const b of team.stash) add(b, false);
  return out.sort((a, b) => a.building - b.building);
}
