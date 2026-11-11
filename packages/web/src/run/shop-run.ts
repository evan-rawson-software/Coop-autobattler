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
import {
  browserStorage,
  createLocalStorageSaveStore,
} from './local-storage-store.js';

/** The version recorded in saves written by this prototype. */
const RUN_VERSION = '0.1';
const INSTALLED_VERSION = '0.1.0';

export interface ShopRun {
  readonly session: BuildSession;
  readonly deps: RunDeps;
  readonly runId: string;
  readonly next: NextBattle;
  /** Where the run is saved. */
  readonly storage: 'local' | 'memory';
  /** True when the run was opened from a save rather than set up now. */
  readonly restored: boolean;
}

export interface ShopRunOptions {
  readonly next?: NextBattle;
  readonly seed?: number;
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

function chooseStore(): { store: SaveStore; storage: 'local' | 'memory' } {
  const ls = browserStorage();
  return ls === null
    ? { store: createMemorySaveStore(), storage: 'memory' }
    : { store: createLocalStorageSaveStore(ls), storage: 'local' };
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
 * Open the saved sample run, or set a new one up. `fresh` discards a saved
 * one first. A save that cannot be opened is replaced.
 */
export async function loadShopRun(
  options: ShopRunOptions & { readonly fresh?: boolean } = {},
): Promise<ShopRun> {
  const next = options.next ?? 'pvp';
  const seed = options.seed ?? 11;
  const runId = shopRunId(next);
  const deps = createShopDeps();
  const { store, storage } = chooseStore();
  if (options.fresh === true) await store.remove(runId);

  const opened = await openRun(runId, deps, store, INSTALLED_VERSION);
  if (opened.ok) {
    return {
      session: BuildSession.fromController(opened.controller),
      deps,
      runId,
      next,
      storage,
      restored: true,
    };
  }
  if (opened.reason !== 'not_found') await store.remove(runId);
  const controller = await create(runId, seed, next, deps, store);
  return {
    session: BuildSession.fromController(controller),
    deps,
    runId,
    next,
    storage,
    restored: false,
  };
}

// ---------------------------------------------------------------------------
// The module-level holder the screens share

export type ShopRunState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly run: ShopRun }
  | { readonly status: 'error'; readonly message: string };

export const shopRunStore: Store<ShopRunState> = createStore<ShopRunState>({
  status: 'loading',
});

let loading: Promise<void> | null = null;

/** Load the shared run once; later calls return the same load. */
export function ensureShopRun(options?: ShopRunOptions): Promise<void> {
  if (shopRunStore.get().status === 'ready') return Promise.resolve();
  loading ??= loadShopRun(options)
    .then((run) => {
      shopRunStore.set({ status: 'ready', run });
    })
    .catch((e: unknown) => {
      shopRunStore.set({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Discard the saved sample run and set up a new one. */
export async function restartShopRun(options?: ShopRunOptions): Promise<void> {
  shopRunStore.set({ status: 'loading' });
  try {
    const run = await loadShopRun({ ...options, fresh: true });
    shopRunStore.set({ status: 'ready', run });
  } catch (e) {
    shopRunStore.set({
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
