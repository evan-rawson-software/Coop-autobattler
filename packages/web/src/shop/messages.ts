/** Wording for the Shop tab's rejections and confirmations. UI text only. */
import { reasonMessage, type SelectionCause } from '../build/reasons.js';
import { screenText, screenTexts } from '../build/texts.js';
import { STALE_MESSAGE } from '../run/local-storage-store.js';

const SHOP_REASONS: Readonly<Record<string, string>> = {
  not_enough_gold: 'uiShopNotEnoughGold',
  no_such_offer: 'uiShopNoSuchOffer',
  not_in_stash: 'uiShopNotInStash',
  not_owner: 'uiShopNotOwner',
};

export function shopReason(
  reason: string,
  detail?: string,
  cause?: SelectionCause,
): string {
  if (reason === 'save_failed' && detail === STALE_MESSAGE) {
    return screenText(screenTexts, 'uiShopStale', { message: STALE_MESSAGE });
  }
  const key = Object.hasOwn(SHOP_REASONS, reason)
    ? SHOP_REASONS[reason]
    : undefined;
  return key === undefined
    ? reasonMessage(reason, detail, cause)
    : screenText(screenTexts, key);
}
