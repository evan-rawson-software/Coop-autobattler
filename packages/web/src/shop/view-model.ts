/**
 * Pure view models for the Shop tab: offer cards, gold and re-roll, the
 * stash with sale values, and the next-battle panel. They read the run state
 * and decide nothing: the rules answer in `core` and `session`, and these
 * only say why a button is disabled. Only the viewing player's own shop is
 * read, so a teammate's offers can never show up here.
 */
import {
  sellValue,
  type EconomyConfig,
  type SimConfig,
  type TeamState,
} from '@game/core';
import {
  nextBattleInfo,
  pvpOpponentInfo,
  readShop,
  type NextBattleInfo,
  type PveOptionView,
  type RunDeps,
  type RunState,
} from '@game/session';
import type { WebContent } from '../content.js';
import { isEditStep } from '../build/session.js';
import { buildingName } from '../build/view-model.js';
import { rateText } from '../build/rates.js';
import { effectText, kindLabel, needsText } from './effect-text.js';
import { archetypeText, ghostDisplayName } from '../run/display-text.js';
import { count } from '../plural.js';
import { gateFor, type Gate, type LockDeps } from '../build/lock.js';
import { screenText, screenTexts } from '../build/texts.js';

export interface OfferCard {
  readonly slot: number;
  /** Null for a slot that was bought: shown empty until the next re-roll. */
  readonly offer: {
    readonly def: string;
    readonly name: string;
    readonly kind: string;
    readonly kindLabel: string;
    readonly tier: number;
    readonly needs: string;
    /** Need per second at top speed, or collector rate; '' for neither. */
    readonly rate: string;
    readonly effect: string;
    readonly price: number;
  } | null;
  readonly canBuy: boolean;
  /** Why Buy is disabled; null when it is enabled or the slot is empty. */
  readonly reason: string | null;
}

/**
 * What the shop draws: identical offers (same building and tier) collapsed
 * into one entry, and each sold slot as its own empty entry. Only a display
 * grouping: the saved shop still holds one offer per slot.
 */
export interface OfferGroup {
  /** The card shown; for a group, the first of its slots. */
  readonly card: OfferCard;
  /** The real offer slots still on sale in this group, lowest first. */
  readonly slots: readonly number[];
  /** How many copies can still be bought (`slots.length`; 0 when sold). */
  readonly copies: number;
}

export interface StashRow {
  readonly def: string;
  readonly name: string;
  readonly tier: number;
  /** Stash entry IDs, lowest first. */
  readonly ids: readonly number[];
  /** Gold returned for selling one of them. */
  readonly refund: number;
}

export interface ShopView {
  /** True while the run is in the shop step. */
  readonly open: boolean;
  readonly gold: number;
  readonly offers: readonly OfferCard[];
  /** `offers` as drawn: identical offers grouped (see `OfferGroup`). */
  readonly groups: readonly OfferGroup[];
  readonly reroll: {
    readonly cost: number;
    readonly can: boolean;
    readonly reason: string | null;
  };
  readonly stash: readonly StashRow[];
  readonly stashCount: number;
  readonly placedCount: number;
  readonly ready: boolean;
  readonly readyCount: number;
  readonly playerCount: number;
  /** Lock and sealed-producer state (see `build/lock.ts`). */
  readonly gate: Gate | null;
  /** Why the Ready button is disabled (a sealed producer); null otherwise. */
  readonly readyBlock: string | null;
  /** Why selling is refused (Ready); null when it is open. */
  readonly sellBlock: string | null;
}

export type ShopContext = {
  readonly content: WebContent;
  readonly economy: EconomyConfig;
  readonly sim: SimConfig;
};

const CLOSED = 'The shop is closed.';

export function shortOf(gold: number, price: number): string {
  const missing = price - gold;
  return `Need ${String(missing)} more gold.`;
}

