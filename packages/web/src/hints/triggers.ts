/**
 * When each first-time hint is due (issue #419). Pure: reads the run and says
 * which hint, if any, fits the screen now. Never on a battle screen, and
 * never more than one at a time. Whether it was seen, and the tips setting,
 * are the caller's business (`dueHint`).
 */
import { createContext } from 'preact';
import {
  occupancy,
  queryMap,
  type Cell,
  type EventsConfig,
  type TeamState,
} from '@game/core';
import { openDraft, type RunDeps, type RunState } from '@game/session';
import type { WebContent } from '../content.js';
import { eventCards, followUpView } from '../event/view-model.js';
import { nextBattleView } from '../shop/view-model.js';
import type { HintId } from './hint-store.js';

/** The plot counts as nearly full when this share of its free ground is left. */
export const PLOT_FULL_FREE_PERCENT = 15;

/** Shown in the info rail; set by the run screen. */
export const HintContext = createContext<HintId | null>(null);

/** The Transmuter has one input and no refinery rule (as the shop's hint). */
const NOT_A_REFINERY = 'bld_transmuter';

export function hasPlacedRefinery(
  team: TeamState,
  content: WebContent,
  player: number,
): boolean {
  return team.buildings.some(
    (b) =>
      b.owner === player &&
      b.def !== NOT_A_REFINERY &&
      content.buildings.get(b.def)?.kind === 'refinery',
  );
}

/** Free and buildable cells of the player's plot, and how many it has. */
export function plotRoom(
  team: TeamState,
  content: WebContent,
  player: number,
): { readonly free: number; readonly total: number } {
  const q = queryMap(team.map, content.terrain);
  const occ = occupancy(team, content);
  const taken = new Set<number>();
  for (const c of team.conduits) {
    if (c.owner !== player) continue;
    for (const k of c.cells) taken.add(k.y * team.map.width + k.x);
  }
  const x0 = player * team.map.plotWidth;
  let free = 0;
  let total = 0;
  for (let y = 0; y < team.map.height; y++) {
    for (let x = x0; x < x0 + team.map.plotWidth; x++) {
      if (!q.isBuildable(x, y)) continue;
      total++;
      const cell: Cell = { x, y };
      if (occ.buildingAt(cell.x, cell.y) !== null) continue;
      if (taken.has(y * team.map.width + x)) continue;
      free++;
    }
  }
  return { free, total };
}

export function plotNearlyFull(
  team: TeamState,
  content: WebContent,
  player: number,
): boolean {
  if (team.cores[player] == null) return false;
  const { free, total } = plotRoom(team, content, player);
  return total > 0 && free * 100 <= total * PLOT_FULL_FREE_PERCENT;
}

export interface HintInput {
  readonly run: RunState;
  readonly acting: number;
  readonly content: WebContent;
  readonly deps: Pick<RunDeps, 'rules' | 'rewards' | 'content'>;
  readonly events: EventsConfig;
}

/** The hints that fit the screen now, in the order they are shown. */
export function candidateHints(i: HintInput): readonly HintId[] {
  const { run, acting, content } = i;
  const out: HintId[] = [];
  if (run.step === 'event_choice') {
    const cards = eventCards(run, acting, i.events, content);
    if (cards.some((c) => c.type === 'pact')) out.push('pact');
  } else if (run.step === 'event_resolve') {
    if (openDraft(run) !== null) out.push('caravan');
    else if (followUpView(run, i.events, content, acting, i.deps)?.vein != null)
      out.push('vein');
  } else if (run.step === 'build' || run.step === 'shop') {
    if (nextBattleView(run, i.deps)?.boss === true) out.push('boss');
    if (hasPlacedRefinery(run.team, content, acting))
      out.push('refineryPlaced');
    if (plotNearlyFull(run.team, content, acting)) out.push('plotFull');
  }
  const stepOk =
    run.step === 'build' ||
    run.step === 'shop' ||
    run.step === 'event_choice' ||
    run.step === 'event_resolve';
  if (stepOk && (run.team.modifiers?.length ?? 0) > 0) out.push('bonuses');
  return out;
}

/**
 * The hint to show: the first candidate not yet seen; none while a tutorial
 * is running or tips are off.
 */
export function dueHint(
  i: HintInput,
  opts: {
    readonly seen: readonly HintId[];
    readonly tipsOff: boolean;
    readonly tutorialActive: boolean;
  },
): HintId | null {
  if (opts.tipsOff || opts.tutorialActive) return null;
  return candidateHints(i).find((h) => !opts.seen.includes(h)) ?? null;
}
