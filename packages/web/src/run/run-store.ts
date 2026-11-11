/**
 * The one run store behind every run screen.
 *
 * `runStore` holds the run that the page shows: a `RunController` (through the
 * `BuildSession` the Build and Shop tabs already use) over the real rules and
 * the saved-run store. Every screen reads the run state from this one place
 * and changes it only by dispatching intents, so a screen never has a private
 * copy of it. The step of the run decides which screen shows (`router.ts`).
 *
 * A run that has ended has no save any more (the session controller moves it
 * to history). Its final state is kept apart (`finished.ts`) so the Run over
 * screen still opens after a reload.
 */
import {
  openRun,
  startRun,
  type HistoryEntry,
  type RunController,
  type RunState,
} from '@game/session';
import { createStore, type Store } from '../app-state.js';
import { BuildSession } from '../build/session.js';
import type { RunHandle } from './handle.js';
import { STALE_MESSAGE } from './local-storage-store.js';
import { getServices, type GameServices } from './services.js';
import { INSTALLED_VERSION, RUN_VERSION } from './version.js';

export interface ActiveRun extends RunHandle {
  /** True when the run was saved by an older minor version (prompt first). */
  readonly versionNotice: boolean;
  /** Stop listening for changes from other tabs. */
  dispose(): void;
}

export type RunScreenState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly runId: string }
  | { readonly status: 'ready'; readonly run: ActiveRun }
  /** The run ended and its final state was kept. */
  | {
      readonly status: 'over';
      readonly runId: string;
      readonly state: RunState;
    }
  /** The run ended but its final state is not kept (only its history entry). */
  | {
      readonly status: 'ended';
      readonly runId: string;
      readonly entry: HistoryEntry | null;
    }
  | { readonly status: 'missing'; readonly runId: string }
  /** A save exists but cannot be opened. It is never deleted for you. */
  | {
      readonly status: 'blocked';
      readonly runId: string;
      readonly reason: string;
      readonly message: string;
    }
  | {
      readonly status: 'error';
      readonly runId: string;
      readonly message: string;
    };

export const runStore: Store<RunScreenState> = createStore<RunScreenState>({
  status: 'idle',
});

/** Plain words for why a saved run could not be opened. */
export function describeUnopenable(
  reason: string,
  errors: readonly string[] = [],
): string {
  switch (reason) {
    case 'corrupt':
      return errors.some((e) => /format ?version/i.test(e))
        ? 'This run was saved in a format this version of the game cannot read.'
        : 'This saved run is damaged and cannot be read.';
    case 'unsupported_format':
      return 'This run was saved in a format this version of the game cannot read.';
    case 'newer':
      return 'This run was made by a newer version of the game. Open the newer version to continue it.';
    case 'older_major':
      return 'This run was made by an older version of the game that is no longer supported.';
    case 'load_failed':
      return 'The browser could not read the saved run from storage.';
    case 'not_found':
      return 'This run is not saved any more.';
    default:
      return 'This saved run could not be opened.';
  }
}

/** Runs whose "older version" prompt the player already answered this session. */
const acknowledged = new Set<string>();

export function acknowledgeVersionNotice(runId: string): void {
  acknowledged.add(runId);
}

export function needsVersionPrompt(run: ActiveRun): boolean {
  return run.versionNotice && !acknowledged.has(run.runId);
}

function activate(
  controller: RunController,
  services: GameServices,
  versionNotice: boolean,
): ActiveRun {
  const runId = controller.runId;
  const conflict = createStore<boolean>(false);
  let session: BuildSession | null = null;
  const markConflict = (): void => {
    session?.lock(STALE_MESSAGE);
    conflict.set(true);
  };
  const stopWatching = services.watch(runId, markConflict);
  session = BuildSession.fromController(controller);
  return {
    session,
    deps: services.deps,
    runId,
    storage: services.storage,
    conflict,
    versionNotice,
    dispose: () => {
      stopWatching();
    },
  };
}

async function keepFinished(
  services: GameServices,
  state: RunState,
): Promise<void> {
  try {
    await services.finished.put({
      runId: state.runId,
      state,
      finishedAt: Date.now(),
    });
  } catch {
    // The run is in history either way; only the final screen is lost.
  }
}

let loadToken = 0;

function currentRun(): ActiveRun | null {
  const s = runStore.get();
  return s.status === 'ready' ? s.run : null;
}

/** Drop the open run (leaving for the menu): the saved copy is the truth. */
export function closeRun(): void {
  loadToken += 1;
  currentRun()?.dispose();
  runStore.set({ status: 'idle' });
}

/**
 * Show the run `runId`: open it from the saved runs, or, if it has ended, from
 * the kept final state. Does nothing if that run is already open and in step
 * with its save. `fresh` opens it again regardless.
 */
