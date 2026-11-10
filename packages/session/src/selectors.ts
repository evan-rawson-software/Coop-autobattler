/** Read-only helpers for the presentation layer. */
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
