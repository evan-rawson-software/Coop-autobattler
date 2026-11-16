/**
 * Next-shop effects (RS-4i1): what an event does to a player's next shop.
 *
 * `PlayerRunState.nextShop` is an optional list, absent when there is none
 * (so older saves stay readable and no format number moved). An event adds
 * entries when it is applied; the shop reads them when it is entered (extra
 * offers) and on every re-roll (the offer count again, and free re-rolls,
 * which it counts down); the machine removes them when the shop ends.
 * One entry per kind. A later kind (Blueprint's held offer) adds a variant here.
 */
import { MAX_SHOP_EFFECT_COUNT, sortedKeys } from '@game/core';
import { isInteger, isRecord } from './json-guards.js';
import type { PlayerRunState, ShopEffect, ShopEffectKind } from './types.js';

export const SHOP_EFFECT_KINDS: readonly ShopEffectKind[] = [
  'extra_offers',
  'free_rerolls',
];

/** The `count` of a player's effect of this kind, 0 if there is none. */
export function shopEffectCount(
  p: PlayerRunState,
  kind: ShopEffectKind,
): number {
  return p.nextShop?.find((e) => e.kind === kind)?.count ?? 0;
}

/** `p` with `count` more of `kind` (summed with an existing entry). */
export function addShopEffect(
  p: PlayerRunState,
  kind: ShopEffectKind,
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
  kind: ShopEffectKind,
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
    if (
      !isRecord(e) ||
      typeof e['kind'] !== 'string' ||
      !(SHOP_EFFECT_KINDS as readonly string[]).includes(e['kind']) ||
      !isInteger(e['count']) ||
      e['count'] < 1 ||
      e['count'] > MAX_SHOP_EFFECT_COUNT ||
      sortedKeys(e).length !== 2
    ) {
      return `entries must be {kind: ${SHOP_EFFECT_KINDS.join(' | ')}, count: 1 to ${String(MAX_SHOP_EFFECT_COUNT)}}`;
    }
    if (seen.has(e['kind'])) return 'has two entries of one kind';
    seen.add(e['kind']);
  }
  return null;
}
