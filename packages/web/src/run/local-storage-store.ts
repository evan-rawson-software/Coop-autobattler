/**
 * A `SaveStore` backed by `localStorage` (or any object shaped like it).
 *
 * This is the minimal browser store for the Shop route; the real flow (#25)
 * can swap in an IndexedDB store behind the same interface.
 *
 * Layout: one key per run (`<prefix>save:<runId>`, a JSON string) and one key
 * for the history (`<prefix>history`, a JSON array). `setItem` is atomic, so
 * a failed `put` (quota) leaves the old record. A value that is not valid
 * JSON is returned as the raw string, so callers see it as damaged data
 * rather than losing it.
 */
import {
  bestDepthFromHistory,
  compareListItems,
  summarizeStored,
  type HistoryEntry,
  type SaveListItem,
  type SaveRecord,
  type SaveStore,
} from '@game/session';

/** The part of `Storage` this store uses. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEFAULT_PREFIX = 'coop:';

export function createLocalStorageSaveStore(
  storage: StorageLike,
  prefix: string = DEFAULT_PREFIX,
): SaveStore {
  const savePrefix = `${prefix}save:`;
  const historyKey = `${prefix}history`;

  const parse = (text: string | null): unknown => {
    if (text === null) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };

  const readHistory = (): HistoryEntry[] => {
    const v = parse(storage.getItem(historyKey));
    return Array.isArray(v) ? (v as HistoryEntry[]) : [];
  };

  const savedIds = (): string[] => {
    const ids: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k !== null && k.startsWith(savePrefix)) {
        ids.push(k.slice(savePrefix.length));
      }
    }
    return ids;
  };

  return {
    async list(): Promise<readonly SaveListItem[]> {
      await Promise.resolve();
      return savedIds()
        .map((id) =>
          summarizeStored(id, parse(storage.getItem(savePrefix + id))),
        )
        .sort(compareListItems);
    },

    async get(runId: string): Promise<unknown> {
      await Promise.resolve();
      return parse(storage.getItem(savePrefix + runId));
    },

    async put(record: SaveRecord): Promise<void> {
      await Promise.resolve();
      const runId = (record as { runId?: unknown }).runId;
      if (typeof runId !== 'string' || runId === '') {
        throw new Error('put: record has no runId');
      }
      // Serialising copies the record; setItem either stores all of it or
      // throws and keeps the old value.
      storage.setItem(savePrefix + runId, JSON.stringify(record));
    },

    async remove(runId: string): Promise<void> {
      await Promise.resolve();
      storage.removeItem(savePrefix + runId);
    },

    async listHistory(): Promise<readonly HistoryEntry[]> {
      await Promise.resolve();
      return readHistory();
    },

    async appendHistory(entry: HistoryEntry): Promise<void> {
      await Promise.resolve();
      const all = readHistory();
      if (all.some((h) => h.runId === entry.runId)) return;
      all.push(entry);
      storage.setItem(historyKey, JSON.stringify(all));
    },

    async bestDepthByPartySize(): Promise<Readonly<Record<number, number>>> {
      await Promise.resolve();
      return bestDepthFromHistory(readHistory());
    },
  };
}

/** A `Storage` kept in memory, for tests and when `localStorage` is blocked. */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

/**
 * The browser's `localStorage`, or null if it is missing or blocked (private
 * modes can throw on access).
 */
export function browserStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = `${DEFAULT_PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
