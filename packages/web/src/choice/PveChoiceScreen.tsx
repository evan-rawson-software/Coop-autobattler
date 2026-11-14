/**
 * The PvE difficulty choice (wireframe 7): three cards, one vote. Solo: a
 * single press of a card's button is the whole vote (`vote` with the option
 * id), and the battle follows at once.
 */
import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { reasonMessage } from '../build/reasons.js';
import { screenText, screenTexts } from '../build/texts.js';
import { simConfig } from '../build/setup.js';
import type { RunHandle } from '../run/handle.js';
import { Panel } from '../shell/AppShell.js';
import { GameFrame } from '../shell/GameFrame.js';
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

  // The card the primary button (Space) fights: the player's vote, or the one
  // marked with a click or a number key. A click still votes at once.
  const [marked, setMarked] = useState<string | null>(null);
  const votedId = v?.cards.find((c) => c.voted)?.id ?? null;
  const target = marked ?? votedId ?? v?.cards[0]?.id ?? null;
  const targetCard = v?.cards.find((c) => c.id === target);

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
        disabled: busy || target === null || target === votedId,
        onPress: () => {
          if (target !== null) choose(target);
        },
      }}
      onKey={onKey}
      tray={
        <p class="tray-text" data-field="stakes">
          <span class="tray-label">
            {screenText(screenTexts, 'uiTrayRulesLabel')}
          </span>{' '}
          <strong>{v.stakes}</strong>
        </p>
      }
      info={
        <Panel title="Choose an opponent" id="panel-choice">
          <h2 class="choice-prompt" data-field="choice-prompt">
            {screenText(screenTexts, 'choiceSubtitle')}
          </h2>
          {error === null ? null : (
            <p class="error" role="alert">
              {error}
            </p>
          )}
        </Panel>
      }
      board={
        <div class="choice-screen" id="pve-choice">
          <ul class="pve-cards">
            {v.cards.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  class={
                    c.voted
                      ? 'pve-card selected'
                      : c.id === target
                        ? 'pve-card marked'
                        : 'pve-card'
                  }
                  data-action="choose"
                  data-difficulty={c.id}
                  disabled={busy}
                  onClick={() => {
                    setMarked(c.id);
                    choose(c.id);
                  }}
                >
                  <span class="slot-key">{i + 1}</span>
                  <header class="pve-card-head">
                    <h2 data-field="difficulty">{c.difficulty}</h2>
                    <span class="pve-archetype" data-field="archetype">
                      {c.archetype}
                    </span>
                  </header>
                  <p class="pve-desc" data-field="description">
                    {c.description}
                  </p>
                  <div class="pve-threat-box">
                    <span class="label">Threat</span>
                    <span
                      class="pips"
                      role="img"
                      aria-label={`Threat level ${String(c.level)} of 3: ${c.levelText}`}
                      data-level={c.level}
                    >
                      {[1, 2, 3].map((i) => (
                        <span key={i} class={i <= c.level ? 'pip on' : 'pip'} />
                      ))}
                    </span>
                    <span data-field="threat-level">{c.levelText}</span>
                  </div>
                  <ul class="facts" data-field="facts">
                    {c.facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <p class="deadline" data-field="overload">
                    {c.overload}
                  </p>
                  <div class="pve-reward">
                    <span class="label">Reward</span>
                    <strong data-field="reward">{c.rewardText}</strong>
                  </div>
                  <span class="pve-fight" data-field="fight">
                    {screenText(screenTexts, 'choiceFight')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      }
    />
  );
}
