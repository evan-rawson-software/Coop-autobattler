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
  createGameDeps,
  createMemorySaveStore,
  ghostContext,
  initSaves,
  layerGhostStores,
  type GhostStore,
  type InitSavesResult,
  type RunDeps,
  type SaveStore,
} from '@game/session';
import { ghostMaxSerializedSize } from '@game/core';
import { createStore, type Store } from '../app-state.js';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import {
  createLocalFinishedRuns,
  createMemoryFinishedRuns,
  type FinishedRuns,
} from './finished.js';
import { finishFirst } from './finish-first.js';
import {
  installOwnerId,
  openGhostStore,
  ownerLabelFor,
  type GhostStorageKind,
} from './ghost-pool.js';
import { openIndexedDbStores } from './idb-store.js';
import {
  browserStorage,
  createLocalStorageSaveStore,
  DEFAULT_PREFIX,
  type StorageLike,
} from './local-storage-store.js';
import { loadBundledGhostStore } from './bundled-ghosts.js';
import { registerDebug } from '../debug-hook.js';
import { withForcedOpponent } from './force-opponent.js';
import { INSTALLED_VERSION, RUN_VERSION } from './version.js';

/**
 * What the player must be told about storage, shown on every screen: kept
 * apart from the services because a blocked open happens before they exist.
 */
export interface StorageStatus {
  /** Another tab holds the saves database while this tab waits to open it. */
  readonly blocked: boolean;
  /** Another tab upgraded the saves database; this tab must reload. */
  readonly reloadNeeded: boolean;
  /** Which storage is in use when it is not the preferred one, and what that means. */
  readonly fallbackNote: string | null;
}

export const storageStatus: Store<StorageStatus> = createStore<StorageStatus>({
  blocked: false,
  reloadNeeded: false,
  fallbackNote: null,
});

const STORAGE_NAMES: Readonly<Record<'local' | 'memory', string>> = {
  local: "this browser's local storage",
  memory: 'memory only (nothing is kept after the page closes)',
};

/** The note for a tab that could not use IndexedDB. */
export function fallbackText(kind: 'local' | 'memory', reason: string): string {
  return `Saves could not be opened in the browser database (${reason}). This tab is using ${STORAGE_NAMES[kind]}. Runs saved in the other storage are not shown here, and runs started here are not visible there.`;
}

export type StorageKind = 'indexeddb' | 'local' | 'memory';

export interface GameServices {
  readonly saves: SaveStore;
  readonly finished: FinishedRuns;
  readonly storage: StorageKind;
  readonly deps: RunDeps;
  /**
   * The ghost pool: the local one (W3-1; runs write their snapshots to it)
   * layered with the bundled ghosts as a read-only source (W3-2). `clear`
   * clears the local pool only.
   */
  readonly ghosts: GhostStore;
  readonly ghostStorage: GhostStorageKind;
  /** Why the preferred storage (IndexedDB) is not in use, or null. */
  readonly fallback: string | null;
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
  if (deps === null) {
    const ownerId = installOwnerId(browserStorage());
    deps = createGameDeps(content, gameConfigs, {
      ghosts: { ownerId, ownerLabel: ownerLabelFor(ownerId) },
    });
  }
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
  status: Store<StorageStatus> = storageStatus,
): Promise<GameServices> {
  const patch = (p: Partial<StorageStatus>): void => {
    status.set({ ...status.get(), ...p });
  };
  let fallback: string | null = null;
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
        onBlocked: () => {
          patch({ blocked: true });
        },
        onUnblocked: () => {
          patch({ blocked: false });
        },
        onVersionChange: () => {
          patch({ reloadNeeded: true });
        },
      });
      saves = stores.saves;
      finished = stores.finished;
      storage = 'indexeddb';
    } catch (e) {
      channel?.close();
      channel = null;
      saves = null;
      fallback = e instanceof Error ? e.message : 'unknown error';
      patch({ blocked: false });
    }
  } else {
    fallback = 'IndexedDB is not available';
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

  // A save whose run already ended is moved to history by `initSaves`; the
  // wrapper keeps its final state first, so the Run over screen can open it.
  // Removing a finished run's save always goes through it.
  saves = finishFirst(saves, finished, env.now);
  // What this tab last read or wrote per run, to tell a page restored from the
  // back/forward cache whether another tab saved meanwhile.
  const held = new Map<string, unknown>();
  const counterOf = (v: unknown): unknown =>
    typeof v === 'object' && v !== null
      ? (v as { actionCounter?: unknown }).actionCounter
      : null;
  const inner = saves;
  saves = {
    ...inner,
    async get(runId) {
      const v = await inner.get(runId);
      held.set(runId, counterOf(v));
      return v;
    },
    async put(record) {
      await inner.put(record);
      held.set(record.runId, counterOf(record));
    },
    async remove(runId) {
      await inner.remove(runId);
      held.delete(runId);
    },
  };
  const onPageShow = (e: Event): void => {
    if ((e as Event & { persisted?: boolean }).persisted !== true) return;
    for (const [runId, counter] of [...held]) {
      void inner.get(runId).then(
        (v) => {
          if (counterOf(v) !== counter) fire(runId);
        },
        () => undefined,
      );
    }
  };
  env.window?.addEventListener('pageshow', onPageShow);
  if (storage !== 'indexeddb') {
    patch({
      fallbackNote: fallbackText(storage, fallback ?? 'unavailable'),
    });
  }
  const sizeCtx = ghostContext(runDeps);
  const ghostPool = await openGhostStore({
    ...env,
    ...(sizeCtx === null
      ? {}
      : {
          maxSize: (partySize: number, round: number) =>
            ghostMaxSerializedSize(partySize, round, sizeCtx),
        }),
  });
  const init = await initSaves(saves, INSTALLED_VERSION, env.now(), runDeps);
  // Pool rows of older game versions are never listed again; drop them so
  // they stop using quota (TA-8, PP-17); newer ones are kept. A failed
  // clean-up is not an error.
  try {
    await ghostPool.store.removeOtherVersions(RUN_VERSION);
  } catch {
    // the rows only cost quota
  }
  const localPool = ghostPool.store;
  registerDebug({
    ghostPool: {
      local: async (partySize, round) =>
        (
          await localPool.list({
            gameVersion: RUN_VERSION,
            partySize,
            round,
          })
        ).map((v) => {
          const g = v as { owner?: { id?: string }; runId?: string };
          return { ownerId: g.owner?.id ?? '', runId: g.runId ?? '' };
        }),
    },
  });
  return {
    saves,
    finished,
    storage,
    fallback: storage === 'indexeddb' ? null : (fallback ?? 'unavailable'),
    deps: runDeps,
    ghosts: withForcedOpponent(
      layerGhostStores(ghostPool.store, () =>
        loadBundledGhostStore(RUN_VERSION),
      ),
    ),
    ghostStorage: ghostPool.kind,
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
