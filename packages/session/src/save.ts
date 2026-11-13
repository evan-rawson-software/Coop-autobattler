/**
 * The save record format and the storage interface (W2-4).
 *
 * `session` is pure: it defines the FORMAT (`SaveRecord`, schemas/save.schema.json),
 * the RULES (run-controller.ts) and the INTERFACE (`SaveStore`). Real storage
 * (IndexedDB) lives in packages/web. See the README section "Saving".
 */
import { classify, parseVersion } from './version.js';
import { validateRunState } from './validate.js';
import {
  RUN_STATE_FORMAT_VERSION,
  type CreateRunArgs,
  type RunDeps,
  type RunState,
} from './types.js';

export const SAVE_FORMAT_VERSION = 1;

/** Small denormalized facts for list screens. */
export interface SaveSummary {
  readonly round: number;
  readonly lives: number;
  readonly step: RunState['step'];
  /** How the run ended; null while it is in progress. */
  readonly outcome: 'defeated' | 'abandoned' | null;
}

/**
 * One saved run. `state` carries the seed and the complete action log, so the
 * run can be replayed from `createArgs` (TA-22b). `signature` is reserved for
 * a later phase (TA-22a): it is accepted and preserved, never computed here.
 */
export interface SaveRecord {
  readonly saveFormatVersion: 1;
  readonly runId: string;
  /** `major.minor`, copied from the state. */
  readonly runVersion: string;
  /** The installed game version (`major.minor.patch`) at the last write. */
  readonly installedVersionAtSave: string;
  readonly actionCounter: number;
  readonly hostName: string;
  readonly playerNames: readonly string[];
  readonly createArgs: CreateRunArgs;
  readonly state: RunState;
  readonly summary: SaveSummary;
  /** Supplied by the caller (milliseconds, say); an integer. */
  readonly updatedAt: number;
  /**
   * When this run was first saved (same clock as `updatedAt`), carried
   * unchanged on every later write. It tells one start of a run from another
   * under the same `runId`; records without it still open.
   */
  readonly startedAt?: number;
  readonly signature?: string;
}

/** An entry of `SaveStore.list()` for a record that parses. */
export interface SaveListEntry {
  readonly corrupt: false;
  readonly runId: string;
  readonly runVersion: string;
  readonly installedVersionAtSave: string;
  readonly actionCounter: number;
  readonly hostName: string;
  readonly playerNames: readonly string[];
  readonly summary: SaveSummary;
  readonly updatedAt: number;
  /**
   * Present and true when the record is well formed but its run state has a
   * `formatVersion` this game cannot read: it is listed but `openRun`
   * refuses it with `unsupported_format`. Absent otherwise.
   */
  readonly unsupportedFormat?: true;
}

/** An entry of `SaveStore.list()` for a stored value that does not parse. */
export interface CorruptListEntry {
  readonly corrupt: true;
  readonly runId: string;
  /** 0 unless the stored value has an integer `updatedAt`. */
  readonly updatedAt: number;
  readonly errors: readonly string[];
}

export type SaveListItem = SaveListEntry | CorruptListEntry;

export type HistoryReason = 'defeated' | 'abandoned' | 'version_wiped';

/** A finished run, for the records screen. */
export interface HistoryEntry {
  readonly runId: string;
  readonly partySize: number;
  readonly round: number;
  readonly reason: HistoryReason;
  readonly pvpWon: number;
  readonly pvpLost: number;
  readonly runVersion: string;
  readonly finishedAt: number;
}

/** The text of a refused stale write (shown to the player). */
export const STALE_MESSAGE = 'This run changed in another tab.';

/** What `put` rejects with when the record is older than the stored one. */
export class StaleSaveError extends Error {
  constructor() {
    super(STALE_MESSAGE);
    this.name = 'StaleSaveError';
  }
}

/**
 * True if `next` must be refused over the stored `have` (both are the raw
 * values, possibly damaged). The counter rule: not greater than the stored
 * counter. The identity rule: both carry `startedAt` and they differ, so the
 * stored run is another start of this key. A side without `startedAt` falls
 * back to the counter rule.
 */
export function isStaleWrite(have: unknown, next: unknown): boolean {
  const field = (v: unknown, k: string): unknown =>
    isRec(v) ? v[k] : undefined;
  const a = field(have, 'startedAt');
  const b = field(next, 'startedAt');
  if (typeof a === 'number' && typeof b === 'number' && a !== b) return true;
  const hc = field(have, 'actionCounter');
  const nc = field(next, 'actionCounter');
  return typeof hc === 'number' && typeof nc === 'number' && hc >= nc;
}

/**
 * Where saved runs live. See the README for what an implementation must
 * guarantee; `runSaveStoreConformance` (save-conformance.ts) tests it.
 *
 * `get` returns `unknown` on purpose: what is stored may be damaged, and the
 * caller validates it with `parseSaveRecord`.
 */
