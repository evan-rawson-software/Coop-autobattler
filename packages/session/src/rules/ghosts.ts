/**
 * Ghosts in the run (W3-1): deriving a snapshot, filtering candidates, the
 * seeded selection and the `select_ghost` intent.
 *
 * Everything here is pure. The ghost POOL (the store) is outside the machine:
 *
 *  - Taking: entering a PvP battle emits a `ghost_snapshot` effect carrying
 *    `snapshotOf(state, owner)`; the run controller writes it to the store
 *    after the save succeeded.
 *  - Selecting: entering the shop of the PvE leg emits `ghost_selection_needed`;
 *    the controller reads the pool and applies the intent `select_ghost` with
 *    the candidates as its payload. The action log does NOT keep the
 *    candidates (they were 94% of a save): it keeps the compact record of the
 *    draw (`LoggedSelection`: how many valid candidates there were, the drawn
 *    index, the chosen snapshot, hashes), which `replayRun` checks and uses
 *    with no store and without re-judging the snapshot by today's economy.
 */
import {
  checkGhostSnapshotShape,
  compareGhosts,
  ghostBucketKey,
  ghostBucketOf,
  ghostKey,
  canonicalJsonOrNull,
  hashJson,
  validateGhostSnapshot,
  GHOST_MAX_LABEL_LENGTH,
  GHOST_SNAPSHOT_FORMAT_VERSION,
  type GhostBucket,
  type GhostOwner,
  type GhostSnapshot,
  type GhostValidationContext,
  type Json,
  sortedKeys,
} from '@game/core';
import { drawStream, streamLabels } from './streams.js';
import type {
  Effect,
  HandlerContext,
  HandlerResult,
  IntentHandler,
  PvpOpponentChoice,
  RunDeps,
  RunState,
} from './types.js';
import { recordOrNull } from './json-guards.js';

/** The most candidates a `select_ghost` intent may carry. */
export const MAX_GHOST_CANDIDATES = 16;

/** The label of the boss opponent in `PvpOpponentChoice`. */
export const BOSS_LABEL = 'the boss';

/** The intent type that fixes the PvP opponent. */
export const SELECT_GHOST = 'select_ghost';

/** Reasons the ghost selection can reject with (besides the built-in ones). */
export const GHOST_REASONS = [
  'ghost_selection_pending',
  'already_selected',
  'replay_mismatch',
] as const;

/** A display label for a party: the player names, cleaned and shortened. */
export function partyLabel(state: Pick<RunState, 'players'>): string {
  const joined = state.players
    // eslint-disable-next-line no-control-regex
    .map((p) => p.name.replace(/[\u0000-\u001f\u007f]/g, ' '))
    .join(' & ')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = joined.slice(0, GHOST_MAX_LABEL_LENGTH).trim();
  return cut === '' ? 'Player' : cut;
}

/** The owner written into this install's snapshots of this run. */
export function ghostOwnerFor(
  state: Pick<RunState, 'players'>,
  ownerId: string,
  ownerLabel?: string,
): GhostOwner {
  return {
    id: ownerId,
    label:
      ownerLabel === undefined
        ? partyLabel(state)
        : partyLabel({ players: [{ index: 0, name: ownerLabel }] }),
  };
}

/** The bucket a run is in now: its version, party size and round. */
export function ghostBucketFor(
  state: Pick<RunState, 'runVersion' | 'players' | 'round'>,
): GhostBucket {
  return {
    gameVersion: state.runVersion,
    partySize: state.players.length,
    round: state.round,
  };
}

/**
 * The snapshot of the party as it stands now. Pure: derived from the state
 * alone, so it is the same whenever and wherever it is computed. The PvP
 * record counts the PvP battles of the rounds before the current one.
 */
export function snapshotOf(state: RunState, owner: GhostOwner): GhostSnapshot {
  let wins = 0;
  let losses = 0;
  for (const r of [...state.history, state.thisRound]) {
    if (r.pvp === null) continue;
    if (r.pvp.won) wins++;
    else losses++;
  }
  return {
    formatVersion: GHOST_SNAPSHOT_FORMAT_VERSION,
    gameVersion: state.runVersion,
    partySize: state.players.length,
    round: state.round,
    mapSeed: state.seed,
    team: state.team,
    owner,
    runId: state.runId,
    lives: state.lives,
    pvpRecord: { wins, losses },
  };
}

/** The validation context for a run's deps; null when ghosts are off. */
export function ghostContext(
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules' | 'ghosts'>,
): GhostValidationContext | null {
  if (deps.ghosts === undefined) return null;
  return {
    content: deps.content,
    mapgen: deps.mapgenConfig,
    economy: deps.ghosts.economy,
    events: deps.ghosts.events,
    rules: deps.rules,
  };
}

