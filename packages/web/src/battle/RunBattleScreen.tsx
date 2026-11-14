/**
 * The Battle screen of a run: plays back the battle that was just fought (the
 * result is already in the run state), shows the reward and lets the player
 * continue with Ready. The playback position is kept, so a reload resumes the
 * battle where it was.
 */
import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { reasonMessage } from '../build/reasons.js';
import { screenText, screenTexts } from '../build/texts.js';
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
  const { run, acting } = useStore(session.store);
  const [error, setError] = useState<string | null>(null);
  // One description per battle: replacing it would simulate the battle again.
  // A player's Ready bumps the action counter but is not another battle, so
  // the screen is keyed by the step, not the counter: Ready must not restart
  // the replay or forget that it was pressed.
  const battleId = `${run.runId}:${String(run.round)}:${run.leg}:${run.step}`;
  const built = useMemo(() => describeRunBattle(run, deps), [battleId, deps]);
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
  // After a Stronghold summary comes the event; after a Rival party loss that
  // costs the last life the run ends, and Continue is all there is to say.
  const endsRun =
    b.kind === 'pvp' && !b.won && run.lives - deps.rules.pvpLossLifeCost <= 0;
  const continueText = endsRun
    ? screenText(screenTexts, 'battleContinue')
    : screenText(screenTexts, 'battleContinueEvent');
  return (
    <BattleView
      key={battleId}
      battle={b.battle}
      opponent={b.opponent}
      title={b.title}
      reward={b.reward}
      stored={{
        won: b.won,
        eventLogHash: b.storedEventLogHash,
        ...(b.reason === null ? {} : { reason: b.reason }),
      }}
      acting={acting}
      ready={run.perPlayer[acting]?.ready === true}
      initialTick={initialTick}
      onTick={(t) => {
        writeTick(key, t);
      }}
      onReady={ready}
      continueText={continueText}
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