export interface SaveStore {
  /** Every stored run, newest `updatedAt` first, then by `runId`. No limit. */
  list(): Promise<readonly SaveListItem[]>;
  /** The stored value, or null if there is none. */
  get(runId: string): Promise<unknown>;
  /**
   * Atomic: on resolve the record is stored; on reject the old one is intact.
   *
   * Stale writes: a store that enforces the compare-and-swap rule refuses a
   * record whose `actionCounter` is not greater than the stored record's
   * (same run opened elsewhere, e.g. in two tabs) by rejecting with a
   * `StaleSaveError`, leaving the stored record unchanged. A first write for
   * a `runId` always succeeds. Stores that enforce it take a `rejectStale`
   * option; the plain store accepts any record.
   */
  put(record: SaveRecord): Promise<void>;
  /** Removes the record; resolves also when there is none. */
  remove(runId: string): Promise<void>;
  /** Finished runs in the order they were appended. */
  listHistory(): Promise<readonly HistoryEntry[]>;
  /** Idempotent per `runId`: a second entry for the same run is ignored. */
  appendHistory(entry: HistoryEntry): Promise<void>;
  /** Highest `round` reached per party size, over the whole history. */
  bestDepthByPartySize(): Promise<Readonly<Record<number, number>>>;
}

// ---------------------------------------------------------------------------
// Building records

export function summarize(state: RunState): SaveSummary {
  return {
    round: state.round,
    lives: state.lives,
    step: state.step,
    outcome: state.outcome === null ? null : state.outcome.reason,
  };
}

export function buildSaveRecord(
  createArgs: CreateRunArgs,
  state: RunState,
  installedVersion: string,
  updatedAt: number,
  signature?: string,
  startedAt?: number,
): SaveRecord {
  const base: SaveRecord = {
    saveFormatVersion: SAVE_FORMAT_VERSION,
    runId: state.runId,
    runVersion: state.runVersion,
    installedVersionAtSave: installedVersion,
    actionCounter: state.actionCounter,
    hostName: state.players[state.host]?.name ?? '',
    playerNames: state.players.map((p) => p.name),
    createArgs,
    state,
    summary: summarize(state),
    updatedAt,
    ...(startedAt === undefined ? {} : { startedAt }),
  };
  return signature === undefined ? base : { ...base, signature };
}

/** Counts PvP wins and losses over finished rounds plus the round in play. */
export function historyEntryFor(
  state: RunState,
  reason: HistoryReason,
  finishedAt: number,
): HistoryEntry {
  let pvpWon = 0;
  let pvpLost = 0;
  const count = (pvp: { readonly won: boolean } | null): void => {
    if (pvp === null) return;
    if (pvp.won) pvpWon += 1;
    else pvpLost += 1;
  };
  for (const r of state.history) count(r.pvp);
  count(state.thisRound.pvp);
  return {
    runId: state.runId,
    partySize: state.players.length,
    round: state.outcome === null ? state.round : state.outcome.round,
    reason,
    pvpWon,
    pvpLost,
    runVersion: state.runVersion,
    finishedAt,
  };
}

/** Highest round per party size (the shared rule for `bestDepthByPartySize`). */
export function bestDepthFromHistory(
  entries: readonly HistoryEntry[],
): Record<number, number> {
  const best: Record<number, number> = {};
  for (const e of entries) {
    const cur = best[e.partySize];
    if (cur === undefined || e.round > cur) best[e.partySize] = e.round;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Loading (never throws)

export type ParseSaveResult =
  | { readonly ok: true; readonly record: SaveRecord }
  | { readonly ok: false; readonly errors: readonly string[] };

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

const KEYS = [
  'saveFormatVersion',
  'runId',
  'runVersion',
  'installedVersionAtSave',
  'actionCounter',
  'hostName',
  'playerNames',
  'createArgs',
  'state',
  'summary',
  'updatedAt',
];

function sameList(a: unknown, b: readonly string[]): boolean {
  return (
    Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i])
  );
}

