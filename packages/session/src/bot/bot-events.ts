/**
 * How the scripted bot answers the events (#416): which offer the party votes
 * for, and each player's answer to the follow-up of Drill, Rich vein,
 * Blueprint and the Caravan. Workshop, Shrine and Windfall stay in `bot.ts`.
 *
 * Everything here reads the run state only; the strategy's tastes arrive as an
 * `EventTastes`, so this file does not import the strategy table.
 */
import {
  addableNodeCells,
  isBorderEnd,
  occupancy,
  tierPrice,
  workshopOptions,
  type Content,
} from '@game/core';
import {
  caravanChoice,
  defaultDraftPick,
  draftTurn,
  nodeSub,
  openDraft,
  parseCaravanChoice,
  upgradeSub,
  type CaravanItem,
  type CaravanKind,
  type Draft,
} from '../rules/caravan.js';
import { richVeinChoice } from '../rules/event-shared.js';
import { SKIP_CHOICE } from '../rules/events.js';
import { isRecord } from '../rules/json-guards.js';
import type { Json, RunDeps, RunState } from '../rules/types.js';

/** What the bot's strategy likes, as far as the events are concerned. */
export interface EventTastes {
  /** Event types in order of preference. */
  readonly events: readonly string[];
  /** Shrine and Caravan modifiers in order of preference. */
  readonly modifiers: readonly string[];
  /** The pacts the strategy takes (its benefit matches the strategy). */
  readonly pacts: readonly string[];
  /** What a Caravan reward of each kind is worth to the strategy (0 = never). */
  readonly caravan: Readonly<Record<CaravanKind, number>>;
  /** The weak bot: buys at random, draws no conduits. */
  readonly random: boolean;
  /** Whether the strategy connects its factory (else collectors are idle). */
  readonly connect: boolean;
  /** The shop score of a building at a tier (0 = never bought). */
  score(def: string, tier: number): number;
  /** The building definitions that consume a resource from a collector. */
  readonly consumers: readonly string[];
  /** The other half of a refining chain, or undefined. */
  chainPartner(def: string): string | undefined;
  isChainPiece(def: string): boolean;
  /**
   * Would a free building be placed on the player's plot now? (The layout's
   * own dry run, as the shop asks it; true for what the layout does not
   * place by purpose, such as walls.)
   */
  placeable(
    state: RunState,
    player: number,
    def: string,
    tier: number,
  ): boolean;
}

/** Gold the next shop adds (`baseIncomePerShop`), for "can afford next shop". */
const NEXT_SHOP_INCOME = 5;

type Team = RunState['team'];

function ownedOf(
  team: Team,
  player: number,
): { id: number; def: string; tier: number }[] {
  return [...team.buildings, ...team.stash].filter((b) => b.owner === player);
}

function resourceOf(content: Content, def: string): string | undefined {
  return content.buildings.get(def)?.inputs[0]?.resource;
}

/** How many consumers `player` owns (board or stash) that take `resource`. */
function consumersTaking(
  team: Team,
  content: Content,
  t: EventTastes,
  player: number,
  resource: string,
): number {
  return ownedOf(team, player).filter(
    (b) =>
      t.consumers.includes(b.def) && resourceOf(content, b.def) === resource,
  ).length;
}

/** Does collector `id` feed something (through routes), or a neighbour? */
function feedsConsumer(team: Team, content: Content, id: number): boolean {
  const seen = new Set<number>();
  const walk = (from: number): boolean => {
    if (seen.has(from)) return false;
    seen.add(from);
    for (const c of team.conduits) {
      if (isBorderEnd(c.from) || c.from.building !== from) continue;
      if (isBorderEnd(c.to)) return true;
      const to = team.buildings.find(
        (b) => b.id === (c.to as { building: number }).building,
      );
      if (to === undefined) continue;
      const kind = content.buildings.get(to.def)?.kind;
      if (kind === 'route' ? walk(to.id) : kind !== 'source') return true;
    }
    return false;
  };
  return walk(id);
}

// ---------------------------------------------------------------------------
// The vote

function offerString(o: Record<string, Json>, key: string): string {
  const v = o[key];
  return typeof v === 'string' ? v : '';
}

/** Would the bot want this offer, as far as it can tell from the offer itself? */
function wanted(
  state: RunState,
  deps: RunDeps,
  t: EventTastes,
  o: Record<string, Json>,
): boolean {
  const { team } = state;
  const type = offerString(o, 'type');
  const players = state.players.map((_p, i) => i);
  switch (type) {
    case 'pact':
      return t.pacts.includes(offerString(o, 'pact'));
    case 'market_day':
      // Extra offers and free re-rolls are worth what the gold plan can
      // spend: a bot that buys one thing at random cannot use them.
      return !t.random;
    case 'rich_vein': {
      const resource = offerString(o, 'resource');
      return (
        t.connect &&
        players.some(
          (p) =>
            consumersTaking(team, deps.content, t, p, resource) > 0 &&
            addableNodeCells(team, deps.content, deps.mapgenConfig, p).length >
              0,
        )
      );
    }
    case 'blueprint': {
      const all = o['blueprints'];
      if (!Array.isArray(all)) return false;
      const lists: readonly Json[] = all;
      return players.some((p) => {
        const mine = lists[p];
        return (
          Array.isArray(mine) &&
          mine.some((d) => typeof d === 'string' && t.score(d, 1) > 0)
        );
      });
    }
    default:
      return true;
  }
}

