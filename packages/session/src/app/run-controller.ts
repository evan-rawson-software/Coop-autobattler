/**
 * The run controller (W2-4): the only way the app touches a run.
 *
 * Every accepted intent is saved BEFORE the caller sees its result (CP-23a),
 * so loading a save can never undo a purchase, a re-roll or a battle. The
 * controller keeps the committed state; if a save fails it does not advance.
 *
 * Time is passed in (`now`, an integer); this module has no clock.
 */
import type { GhostStore } from './ghost-store.js';
import {
  SELECT_GHOST,
  ghostBucketFor,
  ghostContext,
  presentCandidates,
  selectionPending,
} from '../rules/ghosts.js';
import { applyIntent, createRun } from '../rules/machine.js';
import {
  buildSaveRecord,
  checkSaveShape,
  classifySave,
  historyEntryFor,
  type HistoryReason,
  StaleSaveError,
  type SaveStore,
} from './save.js';
import { validateRunState } from '../rules/validate.js';
import type {
  CreateRunArgs,
  Effect,
  Intent,
  Json,
  RejectReason,
  RunDeps,
  RunState,
} from '../rules/types.js';

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
      /**
       * Set when this dispatch left the PvP opponent still to be chosen and
       * the automatic selection failed (`save_failed` or `invalid_state`):
       * the cause, which the next dispatch or `prepare` retries.
       */
      readonly selectionFailure?: SelectionFailure;
    }
  | {
      readonly ok: false;
      /**
       * A rule rejection from `applyIntent`, `save_failed`, or
       * `invalid_state`: the rules produced a state that does not pass
       * `validateRunState`. Nothing was saved, revealed or advanced; `detail`
       * has the first problems. It is a bug (or a poisoned input the rules
       * let through), never something the player can fix.
       */
      readonly reason: RejectReason | 'save_failed' | 'stale' | 'invalid_state';
      readonly detail?: string;
      /**
       * When the rejection is `ghost_selection_pending`, why the automatic
       * selection did not happen (if it was tried and failed).
       */
      readonly selectionFailure?: SelectionFailure;
    };

/** Reasons only the run controller adds to a rule rejection. */
export const CONTROLLER_REASONS = ['save_failed', 'invalid_state'] as const;

/** Why the automatic ghost selection did not complete. */
export interface SelectionFailure {
  readonly reason: RejectReason | 'save_failed' | 'stale' | 'invalid_state';
  readonly detail?: string;
}

/** Optional parts of a controller. */
export interface ControllerOptions {
  /**
   * The ghost pool (W3-1). Used only when `deps.ghosts` is set: snapshots are
   * written to it after the save that started a PvP battle, and it is read
   * when the shop before a PvP battle is entered. A failing store never fails
   * a dispatch: a failed write loses that snapshot, a failed read means no
   * candidates (the boss).
   */
  readonly ghostStore?: GhostStore;
}

