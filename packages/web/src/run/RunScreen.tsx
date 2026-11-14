/**
 * The route `#run/<id>`: the run at its current step. It loads the run into
 * the run store, then lets the step decide which screen shows (`router.ts`).
 * The screens read the run from the store and change it by intents only.
 *
 * Also the states around it: loading, a run that changed in another tab, a
 * saved run that cannot be opened, a run that has ended, and the prompt when
 * a run was saved by an older version.
 */
import { hashJson } from '@game/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { hashStore, navigate, useStore } from '../app-state.js';
import { RunBattleScreen } from '../battle/RunBattleScreen.js';
import { BuildView } from '../build/BuildScreen.js';
import { PveChoiceScreen } from '../choice/PveChoiceScreen.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import { RunOverScreen } from '../end/RunOverScreen.js';
import { EventChoiceScreen, EventResolveScreen } from '../event/EventScreen.js';
import { CoreScreen } from '../placement/CoreScreen.js';
import { AppShell, Panel, RunBarContext } from '../shell/AppShell.js';
import { GameFrame } from '../shell/GameFrame.js';
import {
  PhaseContext,
  nextPhaseAfterResult,
  phaseForStep,
  type PhaseInfo,
} from '../shell/phase.js';
import { markTipSeen } from '../shell/phase-tips.js';
import { screenText, screenTexts } from '../build/texts.js';
import { RunBar } from './RunBar.js';
import { isReviewHash, screenForStep, runIdFromHash } from './router.js';
import {
  acknowledgeVersionNotice,
  discardSavedRun,
  needsVersionPrompt,
  reloadRun,
  watchRun,
  runStore,
  showRun,
  type ActiveRun,
} from './run-store.js';
import { gameDeps } from './services.js';
import './run.css';

function Blocked(props: { title: string; children: ComponentChildren }) {
  return (
    <AppShell title="Run">
      <div class="run-blocked">
        <Panel title={props.title}>{props.children}</Panel>
      </div>
    </AppShell>
  );
}

function MenuButton() {
  return (
    <button
      type="button"
      id="to-menu"
      onClick={() => {
        navigate('#/');
      }}
    >
      Main menu
    </button>
  );
}

function Conflict(props: { runId: string }) {
  return (
    <Blocked title={screenText(screenTexts, 'uiRunConflictTitle')}>
      <div id="run-conflict" role="alert">
        <p>{screenText(screenTexts, 'uiRunConflictBody')}</p>
        <button
          type="button"
          id="run-reload"
          class="primary"
          onClick={() => {
            void reloadRun(props.runId);
          }}
        >
          Reload
        </button>
        <MenuButton />
      </div>
    </Blocked>
  );
}

function VersionPrompt(props: { onContinue: () => void }) {
  return (
    <div class="modal-backdrop">
      <div
        class="modal"
        role="alertdialog"
        aria-labelledby="version-title"
        id="version-prompt"
      >
        <h2 id="version-title">Saved on an older version</h2>
        <p>Some things may have changed since this run was saved.</p>
        <div class="modal-buttons">
          <button
            type="button"
            class="primary"
            id="version-continue"
            onClick={props.onContinue}
          >
            Continue
          </button>
          <MenuButton />
        </div>
      </div>
    </div>
  );
}

function ReadyRun(props: { run: ActiveRun }) {
  const { run } = props;
  const view = useStore(run.session.store);
  const conflict = useStore(run.conflict);
  const [, bump] = useState(0);
  const state = view.run;
  const maxLives = run.deps.rules.startingLives;

  const screen = screenForStep(state.step);

  useEffect(() => {
    registerDebug({
      run: {
        screen: () => screen,
        state: () => ({
          runId: state.runId,
          step: state.step,
          round: state.round,
          leg: state.leg,
          lives: state.lives,
          gold: state.perPlayer[run.session.acting]?.gold ?? 0,
          acting: run.session.acting,
          ready: state.perPlayer.map((p) => p.ready),
          voted: state.votes?.choices.map((c) => c !== null) ?? null,
          actions: state.actionCounter,
          history: state.history.length,
          pvpOpponent:
            state.pvpOpponent === null
              ? null
              : {
                  round: state.pvpOpponent.round,
                  kind: state.pvpOpponent.kind,
                  label: state.pvpOpponent.label,
                },
          hash: hashJson(state),
          storage: run.storage,
        }),
      },
    });
    return () => {
      unregisterDebug('run');
    };
  }, [screen, state, run.storage]);

  const bar = useMemo(
    () => (
      <RunBar
        state={state}
        maxLives={maxLives}
        storage={run.storage}
        session={run.session}
      />
    ),
    [state, maxLives, run.storage],
  );

  // The phase for the stepper and the tips. A tip counts as seen once the
  // player has moved on from its phase (or left the run), or dismissed it.
  const phase = phaseForStep(state.step);
  useEffect(() => {
    if (phase === null) return undefined;
    return () => {
      markTipSeen(phase);
    };
  }, [phase]);
  const runEnds =
    state.thisRound.pvp?.won === false &&
    state.lives - run.deps.rules.pvpLossLifeCost <= 0;
  const phaseInfo: PhaseInfo | null =
    phase === null
      ? null
      : {
          phase,
          round: state.round,
          leg: state.leg,
          next: nextPhaseAfterResult(state.step, runEnds),
        };

  if (conflict) return <Conflict runId={run.runId} />;

  let body: ComponentChildren;
  switch (screen) {
    case 'core':
      body = <CoreScreen run={run} />;
      break;
    case 'build':
      body = <BuildView shared={run} />;
      break;
    case 'pve_choice':
      body = <PveChoiceScreen run={run} />;
      break;
    case 'battle':
      body = <RunBattleScreen run={run} />;
      break;
    case 'event_choice':
      body = <EventChoiceScreen run={run} />;
      break;
    case 'event_resolve':
      body = <EventResolveScreen run={run} />;
      break;
    case 'run_over':
      body = <RunOverScreen state={state} startingLives={maxLives} />;
      break;
    case 'transient':
      body = (
        <GameFrame
          phase="battle"
          title="Battle"
          primary={null}
          board={
            <p class="muted pad" role="status">
              Resolving battle…
            </p>
          }
        />
      );
      break;
  }
  return (
    <RunBarContext.Provider value={bar}>
      <PhaseContext.Provider value={phaseInfo}>{body}</PhaseContext.Provider>
      {needsVersionPrompt(run) ? (
        <VersionPrompt
          onContinue={() => {
            acknowledgeVersionNotice(run.runId);
            bump((n) => n + 1);
          }}
        />
      ) : null}
    </RunBarContext.Provider>
  );
}

