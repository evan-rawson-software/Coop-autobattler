/**
 * The specialist pick (wireframe 5b, RS-13): the first step of a new run,
 * before the Core placement. Four cards, the whole roster, each with its
 * family, bonus and signature building. A click sends `pick_specialist`; the
 * pick can be changed until the player is Ready (Unready reopens it, CP-17a).
 * In a local party each player picks through the acting-player switch of the
 * run bar. The party panel shows every player's pick as soon as it is made
 * (RS-13b). Nothing is timed and there is no skip: Ready needs a pick.
 */
import { useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { reasonMessage } from '../build/reasons.js';
import { screenText, screenTexts } from '../build/texts.js';
import type { RunHandle } from '../run/handle.js';
import { Panel } from '../shell/AppShell.js';
import { GameFrame } from '../shell/GameFrame.js';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import { partyPicks, specialistCards } from './view-model.js';
import './specialist.css';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

export function SpecialistScreen(props: { run: RunHandle }) {
  const { session } = props.run;
  const view = useStore(session.store);
  const run = view.run;
  const acting = view.acting;
  const [problem, setProblem] = useState<{
    acting: number;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const cards = specialistCards(run, acting);
  const rows = partyPicks(run);
  const mine = run.team.specialists?.[acting] ?? null;
  const isReady = run.perPlayer[acting]?.ready === true;
  const shown = problem?.acting === acting ? problem.text : null;

  const send = (intent: Parameters<typeof session.dispatch>[0]): void => {
    if (busy) return;
    setBusy(true);
    void session.dispatch(intent).then((r) => {
      setBusy(false);
      setProblem(
        r.ok ? null : { acting, text: reasonMessage(r.reason, r.detail) },
      );
    });
  };

  const pick = (id: string): void => {
    // A repeat click on the pick changes nothing: send nothing.
    if (id === mine) return;
    if (isReady) {
      setProblem({ acting, text: reasonMessage('locked_ready') });
      return;
    }
    send({ type: 'pick_specialist', specialist: id });
  };

  const primary = isReady
    ? {
        id: 'specialist-unready',
        label: (
          <>
            <SpriteIcon name="ui_icon_ready" scale={1} class="ready-icon" />
            Unready
          </>
        ),
        class: 'on',
        disabled: busy,
        onPress: () => {
          send({ type: 'unready' });
        },
      }
    : {
        id: 'specialist-ready',
        label: (
          <>
            {t('uiPrimaryPickReady')}
            <span class="primary-sub">{t('uiPrimaryPickReadySub')}</span>
          </>
        ),
        disabled: mine === null || busy,
        onPress: () => {
          send({ type: 'ready' });
        },
      };

  const onKey = (e: KeyboardEvent): boolean => {
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const c = cards[Number(e.key) - 1];
      if (c === undefined) return false;
      pick(c.id);
      return true;
    }
    return false;
  };

  return (
    <GameFrame
      phase="specialist"
      title={`New run · ${t('specialistTitle')}`}
      primary={primary}
      onKey={onKey}
      tray={
        <p class="tray-text" data-field="specialist-note">
          {mine === null ? t('specialistNeedPick') : t('specialistNote')}
        </p>
      }
      info={
        <Panel
          title={t('specialistPartyTitle')}
          id="panel-specialists"
          class="specialist-party"
        >
          <ul class="party-picks" data-field="party-picks">
            {rows.map((r) => (
              <li
                key={r.player}
                class={r.player === acting ? 'mine' : undefined}
                data-player={r.player}
                data-status={r.status}
              >
                <span class="who">{r.name}</span>
                <span class="what" data-field="party-pick">
                  {r.pick}
                </span>
                <span class="muted state" data-field="party-state">
                  {r.statusText}
                </span>
              </li>
            ))}
          </ul>
          {shown === null ? null : (
            <p class="error" role="alert" data-field="specialist-problem">
              {shown}
            </p>
          )}
        </Panel>
      }
      board={
        <div class="choice-screen specialist-screen" id="specialist-pick">
          <div class="choice-head">
            <h2 data-field="specialist-prompt">{t('specialistTitle')}</h2>
            <p data-field="specialist-subtitle">{t('specialistSubtitle')}</p>
          </div>
          <ul class="specialist-cards">
            {cards.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  class={
                    c.mine ? 'specialist-card selected' : 'specialist-card'
                  }
                  data-action="pick-specialist"
                  data-specialist={c.id}
                  aria-pressed={c.mine}
                  disabled={busy}
                  onClick={() => {
                    pick(c.id);
                  }}
                >
                  <span class="slot-key">{i + 1}</span>
                  <header class="specialist-card-head">
                    <h3 data-field="specialist-name">{c.name}</h3>
                    <span class="muted" data-field="specialist-family">
                      {c.family}
                    </span>
                  </header>
                  <h4 class="specialist-label">{t('specialistBonusLabel')}</h4>
                  <p data-field="specialist-bonus">{c.bonus}</p>
                  <h4 class="specialist-label">
                    {t('specialistSignatureLabel')}
                  </h4>
                  <p
                    class="specialist-signature"
                    data-field="specialist-signature"
                  >
                    {c.signature}
                  </p>
                  <p class="muted" data-field="specialist-description">
                    {c.description}
                  </p>
                  <ul class="specialist-who" data-field="specialist-who">
                    {c.pickedBy.map((n, j) => (
                      <li key={j}>{n}</li>
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
