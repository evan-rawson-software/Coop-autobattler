/** Read-only helpers for the presentation layer. */
import { sealedProducers as sealedIn } from '@game/core';
import {
  pveOptionView,
  readPveOption,
  type PveOptionView,
} from './pve-options.js';
import { STEP_INTENTS, lockedWhileReady } from './step-table.js';
import type { Json, RunDeps, RunState, VoteTopic } from './types.js';

/** Indices of the players who are currently ready. */
export function whoIsReady(state: RunState): number[] {
  const out: number[] = [];
  state.perPlayer.forEach((p, i) => {
    if (p.ready) out.push(i);
  });
  return out;
}

/**
 * The ids of the placed unit producers whose units could not reach the front
 * row of the board (issue #37, 3a); `ready` is refused with `sealed_producer`
 * while there are any. Empty when nothing is sealed in.
 */
export function sealedProducers(
  state: RunState,
  deps: Pick<RunDeps, 'content'>,
): number[] {
  return sealedIn(state.team, deps.content);
}

export interface OpenVoteView {
  readonly topic: VoteTopic;
  /** What can be voted for: PvE options, event offers, or core proposals. */
  readonly options: readonly Json[];
  /** Each player's current choice, or null. */
  readonly choices: readonly (Json | null)[];
  /** Players who have not voted yet. */
  readonly waitingFor: readonly number[];
}

/** The vote that is open in the current step, or null. */
export function openVote(state: RunState): OpenVoteView | null {
  const votes = state.votes;
  if (votes === null) return null;
  const pending = state.pending;
  const rec =
    typeof pending === 'object' && pending !== null && !Array.isArray(pending)
      ? (pending as Record<string, Json>)
      : {};
  const list = rec[votes.topic === 'core' ? 'proposals' : 'options'];
  const waitingFor: number[] = [];
  votes.choices.forEach((c, i) => {
    if (c === null) waitingFor.push(i);
  });
  return {
    topic: votes.topic,
    options: Array.isArray(list) ? (list as readonly Json[]) : [],
    choices: votes.choices,
    waitingFor,
  };
}

export interface FollowUpView {
  /** What is being chosen (`workshop_building`, `shrine_modifier`, ...). */
  readonly prompt: string;
  /**
   * True if each player chooses for themselves (Workshop): `options` are then
   * only the options of the asked player (or all, when no player is given),
   * and `skip` is always allowed besides them. False for a party vote.
   */
  readonly perPlayer: boolean;
  readonly options: readonly Json[];
  /** Who has chosen (not what), parallel to the players. */
  readonly chosen: readonly boolean[];
  /** Players who have not chosen yet. */
  readonly waitingFor: readonly number[];
  /** The asked player's own current choice (an option id), or null. */
  readonly mine: string | null;
}

/**
 * The follow-up open in `event_resolve`, or null in any other step. Pass
 * `player` to get that player's own options in a per-player follow-up.
 */
export function eventFollowUp(
  state: RunState,
  player?: number,
): FollowUpView | null {
  if (state.step !== 'event_resolve') return null;
  const pending = state.pending;
  const rec =
    typeof pending === 'object' && pending !== null && !Array.isArray(pending)
      ? (pending as Record<string, Json>)
      : {};
  const fu = rec['followUp'];
  if (typeof fu !== 'object' || fu === null || Array.isArray(fu)) return null;
  const f = fu as Record<string, Json>;
  const votes = Array.isArray(f['votes']) ? (f['votes'] as Json[]) : [];
  const options = Array.isArray(f['options']) ? (f['options'] as Json[]) : [];
  const per = f['perPlayer'] === true;
  const mineOptions =
    per && player !== undefined
      ? options.filter(
          (o) =>
            typeof o === 'object' &&
            o !== null &&
            !Array.isArray(o) &&
            (o as Record<string, Json>)['player'] === player,
        )
      : options;
  const mine = player === undefined ? undefined : votes[player];
  return {
    prompt: typeof f['prompt'] === 'string' ? f['prompt'] : '',
    perPlayer: per,
    options: mineOptions,
    chosen: votes.map((v) => v !== null),
    waitingFor: votes.flatMap((v, i) => (v === null ? [i] : [])),
    mine: typeof mine === 'string' ? mine : null,
  };
}

