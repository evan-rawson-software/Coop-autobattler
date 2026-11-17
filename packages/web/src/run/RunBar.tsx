/**
 * The bar every run screen shows: lives, gold (the round is in the title), the
 * held Bonuses, the step, and a Menu button. The run is saved after every action, so leaving is always safe.
 */
import type { RunState } from '@game/session';
import { navigate } from '../app-state.js';
import { NotSavedNote } from './RunGate.js';
import type { RunHandle } from './handle.js';
import { createStore, useStore } from '../app-state.js';
import { ActingSwitch } from '../shell/ActingSwitch.js';
import type { BuildSession } from '../build/session.js';
import { barLivesText } from './bar-lives.js';
import { resultShown } from '../battle/result-shown.js';
import { BonusesItem } from './BonusList.js';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import { barSpecialist } from '../specialist/view-model.js';

const noStore = createStore<{ acting: number }>({ acting: 0 });

const BATTLE_STEPS: ReadonlySet<RunState['step']> = new Set([
  'pve_battle',
  'pve_summary',
  'pvp_battle',
  'pvp_summary',
]);

export function RunBar(props: {
  state: RunState;
  maxLives: number;
  /** Lives a lost rival battle costs (the rules' `pvpLossLifeCost`). */
  lifeCost?: number;
  storage?: RunHandle['storage'];
  /** The run's session: gives the acting player and the switcher. */
  session?: BuildSession;
}) {
  const { state } = props;
  const shown = useStore(resultShown);
  const view = useStore(props.session?.store ?? noStore);
  const acting = props.session === undefined ? 0 : view.acting;
  const gold = state.perPlayer[acting]?.gold ?? 0;
  // The starting gold is granted with the kit when the Core is placed. A run
  // that has no Core (still placing it, or abandoned while placing it) never
  // had the kit: the figure would read 0 for gold it never got.
  const showGold = state.team.cores.some((c) => c !== null);
  // The acting player's specialist (RS-13b); none before the pick, and in a
  // run saved before specialists. Battle screens leave it out: their opponent
  // panel names the specialists, and the step title needs the bar's room.
  const specialist = BATTLE_STEPS.has(state.step)
    ? null
    : barSpecialist(state.team, acting);
  return (
    <span class="run-bar" id="run-bar">
      <span data-field="bar-lives">
        <SpriteIcon name="ui_icon_heart" scale={1} class="bar-icon" />
        {barLivesText(state, props.lifeCost ?? 1, props.maxLives, shown)}
      </span>
      {showGold ? (
        <span data-field="bar-gold" data-gold={gold}>
          <SpriteIcon name="ui_icon_coin" scale={1} class="bar-icon" />
          Gold {gold}
        </span>
      ) : null}
      {specialist === null ? null : (
        <span
          class="bar-specialist"
          data-field="bar-specialist"
          title={specialist.title}
        >
          {specialist.name}
        </span>
      )}
      <BonusesItem modifiers={state.team.modifiers} specialist={specialist} />
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
      {state.step === 'run_over' ? null : (
        <button
          type="button"
          id="menu-button"
          onClick={() => {
            navigate('#/');
          }}
        >
          Menu
        </button>
      )}
    </span>
  );
}