function checkShape(raw: unknown, errors: string[]): void {
  const err = (m: string): void => {
    errors.push(`save: ${m}`);
  };
  if (!isRec(raw)) {
    err('must be an object.');
    return;
  }
  for (const k of Object.keys(raw)) {
    if (!KEYS.includes(k) && k !== 'signature' && k !== 'startedAt') {
      err(`unknown field "${k}".`);
    }
  }
  for (const k of KEYS) if (!(k in raw)) err(`missing field "${k}".`);
  if (errors.length > 0) return;

  if (raw['saveFormatVersion'] !== SAVE_FORMAT_VERSION) {
    err(`saveFormatVersion must be ${String(SAVE_FORMAT_VERSION)}.`);
  }
  if ('signature' in raw && typeof raw['signature'] !== 'string') {
    err('signature must be a string.');
  }
  if (
    'startedAt' in raw &&
    (!isInt(raw['startedAt']) || raw['startedAt'] < 0)
  ) {
    err('startedAt must be an integer of at least 0.');
  }
  if (typeof raw['runId'] !== 'string' || raw['runId'] === '') {
    err('runId must be a non-empty string.');
  }
  const rv = raw['runVersion'];
  if (typeof rv !== 'string' || !/^\d+\.\d+$/.test(rv) || !parseVersion(rv)) {
    err('runVersion must look like "major.minor".');
  }
  if (parseVersion(raw['installedVersionAtSave']) === null) {
    err('installedVersionAtSave must be a version.');
  }
  if (!isInt(raw['actionCounter']) || raw['actionCounter'] < 0) {
    err('actionCounter must be an integer of at least 0.');
  }
  if (typeof raw['hostName'] !== 'string') err('hostName must be a string.');
  const names = raw['playerNames'];
  if (
    !Array.isArray(names) ||
    names.length < 1 ||
    names.length > 4 ||
    !names.every((n) => typeof n === 'string')
  ) {
    err('playerNames must be 1 to 4 strings.');
  }
  if (!isInt(raw['updatedAt']) || raw['updatedAt'] < 0) {
    err('updatedAt must be an integer of at least 0.');
  }
  const ca = raw['createArgs'];
  if (
    !isRec(ca) ||
    typeof ca['runId'] !== 'string' ||
    typeof ca['runVersion'] !== 'string' ||
    !isInt(ca['seed']) ||
    !Array.isArray(ca['players']) ||
    !ca['players'].every((p) => typeof p === 'string') ||
    !isInt(ca['host'])
  ) {
    err('createArgs must be {runId, runVersion, seed, players, host}.');
  }
  const st = raw['state'];
  if (
    !isRec(st) ||
    typeof st['runId'] !== 'string' ||
    typeof st['runVersion'] !== 'string' ||
    !isInt(st['actionCounter']) ||
    !Array.isArray(st['actionLog']) ||
    !isInt(st['seed']) ||
    !Array.isArray(st['players']) ||
    !isInt(st['round']) ||
    typeof st['step'] !== 'string' ||
    !isInt(st['lives']) ||
    !isInt(st['host']) ||
    !Array.isArray(st['history']) ||
    !isRec(st['thisRound'])
  ) {
    err('state must be a run state with seed, action log and counters.');
  }
  const sm = raw['summary'];
  if (
    !isRec(sm) ||
    !isInt(sm['round']) ||
    !isInt(sm['lives']) ||
    typeof sm['step'] !== 'string' ||
    !(
      sm['outcome'] === null ||
      sm['outcome'] === 'defeated' ||
      sm['outcome'] === 'abandoned'
    )
  ) {
    err('summary must be {round, lives, step, outcome}.');
  }
  if (errors.length > 0 || !isRec(st) || !isRec(ca) || !isRec(sm)) return;

  // Cross-field consistency.
  const pl = (st['players'] as unknown[]).map((p) =>
    isRec(p) ? p['name'] : undefined,
  );
  if (st['runId'] !== raw['runId'] || ca['runId'] !== raw['runId']) {
    err('runId differs between record, createArgs and state.');
  }
  if (st['runVersion'] !== rv || ca['runVersion'] !== rv) {
    err('runVersion differs between record, createArgs and state.');
  }
  if (
    raw['actionCounter'] !== st['actionCounter'] ||
    (st['actionLog'] as unknown[]).length !== st['actionCounter']
  ) {
    err('actionCounter does not match the state and its action log.');
  }
  if (ca['seed'] !== st['seed']) err('seed differs from createArgs.');
  if (!sameList(pl, names as string[])) {
    err('playerNames do not match the state players.');
  } else if (!sameList(ca['players'], names as string[])) {
    err('playerNames do not match createArgs.');
  }
  if (
    ca['host'] !== st['host'] ||
    raw['hostName'] !== (names as string[])[st['host'] as number]
  ) {
    err('host does not match.');
  }
  const o = st['outcome'];
  const outcome = isRec(o) ? o['reason'] : null;
  if (
    sm['round'] !== st['round'] ||
    sm['lives'] !== st['lives'] ||
    sm['step'] !== st['step'] ||
    sm['outcome'] !== outcome
  ) {
    err('summary does not match the state.');
  }
}

/**
 * Structural check without game content: field types and the cross-field
 * rules. Enough to list a save, finish a finished one and read its version.
 * Never throws.
 */
export function checkSaveShape(raw: unknown): ParseSaveResult {
  const errors: string[] = [];
  try {
    checkShape(raw, errors);
  } catch (e) {
    errors.push(
      `save: could not be checked (${e instanceof Error ? e.message : 'unknown error'}).`,
    );
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, record: raw as SaveRecord };
}

