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
import { playersFromHash, runHash, seedFromHash } from '../run/router.js';
import { getServices, type GameServices } from '../run/services.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import './menu.css';
import {
  menuRows,
  recordRows,
  type MenuRow,
  type RecordRow,
} from './view-model.js';
import { count, plural } from '../plural.js';

interface MenuData {
  readonly services: GameServices;
  readonly rows: readonly MenuRow[];
  readonly records: readonly RecordRow[];
  readonly now: number;
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
  const [items, best] = await Promise.all([
    services.saves.list(),
    services.saves.bestDepthByPartySize(),
  ]);
  const now = Date.now();
  return {
    services,
    rows: menuRows(items, now, services.deps.rules.startingLives),
    records: recordRows(best),
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

  const clearGhosts = (): void => {
    void getServices()
      .then((sv) => sv.ghosts.clear())
      .then(
        () => {
          setGhostNote('The ghost pool is empty.');
        },
        (e: unknown) => {
          setGhostNote(
            `The ghost pool could not be cleared (${e instanceof Error ? e.message : String(e)}).`,
          );
        },
      );
  };

  const newRun = (): void => {
    if (starting) return;
    setStarting(true);
    setNotice(null);
    void createNewRun(seed ?? undefined, playersFromHash(hash)).then((r) => {
      setStarting(false);
      if (r.ok) navigate(runHash(r.runId));
      else setNotice(r.message);
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

  const wiped = [
    ...(data?.services.init.wiped ?? []),
    ...(data?.services.init.wipedUnreadable ?? []),
  ];

  return (
    <AppShell title="Main menu">
      <div class="menu" id="main-menu">
        <section class="menu-left">
          <h2 class="game-title">Coop Autobattler</h2>
          <p class="muted">co-op factory autobattler · 1–4 players</p>
          <button
            type="button"
            id="new-run-button"
            class="primary big"
            disabled={starting || data === null}
            onClick={newRun}
          >
            New run
          </button>
          {seed === null ? null : <p class="muted fine">Seed {seed}</p>}
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
                onClick={clearGhosts}
              >
                Clear ghost pool
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
        </section>

        <section class="menu-right panel">
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
                          <p>Abandon this run?</p>
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
    </AppShell>
  );
}
