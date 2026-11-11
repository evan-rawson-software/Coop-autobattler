/**
 * The Shop tab (W2-7): your offers, gold and re-roll, your stash and a sell
 * target, what comes next, Ready, and a small live view of the factory. It is
 * one of two tabs of the same step; the other is the Build screen. Both work
 * on the one shared run (`run/shop-run.ts`), so switching tabs loses nothing.
 *
 * Every change is an intent through the shared session, saved before the
 * screen updates. Buying, selling and re-rolling are never undoable.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { BoardView } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { economy, simConfig } from '../build/setup.js';
import { ME, type SessionView } from '../build/session.js';
import { content } from '../content.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import { NotSavedNote, RestartButton, RunGate } from '../run/RunGate.js';
import {
  ensureShopRun,
  optionsFromUrl,
  type ShopRun,
} from '../run/shop-run.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import './shop.css';
import { performAction } from './actions.js';
import { onStepTab, stepTabs } from './tabs.js';
import {
  buildShopView,
  nextBattleView,
  readyLabel,
  saleQuote,
  type NextBattleView,
  type OfferCard,
  type ShopView,
  type StashRow,
} from './view-model.js';

const miniCamera = new CameraController();
miniCamera.resetPreset = 'fit';
miniCamera.refitOnResize = true;

const ctx = { content, economy, sim: simConfig };

/** Counts mounts of the Shop tab, so the smoke script can wait for a new one. */
let mountCount = 0;

const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v)) as unknown;

/** The Shop tab: loads the shared run, then shows it. */
export function ShopScreen() {
  useEffect(() => {
    void ensureShopRun(optionsFromUrl(window.location.search));
  }, []);
  return <RunGate>{(run) => <ShopTab run={run} />}</RunGate>;
}

function Card(props: { card: OfferCard; onBuy: (slot: number) => void }) {
  const { card, onBuy } = props;
  const o = card.offer;
  if (o === null) {
    return (
      <li class="offer sold" data-slot={card.slot} data-state="sold">
        <p class="offer-empty">Sold out. Re-roll for new offers.</p>
      </li>
    );
  }
  return (
    <li
      class={card.canBuy ? 'offer' : 'offer unaffordable'}
      data-slot={card.slot}
      data-def={o.def}
      data-state={card.canBuy ? 'available' : 'locked'}
    >
      <div
        class="offer-art"
        style={{ background: `var(--kind-${o.kind.replace('_', '-')})` }}
        aria-hidden="true"
      />
      <h3 class="offer-name">{o.name}</h3>
      <p class="offer-kind">
        {o.kindLabel} · tier {o.tier}
      </p>
      <p class="offer-needs">Needs: {o.needs}</p>
      <p class="offer-effect" data-field="effect">
        {o.effect}
      </p>
      <div class="offer-buy">
        <button
          type="button"
          class="buy-btn"
          data-action="buy"
          disabled={!card.canBuy}
          aria-describedby={`why-${String(card.slot)}`}
          onClick={() => {
            onBuy(card.slot);
          }}
        >
          Buy · {o.price} gold
        </button>
        <span class="why" id={`why-${String(card.slot)}`} data-field="reason">
          {card.reason ?? ''}
        </span>
      </div>
    </li>
  );
}

