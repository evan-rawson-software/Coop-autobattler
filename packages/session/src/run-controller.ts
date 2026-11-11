/**
 * The run controller (W2-4): the only way the app touches a run.
 *
 * Every accepted intent is saved BEFORE the caller sees its result (CP-23a),
 * so loading a save can never undo a purchase, a re-roll or a battle. The
 * controller keeps the committed state; if a save fails it does not advance.
 *
 * Time is passed in (`now`, an integer); this module has no clock.
 */
import { applyIntent, createRun } from './machine.js';
import {
  buildSaveRecord,
  checkSaveShape,
  classifySave,
  hasUnsupportedFormat,
  historyEntryFor,
  type HistoryReason,
  type SaveStore,
} from './save.js';
import type {
  CreateRunArgs,
  Effect,
  Intent,
  RejectReason,
  RunDeps,
  RunState,
} from './types.js';

export type DispatchResult =
  | {
      readonly ok: true;
      readonly state: RunState;
      readonly effects: readonly Effect[];
      /**
       * Set when the run ended and saved, but recording it in history or
       * removing the save failed. `initSaves` finishes the job at next start.
       */
      readonly warning?: 'finish_incomplete';
    }
  | {
      readonly ok: false;
      /** A rule rejection from `applyIntent`, or `save_failed`. */
      readonly reason: RejectReason | 'save_failed';
      readonly detail?: string;
    };

export interface RunController {
  readonly runId: string;
  /** The last committed state (saved). */
  readonly state: RunState;
  /**
   * Apply one intent and save it. Calls are queued: a dispatch made while
   * another is in flight waits for it, so counters and saves stay in order.
   * On `save_failed` the state is unchanged and the intent can be retried.
   */
  dispatch(
    player: number,
    intent: Intent,
    now: number,
  ): Promise<DispatchResult>;
}

/** Record a finished run in history, then remove its save, in that order. */
async function finishRun(
  store: SaveStore,
  state: RunState,
  reason: HistoryReason,
  now: number,
): Promise<void> {
  await store.appendHistory(historyEntryFor(state, reason, now));
  await store.remove(state.runId);
}

