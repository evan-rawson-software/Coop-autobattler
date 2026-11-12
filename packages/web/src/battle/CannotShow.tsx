/**
 * The panel for a battle that cannot be displayed: says so plainly, keeps the
 * reason of the failure visible, states the recorded outcome as text and
 * offers Continue (the same Ready as after a watched battle). Without a
 * recorded outcome it offers the way back to the menu instead.
 */
import { useRef, useState } from 'preact/hooks';
import { navigate } from '../app-state.js';
import { content } from '../content.js';
import { Panel } from '../shell/AppShell.js';
import {
  describeOutcome,
  NO_RESULT_TEXT,
  type StoredOutcome,
} from './cannot-show.js';
import { coreNameOf } from './derive.js';
import { createReadyGate } from './ready-gate.js';

export interface CannotShowProps {
  /** Why the battle could not be shown (kept visible, so the bug is seen). */
  readonly message: string;
  /** The recorded result, or null when the session layer has none. */
  readonly outcome: StoredOutcome | null;
  /** The reward line for the outcome, when known. */
  readonly rewardText?: string | undefined;
  /** Continue the run; absent when there is nothing to continue from. */
  readonly onContinue?: (() => Promise<boolean>) | undefined;
  /** Why the last Continue was refused. */
  readonly error?: string | null | undefined;
}

export function CannotShow(props: CannotShowProps) {
  const [pressed, setPressed] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  const gate = useRef<(() => void) | null>(null);
  gate.current ??= createReadyGate(
    () => latest.current.onContinue?.() ?? Promise.resolve(false),
    setPressed,
  );
  const o =
    props.outcome === null
      ? null
      : describeOutcome(props.outcome, coreNameOf(content));
  const canContinue = props.onContinue !== undefined;
  return (
    <div class="run-blocked" id="battle-cannot-show">
      <Panel title="The battle could not be displayed">
        <p data-field="reason">Cannot play: {props.message}</p>
        {o === null ? (
          canContinue ? null : (
            <p data-field="no-result" role="alert">
              {NO_RESULT_TEXT}
            </p>
          )
        ) : (
          <>
            <p data-field="outcome">
              Result: <strong data-field="result-word">{o.word}</strong>
              {o.reason === null ? '' : ` · ${o.reason}`}
              {props.rewardText === undefined ? '' : ` · ${props.rewardText}`}
            </p>
            <p class="muted">
              The result of the battle is already in your run. Continue to go on
              as after a watched battle.
            </p>
          </>
        )}
        {props.error ? (
          <p class="error" role="alert" data-field="continue-error">
            {props.error}
          </p>
        ) : null}
        {canContinue ? (
          <button
            type="button"
            class="primary"
            id="battle-continue"
            disabled={pressed}
            onClick={() => {
              gate.current?.();
            }}
          >
            {pressed ? 'Continue ✓' : 'Continue'}
          </button>
        ) : (
          <button
            type="button"
            class="primary"
            id="battle-to-menu"
            onClick={() => {
              navigate('#/');
            }}
          >
            Back to the menu
          </button>
        )}
      </Panel>
    </div>
  );
}
