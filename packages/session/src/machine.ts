/**
 * The step machine: `createRun`, `applyIntent` and `replayRun` (W2-1).
 *
 * All functions are pure. They never mutate their input; each change builds
 * a new state. See packages/session/README.md for the step table.
 */
import {
  addConduit,
  canonicalJson,
  eraseConduit,
  generateMap,
  createTeamState,
  moveBuilding,
  placeCore,
  placeFromStash,
  returnToStash,
  type Json,
} from '@game/core';
import { STEP_INTENTS } from './step-table.js';
import { drawStream, rootRng, streamLabels } from './streams.js';
import { parseVersion } from './version.js';
import {
  BUILTIN_INTENT_TYPES,
  MAX_PLAYERS,
  RUN_STATE_FORMAT_VERSION,
  type BattleResult,
  type BuiltinIntent,
  type BuiltinIntentType,
  type CreateRunArgs,
  type Effect,
  type ExtensionIntent,
  type Intent,
  type IntentResult,
  type LoggedAction,
  type RejectReason,
  type RunDeps,
  type RunState,
  type StatePatch,
  type Step,
} from './types.js';

// ---------------------------------------------------------------------------
// Small helpers

type Fail = {
  readonly ok: false;
  readonly reason: RejectReason;
  readonly detail?: string;
};
type Next = { readonly ok: true; readonly state: RunState } | Fail;

