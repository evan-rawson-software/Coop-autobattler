/**
 * The bar every run screen shows: lives, gold (the round is in the title), the step, and a Menu
 * button. The run is saved after every action, so leaving is always safe.
 */
import type { RunState } from '@game/session';
import { navigate } from '../app-state.js';
import { NotSavedNote } from './RunGate.js';
import type { RunHandle } from './handle.js';
import { createStore, useStore } from '../app-state.js';
import { ActingSwitch } from '../shell/ActingSwitch.js';
import type { BuildSession } from '../build/session.js';
import { SpriteIcon } from '../sprites/SpriteIcon.js';

const noStore = createStore<{ acting: number }>({ acting: 0 });

export function RunBar(props: {
  state: RunState;
  maxLives: number;
  storage?: RunHandle['storage'];
  /** The run's session: gives the acting player and the switcher. */
  session?: BuildSession;
}) {
  const { state } = props;
  const view = useStore(props.session?.store ?? noStore);
  const acting = props.session === undefined ? 0 : view.acting;
  const gold = state.perPlayer[acting]?.gold ?? 0;
  // The starting gold is granted with the kit when the Core is placed. A run
  // that has no Core (still placing it, or abandoned while placing it) never
  // had the kit: the figure would read 0 for gold it never got.
  const showGold = state.team.cores.some((c) => c !== null);
  return (
    <span class="run-bar" id="run-bar">
      <span data-field="bar-lives">
        <SpriteIcon name="ui_icon_heart" scale={1} class="bar-icon" />
        Lives {state.lives} / {props.maxLives}
      </span>
      {showGold ? (
        <span data-field="bar-gold" data-gold={gold}>
          <SpriteIcon name="ui_icon_coin" scale={1} class="bar-icon" />
          Gold {gold}
        </span>
      ) : null}
      {props.session === undefined ? null : (
        <ActingSwitch
          run={state}
          acting={acting}
          onActing={(p) => {
            props.session?.setActing(p);
          }}
        />
      )}
      {props.storage === undefined ? null : (
        <NotSavedNote run={{ storage: props.storage }} />
      )}
      <button
        type="button"
        id="menu-button"
        onClick={() => {
          navigate('#/');
        }}
      >
        Menu
      </button>
    </span>
  );
}
