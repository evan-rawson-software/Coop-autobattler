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
import { ME } from '../build/session.js';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import type { RunHandle } from '../run/handle.js';
import { AppShell } from '../shell/AppShell.js';
import '../choice/choice.css';
import {
  battleHeader,
  eventCards,
  followUpView,
  type ModifierLine,
} from './view-model.js';

function Modifiers(props: { list: readonly ModifierLine[] }) {
  return (
    <ul class="modifier-list">
      {props.list.map((m) => (
        <li key={m.id} data-modifier={m.id}>
          <strong>{m.name}</strong>
          <span class="muted">
            {' '}
            {m.effects.join(' · ')}
            {m.stacks ? ' · stacks' : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EventChoiceScreen(props: { run: RunHandle }) {
  const { session, deps } = props.run;
  const run = useStore(session.store).run;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const header = useMemo(() => battleHeader(run, deps), [run, deps]);
  const cards = useMemo(() => eventCards(run, gameConfigs.events, ME), [run]);
  const word =
    cards.length === 1 ? 'one event' : `pick one of ${String(cards.length)}`;

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
    <AppShell
      title={`Round ${String(run.round)} · Event`}
      status={<span class="muted">{word}</span>}
    >
      <div class="choice-screen" id="event-choice">
        {header === null ? null : (
          <div
            class={`choice-banner panel result ${header.won ? 'won' : 'lost'}`}
            id="battle-result"
          >
            <strong data-field="result-text">{header.text}</strong>
            <span data-field="payout">{header.payout}</span>
          </div>
        )}
        <ul class="event-cards" data-count={cards.length}>
          {cards.map((c) => (
            <li
              key={c.id}
              class={c.voted ? 'event-card selected' : 'event-card'}
              data-offer={c.id}
              data-type={c.type}
            >
              <header class="event-card-head">
                <span class="event-icon" aria-hidden="true">
                  {c.icon}
                </span>
                <h2 data-field="title">{c.title}</h2>
              </header>
              <div class="event-lines" data-field="does">
                {c.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
                {c.modifiers.length > 0 ? (
                  <Modifiers list={c.modifiers} />
                ) : null}
              </div>
              {c.flavour === '' ? null : <p class="muted">{c.flavour}</p>}
              <button
                type="button"
                class="primary"
                data-action="choose-event"
                data-offer={c.id}
                disabled={busy}
                onClick={() => {
                  choose(c.id);
                }}
              >
                Take {c.title}
              </button>
            </li>
          ))}
        </ul>
        {error === null ? null : (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <p class="muted choice-foot">
          No time limit. In a party, everyone votes: most votes wins, and a tie
          is settled by a random pick among the votes.
        </p>
      </div>
    </AppShell>
  );
}

export function EventResolveScreen(props: { run: RunHandle }) {
  const { session, deps } = props.run;
  const run = useStore(session.store).run;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const v = useMemo(
    () => followUpView(run, gameConfigs.events, content, ME, deps),
    [run, deps],
  );

  const choose = (id: string): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void session.dispatch({ type: 'event_choose', choice: id }).then((r) => {
      setBusy(false);
      if (!r.ok) setError(reasonMessage(r.reason, r.detail));
    });
  };
  const options = v?.options ?? [];
  const cards = options.filter((o) => !o.skip);
  const skip = options.find((o) => o.skip);

  return (
    <AppShell
      title={`Round ${String(run.round)} · ${v?.eventTitle ?? 'Event'}`}
      status={<span class="muted">{v?.prompt ?? ''}</span>}
    >
      <div class="choice-screen" id="event-resolve">
        <div class="choice-banner panel">
          <strong data-field="prompt">{v?.prompt ?? 'Make a choice'}</strong>
          {v?.perPlayer === true ? (
            <span class="muted">
              {' '}
              Only your own buildings are listed. The price is charged when
              everyone has chosen.
            </span>
          ) : null}
        </div>
        <ul class="event-cards follow" data-count={cards.length}>
          {cards.map((o) => (
            <li
              key={o.id}
              class={v?.voted === o.id ? 'event-card selected' : 'event-card'}
              data-option={o.id}
              data-placed={o.building?.placed === true ? 'true' : 'false'}
              data-affordable={o.affordable ? 'true' : 'false'}
            >
              <h2 data-field="title">{o.title}</h2>
              {o.building === null ? null : (
                <p class="workshop-where" data-field="where">
                  {o.building.where}
                </p>
              )}
              <div class="event-lines" data-field="does">
                {(o.building === null ? o.lines : o.lines.slice(1)).map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
              {o.disabledReason === null ? null : (
                <p class="error" data-field="disabled-reason">
                  {o.disabledReason}
                </p>
              )}
              <button
                type="button"
                class="primary"
                data-action="choose-option"
                data-option={o.id}
                disabled={busy || !o.affordable}
                title={o.disabledReason ?? undefined}
                onClick={() => {
                  choose(o.id);
                }}
              >
                {v?.voted === o.id ? 'Chosen' : 'Choose'}
              </button>
            </li>
          ))}
        </ul>
        {skip === undefined ? null : (
          <p class="follow-skip">
            <button
              type="button"
              data-action="choose-option"
              data-option={skip.id}
              class={v?.voted === skip.id ? 'selected' : undefined}
              disabled={busy}
              onClick={() => {
                choose(skip.id);
              }}
            >
              {v?.voted === skip.id ? 'Skipping (chosen)' : 'Skip'}
            </button>
            <span class="muted"> Change nothing and keep your gold.</span>
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
              <li key={c.name}>
                {c.name}: {c.done ? 'has chosen' : 'choosing…'}
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
