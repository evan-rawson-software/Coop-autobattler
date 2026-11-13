/**
 * View model of the Run over screen (wireframe 9): the depth reached, whether
 * it is a new best, the battle records of the run, the final factory's counts
 * and the round-by-round table. Pure.
 */
import type { TeamState } from '@game/core';
import type { HistoryEntry, RoundRecord, RunState } from '@game/session';
import { opponentName } from '../event/view-model.js';
import { bossName } from '../run/display-text.js';
import { screenText, screenTexts } from '../build/texts.js';

export interface BestView {
  readonly isNewBest: boolean;
  /** "New best for 1 player (was round 3)" and the like. */
  readonly text: string;
}

/**
 * Whether `state`'s depth beats every OTHER finished run with the same party
 * size. `history` holds every finished run, this one included (the controller
 * records it before the screen opens), so this run is left out by its id.
 */
export function bestView(
  state: RunState,
  history: readonly HistoryEntry[],
): BestView {
  const size = state.players.length;
  const depth = state.outcome?.round ?? state.round;
  const label = screenText(
    screenTexts,
    size === 1 ? 'runOverPlayersOne' : 'runOverPlayersMany',
    { count: String(size) },
  );
  let before = 0;
  for (const h of history) {
    if (h.runId !== state.runId && h.partySize === size && h.round > before) {
      before = h.round;
    }
  }
  if (before === 0) {
    return {
      isNewBest: true,
      text: screenText(screenTexts, 'runOverBestFirst', { label }),
    };
  }
  return depth > before
    ? {
        isNewBest: true,
        text: screenText(screenTexts, 'runOverBestNew', {
          label,
          round: String(before),
        }),
      }
    : {
        isNewBest: false,
        text: screenText(screenTexts, 'runOverBestKept', {
          label,
          round: String(before),
        }),
      };
}

export interface RoundRow {
  readonly round: number;
  /** "Hard · Rusher" or "—". */
  readonly pve: string;
  readonly pveResult: 'won' | 'lost' | '—';
  /** "the boss (Fortress)", "Ghost · label" (bundled ones say so), or "—". */
  readonly pvp: string;
  readonly pvpResult: 'won' | 'lost' | '—';
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The result mark of a battle, or the dash for no battle. */
function mark(r: { readonly won: boolean } | null): 'won' | 'lost' | '—' {
  return r === null ? '—' : r.won ? 'won' : 'lost';
}

/** The player-facing text of a result mark. */
export function resultText(result: 'won' | 'lost' | '—'): string {
  return screenText(
    screenTexts,
    result === 'won'
      ? 'runOverWon'
      : result === 'lost'
        ? 'runOverLost'
        : 'runOverNone',
  );
}

export function roundRows(history: readonly RoundRecord[]): RoundRow[] {
  const none = screenText(screenTexts, 'runOverNone');
  return history.map((r): RoundRow => {
    const pve = r.pve;
    const pvp = r.pvp;
    return {
      round: r.round,
      pve:
        pve === null
          ? none
          : screenText(screenTexts, 'runOverPveRow', {
              difficulty: capital(pve.difficulty),
              name: opponentName(pve.opponent.kind, pve.opponent.label),
            }),
      pveResult: mark(pve),
      pvp:
        pvp === null
          ? none
          : pvp.opponent.kind === 'boss'
            ? bossName(opponentName('boss', pvp.opponent.label))
            : pvp.opponent.label.startsWith('Bundled ')
              ? screenText(screenTexts, 'runOverGhostBundled', {
                  label: pvp.opponent.label,
                })
              : screenText(screenTexts, 'runOverGhost', {
                  label: opponentName(pvp.opponent.kind, pvp.opponent.label),
                }),
      pvpResult: mark(pvp),
    };
  });
}

export interface Tally {
  readonly won: number;
  readonly lost: number;
}

export interface RunStats {
  readonly pvp: Tally;
  readonly pvpGhosts: Tally;
  readonly pvpBosses: Tally;
  readonly pve: Tally;
  /** Counts of PvE battles by difficulty id. */
  readonly pveByDifficulty: Readonly<Record<string, number>>;
  readonly livesLost: number;
}

function add(t: Tally, won: boolean): Tally {
  return won ? { ...t, won: t.won + 1 } : { ...t, lost: t.lost + 1 };
}

export function runStats(state: RunState, startingLives: number): RunStats {
  let pvp: Tally = { won: 0, lost: 0 };
  let pvpGhosts: Tally = { won: 0, lost: 0 };
  let pvpBosses: Tally = { won: 0, lost: 0 };
  let pve: Tally = { won: 0, lost: 0 };
  const byDifficulty: Record<string, number> = {};
  for (const r of state.history) {
    if (r.pve !== null) {
      pve = add(pve, r.pve.won);
      byDifficulty[r.pve.difficulty] =
        (byDifficulty[r.pve.difficulty] ?? 0) + 1;
    }
    if (r.pvp !== null) {
      pvp = add(pvp, r.pvp.won);
      if (r.pvp.opponent.kind === 'ghost') {
        pvpGhosts = add(pvpGhosts, r.pvp.won);
      } else pvpBosses = add(pvpBosses, r.pvp.won);
    }
  }
  return {
    pvp,
    pvpGhosts,
    pvpBosses,
    pve,
    pveByDifficulty: byDifficulty,
    livesLost: Math.max(0, startingLives - state.lives),
  };
}

export interface FactoryCounts {
  readonly buildings: number;
  readonly atTier3: number;
  readonly stash: number;
}

export function factoryCounts(team: TeamState): FactoryCounts {
  return {
    buildings: team.buildings.length,
    atTier3: team.buildings.filter((b) => b.tier >= 3).length,
    stash: team.stash.length,
  };
}

/** The headline and the reason the run ended. */
export function headline(state: RunState): {
  readonly title: string;
  readonly reason: string;
} {
  const round = state.outcome?.round ?? state.round;
  return {
    title: screenText(screenTexts, 'runOverReached', {
      round: String(round),
    }),
    reason: screenText(
      screenTexts,
      state.outcome?.reason === 'abandoned'
        ? 'runOverReasonAbandoned'
        : state.players.length > 1
          ? 'runOverReasonParty'
          : 'runOverReasonSolo',
    ),
  };
}