/**
 * The offer the party votes for: the first type in the strategy's order that
 * it can use; failing that the first offer that is not a pact, else the first.
 */
export function eventVote(
  state: RunState,
  deps: RunDeps,
  t: EventTastes,
  options: readonly Json[],
): string | undefined {
  const offers = options.filter(
    (o): o is Record<string, Json> =>
      isRecord(o) && typeof o['id'] === 'string',
  );
  for (const type of t.events) {
    for (const o of offers) {
      if (o['type'] === type && wanted(state, deps, t, o)) {
        return offerString(o, 'id');
      }
    }
  }
  const any = offers.find((o) => o['type'] !== 'pact') ?? offers[0];
  return any === undefined ? undefined : offerString(any, 'id');
}

// ---------------------------------------------------------------------------
// Drill and Caravan raises

interface Raise {
  readonly building: number;
  readonly def: string;
  readonly tier: number;
}

/**
 * The building to raise: the lowest-tier collector that feeds a consumer, else
 * the lowest-tier collector, else (with `anyBuilding`) the one the strategy
 * scores highest. Undefined when there is nothing to raise.
 */
function bestRaise(
  state: RunState,
  deps: RunDeps,
  t: EventTastes,
  raises: readonly Raise[],
  anyBuilding: boolean,
): Raise | undefined {
  const collectors = raises.filter(
    (r) => deps.content.buildings.get(r.def)?.kind === 'source',
  );
  const lowest = (list: readonly Raise[]): Raise | undefined =>
    [...list].sort((a, b) => a.tier - b.tier || a.building - b.building)[0];
  const feeding = collectors.filter((r) =>
    feedsConsumer(state.team, deps.content, r.building),
  );
  const found = lowest(feeding) ?? lowest(collectors);
  if (found !== undefined || !anyBuilding) return found;
  let best: Raise | undefined;
  let bestScore = 0;
  for (const r of raises) {
    const score = t.score(r.def, r.tier);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/** A Drill follow-up: the building id to raise, or skip. */
export function drillPick(
  state: RunState,
  deps: RunDeps,
  t: EventTastes,
  options: readonly Json[],
  player: number,
): string {
  const raises: Raise[] = [];
  for (const o of options) {
    if (
      isRecord(o) &&
      o['player'] === player &&
      o['affordable'] === true &&
      typeof o['building'] === 'number' &&
      typeof o['def'] === 'string' &&
      typeof o['tier'] === 'number'
    ) {
      raises.push({ building: o['building'], def: o['def'], tier: o['tier'] });
    }
  }
  const r = bestRaise(state, deps, t, raises, false);
  return r === undefined ? SKIP_CHOICE : `b${String(r.building)}`;
}

// ---------------------------------------------------------------------------
// Rich vein and Caravan nodes

/**
 * The cell nearest (Manhattan) the player's collectors of `resource`, or if
 * it has none on the board, nearest its consumers of that resource; the first
 * cell otherwise. Skips (null) when the player owns no consumer of it.
 */
function nodeCell(
  state: RunState,
  deps: RunDeps,
  t: EventTastes,
  player: number,
  resource: string,
): { x: number; y: number } | null {
  const { team } = state;
  if (consumersTaking(team, deps.content, t, player, resource) === 0) {
    return null;
  }
  const cells = addableNodeCells(team, deps.content, deps.mapgenConfig, player);
  if (cells.length === 0) return null;
  const occ = occupancy(team, deps.content);
  const mine = team.buildings.filter((b) => b.owner === player);
  const collectors = mine.filter(
    (b) =>
      deps.content.buildings.get(b.def)?.kind === 'source' &&
      occ.sourceResource(b) === resource,
  );
  const near =
    collectors.length > 0
      ? collectors
      : mine.filter(
          (b) =>
            t.consumers.includes(b.def) &&
            resourceOf(deps.content, b.def) === resource,
        );
  let best = cells[0];
  let bestDist = Infinity;
  for (const c of cells) {
    for (const b of near) {
      const dist = Math.abs(c.x - b.x) + Math.abs(c.y - b.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
  }
  return best ?? null;
}

/** A Rich vein follow-up: the cell to put the node on, or skip. */
export function veinPick(
  state: RunState,
  deps: RunDeps,
  t: EventTastes,
  player: number,
): string {
  const offer = isRecord(state.pending) ? state.pending['offer'] : undefined;
  const resource = isRecord(offer) ? offerString(offer, 'resource') : '';
  const cell = nodeCell(state, deps, t, player, resource);
  return cell === null ? SKIP_CHOICE : richVeinChoice(cell.x, cell.y);
}

// ---------------------------------------------------------------------------
// Blueprint

/** A Blueprint follow-up: the option id of the building to hold, or skip. */
export function blueprintPick(
  state: RunState,
  deps: RunDeps,
  t: EventTastes,
  options: readonly Json[],
  player: number,
): string {
  const mine: { id: string; def: string }[] = [];
  for (const o of options) {
    if (
      isRecord(o) &&
      o['player'] === player &&
      typeof o['id'] === 'string' &&
      typeof o['def'] === 'string'
    ) {
      mine.push({ id: o['id'], def: o['def'] });
    }
  }
  const owned = ownedOf(state.team, player);
  const has = (def: string): boolean => owned.some((b) => b.def === def);
  // The other half of a refining chain it already owns (#384).
  const half = mine.find((o) => {
    const partner = t.chainPartner(o.def);
    return partner !== undefined && has(partner) && !has(o.def);
  });
  if (half !== undefined && !t.random) return half.id;
  // Else the dearest (highest-tier) building it likes and can afford by the
  // next shop; the chain pieces without their partner are not bought alone.
  const gold = (state.perPlayer[player]?.gold ?? 0) + NEXT_SHOP_INCOME;
  let best = SKIP_CHOICE;
  let bestPrice = 0;
  for (const o of mine) {
    if (t.score(o.def, 1) <= 0) continue;
    if (t.chainPartner(o.def) !== undefined) continue;
    if (t.random && t.isChainPiece(o.def) && o.def !== 'bld_foundry') continue;
    const price = tierPrice(deps.content, o.def, 1);
    if (price <= gold && price > bestPrice) {
      bestPrice = price;
      best = o.id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Caravan

function takenItems(draft: Draft): Set<string> {
  const out = new Set<string>();
  for (const t of draft.taken) {
    const item = t === null ? undefined : parseCaravanChoice(t)?.item;
    if (item !== undefined) out.add(item);
  }
  return out;
}

/** The choice for one reward, with its sub-choice, or null if it is no use. */
function caravanItemPick(
  state: RunState,
  deps: RunDeps,
  t: EventTastes,
  player: number,
  item: CaravanItem,
): { value: number; choice: string } | null {
  const base = t.caravan[item.kind];
  if (base <= 0) return null;
  switch (item.kind) {
    case 'gold':
      return { value: base, choice: item.id };
    case 'modifier': {
      const m = item.modifier ?? '';
      return t.modifiers.includes(m) ? { value: base, choice: item.id } : null;
    }
    case 'building': {
      const def = item.def ?? '';
      // As the shop does: a collector only for a consumer that has none, a
      // consumer only while the collectors outnumber the consumers.
      const owned = ownedOf(state.team, player);
      const sources = owned.filter(
        (b) => deps.content.buildings.get(b.def)?.kind === 'source',
      ).length;
      const users = owned.filter((b) => t.consumers.includes(b.def)).length;
      const kind = deps.content.buildings.get(def)?.kind;
      const balanced =
        kind === 'source'
          ? sources < users
          : t.consumers.includes(def)
            ? users <= sources
            : true;
      return t.score(def, 1) > 0 &&
        balanced &&
        t.placeable(state, player, def, 1)
        ? { value: base, choice: item.id }
        : null;
    }
    case 'upgrade': {
      const raises = workshopOptions(
        state.team,
        player,
        state.perPlayer[player]?.gold ?? 0,
        deps.content,
        0,
      );
      const r = bestRaise(state, deps, t, raises, true);
      return r === undefined
        ? null
        : {
            value: base,
            choice: caravanChoice(item.id, upgradeSub(r.building)),
          };
    }
    case 'node': {
      const cell = nodeCell(state, deps, t, player, item.resource ?? '');
      return cell === null
        ? null
        : {
            value: base,
            choice: caravanChoice(item.id, nodeSub(cell.x, cell.y)),
          };
    }
  }
}

/**
 * The next pick of the draft: the player who is up takes the free reward their
 * strategy values most (a party-wide one is no exception); when none is of
 * use they take what `defaultDraftPick` names, which is always legal.
 */
export function caravanPick(
  state: RunState,
  deps: RunDeps,
  t: EventTastes,
): { readonly player: number; readonly choice: string } | null {
  const draft = openDraft(state);
  if (draft === null) return null;
  const player = draftTurn(draft).chooser;
  if (player === null) return null;
  const taken = takenItems(draft);
  let best: { value: number; choice: string } | null = null;
  for (const item of draft.items) {
    if (taken.has(item.id)) continue;
    const pick = caravanItemPick(state, deps, t, player, item);
    if (pick !== null && (best === null || pick.value > best.value))
      best = pick;
  }
  return best === null
    ? defaultDraftPick(state, deps)
    : { player, choice: best.choice };
}