function fail(reason: RejectReason, detail?: string): Fail {
  return detail === undefined
    ? { ok: false, reason }
    : { ok: false, reason, detail };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isBuiltinType(type: string): type is BuiltinIntentType {
  return (BUILTIN_INTENT_TYPES as readonly string[]).includes(type);
}

function pendingRecord(s: RunState): Record<string, Json> {
  const p = s.pending;
  return typeof p === 'object' && p !== null && !Array.isArray(p)
    ? (p as Record<string, Json>)
    : {};
}

function pendingList(s: RunState, key: string): readonly Json[] {
  const v = pendingRecord(s)[key];
  return Array.isArray(v) ? (v as readonly Json[]) : [];
}

function idOf(option: Json): string | null {
  if (typeof option === 'object' && option !== null && !Array.isArray(option)) {
    const id = (option as Record<string, Json>)['id'];
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function applyPatch(s: RunState, patch: StatePatch): RunState {
  return {
    ...s,
    team: patch.team ?? s.team,
    perPlayer: patch.perPlayer ?? s.perPlayer,
  };
}

function emptyVotes(
  topic: 'core' | 'pve' | 'event',
  n: number,
): RunState['votes'] {
  return { topic, choices: Array.from({ length: n }, () => null) };
}

// ---------------------------------------------------------------------------
// createRun

export type CreateRunResult =
  | { readonly ok: true; readonly state: RunState }
  | {
      readonly ok: false;
      readonly reason: 'invalid_args';
      readonly detail: string;
    };

/** The initial state: `core_placement`, with the map generated from the seed. */
export function createRun(args: CreateRunArgs, deps: RunDeps): CreateRunResult {
  const bad = (detail: string): CreateRunResult => ({
    ok: false,
    reason: 'invalid_args',
    detail,
  });
  if (typeof args.runId !== 'string' || args.runId === '') {
    return bad('runId must be a non-empty string');
  }
  // The same rule as the save format (no leading zeros, no patch part).
  const parsedVersion = parseVersion(args.runVersion);
  if (parsedVersion === null || parsedVersion.patch !== null) {
    return bad('runVersion must look like "major.minor"');
  }
  if (!isInt(args.seed) || args.seed < 0 || args.seed >= 2 ** 32) {
    return bad('seed must be a u32 integer');
  }
  const n = args.players.length;
  if (n < 1 || n > MAX_PLAYERS) return bad('players must have 1 to 4 names');
  if (!args.players.every((p) => typeof p === 'string')) {
    return bad('player names must be strings');
  }
  if (!isInt(args.host) || args.host < 0 || args.host >= n) {
    return bad('host must be a player index');
  }
  const map = generateMap(args.seed, n, deps.content, deps.mapgenConfig);
  const state: RunState = {
    runId: args.runId,
    runVersion: args.runVersion,
    formatVersion: RUN_STATE_FORMAT_VERSION,
    seed: args.seed,
    rng: rootRng(args.seed).getState(),
    actionCounter: 0,
    players: args.players.map((name, index) => ({ index, name })),
    host: args.host,
    round: 1,
    step: 'core_placement',
    leg: 'pve',
    lives: deps.rules.startingLives,
    team: createTeamState(map),
    perPlayer: args.players.map(() => ({ gold: 0, ready: false, shop: null })),
    votes: emptyVotes('core', n),
    upcomingPve: null,
    pending: { proposals: [] },
    history: [],
    thisRound: { pve: null, pvp: null },
    actionLog: [],
    outcome: null,
  };
  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// Entering steps

/**
 * Draw and store the PvE options for the battle of `round` (RS-6a). Done on
 * entering the first `build` and on entering the shop that ends a round, so
 * the options exist in state while the party builds, not when the choice
 * step opens.
 */
function drawUpcoming(s: RunState, round: number, deps: RunDeps): RunState {
  const d = drawStream(s, streamLabels.pveOptions(round));
  const options = deps.hooks.pveOptions(d.state, d.stream, round);
  return { ...d.state, upcomingPve: { round, options } };
}

/**
 * Move to `step`: clears ready flags and votes, runs the step's entry work
 * (hooks, automatic battles) and records effects. Battles chain straight on
 * to their summary.
 */
function enter(
  prev: RunState,
  step: Step,
  deps: RunDeps,
  fx: Effect[],
): RunState {
  let s: RunState = {
    ...prev,
    step,
    votes: null,
    perPlayer: prev.perPlayer.map((p) =>
      p.ready ? { ...p, ready: false } : p,
    ),
  };
  fx.push({ type: 'step_changed', from: prev.step, to: step, round: s.round });
  const n = s.players.length;
  switch (step) {
    case 'build': {
      const d = drawStream(s, streamLabels.kit);
      s = applyPatch(d.state, deps.hooks.startingKit(d.state, d.stream));
      return { ...drawUpcoming(s, s.round, deps), pending: null };
    }
    case 'pve_choice': {
      s = { ...s, leg: 'pve' };
      // Drawn earlier (see `drawUpcoming`); validation requires it.
      if (s.upcomingPve === null || s.upcomingPve.round !== s.round) {
        throw new Error(
          `enter pve_choice: no upcomingPve for round ${String(s.round)}.`,
        );
      }
      const options = s.upcomingPve.options;
      return {
        ...s,
        upcomingPve: null,
        pending: { options },
        votes: emptyVotes('pve', n),
      };
    }
    case 'pve_battle': {
      const option = pendingRecord(s)['option'] ?? null;
      const d = drawStream(s, streamLabels.battle('pve', s.round));
      const result = deps.battle.resolve({
        kind: 'pve',
        state: d.state,
        rng: d.stream,
        option,
      });
      s = {
        ...d.state,
        thisRound: {
          ...d.state.thisRound,
          pve: {
            difficulty: (option === null ? null : idOf(option)) ?? '',
            won: result.won,
            opponent: {
              kind: result.opponent.kind,
              label: result.opponent.label,
            },
          },
        },
        pending: { option, battle: battleJson(result) },
      };
      fx.push({
        type: 'battle_resolved',
        kind: 'pve',
        won: result.won,
        opponent: result.opponent,
      });
      return enter(s, 'pve_summary', deps, fx);
    }
    case 'event_choice': {
      const d = drawStream(s, streamLabels.eventOffers(s.round, s.leg));
      const options = deps.hooks.eventOffers(d.state, d.stream);
      return {
        ...d.state,
        pending: { options },
        votes: emptyVotes('event', n),
      };
    }
    case 'shop': {
      // The shop that ends a round is the last stop before the next PvE
      // battle: its options are drawn now (RS-6a).
      if (s.leg === 'pvp') s = drawUpcoming(s, s.round + 1, deps);
      const d = drawStream(s, streamLabels.shop(s.round, s.leg));
      s = applyPatch(d.state, deps.hooks.onShopEnter(d.state, d.stream));
      return { ...s, pending: null };
    }
    case 'pvp_battle': {
      s = { ...s, leg: 'pvp' };
      const d = drawStream(s, streamLabels.battle('pvp', s.round));
      const result = deps.battle.resolve({
        kind: 'pvp',
        state: d.state,
        rng: d.stream,
        option: null,
      });
      s = {
        ...d.state,
        thisRound: {
          ...d.state.thisRound,
          pvp: {
            won: result.won,
            opponent: {
              kind: result.opponent.kind,
              label: result.opponent.label,
            },
          },
        },
        pending: { battle: battleJson(result) },
      };
      fx.push({
        type: 'battle_resolved',
        kind: 'pvp',
        won: result.won,
        opponent: result.opponent,
      });
      return enter(s, 'pvp_summary', deps, fx);
    }
    case 'run_over':
      // Nothing is coming any more: no pending data, no upcoming options.
      return { ...s, pending: null, upcomingPve: null };
    default:
      // core_placement, pve_summary, pvp_summary, event_resolve: the caller
      // sets `pending` (and `votes` for core_placement) itself.
      return s;
  }
}

function battleJson(result: BattleResult): Json {
  return {
    won: result.won,
    opponent: { kind: result.opponent.kind, label: result.opponent.label },
    detail: result.detail,
  };
}

function readBattle(s: RunState): BattleResult | null {
  const b = pendingRecord(s)['battle'];
  if (!isRecord(b) || typeof b['won'] !== 'boolean') return null;
  const o = b['opponent'];
  if (!isRecord(o)) return null;
  return {
    won: b['won'],
    opponent: o as unknown as BattleResult['opponent'],
    detail: b['detail'] ?? null,
  };
}

/** End the run. The unfinished round, if anything was fought, is recorded. */
function finish(
  s: RunState,
  reason: 'defeated' | 'abandoned',
  deps: RunDeps,
  fx: Effect[],
): RunState {
  const history =
    s.thisRound.pve !== null || s.thisRound.pvp !== null
      ? [...s.history, { round: s.round, ...s.thisRound }]
      : s.history;
  const next: RunState = {
    ...s,
    history,
    thisRound: { pve: null, pvp: null },
    outcome: { reason, round: s.round },
  };
  const out = enter(next, 'run_over', deps, fx);
  fx.push({ type: 'run_over', reason, round: s.round });
  return out;
}

// ---------------------------------------------------------------------------
// Completing steps

function applyRewards(
  s: RunState,
  kind: 'pve' | 'pvp',
  deps: RunDeps,
): RunState {
  const battle = readBattle(s);
  if (battle === null) return s;
  return applyPatch(s, deps.hooks.rewards(s, { ...battle, kind }));
}

/** The step has met its condition: apply what it owes and move on. */
function completeStep(s: RunState, deps: RunDeps, fx: Effect[]): RunState {
  switch (s.step) {
    case 'core_placement':
      return enter(s, 'build', deps, fx);
    case 'build':
      return enter(s, 'pve_choice', deps, fx);
    case 'pve_choice':
      return enter(s, 'pve_battle', deps, fx);
    case 'pve_summary':
      return enter(applyRewards(s, 'pve', deps), 'event_choice', deps, fx);
    case 'pvp_summary': {
      let next = applyRewards(s, 'pvp', deps);
      const battle = readBattle(s);
      if (battle !== null && !battle.won) {
        const lives = Math.max(0, next.lives - deps.rules.pvpLossLifeCost);
        next = { ...next, lives };
        fx.push({ type: 'life_lost', lives });
      }
      return next.lives <= 0
        ? finish(next, 'defeated', deps, fx)
        : enter(next, 'event_choice', deps, fx);
    }
    case 'event_choice':
    case 'event_resolve':
      return enter(s, 'shop', deps, fx);
    case 'shop': {
      if (s.leg === 'pve') return enter(s, 'pvp_battle', deps, fx);
      // The second shop of the round ends it.
      const next: RunState = {
        ...s,
        history: [...s.history, { round: s.round, ...s.thisRound }],
        thisRound: { pve: null, pvp: null },
        round: s.round + 1,
      };
      fx.push({ type: 'round_started', round: next.round });
      return enter(next, 'pve_choice', deps, fx);
    }
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Votes

export function tally(choices: readonly Json[], host: number): Json {
  const counts = new Map<string, { choice: Json; count: number }>();
  for (const choice of choices) {
    const key = canonicalJson(choice);
    const entry = counts.get(key);
    if (entry === undefined) counts.set(key, { choice, count: 1 });
    else entry.count += 1;
  }
  let max = 0;
  for (const e of counts.values()) max = Math.max(max, e.count);
  const tied = [...counts.entries()].filter(([, e]) => e.count === max);
  const hostChoice = choices[host];
  if (tied.length > 1 && hostChoice !== undefined) {
    const hostEntry = tied.find(([k]) => k === canonicalJson(hostChoice));
    if (hostEntry !== undefined) return hostEntry[1].choice;
  }
  // Unreachable with at most four players (the host is always in a top tie),
  // but defined: the first tied choice in player order.
  const first = tied[0];
  return first === undefined ? null : first[1].choice;
}

function normalizeChoice(s: RunState, choice: Json): Json | null {
  const votes = s.votes;
  if (votes === null) return null;
  if (votes.topic === 'core') {
    if (!isRecord(choice) || !isInt(choice['x']) || !isInt(choice['y'])) {
      return null;
    }
    const { x, y } = choice as { x: number; y: number };
    const known = pendingList(s, 'proposals').some(
      (p) => isRecord(p) && p['x'] === x && p['y'] === y,
    );
    return known ? { x, y } : null;
  }
  if (typeof choice !== 'string') return null;
  return pendingList(s, 'options').some((o) => idOf(o) === choice)
    ? choice
    : null;
}

/**
 * A follow-up to ask the party about: non-null, and not one that lists
 * options and has none (nobody could answer it).
 */
function hasOptions(followUp: Json | null): boolean {
  if (followUp === null) return false;
  if (!isRecord(followUp)) return true;
  const o = followUp['options'];
  return !(Array.isArray(o) && o.length === 0);
}

/** Resolve the open vote if it has met its condition. */
function resolveVotes(s: RunState, deps: RunDeps, fx: Effect[]): Next {
  const votes = s.votes;
  if (votes === null) return { ok: true, state: s };
  const all: Json[] = [];
  for (const c of votes.choices) {
    if (c === null) return { ok: true, state: s };
    all.push(c);
  }
  if (votes.topic === 'core') {
    // Every player has voted: most votes wins, a tie goes to the host (CP-16).
    const first = tally(all, s.host);
    const pos = first as { x: number; y: number };
    const placed = placeCore(s.team, deps.content, deps.mapgenConfig, pos);
    if (!placed.ok) return fail(placed.reason, placed.detail);
    fx.push({ type: 'vote_resolved', topic: 'core', choice: first });
    fx.push({ type: 'core_placed', x: pos.x, y: pos.y });
    return {
      ok: true,
      state: enter(
        { ...s, team: placed.state, pending: null },
        'build',
        deps,
        fx,
      ),
    };
  }
  const winner = tally(all, s.host);
  const option =
    pendingList(s, 'options').find((o) => idOf(o) === winner) ?? null;
  fx.push({ type: 'vote_resolved', topic: votes.topic, choice: winner });
  if (votes.topic === 'pve') {
    return {
      ok: true,
      state: enter({ ...s, pending: { option } }, 'pve_battle', deps, fx),
    };
  }
  // Event: apply it, then either a follow-up choice or the shop. A follow-up
  // with no options would leave the party stuck, so it is skipped.
  const d = drawStream(s, streamLabels.eventResolve(s.round, s.leg));
  const outcome = deps.hooks.resolveEvent(d.state, option, d.stream);
  const next = applyPatch(d.state, outcome.patch);
  if (hasOptions(outcome.followUp)) {
    return {
      ok: true,
      state: enter(
        { ...next, pending: { offer: option, followUp: outcome.followUp } },
        'event_resolve',
        deps,
        fx,
      ),
    };
  }
  return { ok: true, state: enter(next, 'shop', deps, fx) };
}

// ---------------------------------------------------------------------------
// Built-in intents

function setReady(s: RunState, player: number, ready: boolean): RunState {
  return {
    ...s,
    perPlayer: s.perPlayer.map((p, i) => (i === player ? { ...p, ready } : p)),
  };
}

function castVote(s: RunState, player: number, choice: Json): RunState {
  const votes = s.votes as NonNullable<RunState['votes']>;
  return {
    ...s,
    votes: {
      ...votes,
      choices: votes.choices.map((c, i) => (i === player ? choice : c)),
    },
  };
}

function applyBuiltin(
  s: RunState,
  player: number,
  intent: BuiltinIntent,
  deps: RunDeps,
  fx: Effect[],
): Next {
  if (!STEP_INTENTS[s.step].includes(intent.type)) return fail('wrong_step');
  const { content, mapgenConfig } = deps;
  const withTeam = (
    r:
      | { readonly ok: true; readonly state: RunState['team'] }
      | {
          readonly ok: false;
          readonly reason: string;
          readonly detail?: string;
        },
  ): Next =>
    r.ok
      ? { ok: true, state: { ...s, team: r.state } }
      : fail(r.reason, r.detail);

  switch (intent.type) {
    case 'abandon':
      if (player !== s.host) return fail('not_host');
      return { ok: true, state: finish(s, 'abandoned', deps, fx) };

    case 'ready': {
      if (s.perPlayer[player]?.ready === true) return fail('already_ready');
      const next = setReady(s, player, true);
      fx.push({ type: 'ready_changed', player, ready: true });
      return {
        ok: true,
        state: next.perPlayer.every((p) => p.ready)
          ? completeStep(next, deps, fx)
          : next,
      };
    }
    case 'unready': {
      if (s.perPlayer[player]?.ready !== true) return fail('not_ready');
      fx.push({ type: 'ready_changed', player, ready: false });
      return { ok: true, state: setReady(s, player, false) };
    }

    case 'propose_core': {
      if (!isInt(intent.x) || !isInt(intent.y)) return fail('invalid_intent');
      const pos = { x: intent.x, y: intent.y };
      const check = placeCore(s.team, content, mapgenConfig, pos);
      if (!check.ok) return fail(check.reason, check.detail);
      const proposals = pendingList(s, 'proposals');
      const known = proposals.some(
        (p) => isRecord(p) && p['x'] === pos.x && p['y'] === pos.y,
      );
      const next = castVote(
        {
          ...s,
          pending: { proposals: known ? proposals : [...proposals, pos] },
        },
        player,
        pos,
      );
      fx.push({ type: 'vote_changed', player });
      return resolveVotes(next, deps, fx);
    }
    case 'vote': {
      const choice = normalizeChoice(s, intent.choice);
      if (choice === null) return fail('invalid_choice');
      fx.push({ type: 'vote_changed', player });
      return resolveVotes(castVote(s, player, choice), deps, fx);
    }

    case 'place_building':
    case 'move_building': {
      if (
        !isInt(intent.id) ||
        !isInt(intent.x) ||
        !isInt(intent.y) ||
        !isInt(intent.rotation)
      ) {
        return fail('invalid_intent');
      }
      const args = {
        id: intent.id,
        x: intent.x,
        y: intent.y,
        rotation: intent.rotation,
      };
      return withTeam(
        intent.type === 'place_building'
          ? placeFromStash(s.team, content, args)
          : moveBuilding(s.team, content, args),
      );
    }
    case 'return_building':
      if (!isInt(intent.id)) return fail('invalid_intent');
      return withTeam(returnToStash(s.team, content, { id: intent.id }));
    case 'erase_conduit':
      if (!isInt(intent.id)) return fail('invalid_intent');
      return withTeam(eraseConduit(s.team, { id: intent.id }));
    case 'add_conduit': {
      const ok =
        isRecord(intent.from) &&
        isRecord(intent.to) &&
        Array.isArray(intent.cells);
      if (!ok) return fail('invalid_intent');
      return withTeam(addConduit(s.team, content, intent));
    }
    default:
      return fail('unknown_intent');
  }
}

// ---------------------------------------------------------------------------
// applyIntent

/**
 * Apply one intent from one player. Pure; the input state is untouched. On
 * success the result has the new state (with `actionCounter` bumped and the
 * intent appended to `actionLog`) and the effects for the presentation layer.
 */
export function applyIntent(
  state: RunState,
  player: number,
  intent: Intent,
  deps: RunDeps,
): IntentResult {
  if (!isInt(player) || player < 0 || player >= state.players.length) {
    return fail('not_a_player');
  }
  if (!isRecord(intent) || typeof intent.type !== 'string') {
    return fail('invalid_intent');
  }
  const type = intent.type;
  const fx: Effect[] = [];
  let result: Next;
  if (isBuiltinType(type)) {
    result = applyBuiltin(state, player, intent as BuiltinIntent, deps, fx);
  } else {
    const handler = Object.hasOwn(deps.handlers, type)
      ? deps.handlers[type]
      : undefined;
    if (handler === undefined) return fail('unknown_intent', type);
    if (!handler.steps.includes(state.step)) return fail('wrong_step');
    const r = handler.handle({
      state,
      player,
      intent: intent as ExtensionIntent,
      deps,
    });
    if (!r.ok) return fail(r.reason, r.detail);
    fx.push(...(r.effects ?? []));
    result = {
      ok: true,
      state:
        r.advance === true && isAdvanceable(r.state.step)
          ? completeStep(r.state, deps, fx)
          : r.state,
    };
  }
  if (!result.ok) return result;
  const n = state.actionCounter + 1;
  const entry: LoggedAction = { n, player, intent: intent as unknown as Json };
  return {
    ok: true,
    state: {
      ...result.state,
      actionCounter: n,
      actionLog: [...state.actionLog, entry],
    },
    effects: fx,
  };
}

/** Steps whose end a handler may declare with `advance: true`. */
function isAdvanceable(step: Step): boolean {
  return (
    step === 'build' ||
    step === 'shop' ||
    step === 'event_resolve' ||
    step === 'pve_summary' ||
    step === 'pvp_summary'
  );
}

// ---------------------------------------------------------------------------
// replayRun

export type ReplayResult =
  | { readonly ok: true; readonly state: RunState }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly detail?: string;
      /** The `n` of the logged action that failed, if any. */
      readonly at?: number;
    };

/**
 * Create a run and apply the logged actions in order. Used by tests and
 * later by save verification. Fails at the first action that is rejected.
 */
export function replayRun(
  args: CreateRunArgs,
  actionLog: readonly LoggedAction[],
  deps: RunDeps,
): ReplayResult {
  const created = createRun(args, deps);
  if (!created.ok) return created;
  let state = created.state;
  for (const entry of actionLog) {
    const r = applyIntent(state, entry.player, entry.intent as Intent, deps);
    if (!r.ok) {
      return r.detail === undefined
        ? { ok: false, reason: r.reason, at: entry.n }
        : { ok: false, reason: r.reason, detail: r.detail, at: entry.n };
    }
    state = r.state;
  }
  return { ok: true, state };
}
