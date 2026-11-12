/**
 * What the Battle screen says when a battle cannot be played back. The result
 * of the battle is recorded by the session layer, not by playback, so the
 * screen states that recorded outcome as text and the run goes on from it.
 */
import type { BattleReason } from '@game/core';
import { reasonText } from './panels.js';

/** The result a run stores for the battle just fought. */
export interface StoredOutcome {
  readonly won: boolean;
  /** The stored end reason, when the run state has one. */
  readonly reason: string | null;
}

const REASONS: readonly BattleReason[] = [
  'core_destroyed',
  'tiebreak_overkill',
  'tiebreak_building_damage',
  'tiebreak_kills',
  'tiebreak_attacker',
  'time_limit',
];

function isReason(r: string): r is BattleReason {
  return (REASONS as readonly string[]).includes(r);
}

export interface OutcomeText {
  readonly word: 'Victory' | 'Defeat';
  /** Why the battle ended; null when the stored reason is missing/unknown. */
  readonly reason: string | null;
}

export function describeOutcome(
  outcome: StoredOutcome,
  coreName: string,
): OutcomeText {
  return {
    word: outcome.won ? 'Victory' : 'Defeat',
    reason:
      outcome.reason !== null && isReason(outcome.reason)
        ? reasonText(outcome.reason, coreName)
        : null,
  };
}

/** Text of the unrecoverable case: the session layer has no result. */
export const NO_RESULT_TEXT =
  'No result was recorded for this battle, so the run cannot continue from here. Your run is saved: go back to the menu and resume it.';

/** The debug option that makes every playback fail (debug builds only). */
export const FAIL_PLAYBACK_KEY = 'coop-autobattler:debug-fail-playback';

export function readFailPlayback(storage?: {
  getItem(k: string): string | null;
}): boolean {
  try {
    const s = storage ?? window.localStorage;
    return s.getItem(FAIL_PLAYBACK_KEY) === '1';
  } catch {
    return false;
  }
}
