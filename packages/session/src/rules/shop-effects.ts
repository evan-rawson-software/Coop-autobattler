/**
 * Next-shop effects (RS-4i1): what an event does to a player's next shop.
 *
 * `PlayerRunState.nextShop` is an optional list, absent when there is none
 * (so older saves stay readable and no format number moved). An event adds
 * entries when it is applied; the shop reads them when it is entered (extra
 * offers) and on every re-roll (the offer count again, and free re-rolls,
 * which it counts down); the machine removes them when the shop ends.
 * One entry per kind. `held_offer` (Blueprint) carries a building `def`
 * instead of a count: that building sits in a fixed extra slot of the shop.
 */
import { MAX_SHOP_EFFECT_COUNT, sortedKeys } from '@game/core';
import { isInteger, isRecord } from './json-guards.js';
import type {
  CountedShopEffectKind,
  PlayerRunState,
  ShopEffect,
} from './types.js';

export const SHOP_EFFECT_KINDS: readonly CountedShopEffectKind[] = [
  'extra_offers',
  'free_rerolls',
];

/** The `count` of a player's effect of this kind, 0 if there is none. */
export function shopEffectCount(
  p: PlayerRunState,
  kind: CountedShopEffectKind,
): number {
  const e = p.nextShop?.find((x) => x.kind === kind);
  return e !== undefined && e.kind !== 'held_offer' ? e.count : 0;
}

/** The building a player's next shop holds in its fixed slot, or null. */
export function heldOfferDef(p: PlayerRunState): string | null {
  const e = p.nextShop?.find((x) => x.kind === 'held_offer');
  return e === undefined ? null : e.def;
}

/** `p` with `def` as its held offer (replacing any earlier one). */
export function setHeldOffer(p: PlayerRunState, def: string): PlayerRunState {
  const rest = (p.nextShop ?? []).filter((e) => e.kind !== 'held_offer');
  return { ...p, nextShop: [...rest, { kind: 'held_offer', def }] };
}

/** `p` without a held offer (it was bought). */
export function clearHeldOffer(p: PlayerRunState): PlayerRunState {
  return withNextShop(
    p,
    (p.nextShop ?? []).filter((e) => e.kind !== 'held_offer'),
  );
}

/** `p` with `count` more of `kind` (summed with an existing entry). */
export function addShopEffect(
  p: PlayerRunState,
  kind: CountedShopEffectKind,
  count: number,
): PlayerRunState {
  if (count <= 0) return p;
  const total = Math.min(
    MAX_SHOP_EFFECT_COUNT,
    shopEffectCount(p, kind) + count,
  );
  const rest = (p.nextShop ?? []).filter((e) => e.kind !== kind);
  return { ...p, nextShop: [...rest, { kind, count: total }] };
}

/** `p` with its `kind` count reduced by one; the entry goes at 0. */
export function useShopEffect(
  p: PlayerRunState,
  kind: CountedShopEffectKind,
): PlayerRunState {
  const left = shopEffectCount(p, kind) - 1;
  const rest = (p.nextShop ?? []).filter((e) => e.kind !== kind);
  const list: ShopEffect[] = left > 0 ? [...rest, { kind, count: left }] : rest;
  return withNextShop(p, list);
}

/** `p` with no next-shop effects (the key is removed, not set to empty). */
export function clearNextShop(p: PlayerRunState): PlayerRunState {
  return withNextShop(p, []);
}

function withNextShop(
  p: PlayerRunState,
  list: readonly ShopEffect[],
): PlayerRunState {
  const rest: Record<string, unknown> = { ...p };
  delete rest['nextShop'];
  const base = rest as unknown as PlayerRunState;
  return list.length === 0 ? base : { ...base, nextShop: list };
}

/** A problem with a stored `nextShop` value, or null. Structure only. */
export function nextShopProblem(v: unknown): string | null {
  if (!Array.isArray(v)) return 'must be a list';
  const seen = new Set<string>();
  for (const e of v as unknown[]) {
    if (isRecord(e) && e['kind'] === 'held_offer') {
      if (
        typeof e['def'] !== 'string' ||
        e['def'] === '' ||
        sortedKeys(e).length !== 2
      ) {
        return 'a held_offer entry must be {kind: held_offer, def: building id}';
      }
    } else if (
      !isRecord(e) ||
      typeof e['kind'] !== 'string' ||
      !(SHOP_EFFECT_KINDS as readonly string[]).includes(e['kind']) ||
      !isInteger(e['count']) ||
      e['count'] < 1 ||
      e['count'] > MAX_SHOP_EFFECT_COUNT ||
      sortedKeys(e).length !== 2
    ) {
      return `entries must be {kind: ${SHOP_EFFECT_KINDS.join(' | ')}, count: 1 to ${String(MAX_SHOP_EFFECT_COUNT)}} or {kind: held_offer, def}`;
    }
    const kind = String((e as { kind?: unknown }).kind);
    if (seen.has(kind)) return 'has two entries of one kind';
    seen.add(kind);
  }
  return null;
}
