/**
 * Caravan (RS-4h, RS-4i3): a co-op draft of rewards in rotating order.
 *
 * The offer stores the rewards (`items`, `players + 1` of them) and the
 * choosing `order`, both drawn from the offer's child stream when the event
 * step opens. Voting for the Caravan makes the follow-up a draft:
 *   { prompt: "caravan", mode: "draft", items, order, taken }
 * `taken[i]` is the choice of player `order[i]`, or null while that player
 * has not chosen. A choice is an item id (`it0`), or an item id with a
 * sub-choice on the taker's turn (`it2:b17`, the building to raise;
 * `it3:c4_9`, the cell for the node), or `skip` (only for a player who can
 * take none of the free items). Only the player whose turn it is (the first
 * null) may choose; the player before may still change theirs until then.
 * The last player's choice is final at once and applies every pick, in
 * choosing order; the item left over is discarded.
 */
import {
  addNode,
  addToStash,
  addableNodeCells,
  findModifier,
  heldModifierIds,
  offerWeightsAt,
  pickWeightedIndex,
  raiseTier,
  sortedKeys,
  withModifier,
  workshopOptions,
  type EventDef,
  type Rng,
} from '@game/core';
import {
  SKIP_CHOICE,
  eligibleModifiers,
  richVeinCell,
  richVeinChoice,
} from './event-shared.js';
import type { EventContext, EventHandler, EventOffer } from './events.js';
import type {
  Effect,
  HandlerResult,
  Json,
  PlayerRunState,
  RunDeps,
  RunState,
} from './types.js';

/** The follow-up prompt of the Caravan. */
export const CARAVAN_PROMPT = 'caravan';

/** Highest weight or gold amount in the Caravan's params. */
export const MAX_CARAVAN_NUMBER = 1000;

export type CaravanKind = 'gold' | 'building' | 'upgrade' | 'node' | 'modifier';

export const CARAVAN_KINDS: readonly CaravanKind[] = [
  'gold',
  'building',
  'upgrade',
  'node',
  'modifier',
];

/** One reward of the draft, as stored. */
export interface CaravanItem {
  /** `it0`, `it1`, ...: the choice id. */
  readonly id: string;
  readonly kind: CaravanKind;
  /** `gold`: the amount. */
  readonly gold?: number;
  /** `building`: the tier-1 building. */
  readonly def?: string;
  /** `node`: the base resource of the node. */
  readonly resource?: string;
  /** `modifier`: the run modifier, taken for the whole party. */
  readonly modifier?: string;
  /** True for the one party-wide item. */
  readonly partyWide?: true;
}

/** The draft of an open Caravan follow-up. */
export interface Draft {
  readonly items: readonly CaravanItem[];
  /** The players in choosing order. */
  readonly order: readonly number[];
  /** The choice of `order[i]`, or null. */
  readonly taken: readonly (string | null)[];
}

