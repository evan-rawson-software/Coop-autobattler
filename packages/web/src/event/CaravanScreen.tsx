/**
 * The Caravan draft (RS-4h): the rewards as cards, whose turn it is, and who
 * took what. On your turn a plain reward is one press; the Upgrade and Node
 * rewards ask their sub-choice (which building, which cell) on the same turn.
 * You may change your pick until the next player has chosen.
 */
import { useMemo, useState } from 'preact/hooks';
import type { Cell } from '@game/core';
import { SKIP_CHOICE } from '@game/session';
import { useStore } from '../app-state.js';
import { reasonMessage } from '../build/reasons.js';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import type { RunHandle } from '../run/handle.js';
import { GameFrame } from '../shell/GameFrame.js';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import '../choice/choice.css';
import './caravan.css';
import { VeinPicker } from './VeinPicker.js';
import {
  caravanScreen,
  nodeChoice,
  type CaravanCard,
} from './caravan-model.js';

export function CaravanResolve(props: { run: RunHandle }) {
  const { session, deps } = props.run;
  const view = useStore(session.store);
  const run = view.run;
  const acting = view.acting;
  const m = useMemo(
    () => caravanScreen(run, gameConfigs.events, content, acting, deps),
    [run, acting, deps],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The reward marked (not sent until the button), and its sub-choice.
  const [marked, setMarked] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  if (m === null) return null;

  const card = m.cards.find((c) => c.id === marked) ?? null;
  const canAct = m.role !== 'wait';
  const sending = (choice: string): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void session.dispatch({ type: 'event_choose', choice }).then((r) => {
      setBusy(false);
      if (r.ok) {
        setMarked(null);
        setSub(null);
        setCell(null);
      } else {
        setError(reasonMessage(r.reason, r.detail));
      }
    });
  };
  const back = (): void => {
    setMarked(null);
    setSub(null);
    setCell(null);
  };

  // What the primary button sends, and what it says.
  let choice: string | null = null;
  let label = canAct ? 'Take a reward' : 'Waiting';
  if (m.mustSkip && canAct) {
    choice = SKIP_CHOICE;
    label = 'Nothing to take: pass';
  } else if (card !== null && canAct) {
    if (card.kind === 'upgrade') {
      const row = m.upgrades.find((u) => String(u.building) === sub);
      choice = row === undefined ? null : row.choice(card.id);
      label = row === undefined ? 'Pick a building' : `Raise ${row.name}`;
    } else if (card.kind === 'node') {
      choice = cell === null ? null : nodeChoice(card.id, cell);
      label = cell === null ? 'Pick a cell' : `Add ${card.title}`;
    } else {
      choice = card.id;
      label = `${m.role === 'change' ? 'Change to' : 'Take'} ${card.title}`;
    }
  }
  const sameAsPick = choice !== null && choice === m.mine;

  const onCard = (c: CaravanCard): void => {
    setMarked(c.id);
    setSub(null);
    setCell(null);
  };
  const subChoice =
    card !== null && (card.kind === 'upgrade' || card.kind === 'node');
  const node =
    card !== null && card.kind === 'node' && card.resource !== null
      ? {
          resource: card.resource,
          resourceName: card.title.replace(/ node$/, ''),
          cells: m.cells,
          chosen: cell,
        }
      : null;

  return (
    <GameFrame
      phase="event"
      title={`Round ${String(run.round)} · ${m.eventTitle}`}
      primary={{
        id: 'caravan-take',
        label,
        class: 'primary',
        disabled: busy || !canAct || choice === null || sameAsPick,
        attrs: { 'data-action': 'caravan-take' },
        onPress: () => {
          if (choice !== null) sending(choice);
        },
      }}
      tray={
        subChoice ? (
          <button
            type="button"
            data-action="caravan-back"
            disabled={busy}
            onClick={back}
          >
            Back to the rewards
          </button>
        ) : (
          <p class="tray-text" data-field="tray-hint">
            {m.headline}
          </p>
        )
      }
      info={
        <>
          <div class="choice-banner panel">
            <strong data-field="prompt">{m.headline}</strong>
          </div>
          <ol class="caravan-order" data-field="order">
            {m.rows.map((r) => (
              <li key={r.player} data-state={r.state}>
                <span class="caravan-name">{r.name}</span>
                <span class="caravan-text">{r.text}</span>
              </li>
            ))}
          </ol>
          <p class="muted">One reward is left over when everyone has chosen.</p>
          {error === null ? null : (
            <p class="error" role="alert">
              {error}
            </p>
          )}
        </>
      }
      board={
        subChoice && card.kind === 'node' && node !== null ? (
          m.cells.length === 0 ? (
            <div class="choice-screen" id="event-resolve">
              <p class="muted" data-field="no-cells">
                No free cell for a node in your area.
              </p>
            </div>
          ) : (
            <VeinPicker
              run={run}
              acting={acting}
              vein={node}
              marked={cell}
              onMark={setCell}
            />
          )
        ) : subChoice ? (
          <div class="choice-screen" id="event-resolve">
            <ul class="event-cards follow" data-count={m.upgrades.length}>
              {m.upgrades.map((u) => (
                <li key={u.building}>
                  <button
                    type="button"
                    class={
                      sub === String(u.building)
                        ? 'event-card selected'
                        : 'event-card'
                    }
                    data-action="caravan-building"
                    data-building={String(u.building)}
                    disabled={busy}
                    onClick={() => {
                      setSub(String(u.building));
                    }}
                  >
                    <header class="event-card-head">
                      <span class="event-icon" aria-hidden="true">
                        <SpriteIcon name={u.def} size={40} />
                      </span>
                      <h2 data-field="title">{u.name}</h2>
                    </header>
                    <p class="workshop-where" data-field="where">
                      {u.where}
                    </p>
                    <div class="event-lines" data-field="does">
                      <p>{`Tier ${String(u.tier)} → ${String(u.newTier)} · free`}</p>
                      {u.gains === '' ? null : <p>{u.gains}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div class="choice-screen" id="caravan-draft">
            <ul
              class="event-cards follow caravan-cards"
              data-count={m.cards.length}
            >
              {m.cards.map((c) => {
                const free = c.holder === null;
                const takeable = free && c.disabledReason === null;
                const pickable = canAct && (takeable || c.mine);
                const cls = [
                  'event-card',
                  'caravan-card',
                  marked === c.id || (marked === null && c.mine)
                    ? 'selected'
                    : '',
                  c.holder !== null && !c.mine ? 'taken' : '',
                ]
                  .filter((x) => x !== '')
                  .join(' ');
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      class={cls}
                      data-action="caravan-item"
                      data-item={c.id}
                      data-kind={c.kind}
                      data-holder={c.holder === null ? '' : String(c.holder)}
                      data-party-wide={c.partyWide ? 'true' : 'false'}
                      disabled={busy || !pickable}
                      onClick={() => {
                        onCard(c);
                      }}
                    >
                      <header class="event-card-head">
                        <span class="event-icon" aria-hidden="true">
                          <SpriteIcon
                            name={c.sprite}
                            {...(c.kind === 'building'
                              ? { size: 40 }
                              : { scale: 2 })}
                          />
                        </span>
                        <h2 data-field="title">{c.title}</h2>
                      </header>
                      {c.partyWide ? (
                        <p class="caravan-wide" data-field="party-wide">
                          For the whole party
                        </p>
                      ) : null}
                      <div class="event-lines" data-field="does">
                        {c.lines.map((l) => (
                          <p key={l}>{l}</p>
                        ))}
                      </div>
                      {c.holderText === null ? null : (
                        <p class="caravan-holder" data-field="holder">
                          {c.mine ? 'Your pick' : c.holderText}
                        </p>
                      )}
                      {c.disabledReason === null ? null : (
                        <p class="error" data-field="disabled-reason">
                          {c.disabledReason}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      }
    />
  );
}