export interface RunController {
  readonly runId: string;
  /** The last committed state (saved). */
  readonly state: RunState;
  /**
   * Apply one intent and save it. Calls are queued: a dispatch made while
   * another is in flight waits for it, so counters and saves stay in order.
   * On `save_failed` the state is unchanged and the intent can be retried.
   * On `stale` (the store holds a newer save: the run changed elsewhere) the
   * state is also unchanged, but a retry is refused again; reload the run.
   */
  dispatch(
    player: number,
    intent: Intent,
    now: number,
  ): Promise<DispatchResult>;
  /**
   * Make sure the PvP opponent is fixed if the run is in the shop before a
   * PvP battle and ghosts are on (e.g. after reopening a save made between
   * entering the shop and selecting). `dispatch` does this itself first.
   * Resolves with the failure when the selection was tried and did not
   * complete (it is retried by the next call), else null.
   */
  prepare(now: number): Promise<SelectionFailure | null>;
  /** The failure of the last selection attempt, or null (none, or it succeeded). */
  readonly selectionFailure: SelectionFailure | null;
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
  options: ControllerOptions,
  startedAt?: number,
): RunController {
  let current = initial;
  let tail: Promise<unknown> = Promise.resolve();
  let selectionFailure: SelectionFailure | null = null;
  const ghostStore = options.ghostStore;

  /** Apply, save, then do the side effects the machine asked for. */
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
    // Nothing is written that would not open again: the next state must pass
    // the same validation `openRun` applies.
    const valid = validateRunState(r.state, deps);
    if (!valid.ok) {
      return {
        ok: false,
        reason: 'invalid_state',
        detail: valid.errors.slice(0, 3).join(' '),
      };
    }
    // A signature (a later phase) would cover the old state, so a rewritten
    // record carries none; signing happens on write in that phase.
    const record = buildSaveRecord(
      createArgs,
      r.state,
      installedVersion,
      now,
      undefined,
      startedAt,
    );
    try {
      await store.put(record);
    } catch (e) {
      return {
        ok: false,
        // A newer save exists (another tab): not revealed, not retryable.
        reason: e instanceof StaleSaveError ? 'stale' : 'save_failed',
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

  /** Side effects of an accepted, saved intent: the ghost pool. */
  async function afterSave(
    r: Extract<DispatchResult, { ok: true }>,
    now: number,
  ): Promise<Extract<DispatchResult, { ok: true }>> {
    let result = r;
    for (const fx of r.effects) {
      if (fx.type === 'ghost_snapshot' && ghostStore !== undefined) {
        try {
          await ghostStore.save(fx.snapshot);
        } catch {
          // The snapshot is lost; the run is unaffected.
        }
      }
    }
    if (selectionPending(current, deps)) {
      const sel = await selectGhostNow(now);
      if (sel !== null && sel.ok) {
        result = {
          ...sel,
          effects: [...r.effects, ...sel.effects],
          ...(r.warning === undefined ? {} : { warning: r.warning }),
        };
      } else if (selectionFailure !== null) {
        result = { ...result, selectionFailure };
      }
    }
    return result;
  }

  /** Read the pool and apply `select_ghost` (the host sends it). */
  async function selectGhostNow(now: number): Promise<DispatchResult | null> {
    const vctx = ghostContext(deps);
    if (vctx === null) return null;
    let raw: readonly unknown[] = [];
    if (ghostStore !== undefined) {
      try {
        raw = await ghostStore.list(ghostBucketFor(current));
      } catch {
        raw = [];
      }
    }
    const candidates = presentCandidates(raw, current, vctx);
    const r = await run(
      current.host,
      { type: SELECT_GHOST, candidates: candidates as unknown as Json },
      now,
    );
    if (r.ok) {
      selectionFailure = null;
      return r;
    }
    selectionFailure = {
      reason: r.reason,
      ...(r.detail === undefined ? {} : { detail: r.detail }),
    };
    return r;
  }

  async function commit(
    player: number,
    intent: Intent,
    now: number,
  ): Promise<DispatchResult> {
    const r = await run(player, intent, now);
    return r.ok ? afterSave(r, now) : r;
  }

  async function ensureSelection(
    now: number,
  ): Promise<SelectionFailure | null> {
    if (!selectionPending(current, deps)) {
      selectionFailure = null;
      return null;
    }
    await selectGhostNow(now);
    return selectionFailure;
  }

  return {
    runId: initial.runId,
    get state(): RunState {
      return current;
    },
    get selectionFailure(): SelectionFailure | null {
      return selectionFailure;
    },
    dispatch(player, intent, now) {
      const result = tail.then(async () => {
        const failed = await ensureSelection(now);
        const r = await commit(player, intent, now);
        // A rule rejection that is only the missing selection says why.
        if (
          !r.ok &&
          r.reason === 'ghost_selection_pending' &&
          failed !== null
        ) {
          return { ...r, selectionFailure: failed };
        }
        return r;
      });
      tail = result.catch(() => undefined);
      return result;
    },
    prepare(now) {
      const result = tail.then(() => ensureSelection(now));
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
  options: ControllerOptions = {},
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
      buildSaveRecord(
        createArgs,
        created.state,
        installedVersion,
        now,
        undefined,
        now,
      ),
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
      options,
      now,
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
  options: ControllerOptions = {},
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
          options,
          c.record.startedAt,
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
  /**
   * Older-major saves whose state could not be read or validated: deleted
   * all the same (issue #71), with no history entry because there is no
   * state to summarise.
   */
  readonly wipedUnreadable: readonly {
    readonly runId: string;
    readonly runVersion: string;
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
   * left alone (never finished into history) because their state cannot be
   * trusted. Older-major ones are the exception: they are deleted
   * (`wipedUnreadable`).
   */
  readonly unsupported: readonly {
    readonly runId: string;
    readonly runVersion: string;
  }[];
  /**
   * Stored values that do not parse or validate: left alone. (An
   * older-major save is never listed here: it is deleted, see `wiped` and
   * `wipedUnreadable`.)
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
 * function as `openRun` (`classifySave`). A save whose run has ended is
 * recorded in history and removed. A save from an older major version is
 * deleted whether or not it can be read (issue #71): recorded as
 * `version_wiped` when its state validates (`wiped`), otherwise removed with
 * no history entry (`wipedUnreadable`), as only its version field is trusted.
 * Saves from a newer version, ones whose state format this build cannot read,
 * and damaged ones are left in place and reported in `newer`, `unsupported`
 * and `corrupt`. Safe to run again after an interruption: history entries
 * are unique per run.
 */
export async function initSaves(
  store: SaveStore,
  installedVersion: string,
  now: number,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules'>,
): Promise<InitSavesResult> {
  const wiped: InitSavesResult['wiped'][number][] = [];
  const wipedUnreadable: InitSavesResult['wipedUnreadable'][number][] = [];
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
            // Unreadable, but the version field is: delete, no history.
            await store.remove(runId);
            wipedUnreadable.push({ runId, runVersion: c.record.runVersion });
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
  return {
    wiped,
    wipedUnreadable,
    finished,
    newer,
    unsupported,
    corrupt,
    failed,
  };
}
