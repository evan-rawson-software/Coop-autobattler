/**
 * The one shared run behind the Shop and Build tabs of the shop step.
 *
 * Both tabs hold the same `BuildSession` (a `RunController` plus the layout
 * undo stack), so nothing is copied between tabs and every accepted intent is
 * saved before the screen sees it. Reload: the run is opened again from the
 * `SaveStore` (here `localStorage`).
 *
 * #25 replaces this module's `loadShopRun` with the real run flow (a run
 * chosen in the main menu, a store shared with the other screens). The
 * screens only need a `ShopRun`: `{ session, deps }`.
 */
import {
  createGameDeps,
  createMemorySaveStore,
  fixedBattle,
  openRun,
  startRun,
  type RunController,
  type RunDeps,
  type SaveStore,
} from '@game/session';
import { createStore, type Store } from '../app-state.js';
import { BuildSession } from '../build/session.js';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import { driveToShop, type NextBattle } from './drive.js';
import { INSTALLED_VERSION, RUN_VERSION } from './version.js';
import {
  browserStorage,
  createLocalStorageSaveStore,
  DEFAULT_PREFIX,
  saveKey,
  STALE_MESSAGE,
  usableStorage,
  watchSaveKey,
  type StorageLike,
} from './local-storage-store.js';

export interface ShopRun {
  readonly session: BuildSession;
  readonly deps: RunDeps;
  readonly runId: string;
  readonly next: NextBattle;
  /** Where the run is saved. */
  readonly storage: 'local' | 'memory';
  /** True when the run was opened from a save rather than set up now. */
  readonly restored: boolean;
  /** True once the save changed in another tab; the session then refuses actions. */
  readonly conflict: Store<boolean>;
  /** Stop listening for changes from other tabs. */
  dispose(): void;
}

export interface ShopRunOptions {
  readonly next?: NextBattle;
  readonly seed?: number;
  /** Storage to use instead of `localStorage` (tests); null means none. */
  readonly storage?: StorageLike | null;
}

/** A saved run exists but `openRun` refused it. It is never deleted for you. */
export class UnopenableRunError extends Error {
  constructor(
    readonly reason: string,
    readonly errors: readonly string[],
  ) {
    super(describeUnopenable(reason, errors));
    this.name = 'UnopenableRunError';
  }
}

/** Plain words for why a saved run could not be opened. */
export function describeUnopenable(
  reason: string,
  errors: readonly string[] = [],
): string {
  switch (reason) {
    case 'corrupt':
      return errors.some((e) => /format ?version/i.test(e))
        ? 'The saved run was written in a format this version of the game cannot read.'
        : 'The saved run is damaged and cannot be read.';
    case 'newer':
      return 'The saved run was made by a newer version of the game.';
    case 'older_major':
      return 'The saved run was made by an older version of the game that is no longer supported.';
    case 'load_failed':
      return 'The browser could not read the saved run from storage.';
    default:
      return 'The saved run could not be opened.';
  }
}

/**
 * Deterministic setup: real rules, but every battle resolves as a win, so the
 * run reaches the shop the same way every time.
 */
export function createShopDeps(): RunDeps {
  return createGameDeps(content, gameConfigs, { battle: fixedBattle(true) });
}

export function shopRunId(next: NextBattle): string {
  return `shop-sample-${next}`;
}

/** Options from the page URL: `?next=pve|pvp` and `?seed=<n>`. */
export function optionsFromUrl(search: string): ShopRunOptions {
  const q = new URLSearchParams(search);
  const next = q.get('next') === 'pve' ? 'pve' : 'pvp';
  const seedText = q.get('seed');
  const n = seedText === null ? NaN : Math.floor(Number(seedText));
  return Number.isFinite(n) && n >= 0 && n <= 0xffffffff
    ? { next, seed: n }
    : { next };
}

function chooseStore(
  provided: StorageLike | null | undefined,
  onStale: () => void,
): {
  store: SaveStore;
  storage: 'local' | 'memory';
  raw: StorageLike | null;
} {
  const ls = provided === undefined ? browserStorage() : usableOrNull(provided);
  return ls === null
    ? { store: createMemorySaveStore(), storage: 'memory', raw: null }
    : {
        store: createLocalStorageSaveStore(ls, DEFAULT_PREFIX, {
          rejectStale: true,
          onStale,
        }),
        storage: 'local',
        raw: ls,
      };
}

