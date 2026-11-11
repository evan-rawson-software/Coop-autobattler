/**
 * The Battle screen of a run: plays back the battle that was just fought (the
 * result is already in the run state), shows the reward and lets the player
 * continue with Ready. The playback position is kept, so a reload resumes the
 * battle where it was.
 */
import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { reasonMessage } from '../build/reasons.js';
import type { RunHandle } from '../run/handle.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import { BattleView } from './BattleScreen.js';
import {
  describeRunBattle,
  readTick,
  tickKey,
  writeTick,
} from './run-battle.js';

export function RunBattleScreen(props: { run: RunHandle }) {
  const { session, deps } = props.run;
  const run = useStore(session.store).run;
  const [error, setError] = useState<string | null>(null);
  // One description per battle: replacing it would simulate the battle again.
  const built = useMemo(
    () => describeRunBattle(run, deps),
    [run.runId, run.actionCounter, deps],
  );
  const key = tickKey(run);
  const initialTick = useMemo(() => readTick(key), [key]);

  const ready = (): void => {
    setError(null);
    void session.dispatch({ type: 'ready' }).then((r) => {
      if (!r.ok && r.reason !== 'already_ready') {
        setError(reasonMessage(r.reason, r.detail));
      }
    });
  };

  if (!built.ok) {
    return (
      <AppShell title={`Round ${String(run.round)} · Battle`}>
        <div class="run-blocked">
          <Panel title="The battle cannot be shown">
            <p data-field="reason">{built.message}</p>
            <p class="muted">
              The result of the battle is still in your run. You can continue.
            </p>
            <button type="button" class="primary" onClick={ready}>
              Continue
            </button>
          </Panel>
        </div>
      </AppShell>
    );
  }
  const b = built.value;
  return (
    <BattleView
      key={key}
      battle={b.battle}
      opponent={b.opponent}
      title={b.title}
      reward={b.reward}
      initialTick={initialTick}
      onTick={(t) => {
        writeTick(key, t);
      }}
      onReady={ready}
      topBarExtra={
        error === null ? undefined : (
          <span class="error" role="alert">
            {error}
          </span>
        )
      }
    />
  );
}