/**
 * The validating loader: shape, consistency and `validateRunState` on the
 * state. Never throws; malformed input comes back as `{ok: false, errors}`.
 */
export function parseSaveRecord(
  raw: unknown,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules'>,
): ParseSaveResult {
  const shape = checkSaveShape(raw);
  if (!shape.ok) return shape;
  try {
    const v = validateRunState(shape.record.state, deps);
    if (!v.ok) return { ok: false, errors: v.errors };
  } catch (e) {
    return {
      ok: false,
      errors: [
        `save: state could not be checked (${e instanceof Error ? e.message : 'unknown error'}).`,
      ],
    };
  }
  return shape;
}

/**
 * True if the record's run state names a `formatVersion` other than
 * `RUN_STATE_FORMAT_VERSION`. (A state with no `formatVersion` at all is not
 * "unsupported": it is damaged and fails validation as corrupt.)
 */
export function hasUnsupportedFormat(record: SaveRecord): boolean {
  const st = record.state as unknown as Record<string, unknown>;
  return (
    'formatVersion' in st && st['formatVersion'] !== RUN_STATE_FORMAT_VERSION
  );
}

/** The list entry for a stored value; shared by store implementations. */
export function summarizeStored(runId: string, raw: unknown): SaveListItem {
  const shape = checkSaveShape(raw);
  if (!shape.ok) {
    const u = isRec(raw) ? raw['updatedAt'] : undefined;
    return {
      corrupt: true,
      runId,
      updatedAt: isInt(u) && u >= 0 ? u : 0,
      errors: shape.errors,
    };
  }
  const r = shape.record;
  return {
    corrupt: false,
    runId,
    runVersion: r.runVersion,
    installedVersionAtSave: r.installedVersionAtSave,
    actionCounter: r.actionCounter,
    hostName: r.hostName,
    playerNames: r.playerNames,
    summary: r.summary,
    updatedAt: r.updatedAt,
    ...(hasUnsupportedFormat(r) ? { unsupportedFormat: true as const } : {}),
  };
}

/** The order of `SaveStore.list()`: `updatedAt` descending, then `runId`. */
export function compareListItems(a: SaveListItem, b: SaveListItem): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
}

// ---------------------------------------------------------------------------
// One classification for every reader of a stored save

/**
 * What a stored value is, as far as it can be read. The ONE classification
 * used by `openRun` and `initSaves` (issue #68), in this order:
 *
 *  1. the record's shape (`checkSaveShape`)            -> `corrupt`
 *  2. its `runId` against the key it is stored under   -> `corrupt`
 *  3. the game version of its own `runVersion`         -> `newer`, `older_major`
 *     (reported even if the state would not validate)
 *  4. the run state's `formatVersion`                  -> `unsupported_format`
 *  5. `validateRunState` on the state                  -> `corrupt`
 *
 * Anything but `open` cannot be played. Only `open` has a validated state,
 * and for `older_major` the result of that validation is carried along
 * (`validation`) because `initSaves` may only wipe or finish a save it has
 * validated.
 */
export type SaveClassification =
  | { readonly kind: 'corrupt'; readonly errors: readonly string[] }
  | { readonly kind: 'newer'; readonly record: SaveRecord }
  | {
      readonly kind: 'older_major';
      readonly record: SaveRecord;
      /** The state checked against the current rules and content. */
      readonly validation: ParseSaveResult;
    }
  | { readonly kind: 'unsupported_format'; readonly record: SaveRecord }
  | {
      readonly kind: 'open';
      /** Shape and state both validated. */
      readonly record: SaveRecord;
      readonly version: 'same' | 'older_minor';
    };

export function classifySave(
  raw: unknown,
  key: string,
  installedVersion: string,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules'>,
): SaveClassification {
  const shape = checkSaveShape(raw);
  if (!shape.ok) return { kind: 'corrupt', errors: shape.errors };
  if (shape.record.runId !== key) {
    return {
      kind: 'corrupt',
      errors: ['save: runId does not match the key it is stored under.'],
    };
  }
  const version = classify(shape.record.runVersion, installedVersion);
  if (version === 'newer') return { kind: 'newer', record: shape.record };
  if (version === 'older_major') {
    return {
      kind: 'older_major',
      record: shape.record,
      validation: parseSaveRecord(raw, deps),
    };
  }
  if (hasUnsupportedFormat(shape.record)) {
    return { kind: 'unsupported_format', record: shape.record };
  }
  const parsed = parseSaveRecord(raw, deps);
  if (!parsed.ok) return { kind: 'corrupt', errors: parsed.errors };
  return { kind: 'open', record: parsed.record, version };
}
