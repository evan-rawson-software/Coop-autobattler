/**
 * Playback of the latest battle (W2-3). The save holds a small `detail`, not
 * the event log; the battle screen re-simulates the battle from it.
 */
import { hashJson, type Battle } from '@game/core';
import type { Json, RunDeps, RunState } from './types.js';

export type ReplayLastBattleResult =
  | {
      readonly ok: true;
      /** The battle at tick 0. Call `step()` until `isOver()`; read `eventLog`. */
      readonly battle: Battle;
      /** The summary stored when the battle was resolved. */
      readonly stored: Json;
      /** The event-log hash stored when the battle was resolved. */
      readonly storedEventLogHash: string;
    }
  | {
      readonly ok: false;
      /** `wrong_step`, `no_replay` (the resolver cannot replay), `no_stored_battle`, `team_changed`, or a start error. */
      readonly reason: string;
    };

/**
 * Re-create the battle that was just fought. Available while the summary
 * step (`pve_summary`, `pvp_summary`) is open, because that is when the
 * result is in the state; the party's team cannot change between the battle
 * and the end of that step, so the team in `state.team` is the team that
 * fought (the stored `teamHash` is checked and a mismatch is `team_changed`).
 * The result is a started battle; play it with `step()` for the animation.
 */
export function replayLastBattle(
  state: RunState,
  deps: Pick<RunDeps, 'battle'>,
): ReplayLastBattleResult {
  if (state.step !== 'pve_summary' && state.step !== 'pvp_summary') {
    return { ok: false, reason: 'wrong_step' };
  }
  if (deps.battle.replay === undefined) {
    return { ok: false, reason: 'no_replay' };
  }
  return deps.battle.replay(state);
}

/**
 * Run the replay to its end and report whether its event log hashes to the
 * stored hash. For tests and for a "verify" button.
 */
export function verifyLastBattle(
  state: RunState,
  deps: Pick<RunDeps, 'battle'>,
): boolean {
  const r = replayLastBattle(state, deps);
  if (!r.ok) return false;
  while (!r.battle.isOver()) r.battle.step();
  return hashJson(r.battle.eventLog) === r.storedEventLogHash;
}
