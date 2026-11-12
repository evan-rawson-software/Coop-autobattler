/**
 * Which player this device acts as. The prototype is played locally, so one
 * person can control every player of a party; this is shown only for a party of
 * two or more, and says in words who still has to act in the current step.
 */
import type { RunState } from '@game/session';

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
      <span class="muted fine">Playing as</span>
      <span role="group" aria-label="Acting player">
        {run.players.map((p, i) => (
          <button
            type="button"
            key={i}
            class={i === acting ? 'active' : ''}
            data-action="act-as"
            data-player={i}
            aria-pressed={i === acting}
            onClick={() => props.onActing?.(i)}
          >
            {p.name} {isDone(run, i) ? '(done)' : '(to act)'}
          </button>
        ))}
      </span>
      <span class="muted fine" data-field="waiting-for">
        {waiting.length === 0
          ? 'Everyone is done.'
          : `Waiting for: ${waiting.map((p) => p.name).join(', ')}`}
      </span>
    </div>
  );
}
