/**
 * The save record format and the storage interface (W2-4).
 *
 * `session` is pure: it defines the FORMAT (`SaveRecord`, schemas/save.schema.json),
 * the RULES (run-controller.ts) and the INTERFACE (`SaveStore`). Real storage
 * (IndexedDB) lives in packages/web. See the README section "Saving".
 */
import { parseVersion } from './version.js';
import { validateRunState } from './validate.js';
import type { CreateRunArgs, RunDeps, RunState } from './types.js';

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
  /** Atomic: on resolve the record is stored; on reject the old one is intact. */
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
    if (!KEYS.includes(k) && k !== 'signature') err(`unknown field "${k}".`);
  }
  for (const k of KEYS) if (!(k in raw)) err(`missing field "${k}".`);
  if (errors.length > 0) return;

  if (raw['saveFormatVersion'] !== SAVE_FORMAT_VERSION) {
    err(`saveFormatVersion must be ${String(SAVE_FORMAT_VERSION)}.`);
  }
  if ('signature' in raw && typeof raw['signature'] !== 'string') {
    err('signature must be a string.');
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
  };
}

/** The order of `SaveStore.list()`: `updatedAt` descending, then `runId`. */
export function compareListItems(a: SaveListItem, b: SaveListItem): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
}
