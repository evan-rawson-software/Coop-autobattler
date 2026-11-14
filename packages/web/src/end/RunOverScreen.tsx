/**
 * The Run over screen (wireframe 9): shown when lives reach 0 and when a run
 * is abandoned from the menu. It reads the final state of the run, which the
 * run store keeps after the save is gone, so it opens again after a reload.
 */
import type { HistoryEntry, RunState } from '@game/session';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import { navigate } from '../app-state.js';
import { BoardView } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { screenText, screenTexts } from '../build/texts.js';
import { content } from '../content.js';
import { clearRunTicks } from '../battle/run-battle.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import { createNewRun, randomSeed } from '../run/run-store.js';
import { runHash, seedFromHash } from '../run/router.js';
import { getServices } from '../run/services.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import './end.css';
import {
  bestView,
  factoryCounts,
  headline,
  resultText,
  roundRows,
  runStats,
} from './view-model.js';

const camera = new CameraController();
camera.resetPreset = 'fit';
camera.refitOnResize = true;

function Tally(props: { won: number; lost: number }) {
  return (
    <span>
      {screenText(screenTexts, 'runOverTally', {
        won: String(props.won),
        lost: String(props.lost),
      })}
    </span>
  );
}

export function RunOverScreen(props: {
  state: RunState;
  startingLives: number;
}) {
  const { state, startingLives } = props;
  const [history, setHistory] = useState<readonly HistoryEntry[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A finished run needs no battle playback positions (a reload of Run over,
  // or a crash before the ready handler cleaned up, still ends here).
  useEffect(() => {
    clearRunTicks(state.runId);
  }, [state.runId]);

  useEffect(() => {
    let cancelled = false;
    void getServices()
      .then((s) => s.saves.listHistory())
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [state.runId]);

  useEffect(() => {
    registerDebug({
      run: {
        screen: () => 'run_over',
        state: () => ({
          runId: state.runId,
          step: state.step,
          round: state.round,
          lives: state.lives,
          outcome: state.outcome,
          history: state.history.length,
        }),
      },
    });
    return () => {
      unregisterDebug('run');
    };
  }, [state]);

  const head = headline(state);
  const best = useMemo(
    () => (history === null ? null : bestView(state, history)),
    [state, history],
  );
  const stats = useMemo(
    () => runStats(state, startingLives),
    [state, startingLives],
  );
  const rows = useMemo(() => roundRows(state.history), [state]);
  const counts = factoryCounts(state.team);
  const names = state.players.map((p) => p.name).join(' + ');

  const newRun = (): void => {
    if (starting) return;
    setStarting(true);
    setError(null);
    const seed = seedFromHash(window.location.hash) ?? randomSeed();
    void createNewRun(seed).then((r) => {
      setStarting(false);
      if (r.ok) navigate(runHash(r.runId));
      else setError(r.message);
    });
  };

  return (
    <AppShell
      title={screenText(screenTexts, 'runOverTitle')}
      status={<span class="muted">{names}</span>}
    >
      <div class="run-over" id="run-over">
        <section class="panel over-head">
          <div>
            <h2 id="reached" data-round={state.outcome?.round ?? state.round}>
              {head.title}
            </h2>
            <p class="muted" data-field="reason">
              {head.reason}
            </p>
          </div>
          <p
            id="best"
            data-new-best={best === null ? '' : String(best.isNewBest)}
            class={best?.isNewBest === true ? 'best new' : 'best'}
          >
            {best === null ? '' : best.text}
          </p>
        </section>

        <div class="over-grid">
          <Panel
            title={screenText(screenTexts, 'runOverPanelThisRun')}
            id="panel-this-run"
          >
            <dl class="stats">
              <dt>{screenText(screenTexts, 'runOverStatPvp')}</dt>
              <dd data-field="pvp">
                <Tally {...stats.pvp} />
              </dd>
              <dt class="sub">
                {screenText(screenTexts, 'runOverStatGhosts')}
              </dt>
              <dd>
                <Tally {...stats.pvpGhosts} />
              </dd>
              <dt class="sub">
                {screenText(screenTexts, 'runOverStatBosses')}
              </dt>
              <dd>
                <Tally {...stats.pvpBosses} />
              </dd>
              <dt>{screenText(screenTexts, 'runOverStatPve')}</dt>
              <dd data-field="pve">
                <Tally {...stats.pve} />
              </dd>
              <dt class="sub">
                {screenText(screenTexts, 'runOverStatByDifficulty')}
              </dt>
              <dd>
                {screenText(screenTexts, 'runOverByDifficultyCounts', {
                  easy: String(stats.pveByDifficulty.easy ?? 0),
                  medium: String(stats.pveByDifficulty.medium ?? 0),
                  hard: String(stats.pveByDifficulty.hard ?? 0),
                })}
              </dd>
              <dt>{screenText(screenTexts, 'runOverStatLivesLost')}</dt>
              <dd data-field="lives-lost">
                <SpriteIcon name="ui_icon_heart" scale={1} class="bar-icon" />
                {stats.livesLost}
              </dd>
              <dt>{screenText(screenTexts, 'runOverStatVersion')}</dt>
              <dd>{state.runVersion}</dd>
            </dl>
          </Panel>

          <Panel
            title={screenText(screenTexts, 'runOverPanelFactory')}
            id="panel-final-factory"
          >
            <div class="final-board" id="final-factory">
              <BoardView
                content={content}
                own={state.team}
                controller={camera}
                resetKey={`${state.runId}:final`}
                frontLabel="FRONT EDGE"
                controls={false}
              />
            </div>
            <p class="muted" data-field="factory-counts">
              {screenText(
                screenTexts,
                counts.buildings === 1
                  ? 'runOverFactoryCountsOne'
                  : 'runOverFactoryCountsMany',
                {
                  count: String(counts.buildings),
                  tier: String(counts.atTier3),
                  stash: String(counts.stash),
                },
              )}
            </p>
          </Panel>

          <Panel
            title={screenText(screenTexts, 'runOverPanelRounds')}
            id="panel-rounds"
          >
            {rows.length === 0 ? (
              <p class="muted">{screenText(screenTexts, 'runOverNoBattle')}</p>
            ) : (
              <table class="rounds" id="round-table">
                <thead>
                  <tr>
                    <th>{screenText(screenTexts, 'runOverColRound')}</th>
                    <th>{screenText(screenTexts, 'runOverColPve')}</th>
                    <th />
                    <th>{screenText(screenTexts, 'runOverColPvp')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.round} data-round={r.round}>
                      <td>{r.round}</td>
                      <td>{r.pve}</td>
                      <td class={r.pveResult}>{resultText(r.pveResult)}</td>
                      <td>{r.pvp}</td>
                      <td class={r.pvpResult}>{resultText(r.pvpResult)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <section class="panel over-next">
          <div class="over-buttons">
            <button
              type="button"
              class="primary"
              id="over-new-run"
              disabled={starting}
              onClick={newRun}
            >
              {screenText(screenTexts, 'runOverNewRun')}
            </button>
            <button
              type="button"
              id="over-menu"
              onClick={() => {
                navigate('#/');
              }}
            >
              {screenText(screenTexts, 'runOverMainMenu')}
            </button>
          </div>
          {error === null ? null : (
            <p class="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