export async function showRun(
  runId: string,
  options: { readonly fresh?: boolean } = {},
): Promise<void> {
  const now = runStore.get();
  if (options.fresh !== true) {
    if (now.status === 'ready' && now.run.runId === runId) {
      if (!now.run.conflict.get()) return;
    } else if (now.status !== 'idle' && 'runId' in now) {
      if (now.runId === runId && now.status !== 'error') return;
    }
  }
  const token = ++loadToken;
  currentRun()?.dispose();
  runStore.set({ status: 'loading', runId });
  const stale = (): boolean => token !== loadToken;
  let services: GameServices;
  try {
    services = await getServices();
  } catch (e) {
    if (!stale()) {
      runStore.set({
        status: 'error',
        runId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }
  const opened = await openRun(
    runId,
    services.deps,
    services.saves,
    INSTALLED_VERSION,
  );
  if (stale()) {
    if (opened.ok) {
      // Nothing was written; the controller is simply dropped.
    }
    return;
  }
  if (opened.ok) {
    runStore.set({
      status: 'ready',
      run: activate(opened.controller, services, opened.versionNotice),
    });
    return;
  }
  if (opened.reason === 'not_found') {
    const kept = await services.finished.get(runId).catch(() => null);
    if (stale()) return;
    if (kept !== null) {
      runStore.set({ status: 'over', runId, state: kept.state });
      return;
    }
    const history = await services.saves.listHistory().catch(() => []);
    if (stale()) return;
    const entry = history.find((h) => h.runId === runId) ?? null;
    runStore.set(
      entry === null
        ? { status: 'missing', runId }
        : { status: 'ended', runId, entry },
    );
    return;
  }
  runStore.set({
    status: 'blocked',
    runId,
    reason: opened.reason,
    message: describeUnopenable(opened.reason, opened.errors ?? []),
  });
}

/** Open the run again from its save (after a change in another tab). */
export function reloadRun(runId: string): Promise<void> {
  return showRun(runId, { fresh: true });
}

/** A new random seed (the only place the game asks the browser for one). */
export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] as number;
}

/** A run id that is not used by any saved or finished run. */
export function newRunId(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `run-${Date.now().toString(36)}-${(a[0] as number).toString(36)}`;
}

export type NewRunResult =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly message: string };

/** Start a solo run and make it the open one. The caller then goes to its route. */
export async function createNewRun(seed?: number): Promise<NewRunResult> {
  let services: GameServices;
  try {
    services = await getServices();
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Storage is not available.',
    };
  }
  const useSeed = seed ?? randomSeed();
  const r = await startRun(
    {
      runId: newRunId(),
      runVersion: RUN_VERSION,
      seed: useSeed,
      players: ['You'],
      host: 0,
    },
    services.deps,
    services.saves,
    Date.now(),
    INSTALLED_VERSION,
  );
  if (!r.ok) {
    return {
      ok: false,
      message:
        r.reason === 'save_failed'
          ? 'The new run could not be saved, so it was not started.'
          : `The run could not be started (${r.reason}).`,
    };
  }
  loadToken += 1;
  currentRun()?.dispose();
  runStore.set({
    status: 'ready',
    run: activate(r.controller, services, false),
  });
  return { ok: true, runId: r.controller.runId };
}

export type AbandonResult =
  | { readonly ok: true; readonly state: RunState | null }
  | { readonly ok: false; readonly message: string };

/** What to tell the player when storage could not be read (nothing is removed). */
export const RETRY_MESSAGE =
  'The browser could not read the saved run just now, so nothing was changed. Try again in a moment.';

/**
 * Abandon a saved run from the menu: the host's `abandon` intent, so the run
 * ends on the same Run over screen as any other (`state` is its final state).
 * Only a run that can be opened is abandoned. A save that cannot be opened is
 * never removed here (use `discardSavedRun`, the "Remove save" action), and
 * nothing is removed when storage merely failed to read it (`load_failed`).
 */
export async function abandonSavedRun(runId: string): Promise<AbandonResult> {
  const services = await getServices();
  closeRun();
  const opened = await openRun(
    runId,
    services.deps,
    services.saves,
    INSTALLED_VERSION,
  );
  if (!opened.ok) {
    if (opened.reason === 'load_failed') {
      return { ok: false, message: RETRY_MESSAGE };
    }
    if (opened.reason === 'not_found') {
      return { ok: false, message: 'That run is already gone.' };
    }
    return {
      ok: false,
      message: `${describeUnopenable(opened.reason, opened.errors ?? [])} It cannot be abandoned; use Remove save to delete it.`,
    };
  }
  const r = await opened.controller.dispatch(
    opened.controller.state.host,
    { type: 'abandon' },
    Date.now(),
  );
  if (!r.ok) {
    return {
      ok: false,
      message:
        r.reason === 'save_failed'
          ? 'The run could not be saved, so it was not abandoned.'
          : `The run could not be abandoned (${r.reason}).`,
    };
  }
  // Normally written already (the save store keeps it before removing the
  // save); this covers a finish that was left incomplete.
  await keepFinished(services, r.state);
  return { ok: true, state: r.state };
}

/**
 * Remove a save that cannot be opened (damaged, another format or version),
 * with no summary and no record. Refuses a save that can be opened (that is
 * Abandon's job) and removes nothing when storage failed to read it.
 */
export async function discardSavedRun(runId: string): Promise<AbandonResult> {
  const services = await getServices();
  closeRun();
  const opened = await openRun(
    runId,
    services.deps,
    services.saves,
    INSTALLED_VERSION,
  );
  if (opened.ok) {
    return {
      ok: false,
      message: 'This run can be opened, so it is abandoned, not removed.',
    };
  }
  if (opened.reason === 'load_failed') {
    return { ok: false, message: RETRY_MESSAGE };
  }
  try {
    // Straight from the store: no history entry, so no record of the run.
    await services.saves.remove(runId);
    return { ok: true, state: null };
  } catch {
    return { ok: false, message: 'The saved run could not be removed.' };
  }
}
