/**
 * The event step (wireframe 2) and its follow-up. `EventChoiceScreen` opens
 * with the result of the battle just fought and what it paid, then one to
 * three event cards. `EventResolveScreen` is the picked event's own question
 * (Workshop: which building; Shrine: which modifier). Solo: one press is the
 * whole vote (`vote`, then `event_choose`).
 */
import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { reasonMessage } from '../build/reasons.js';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import type { RunHandle } from '../run/handle.js';
import { AppShell } from '../shell/AppShell.js';
import '../choice/choice.css';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import { screenText, screenTexts } from '../build/texts.js';
import { battleHeader, eventCards, followUpView } from './view-model.js';

export function EventChoiceScreen(props: { run: RunHandle }) {
  const { session, deps } = props.run;
  const view = useStore(session.store);
  const run = view.run;
  const acting = view.acting;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const header = useMemo(() => battleHeader(run, deps), [run, deps]);
  const cards = useMemo(() => eventCards(run, acting), [run, acting]);

  const choose = (id: string): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void session.dispatch({ type: 'vote', choice: id }).then((r) => {
      setBusy(false);
      if (!r.ok) setError(reasonMessage(r.reason, r.detail));
    });
  };

  return (
    <AppShell title={`Round ${String(run.round)} · Event`}>
      <div class="choice-screen" id="event-choice">
        {header === null ? null : (
          <div
            class={`choice-banner panel result ${header.won ? 'won' : 'lost'}`}
            id="battle-result"
          >
            <strong data-field="result-text">{header.text}</strong>
            {' · '}
            <span data-field="payout">{header.payout}</span>
          </div>
        )}
        <h2 class="choice-prompt" data-field="event-prompt">
          {screenText(screenTexts, 'eventSubtitle')}
        </h2>
        <ul class="event-cards" data-count={cards.length}>
          {cards.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                class={c.voted ? 'event-card selected' : 'event-card'}
                data-action="choose-event"
                data-offer={c.id}
                data-type={c.type}
                disabled={busy}
                onClick={() => {
                  choose(c.id);
                }}
              >
                <header class="event-card-head">
                  <span class="event-icon" aria-hidden="true">
                    <SpriteIcon
                      name={`ui_event_${c.type}`}
                      scale={2}
                      fallback={c.icon}
                    />
                  </span>
                  <h2 data-field="title">{c.title}</h2>
                </header>
                <div class="event-lines" data-field="does">
                  {c.lines.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </div>
                {c.flavour === '' ? null : <p class="muted">{c.flavour}</p>}
                <span class="pve-fight" data-field="choose">
                  {screenText(screenTexts, 'eventChoose')}
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

export function EventResolveScreen(props: { run: RunHandle }) {
  const { session, deps } = props.run;
  const view = useStore(session.store);
  const run = view.run;
  const acting = view.acting;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const v = useMemo(
    () => followUpView(run, gameConfigs.events, content, acting, deps),
    [run, acting, deps],
  );

  const choose = (id: string): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void session.dispatch({ type: 'event_choose', choice: id }).then((r) => {
      setBusy(false);
      if (r.ok) setPicked(null);
      if (!r.ok) setError(reasonMessage(r.reason, r.detail));
    });
  };
  const options = v?.options ?? [];
  const cards = options.filter((o) => !o.skip);
  const skip = options.find((o) => o.skip);
  const shrine = cards.length > 0 && cards.every((o) => o.building === null);
  // Workshop: a row is only selected until the button confirms it.
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? v?.voted ?? null;
  const selectedRow = cards.find((o) => o.id === selected);
  const confirmPrice = selectedRow?.building?.price ?? null;

  return (
    <AppShell
      title={`Round ${String(run.round)} · ${v?.eventTitle ?? 'Event'}`}
    >
      <div class="choice-screen" id="event-resolve">
        {shrine ? (
          <h2 class="choice-prompt" data-field="prompt">
            {screenText(screenTexts, 'eventSubtitle')}
          </h2>
        ) : (
          <div class="choice-banner panel">
            <strong data-field="prompt">{v?.prompt ?? 'Make a choice'}</strong>
          </div>
        )}
        <ul class="event-cards follow" data-count={cards.length}>
          {cards.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                class={selected === o.id ? 'event-card selected' : 'event-card'}
                data-action="choose-option"
                data-option={o.id}
                data-placed={o.building?.placed === true ? 'true' : 'false'}
                data-affordable={o.affordable ? 'true' : 'false'}
                disabled={busy || !o.affordable}
                onClick={() => {
                  if (shrine) choose(o.id);
                  else setPicked(o.id);
                }}
              >
                {shrine ? (
                  <header class="event-card-head">
                    <span class="event-icon" aria-hidden="true">
                      <SpriteIcon
                        name="ui_event_shrine"
                        scale={2}
                        fallback="✦"
                      />
                    </span>
                    <h2 data-field="title">{o.title}</h2>
                  </header>
                ) : (
                  <h2 data-field="title">{o.title}</h2>
                )}
                {o.building === null ? null : (
                  <p class="workshop-where" data-field="where">
                    {o.building.where}
                  </p>
                )}
                <div class="event-lines" data-field="does">
                  {(o.building === null ? o.lines : o.lines.slice(1)).map(
                    (l) => (
                      <p key={l}>{l}</p>
                    ),
                  )}
                  {o.stacks ? (
                    <p
                      class="stacks-tag"
                      data-field="stacks"
                      title="You can take this bonus again; the bonuses add up."
                    >
                      Stacks (can be taken again)
                    </p>
                  ) : null}
                </div>
                {o.disabledReason === null ? null : (
                  <p class="error" data-field="disabled-reason">
                    {o.disabledReason}
                  </p>
                )}
                {shrine ? (
                  <span class="pve-fight" data-field="choose">
                    {screenText(screenTexts, 'eventChoose')}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {shrine ? null : (
          <p class="follow-skip">
            <button
              type="button"
              data-action="confirm-upgrade"
              class="primary"
              disabled={
                busy ||
                selectedRow === undefined ||
                (picked === null && v?.voted === selected)
              }
              onClick={() => {
                if (selected !== null) choose(selected);
              }}
            >
              {confirmPrice === null
                ? 'Upgrade'
                : `Upgrade · ${String(confirmPrice)} gold`}
            </button>
            {skip === undefined ? null : (
              <button
                type="button"
                data-action="choose-option"
                data-option={skip.id}
                class={v?.voted === skip.id ? 'selected' : undefined}
                disabled={busy}
                onClick={() => {
                  setPicked(null);
                  choose(skip.id);
                }}
              >
                Skip (no upgrade)
              </button>
            )}
          </p>
        )}
        {v?.waiting == null ? null : (
          <p class="muted" role="status" data-field="waiting">
            {v.waiting}
          </p>
        )}
        {v === null || v.chosen.length < 2 ? null : (
          <ul class="follow-chosen" data-field="chosen">
            {v.chosen.map((c) => (
              <li key={c.player}>
                {c.name}: {c.status}
              </li>
            ))}
          </ul>
        )}
        {error === null ? null : (
          <p class="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </AppShell>
  );
}
