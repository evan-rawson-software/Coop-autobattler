/**
 * View models of the event step (wireframe 2): the header with the battle just
 * fought and what it paid, the event cards, and the follow-up choice of the
 * picked event (a Workshop's building, a Shrine's modifier).
 *
 * Cards say what an event does from the offer's own data, never from a
 * hard-coded number. There can be one, two or three cards.
 */
import { playerName, screenText, screenTexts } from '../build/texts.js';
import { findModifier, type BuildingDef, type EventsConfig } from '@game/core';
import {
  SKIP_CHOICE,
  eventFollowUp,
  openVote,
  type Json,
  type RunDeps,
  type RunState,
} from '@game/session';
import type { WebContent } from '../content.js';
import { buildingName } from '../build/view-model.js';
import { buildingRate, formatHundredths } from '../build/rates.js';
import { simConfig } from '../build/setup.js';
import {
  archetypeText,
  bossName,
  ghostDisplayName,
  effectLine,
  eventText,
  modifierName,
} from '../run/display-text.js';
import { count, plural } from '../plural.js';

function isRecord(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pendingRecord(run: RunState): Record<string, Json> {
  return isRecord(run.pending) ? run.pending : {};
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// The header

export interface BattleHeader {
  readonly kind: 'pve' | 'pvp';
  readonly won: boolean;
  /** "Won against Fortress (Easy)"; the payout follows after " · ". */
  readonly text: string;
  /** "+8 gold", or what a loss costs. */
  readonly payout: string;
}

/** The label a battle record holds, as the opponent's display name. */
export function opponentName(
  kind: 'pve' | 'ghost' | 'boss',
  label: string,
): string {
  return kind === 'ghost' ? ghostDisplayName(label) : archetypeText(label).name;
}

/**
 * The battle that came before this event step: the PvE battle in the PvE leg,
 * the PvP battle in the PvP leg, and what it paid (gold from the rewards
 * rules, a lost life from the run rules).
 */
export function battleHeader(
  run: RunState,
  deps: Pick<RunDeps, 'rules' | 'rewards'>,
): BattleHeader | null {
  const rewards = deps.rewards;
  if (run.leg === 'pve') {
    const rec = run.thisRound.pve;
    if (rec === null) return null;
    // What was actually paid, when the round recorded it; older saves lack
    // the field and fall back to the current rewards table.
    const gold =
      rec.goldPaid ??
      (rewards === undefined
        ? null
        : (rewards.pveWin as Readonly<Record<string, number>>)[rec.difficulty]);
    return {
      kind: 'pve',
      won: rec.won,
      text: `${rec.won ? 'Won against' : 'Lost to'} ${opponentName(rec.opponent.kind, rec.opponent.label)} (${capital(rec.difficulty)})`,
      payout: rec.won
        ? gold === undefined || gold === null
          ? 'Reward paid'
          : `+${String(gold)} gold`
        : 'No reward',
    };
  }
  const rec = run.thisRound.pvp;
  if (rec === null) return null;
  const who =
    rec.opponent.kind === 'boss'
      ? bossName(opponentName('boss', rec.opponent.label))
      : opponentName(rec.opponent.kind, rec.opponent.label);
  const cost = deps.rules.pvpLossLifeCost;
  const loss = rewards === undefined ? null : rewards.pvpLoss;
  const win = rewards === undefined ? null : rewards.pvpWin;
  return {
    kind: 'pvp',
    won: rec.won,
    text: `${rec.won ? 'Won against' : 'Lost to'} ${who}`,
    payout: rec.won
      ? win === null
        ? 'Reward paid'
        : `+${String(win)} gold`
      : `−${String(cost)} ${plural(cost, 'life', 'lives')}${loss === null ? '' : ` · +${String(loss)} gold`}`,
  };
}

// ---------------------------------------------------------------------------
// Cards

export interface ModifierLine {
  readonly id: string;
  readonly name: string;
  readonly effects: readonly string[];
  readonly stacks: boolean;
}

export interface EventCard {
  /** The offer id: the vote choice. */
  readonly id: string;
  readonly type: string;
  readonly title: string;
  /** What it does, one sentence each, from the offer's data. */
  readonly lines: readonly string[];
  readonly icon: string;
  readonly flavour: string;
  readonly voted: boolean;
}

function modifierLine(config: EventsConfig, id: string): ModifierLine {
  const def = findModifier(config, id);
  return {
    id,
    name: modifierName(id),
    effects: def === undefined ? [] : def.effects.map(effectLine),
    stacks: def?.stackable === true,
  };
}

function num(v: Json | undefined, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

/** The cards of the open event vote, in offer order (1 to 3 of them). */
export function eventCards(run: RunState, player: number): EventCard[] {
  const vote = openVote(run);
  const mine = vote?.choices[player] ?? null;
  const cards: EventCard[] = [];
  for (const raw of vote?.options ?? []) {
    if (!isRecord(raw) || typeof raw['id'] !== 'string') continue;
    const type = typeof raw['type'] === 'string' ? raw['type'] : 'unknown';
    const text = eventText(type);
    let lines: string[];
    if (type === 'workshop') {
      const tiers = num(raw['tiers'], 1);
      lines = [
        tiers === 1
          ? 'Pay gold to upgrade a building one tier.'
          : `Pay gold to upgrade a building by ${count(tiers, 'tier')}.`,
      ];
    } else if (type === 'shrine') {
      lines = ['Gain a lasting bonus for your walls, turrets, units or Core.'];
    } else if (type === 'windfall') {
      const gold = num(raw['gold'], 0);
      lines = [`+${String(gold)} gold.`];
    } else {
      // An event type this screen does not know: show its data as it is.
      lines = Object.entries(raw)
        .filter(([k]) => !['id', 'event', 'type'].includes(k))
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    }
    cards.push({
      id: raw['id'],
      type,
      title: text.name,
      lines,
      icon: text.icon,
      flavour: text.flavour,
      voted: mine === raw['id'],
    });
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Follow-up

export interface FollowOption {
  readonly id: string;
  readonly title: string;
  /** Plain words for what choosing it does. */
  readonly lines: readonly string[];
  /** False when the option has a price this player cannot pay. */
  readonly affordable: boolean;
  /** Why it cannot be chosen ("Not enough gold: costs 16, you have 9"). */
  readonly disabledReason: string | null;
  /** True for an option that does nothing (skip). */
  readonly skip: boolean;
  /** A building to raise: where it is, its tiers and what it costs. */
  readonly building: BuildingOption | null;
  /** A bonus that can be taken again, the bonuses adding up. */
  readonly stacks: boolean;
}

export interface BuildingOption {
  readonly id: number;
  readonly name: string;
  readonly placed: boolean;
  /** "On the board at column 4, row 7" or "In your stash". */
  readonly where: string;
  readonly tier: number;
  readonly newTier: number;
  readonly price: number;
  /** How many identical buildings this row stands for (stash rows group). */
  readonly count: number;
}

export interface FollowUpView {
  readonly eventTitle: string;
  readonly prompt: string;
  readonly options: readonly FollowOption[];
  /** This player's current choice (an option id), or null. */
  readonly voted: string | null;
  /** True if each player chooses for themselves (Workshop). */
  readonly perPlayer: boolean;
  /** Per player: has chosen (never what). */
  readonly chosen: readonly {
    readonly player: number;
    readonly name: string;
    readonly done: boolean;
    readonly status: string;
  }[];
  /** Shown once this player has chosen and others have not; else null. */
  readonly waiting: string | null;
}

/**
 * What an upgrade improves, from content numbers: health always, then one key
 * stat of the building kind (output rate, shots or units per second, damage).
 * "health 100 → 160 · output 0.50/s → 0.71/s".
 */
export function upgradeGains(
  def: BuildingDef,
  tier: number,
  newTier: number,
  ticksPerSecond: number,
): string {
  const parts: string[] = [];
  const a = def.tiers[tier - 1];
  const b = def.tiers[newTier - 1];
  if (a === undefined || b === undefined) return '';
  parts.push(`health ${String(a.health)} → ${String(b.health)}`);
  const ra = buildingRate(def, tier, ticksPerSecond);
  const rb = buildingRate(def, newTier, ticksPerSecond);
  if (ra.collects !== null && rb.collects !== null) {
    parts.push(
      `output ${formatHundredths(ra.collects)}/s → ${formatHundredths(rb.collects)}/s`,
    );
  } else if (def.kind === 'unit_producer') {
    if (ra.topSpeed !== null && rb.topSpeed !== null) {
      parts.push(
        `output ${formatHundredths(ra.topSpeed)}/s → ${formatHundredths(rb.topSpeed)}/s`,
      );
    }
  } else if (def.kind === 'defense' && def.defenseType === 'turret') {
    const da = def.tiers[tier - 1];
    const db = def.tiers[newTier - 1];
    if (da !== undefined && db !== undefined) {
      parts.push(`damage ${String(da.damage)} → ${String(db.damage)}`);
    }
  }
  return parts.join(' · ');
}

const PROMPTS: Readonly<Record<string, string>> = {
  workshop_building: 'Upgrade a building',
  shrine_modifier: 'Choose a bonus',
};

function str(v: Json | undefined): string | null {
  return typeof v === 'string' ? v : null;
}

/** "Upgrade price: 16 gold, you have 9" style reason, or null when payable. */
function goldReason(price: number, gold: number): string | null {
  return price <= gold ? null : 'Not enough gold';
}

/**
 * The follow-up choice of the picked event for `player`. The Workshop options
 * come from the session selector `eventFollowUp(state, player, deps)`, which
 * gives the player's OWN buildings with the price and affordability from
 * current content and gold; `Skip` is always offered. Other options (a
 * Shrine's modifiers, anything unknown) are listed as stored: one that names a
 * modifier lists its effects, anything else shows its id.
 */
export function followUpView(
  run: RunState,
  config: EventsConfig,
  content: WebContent,
  player: number,
  deps: Pick<RunDeps, 'content'>,
): FollowUpView | null {
  const f = eventFollowUp(run, player, deps);
  if (f === null) return null;
  const p = pendingRecord(run);
  const offer = isRecord(p['offer']) ? p['offer'] : {};
  const gold = run.perPlayer[player]?.gold ?? 0;
  const options: FollowOption[] = [];
  for (const raw of f.options) {
    if (!isRecord(raw) || typeof raw['id'] !== 'string') continue;
    const id = raw['id'];
    const def = str(raw['def']);
    const tier = typeof raw['tier'] === 'number' ? raw['tier'] : null;
    if (def !== null && tier !== null) {
      const newTier =
        typeof raw['newTier'] === 'number' ? raw['newTier'] : tier + 1;
      const price = typeof raw['price'] === 'number' ? raw['price'] : 0;
      const placedB = run.team.buildings.find((b) => b.id === raw['building']);
      const where =
        placedB === undefined
          ? 'In stash'
          : `Board (${String(placedB.x)}, ${String(placedB.y)})`;
      const name = buildingName(content, def);
      // Identical stash buildings are one row that upgrades the first of them.
      if (placedB === undefined) {
        const same = options.find(
          (o) =>
            o.building !== null &&
            !o.building.placed &&
            o.building.name === name &&
            o.building.tier === tier &&
            o.building.newTier === newTier &&
            o.building.price === price,
        );
        if (same?.building != null) {
          const b = same.building;
          const n = b.count + 1;
          const i = options.indexOf(same);
          options[i] = {
            ...same,
            title: `${name} ×${String(n)}`,
            building: { ...b, count: n },
          };
          continue;
        }
      }
      // The session's own affordability is from the owner's gold now.
      const reason = goldReason(price, gold);
      const bdef = content.buildings.get(def);
      const gains =
        bdef === undefined
          ? ''
          : upgradeGains(bdef, tier, newTier, simConfig.ticksPerSecond);
      options.push({
        id,
        title: name,
        lines: [
          where,
          `Tier ${String(tier)} → ${String(newTier)}`,
          ...(gains === '' ? [] : [gains]),
          `${String(price)} gold`,
        ],
        affordable: reason === null && raw['affordable'] !== false,
        disabledReason: reason,
        skip: false,
        building: {
          id: typeof raw['building'] === 'number' ? raw['building'] : -1,
          name,
          placed: placedB !== undefined,
          where,
          tier,
          newTier,
          price,
          count: 1,
        },
        stacks: false,
      });
    } else if (findModifier(config, id) !== undefined) {
      const m = modifierLine(config, id);
      options.push({
        id,
        title: m.name,
        lines: m.effects,
        affordable: true,
        disabledReason: null,
        skip: false,
        building: null,
        stacks: m.stacks,
      });
    } else {
      options.push({
        id,
        title: id,
        lines: [],
        affordable: true,
        disabledReason: null,
        skip: false,
        building: null,
        stacks: false,
      });
    }
  }
  if (f.perPlayer) {
    options.push({
      id: SKIP_CHOICE,
      title: 'Skip (no upgrade)',
      lines: [],
      affordable: true,
      disabledReason: null,
      skip: true,
      building: null,
      stacks: false,
    });
  }
  const chosen = f.chosen.map((done, i) => ({
    player: i,
    status: screenText(
      screenTexts,
      done ? 'eventChosenDone' : 'eventChosenPending',
      {},
    ),
    name: playerName(
      screenTexts,
      run.players.map((p) => p.name),
      i,
    ),
    done,
  }));
  const others = f.waitingFor.filter((i) => i !== player);
  const waiting =
    f.mine !== null && others.length > 0 && run.players.length > 1
      ? screenText(screenTexts, 'eventWaiting', {
          names: others
            .map((i) =>
              playerName(
                screenTexts,
                chosen.map((c) => c.name),
                i,
              ),
            )
            .join(', '),
        })
      : null;
  return {
    eventTitle:
      typeof offer['type'] === 'string'
        ? eventText(offer['type']).name
        : 'Event',
    prompt: PROMPTS[f.prompt] ?? 'Make a choice',
    options,
    voted: f.mine,
    perPlayer: f.perPlayer,
    chosen,
    waiting,
  };
}

// ---------------------------------------------------------------------------
// What the follow-up did

/**
 * The notice for `player` from an `event_resolved` effect's `applied` list:
 * the upgrade and its price, a skip, or a pick that was dropped and why.
 * Null when the effect says nothing about this player.
 */
export function appliedNotice(
  applied: readonly Json[],
  player: number,
  content: WebContent,
): string | null {
  for (const a of applied) {
    if (!isRecord(a) || a['player'] !== player) continue;
    if (a['result'] === 'upgrade') {
      const def = str(a['def']) ?? '';
      const tier = typeof a['newTier'] === 'number' ? a['newTier'] : 0;
      const price = typeof a['price'] === 'number' ? a['price'] : 0;
      return `Upgraded ${buildingName(content, def)} to tier ${String(tier)} (−${String(price)} gold).`;
    }
    if (a['dropped'] === true) {
      const why = str(a['reason']);
      return why === 'not_enough_gold'
        ? 'Upgrade skipped: not enough gold.'
        : 'Upgrade skipped.';
    }
    return 'Workshop skipped.';
  }
  return null;
}