function BlockedRun(props: { runId: string; message: string; reason: string }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Another tab may replace the save while this panel is shown: look again.
  useEffect(
    () =>
      watchRun(props.runId, () => {
        void reloadRun(props.runId);
      }),
    [props.runId],
  );
  return (
    <Blocked title={screenText(screenTexts, 'uiRunUnopenableTitle')}>
      <div id="run-unopenable" role="alert">
        <p data-field="reason">{props.message}</p>
        <p class="muted">
          {screenText(screenTexts, 'uiRunUnopenableKept')}
          {props.reason === 'load_failed'
            ? ''
            : ` ${screenText(screenTexts, 'uiRunRemoveNote')}`}
        </p>
        {error === null ? null : <p class="error">{error}</p>}
        {asking ? (
          <>
            <p data-field="remove-warning">
              {screenText(screenTexts, 'uiRunRemoveWarning')}
            </p>
            <button
              type="button"
              class="danger"
              id="run-discard-confirm"
              onClick={() => {
                void discardSavedRun(props.runId).then((r) => {
                  if (r.ok) navigate('#/');
                  else setError(r.message);
                });
              }}
            >
              Remove save
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
              }}
            >
              Keep it
            </button>
          </>
        ) : (
          <>
            {props.reason === 'load_failed' ? (
              <button
                type="button"
                class="primary"
                id="run-retry"
                onClick={() => {
                  void reloadRun(props.runId);
                }}
              >
                Try again
              </button>
            ) : (
              <button
                type="button"
                class="danger"
                id="run-discard"
                onClick={() => {
                  setAsking(true);
                }}
              >
                Remove save
              </button>
            )}
            <MenuButton />
          </>
        )}
      </div>
    </Blocked>
  );
}

export function RunScreen() {
  const hash = useStore(hashStore);
  const runId = runIdFromHash(hash);
  const st = useStore(runStore);

  useEffect(() => {
    if (runId !== null) void showRun(runId);
  }, [runId]);

  if (runId === null) {
    return (
      <Blocked title="No run">
        <p>There is no run in this address.</p>
        <MenuButton />
      </Blocked>
    );
  }
  const current =
    st.status === 'ready'
      ? st.run.runId
      : st.status === 'idle'
        ? null
        : st.runId;
  if (current !== runId) {
    return (
      <AppShell title="Run">
        <p class="muted pad" id="run-loading" role="status">
          Loading…
        </p>
      </AppShell>
    );
  }
  switch (st.status) {
    case 'idle':
    case 'loading':
      return (
        <AppShell title="Run">
          <p class="muted pad" id="run-loading" role="status">
            Loading…
          </p>
        </AppShell>
      );
    case 'ready':
      return <ReadyRun run={st.run} />;
    case 'over': {
      const maxLives = gameDeps().rules.startingLives;
      // A reopened summary is not the live run: no Lives/Gold bar.
      if (isReviewHash(hash)) {
        return (
          <RunOverScreen
            state={st.state}
            startingLives={maxLives}
            readOnly
            finishedAt={st.finishedAt}
          />
        );
      }
      return (
        <RunBarContext.Provider
          value={<RunBar state={st.state} maxLives={maxLives} />}
        >
          <RunOverScreen state={st.state} startingLives={maxLives} />
        </RunBarContext.Provider>
      );
    }
    case 'ended':
      return (
        <Blocked title="This run has ended">
          <p data-field="reason">
            {st.entry === null
              ? 'This run is over.'
              : `This run ended at round ${String(st.entry.round)}.`}
          </p>
          <MenuButton />
        </Blocked>
      );
    case 'missing':
      return (
        <Blocked title="Run not found">
          <p data-field="reason">No saved run at this address.</p>
          <MenuButton />
        </Blocked>
      );
    case 'blocked':
      return (
        <BlockedRun runId={runId} message={st.message} reason={st.reason} />
      );
    case 'error':
      return (
        <Blocked title="Could not open the run">
          <p class="error" data-field="reason">
            {st.message}
          </p>
          <MenuButton />
        </Blocked>
      );
  }
}