function StashList(props: {
  rows: readonly StashRow[];
  pending: StashRow | null;
  onPick: (row: StashRow) => void;
  onDrag: (row: StashRow | null) => void;
}) {
  const { rows, pending, onPick, onDrag } = props;
  if (rows.length === 0) {
    return <p class="muted">Empty. Everything you own is on the board.</p>;
  }
  return (
    <ul class="shop-stash" id="shop-stash">
      {rows.map((r) => {
        const key = `${r.def}:${String(r.tier)}`;
        const selected =
          pending !== null && pending.def === r.def && pending.tier === r.tier;
        return (
          <li
            key={key}
            class={selected ? 'stash-row selected' : 'stash-row'}
            data-stash-def={r.def}
            data-stash-tier={r.tier}
            data-count={r.ids.length}
            draggable
            onDragStart={(e) => {
              e.dataTransfer?.setData('text/plain', key);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              onDrag(r);
            }}
            onDragEnd={() => {
              onDrag(null);
            }}
          >
            <span class="stash-label">
              {r.name} <span class="stash-tier">T{r.tier}</span> ×{' '}
              {r.ids.length}
            </span>
            <button
              type="button"
              data-action="sell"
              title={`Sell one for ${String(r.refund)} gold`}
              onClick={() => {
                onPick(r);
              }}
            >
              Sell · {r.refund}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function NextBattle(props: { view: NextBattleView | null }) {
  const v = props.view;
  if (v === null) {
    return <p class="muted">Nothing is known about the next battle.</p>;
  }
  if (v.kind === 'pve' || v.pvp === null) {
    return (
      <>
        <h3 class="next-title" data-field="next-kind">
          {v.title} · round {v.round}
        </h3>
        <p class="muted">
          Three options. The party votes for one before the battle.
        </p>
        <ul class="pve-options" id="next-options">
          {v.options.map((o) => (
            <li key={o.id} class="pve-option" data-difficulty={o.difficulty}>
              <span class="pve-name">
                <strong>{o.difficulty}</strong> · {o.archetype}
              </span>
              <span class="pve-threat">{o.threat}</span>
              <span class="pve-reward">Win: {o.rewardGold} gold</span>
            </li>
          ))}
        </ul>
      </>
    );
  }
  const p = v.pvp;
  return (
    <>
      <h3 class="next-title" data-field="next-kind">
        {v.title} · round {v.round}
      </h3>
      <p>{p.opponent}</p>
      <p class="stakes">
        <span>
          Win: {p.winGold === null ? 'gold' : `${String(p.winGold)} gold`}
        </span>
        <span>
          Lose: -{p.lifeCost} {p.lifeCost === 1 ? 'life' : 'lives'}
          {p.lossGold === null
            ? ''
            : `, ${String(p.lossGold)} gold consolation`}
        </span>
      </p>
    </>
  );
}

function ShopTab(props: { run: ShopRun }) {
  const { session, deps } = props.run;
  const view: SessionView = useStore(session.store);
  const run = view.run;
  const sv: ShopView = useMemo(() => buildShopView(run, ME, ctx), [run]);
  const next = useMemo(() => nextBattleView(run, deps), [run, deps]);
  const [pending, setPending] = useState<StashRow | null>(null);
  const [status, setStatus] = useState<{
    text: string;
    kind: 'info' | 'ok' | 'error';
  }>({
    text: 'Buying, selling and re-rolling cannot be undone.',
    kind: 'info',
  });
  const [mountId] = useState(() => ++mountCount);
  const dragged = useRef<StashRow | null>(null);

  // Drop a pending sale when its row is gone (sold, or the state changed).
  useEffect(() => {
    if (pending === null) return;
    const row = sv.stash.find(
      (r) => r.def === pending.def && r.tier === pending.tier,
    );
    if (row === undefined) setPending(null);
  }, [sv, pending]);

  // The hook belongs to this mount: remove it when the tab goes away so a
  // reader never sees the previous mount's data.
  useEffect(
    () => () => {
      unregisterDebug('shop');
    },
    [],
  );

  useEffect(() => {
    registerDebug({
      shop: {
        mounts: () => mountId,
        state: () =>
          plain({
            step: run.step,
            round: run.round,
            leg: run.leg,
            gold: sv.gold,
            offers: sv.offers.map((c) => c.offer?.def ?? null),
            offerPrices: sv.offers.map((c) => c.offer?.price ?? null),
            stash: run.team.stash.map((s) => ({
              id: s.id,
              def: s.def,
              tier: s.tier,
            })),
            placed: run.team.buildings.length,
            ready: sv.ready,
            actions: run.actionLog.length,
            undo: view.undoCount,
            runId: run.runId,
            next: next === null ? null : next.kind,
          }),
      },
    });
  }, [run, sv, view.undoCount, next, mountId]);

  const act = async (
    intent: Parameters<typeof session.dispatch>[0],
    okText: string,
  ): Promise<boolean> => {
    // No guard against a second action in flight: the controller queues them
    // in order and a rejected one reports its own reason.
    const r = await performAction(session, intent, okText);
    setStatus({ text: r.text, kind: r.kind });
    return r.ok;
  };

  const onBuy = (slot: number): void => {
    const card = sv.offers[slot];
    if (card?.offer == null) return;
    const { name, price } = card.offer;
    void act(
      { type: 'buy', slot },
      `Bought ${name} for ${String(price)} gold. It is in your stash.`,
    );
  };

  const onReroll = (): void => {
    void act(
      { type: 'reroll' },
      `Re-rolled for ${String(sv.reroll.cost)} gold.`,
    );
  };

  const onSell = (): void => {
    if (pending === null) return;
    const q = saleQuote(pending);
    void act(
      { type: 'sell', id: q.id },
      `Sold ${q.name} for ${String(q.refund)} gold.`,
    ).then(() => {
      setPending(null);
    });
  };

  const onReady = (): void => {
    void act(
      { type: sv.ready ? 'unready' : 'ready' },
      sv.ready ? 'Not ready.' : 'Ready. Waiting for the others.',
    );
  };

  const goBuild = (): void => {
    onStepTab('shop-build');
  };

  const solo = sv.playerCount === 1;
  const stepOpen = run.step === 'shop';

  const ready = readyLabel(run);
  const status_bar = (
    <>
      <span data-field="run-info">
        Round {run.round} · Lives {run.lives} / {deps.rules.startingLives}
        {ready === null ? '' : ` · ${ready}`}
      </span>
      <NotSavedNote run={props.run} />
    </>
  );

  if (!stepOpen) {
    return (
      <AppShell
        title={`Round ${String(run.round)} · ${run.step}`}
        status={status_bar}
      >
        <div class="placeholder" id="step-placeholder">
          <Panel title="Ready, waiting to continue" id="panel-next-step">
            <p>
              Everyone is ready. The run moved on to{' '}
              <strong data-field="step">{run.step}</strong> (round {run.round}).
              There is no screen for it yet.
            </p>
            <RestartButton />
          </Panel>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={`Round ${String(run.round)} · Shop + Build`}
      tabs={stepTabs()}
      activeTab="shop"
      onTab={onStepTab}
      status={status_bar}
    >
      <div class="shop" id="shop-screen">
        <section class="shop-offers panel" aria-label="Your offers">
          <h2 class="panel-title">Your offers</h2>
          <ul class="offers" id="offers">
            {sv.offers.map((c) => (
              <Card key={c.slot} card={c} onBuy={onBuy} />
            ))}
          </ul>
        </section>

        <div class="shop-side">
          <Panel title="Gold" id="panel-gold">
            <div class="gold-row">
              <strong class="gold" id="gold" data-gold={sv.gold}>
                {sv.gold}
              </strong>
              <span class="muted">gold</span>
            </div>
            <button
              type="button"
              id="reroll"
              data-action="reroll"
              disabled={!sv.reroll.can}
              onClick={onReroll}
            >
              Re-roll · {sv.reroll.cost} gold
            </button>
            <span class="why" data-field="reroll-reason">
              {sv.reroll.reason ?? ''}
            </span>
          </Panel>
          <Panel title="Your stash" id="panel-shop-stash">
            <StashList
              rows={sv.stash}
              pending={pending}
              onPick={setPending}
              onDrag={(r) => {
                dragged.current = r;
              }}
            />
            <div
              class={pending === null ? 'sell-target' : 'sell-target active'}
              id="sell-target"
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                // The drop is only a request: the player still confirms.
                if (dragged.current !== null) setPending(dragged.current);
              }}
            >
              {pending === null ? (
                <span class="muted">
                  Drag a building here, or press its Sell button.
                </span>
              ) : (
                <>
                  <p id="sell-quote" data-refund={saleQuote(pending).refund}>
                    {saleQuote(pending).text}
                  </p>
                  <div class="sell-actions">
                    <button
                      type="button"
                      id="sell-confirm"
                      class="danger"
                      onClick={onSell}
                    >
                      Sell for {saleQuote(pending).refund} gold
                    </button>
                    <button
                      type="button"
                      id="sell-cancel"
                      onClick={() => {
                        setPending(null);
                      }}
                    >
                      Keep it
                    </button>
                  </div>
                </>
              )}
            </div>
            <p class="muted fine">
              {sv.placedCount} placed on the board. To sell a placed building,
              return it to the stash on the Build tab first.
            </p>
          </Panel>
        </div>

        <div class={solo ? 'shop-bottom solo' : 'shop-bottom'}>
          {solo ? null : (
            <Panel title="Party (co-op)" id="panel-party-shop">
              <p class="muted">
                Teammates' gold, stash and a way to give gold will appear here.
                You only ever see your own offers.
              </p>
            </Panel>
          )}
          <Panel title="Next battle" id="panel-next-battle">
            <NextBattle view={next} />
            <div class="ready-row">
              <button
                type="button"
                id="shop-ready"
                class={sv.ready ? 'ready-btn on' : 'ready-btn'}
                data-action="ready"
                onClick={onReady}
              >
                {sv.ready ? 'Unready' : 'Ready'}
              </button>
              <span class="muted" data-field="ready-state">
                {sv.ready
                  ? 'Ready. Waiting to continue.'
                  : 'Ready when you are done shopping and building.'}
              </span>
            </div>
          </Panel>
          <Panel title="Your factory" id="panel-factory">
            <div class="mini-board" id="mini-board">
              <BoardView
                content={content}
                own={run.team}
                controller={miniCamera}
                resetKey={`${run.runId}:mini`}
                frontLabel="FRONT EDGE"
              />
            </div>
            <p class="muted fine" data-field="factory-counts">
              {sv.placedCount} {sv.placedCount === 1 ? 'building' : 'buildings'}{' '}
              placed · {sv.stashCount} in stash
            </p>
            <button type="button" id="go-build" onClick={goBuild}>
              Open Build
            </button>
          </Panel>
        </div>

        <div
          class={`status-line ${status.kind}`}
          id="shop-status"
          role="status"
          data-kind={status.kind}
        >
          {status.text}
        </div>
      </div>
    </AppShell>
  );
}
