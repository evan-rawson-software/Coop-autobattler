/**
 * The Shop tab (W2-7): your offers, gold and re-roll, your stash and a sell
 * target, what comes next, Ready, and a small live view of the factory. It is
 * one of two tabs of the same step; the other is the Build screen. Both work
 * on the one shared run (`run/shop-run.ts`), so switching tabs loses nothing.
 *
 * Every change is an intent through the shared session, saved before the
 * screen updates. Buying, selling and re-rolling are never undoable.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useStore } from '../app-state.js';
import { BoardView } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { economy, simConfig } from '../build/setup.js';
import { type SessionView } from '../build/session.js';
import { content } from '../content.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import { NotSavedNote, RestartButton, RunGate } from '../run/RunGate.js';
import type { RunHandle } from '../run/handle.js';
import { ensureShopRun, optionsFromUrl } from '../run/shop-run.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import { ActingSwitch } from '../shell/ActingSwitch.js';
import { useNoticeTimeout, useStatus } from '../shell/status.js';
import './shop.css';
import { screenText, screenTexts } from '../build/texts.js';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import { performAction } from './actions.js';
import { onStepTab, stepTabs } from './tabs.js';
import {
  buildShopView,
  nextBattleView,
  readyLabel,
  saleQuote,
  type NextBattleView,
  type OfferGroup,
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
  return <RunGate>{(run) => <ShopTab run={run} standalone />}</RunGate>;
}

function Card(props: { group: OfferGroup; onBuy: (slot: number) => void }) {
  const { group, onBuy } = props;
  const { card } = group;
  // Buying takes the first copy that is still on sale.
  const slot = group.slots[0] ?? card.slot;
  const o = card.offer;
  if (o === null) {
    return (
      <li class="offer sold" data-slot={card.slot} data-state="sold">
        <p class="offer-empty">{screenText(screenTexts, 'uiShopSoldOut')}</p>
      </li>
    );
  }
  return (
    <li
      class={card.canBuy ? 'offer' : 'offer unaffordable'}
      data-slot={card.slot}
      data-def={o.def}
      data-copies={group.copies}
      data-state={card.canBuy ? 'available' : 'locked'}
    >
      <div
        class="offer-art"
        style={{ background: `var(--kind-${o.kind.replace('_', '-')})` }}
        aria-hidden="true"
      >
        <SpriteIcon name={o.def} fit />
      </div>
      <h3 class="offer-name">{o.name}</h3>
      <p class="offer-kind">
        {o.kindLabel} · tier {o.tier}
      </p>
      {group.copies > 1 ? (
        <p class="offer-copies" data-field="copies" data-copies={group.copies}>
          ×{group.copies} available
        </p>
      ) : null}
      <p class="offer-needs">
        {screenText(screenTexts, 'uiShopNeeds', { needs: o.needs })}
      </p>
      {o.rate === '' ? null : (
        <p class="offer-rate" data-field="rate">
          {o.rate}
        </p>
      )}
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
            onBuy(slot);
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
  /** Why selling is refused right now; null when it is open. */
  blocked: string | null;
}) {
  const { rows, pending, onPick, onDrag, blocked } = props;
  if (rows.length === 0) {
    return null;
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
            draggable={blocked === null}
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
              <SpriteIcon name={r.def} size={32} class="stash-sprite" />
              {r.name} <span class="stash-tier">T{r.tier}</span> ×{' '}
              {r.ids.length}
            </span>
            <button
              type="button"
              data-action="sell"
              disabled={blocked !== null}
              title={blocked ?? undefined}
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
    return <p class="muted">{screenText(screenTexts, 'uiShopNextUnknown')}</p>;
  }
  if (v.kind === 'pve' || v.pvp === null) {
    return (
      <>
        <h3 class="next-title" data-field="next-kind">
          {v.title} · round {v.round}
        </h3>
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
      {v.boss ? (
        <p class="boss-note" data-field="boss-note">
          {v.bossNote}
        </p>
      ) : null}
      <p>{p.opponent}</p>
      <p class="stakes">
        <span>
          Win: {p.winGold === null ? 'gold' : `${String(p.winGold)} gold`}
        </span>
        <span>
          Lose: -{p.lifeCost} {p.lifeCost === 1 ? 'life' : 'lives'}
          {p.lossGold === null ? '' : `, +${String(p.lossGold)} gold`}
        </span>
      </p>
    </>
  );
}

export function ShopTab(props: {
  run: RunHandle;
  /** Opened on its own (`#shop`), outside the run bar: show the switcher. */
  standalone?: boolean;
}) {
  const { session, deps } = props.run;
  const view: SessionView = useStore(session.store);
  const run = view.run;
  const sv: ShopView = useMemo(
    () => buildShopView(run, view.acting, ctx, deps),
    [run, view.acting, deps],
  );
  const next = useMemo(() => nextBattleView(run, deps), [run, deps]);
  const [pending, setPending] = useState<StashRow | null>(null);
  const [status, say, clearStatus] = useStatus();
  const dismissNotice = useCallback(() => {
    session.dismissNotice();
  }, [session]);
  useNoticeTimeout(view.notice, dismissNotice);
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
    // The next action clears what the last one said (and the Workshop note).
    clearStatus();
    if (view.notice !== null) session.dismissNotice();
    const r = await performAction(session, intent, okText);
    say(r.text, r.kind);
    return r.ok;
  };

  const onBuy = (slot: number): void => {
    const card = sv.offers[slot];
    if (card?.offer == null) return;
    const { name } = card.offer;
    void act({ type: 'buy', slot }, `Bought ${name}.`);
  };

  const onReroll = (): void => {
    void act({ type: 'reroll' }, 'Re-rolled.');
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
      screenText(
        screenTexts,
        sv.ready ? 'statusNotReady' : 'statusReadyWaiting',
      ),
    );
  };

  const solo = sv.playerCount === 1;
  const stepOpen = run.step === 'shop';

  const ready = readyLabel(run);
  const status_bar = (
    <>
      <span data-field="run-info">
        Lives {run.lives} / {deps.rules.startingLives}
        {ready === null ? '' : ` · ${ready}`}
      </span>
      {props.standalone === true ? (
        <ActingSwitch
          run={run}
          acting={view.acting}
          onActing={(p) => {
            session.setActing(p);
          }}
        />
      ) : null}
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
            {sv.groups.map((g) => (
              <Card key={g.card.slot} group={g} onBuy={onBuy} />
            ))}
          </ul>
        </section>

        <div class="shop-side">
          {/* The gold amount is in the header; this panel is the re-roll. */}
          <Panel title="Re-roll" id="panel-gold">
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
              blocked={sv.sellBlock}
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
                if (dragged.current !== null && sv.sellBlock === null) {
                  setPending(dragged.current);
                }
              }}
            >
              {pending === null ? (
                <span class="muted">
                  Drag a building here from the stash to sell
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
                      Sell
                    </button>
                    <button
                      type="button"
                      id="sell-cancel"
                      onClick={() => {
                        setPending(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </Panel>
        </div>

        <div class={solo ? 'shop-bottom solo' : 'shop-bottom'}>
          {solo ? null : (
            <Panel title="Party (co-op)" id="panel-party-shop">
              <p class="muted">{screenText(screenTexts, 'uiComingSoon')}</p>
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
                disabled={sv.readyBlock !== null}
                title={sv.readyBlock ?? undefined}
                onClick={onReady}
              >
                {sv.ready ? (
                  <SpriteIcon
                    name="ui_icon_ready"
                    scale={1}
                    class="ready-icon"
                  />
                ) : null}
                {screenText(
                  screenTexts,
                  sv.ready ? 'uiPartyUnready' : 'uiPartyReady',
                )}
              </button>
              <span
                class={sv.readyBlock === null ? 'muted' : 'error'}
                data-field="ready-state"
                data-blocked={sv.readyBlock === null ? 'false' : 'true'}
              >
                {sv.readyBlock ?? ''}
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
          </Panel>
        </div>

        {view.notice === null ? null : (
          <div
            class="status-line ok"
            id="shop-notice"
            role="status"
            data-field="notice"
          >
            <span>{view.notice}</span>
          </div>
        )}
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
