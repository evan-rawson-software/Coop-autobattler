/**
 * View model of the Caravan draft (RS-4h): the rewards as cards (who holds
 * what, which are party-wide), the choosing order with each player's state,
 * and what the viewing player can do now (pick, change a pick, wait, pass).
 * The session decides every rule (`caravanView`); this only words it.
 */
import {
  caravanChoice,
  caravanView,
  nodeSub,
  upgradeSub,
  type CaravanItem,
  type RunDeps,
  type RunState,
} from '@game/session';
import { findModifier, type Cell, type EventsConfig } from '@game/core';
import type { WebContent } from '../content.js';
import { buildingName, resourceName } from '../build/view-model.js';
import { playerName, screenTexts } from '../build/texts.js';
import { simConfig } from '../build/setup.js';
import { effectLine, eventText, modifierName } from '../run/display-text.js';
import { kindLabel } from '../shop/effect-text.js';
import { upgradeGains } from './view-model.js';

export interface CaravanCard {
  readonly id: string;
  readonly kind: CaravanItem['kind'];
  readonly title: string;
  readonly lines: readonly string[];
  /** The sprite to draw: a building definition or a UI sprite name. */
  readonly sprite: string;
  /** True for the one reward that goes to the whole party. */
  readonly partyWide: boolean;
  /** The player who holds it now, or null while it is free. */
  readonly holder: number | null;
  /** "Taken by Bo", or null while free. */
  readonly holderText: string | null;
  /** True if the viewing player holds it. */
  readonly mine: boolean;
  /** Why the viewing player cannot take it (a free item), or null. */
  readonly disabledReason: string | null;
  /** A node's resource, or null. */
  readonly resource: string | null;
}

export interface CaravanPlayerRow {
  readonly player: number;
  readonly name: string;
  /** `took`, `up` (their turn), or `waiting`. */
  readonly state: 'took' | 'up' | 'waiting';
  /** "took 6 gold", "choosing…", "waiting". */
  readonly text: string;
}

/** A building the viewing player can raise with the Upgrade reward. */
export interface CaravanUpgradeRow {
  readonly building: number;
  readonly def: string;
  readonly name: string;
  readonly where: string;
  readonly tier: number;
  readonly newTier: number;
  readonly gains: string;
  /** The `event_choose` choice that takes the reward with this building. */
  readonly choice: (item: string) => string;
}

export interface CaravanScreenModel {
  readonly eventTitle: string;
  readonly cards: readonly CaravanCard[];
  readonly rows: readonly CaravanPlayerRow[];
  /** What the viewing player may do: pick, change their pick, or wait. */
  readonly role: 'choose' | 'change' | 'wait';
  /** True if the player is up and can take nothing: they must pass. */
  readonly mustSkip: boolean;
  /** The line above the cards: whose turn it is. */
  readonly headline: string;
  readonly upgrades: readonly CaravanUpgradeRow[];
  readonly cells: readonly Cell[];
  /** The viewing player's current pick (a choice), or null. */
  readonly mine: string | null;
}

function cardOf(
  item: CaravanItem,
  config: EventsConfig,
  content: WebContent,
): Pick<CaravanCard, 'title' | 'lines' | 'sprite' | 'resource'> {
  switch (item.kind) {
    case 'gold':
      return {
        title: `${String(item.gold ?? 0)} gold`,
        lines: ['Gold, right away.'],
        sprite: 'ui_icon_coin',
        resource: null,
      };
    case 'building': {
      const def = item.def ?? '';
      const bdef = content.buildings.get(def);
      return {
        title: buildingName(content, def),
        lines: [
          ...(bdef === undefined ? [] : [kindLabel(content, bdef.kind)]),
          'Tier 1, free, into your inventory.',
        ],
        sprite: def,
        resource: null,
      };
    }
    case 'upgrade':
      return {
        title: 'Raise a building',
        lines: [
          'Raise one of your buildings by one tier, free.',
          'You pick the building on your turn.',
        ],
        sprite: 'ui_event_drill',
        resource: null,
      };
    case 'node': {
      const name = resourceName(content, item.resource ?? '');
      return {
        title: `${name} node`,
        lines: [
          `Add a ${name} node to a free cell of your area.`,
          'You pick the cell on your turn.',
        ],
        sprite: 'ui_event_rich_vein',
        resource: item.resource ?? null,
      };
    }
    case 'modifier': {
      const id = item.modifier ?? '';
      const def = findModifier(config, id);
      return {
        title: modifierName(id),
        lines: def === undefined ? [] : def.effects.map(effectLine),
        sprite: 'ui_event_shrine',
        resource: null,
      };
    }
  }
}

