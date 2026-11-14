/**
 * The main menu (wireframe 5): New run, the saved runs (no limit; resume or
 * abandon each), and the records. Solo only for now, so Join and Settings are
 * left out. Developer links reach the sandbox screens.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { hashStore, navigate, useStore } from '../app-state.js';
import { NOT_SAVED_TEXT } from '../run/RunGate.js';
import {
  abandonSavedRun,
  closeRun,
  createNewRun,
  discardSavedRun,
} from '../run/run-store.js';
import {
  playersFromHash,
  reviewRunHash,
  runHash,
  seedFromHash,
} from '../run/router.js';
import { getServices, type GameServices } from '../run/services.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import { resetTips } from '../shell/phase-tips.js';
import './menu.css';
import {
  menuRows,
  recentRunRows,
  recordRows,
  RECENT_RUNS_SHOWN,
  type MenuRow,
  type RecentRunRow,
  type RecordRow,
  hasRecords,
} from './view-model.js';
import { count, plural } from '../plural.js';
import { screenText, screenTexts } from '../build/texts.js';
import {
  hasFinishedFirstRun,
  markTutorialRun,
} from '../tutorial/tutorial-flag.js';
import { completedStore } from '../tutorial/tutorial-store.js';

const text = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

interface MenuData {
  readonly services: GameServices;
  readonly rows: readonly MenuRow[];
  readonly records: readonly RecordRow[];
  readonly recent: readonly RecentRunRow[];
  readonly now: number;
  /** Does any party size have a deepest round yet? */
  readonly anyRecords: boolean;
  /** Runs finished or abandoned so far (the history the save store keeps). */
  readonly finishedRuns: number;
  readonly startingLives: number;
}

/** The developer tools show in dev and debug builds, or with `?dev` in the URL. */
export function devToolsVisible(
  isDevBuild: boolean,
  search: string,
  hash: string,
): boolean {
  if (isDevBuild) return true;
  const inHash = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  return [search, inHash].some((q) => new URLSearchParams(q).has('dev'));
}

const DEV_LINKS: readonly { readonly hash: string; readonly label: string }[] =
  [
    { hash: '#debug', label: 'Debug board' },
    { hash: '#build', label: 'Build sandbox' },
    { hash: '#battle', label: 'Sample battles' },
    { hash: '#shop', label: 'Sample shop' },
    { hash: '#sprites', label: 'Sprite sheets' },
  ];

async function load(): Promise<MenuData> {
  const services = await getServices();
  const [items, best, history] = await Promise.all([
    services.saves.list(),
    services.saves.bestDepthByPartySize(),
    services.saves.listHistory().catch(() => []),
  ]);
  // Only runs whose summary was kept are listed; look at the newest first.
  const kept = new Set<string>();
  const newest = [...history].sort((a, b) => b.finishedAt - a.finishedAt);
  for (const h of newest) {
    if (kept.size >= RECENT_RUNS_SHOWN) break;
    const rec = await services.finished.get(h.runId).catch(() => null);
    if (rec !== null) kept.add(h.runId);
  }
  const now = Date.now();
  return {
    services,
    rows: menuRows(items, now, services.deps.rules.startingLives),
    records: recordRows(best),
    anyRecords: hasRecords(best),
    finishedRuns: history.length,
    startingLives: services.deps.rules.startingLives,
    recent: recentRunRows(history, (id) => kept.has(id)),
    now,
  };
}

