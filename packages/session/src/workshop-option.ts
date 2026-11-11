/**
 * Checks a Workshop follow-up option against the team it claims to describe.
 * The price, tier, def and owner in a stored option are never trusted: they
 * are recomputed from the current state (`workshopPrice`), so an edited save
 * cannot buy an upgrade for less. Used by event_choose and validateRunState.
 */
import { workshopPrice, type ShopContent, type TeamState } from '@game/core';

/** The Workshop price percent used when an offer carries none. */
export const DEFAULT_WORKSHOP_PERCENT = 80;

/** A problem with `option` (as one of `player`'s), or null if it is exact. */
export function workshopOptionProblem(
  team: TeamState,
  content: ShopContent,
  percent: number,
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
  let price: number;
  try {
    price = workshopPrice(content, b.def, b.tier + 1, percent);
  } catch {
    return 'the building cannot be raised';
  }
  return o['price'] === price
    ? null
    : `price must be ${String(price)}, not ${JSON.stringify(o['price'])}`;
}