/** The short phrase for what a stored choice took, for the order list. */
function tookText(
  choice: string,
  items: readonly CaravanItem[],
  config: EventsConfig,
  content: WebContent,
): string {
  if (choice === 'skip') return 'passed';
  const id = choice.split(':')[0];
  const item = items.find((i) => i.id === id);
  if (item === undefined) return 'took a reward';
  return `took ${cardOf(item, config, content).title}`;
}

/**
 * The draft as `player` sees it, or null when no draft is open. `deps` gives
 * the content and the map rules the session needs to say what the player can
 * take.
 */
export function caravanScreen(
  run: RunState,
  config: EventsConfig,
  content: WebContent,
  player: number,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig'>,
): CaravanScreenModel | null {
  const view = caravanView(
    {
      state: run,
      content: deps.content,
      config,
      mapgen: deps.mapgenConfig,
    },
    player,
  );
  if (view === null) return null;
  const names = run.players.map((p) => p.name);
  const nameOf = (i: number): string => playerName(screenTexts, names, i);
  const { draft } = view;
  const cards = draft.items.map((item, i): CaravanCard => {
    const holder = view.holders[i] ?? null;
    const free = holder === null;
    const mine = holder === player;
    const base = cardOf(item, config, content);
    let disabledReason: string | null = null;
    if (free && view.takeable[i] !== true) {
      disabledReason =
        item.kind === 'upgrade'
          ? 'You have no building to raise.'
          : item.kind === 'node'
            ? 'You have no free cell for a node.'
            : 'You cannot take this.';
    }
    return {
      id: item.id,
      kind: item.kind,
      ...base,
      partyWide: item.partyWide === true,
      holder,
      holderText: holder === null ? null : `Taken by ${nameOf(holder)}`,
      mine,
      disabledReason,
    };
  });
  const rows = draft.order.map((p, i): CaravanPlayerRow => {
    const choice = draft.taken[i] ?? null;
    if (choice !== null) {
      return {
        player: p,
        name: p === player ? `${nameOf(p)} (you)` : nameOf(p),
        state: 'took',
        text: tookText(choice, draft.items, config, content),
      };
    }
    return view.chooser === p
      ? {
          player: p,
          name: p === player ? `${nameOf(p)} (you)` : nameOf(p),
          state: 'up',
          text: 'choosing…',
        }
      : {
          player: p,
          name: p === player ? `${nameOf(p)} (you)` : nameOf(p),
          state: 'waiting',
          text: 'waiting',
        };
  });
  const slot = draft.order.indexOf(player);
  const mine = slot < 0 ? null : (draft.taken[slot] ?? null);
  const headline =
    view.role === 'choose'
      ? `Your turn, ${nameOf(player)}: take one reward.`
      : view.role === 'change'
        ? `You may change your pick until ${view.chooser === null ? 'the draft ends' : nameOf(view.chooser)} chooses.`
        : view.chooser === null
          ? 'The draft is over.'
          : `${nameOf(view.chooser)} is choosing.`;
  const upgrades = view.upgrades.map((o): CaravanUpgradeRow => {
    const bdef = content.buildings.get(o.def);
    return {
      building: o.building,
      def: o.def,
      name: buildingName(content, o.def),
      where: o.placed ? 'On the board' : 'In inventory',
      tier: o.tier,
      newTier: o.newTier,
      gains:
        bdef === undefined
          ? ''
          : upgradeGains(bdef, o.tier, o.newTier, simConfig.ticksPerSecond),
      choice: (item) => caravanChoice(item, upgradeSub(o.building)),
    };
  });
  return {
    eventTitle: eventText('caravan').name,
    cards,
    rows,
    role: view.role,
    mustSkip: view.mustSkip,
    headline,
    upgrades,
    cells: view.cells.map((c) => ({ x: c.x, y: c.y })),
    mine,
  };
}

/** The choice that takes a Node reward in cell `cell`. */
export function nodeChoice(item: string, cell: Cell): string {
  return caravanChoice(item, nodeSub(cell.x, cell.y));
}
