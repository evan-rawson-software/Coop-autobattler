/**
 * The bar every run screen shows: round, lives, gold, the step, and a Menu
 * button. The run is saved after every action, so leaving is always safe.
 */
import type { RunState } from '@game/session';
import { navigate } from '../app-state.js';
import { NotSavedNote } from './RunGate.js';
import type { RunHandle } from './handle.js';
import { stepLabel } from './router.js';

export function RunBar(props: {
  state: RunState;
  maxLives: number;
  storage?: RunHandle['storage'];
}) {
  const { state } = props;
  const gold = state.perPlayer[0]?.gold ?? 0;
  // The starting gold is granted with the kit when the Core is placed. A run
  // that has no Core (still placing it, or abandoned while placing it) never
  // had the kit: the figure would read 0 for gold it never got.
  const showGold = state.team.core !== null;
  return (
    <span class="run-bar" id="run-bar">
      <span data-field="bar-round">Round {state.round}</span>
      <span data-field="bar-lives">
        Lives {state.lives} / {props.maxLives}
      </span>
      {showGold ? <span data-field="bar-gold">Gold {gold}</span> : null}
      <span data-field="bar-step" class="bar-step">
        {stepLabel(state.step)}
      </span>
      {props.storage === undefined ? null : (
        <NotSavedNote run={{ storage: props.storage }} />
      )}
      <button
        type="button"
        id="menu-button"
        title="Your run is saved after every action, so leaving is always safe."
        onClick={() => {
          navigate('#/');
        }}
      >
        Menu
      </button>
      <span class="muted fine saved-hint">Saved after every action</span>
    </span>
  );
}
