/**
 * Which phase tips this player has seen (issue #300). A small web-side record
 * in `localStorage`, once per player; not part of the run state or the saves.
 * Without usable storage it is kept in memory for the page's lifetime.
 */
import { createStore } from '../app-state.js';
import { DEFAULT_PREFIX } from '../run/local-storage-store.js';
import { PHASE_ORDER, type PhaseId } from './phase.js';

export const PHASE_TIPS_KEY = `${DEFAULT_PREFIX}phase-tips-seen`;

function read(): readonly PhaseId[] {
  try {
    const raw = window.localStorage.getItem(PHASE_TIPS_KEY);
    if (raw === null) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? PHASE_ORDER.filter((p) => v.includes(p)) : [];
  } catch {
    return [];
  }
}

function write(seen: readonly PhaseId[]): void {
  try {
    window.localStorage.setItem(PHASE_TIPS_KEY, JSON.stringify(seen));
  } catch {
    // Storage is unavailable: the tips stay seen for this page only.
  }
}

/** The phases whose tip has been seen. Reads storage once, at load. */
export const seenTipsStore = createStore<readonly PhaseId[]>(read());

export function hasSeenTip(phase: PhaseId): boolean {
  return seenTipsStore.get().includes(phase);
}

/** Record that the player has seen (or dismissed) this phase's tip. */
export function markTipSeen(phase: PhaseId): void {
  const now = seenTipsStore.get();
  if (now.includes(phase)) return;
  const next = PHASE_ORDER.filter((p) => p === phase || now.includes(p));
  seenTipsStore.set(next);
  write(next);
}

/** "Show tips again": every tip is new again. */
export function resetTips(): void {
  seenTipsStore.set([]);
  write([]);
}
