/** Read-only helpers for the presentation layer. */
import {
  pveOptionView,
  readPveOption,
  type PveOptionView,
} from './pve-options.js';
import { STEP_INTENTS } from './step-table.js';
import type { Json, RunDeps, RunState, VoteTopic } from './types.js';

/** Indices of the players who are currently ready. */
export function whoIsReady(state: RunState): number[] {
  const out: number[] = [];
  state.perPlayer.forEach((p, i) => {
    if (p.ready) out.push(i);
  });
  return out;
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

/**
 * The intent types `player` may send right now. Extension intents are
 * included when `deps` is given and their handler allows the current step.
 * This is about the step and the player's own flags; the board and shop can
 * still refuse a particular intent.
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
    if (type === 'ready' && me.ready) continue;
    if (type === 'unready' && !me.ready) continue;
    if (type === 'abandon' && player !== state.host) continue;
    out.push(type);
  }
  if (deps !== undefined && state.step !== 'run_over') {
    for (const [type, handler] of Object.entries(deps.handlers)) {
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
