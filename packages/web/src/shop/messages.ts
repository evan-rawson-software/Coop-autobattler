/** Wording for the Shop tab's rejections and confirmations. UI text only. */
import { reasonMessage } from '../build/reasons.js';

const SHOP_REASONS: Readonly<Record<string, string>> = {
  not_enough_gold: 'Not enough gold.',
  no_such_offer: 'That offer is gone (already bought or re-rolled).',
  not_in_stash: 'That building is not in your stash.',
  not_owner: 'That building belongs to another player.',
};

export function shopReason(reason: string, detail?: string): string {
  return SHOP_REASONS[reason] ?? reasonMessage(reason, detail);
}