/** Group identical live offers; sold slots stay as single entries. */
export function groupOffers(cards: readonly OfferCard[]): OfferGroup[] {
  const slotsOf = new Map<string, number[]>();
  const keyOf = (c: OfferCard): string | null =>
    c.offer === null ? null : `${c.offer.def}:${String(c.offer.tier)}`;
  for (const c of cards) {
    const k = keyOf(c);
    if (k !== null) slotsOf.set(k, [...(slotsOf.get(k) ?? []), c.slot]);
  }
  const groups: OfferGroup[] = [];
  const done = new Set<string>();
  for (const card of cards) {
    const k = keyOf(card);
    if (k === null) {
      groups.push({ card, slots: [], copies: 0 });
    } else if (!done.has(k)) {
      done.add(k);
      const slots = slotsOf.get(k) ?? [card.slot];
      groups.push({ card, slots, copies: slots.length });
    }
  }
  return groups;
}

/** Stash grouped by building and tier, in content order. */
export function stashRows(team: TeamState, ctx: ShopContext): StashRow[] {
  const order = new Map(
    ctx.content.buildings.list().map((d, i) => [d.id, i] as const),
  );
  const groups = new Map<
    string,
    { def: string; tier: number; ids: number[] }
  >();
  for (const s of team.stash) {
    const k = `${s.def}:${String(s.tier)}`;
    const g = groups.get(k) ?? { def: s.def, tier: s.tier, ids: [] };
    g.ids.push(s.id);
    groups.set(k, g);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        (order.get(a.def) ?? 0) - (order.get(b.def) ?? 0) || a.tier - b.tier,
    )
    .map((g) => ({
      def: g.def,
      name: buildingName(ctx.content, g.def),
      tier: g.tier,
      ids: g.ids.sort((a, b) => a - b),
      refund: sellValue(ctx.content, ctx.economy, g.def, g.tier),
    }));
}

export function buildShopView(
  run: RunState,
  player: number,
  ctx: ShopContext,
  deps?: LockDeps,
): ShopView {
  const me = run.perPlayer[player];
  const gate =
    deps === undefined ? null : gateFor(run, player, deps, ctx.content);
  const lock = (intent: string): string | null =>
    gate === null
      ? me?.ready === true
        ? screenText(screenTexts, 'readyLock')
        : null
      : gate.ready || !gate.allowed.has(intent)
        ? gate.editBlock
        : null;
  const open = run.step === 'shop';
  const gold = me?.gold ?? 0;
  const data = me === undefined ? null : readShop(me);
  const cards: OfferCard[] = (data?.offers ?? []).map((o, slot) => {
    if (o === null) return { slot, offer: null, canBuy: false, reason: null };
    const def = ctx.content.buildings.get(o.def);
    const reason = !open
      ? CLOSED
      : lock('buy') !== null
        ? lock('buy')
        : gold < o.price
          ? shortOf(gold, o.price)
          : null;
    return {
      slot,
      offer: {
        def: o.def,
        name: buildingName(ctx.content, o.def),
        kind: def?.kind ?? 'core',
        kindLabel: kindLabel(ctx.content, def?.kind ?? 'core'),
        tier: o.tier,
        needs: def === undefined ? '' : needsText(def, ctx.content),
        rate:
          def === undefined
            ? ''
            : rateText(
                def,
                o.tier,
                ctx.sim.ticksPerSecond,
                ctx.content.presentation.templates.screens,
              ),
        effect:
          def === undefined
            ? ''
            : effectText(ctx.content, ctx.sim, def, o.tier),
        price: o.price,
      },
      canBuy: reason === null,
      reason,
    };
  });
  const cost = ctx.economy.rerollCost;
  const rerollReason = !open
    ? CLOSED
    : lock('reroll') !== null
      ? lock('reroll')
      : data === null
        ? 'Nothing to re-roll.'
        : gold < cost
          ? shortOf(gold, cost)
          : null;
  const mine = (b: { owner: number }): boolean => b.owner === player;
  return {
    open,
    gold,
    offers: cards,
    groups: groupOffers(cards),
    reroll: { cost, can: rerollReason === null, reason: rerollReason },
    stash: stashRows({ ...run.team, stash: run.team.stash.filter(mine) }, ctx),
    stashCount: run.team.stash.filter(mine).length,
    placedCount: run.team.buildings.filter(mine).length,
    ready: me?.ready === true,
    readyCount: run.perPlayer.filter((p) => p.ready).length,
    playerCount: run.players.length,
    gate,
    readyBlock: gate?.readyBlock ?? null,
    sellBlock: open ? lock('sell') : CLOSED,
  };
}