/** True if the snapshot is in the bucket and is not this run's own. */
function cheapEligible(raw: unknown, state: RunState): boolean {
  const r = recordOrNull(raw);
  if (r === null) return false;
  const b = ghostBucketFor(state);
  return (
    r['gameVersion'] === b.gameVersion &&
    r['partySize'] === b.partySize &&
    r['round'] === b.round &&
    r['runId'] !== state.runId
  );
}

/**
 * The candidates that may be drawn from: eligible (same game version, party
 * size and round as the run; not from this run; not fought in this run) and
 * valid (`validateGhostSnapshot`), duplicates by `ghostKey` removed, in the
 * canonical order (owner id, then run id). Untrusted input; never throws.
 */
export function eligibleGhosts(
  raw: readonly unknown[],
  state: RunState,
  ctx: GhostValidationContext,
): GhostSnapshot[] {
  const fought = new Set(state.ghostsFought);
  const seen = new Set<string>();
  const out: GhostSnapshot[] = [];
  for (const item of raw) {
    try {
      if (!cheapEligible(item, state)) continue;
      const v = validateGhostSnapshot(item, ctx);
      if (!v.ok) continue;
      // Defence in depth: a value canonical JSON refuses is no candidate.
      if (canonicalJsonOrNull(v.snapshot) === null) continue;
      const key = ghostKey(v.snapshot);
      if (fought.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(v.snapshot);
    } catch {
      // JavaScript-only hardening: a value that throws when read (a getter,
      // a proxy) is not a candidate. Plain parsed data never throws here.
    }
  }
  return out.sort(compareGhosts);
}

/**
 * The most rows `presentCandidates` validates in one selection, however many
 * the pool listing holds. Validation is the costly step; the walk stops at
 * this many rows or at `MAX_GHOST_CANDIDATES` valid ones, whichever is first.
 */
export const MAX_GHOST_ROWS_VALIDATED = 48;

/**
 * What the run controller presents: valid, eligible candidates of a pool
 * listing, at most `MAX_GHOST_CANDIDATES`, found with bounded work. The
 * eligible rows (cheap checks only: bucket, not this run, not fought, one per
 * `ghostKey`) are put in a fixed order, by `hashJson([runId, round, key])`
 * (ties by key), which differs between runs and rounds but is the same for
 * the same listing. They are then validated in that order until
 * `MAX_GHOST_CANDIDATES` are valid or `MAX_GHOST_ROWS_VALIDATED` rows have
 * been tried. The result is in the canonical order. The machine validates
 * again and draws among whatever it is given, and logs only that draw
 * (`LoggedSelection`), so replay and restore never repeat this walk.
 */
export function presentCandidates(
  raw: readonly unknown[],
  state: RunState,
  ctx: GhostValidationContext,
): GhostSnapshot[] {
  const fought = new Set(state.ghostsFought);
  const seen = new Set<string>();
  const rows: { item: unknown; key: string; h: string }[] = [];
  for (const item of raw) {
    try {
      if (!cheapEligible(item, state)) continue;
      const r = recordOrNull(item);
      const owner = recordOrNull(r?.['owner']);
      const id = owner?.['id'];
      const runId = r?.['runId'];
      if (typeof id !== 'string' || typeof runId !== 'string') continue;
      const key = ghostKey({ owner: { id, label: '' }, runId });
      if (fought.has(key) || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        item,
        key,
        h: hashJson([state.runId, state.round, key]),
      });
    } catch {
      // JavaScript-only hardening, as in eligibleGhosts.
    }
  }
  rows.sort((a, b) =>
    a.h !== b.h
      ? a.h < b.h
        ? -1
        : 1
      : a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0,
  );
  const out: GhostSnapshot[] = [];
  let tried = 0;
  for (const row of rows) {
    if (
      out.length >= MAX_GHOST_CANDIDATES ||
      tried >= MAX_GHOST_ROWS_VALIDATED
    ) {
      break;
    }
    tried++;
    out.push(...eligibleGhosts([row.item], state, ctx));
  }
  return out.sort(compareGhosts);
}

/** True once the opponent of this round's PvP battle has been fixed. */
export function hasSelection(state: RunState): boolean {
  return state.pvpOpponent !== null && state.pvpOpponent.round === state.round;
}

/** True while the controller still owes a `select_ghost` for this shop. */
export function selectionPending(
  state: RunState,
  deps: Pick<RunDeps, 'ghosts'>,
): boolean {
  return (
    deps.ghosts !== undefined &&
    state.step === 'shop' &&
    state.leg === 'pve' &&
    state.outcome === null &&
    !hasSelection(state)
  );
}

