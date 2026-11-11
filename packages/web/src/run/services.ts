/**
 * The services behind every run screen: where runs are saved, the fully wired
 * game rules (`createGameDeps`, real battles), and the start-up repair of the
 * saved runs (`initSaves`).
 *
 * Storage, best first: IndexedDB, then `localStorage`, then memory (a run then
 * lasts only as long as the page, and the screens say so).
 *
 * Another tab changing a run this tab has open is reported through `watch`:
 * a refused stale write, a write announced on the broadcast channel, or (for
 * `localStorage`) a `storage` event.
 */
import {
  checkSaveShape,
  createGameDeps,
  createMemorySaveStore,
  initSaves,
  type InitSavesResult,
  type RunDeps,
  type SaveStore,
} from '@game/session';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import {
  createLocalFinishedRuns,
  createMemoryFinishedRuns,
  type FinishedRuns,
} from './finished.js';
import { openIndexedDbStores } from './idb-store.js';
import {
  browserStorage,
  createLocalStorageSaveStore,
  DEFAULT_PREFIX,
  type StorageLike,
} from './local-storage-store.js';
import { INSTALLED_VERSION } from './version.js';

export type StorageKind = 'indexeddb' | 'local' | 'memory';

export interface GameServices {
  readonly saves: SaveStore;
  readonly finished: FinishedRuns;
  readonly storage: StorageKind;
  readonly deps: RunDeps;
  /** What `initSaves` did at start-up (wiped, finished, newer, corrupt). */
  readonly init: InitSavesResult;
  /** Call `onChange` when something else writes or refuses a write of `runId`. */
  watch(runId: string, onChange: () => void): () => void;
}

/** The page's globals, or stand-ins in tests. */
export interface ServiceEnv {
  readonly indexedDB: IDBFactory | null;
  readonly localStorage: StorageLike | null;
  readonly broadcast: ((name: string) => BroadcastLike) | null;
  readonly window: Pick<
    EventTarget,
    'addEventListener' | 'removeEventListener'
  > | null;
  readonly now: () => number;
  /** A name for this tab, so its own broadcasts can be ignored. */
  readonly tabId: string;
}

export interface BroadcastLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
  close(): void;
}

let deps: RunDeps | null = null;

/** The rules with real battles (not the fixed-result stand-in). */
export function gameDeps(): RunDeps {
  deps ??= createGameDeps(content, gameConfigs);
  return deps;
}

export function browserEnv(): ServiceEnv {
  const idb = (): IDBFactory | null => {
    try {
      return typeof indexedDB === 'undefined' ? null : indexedDB;
    } catch {
      return null;
    }
  };
  return {
    indexedDB: idb(),
    localStorage: browserStorage(),
    broadcast:
      typeof BroadcastChannel === 'undefined'
        ? null
        : (name) => new BroadcastChannel(name),
    window: typeof window === 'undefined' ? null : window,
    now: () => Date.now(),
    tabId: `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

const CHANNEL = 'coop-saves';

export async function createServices(
  env: ServiceEnv,
  runDeps: RunDeps,
): Promise<GameServices> {
  const watchers = new Map<string, Set<() => void>>();
  const fire = (runId: string | null): void => {
    for (const [id, set] of watchers) {
      if (runId === null || id === runId) for (const fn of [...set]) fn();
    }
  };

  let saves: SaveStore | null = null;
  let finished: FinishedRuns | null = null;
  let storage: StorageKind = 'memory';
  let channel: BroadcastLike | null = null;

  if (env.indexedDB !== null) {
    try {
      channel = env.broadcast === null ? null : env.broadcast(CHANNEL);
      channel?.addEventListener('message', (e) => {
        const d = e.data as { runId?: unknown; from?: unknown } | null;
        if (d !== null && typeof d === 'object' && d.from !== env.tabId) {
          fire(typeof d.runId === 'string' ? d.runId : null);
        }
      });
      const stores = await openIndexedDbStores(env.indexedDB, {
        rejectStale: true,
        onStale: (id) => {
          fire(id);
        },
        onWritten: (id) => {
          channel?.postMessage({ runId: id, from: env.tabId });
        },
      });
      saves = stores.saves;
      finished = stores.finished;
      storage = 'indexeddb';
    } catch {
      channel?.close();
      channel = null;
      saves = null;
    }
  }
  if (saves === null && env.localStorage !== null) {
    const ls = env.localStorage;
    saves = createLocalStorageSaveStore(ls, DEFAULT_PREFIX, {
      rejectStale: true,
      onStale: () => {
        fire(null);
      },
    });
    finished = createLocalFinishedRuns(ls, DEFAULT_PREFIX);
    storage = 'local';
    const savePrefix = `${DEFAULT_PREFIX}save:`;
    env.window?.addEventListener('storage', (e) => {
      const ev = e as Event & { key?: string | null; storageArea?: unknown };
      if (ev.storageArea !== ls) return;
      if (ev.key === null || ev.key === undefined) fire(null);
      else if (ev.key.startsWith(savePrefix)) {
        fire(ev.key.slice(savePrefix.length));
      }
    });
  }
  if (saves === null || finished === null) {
    saves = createMemorySaveStore();
    finished = createMemoryFinishedRuns();
    storage = 'memory';
  }

  // A save whose run already ended is about to be moved to history by
  // `initSaves`; keep its final state first so the Run over screen can open it.
  try {
    for (const item of await saves.list()) {
      if (item.corrupt || item.summary.outcome === null) continue;
      const shape = checkSaveShape(await saves.get(item.runId));
      if (shape.ok) {
        await finished.put({
          runId: item.runId,
          state: shape.record.state,
          finishedAt: env.now(),
        });
      }
    }
  } catch {
    // Best effort: the run is recorded in history either way.
  }
  const init = await initSaves(saves, INSTALLED_VERSION, env.now());
  return {
    saves,
    finished,
    storage,
    deps: runDeps,
    init,
    watch(runId, onChange) {
      let set = watchers.get(runId);
      if (set === undefined) {
        set = new Set();
        watchers.set(runId, set);
      }
      set.add(onChange);
      return () => {
        set.delete(onChange);
      };
    },
  };
}

let servicesPromise: Promise<GameServices> | null = null;

/** The page's services, created once. */
export function getServices(): Promise<GameServices> {
  servicesPromise ??= createServices(browserEnv(), gameDeps());
  return servicesPromise;
}
