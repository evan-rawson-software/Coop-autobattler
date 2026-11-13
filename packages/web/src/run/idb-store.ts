/**
 * A `SaveStore` backed by IndexedDB (the session `SaveStore` interface), plus
 * the store of final states for the Run over screen (`FinishedRuns`).
 *
 * Object stores: `saves` (key = runId, value = the record), `history`
 * (auto-increment key, so the order is the order of appending, with a unique
 * index on `runId`) and `finished` (key = runId).
 *
 * Stale writes: with `rejectStale`, `put` reads the stored record and writes
 * the new one in ONE read-write transaction. If the stored record's
 * `actionCounter` is the same or higher (another tab saved a later or competing
 * step first) the transaction is aborted, nothing is written, `onStale` is
 * called and `put` rejects with `StaleSaveError`.
 *
 * A stored value is returned as it is, so callers see damaged data as
 * damaged rather than losing it (`get` is `unknown`).
 */
import {
  bestDepthFromHistory,
  compareListItems,
  isStaleWrite,
  StaleSaveError,
  summarizeStored,
  type HistoryEntry,
  type SaveListItem,
  type SaveRecord,
  type SaveStore,
} from '@game/session';
import {
  asFinishedRecord,
  FINISHED_KEEP,
  type FinishedRecord,
  type FinishedRuns,
} from './finished.js';

export const DB_NAME = 'coop-autobattler';
const DB_VERSION = 1;
const SAVES = 'saves';
const HISTORY = 'history';
const FINISHED = 'finished';

export interface IdbOptions {
  /** Database name; tests give each store its own. */
  readonly dbName?: string;
  /** Refuse a `put` whose `actionCounter` is not above the stored one. */
  readonly rejectStale?: boolean;
  /** Called when a stale `put` was refused. */
  readonly onStale?: (runId: string) => void;
  /** Called after a record was written (to tell other tabs). */
  readonly onWritten?: (runId: string) => void;
  /** The open is waiting for another tab (see `openDb`). */
  readonly onBlocked?: () => void;
  readonly onUnblocked?: () => void;
  readonly signal?: AbortSignal;
  /**
   * Another tab needs to upgrade the database: this connection has been
   * closed, so the stores no longer work until the page is reloaded.
   */
  readonly onVersionChange?: () => void;
}

export interface IdbStores {
  readonly saves: SaveStore;
  readonly finished: FinishedRuns;
  close(): void;
}

export interface OpenHooks {
  /** Another tab holds an older version of the database open. */
  readonly onBlocked?: () => void;
  /** The blocked open went ahead. */
  readonly onUnblocked?: () => void;
  /**
   * Give up: the open is rejected, and a connection that opens after that is
   * closed again instead of being leaked.
   */
  readonly signal?: AbortSignal;
}

/**
 * Open the database. A blocked open (another tab is upgrading or holds an old
 * connection) is NOT an error: the request stays pending and goes ahead when
 * the other tab lets go, so this keeps waiting and only reports it.
 */
export function openDb(
  factory: IDBFactory,
  name: string,
  hooks: OpenHooks = {},
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    let rejected = false;
    let blocked = false;
    const giveUp = (error: Error): void => {
      rejected = true;
      reject(error);
    };
    hooks.signal?.addEventListener('abort', () => {
      if (!rejected) giveUp(new Error('Opening the database was cancelled'));
    });
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES);
      if (!db.objectStoreNames.contains(HISTORY)) {
        const h = db.createObjectStore(HISTORY, { autoIncrement: true });
        h.createIndex('runId', 'runId', { unique: true });
      }
      if (!db.objectStoreNames.contains(FINISHED)) {
        db.createObjectStore(FINISHED);
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      if (rejected) {
        // Nobody is waiting for this connection any more.
        db.close();
        return;
      }
      if (blocked) hooks.onUnblocked?.();
      resolve(db);
    };
    open.onerror = () => {
      if (!rejected) {
        giveUp(open.error ?? new Error('IndexedDB could not be opened'));
      }
    };
    open.onblocked = () => {
      blocked = true;
      hooks.onBlocked?.();
    };
  });
}

/**
 * Run `work` in one transaction over `stores` and resolve with its result when
 * the transaction has committed. `work` must only use IDB requests (no other
 * awaiting) so the transaction stays open.
 */
function transact<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (
    tx: IDBTransaction,
    done: (value: T) => void,
    abort: (error: Error) => void,
  ) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let result: T | undefined;
    let failure: Error | null = null;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    tx.oncomplete = () => {
      resolve(result as T);
    };
    tx.onabort = () => {
      reject(failure ?? tx.error ?? new Error('The transaction was aborted'));
    };
    try {
      work(
        tx,
        (v) => {
          result = v;
        },
        (e) => {
          failure = e;
          try {
            tx.abort();
          } catch {
            // already finished
          }
        },
      );
    } catch (e) {
      failure = e instanceof Error ? e : new Error(String(e));
      try {
        tx.abort();
      } catch {
        // already finished
      }
    }
  });
}