function isRecord(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Reading the stored data

function readItem(v: unknown, index: number): CaravanItem | null {
  if (!isRecord(v) || v['id'] !== `it${String(index)}`) return null;
  const kind = v['kind'];
  if (!CARAVAN_KINDS.includes(kind as CaravanKind)) return null;
  const item: CaravanItem = {
    id: v['id'],
    kind: kind as CaravanKind,
    ...(typeof v['gold'] === 'number' ? { gold: v['gold'] } : {}),
    ...(typeof v['def'] === 'string' ? { def: v['def'] } : {}),
    ...(typeof v['resource'] === 'string' ? { resource: v['resource'] } : {}),
    ...(typeof v['modifier'] === 'string' ? { modifier: v['modifier'] } : {}),
    ...(v['partyWide'] === true ? { partyWide: true as const } : {}),
  };
  return item;
}

/** The items of a stored list, or null if any is malformed. */
export function readItems(v: unknown): CaravanItem[] | null {
  if (!Array.isArray(v)) return null;
  const out: CaravanItem[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = readItem(v[i], i);
    if (item === null) return null;
    out.push(item);
  }
  return out;
}

/** The draft of a stored follow-up, or null if it is not a well-formed draft. */
export function readDraft(fu: unknown): Draft | null {
  if (!isRecord(fu) || fu['mode'] !== 'draft') return null;
  const items = readItems(fu['items']);
  const order = fu['order'];
  const taken = fu['taken'];
  if (
    items === null ||
    !Array.isArray(order) ||
    !Array.isArray(taken) ||
    taken.length !== order.length ||
    !order.every((p) => typeof p === 'number' && Number.isInteger(p)) ||
    !taken.every((t) => t === null || typeof t === 'string')
  ) {
    return null;
  }
  return {
    items,
    order: order as number[],
    taken: taken as (string | null)[],
  };
}

/** True if a stored follow-up is a draft (whatever its content). */
export function isDraft(fu: unknown): boolean {
  return isRecord(fu) && fu['mode'] === 'draft';
}

/** The draft open in `event_resolve`, or null. */
export function openDraft(state: RunState): Draft | null {
  if (state.step !== 'event_resolve' || !isRecord(state.pending)) return null;
  return readDraft(state.pending['followUp']);
}

/** The item id and sub-choice a choice names, or null if it is neither. */
export function parseCaravanChoice(
  choice: string,
): { readonly item: string; readonly sub: string | null } | null {
  const m = /^(it[0-9]+)(?::(.+))?$/.exec(choice);
  return m === null ? null : { item: m[1] as string, sub: m[2] ?? null };
}

/** The choice of the building to raise (`b<id>`) for an Upgrade item. */
export function upgradeSub(building: number): string {
  return `b${String(building)}`;
}

/** The choice id that takes `item` with `sub` (none for plain items). */
export function caravanChoice(item: string, sub?: string): string {
  return sub === undefined ? item : `${item}:${sub}`;
}

/** The cell sub-choice of a Node item. */
export function nodeSub(x: number, y: number): string {
  return richVeinChoice(x, y);
}

/**
 * Whose turn it is: the first player who has not chosen (`chooser`), and the
 * player before them (`changer`) who may still change their pick. Both are
 * null when nobody can act (every slot is filled).
 */
export function draftTurn(draft: Draft): {
  readonly cursor: number;
  readonly chooser: number | null;
  readonly changer: number | null;
} {
  const cursor = draft.taken.indexOf(null);
  if (cursor < 0)
    return { cursor: draft.taken.length, chooser: null, changer: null };
  return {
    cursor,
    chooser: draft.order[cursor] ?? null,
    changer: cursor > 0 ? (draft.order[cursor - 1] ?? null) : null,
  };
}

/** The item ids taken by players other than `player`. */
function takenByOthers(draft: Draft, player: number): Set<string> {
  const out = new Set<string>();
  draft.taken.forEach((t, i) => {
    if (t === null || draft.order[i] === player) return;
    const p = parseCaravanChoice(t);
    if (p !== null) out.add(p.item);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Params

function numParam(def: EventDef, key: string, fallback: number): number {
  const v = def.params[key];
  return typeof v === 'number' ? v : fallback;
}

const WEIGHT_KEYS: Readonly<Record<CaravanKind, string>> = {
  gold: 'weightGold',
  building: 'weightBuilding',
  upgrade: 'weightUpgrade',
  node: 'weightNode',
  modifier: 'weightModifier',
};

function boundedParam(def: EventDef, key: string, min: number): string | null {
  const v = def.params[key];
  return typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= min &&
    v <= MAX_CARAVAN_NUMBER
    ? null
    : `"${key}" must be an integer from ${String(min)} to ${String(MAX_CARAVAN_NUMBER)}`;
}

// ---------------------------------------------------------------------------
// What the items can be now

/** Buildings the shop can offer at this round with a tier 1 price, weighted. */
function buildingPool(
  ctx: EventContext,
): { readonly def: string; readonly weight: number }[] {
  if (ctx.economy === undefined) return [];
  const out: { def: string; weight: number }[] = [];
  for (const w of offerWeightsAt(ctx.economy, ctx.state.round)) {
    const t = ctx.content.buildings.get(w.def)?.tiers[0];
    if (
      w.weight > 0 &&
      t !== undefined &&
      'price' in t &&
      !out.some((e) => e.def === w.def)
    ) {
      out.push({ def: w.def, weight: w.weight });
    }
  }
  return out;
}

/** Can `player` raise one of their buildings (free)? */
function upgradeOptions(ctx: EventContext, player: number) {
  return workshopOptions(
    ctx.state.team,
    player,
    ctx.state.perPlayer[player]?.gold ?? 0,
    ctx.content,
    0,
  );
}

function nodeCells(ctx: EventContext, player: number) {
  return ctx.mapgen === undefined
    ? []
    : addableNodeCells(ctx.state.team, ctx.content, ctx.mapgen, player);
}

function someone(ctx: EventContext, test: (player: number) => boolean) {
  return ctx.state.players.some((_p, i) => test(i));
}

/** Base resources a Node may name: weight above 0 in the definition. */
function nodeResources(ctx: EventContext, def: EventDef): string[] {
  const weights = def.resourceWeights ?? {};
  return ctx.content.resources
    .listBase()
    .map((r) => r.id)
    .filter((id) => (weights[id] ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// The handler

export const caravanHandler: EventHandler = {
  type: 'caravan',
  canAskFollowUp: true,
  drafts: true,
  checkParams(def) {
    for (const k of CARAVAN_KINDS) {
      const p = boundedParam(def, WEIGHT_KEYS[k], k === 'building' ? 1 : 0);
      if (p !== null) return p;
    }
    const g = boundedParam(def, 'gold', 1);
    if (g !== null) return g;
    if (
      numParam(def, 'weightNode', 0) > 0 &&
      (def.resourceWeights === undefined ||
        sortedKeys(def.resourceWeights).length === 0)
    ) {
      return '"resourceWeights" is required when "weightNode" is above 0';
    }
    return null;
  },
  // Enough different buildings for `players + 1` rewards (always so with the
  // shipped shop table); the other kinds join the draw when they can be used.
  available: (ctx) => buildingPool(ctx).length >= ctx.state.players.length + 1,
  instantiate(ctx, def, rng) {
    const players = ctx.state.players.length;
    const first =
      ctx.state.caravanFirst === undefined
        ? rng.child('first').nextInt(players)
        : (ctx.state.caravanFirst + 1) % players;
    const order = Array.from(
      { length: players },
      (_x, i) => (first + i) % players,
    );
    return { order, items: drawItems(ctx, def, rng.child('items')) };
  },
  resolve(ctx, offer) {
    const items = readItems(offer['items']);
    const order = offer['order'];
    const players = ctx.state.players.length;
    if (
      items === null ||
      items.length !== players + 1 ||
      !Array.isArray(order) ||
      order.length !== players
    ) {
      return { patch: {}, followUp: null };
    }
    return {
      patch: {
        caravanCount: (ctx.state.caravanCount ?? 0) + 1,
        caravanFirst: order[0] as number,
      },
      followUp: {
        prompt: CARAVAN_PROMPT,
        options: [],
        draft: { items: items as unknown as Json[], order: order as number[] },
      },
    };
  },
};

/**
 * Draw `players + 1` distinct rewards: per reward one weighted draw of the
 * kind among those that can still be made (gold once, an Upgrade once, a
 * modifier once and so at most one party-wide item, buildings and Node
 * resources each once), then one draw within the kind.
 */
function drawItems(ctx: EventContext, def: EventDef, rng: Rng): Json[] {
  const n = ctx.state.players.length + 1;
  const buildings = buildingPool(ctx);
  const resources = nodeResources(ctx, def);
  const modifiers = eligibleModifiers(ctx);
  const canUpgrade = someone(ctx, (p) => upgradeOptions(ctx, p).length > 0);
  const canNode = someone(ctx, (p) => nodeCells(ctx, p).length > 0);
  const items: CaravanItem[] = [];
  const has = (k: CaravanKind): boolean => items.some((i) => i.kind === k);
  while (items.length < n) {
    const left = {
      buildings: buildings.filter(
        (b) => !items.some((i) => i.kind === 'building' && i.def === b.def),
      ),
      resources: resources.filter(
        (r) => !items.some((i) => i.kind === 'node' && i.resource === r),
      ),
    };
    const kinds: { kind: CaravanKind; weight: number }[] = [];
    const add = (kind: CaravanKind, ok: boolean): void => {
      const weight = numParam(def, WEIGHT_KEYS[kind], 0);
      if (ok && weight > 0) kinds.push({ kind, weight });
    };
    add('gold', !has('gold'));
    add('building', left.buildings.length > 0);
    add('upgrade', canUpgrade && !has('upgrade'));
    add('node', canNode && left.resources.length > 0);
    add('modifier', modifiers.length > 0 && !has('modifier'));
    if (kinds.length === 0) break;
    const kind = (
      kinds[
        pickWeightedIndex(
          rng,
          kinds.map((k) => k.weight),
        )
      ] as { kind: CaravanKind }
    ).kind;
    const id = `it${String(items.length)}`;
    switch (kind) {
      case 'gold':
        items.push({ id, kind, gold: numParam(def, 'gold', 0) });
        break;
      case 'building': {
        const b = left.buildings[
          pickWeightedIndex(
            rng,
            left.buildings.map((e) => e.weight),
          )
        ] as { def: string };
        items.push({ id, kind, def: b.def });
        break;
      }
      case 'upgrade':
        items.push({ id, kind });
        break;
      case 'node': {
        const weights = def.resourceWeights ?? {};
        const r = left.resources[
          pickWeightedIndex(
            rng,
            left.resources.map((x) => weights[x] ?? 0),
          )
        ] as string;
        items.push({ id, kind, resource: r });
        break;
      }
      case 'modifier':
        items.push({
          id,
          kind,
          modifier: rng.pick(modifiers),
          partyWide: true,
        });
        break;
    }
  }
  return items as unknown as Json[];
}

// ---------------------------------------------------------------------------
// Choosing

/** Why `player` may not take `item` with `sub` now (null: they may). */
function itemProblem(
  ctx: EventContext,
  item: CaravanItem,
  sub: string | null,
  player: number,
): string | null {
  const { state, content } = ctx;
  switch (item.kind) {
    case 'gold':
    case 'building':
      return sub === null ? null : 'invalid_choice';
    case 'modifier': {
      if (sub !== null || item.modifier === undefined) return 'invalid_choice';
      const m = findModifier(ctx.config, item.modifier);
      if (m === undefined || m.pact === true) return 'invalid_choice';
      if (state.round < (m.fromRound ?? 1)) return 'not_unlocked';
      if (!m.stackable && heldModifierIds(state.team).includes(m.id)) {
        return 'already_held';
      }
      return null;
    }
    case 'upgrade': {
      const m = sub === null ? null : /^b([0-9]+)$/.exec(sub);
      if (m === null) return 'invalid_choice';
      const building = Number(m[1]);
      return upgradeOptions(ctx, player).some((o) => o.building === building)
        ? null
        : 'invalid_choice';
    }
    case 'node': {
      const cell = sub === null ? null : richVeinCell(sub);
      if (
        cell === null ||
        ctx.mapgen === undefined ||
        item.resource === undefined
      ) {
        return 'invalid_choice';
      }
      const r = addNode(state.team, content, ctx.mapgen, {
        owner: player,
        x: cell.x,
        y: cell.y,
        resource: item.resource,
        round: state.round,
      });
      return r.ok ? null : r.reason;
    }
  }
}

/** True if `player` could take `item` (with some sub-choice). */
function takeable(
  ctx: EventContext,
  item: CaravanItem,
  player: number,
): boolean {
  switch (item.kind) {
    case 'upgrade':
      return upgradeOptions(ctx, player).length > 0;
    case 'node':
      return nodeCells(ctx, player).length > 0 && item.resource !== undefined;
    default:
      return itemProblem(ctx, item, null, player) === null;
  }
}

/** The free items `player` could take now (not taken by another player). */
export function takeableItems(
  ctx: EventContext,
  draft: Draft,
  player: number,
): CaravanItem[] {
  const gone = takenByOthers(draft, player);
  return draft.items.filter((i) => !gone.has(i.id) && takeable(ctx, i, player));
}

/** The options of the Upgrade item for `player` (buildings below tier 3). */
export function upgradeChoices(ctx: EventContext, player: number) {
  return upgradeOptions(ctx, player);
}

/** The cells of the Node item for `player`. */
export function nodeChoices(ctx: EventContext, player: number) {
  return nodeCells(ctx, player);
}

/**
 * Why `player` may not send `choice` now (null: they may). Does not look at
 * whose turn it is.
 */
export function draftChoiceProblem(
  ctx: EventContext,
  draft: Draft,
  player: number,
  choice: string,
): string | null {
  if (choice === SKIP_CHOICE) {
    // Passing is only for a player who can take nothing that is left.
    return takeableItems(ctx, draft, player).length === 0
      ? null
      : 'invalid_choice';
  }
  const parsed = parseCaravanChoice(choice);
  const item =
    parsed === null ? undefined : draft.items.find((i) => i.id === parsed.item);
  if (parsed === null || item === undefined) return 'invalid_choice';
  if (takenByOthers(draft, player).has(item.id)) return 'invalid_choice';
  return itemProblem(ctx, item, parsed.sub, player);
}

/**
 * The `event_choose` intent in a draft. Only the player whose turn it is
 * (or the one before, to change their pick) may send it (`not_your_turn`);
 * the choice must be a free item the player can take (`invalid_choice`). The
 * pick is stored; the last player's pick applies every pick in choosing order.
 */
export function chooseDraft(
  ctx: EventContext,
  offer: EventOffer,
  player: number,
  choice: string,
): HandlerResult {
  const state = ctx.state;
  const pending = isRecord(state.pending) ? state.pending : {};
  const fu = pending['followUp'] as Record<string, Json>;
  const draft = readDraft(fu);
  if (draft === null) {
    return { ok: false, reason: 'invalid_intent', detail: 'bad draft' };
  }
  const turn = draftTurn(draft);
  const slot =
    turn.chooser === player
      ? turn.cursor
      : turn.changer === player
        ? turn.cursor - 1
        : -1;
  if (slot < 0) return { ok: false, reason: 'not_your_turn' };
  const problem = draftChoiceProblem(ctx, draft, player, choice);
  if (problem !== null) return { ok: false, reason: problem };
  const taken = draft.taken.map((t, i) => (i === slot ? choice : t));
  const effects: Effect[] = [{ type: 'vote_changed', player }];
  if (taken.includes(null)) {
    return {
      ok: true,
      state: {
        ...state,
        pending: { ...pending, followUp: { ...fu, taken } },
      },
      effects,
    };
  }
  const r = applyDraft(ctx, draft, taken);
  effects.push({
    type: 'custom',
    name: 'event_resolved',
    data: {
      offer: offer.id,
      type: offer.type,
      order: [...draft.order],
      choices: taken,
      applied: r.applied,
    },
  });
  return {
    ok: true,
    state: {
      ...state,
      team: r.team,
      perPlayer: r.perPlayer,
      pending: { ...pending, followUp: { ...fu, taken } },
    },
    effects,
    advance: true,
  };
}

/**
 * Apply every pick in choosing order. Each is re-checked against the team as
 * it is then; one that no longer holds is applied as a skip (`dropped`).
 */
function applyDraft(
  ctx: EventContext,
  draft: Draft,
  taken: readonly (string | null)[],
): {
  readonly team: RunState['team'];
  readonly perPlayer: readonly PlayerRunState[];
  readonly applied: Json[];
} {
  let team = ctx.state.team;
  let perPlayer = ctx.state.perPlayer;
  const applied: Json[] = [];
  draft.order.forEach((player, i) => {
    const choice = taken[i] ?? SKIP_CHOICE;
    const now: EventContext = {
      ...ctx,
      state: { ...ctx.state, team, perPlayer },
    };
    const dropped = (reason: string): void => {
      applied.push({ player, result: 'skip', dropped: true, reason });
    };
    if (choice === SKIP_CHOICE) {
      applied.push({ player, result: 'skip' });
      return;
    }
    const parsed = parseCaravanChoice(choice);
    const item =
      parsed === null
        ? undefined
        : draft.items.find((it) => it.id === parsed.item);
    if (parsed === null || item === undefined) {
      dropped('invalid_choice');
      return;
    }
    const problem = itemProblem(now, item, parsed.sub, player);
    if (problem !== null) {
      dropped(problem);
      return;
    }
    switch (item.kind) {
      case 'gold': {
        const gold = item.gold ?? 0;
        perPlayer = perPlayer.map((p, k) =>
          k === player ? { ...p, gold: p.gold + gold } : p,
        );
        applied.push({ player, result: 'gold', gold });
        return;
      }
      case 'building': {
        const r = addToStash(team, ctx.content, {
          def: item.def ?? '',
          tier: 1,
          owner: player,
        });
        if (!r.ok) {
          dropped(r.reason);
          return;
        }
        team = r.state;
        applied.push({
          player,
          result: 'building',
          def: item.def ?? '',
          building: r.id,
        });
        return;
      }
      case 'upgrade': {
        const id = Number((parsed.sub as string).slice(1));
        const o = upgradeOptions(now, player).find((x) => x.building === id);
        const r = raiseTier(team, { id });
        if (o === undefined || !r.ok) {
          dropped('cannot_raise');
          return;
        }
        team = r.state;
        applied.push({
          player,
          result: 'upgrade',
          building: id,
          def: o.def,
          newTier: o.newTier,
        });
        return;
      }
      case 'node': {
        const cell = richVeinCell(parsed.sub as string) as {
          x: number;
          y: number;
        };
        const r = addNode(
          team,
          ctx.content,
          ctx.mapgen as NonNullable<EventContext['mapgen']>,
          {
            owner: player,
            x: cell.x,
            y: cell.y,
            resource: item.resource ?? '',
            round: ctx.state.round,
          },
        );
        if (!r.ok) {
          dropped(r.reason);
          return;
        }
        team = r.state;
        applied.push({
          player,
          result: 'node',
          x: cell.x,
          y: cell.y,
          resource: item.resource ?? '',
        });
        return;
      }
      case 'modifier': {
        const m = findModifier(ctx.config, item.modifier ?? '');
        if (m === undefined) {
          dropped('invalid_choice');
          return;
        }
        team = withModifier(team, { id: m.id, effects: m.effects });
        applied.push({
          player,
          result: 'modifier',
          modifier: m.id,
          partyWide: true,
        });
        return;
      }
    }
  });
  return { team, perPlayer, applied };
}

// ---------------------------------------------------------------------------
// What a screen needs

/** The draft as one player sees it. */
export interface CaravanView {
  readonly draft: Draft;
  /** Who is up (has not chosen yet), or null. */
  readonly chooser: number | null;
  /** Who may still change their pick (the player before the chooser), or null. */
  readonly changer: number | null;
  /** What `player` may do now: pick, change their pick, or wait. */
  readonly role: 'choose' | 'change' | 'wait';
  /** Per item: the player who holds it now, or null while free. */
  readonly holders: readonly (number | null)[];
  /** Per item: whether `player` could take it (free items only). */
  readonly takeable: readonly boolean[];
  /** True if `player` is up and can take nothing: they must pass (`skip`). */
  readonly mustSkip: boolean;
  /** The buildings `player` could raise (the Upgrade item's sub-choice). */
  readonly upgrades: ReturnType<typeof upgradeChoices>;
  /** The cells `player` could add a node to (the Node item's sub-choice). */
  readonly cells: ReturnType<typeof nodeChoices>;
}

/** The open draft for `player`, or null when no draft is open. */
export function caravanView(
  ctx: EventContext,
  player: number,
): CaravanView | null {
  const draft = openDraft(ctx.state);
  if (draft === null) return null;
  const turn = draftTurn(draft);
  const holders = draft.items.map((it): number | null => {
    const i = draft.taken.findIndex(
      (t) => t !== null && parseCaravanChoice(t)?.item === it.id,
    );
    return i < 0 ? null : (draft.order[i] ?? null);
  });
  const role =
    turn.chooser === player
      ? 'choose'
      : turn.changer === player
        ? 'change'
        : 'wait';
  const free = takeableItems(ctx, draft, player).map((i) => i.id);
  return {
    draft,
    chooser: turn.chooser,
    changer: turn.changer,
    role,
    holders,
    takeable: draft.items.map((i) => free.includes(i.id)),
    mustSkip: role !== 'wait' && free.length === 0,
    upgrades: upgradeOptions(ctx, player),
    cells: nodeCells(ctx, player),
  };
}

/**
 * The next pick of a plain player (the bot, the test drivers): the player who
 * is up takes the first free reward in the order gold, modifier, raise, node,
 * building (a free building is last: it lands in the stash), with the first legal sub-choice, or passes when they can take
 * none. Every pick it names is legal for a draft as the handler drew it (the
 * modifier was eligible when drawn and nothing changes during the draft).
 * Null when no draft is open.
 */
export function defaultDraftPick(
  state: RunState,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig'>,
): { readonly player: number; readonly choice: string } | null {
  const draft = openDraft(state);
  if (draft === null) return null;
  const player = draftTurn(draft).chooser;
  if (player === null) return null;
  const free = draft.items.filter(
    (it) =>
      !draft.taken.some(
        (t) => t !== null && parseCaravanChoice(t)?.item === it.id,
      ),
  );
  for (const kind of [
    'gold',
    'modifier',
    'upgrade',
    'node',
    'building',
  ] as const) {
    for (const it of free.filter((x) => x.kind === kind)) {
      if (kind === 'upgrade') {
        const o = workshopOptions(
          state.team,
          player,
          state.perPlayer[player]?.gold ?? 0,
          deps.content,
          0,
        )[0];
        if (o !== undefined) {
          return {
            player,
            choice: caravanChoice(it.id, upgradeSub(o.building)),
          };
        }
      } else if (kind === 'node') {
        const c = addableNodeCells(
          state.team,
          deps.content,
          deps.mapgenConfig,
          player,
        )[0];
        if (c !== undefined) {
          return { player, choice: caravanChoice(it.id, nodeSub(c.x, c.y)) };
        }
      } else {
        return { player, choice: it.id };
      }
    }
  }
  return { player, choice: SKIP_CHOICE };
}
