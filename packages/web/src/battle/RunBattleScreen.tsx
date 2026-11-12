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
import { AppShell } from '../shell/AppShell.js';
import { CannotShow } from './CannotShow.js';
import { BattleView } from './BattleScreen.js';
import {
  clearRunTicks,
  clearTick,
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

  /** Resolves true when Ready was accepted (or already was), else shows why. */
  const ready = (): Promise<boolean> => {
    setError(null);
    return session.dispatch({ type: 'ready' }).then((r) => {
      if (r.ok) {
        // Past this battle: its playback position is not needed any more.
        clearTick(key);
        if (r.state.step === 'run_over') clearRunTicks(run.runId);
        return true;
      }
      if (r.reason === 'already_ready') return true;
      setError(reasonMessage(r.reason, r.detail));
      return false;
    });
  };

  if (!built.ok) {
    return (
      <AppShell title={`Round ${String(run.round)} · Battle`}>
        <CannotShow
          message={built.message}
          outcome={built.outcome}
          onContinue={built.outcome === null ? undefined : ready}
          error={error}
        />
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
      stored={{
        won: b.won,
        eventLogHash: b.storedEventLogHash,
        ...(b.reason === null ? {} : { reason: b.reason }),
      }}
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
