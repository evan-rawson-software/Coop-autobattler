/**
 * The lives the top bar shows. The session takes the life for a lost rival
 * battle only when leaving `pvp_summary`, so while that step is shown after a
 * loss the bar already shows the lives after the loss, with the change.
 */
import type { RunState } from '@game/session';

export function barLives(
  state: Pick<RunState, 'step' | 'lives' | 'pending'>,
  lifeCost: number,
): { readonly lives: number; readonly change: number } {
  const pending = state.pending;
  const battle =
    typeof pending === 'object' && pending !== null && !Array.isArray(pending)
      ? (pending as Record<string, unknown>)['battle']
      : null;
  const lost =
    typeof battle === 'object' &&
    battle !== null &&
    (battle as Record<string, unknown>)['won'] === false;
  if (state.step !== 'pvp_summary' || !lost) {
    return { lives: state.lives, change: 0 };
  }
  const lives = Math.max(0, state.lives - lifeCost);
  return { lives, change: lives - state.lives };
}

export function barLivesText(
  state: Pick<RunState, 'step' | 'lives' | 'pending'>,
  lifeCost: number,
  maxLives: number,
): string {
  const { lives, change } = barLives(state, lifeCost);
  const base = `Lives ${String(lives)} / ${String(maxLives)}`;
  return change === 0 ? base : `${base} (−${String(-change)})`;
}
