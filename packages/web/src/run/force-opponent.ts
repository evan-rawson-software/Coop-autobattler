/**
 * Debug option (W3-3): force the opponent kind of the next PvP battle, for
 * playtesting. Kept in `localStorage` of this browser, outside every save.
 *
 * How it stays replay-safe. The opponent of a round is fixed by the intent
 * `select_ghost`, which carries the list of candidates read from the pool
 * and is written to the action log like any other input. "boss" only hides
 * the pool from that read, so the log holds the same entry an empty pool
 * gives (`n: 0`, the boss); replay never consults this setting. "ghost" does
 * not change the read: a ghost is already chosen whenever one exists, and
 * the boss is the answer when none does (RS-5c), so it cannot invent one.
 * The run state and its format are untouched.
 *
 * The setting applies when the shop of the PvE leg fixes the opponent, so it
 * affects the next selection and never one already made.
 */
import type { GhostStore } from '@game/session';
import { browserStorage, type StorageLike } from './local-storage-store.js';

export type ForcedOpponent = 'auto' | 'ghost' | 'boss';

export const FORCE_OPPONENT_KEY = 'coop-autobattler:debug-force-opponent';

export function readForcedOpponent(
  storage: StorageLike | null = browserStorage(),
): ForcedOpponent {
  try {
    const v = storage?.getItem(FORCE_OPPONENT_KEY);
    return v === 'ghost' || v === 'boss' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeForcedOpponent(
  mode: ForcedOpponent,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    if (mode === 'auto') storage?.removeItem(FORCE_OPPONENT_KEY);
    else storage?.setItem(FORCE_OPPONENT_KEY, mode);
  } catch {
    // Storage is blocked: the option stays off.
  }
}

/** A store that lists nothing while the boss is forced. */
export function withForcedOpponent(
  inner: GhostStore,
  mode: () => ForcedOpponent = readForcedOpponent,
): GhostStore {
  return {
    save: (s) => inner.save(s),
    list: (bucket) =>
      mode() === 'boss' ? Promise.resolve([]) : inner.list(bucket),
    get: (b, o, r) => inner.get(b, o, r),
    clear: () => inner.clear(),
    removeOtherVersions: (v) => inner.removeOtherVersions(v),
  };
}