/** The confirmation of "Remove save": what it deletes, said plainly. */
function RemoveConfirm(props: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div class="run-actions confirm" role="alertdialog">
      <p data-field="remove-warning">
        Delete this save? This cannot be undone.
      </p>
      <button
        type="button"
        class="danger"
        data-action="discard-confirm"
        onClick={props.onConfirm}
      >
        Remove save
      </button>
      <button
        type="button"
        data-action="abandon-cancel"
        onClick={props.onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

export function MainMenuScreen() {
  const [data, setData] = useState<MenuData | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ghostNote, setGhostNote] = useState<string | null>(null);
  const [tipsNote, setTipsNote] = useState(false);
  const hash = useStore(hashStore);
  const seed = seedFromHash(hash);
  const alive = useRef(true);

  const refresh = (): void => {
    void load().then(
      (d) => {
        if (alive.current) {
          setData(d);
          setFailure(null);
        }
      },
      (e: unknown) => {
        if (alive.current) {
          setFailure(e instanceof Error ? e.message : String(e));
        }
      },
    );
  };

  useEffect(() => {
    alive.current = true;
    // Leaving a run for the menu closes it: the saved copy is the truth.
    closeRun();
    refresh();
    const onFocus = (): void => {
      refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    registerDebug({
      menu: {
        storage: () => data?.services.storage ?? 'loading',
        runIds: () => (data?.rows ?? []).map((r) => r.runId),
      },
    });
    return () => {
      unregisterDebug('menu');
    };
  }, [data]);

  const showDev = devToolsVisible(
    import.meta.env.DEV || import.meta.env.MODE === 'debug',
    typeof window === 'undefined' ? '' : window.location.search,
    hash,
  );

  const clearGhosts = (): void => {
    void getServices()
      .then((sv) => sv.ghosts.clear())
      .then(
        () => {
          setGhostNote('Saved opponents cleared.');
        },
        (e: unknown) => {
          setGhostNote(
            `Saved opponents could not be cleared (${e instanceof Error ? e.message : String(e)}).`,
          );
        },
      );
  };

  const newRun = (tutorial: boolean): void => {
    if (starting) return;
    setStarting(true);
    setNotice(null);
    void createNewRun(seed ?? undefined, playersFromHash(hash)).then((r) => {
      setStarting(false);
      if (r.ok) {
        if (tutorial) markTutorialRun(r.runId);
        navigate(runHash(r.runId));
      } else setNotice(r.message);
    });
  };

  const abandon = (runId: string): void => {
    setAsking(null);
    void abandonSavedRun(runId).then((r) => {
      if (!r.ok) {
        setNotice(r.message);
        refresh();
      } else if (r.state === null) {
        setNotice('Run removed.');
        refresh();
      } else navigate(runHash(runId));
    });
  };

  const discard = (runId: string): void => {
    setAsking(null);
    void discardSavedRun(runId).then((r) => {
      setNotice(r.ok ? 'The save was removed.' : r.message);
      refresh();
    });
  };

  const savedCount = (data?.rows ?? []).length;
  const resumable = (data?.rows ?? []).find(
    (r): r is Extract<MenuRow, { kind: 'run' }> =>
      r.kind === 'run' && r.blocked === null,
  );
  const tutorialDone = useStore(completedStore);
  const firstRunDone =
    tutorialDone || hasFinishedFirstRun(data?.finishedRuns ?? 0);

  const wiped = [
    ...(data?.services.init.wiped ?? []),
    ...(data?.services.init.wipedUnreadable ?? []),
  ];

  return (
    <AppShell title="Main menu">
      <div class="menu" id="main-menu">
        <section class="menu-left">
          <p class="muted eyebrow">{text('menuEyebrow')}</p>
          <h2 class="game-title">Coop Autobattler</h2>
          <p class="pitch">{text('menuPitch')}</p>
          {resumable === undefined ? null : (
            <button
              type="button"
              id="continue-button"
              class="big"
              onClick={() => {
                navigate(runHash(resumable.runId));
              }}
            >
              {text('menuContinue')}
            </button>
          )}
          {firstRunDone ? (
            <>
              <button
                type="button"
                id="new-run-button"
                class="primary big"
                disabled={starting || data === null}
                onClick={() => {
                  newRun(false);
                }}
              >
                {text('menuNewRun')}
              </button>
              <button
                type="button"
                id="tutorial-button"
                class="text-link"
                disabled={starting || data === null}
                onClick={() => {
                  newRun(true);
                }}
              >
                {text('menuPlayTutorial')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                id="tutorial-button"
                class="primary big"
                disabled={starting || data === null}
                onClick={() => {
                  newRun(true);
                }}
              >
                {text('menuPlayTutorial')}
                <span class="hint">{text('menuPlayTutorialHint')}</span>
              </button>
              <button
                type="button"
                id="new-run-button"
                class="big"
                disabled={starting || data === null}
                onClick={() => {
                  newRun(false);
                }}
              >
                {text('menuNewRunSkip')}
              </button>
            </>
          )}
          {seed === null ? null : <p class="muted fine">Seed {seed}</p>}
          <button
            type="button"
            id="show-tips"
            class="text-link"
            onClick={() => {
              resetTips();
              setTipsNote(true);
            }}
          >
            {text('menuShowTips')}
          </button>
          {tipsNote ? (
            <p class="muted fine" role="status" data-field="tips-note">
              {text('menuShowTipsDone')}
            </p>
          ) : null}
          {data === null || data.anyRecords ? (
            <Panel title="Records · deepest round" id="panel-records">
              <ul class="records" id="records">
                {(data?.records ?? []).map((r) => (
                  <li key={r.label}>
                    <span>{r.label}</span>
                    <strong>{r.value}</strong>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <p class="muted records-line" id="records-line">
              {text('menuRecordsLine', {
                deepest: text('menuRecordsNoneYet'),
                saved:
                  savedCount === 0
                    ? text('menuRecordsNone')
                    : String(savedCount),
              })}
            </p>
          )}
          {data !== null && data.recent.length > 0 ? (
            <Panel title="Recent runs" id="recent-runs" class="recent">
              <ul class="run-list">
                {data.recent.map((r) => (
                  <li key={r.runId} class="run-row" data-recent={r.runId}>
                    <span data-field="recent-text">{r.text}</span>
                    <button
                      type="button"
                      data-action="open-summary"
                      onClick={() => {
                        navigate(reviewRunHash(r.runId));
                      }}
                    >
                      View summary
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {showDev ? (
            <details class="developer">
              <summary>Developer</summary>
              <ul class="plain">
                {DEV_LINKS.map((l) => (
                  <li key={l.hash}>
                    <a href={l.hash}>{l.label}</a>
                  </li>
                ))}
              </ul>
              <p>
                <button
                  type="button"
                  data-action="clear-ghosts"
                  title="Deletes the opponents saved from earlier runs. New runs start with the built-in ones."
                  onClick={clearGhosts}
                >
                  Clear saved opponents
                </button>
              </p>
              {ghostNote === null ? null : (
                <p class="muted fine" role="status" data-field="ghost-note">
                  {ghostNote}
                </p>
              )}
              <p class="muted fine">
                Add <code>?seed=5</code> after <code>#/</code> to start the next
                run with that seed.
              </p>
            </details>
          ) : null}
        </section>

        <div class="menu-right">
          <Panel title={text('menuRoundTitle')} id="how-a-round-works">
            <ol class="steps">
              {(['Build', 'Fight', 'Reward'] as const).map((name, i) => (
                <li key={name} class="step">
                  <span class="step-icon" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <h3>{text(`menuStep${name}Title`)}</h3>
                    <p>{text(`menuStep${name}Body`)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p class="lives-rule">
              <span class="step-icon heart" aria-hidden="true">
                ♥
              </span>
              {text('menuLivesRule', {
                lives: String(data?.startingLives ?? 5),
              })}
            </p>
          </Panel>
          <section class="panel" id="panel-saved">
            <h2 class="panel-title">Saved runs</h2>
            <div class="panel-body saved">
              {data?.services.storage === 'memory' ? (
                <p class="not-saved" id="not-saved-note" role="note">
                  {NOT_SAVED_TEXT}
                </p>
              ) : null}
              {wiped.length === 0 ? null : (
                <p class="menu-note" role="status" data-field="wiped">
                  {`${count(wiped.length, 'saved run')} from an older version of the game ${plural(wiped.length, 'was', 'were')} removed.`}
                </p>
              )}
              {notice === null ? null : (
                <p class="menu-note" role="status" data-field="notice">
                  {notice}
                </p>
              )}
              {failure === null ? null : (
                <p class="error" role="alert">
                  Could not read your saved runs: {failure}
                </p>
              )}
              {data === null && failure === null ? (
                <p class="muted" role="status">
                  Loading…
                </p>
              ) : null}
              {data !== null && data.rows.length === 0 ? (
                <p class="muted" id="no-runs">
                  No saved runs.
                </p>
              ) : null}
              <ul class="run-list" id="run-list">
                {(data?.rows ?? []).map((row) =>
                  row.kind === 'run' ? (
                    <li key={row.runId} class="run-row" data-run={row.runId}>
                      <div class="run-info">
                        <h3 data-field="title">{row.title}</h3>
                        <p data-field="detail">{row.detail}</p>
                        <p class="muted" data-field="played">
                          Last played {row.playedAgo}
                        </p>
                        {row.note === null ? null : (
                          <p class="muted" data-field="note">
                            {row.note}
                          </p>
                        )}
                        {row.blocked === null ? null : (
                          <p class="error-text" data-field="blocked">
                            {row.blocked}
                          </p>
                        )}
                      </div>
                      {asking === row.runId ? (
                        row.blocked === null ? (
                          <div class="run-actions confirm" role="alertdialog">
                            <p data-field="abandon-warning">
                              Abandon this run? It will end and can’t be
                              resumed. Its deepest round still counts toward
                              Records.
                            </p>
                            <button
                              type="button"
                              class="danger"
                              data-action="abandon-confirm"
                              onClick={() => {
                                abandon(row.runId);
                              }}
                            >
                              Abandon it
                            </button>
                            <button
                              type="button"
                              data-action="abandon-cancel"
                              onClick={() => {
                                setAsking(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <RemoveConfirm
                            onConfirm={() => {
                              discard(row.runId);
                            }}
                            onCancel={() => {
                              setAsking(null);
                            }}
                          />
                        )
                      ) : (
                        <div class="run-actions">
                          <button
                            type="button"
                            class="primary"
                            data-action="resume"
                            disabled={row.blocked !== null}
                            onClick={() => {
                              navigate(runHash(row.runId));
                            }}
                          >
                            Resume
                          </button>
                          {row.blocked === null ? (
                            <button
                              type="button"
                              data-action="abandon"
                              onClick={() => {
                                setAsking(row.runId);
                              }}
                            >
                              Abandon
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-action="discard"
                              onClick={() => {
                                setAsking(row.runId);
                              }}
                            >
                              Remove save
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ) : (
                    <li
                      key={row.runId}
                      class="run-row damaged"
                      data-run={row.runId}
                    >
                      <div class="run-info">
                        <h3>Damaged saved run</h3>
                        <p data-field="detail">{row.message}</p>
                        <p class="muted">Last written {row.playedAgo}</p>
                      </div>
                      {asking === row.runId ? (
                        <RemoveConfirm
                          onConfirm={() => {
                            discard(row.runId);
                          }}
                          onCancel={() => {
                            setAsking(null);
                          }}
                        />
                      ) : (
                        <div class="run-actions">
                          <button
                            type="button"
                            data-action="discard"
                            onClick={() => {
                              setAsking(row.runId);
                            }}
                          >
                            Remove save
                          </button>
                        </div>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
