/**
 * Whether the one-line hint about points of interest has been dismissed
 * (issue #375). Like the refinery hint: a small web-side record in
 * `localStorage`, once per player, not part of the run state; kept in memory
 * when storage is unusable.
 */
import { createStore } from '../app-state.js';
import { DEFAULT_PREFIX } from '../run/local-storage-store.js';

export const POINT_HINT_KEY = `${DEFAULT_PREFIX}point-hint-seen`;

function read(): boolean {
  try {
    return window.localStorage.getItem(POINT_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function write(seen: boolean): void {
  try {
    if (seen) window.localStorage.setItem(POINT_HINT_KEY, '1');
    else window.localStorage.removeItem(POINT_HINT_KEY);
  } catch {
    // Storage is unavailable: the hint stays dismissed for this page only.
  }
}

export const pointHintSeen = createStore<boolean>(read());

export function dismissPointHint(): void {
  pointHintSeen.set(true);
  write(true);
}

/** "Show tips again". */
export function resetPointHint(): void {
  pointHintSeen.set(false);
  write(false);
}
