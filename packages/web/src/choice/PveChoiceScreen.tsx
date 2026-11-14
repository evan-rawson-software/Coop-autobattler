/**
 * The PvE difficulty choice (issue #303): three cards, each selectable; the
 * primary button (Space) casts the player's vote (`vote` with the option id),
 * and in a solo run the battle follows at once.
 */
import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { reasonMessage } from '../build/reasons.js';
import { screenText, screenTexts } from '../build/texts.js';
import { simConfig } from '../build/setup.js';
import type { RunHandle } from '../run/handle.js';
import { Panel } from '../shell/AppShell.js';
import { GameFrame } from '../shell/GameFrame.js';
import { isTutorialRun } from '../tutorial/tutorial-flag.js';
import { pveChoiceView } from './view-model.js';
import './choice.css';

export function PveChoiceScreen(props: { run: RunHandle }) {
  const { session, deps } = props.run;
  const view = useStore(session.store);
  const run = view.run;
  const acting = view.acting;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const v = useMemo(
    () => pveChoiceView(run, deps, simConfig, acting),
    [run, acting, deps],
  );

  const choose = (id: string): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void session.dispatch({ type: 'vote', choice: id }).then((r) => {
      setBusy(false);
      if (!r.ok) setError(reasonMessage(r.reason, r.detail));
    });
  };

  // The card the primary button (Space) fights: the one selected with a click
  // or a number key, else the player's standing vote. Nothing is voted until
  // Fight is pressed. On a tutorial run's first round Easy starts selected.
  const [marked, setMarked] = useState<string | null>(() =>
    run.round === 1 && isTutorialRun(props.run.runId)
      ? (v?.cards.find((c) => c.difficulty === 'Easy')?.id ?? null)
      : null,
  );
  const votedId = v?.cards.find((c) => c.voted)?.id ?? null;
  const target = marked ?? votedId;
  const targetCard = v?.cards.find((c) => c.id === target);
  const firstFight = run.round === 1 && isTutorialRun(props.run.runId);

  if (v === null) {
    return (
      <GameFrame
        phase="opponent"
        title={`Round ${String(run.round)} · Stronghold battle`}
        primary={null}
        board={
          <p class="muted pad" role="status">
            The battle options are not available.
          </p>
        }
      />
    );
  }

  const onKey = (e: KeyboardEvent): boolean => {
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const c = v.cards[Number(e.key) - 1];
      if (c === undefined) return false;
      setMarked(c.id);
      return true;
    }
    return false;
  };

  return (
    <GameFrame
      phase="opponent"
      title={`Round ${String(v.round)} · Stronghold battle`}
      primary={{
        id: 'pve-fight',
        label: `${screenText(screenTexts, 'choiceFight')}${
          targetCard === undefined ? '' : ` ${targetCard.difficulty}`
        }`,
        attrs: { 'data-action': 'fight' },
        disabled: busy || target === null || target === votedId,
        onPress: () => {
          if (target !== null) choose(target);
        },
      }}
      onKey={onKey}
      tray={
        <p class="tray-text" data-field="stakes">
          {screenText(screenTexts, 'choiceStakes')}
        </p>
      }
      info={
        <Panel title={screenText(screenTexts, 'choiceTitle')} id="panel-choice">
          <p class="tray-text" data-field="overload-shared">
            {screenText(screenTexts, 'choiceOverloadShared', {
              at: v.overloadAt,
            })}
          </p>
          {error === null ? null : (
            <p class="error" role="alert">
              {error}
            </p>
          )}
        </Panel>
      }
      board={
        <div class="choice-screen" id="pve-choice">
          <div class="choice-head">
            <h2 data-field="choice-prompt">
              {screenText(screenTexts, 'choiceTitle')}
            </h2>
            <p data-field="choice-subtitle">
              {screenText(screenTexts, 'choiceSubtitle')}
            </p>
          </div>
          <ul class="pve-cards">
            {v.cards.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  class={
                    c.id === target
                      ? 'pve-card selected'
                      : c.voted
                        ? 'pve-card voted'
                        : 'pve-card'
                  }
                  data-action="select"
                  data-difficulty={c.id}
                  aria-pressed={c.id === target}
                  title={c.overload}
                  disabled={busy}
                  onClick={() => {
                    setMarked(c.id);
                  }}
                  onDblClick={() => {
                    setMarked(c.id);
                    choose(c.id);
                  }}
                >
                  <span class="slot-key">{i + 1}</span>
                  <header class="pve-card-head">
                    <h3 data-field="difficulty">{c.difficulty}</h3>
                    <span
                      class="pips"
                      role="img"
                      aria-label={`Threat level ${String(c.level)} of 3: ${c.levelText}`}
                      data-level={c.level}
                      data-field="threat-level"
                    >
                      {[1, 2, 3].map((n) => (
                        <span key={n} class={n <= c.level ? 'pip on' : 'pip'} />
                      ))}
                    </span>
                    {firstFight && c.difficulty === 'Easy' ? (
                      <span class="pve-badge" data-field="best">
                        {screenText(screenTexts, 'choiceBest')}
                      </span>
                    ) : null}
                  </header>
                  <div class="pve-reward">
                    <strong data-field="reward">{c.rewardAmount}</strong>
                    <span>{c.rewardUnit}</span>
                  </div>
                  <h4 class="pve-archetype" data-field="archetype">
                    {c.archetype}
                  </h4>
                  <p class="pve-desc" data-field="description">
                    {c.description}
                  </p>
                  <ul class="facts" data-field="facts">
                    {c.facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </button>
              </li>
            ))}
          </ul>
        </div>
      }
    />
  );
}
