/**
 * Which first-time hints this player has seen, and whether tips are turned
 * off (issue #419). Like the phase tips: small web-side records in
 * `localStorage`, once per player, not part of the run state or the saves.
 * Without usable storage they are kept in memory for the page's lifetime.
 */
import { createStore } from '../app-state.js';
import { DEFAULT_PREFIX } from '../run/local-storage-store.js';

/** The hints this store tracks (the points and refinery-offer hints keep their own records). */
export const HINT_IDS = [
  'pact',
  'caravan',
  'vein',
  'boss',
  'refineryPlaced',
  'bonuses',
  'plotFull',
] as const;

export type HintId = (typeof HINT_IDS)[number];

export const HINTS_SEEN_KEY = `${DEFAULT_PREFIX}hints-seen`;
export const TIPS_OFF_KEY = `${DEFAULT_PREFIX}tips-off`;

function readSeen(): readonly HintId[] {
  try {
    const raw = window.localStorage.getItem(HINTS_SEEN_KEY);
    if (raw === null) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? HINT_IDS.filter((h) => v.includes(h)) : [];
  } catch {
    return [];
  }
}

function writeSeen(seen: readonly HintId[]): void {
  try {
    window.localStorage.setItem(HINTS_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Storage is unavailable: the hints stay seen for this page only.
  }
}

function readOff(): boolean {
  try {
    return window.localStorage.getItem(TIPS_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOff(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(TIPS_OFF_KEY, '1');
    else window.localStorage.removeItem(TIPS_OFF_KEY);
  } catch {
    // Storage is unavailable: the setting holds for this page only.
  }
}

export const hintsSeenStore = createStore<readonly HintId[]>(readSeen());

/** True when the player turned tips off (phase tips and every hint). */
export const tipsOffStore = createStore<boolean>(readOff());

export function hasSeenHint(id: HintId): boolean {
  return hintsSeenStore.get().includes(id);
}

/** Record that the player has seen (or dismissed) this hint. */
export function markHintSeen(id: HintId): void {
  const now = hintsSeenStore.get();
  if (now.includes(id)) return;
  const next = HINT_IDS.filter((h) => h === id || now.includes(h));
  hintsSeenStore.set(next);
  writeSeen(next);
}

/** "Show tips again": every hint is new again. */
export function resetHints(): void {
  hintsSeenStore.set([]);
  writeSeen([]);
}

export function setTipsOff(off: boolean): void {
  tipsOffStore.set(off);
  writeOff(off);
}
