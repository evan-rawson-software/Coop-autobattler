/**
 * View model of the main menu: the saved runs as rows, and the records. Pure:
 * it reads what the save store lists and decides nothing.
 */
import { classify, type HistoryEntry, type SaveListItem } from '@game/session';
import { stepLabel } from '../run/router.js';
import { INSTALLED_VERSION } from '../run/version.js';
import { count } from '../plural.js';

export interface SavedRunRow {
  readonly kind: 'run';
  readonly runId: string;
  /** "You (solo)" or the party's names. */
  readonly title: string;
  /** "Round 6 · Lives 3 / 5 · Build". */
  readonly detail: string;
  readonly playedAgo: string;
  /** "Saved on an older version: some things may have changed", or null. */
  readonly note: string | null;
  /** Why this run cannot be resumed, or null when it can. */
  readonly blocked: string | null;
}

export interface DamagedRow {
  readonly kind: 'damaged';
  readonly runId: string;
  readonly message: string;
  readonly playedAgo: string;
}

export type MenuRow = SavedRunRow | DamagedRow;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 minutes ago", "2 days ago". */
export function agoText(updatedAt: number, now: number): string {
  if (updatedAt <= 0) return 'at an unknown time';
  const d = Math.max(0, now - updatedAt);
  if (d < MINUTE) return 'just now';
  if (d < HOUR) return `${count(Math.floor(d / MINUTE), 'minute')} ago`;
  if (d < DAY) return `${count(Math.floor(d / HOUR), 'hour')} ago`;
  if (d < 14 * DAY) return `${count(Math.floor(d / DAY), 'day')} ago`;
  if (d < 60 * DAY) return `${count(Math.floor(d / (7 * DAY)), 'week')} ago`;
  return `${count(Math.floor(d / (30 * DAY)), 'month')} ago`;
}

export const OLDER_VERSION_NOTE =
  'Saved on an older version: some things may have changed';

/** The rows of the saved-runs list, in the order the store gave (newest first). */
export function menuRows(
  items: readonly SaveListItem[],
  now: number,
  startingLives: number,
  installed: string = INSTALLED_VERSION,
): MenuRow[] {
  const rows: MenuRow[] = [];
  for (const item of items) {
    if (item.corrupt) {
      rows.push({
        kind: 'damaged',
        runId: item.runId,
        message:
          'This saved run is damaged and cannot be read. It has not been deleted.',
        playedAgo: agoText(item.updatedAt, now),
      });
      continue;
    }
    const kind = classify(item.runVersion, installed);
    const unreadable =
      item.unsupportedFormat === true ||
      kind === 'newer' ||
      kind === 'older_major';
    // A readable run that already ended is finished off at start-up; do not
    // list it. One the game cannot read stays listed, so it can be removed.
    if (item.summary.outcome !== null && !unreadable) continue;
    const names = item.playerNames;
    const title =
      names.length === 1 ? `${names[0] ?? 'You'} (solo)` : names.join(' + ');
    rows.push({
      kind: 'run',
      runId: item.runId,
      title,
      detail: `Round ${String(item.summary.round)} · Lives ${String(item.summary.lives)} / ${String(startingLives)} · ${stepLabel(item.summary.step)}`,
      playedAgo: agoText(item.updatedAt, now),
      note: kind === 'older_minor' ? OLDER_VERSION_NOTE : null,
      blocked:
        item.unsupportedFormat === true
          ? 'Saved in a format this version of the game cannot read. It has not been deleted.'
          : kind === 'newer'
            ? 'Made by a newer version of the game. Open that version to continue it.'
            : kind === 'older_major'
              ? 'Made by an older version that is no longer supported.'
              : null,
    });
  }
  return rows;
}

export interface RecordRow {
  readonly label: string;
  readonly value: string;
}

/** "1 player: round 11" for each party size; a dash where there is none. */
export function recordRows(
  best: Readonly<Record<number, number>>,
): RecordRow[] {
  return [1, 2, 3, 4].map((n) => ({
    label: count(n, 'player'),
    value: best[n] === undefined ? '—' : `round ${String(best[n])}`,
  }));
}

/** How many finished runs the menu lists (and the web layer keeps a summary for). */
export const RECENT_RUNS_SHOWN = 5;

export interface RecentRunRow {
  readonly runId: string;
  /** "1 player · round 6 · 2026-11-14" (the date is UTC). */
  readonly text: string;
}

/**
 * The newest finished runs whose Run over summary is still kept (`has`), at
 * most `limit`, newest first. A run whose summary is gone is left out.
 */
export function recentRunRows(
  history: readonly HistoryEntry[],
  has: (runId: string) => boolean,
  limit: number = RECENT_RUNS_SHOWN,
): RecentRunRow[] {
  const newest = [...history].sort((a, b) => b.finishedAt - a.finishedAt);
  const rows: RecentRunRow[] = [];
  for (const h of newest) {
    if (rows.length >= limit) break;
    if (!has(h.runId)) continue;
    rows.push({
      runId: h.runId,
      text: `${count(h.partySize, 'player')} · round ${String(h.round)} · ${new Date(h.finishedAt).toISOString().slice(0, 10)}`,
    });
  }
  return rows;
}