export interface GhostSelection {
  /** The state with the generator advanced and `pvpOpponent` set. */
  readonly state: RunState;
  readonly choice: PvpOpponentChoice;
  /** How many candidates were eligible and valid. */
  readonly candidates: number;
  /** The drawn index into the canonical candidates; null for the boss. */
  readonly index: number | null;
  /** The compact action-log form of this selection. */
  readonly logged: LoggedSelection;
}

/**
 * What the action log keeps of a `select_ghost`: enough to replay and audit
 * the draw without the candidates.
 *
 *  - `n`: the number of valid candidates after filtering (0: the boss).
 *  - `index`: the drawn index, `nextInt(n)` on the stream `ghost:r<round>`;
 *    null when `n` is 0.
 *  - `chosen`: the snapshot drawn, as validated live; null for the boss.
 *  - `hash`: `hashJson` of the canonical candidate list (valid candidates in
 *    canonical order). Replay has no list to compare it with; it commits the
 *    run to the pool it saw, for audit and for signing (TA-22a).
 *  - `chosenHash`: `hashJson(chosen)`, null for the boss; replay checks it, so
 *    `chosen` cannot be edited without noticing.
 */
export interface LoggedSelection {
  readonly type: typeof SELECT_GHOST;
  readonly n: number;
  readonly index: number | null;
  readonly chosen: GhostSnapshot | null;
  readonly hash: string;
  readonly chosenHash: string | null;
}

const LOGGED_KEYS = ['type', 'n', 'index', 'chosen', 'hash', 'chosenHash'];

/**
 * Fix the PvP opponent. The candidates are validated and filtered again
 * (`eligibleGhosts`), so nothing in the payload is trusted. The draw: the
 * stream `ghost:r<round>` is taken once (advancing the run generator exactly
 * once whatever the pool holds); with `n >= 1` candidates in canonical order
 * one `nextInt(n)` from it picks the ghost; with none the boss is chosen.
 * Invalid snapshots are dropped before the draw, which is the deterministic
 * form of "skip it and draw another".
 */
export function selectGhost(
  state: RunState,
  raw: readonly unknown[],
  ctx: GhostValidationContext,
): GhostSelection {
  const candidates = eligibleGhosts(
    raw.slice(0, MAX_GHOST_CANDIDATES),
    state,
    ctx,
  );
  const d = drawStream(state, streamLabels.ghost(state.round));
  const picked =
    candidates.length === 0
      ? undefined
      : candidates[d.stream.nextInt(candidates.length)];
  const choice: PvpOpponentChoice =
    picked === undefined
      ? { round: state.round, kind: 'boss', label: BOSS_LABEL, ghost: null }
      : {
          round: state.round,
          kind: 'ghost',
          label: picked.owner.label,
          ghost: picked,
        };
  const index =
    picked === undefined ? null : candidates.findIndex((c) => c === picked);
  return {
    state: { ...d.state, pvpOpponent: choice },
    choice,
    candidates: candidates.length,
    index,
    logged: {
      type: SELECT_GHOST,
      n: candidates.length,
      index,
      chosen: picked ?? null,
      hash: hashJson(candidates),
      chosenHash: picked === undefined ? null : hashJson(picked),
    },
  };
}

/**
 * The `select_ghost` handler (shop of the PvE leg, once per round, host only).
 *
 * Live, the intent is `{ type, candidates }`; the action log gets the compact
 * `LoggedSelection` instead (the one normalisation step, shared by the live
 * path and replay: the machine stores `logged`, replay hands it back with
 * `replay: true`). A compact intent sent live is refused, so nobody can name
 * their opponent without the validated pool path.
 */
export const selectGhostHandler: IntentHandler = {
  steps: ['shop'],
  hostOnly: true,
  handle(ctx: HandlerContext): HandlerResult {
    const { state, intent, deps } = ctx;
    const vctx = ghostContext(deps);
    if (vctx === null) return { ok: false, reason: 'unknown_intent' };
    if (state.leg !== 'pve') return { ok: false, reason: 'wrong_step' };
    if (hasSelection(state)) return { ok: false, reason: 'already_selected' };
    if (ctx.replay === true) return replaySelection(ctx, vctx);
    const list = intent['candidates'];
    if (!Array.isArray(list) || list.length > MAX_GHOST_CANDIDATES) {
      return {
        ok: false,
        reason: 'invalid_intent',
        detail: `candidates must be an array of at most ${String(MAX_GHOST_CANDIDATES)}`,
      };
    }
    let sel: GhostSelection;
    try {
      sel = selectGhost(state, list as readonly unknown[], vctx);
    } catch (e) {
      // Never throw out of a handler: report it, the controller records a
      // selection failure.
      return {
        ok: false,
        reason: 'invalid_intent',
        detail: `selection failed (${e instanceof Error ? e.message : 'unknown error'})`,
      };
    }
    return {
      ok: true,
      state: sel.state,
      effects: [selectedEffect(state, sel.choice, sel.candidates)],
      logged: sel.logged as unknown as Json,
    };
  },
};