export async function openIndexedDbStores(
  factory: IDBFactory,
  options: IdbOptions = {},
): Promise<IdbStores> {
  const db = await openDb(factory, options.dbName ?? DB_NAME, {
    ...(options.onBlocked === undefined
      ? {}
      : { onBlocked: options.onBlocked }),
    ...(options.onUnblocked === undefined
      ? {}
      : { onUnblocked: options.onUnblocked }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  db.onversionchange = () => {
    db.close();
    options.onVersionChange?.();
  };

  const listHistory = (): Promise<HistoryEntry[]> =>
    transact<HistoryEntry[]>(db, [HISTORY], 'readonly', (tx, done) => {
      const r = tx.objectStore(HISTORY).getAll();
      r.onsuccess = () => {
        done(r.result as HistoryEntry[]);
      };
    });

  const saves: SaveStore = {
    list(): Promise<readonly SaveListItem[]> {
      return transact<SaveListItem[]>(db, [SAVES], 'readonly', (tx, done) => {
        const os = tx.objectStore(SAVES);
        const keys = os.getAllKeys();
        const values = os.getAll();
        values.onsuccess = () => {
          const ks = keys.result;
          const vs = values.result as unknown[];
          done(
            ks
              .map((k, i) =>
                summarizeStored(typeof k === 'string' ? k : '', vs[i]),
              )
              .sort(compareListItems),
          );
        };
      });
    },

    get(runId: string): Promise<unknown> {
      return transact<unknown>(db, [SAVES], 'readonly', (tx, done) => {
        const r = tx.objectStore(SAVES).get(runId);
        r.onsuccess = () => {
          done(r.result === undefined ? null : (r.result as unknown));
        };
      });
    },

    async put(record: SaveRecord): Promise<void> {
      const runId = (record as { runId?: unknown }).runId;
      if (typeof runId !== 'string' || runId === '') {
        throw new Error('put: record has no runId');
      }
      const flags = { stale: false };
      try {
        await transact<undefined>(
          db,
          [SAVES],
          'readwrite',
          (tx, _done, abort) => {
            const os = tx.objectStore(SAVES);
            const read = os.get(runId);
            read.onsuccess = () => {
              if (options.rejectStale === true) {
                if (isStaleWrite(read.result, record)) {
                  flags.stale = true;
                  abort(new StaleSaveError());
                  return;
                }
              }
              os.put(record, runId);
            };
          },
        );
      } catch (e) {
        if (flags.stale) options.onStale?.(runId);
        throw e;
      }
      options.onWritten?.(runId);
    },

    async remove(runId: string): Promise<void> {
      await transact<undefined>(db, [SAVES], 'readwrite', (tx) => {
        tx.objectStore(SAVES).delete(runId);
      });
      options.onWritten?.(runId);
    },

    listHistory,

    appendHistory(entry: HistoryEntry): Promise<void> {
      return transact<undefined>(db, [HISTORY], 'readwrite', (tx) => {
        const os = tx.objectStore(HISTORY);
        const found = os.index('runId').getKey(entry.runId);
        found.onsuccess = () => {
          if (found.result === undefined) os.add(entry);
        };
      });
    },

    async bestDepthByPartySize(): Promise<Readonly<Record<number, number>>> {
      return bestDepthFromHistory(await listHistory());
    },
  };

  const finished: FinishedRuns = {
    put(record: FinishedRecord): Promise<void> {
      return transact<undefined>(db, [FINISHED], 'readwrite', (tx) => {
        const os = tx.objectStore(FINISHED);
        os.put(record, record.runId);
        // Keep the newest few: drop the oldest by `finishedAt` beyond the cap.
        const all = os.getAll();
        all.onsuccess = () => {
          const rows = (all.result as unknown[])
            .map(asFinishedRecord)
            .filter((r): r is FinishedRecord => r !== null)
            .sort((a, b) => a.finishedAt - b.finishedAt);
          for (const old of rows.slice(
            0,
            Math.max(0, rows.length - FINISHED_KEEP),
          )) {
            os.delete(old.runId);
          }
        };
      });
    },
    get(runId: string): Promise<FinishedRecord | null> {
      return transact<FinishedRecord | null>(
        db,
        [FINISHED],
        'readonly',
        (tx, done) => {
          const r = tx.objectStore(FINISHED).get(runId);
          r.onsuccess = () => {
            done(asFinishedRecord(r.result));
          };
        },
      );
    },
  };

  return {
    saves,
    finished,
    close: () => {
      db.close();
    },
  };
}