/**
 * "N of M ready" for the status bar, or null outside the steps where players
 * ready up to shop and build (the flags are reset when the step changes).
 */
export function readyLabel(run: RunState): string | null {
  if (!isEditStep(run.step)) return null;
  const n = run.perPlayer.filter((p) => p.ready).length;
  return `${String(n)} of ${String(run.players.length)} ready`;
}

// ---------------------------------------------------------------------------
// Sale confirmation

export interface SaleQuote {
  readonly id: number;
  readonly name: string;
  readonly tier: number;
  readonly refund: number;
  readonly text: string;
}

/** What selling the first entry of a stash row returns, for the confirm box. */
export function saleQuote(row: StashRow): SaleQuote {
  const id = row.ids[0] as number;
  return {
    id,
    name: row.name,
    tier: row.tier,
    refund: row.refund,
    text: `Sell ${row.name} (tier ${String(row.tier)}) for ${String(row.refund)} gold?`,
  };
}

// ---------------------------------------------------------------------------
// Next battle

export interface NextBattleView {
  readonly kind: 'pve' | 'pvp';
  readonly round: number;
  readonly title: string;
  readonly options: readonly {
    readonly id: string;
    readonly difficulty: string;
    readonly archetype: string;
    readonly threat: string;
    readonly rewardGold: number;
  }[];
  /** True when the rival battle is against the generated boss (PvP leg). */
  readonly boss: boolean;
  /** One sentence on how the boss differs; '' unless `boss`. */
  readonly bossNote: string;
  /** PvP only. */
  readonly pvp: {
    readonly opponent: string;
    readonly winGold: number | null;
    readonly lossGold: number | null;
    readonly lifeCost: number;
  } | null;
}

export function threatLine(o: PveOptionView): string {
  const s = o.summary;
  const parts = [count(s.totalUnits, 'unit')];
  if (s.walls > 0) parts.push(count(s.walls, 'wall'));
  if (s.turrets > 0) parts.push(count(s.turrets, 'turret'));
  parts.push(`Core ${String(s.coreHealth)} health`);
  return parts.join(' · ');
}

/** What the boss really is: see "PvE threats" and "Ghosts" in the rules. */
const BOSS_NOTE =
  'A computer-made stronghold, not another party: waves of soldiers and fast raiders, with walls and turrets around its Core.';

export function nextBattleView(
  run: RunState,
  deps: Pick<RunDeps, 'rules' | 'rewards'>,
): NextBattleView | null {
  const info: NextBattleInfo | null = nextBattleInfo(run, deps);
  if (info === null) return null;
  if (info.kind === 'pve') {
    return {
      kind: 'pve',
      round: info.round,
      title: 'Stronghold',
      options: info.options.map((o) => ({
        id: o.id,
        difficulty: o.difficulty,
        archetype: archetypeText(o.archetype).name,
        threat: threatLine(o),
        rewardGold: o.reward.gold,
      })),
      boss: false,
      bossNote: '',
      pvp: null,
    };
  }
  const boss = pvpOpponentInfo(run)?.kind === 'boss';
  return {
    kind: 'pvp',
    round: info.round,
    title: boss ? 'Boss battle next' : 'Rival party',
    boss,
    bossNote: boss ? BOSS_NOTE : '',
    options: [],
    pvp: {
      opponent: opponentText(run),
      winGold: info.stakes.winGold,
      lossGold: info.stakes.lossGold,
      lifeCost: info.stakes.lifeCost,
    },
  };
}

/**
 * Who the PvP battle is against (MM-11): known once the party is in the shop
 * before it; the opponent is fixed there, before the battle is revealed.
 */
export function opponentText(
  run: Pick<RunState, 'pvpOpponent' | 'round'>,
): string {
  const o = pvpOpponentInfo(run);
  if (o === null) return 'Opponent unknown';
  if (o.kind === 'boss') return 'Opponent: the boss';
  return `Opponent: ${ghostDisplayName(o.label)}`;
}
