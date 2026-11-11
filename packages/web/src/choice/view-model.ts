/**
 * View model of the PvE difficulty choice (wireframe 7): three cards, each
 * with the archetype and what it does in plain words, the threat level and
 * facts, and the reward. Pure; reads the stored options of the run.
 */
import type { SimConfig } from '@game/core';
import {
  nextBattleInfo,
  openVote,
  type PveOptionView,
  type RunDeps,
  type RunState,
} from '@game/session';
import { clock } from '../battle/derive.js';
import { archetypeText } from '../run/temporary-text.js';
import { count } from '../plural.js';
import { overloadLine, partyCoreMax } from './overload.js';

export interface PveCard {
  readonly id: string;
  /** "Easy", "Medium", "Hard". */
  readonly difficulty: string;
  readonly archetype: string;
  readonly description: string;
  readonly tests: string;
  /** 1 to 3 red pips. */
  readonly level: number;
  readonly levelText: string;
  /** Plain facts about the threat: units, defenses, Core, first wave. */
  readonly facts: readonly string[];
  readonly rewardText: string;
  /** Which Core Overload destroys first against this stronghold, and when. */
  readonly overload: string;
  /** True when this is the player's current vote. */
  readonly voted: boolean;
}

export interface PveChoiceView {
  readonly round: number;
  readonly cards: readonly PveCard[];
  /** "Win: take the reward. Lose: no reward, and no life lost." */
  readonly stakes: string;
  readonly overloadAt: string;
}

const LEVEL_WORDS = ['', 'Low', 'Medium', 'High'];

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The threat facts of an option, in the order a player cares about. */
export function threatFacts(o: PveOptionView, sim: SimConfig): string[] {
  const s = o.summary;
  const facts = [count(s.totalUnits, 'enemy unit')];
  if (s.walls > 0) facts.push(count(s.walls, 'wall'));
  if (s.turrets > 0) facts.push(count(s.turrets, 'turret'));
  facts.push(`Core ${String(s.coreHealth)} health`);
  facts.push(
    s.firstWaveTick === null
      ? 'no waves'
      : `first wave at ${clock(s.firstWaveTick, sim.ticksPerSecond)}`,
  );
  return facts;
}

/** The Overload start as `m:ss` from the sim config (a deadline for PvE). */
export function overloadClock(sim: SimConfig): string {
  return clock(sim.overloadStartTick, sim.ticksPerSecond);
}

export function pveChoiceView(
  run: RunState,
  deps: Pick<RunDeps, 'rules' | 'rewards' | 'content'>,
  sim: SimConfig,
  player: number,
): PveChoiceView | null {
  const info = nextBattleInfo(run, deps);
  if (info === null || info.kind !== 'pve') return null;
  const vote = openVote(run);
  const mine = vote?.choices[player] ?? null;
  const overloadAt = overloadClock(sim);
  const partyMax = partyCoreMax(run.team, deps.content.buildings);
  const cards = info.options.map((o): PveCard => {
    const text = archetypeText(o.archetype);
    return {
      id: o.id,
      difficulty: capital(o.difficulty),
      archetype: text.name,
      description: text.description,
      tests: text.tests,
      level: o.summary.level,
      levelText: LEVEL_WORDS[o.summary.level] ?? String(o.summary.level),
      facts: threatFacts(o, sim),
      rewardText: `+${String(o.reward.gold)} gold${run.players.length > 1 ? ' each' : ''}`,
      overload: overloadLine(sim, partyMax, o.summary.coreHealth),
      voted: mine === o.id,
    };
  });
  return {
    round: info.round,
    cards,
    stakes: 'Win: take the reward. Lose: no reward, and no life lost.',
    overloadAt,
  };
}
