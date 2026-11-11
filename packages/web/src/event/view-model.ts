/**
 * View models of the event step (wireframe 2): the header with the battle just
 * fought and what it paid, the event cards, and the follow-up choice of the
 * picked event (a Workshop's building, a Shrine's modifier).
 *
 * Cards say what an event does from the offer's own data, never from a
 * hard-coded number. There can be one, two or three cards.
 */
import { findModifier, type EventsConfig } from '@game/core';
import {
  openVote,
  type Json,
  type RunDeps,
  type RunState,
} from '@game/session';
import type { WebContent } from '../content.js';
import { buildingName } from '../build/view-model.js';
import {
  archetypeText,
  bossName,
  effectLine,
  eventText,
  modifierName,
} from '../run/temporary-text.js';

function isRecord(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pendingRecord(run: RunState): Record<string, Json> {
  return isRecord(run.pending) ? run.pending : {};
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// The header

export interface BattleHeader {
  readonly kind: 'pve' | 'pvp';
  readonly won: boolean;
  /** "PvE battle won · Hard · Rusher". */
  readonly text: string;
  /** "+8 gold", or what a loss costs. */
  readonly payout: string;
}

/** The label a battle record holds, as the opponent's display name. */
export function opponentName(
  kind: 'pve' | 'ghost' | 'boss',
  label: string,
): string {
  return kind === 'ghost' ? label : archetypeText(label).name;
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
    const gold =
      rewards === undefined
        ? null
        : (rewards.pveWin as Readonly<Record<string, number>>)[rec.difficulty];
    return {
      kind: 'pve',
      won: rec.won,
      text: `PvE battle ${rec.won ? 'won' : 'lost'} · ${capital(rec.difficulty)} · ${opponentName(rec.opponent.kind, rec.opponent.label)}`,
      payout: rec.won
        ? gold === undefined || gold === null
          ? 'Reward paid'
          : `+${String(gold)} gold`
        : 'No reward, and no life lost',
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
    text: `PvP battle ${rec.won ? 'won' : 'lost'} · vs. ${who}`,
    payout: rec.won
      ? win === null
        ? 'Reward paid'
        : `+${String(win)} gold`
      : `−${String(cost)} ${plural(cost, 'life', 'lives')}${loss === null ? '' : ` · +${String(loss)} gold consolation`}`,
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
  /** For a Shrine: the modifiers on offer with their effects. */
  readonly modifiers: readonly ModifierLine[];
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
export function eventCards(
  run: RunState,
  config: EventsConfig,
  player: number,
): EventCard[] {
  const vote = openVote(run);
  const mine = vote?.choices[player] ?? null;
  const cards: EventCard[] = [];
  for (const raw of vote?.options ?? []) {
    if (!isRecord(raw) || typeof raw['id'] !== 'string') continue;
    const type = typeof raw['type'] === 'string' ? raw['type'] : 'unknown';
    const text = eventText(type);
    let lines: string[];
    let modifiers: ModifierLine[] = [];
    if (type === 'workshop') {
      const tiers = num(raw['tiers'], 1);
      lines = [
        `Raise one building you own by ${String(tiers)} ${plural(tiers, 'tier', 'tiers')} (never above tier 3).`,
        'You pick which building next.',
      ];
    } else if (type === 'shrine') {
      const ids = Array.isArray(raw['modifiers'])
        ? raw['modifiers'].filter((m): m is string => typeof m === 'string')
        : [];
      modifiers = ids.map((id) => modifierLine(config, id));
      lines = [
        `Choose 1 of ${String(ids.length)} run ${plural(ids.length, 'modifier', 'modifiers')}. It lasts until the run ends.`,
      ];
    } else if (type === 'windfall') {
      const gold = num(raw['gold'], 0);
      lines = [`Each player gets ${String(gold)} gold.`];
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
      modifiers,
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
}

export interface FollowUpView {
  readonly eventTitle: string;
  readonly prompt: string;
  readonly options: readonly FollowOption[];
  readonly voted: string | null;
}

const PROMPTS: Readonly<Record<string, string>> = {
  workshop_building: 'Choose a building to raise',
  shrine_modifier: 'Choose a run modifier',
};

/**
 * The follow-up choice of the picked event, built from `pending.followUp`
 * alone so another event type's options show up without a change here: an
 * option with a building and a tier is a building to raise, one that names a
 * modifier lists its effects, anything else shows its id.
 */
export function followUpView(
  run: RunState,
  config: EventsConfig,
  content: WebContent,
  player: number,
): FollowUpView | null {
  const p = pendingRecord(run);
  const follow = p['followUp'];
  if (!isRecord(follow) || !Array.isArray(follow['options'])) return null;
  const offer = isRecord(p['offer']) ? p['offer'] : {};
  const tiers = num(offer['tiers'], 1);
  const prompt = typeof follow['prompt'] === 'string' ? follow['prompt'] : '';
  const votes: readonly Json[] = Array.isArray(follow['votes'])
    ? (follow['votes'] as Json[])
    : [];
  const mine = votes[player];
  const options: FollowOption[] = [];
  for (const raw of follow['options'] as Json[]) {
    if (!isRecord(raw) || typeof raw['id'] !== 'string') continue;
    const id = raw['id'];
    if (typeof raw['def'] === 'string' && typeof raw['tier'] === 'number') {
      const to = Math.min(3, raw['tier'] + tiers);
      options.push({
        id,
        title: `${buildingName(content, raw['def'])} · tier ${String(raw['tier'])}`,
        lines: [
          `Becomes tier ${String(to)}.`,
          raw['placed'] === true ? 'On the board.' : 'In the stash.',
        ],
      });
    } else if (findModifier(config, id) !== undefined) {
      const m = modifierLine(config, id);
      options.push({
        id,
        title: m.name,
        lines: [...m.effects, ...(m.stacks ? ['Stacks if taken again.'] : [])],
      });
    } else {
      options.push({ id, title: id, lines: [] });
    }
  }
  return {
    eventTitle:
      typeof offer['type'] === 'string'
        ? eventText(offer['type']).name
        : 'Event',
    prompt: PROMPTS[prompt] ?? 'Make a choice',
    options,
    voted: typeof mine === 'string' ? mine : null,
  };
}
