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
 *    the candidates as its payload. The payload is part of the action log, so
 *    `replayRun` re-derives the same selection with no store at all.
 */
import {
  compareGhosts,
  ghostKey,
  hashJson,
  validateGhostSnapshot,
  GHOST_MAX_LABEL_LENGTH,
  GHOST_SNAPSHOT_FORMAT_VERSION,
  type GhostBucket,
  type GhostOwner,
  type GhostSnapshot,
  type GhostValidationContext,
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

/** The most candidates a `select_ghost` intent may carry. */
export const MAX_GHOST_CANDIDATES = 16;

/** The label of the boss opponent in `PvpOpponentChoice`. */
export const BOSS_LABEL = 'the boss';

/** The intent type that fixes the PvP opponent. */
export const SELECT_GHOST = 'select_ghost';

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

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** True if the snapshot is in the bucket and is not this run's own. */
function cheapEligible(raw: unknown, state: RunState): boolean {
  const r = rec(raw);
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
    if (!cheapEligible(item, state)) continue;
    const v = validateGhostSnapshot(item, ctx);
    if (!v.ok) continue;
    const key = ghostKey(v.snapshot);
    if (fought.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(v.snapshot);
  }
  return out.sort(compareGhosts);
}

/**
 * What the run controller presents: the eligible, valid candidates of a pool
 * listing, at most `MAX_GHOST_CANDIDATES`. When there are more, the ones kept
 * are those with the smallest `hashJson([runId, round, key])`: an arbitrary
 * but fixed subset that differs between runs and rounds. The machine validates
 * again and draws among whatever it is given.
 */
export function presentCandidates(
  raw: readonly unknown[],
  state: RunState,
  ctx: GhostValidationContext,
): GhostSnapshot[] {
  const all = eligibleGhosts(raw, state, ctx);
  if (all.length <= MAX_GHOST_CANDIDATES) return all;
  return all
    .map((g) => ({ g, h: hashJson([state.runId, state.round, ghostKey(g)]) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .slice(0, MAX_GHOST_CANDIDATES)
    .map((x) => x.g)
    .sort(compareGhosts);
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
}

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
  return {
    state: { ...d.state, pvpOpponent: choice },
    choice,
    candidates: candidates.length,
  };
}

/** The `select_ghost` handler (shop of the PvE leg, once per round). */
export const selectGhostHandler: IntentHandler = {
  steps: ['shop'],
  handle(ctx: HandlerContext): HandlerResult {
    const { state, intent, deps } = ctx;
    const vctx = ghostContext(deps);
    if (vctx === null) return { ok: false, reason: 'unknown_intent' };
    if (state.leg !== 'pve') return { ok: false, reason: 'wrong_step' };
    if (hasSelection(state)) return { ok: false, reason: 'already_selected' };
    const list = intent['candidates'];
    if (!Array.isArray(list) || list.length > MAX_GHOST_CANDIDATES) {
      return {
        ok: false,
        reason: 'invalid_intent',
        detail: `candidates must be an array of at most ${String(MAX_GHOST_CANDIDATES)}`,
      };
    }
    const sel = selectGhost(state, list as readonly unknown[], vctx);
    const fx: Effect = {
      type: 'ghost_selected',
      round: state.round,
      kind: sel.choice.kind,
      label: sel.choice.label,
      candidates: sel.candidates,
    };
    return { ok: true, state: sel.state, effects: [fx] };
  },
};

/** For a screen: who the party will meet, once that is fixed. */
export function pvpOpponentInfo(
  state: Pick<RunState, 'pvpOpponent' | 'round'>,
): { readonly kind: 'ghost' | 'boss'; readonly label: string } | null {
  const o = state.pvpOpponent;
  return o === null || o.round !== state.round
    ? null
    : { kind: o.kind, label: o.label };
}
