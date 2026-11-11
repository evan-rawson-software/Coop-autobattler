/**
 * Finished runs kept for the Run over screen.
 *
 * The session controller removes a run's save when the run ends (it records a
 * history entry first), so the final state would be gone on a reload. The
 * Run over screen shows the final factory and the round-by-round history, so
 * the web layer keeps the last few final states here, apart from the saves.
 * This is a presentation convenience: nothing in the rules reads it.
 */
import type { RunState } from '@game/session';
import type { StorageLike } from './local-storage-store.js';

export interface FinishedRecord {
  readonly runId: string;
  /** The last committed state of the run (its `outcome` is set). */
  readonly state: RunState;
  readonly finishedAt: number;
}

export interface FinishedRuns {
  put(record: FinishedRecord): Promise<void>;
  get(runId: string): Promise<FinishedRecord | null>;
}

/** How many final states are kept; the oldest are dropped first. */
export const FINISHED_KEEP = 40;

function isRecord(v: unknown): v is FinishedRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['runId'] === 'string' &&
    typeof r['finishedAt'] === 'number' &&
    typeof r['state'] === 'object' &&
    r['state'] !== null
  );
}

export const asFinishedRecord = (v: unknown): FinishedRecord | null =>
  isRecord(v) ? v : null;

export function createMemoryFinishedRuns(): FinishedRuns {
  const map = new Map<string, FinishedRecord>();
  return {
    async put(record) {
      await Promise.resolve();
      map.set(
        record.runId,
        JSON.parse(JSON.stringify(record)) as FinishedRecord,
      );
      while (map.size > FINISHED_KEEP) {
        const first = map.keys().next();
        if (first.done === true) break;
        map.delete(first.value);
      }
    },
    async get(runId) {
      await Promise.resolve();
      const v = map.get(runId);
      return v === undefined
        ? null
        : (JSON.parse(JSON.stringify(v)) as FinishedRecord);
    },
  };
}

/** Final states in `localStorage`: one key per run plus an index of the order. */
export function createLocalFinishedRuns(
  storage: StorageLike,
  prefix: string,
): FinishedRuns {
  const keyOf = (id: string): string => `${prefix}finished:${id}`;
  const indexKey = `${prefix}finished-index`;
  const readIndex = (): string[] => {
    try {
      const v = JSON.parse(storage.getItem(indexKey) ?? '[]') as unknown;
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  return {
    async put(record) {
      await Promise.resolve();
      storage.setItem(keyOf(record.runId), JSON.stringify(record));
      const index = readIndex().filter((id) => id !== record.runId);
      index.push(record.runId);
      while (index.length > FINISHED_KEEP) {
        const old = index.shift();
        if (old !== undefined) storage.removeItem(keyOf(old));
      }
      storage.setItem(indexKey, JSON.stringify(index));
    },
    async get(runId) {
      await Promise.resolve();
      const text = storage.getItem(keyOf(runId));
      if (text === null) return null;
      try {
        return asFinishedRecord(JSON.parse(text));
      } catch {
        return null;
      }
    },
  };
}
