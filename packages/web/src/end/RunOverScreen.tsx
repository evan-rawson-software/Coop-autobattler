/**
 * The Run over screen (wireframe 9): shown when lives reach 0 and when a run
 * is abandoned from the menu. It reads the final state of the run, which the
 * run store keeps after the save is gone, so it opens again after a reload.
 */
import type { HistoryEntry, RunState } from '@game/session';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { navigate } from '../app-state.js';
import { BoardView } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
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
  roundRows,
  runStats,
} from './view-model.js';

const camera = new CameraController();
camera.resetPreset = 'fit';
camera.refitOnResize = true;

function Tally(props: { won: number; lost: number }) {
  return (
    <span>
      {props.won} won · {props.lost} lost
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
    <AppShell title="Run over" status={<span class="muted">{names}</span>}>
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
          <Panel title="This run" id="panel-this-run">
            <dl class="stats">
              <dt>PvP battles</dt>
              <dd data-field="pvp">
                <Tally {...stats.pvp} />
              </dd>
              <dt class="sub">vs. ghosts</dt>
              <dd>
                <Tally {...stats.pvpGhosts} />
              </dd>
              <dt class="sub">vs. bosses</dt>
              <dd>
                <Tally {...stats.pvpBosses} />
              </dd>
              <dt>PvE battles</dt>
              <dd data-field="pve">
                <Tally {...stats.pve} />
              </dd>
              <dt class="sub">by difficulty</dt>
              <dd>
                {(['easy', 'medium', 'hard'] as const)
                  .map((d) => `${d} ${String(stats.pveByDifficulty[d] ?? 0)}`)
                  .join(' · ')}
              </dd>
              <dt>Lives lost</dt>
              <dd data-field="lives-lost">{stats.livesLost}</dd>
              <dt>Version</dt>
              <dd>{state.runVersion}</dd>
            </dl>
          </Panel>

          <Panel title="Final factory" id="panel-final-factory">
            <div class="final-board" id="final-factory">
              <BoardView
                content={content}
                own={state.team}
                controller={camera}
                resetKey={`${state.runId}:final`}
                frontLabel="FRONT EDGE"
              />
            </div>
            <p class="muted" data-field="factory-counts">
              {counts.buildings}{' '}
              {counts.buildings === 1 ? 'building' : 'buildings'} placed ·{' '}
              {counts.atTier3} at tier 3 · {counts.stash} in stash
            </p>
          </Panel>

          <Panel title="Round by round" id="panel-rounds">
            {rows.length === 0 ? (
              <p class="muted">No battle was fought.</p>
            ) : (
              <table class="rounds" id="round-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>PvE</th>
                    <th />
                    <th>PvP opponent</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.round} data-round={r.round}>
                      <td>{r.round}</td>
                      <td>{r.pve}</td>
                      <td class={r.pveResult}>{r.pveResult}</td>
                      <td>{r.pvp}</td>
                      <td class={r.pvpResult}>{r.pvpResult}</td>
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
              New run
            </button>
            <button
              type="button"
              id="over-menu"
              onClick={() => {
                navigate('#/');
              }}
            >
              Main menu
            </button>
          </div>
          {error === null ? null : (
            <p class="error" role="alert">
              {error}
            </p>
          )}
          <p class="muted">
            The run leaves your saved runs. Its depth is kept in your records.
            Nothing else carries over to the next run.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
