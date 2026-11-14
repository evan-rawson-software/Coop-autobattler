/**
 * Checks the STRUCTURE of a Workshop follow-up option against the team it
 * claims to describe: id format, owner, building, def, tier, newTier and
 * placed flag. The stored `price` and `affordable` are display data only:
 * they are checked for type but never compared with content or gold, because
 * a run saved under an older minor version continues under current numbers.
 * The price actually charged is `currentWorkshopPrice`, computed when the
 * player chooses. Used by event_choose and validateRunState.
 */
import {
  workshopPriceOrNull,
  type ShopContent,
  type TeamState,
} from '@game/core';

/** The Workshop price percent used when an offer carries none. */
export const DEFAULT_WORKSHOP_PERCENT = 80;

/** The price to raise `option`'s building now, from current content; null if it cannot be. */
export function currentWorkshopPrice(
  content: ShopContent,
  percent: number,
  def: string,
  tier: number,
): number | null {
  return workshopPriceOrNull(content, def, tier + 1, percent);
}

/** A structural problem with `option` (as one of `player`'s), or null. */
export function workshopOptionProblem(
  team: TeamState,
  player: number,
  option: unknown,
): string | null {
  if (typeof option !== 'object' || option === null || Array.isArray(option)) {
    return 'not an object';
  }
  const o = option as Record<string, unknown>;
  if (o['player'] !== player) return 'player does not match';
  const id = o['building'];
  if (typeof id !== 'number' || o['id'] !== `b${String(id)}`) {
    return 'building does not match the option id';
  }
  const placed = team.buildings.find((b) => b.id === id);
  const b = placed ?? team.stash.find((x) => x.id === id);
  if (b === undefined) return 'no such building';
  if (b.owner !== player) return 'building belongs to another player';
  if (b.tier >= 3 || o['def'] !== b.def || o['tier'] !== b.tier) {
    return 'def or tier does not match the building';
  }
  if (o['newTier'] !== b.tier + 1 || o['placed'] !== (placed !== undefined)) {
    return 'newTier or placed does not match the building';
  }
  const price = o['price'];
  if (typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0) {
    return 'price must be a non-negative integer';
  }
  if (typeof o['affordable'] !== 'boolean')
    return 'affordable must be a boolean';
  return null;
}