function usableOrNull(s: StorageLike | null): StorageLike | null {
  return s === null ? null : usableStorage(s);
}

async function create(
  runId: string,
  seed: number,
  next: NextBattle,
  deps: RunDeps,
  store: SaveStore,
): Promise<RunController> {
  const r = await startRun(
    { runId, runVersion: RUN_VERSION, seed, players: ['You'], host: 0 },
    deps,
    store,
    Date.now(),
    INSTALLED_VERSION,
  );
  if (!r.ok) throw new Error(`Could not start the run: ${r.reason}`);
  const session = BuildSession.fromController(r.controller);
  await driveToShop(
    () => session.run,
    (i) => session.dispatch(i),
    { next },
  );
  return r.controller;
}

/**
 * Open the saved sample run, or set a new one up when there is none. `fresh`
 * discards a saved one first (only ever on the player's say-so). A save that
 * cannot be opened is never deleted here: this throws `UnopenableRunError`.
 */
export async function loadShopRun(
  options: ShopRunOptions & { readonly fresh?: boolean } = {},
): Promise<ShopRun> {
  const next = options.next ?? 'pvp';
  const seed = options.seed ?? 11;
  const runId = shopRunId(next);
  const deps = createShopDeps();
  const conflict = createStore<boolean>(false);
  let session: BuildSession | null = null;
  const markConflict = (): void => {
    session?.lock(STALE_MESSAGE);
    conflict.set(true);
  };
  const { store, storage, raw } = chooseStore(options.storage, markConflict);
  if (options.fresh === true) await store.remove(runId);

  const opened = await openRun(runId, deps, store, INSTALLED_VERSION);
  let controller: RunController;
  let restored: boolean;
  if (opened.ok) {
    controller = opened.controller;
    restored = true;
  } else if (opened.reason === 'not_found') {
    controller = await create(runId, seed, next, deps, store);
    restored = false;
  } else {
    throw new UnopenableRunError(opened.reason, opened.errors ?? []);
  }
  session = BuildSession.fromController(controller);
  let stop: (() => void) | null = null;
  if (raw !== null && typeof window !== 'undefined') {
    stop = watchSaveKey(window, raw, saveKey(runId), markConflict);
  }
  return {
    session,
    deps,
    runId,
    next,
    storage,
    restored,
    conflict,
    dispose: () => {
      stop?.();
      stop = null;
    },
  };
}

// ---------------------------------------------------------------------------
// The module-level holder the screens share

export type ShopRunState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly run: ShopRun }
  /** A save exists but cannot be opened; the player decides what happens. */
  | {
      readonly status: 'unopenable';
      readonly reason: string;
      readonly message: string;
    }
  | { readonly status: 'error'; readonly message: string };

export const shopRunStore: Store<ShopRunState> = createStore<ShopRunState>({
  status: 'loading',
});

let loading: Promise<void> | null = null;

function failure(e: unknown): ShopRunState {
  if (e instanceof UnopenableRunError) {
    return { status: 'unopenable', reason: e.reason, message: e.message };
  }
  return {
    status: 'error',
    message: e instanceof Error ? e.message : String(e),
  };
}

function current(): ShopRun | null {
  const st = shopRunStore.get();
  return st.status === 'ready' ? st.run : null;
}

async function replaceRun(
  options: (ShopRunOptions & { readonly fresh?: boolean }) | undefined,
): Promise<void> {
  current()?.dispose();
  shopRunStore.set({ status: 'loading' });
  try {
    shopRunStore.set({
      status: 'ready',
      run: await loadShopRun(options),
    });
  } catch (e) {
    shopRunStore.set(failure(e));
  }
}

function start(
  options: (ShopRunOptions & { readonly fresh?: boolean }) | undefined,
): Promise<void> {
  const p = replaceRun(options).finally(() => {
    if (loading === p) loading = null;
  });
  loading = p;
  return p;
}

/** Load the shared run once; later calls return the same load. */
export function ensureShopRun(options?: ShopRunOptions): Promise<void> {
  if (loading !== null) return loading;
  if (shopRunStore.get().status !== 'loading') return Promise.resolve();
  return start(options);
}

/** Open the run again from the store (after a change in another tab). */
export function reloadShopRun(options?: ShopRunOptions): Promise<void> {
  return start(options);
}

/** Discard the saved sample run and set up a new one. */
export function restartShopRun(options?: ShopRunOptions): Promise<void> {
  return start({ ...options, fresh: true });
}
