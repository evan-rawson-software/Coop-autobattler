/**
 * View model of the Run over screen (wireframe 9): the depth reached, whether
 * it is a new best, the battle records of the run, the final factory's counts
 * and the round-by-round table. Pure.
 */
import type { TeamState } from '@game/core';
import type { HistoryEntry, RoundRecord, RunState } from '@game/session';
import { opponentName } from '../event/view-model.js';
import { bossName } from '../run/temporary-text.js';

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
  const label = size === 1 ? '1 player' : `${String(size)} players`;
  let before = 0;
  for (const h of history) {
    if (h.runId !== state.runId && h.partySize === size && h.round > before) {
      before = h.round;
    }
  }
  if (before === 0) {
    return { isNewBest: true, text: `First recorded run for ${label}` };
  }
  return depth > before
    ? {
        isNewBest: true,
        text: `New best for ${label} (was round ${String(before)})`,
      }
    : {
        isNewBest: false,
        text: `Best for ${label}: round ${String(before)}`,
      };
}

export interface RoundRow {
  readonly round: number;
  /** "Hard · Rusher" or "—". */
  readonly pve: string;
  readonly pveResult: 'won' | 'lost' | '—';
  /** "the boss (Fortress)", a ghost's name, or "—". */
  readonly pvp: string;
  readonly pvpResult: 'won' | 'lost' | '—';
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function roundRows(history: readonly RoundRecord[]): RoundRow[] {
  return history.map((r): RoundRow => {
    const pve = r.pve;
    const pvp = r.pvp;
    return {
      round: r.round,
      pve:
        pve === null
          ? '—'
          : `${capital(pve.difficulty)} · ${opponentName(pve.opponent.kind, pve.opponent.label)}`,
      pveResult: pve === null ? '—' : pve.won ? 'won' : 'lost',
      pvp:
        pvp === null
          ? '—'
          : pvp.opponent.kind === 'boss'
            ? bossName(opponentName('boss', pvp.opponent.label))
            : opponentName(pvp.opponent.kind, pvp.opponent.label),
      pvpResult: pvp === null ? '—' : pvp.won ? 'won' : 'lost',
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
    title: `Reached round ${String(round)}`,
    reason:
      state.outcome?.reason === 'abandoned'
        ? 'You abandoned this run.'
        : 'Your last life was lost in a PvP battle.',
  };
}
