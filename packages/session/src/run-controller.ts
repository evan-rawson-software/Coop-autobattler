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
  hasUnsupportedFormat,
  historyEntryFor,
  parseSaveRecord,
  type HistoryReason,
  type SaveRecord,
  type SaveStore,
} from './save.js';
import { classify } from './version.js';
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
  // A well-formed record whose run state has another format version is not
  // damaged: say so (after a newer or much older game version, which are
  // more useful to report).
  const shape = checkSaveShape(raw);
  if (shape.ok && hasUnsupportedFormat(shape.record)) {
    const kind = classify(shape.record.runVersion, installedVersion);
    if (kind === 'newer') return { ok: false, reason: 'newer' };
    if (kind === 'older_major') return { ok: false, reason: 'older_major' };
    return { ok: false, reason: 'unsupported_format' };
  }
  const parsed = parseSaveRecord(raw, deps);
  if (!parsed.ok)
    return { ok: false, reason: 'corrupt', errors: parsed.errors };
  const record = parsed.record;
  if (record.runId !== runId) {
    return {
      ok: false,
      reason: 'corrupt',
      errors: ['save: runId does not match the key it is stored under.'],
    };
  }
  const kind = classify(record.runVersion, installedVersion);
  if (kind === 'newer') return { ok: false, reason: 'newer' };
  if (kind === 'older_major') return { ok: false, reason: 'older_major' };
  return {
    ok: true,
    versionNotice: kind === 'older_minor',
    controller: makeController(
      record.createArgs,
      record.state,
      deps,
      store,
      installedVersion,
    ),
  };
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
  /** Stored values that do not parse: left alone. */
  readonly corrupt: readonly {
    readonly runId: string;
    readonly errors: readonly string[];
  }[];
  /** Saves that could not be handled because the store failed. */
  readonly failed: readonly string[];
}

/**
 * Run once at app start. Finishes off ended runs, deletes saves from an older
 * major version (recording them as `version_wiped`), and reports saves from a
 * newer version and damaged ones without touching them. Safe to run again
 * after an interruption: history entries are unique per run.
 */
export async function initSaves(
  store: SaveStore,
  installedVersion: string,
  now: number,
): Promise<InitSavesResult> {
  const wiped: InitSavesResult['wiped'][number][] = [];
  const finished: string[] = [];
  const newer: InitSavesResult['newer'][number][] = [];
  const corrupt: InitSavesResult['corrupt'][number][] = [];
  const failed: string[] = [];

  for (const item of await store.list()) {
    if (item.corrupt) {
      corrupt.push({ runId: item.runId, errors: item.errors });
      continue;
    }
    try {
      const kind = classify(item.runVersion, installedVersion);
      const raw = await store.get(item.runId);
      const shape = checkSaveShape(raw);
      if (!shape.ok) {
        corrupt.push({ runId: item.runId, errors: shape.errors });
        continue;
      }
      const record: SaveRecord = shape.record;
      const state = { ...record.state, runId: item.runId };
      if (state.outcome !== null) {
        await finishRun(store, state, state.outcome.reason, now);
        finished.push(item.runId);
      } else if (kind === 'older_major') {
        await finishRun(store, state, 'version_wiped', now);
        wiped.push({
          runId: item.runId,
          runVersion: record.runVersion,
          round: state.round,
          hostName: record.hostName,
        });
      } else if (kind === 'newer') {
        newer.push({ runId: item.runId, runVersion: record.runVersion });
      }
    } catch {
      failed.push(item.runId);
    }
  }
  return { wiped, finished, newer, corrupt, failed };
}