function makeController(
  createArgs: CreateRunArgs,
  initial: RunState,
  deps: RunDeps,
  store: SaveStore,
  installedVersion: string,
): RunController {
  let current = initial;
  let tail: Promise<unknown> = Promise.resolve();

  async function run(
    player: number,
    intent: Intent,
    now: number,
  ): Promise<DispatchResult> {
    const r = applyIntent(current, player, intent, deps);
    if (!r.ok) {
      return r.detail === undefined
        ? { ok: false, reason: r.reason }
        : { ok: false, reason: r.reason, detail: r.detail };
    }
    // A signature (a later phase) would cover the old state, so a rewritten
    // record carries none; signing happens on write in that phase.
    const record = buildSaveRecord(createArgs, r.state, installedVersion, now);
    try {
      await store.put(record);
    } catch (e) {
      return {
        ok: false,
        reason: 'save_failed',
        detail:
          e instanceof Error ? e.message : 'the save could not be written',
      };
    }
    current = r.state;
    if (r.state.outcome !== null) {
      try {
        await finishRun(store, r.state, r.state.outcome.reason, now);
      } catch {
        return {
          ok: true,
          state: r.state,
          effects: r.effects,
          warning: 'finish_incomplete',
        };
      }
    }
    return { ok: true, state: r.state, effects: r.effects };
  }

  return {
    runId: initial.runId,
    get state(): RunState {
      return current;
    },
    dispatch(player, intent, now) {
      const result = tail.then(() => run(player, intent, now));
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// startRun

export type StartRunResult =
  | { readonly ok: true; readonly controller: RunController }
  | {
      readonly ok: false;
      readonly reason: 'run_exists' | 'invalid_args' | 'save_failed';
      readonly detail?: string;
    };

/**
 * Create a run and save it at once. Rejects with `run_exists` if the store
 * already holds a record for `createArgs.runId` (or a finished run used it):
 * a run is saved once, under one ID (CP-22a).
 */
export async function startRun(
  createArgs: CreateRunArgs,
  deps: RunDeps,
  store: SaveStore,
  now: number,
  installedVersion: string,
): Promise<StartRunResult> {
  const created = createRun(createArgs, deps);
  if (!created.ok) {
    return { ok: false, reason: 'invalid_args', detail: created.detail };
  }
  try {
    const id = createArgs.runId;
    if ((await store.get(id)) !== null) {
      return { ok: false, reason: 'run_exists' };
    }
    if ((await store.listHistory()).some((h) => h.runId === id)) {
      return {
        ok: false,
        reason: 'run_exists',
        detail: 'a finished run used this ID',
      };
    }
    await store.put(
      buildSaveRecord(createArgs, created.state, installedVersion, now),
    );
  } catch (e) {
    return {
      ok: false,
      reason: 'save_failed',
      detail: e instanceof Error ? e.message : 'the save could not be written',
    };
  }
  return {
    ok: true,
    controller: makeController(
      createArgs,
      created.state,
      deps,
      store,
      installedVersion,
    ),
  };
}

// ---------------------------------------------------------------------------
// openRun

export type OpenRunResult =
  | {
      readonly ok: true;
      readonly controller: RunController;
      /** The run is from an older minor version: tell the player (CP-23e). */
      readonly versionNotice: boolean;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_found'
        | 'corrupt'
        | 'unsupported_format'
        | 'newer'
        | 'older_major'
        | 'load_failed';
      /** For `corrupt`: why. The record is left in the store. */
      readonly errors?: readonly string[];
    };

/**
 * Load a saved run, validate it and continue from the stored state. Nothing
 * stored is recomputed: offers and battle results are in the state as
 * outcomes, so the current rules only apply from the next roll or battle on.
 */
export async function openRun(
  runId: string,
  deps: RunDeps,
  store: SaveStore,
  installedVersion: string,
): Promise<OpenRunResult> {
  let raw: unknown;
  try {
    raw = await store.get(runId);
  } catch {
    return { ok: false, reason: 'load_failed' };
  }
  if (raw === null || raw === undefined)
    return { ok: false, reason: 'not_found' };
  // One classification shared with `initSaves` (see `classifySave`): shape,
  // the key, the game version (before validation: a save from a newer game
  // can fail validation and is then "newer", not "corrupt"), the state
  // format, and only then the state itself.
  const c = classifySave(raw, runId, installedVersion, deps);
  switch (c.kind) {
    case 'corrupt':
      return { ok: false, reason: 'corrupt', errors: c.errors };
    case 'newer':
    case 'older_major':
    case 'unsupported_format':
      return { ok: false, reason: c.kind };
    case 'open':
      return {
        ok: true,
        versionNotice: c.version === 'older_minor',
        controller: makeController(
          c.record.createArgs,
          c.record.state,
          deps,
          store,
          installedVersion,
        ),
      };
  }
}

// ---------------------------------------------------------------------------
// removeRun

export type RemoveRunResult =
  | { readonly ok: true; readonly recorded: boolean }
  | { readonly ok: false; readonly reason: 'not_found' | 'failed' };

/**
 * Take a run out of the saved list (CP-23f). For the host this abandons it:
 * it goes into history as `abandoned` (or with its own outcome if it had
 * already ended). A record too damaged to read is removed without a history
 * entry (`recorded: false`).
 */
export async function removeRun(
  store: SaveStore,
  runId: string,
  now: number,
): Promise<RemoveRunResult> {
  try {
    const raw = await store.get(runId);
    if (raw === null || raw === undefined) {
      return { ok: false, reason: 'not_found' };
    }
    const shape = checkSaveShape(raw);
    if (!shape.ok) {
      await store.remove(runId);
      return { ok: true, recorded: false };
    }
    const state = shape.record.state;
    const reason: HistoryReason =
      state.outcome === null ? 'abandoned' : state.outcome.reason;
    await finishRun(store, { ...state, runId }, reason, now);
    return { ok: true, recorded: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

// ---------------------------------------------------------------------------
// initSaves

export interface InitSavesResult {
  /** Older-major saves that were deleted (TA-9), with the round reached. */
  readonly wiped: readonly {
    readonly runId: string;
    readonly runVersion: string;
    readonly round: number;
    readonly hostName: string;
  }[];
  /** Saves whose run had already ended, now recorded and removed. */
  readonly finished: readonly string[];
  /** Saves from a newer version: left alone, not openable. */
  readonly newer: readonly {
    readonly runId: string;
    readonly runVersion: string;
  }[];
  /**
   * Well-formed saves whose run state has a format this build cannot read:
   * left alone (never finished into history, never wiped, whatever their game
   * version or outcome) because their state cannot be trusted.
   */
  readonly unsupported: readonly {
    readonly runId: string;
    readonly runVersion: string;
  }[];
  /**
   * Stored values that do not parse or validate, including an older-major
   * save whose state does not validate (so it cannot be safely wiped): left
   * alone. (An older-major save whose state has an unknown format version is
   * listed in `unsupported` instead.)
   */
  readonly corrupt: readonly {
    readonly runId: string;
    readonly errors: readonly string[];
  }[];
  /** Saves that could not be handled because the store failed. */
  readonly failed: readonly string[];
}

/**
 * Run once at app start. Every stored save is classified with the same
 * function as `openRun` (`classifySave`), and only what that has fully read
 * is touched: a save whose run has ended is recorded in history and removed,
 * and a save from an older major version is deleted (recorded as
 * `version_wiped`), but only when its state also validates against this
 * build. Saves from a newer version, ones whose state format this build
 * cannot read, and damaged ones are left in place and reported in `newer`,
 * `unsupported` and `corrupt`. An older-major save whose state does not
 * validate is such a case too: `openRun` says `older_major` (the version is
 * classified first), `initSaves` leaves it and reports it as `unsupported`
 * (unknown state format) or `corrupt`. Safe to run again after an interruption:
 * history entries are unique per run.
 */
export async function initSaves(
  store: SaveStore,
  installedVersion: string,
  now: number,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules'>,
): Promise<InitSavesResult> {
  const wiped: InitSavesResult['wiped'][number][] = [];
  const finished: string[] = [];
  const newer: InitSavesResult['newer'][number][] = [];
  const unsupported: InitSavesResult['unsupported'][number][] = [];
  const corrupt: InitSavesResult['corrupt'][number][] = [];
  const failed: string[] = [];

  for (const item of await store.list()) {
    const runId = item.runId;
    try {
      const raw = await store.get(runId);
      const c = classifySave(raw, runId, installedVersion, deps);
      switch (c.kind) {
        case 'corrupt':
          corrupt.push({ runId, errors: c.errors });
          break;
        case 'newer':
          newer.push({ runId, runVersion: c.record.runVersion });
          break;
        case 'unsupported_format':
          unsupported.push({ runId, runVersion: c.record.runVersion });
          break;
        case 'older_major': {
          if (!c.validation.ok) {
            // Unreadable: leave it, and say why (a state format this build
            // does not know is "unsupported", anything else "corrupt").
            if (hasUnsupportedFormat(c.record)) {
              unsupported.push({ runId, runVersion: c.record.runVersion });
            } else {
              corrupt.push({ runId, errors: c.validation.errors });
            }
            break;
          }
          const state = c.validation.record.state;
          if (state.outcome !== null) {
            await finishRun(store, state, state.outcome.reason, now);
            finished.push(runId);
          } else {
            await finishRun(store, state, 'version_wiped', now);
            wiped.push({
              runId,
              runVersion: c.record.runVersion,
              round: state.round,
              hostName: c.record.hostName,
            });
          }
          break;
        }
        case 'open':
          if (c.record.state.outcome !== null) {
            await finishRun(
              store,
              c.record.state,
              c.record.state.outcome.reason,
              now,
            );
            finished.push(runId);
          }
          break;
      }
    } catch {
      failed.push(runId);
    }
  }
  return { wiped, finished, newer, unsupported, corrupt, failed };
}
