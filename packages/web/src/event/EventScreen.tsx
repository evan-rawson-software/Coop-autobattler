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
import { Panel } from '../shell/AppShell.js';
import { GameFrame } from '../shell/GameFrame.js';
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
  const cards = useMemo(
    () => eventCards(run, acting, gameConfigs.events),
    [run, acting],
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

  // The card the primary button (Space) takes: the one selected with a click
  // or a number key, else the standing vote, else the first. Nothing is voted
  // until the button is pressed.
  const [marked, setMarked] = useState<string | null>(null);
  const votedId = cards.find((c) => c.voted)?.id ?? null;
  const target = marked ?? votedId ?? cards[0]?.id ?? null;
  const targetCard = cards.find((c) => c.id === target);
  const onKey = (e: KeyboardEvent): boolean => {
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const c = cards[Number(e.key) - 1];
      if (c === undefined) return false;
      setMarked(c.id);
      return true;
    }
    return false;
  };

  return (
    <GameFrame
      phase="event"
      title={`Round ${String(run.round)} · Event`}
      primary={{
        id: 'event-choose',
        label: `${screenText(screenTexts, 'eventChoose')}${
          targetCard === undefined ? '' : ` ${targetCard.title}`
        }`,
        disabled: busy || target === null || target === votedId,
        onPress: () => {
          if (target !== null) choose(target);
        },
      }}
      onKey={onKey}
      tray={
        <p class="tray-text" data-field="tray-hint">
          {screenText(screenTexts, 'eventTrayPick')}
        </p>
      }
      info={
        <>
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
          <Panel class="event-next">
            <p class="tray-text" data-field="next">
              {screenText(
                screenTexts,
                run.leg === 'pve' ? 'eventNextRival' : 'eventNextBuild',
              )}
            </p>
          </Panel>
          {error === null ? null : (
            <p class="error" role="alert">
              {error}
            </p>
          )}
        </>
      }
      board={
        <div class="choice-screen" id="event-choice">
          <ul class="event-cards" data-count={cards.length}>
            {cards.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  class={
                    c.id === target
                      ? 'event-card selected'
                      : c.voted
                        ? 'event-card voted'
                        : 'event-card'
                  }
                  data-action="choose-event"
                  data-offer={c.id}
                  data-type={c.type}
                  aria-pressed={c.id === target}
                  disabled={busy}
                  onClick={() => {
                    setMarked(c.id);
                  }}
                >
                  <span class="slot-key">{i + 1}</span>
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
                    {c.drawbacks.map((l) => (
                      <p key={l} class="event-drawback" data-field="drawback">
                        {l}
                      </p>
                    ))}
                  </div>
                  {c.flavour === '' ? null : <p class="muted">{c.flavour}</p>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      }
    />
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

  const upgradePrimary = {
    id: 'confirm-upgrade',
    label:
      v?.free === true
        ? 'Raise · Free'
        : confirmPrice === null
          ? 'Upgrade'
          : `Upgrade · ${String(confirmPrice)} gold`,
    class: 'primary',
    disabled:
      busy ||
      selectedRow === undefined ||
      (picked === null && v?.voted === selected),
    attrs: { 'data-action': 'confirm-upgrade' },
    onPress: () => {
      if (selected !== null) choose(selected);
    },
  };
  const shrineId = selected ?? cards.find((o) => o.affordable)?.id ?? null;
  const shrineRow = cards.find((o) => o.id === shrineId);
  const shrinePrimary = {
    id: 'event-choose',
    label: `${screenText(screenTexts, 'eventChoose')}${
      shrineRow === undefined ? '' : ` ${shrineRow.title}`
    }`,
    disabled: busy || shrineRow === undefined || v?.voted === shrineId,
    onPress: () => {
      if (shrineId !== null) choose(shrineId);
    },
  };
  const onKey = (e: KeyboardEvent): boolean => {
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const o = cards[Number(e.key) - 1];
      if (o === undefined || !o.affordable) return false;
      setPicked(o.id);
      return true;
    }
    if (e.key === 'Escape' && picked !== null) {
      setPicked(null);
      return true;
    }
    return false;
  };

  return (
    <GameFrame
      phase="event"
      title={`Round ${String(run.round)} · ${v?.eventTitle ?? 'Event'}`}
      primary={shrine ? shrinePrimary : upgradePrimary}
      onKey={onKey}
      tray={
        shrine ? (
          <p class="tray-text" data-field="tray-hint">
            {screenText(screenTexts, 'eventTrayShrine')}
          </p>
        ) : skip === undefined ? null : (
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
        )
      }
      info={
        <>
          {shrine ? null : (
            <div class="choice-banner panel">
              <strong data-field="prompt">
                {v?.prompt ?? 'Make a choice'}
              </strong>
            </div>
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
        </>
      }
      board={
        <div class="choice-screen" id="event-resolve">
          <ul class="event-cards follow" data-count={cards.length}>
            {cards.map((o, i) => (
              <li key={o.id}>
                <button
                  type="button"
                  class={
                    selected === o.id || (shrine && shrineId === o.id)
                      ? 'event-card selected'
                      : 'event-card'
                  }
                  data-action="choose-option"
                  data-option={o.id}
                  data-placed={o.building?.placed === true ? 'true' : 'false'}
                  data-affordable={o.affordable ? 'true' : 'false'}
                  disabled={busy || !o.affordable}
                  onClick={() => {
                    setPicked(o.id);
                  }}
                >
                  <span class="slot-key">{i + 1}</span>
                  <header class="event-card-head">
                    <span class="event-icon" aria-hidden="true">
                      {o.building === null ? (
                        <SpriteIcon
                          name="ui_event_shrine"
                          scale={2}
                          fallback="✦"
                        />
                      ) : (
                        <SpriteIcon name={o.building.def} size={40} />
                      )}
                    </span>
                    <h2 data-field="title">{o.title}</h2>
                  </header>
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
                </button>
              </li>
            ))}
          </ul>
        </div>
      }
    />
  );
}