/**
 * The intent types `player` may send right now. Extension intents are
 * included when `deps` is given and their handler allows the current step.
 * This is about the step and the player's own flags (a Ready player in a build
 * or shop step may only unready, or abandon as host: issue #58); the board and
 * shop can still refuse a particular intent.
 */
export function allowedIntents(
  state: RunState,
  player: number,
  deps?: Pick<RunDeps, 'handlers'>,
): string[] {
  const me = state.perPlayer[player];
  if (me === undefined) return [];
  const out: string[] = [];
  for (const type of STEP_INTENTS[state.step]) {
    if (me.ready && lockedWhileReady(state.step, type)) continue;
    if (type === 'ready' && me.ready) continue;
    if (type === 'unready' && !me.ready) continue;
    if (type === 'abandon' && player !== state.host) continue;
    out.push(type);
  }
  if (deps !== undefined && state.step !== 'run_over') {
    for (const [type, handler] of Object.entries(deps.handlers)) {
      if (me.ready && lockedWhileReady(state.step, type)) continue;
      if (handler.steps.includes(state.step)) out.push(type);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The next battle (RS-3b, RS-6a)

export type NextBattleInfo =
  /** The next battle is PvE: the three options, with archetype and reward. */
  | {
      readonly kind: 'pve';
      /** The round of that battle. */
      readonly round: number;
      readonly options: readonly PveOptionView[];
    }
  /** The next battle is PvP: the opponent is never shown in advance. */
  | {
      readonly kind: 'pvp';
      readonly round: number;
      readonly opponent: 'unknown';
      readonly stakes: {
        /** Gold each player gets for a win; null if rewards are not wired. */
        readonly winGold: number | null;
        /** Consolation gold each player gets for a loss. */
        readonly lossGold: number | null;
        /** Lives a loss costs. */
        readonly lifeCost: number;
      };
    };

function pveViews(options: readonly Json[]): PveOptionView[] {
  const out: PveOptionView[] = [];
  for (const o of options) {
    const option = readPveOption(o);
    if (option !== null) out.push(pveOptionView(option));
  }
  return out;
}

/**
 * What the party is heading into, for the build and shop screens. In the
 * first `build`, in `pve_choice`, and in the shop that ends a round it is the
 * next PvE battle with its three stored options; in the shop that follows the
 * PvE leg it is the PvP battle ("opponent unknown" and what is at stake).
 * Null in other steps, or when no options are stored (the placeholder hooks).
 */
export function nextBattleInfo(
  state: RunState,
  deps: Pick<RunDeps, 'rules' | 'rewards'>,
): NextBattleInfo | null {
  const pending = state.pending;
  const rec =
    typeof pending === 'object' && pending !== null && !Array.isArray(pending)
      ? (pending as Record<string, Json>)
      : {};
  const pve = (
    round: number,
    options: readonly Json[],
  ): NextBattleInfo | null => {
    const views = pveViews(options);
    return views.length === 0 ? null : { kind: 'pve', round, options: views };
  };
  switch (state.step) {
    case 'build':
      return state.upcomingPve === null
        ? null
        : pve(state.upcomingPve.round, state.upcomingPve.options);
    case 'pve_choice': {
      const list = rec['options'];
      return pve(state.round, Array.isArray(list) ? (list as Json[]) : []);
    }
    case 'event_choice':
    case 'event_resolve':
    case 'shop':
      if (state.leg === 'pve') {
        return {
          kind: 'pvp',
          round: state.round,
          opponent: 'unknown',
          stakes: {
            winGold: deps.rewards?.pvpWin ?? null,
            lossGold: deps.rewards?.pvpLoss ?? null,
            lifeCost: deps.rules.pvpLossLifeCost,
          },
        };
      }
      return state.upcomingPve === null
        ? null
        : pve(state.upcomingPve.round, state.upcomingPve.options);
    default:
      return null;
  }
}
