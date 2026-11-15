/**
 * Whether the one-line refinery hint has been dismissed (issue #385). Like the
 * phase tips: a small web-side record in `localStorage`, once per player, not
 * part of the run state; kept in memory when storage is unusable.
 */
import { createStore } from '../app-state.js';
import { DEFAULT_PREFIX } from '../run/local-storage-store.js';
import type { OfferGroup } from './view-model.js';

export const REFINERY_HINT_KEY = `${DEFAULT_PREFIX}refinery-hint-seen`;

function read(): boolean {
  try {
    return window.localStorage.getItem(REFINERY_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function write(seen: boolean): void {
  try {
    if (seen) window.localStorage.setItem(REFINERY_HINT_KEY, '1');
    else window.localStorage.removeItem(REFINERY_HINT_KEY);
  } catch {
    // Storage is unavailable: the hint stays dismissed for this page only.
  }
}

export const refineryHintSeen = createStore<boolean>(read());

export function dismissRefineryHint(): void {
  refineryHintSeen.set(true);
  write(true);
}

/** "Show tips again". */
export function resetRefineryHint(): void {
  refineryHintSeen.set(false);
  write(false);
}

/** Whether any offer on sale is a refinery (what the hint is about). */
export function offersRefinery(groups: readonly OfferGroup[]): boolean {
  return groups.some((g) => g.card.offer?.kind === 'refinery');
}
