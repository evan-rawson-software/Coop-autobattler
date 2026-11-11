import { describe, expect, test } from 'vitest';
import type { HistoryEntry, RoundRecord, RunState } from '@game/session';
import { newRun, playUntil } from '../run/test-run.js';
import {
  bestView,
  factoryCounts,
  headline,
  roundRows,
  runStats,
} from './view-model.js';

function entry(runId: string, round: number, partySize = 1): HistoryEntry {
  return {
    runId,
    partySize,
    round,
    reason: 'defeated',
    pvpWon: 0,
    pvpLost: 0,
    runVersion: '0.1',
    finishedAt: 1,
  };
}

const history: RoundRecord[] = [
  {
    round: 1,
    pve: {
      difficulty: 'hard',
      won: true,
      opponent: { kind: 'pve', label: 'arch_rusher' },
    },
    pvp: { won: true, opponent: { kind: 'ghost', label: 'Kai, Lin, Mo' } },
  },
  {
    round: 2,
    pve: {
      difficulty: 'easy',
      won: false,
      opponent: { kind: 'pve', label: 'arch_fortress' },
    },
    pvp: { won: false, opponent: { kind: 'boss', label: 'arch_boss' } },
  },
  { round: 3, pve: null, pvp: null },
];

function finished(extra: Partial<RunState> = {}): RunState {
  return {
    ...newRun(),
    step: 'run_over',
    round: 3,
    lives: 0,
    history,
    outcome: { reason: 'defeated', round: 3 },
    ...extra,
  };
}

describe('depth and new best', () => {
  test('a deeper run than any other of the same party size is a new best', () => {
    const b = bestView(finished(), [entry('x', 2), entry('test-run', 3)]);
    expect(b).toEqual({
      isNewBest: true,
      text: 'New best for 1 player (was round 2)',
    });
  });

  test('this run is left out of the comparison (it is already in history)', () => {
    const b = bestView(finished(), [entry('test-run', 3)]);
    expect(b.isNewBest).toBe(true);
    expect(b.text).toBe('First recorded run for 1 player');
  });

  test('equalling or missing the best is not a new best', () => {
    expect(bestView(finished(), [entry('x', 3)]).isNewBest).toBe(false);
    expect(bestView(finished(), [entry('x', 7)]).text).toBe(
      'Best for 1 player: round 7',
    );
  });

  test('other party sizes do not count', () => {
    expect(bestView(finished(), [entry('x', 9, 3)]).isNewBest).toBe(true);
  });

  test('the headline gives the depth and why the run ended', () => {
    expect(headline(finished())).toEqual({
      title: 'Reached round 3',
      reason: 'Your last life was lost in a PvP battle.',
    });
    expect(
      headline(finished({ outcome: { reason: 'abandoned', round: 2 } })),
    ).toEqual({ title: 'Reached round 2', reason: 'You abandoned this run.' });
  });
});

describe('round by round', () => {
  test('one row per round with both battles in plain words', () => {
    const rows = roundRows(history);
    expect(rows).toEqual([
      {
        round: 1,
        pve: 'Hard · Rusher',
        pveResult: 'won',
        pvp: 'Kai, Lin, Mo',
        pvpResult: 'won',
      },
      {
        round: 2,
        pve: 'Easy · Fortress',
        pveResult: 'lost',
        pvp: 'the boss',
        pvpResult: 'lost',
      },
      { round: 3, pve: '—', pveResult: '—', pvp: '—', pvpResult: '—' },
    ]);
  });

  test('records of the run: tallies, difficulties, lives lost', () => {
    const s = runStats(finished(), 5);
    expect(s.pvp).toEqual({ won: 1, lost: 1 });
    expect(s.pvpGhosts).toEqual({ won: 1, lost: 0 });
    expect(s.pvpBosses).toEqual({ won: 0, lost: 1 });
    expect(s.pve).toEqual({ won: 1, lost: 1 });
    expect(s.pveByDifficulty).toEqual({ hard: 1, easy: 1 });
    expect(s.livesLost).toBe(5);
  });
});

describe('the final factory', () => {
  test('counts what is on the board and in the stash', () => {
    const run = playUntil(newRun(), (s) => s.step === 'build');
    const c = factoryCounts(run.team);
    expect(c.buildings).toBe(run.team.buildings.length);
    expect(c.stash).toBe(run.team.stash.length);
    expect(c.stash).toBeGreaterThan(0);
  });
});
