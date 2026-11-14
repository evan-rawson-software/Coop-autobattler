/**
 * The shop, as part of the Build screen (issue #302): the Shop button of the
 * top bar, the offers in the info rail, and the Sell control. Pure views over
 * `ShopView`; the Build screen holds the state and sends the intents.
 */
import type { ComponentChildren } from 'preact';
import { screenText, screenTexts } from '../build/texts.js';
import './shop.css';
import type { HeldBonus } from '../event/view-model.js';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import type { OfferGroup, ShopView } from './view-model.js';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

/** "4 offers" while the shop has not been opened this round. */
export function ShopToggle(props: {
  open: boolean;
  /** Offers still on sale; shown until the shop was opened this round. */
  badge: number | null;
  onToggle: () => void;
}) {
  const { badge } = props;
  return (
    <button
      type="button"
      id="shop-toggle"
      class="shop-toggle"
      aria-pressed={props.open}
      aria-controls="shop-screen"
      onClick={props.onToggle}
    >
      {t('uiShopTitle')}
      {badge === null ? null : (
        <span class="shop-badge" data-field="shop-badge">
          {badge === 1
            ? t('uiShopBadgeOne')
            : t('uiShopBadgeMany', { count: String(badge) })}
        </span>
      )}
    </button>
  );
}

function Offer(props: { group: OfferGroup; onBuy: (slot: number) => void }) {
  const { group, onBuy } = props;
  const { card } = group;
  // Buying takes the first copy that is still on sale.
  const slot = group.slots[0] ?? card.slot;
  const o = card.offer;
  if (o === null) {
    return (
      <li class="offer sold" data-slot={card.slot} data-state="sold">
        <p class="offer-empty">{t('uiShopSoldOut')}</p>
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
      <div class="offer-text">
        <div class="offer-top">
          <h3 class="offer-name">{o.name}</h3>
          <span class="offer-kind">
            {t('uiShopKindTier', { kind: o.kindLabel, tier: String(o.tier) })}
          </span>
        </div>
        {group.copies > 1 ? (
          <p
            class="offer-copies"
            data-field="copies"
            data-copies={group.copies}
          >
            {t('uiShopCopies', { count: String(group.copies) })}
          </p>
        ) : null}
        {o.uses === null ? null : <p data-field="uses">{o.uses}</p>}
        {o.collects === null ? null : (
          <p class="offer-rate" data-field="rate">
            {o.collects}
          </p>
        )}
        {o.effect === '' ? null : <p data-field="effect">{o.effect}</p>}
        <p class="offer-health" data-field="health">
          {o.health}
        </p>
      </div>
      <button
        type="button"
        class="buy-btn"
        data-action="buy"
        disabled={!card.canBuy}
        title={card.reason ?? undefined}
        onClick={() => {
          onBuy(slot);
        }}
      >
        {t('uiShopPrice', { price: String(o.price) })}
      </button>
    </li>
  );
}

/** The shop panel of the info rail: header, offers, bonuses, the footnote. */
export function ShopPanel(props: {
  sv: ShopView;
  bonuses: readonly HeldBonus[];
  onBuy: (slot: number) => void;
  onReroll: () => void;
  onClose: () => void;
  children?: ComponentChildren;
}) {
  const { sv } = props;
  return (
    <section class="shop-panel" id="shop-screen" aria-label={t('uiShopTitle')}>
      <div class="shop-head">
        <h2 class="shop-title">{t('uiShopTitle')}</h2>
        <div class="shop-head-buttons">
          <button
            type="button"
            id="reroll"
            data-action="reroll"
            disabled={!sv.reroll.can}
            title={sv.reroll.reason ?? undefined}
            onClick={props.onReroll}
          >
            {t('uiShopReroll', { cost: String(sv.reroll.cost) })}
          </button>
          <button
            type="button"
            class="shop-close"
            id="shop-close"
            aria-label={t('uiShopClose')}
            title={t('uiShopClose')}
            onClick={props.onClose}
          >
            ×
          </button>
        </div>
      </div>
      <ul class="offers" id="offers">
        {sv.groups.map((g) => (
          <Offer key={g.card.slot} group={g} onBuy={props.onBuy} />
        ))}
      </ul>
      {props.bonuses.length === 0 ? null : (
        <div class="shop-bonuses" id="panel-bonuses">
          <h3>{t('uiShopBonuses')}</h3>
          <ul class="bonus-list">
            {props.bonuses.map((b) => (
              <li key={b.id} data-bonus={b.id} title={b.effects.join('\n')}>
                {b.count > 1 ? `${b.name} ×${String(b.count)}` : b.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {props.children}
      <p class="shop-foot" data-field="shop-footnote">
        {t('uiShopFootnote')}
      </p>
    </section>
  );
}

/** What Sell would remove: a building on the board or a slot of the tray. */
export interface SellTarget {
  readonly id: number;
  readonly name: string;
  readonly tier: number;
  readonly refund: number;
}

/** Sell · N, and after it the confirm (Sell / Cancel). */
export function SellControl(props: {
  target: SellTarget;
  asking: boolean;
  /** Why selling is refused right now (Ready); null when it is open. */
  blocked: string | null;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { target, asking } = props;
  if (!asking) {
    return (
      <div class="sell-box">
        <button
          type="button"
          data-action="sell"
          disabled={props.blocked !== null}
          title={props.blocked ?? undefined}
          onClick={props.onAsk}
        >
          {t('uiSellButton', { refund: String(target.refund) })}
        </button>
      </div>
    );
  }
  return (
    <div class="sell-box confirming" id="sell-target">
      <p id="sell-quote" data-refund={target.refund}>
        {t('uiSellConfirm', {
          name: target.name,
          tier: String(target.tier),
          refund: String(target.refund),
        })}
      </p>
      <div class="sell-actions">
        <button
          type="button"
          id="sell-confirm"
          class="danger"
          onClick={props.onConfirm}
        >
          {t('uiSellYes')}
        </button>
        <button type="button" id="sell-cancel" onClick={props.onCancel}>
          {t('uiSellCancel')}
        </button>
      </div>
    </div>
  );
}

/** The Sell strip under the offers: what is selected, and Sell. */
export function SellStrip(props: {
  target: SellTarget;
  asking: boolean;
  blocked: string | null;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="sell-strip" id="sell-strip">
      <p class="sell-strip-name">
        {props.target.name}
        {props.target.tier > 1 ? ` · T${String(props.target.tier)}` : ''}
      </p>
      <SellControl {...props} />
    </div>
  );
}
