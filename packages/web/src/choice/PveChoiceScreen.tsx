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
import { AppShell } from '../shell/AppShell.js';
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

  if (v === null) {
    return (
      <AppShell title={`Round ${String(run.round)} · Stronghold battle`}>
        <p class="muted pad" role="status">
          The battle options are not available.
        </p>
      </AppShell>
    );
  }
  return (
    <AppShell title={`Round ${String(v.round)} · Stronghold battle`}>
      <div class="choice-screen" id="pve-choice">
        <div class="choice-banner panel">
          <h2 class="choice-prompt" data-field="choice-prompt">
            {screenText(screenTexts, 'choiceSubtitle')}
          </h2>
          <p>
            <strong>{v.stakes}</strong>
          </p>
        </div>
        <ul class="pve-cards">
          {v.cards.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                class={c.voted ? 'pve-card selected' : 'pve-card'}
                data-action="choose"
                data-difficulty={c.id}
                disabled={busy}
                onClick={() => {
                  choose(c.id);
                }}
              >
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
        {error === null ? null : (
          <p class="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </AppShell>
  );
}
