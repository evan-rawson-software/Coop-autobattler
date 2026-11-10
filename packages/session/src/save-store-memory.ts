/**
 * In-memory `SaveStore`: for tests, and the reference for the browser one.
 *
 * Values are copied (JSON round trip) on the way in and out, so nothing a
 * caller holds can change a stored record. A write is staged first and only
 * then committed with one `Map.set`, so a failed `put` leaves the old record.
 */
import {
  bestDepthFromHistory,
  compareListItems,
  summarizeStored,
  type HistoryEntry,
  type SaveListItem,
  type SaveRecord,
  type SaveStore,
} from './save.js';

export interface MemorySaveStoreOptions {
  /**
   * Awaited inside `put` after the record is staged and before it is
   * committed. Throw (or reject) to simulate a failed write; return a pending
   * promise to simulate a slow one.
   */
  readonly beforePut?: (record: SaveRecord) => void | Promise<void>;
  /** Same for `remove`. */
  readonly beforeRemove?: (runId: string) => void | Promise<void>;
}

export interface MemorySaveStore extends SaveStore {
  /** The next `put` rejects and changes nothing. */
  failNextPut(message?: string): void;
  /** The next `remove` rejects and changes nothing. */
  failNextRemove(message?: string): void;
  /** Plant any value under a key (to test damaged data). */
  injectRaw(runId: string, value: unknown): void;
  /** The number of stored values. */
  size(): number;
}

function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function createMemorySaveStore(
  options: MemorySaveStoreOptions = {},
): MemorySaveStore {
  const saves = new Map<string, unknown>();
  const history: HistoryEntry[] = [];
  let putFault: string | null = null;
  let removeFault: string | null = null;

  return {
    async list(): Promise<readonly SaveListItem[]> {
      await Promise.resolve();
      const items = [...saves.entries()].map(([id, raw]) =>
        summarizeStored(id, raw),
      );
      return items.sort(compareListItems);
    },

    async get(runId: string): Promise<unknown> {
      await Promise.resolve();
      return saves.has(runId) ? copy(saves.get(runId)) : null;
    },

    async put(record: SaveRecord): Promise<void> {
      await Promise.resolve();
      const runId = (record as { runId?: unknown }).runId;
      if (typeof runId !== 'string' || runId === '') {
        throw new Error('put: record has no runId');
      }
      const staged = copy(record);
      if (putFault !== null) {
        const message = putFault;
        putFault = null;
        throw new Error(message);
      }
      if (options.beforePut !== undefined) await options.beforePut(staged);
      saves.set(runId, staged);
    },

    async remove(runId: string): Promise<void> {
      await Promise.resolve();
      if (removeFault !== null) {
        const message = removeFault;
        removeFault = null;
        throw new Error(message);
      }
      if (options.beforeRemove !== undefined) await options.beforeRemove(runId);
      saves.delete(runId);
    },

    async listHistory(): Promise<readonly HistoryEntry[]> {
      await Promise.resolve();
      return copy(history);
    },

    async appendHistory(entry: HistoryEntry): Promise<void> {
      await Promise.resolve();
      if (history.some((h) => h.runId === entry.runId)) return;
      history.push(copy(entry));
    },

    async bestDepthByPartySize(): Promise<Readonly<Record<number, number>>> {
      await Promise.resolve();
      return bestDepthFromHistory(history);
    },

    failNextPut(message = 'simulated write failure'): void {
      putFault = message;
    },
    failNextRemove(message = 'simulated remove failure'): void {
      removeFault = message;
    },
    injectRaw(runId: string, value: unknown): void {
      saves.set(runId, copy(value));
    },
    size(): number {
      return saves.size;
    },
  };
}