function selectedEffect(
  state: RunState,
  choice: PvpOpponentChoice,
  candidates: number,
): Effect {
  return {
    type: 'ghost_selected',
    round: state.round,
    kind: choice.kind,
    label: choice.label,
    candidates,
  };
}

function mismatch(detail: string): HandlerResult {
  return { ok: false, reason: 'replay_mismatch', detail };
}

/**
 * Re-apply a logged selection. The draw is repeated on the same stream and
 * must give the logged index; the logged snapshot is used as it is, checked
 * for structure (`checkGhostSnapshotShape`: no economy numbers, no rules, the fixed size cap) and
 * for fit to this run (same bucket, not this run's own, not fought before),
 * never re-judged by today's value or tier bounds. Any mismatch fails the
 * replay; it never falls back to another opponent.
 */
function replaySelection(
  ctx: HandlerContext,
  vctx: GhostValidationContext,
): HandlerResult {
  const { state, intent } = ctx;
  const keys = sortedKeys(intent);
  if (
    keys.length !== LOGGED_KEYS.length ||
    !LOGGED_KEYS.every((k) => Object.hasOwn(intent, k))
  ) {
    return mismatch('not a logged selection (fields differ)');
  }
  const n = intent['n'];
  const index = intent['index'];
  const chosen = intent['chosen'];
  const hash = intent['hash'];
  const chosenHash = intent['chosenHash'];
  if (
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    n < 0 ||
    n > MAX_GHOST_CANDIDATES ||
    typeof hash !== 'string'
  ) {
    return mismatch('n or hash is malformed');
  }
  const d = drawStream(state, streamLabels.ghost(state.round));
  if (n === 0) {
    if (index !== null || chosen !== null || chosenHash !== null) {
      return mismatch('a boss selection must have no index and no snapshot');
    }
    const choice: PvpOpponentChoice = {
      round: state.round,
      kind: 'boss',
      label: BOSS_LABEL,
      ghost: null,
    };
    return {
      ok: true,
      state: { ...d.state, pvpOpponent: choice },
      effects: [selectedEffect(state, choice, 0)],
      logged: intent as unknown as Json,
    };
  }
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    return mismatch('index is malformed');
  }
  const drawn = d.stream.nextInt(n);
  if (drawn !== index) {
    return mismatch(
      `the draw gives index ${String(drawn)} of ${String(n)}, the log says ${String(index)}`,
    );
  }
  const shape = checkGhostSnapshotShape(
    chosen,
    vctx.content,
    vctx.mapgen,
    undefined,
    // No economy or events: structure and the fixed size cap only.
    undefined,
  );
  if (!shape.ok) {
    return mismatch(
      `the logged snapshot is malformed: ${shape.errors[0] ?? ''}`,
    );
  }
  const g = shape.snapshot;
  if (chosenHash === null || hashJson(chosen) !== chosenHash) {
    return mismatch('the logged snapshot does not match its hash');
  }
  if (
    ghostBucketKey(ghostBucketOf(g)) !== ghostBucketKey(ghostBucketFor(state))
  ) {
    return mismatch('the logged snapshot is from another bucket');
  }
  if (g.runId === state.runId || state.ghostsFought.includes(ghostKey(g))) {
    return mismatch('the logged snapshot is not eligible for this run');
  }
  const choice: PvpOpponentChoice = {
    round: state.round,
    kind: 'ghost',
    label: g.owner.label,
    ghost: g,
  };
  return {
    ok: true,
    state: { ...d.state, pvpOpponent: choice },
    effects: [selectedEffect(state, choice, n)],
    logged: intent as unknown as Json,
  };
}

/** For a screen: who the party will meet, once that is fixed. */
export function pvpOpponentInfo(
  state: Pick<RunState, 'pvpOpponent' | 'round'>,
): { readonly kind: 'ghost' | 'boss'; readonly label: string } | null {
  const o = state.pvpOpponent;
  return o === null || o.round !== state.round
    ? null
    : { kind: o.kind, label: o.label };
}
