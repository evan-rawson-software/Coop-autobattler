/**
 * Which player this device acts as. The prototype is played locally, so one
 * person can control every player of a party; this is shown only for a party of
 * two or more, and says in words who still has to act in the current step.
 */
import type { RunState } from '@game/session';
import { useEffect, useRef, useState } from 'preact/hooks';
import { screenText, screenTexts } from '../build/texts.js';

const text = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

/** What a screen reader hears when the acting player changes. */
export function actingAnnouncement(name: string): string {
  return text('uiSwitchAnnounce', { name });
}

/**
 * A visually hidden live region: empty on first render, then the new acting
 * player's name each time `acting` changes.
 */
export function ActingAnnouncer(props: { acting: number; name: string }) {
  const first = useRef(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setMessage(actingAnnouncement(props.name));
  }, [props.acting]);
  return (
    <span class="sr-only" aria-live="polite" data-field="acting-announce">
      {message}
    </span>
  );
}

/** Whether player `i` has nothing left to do in the current step. */
export function isDone(run: RunState, i: number): boolean {
  if (run.votes !== null) return run.votes.choices[i] != null;
  return run.perPlayer[i]?.ready === true;
}

export function ActingSwitch(props: {
  run: RunState;
  acting: number;
  onActing?: ((player: number) => void) | undefined;
}) {
  const { run, acting } = props;
  if (run.players.length < 2 || props.onActing === undefined) return null;
  const waiting = run.players.filter((_, i) => !isDone(run, i));
  return (
    <div class="party-switch" id="acting-switch">
      <span class="muted fine">{text('uiSwitchPlayingAs')}</span>
      <span role="group" aria-label={text('uiSwitchGroup')}>
        {run.players.map((p, i) => (
          <button
            type="button"
            key={i}
            class={i === acting ? 'active' : ''}
            data-action="act-as"
            data-player={i}
            aria-pressed={i === acting}
            aria-label={text(
              isDone(run, i) ? 'uiSwitchLabelDone' : 'uiSwitchLabelToAct',
              { name: p.name },
            )}
            onClick={() => props.onActing?.(i)}
          >
            {p.name} {text(isDone(run, i) ? 'uiSwitchDone' : 'uiSwitchToAct')}
          </button>
        ))}
      </span>
      <span class="muted fine" data-field="waiting-for">
        {waiting.length === 0
          ? text('uiSwitchEveryoneDone')
          : text('uiSwitchWaiting', {
              names: waiting.map((p) => p.name).join(', '),
            })}
      </span>
      <ActingAnnouncer acting={acting} name={run.players[acting]?.name ?? ''} />
    </div>
  );
}
