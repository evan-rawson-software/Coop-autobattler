/**
 * Which runs were started with "Play the tutorial". A small web-side record in
 * `localStorage`; it is not part of the run state or the saves. The guided
 * tutorial (issue #309, `tutorial/`) shows its tips only for these runs.
 */
import { DEFAULT_PREFIX } from '../run/local-storage-store.js';

const KEY = `${DEFAULT_PREFIX}tutorial-runs`;
/** Keep the list short; only recent runs matter. */
const MAX_KEPT = 50;

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Remember that this run was started as the tutorial. */
export function markTutorialRun(runId: string): void {
  try {
    const ids = read().filter((id) => id !== runId);
    ids.push(runId);
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX_KEPT)));
  } catch {
    // Storage is unavailable: the run simply is not marked.
  }
}

export function isTutorialRun(runId: string): boolean {
  return read().includes(runId);
}

/**
 * Has this player finished a run? Derived from the run history the save store
 * keeps (one entry per finished or abandoned run).
 */
export function hasFinishedFirstRun(finishedRuns: number): boolean {
  return finishedRuns > 0;
}
