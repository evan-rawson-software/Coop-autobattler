import { Rng } from '@game/core';
import { describe, expect, test } from 'vitest';
import { applyIntent, createRun, replayRun, tally } from './machine.js';
import {
  baseDeps,
  newRun,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
} from './test-support.js';
import type { Json, RunState } from './types.js';
import { validateRunState } from './validate.js';

/** Party votes that are not unanimous pick one vote at random (CP-16). */
describe('tally', () => {
  const base = newRun(baseDeps, ['A', 'B']);
  const withSeed = (seed: number): RunState => ({
    ...base,
    rng: Rng.fromSeed(seed).getState(),
  });
  const share = (choices: readonly Json[], want: Json, n = 3000): number => {
    let hits = 0;
    for (let seed = 1; seed <= n; seed++) {
      if (tally(withSeed(seed), choices, 'vote:test').winner === want) hits++;
    }
    return hits / n;
  };

  test('unanimous: no pick is made, but the generator advances like a split', () => {
    const s = withSeed(5);
    const t = tally(s, ['x', 'x', 'x'], 'vote:test');
    expect(t.winner).toBe('x');
    expect(t.picked).toBeNull();
    const split = tally(s, ['x', 'y', 'x'], 'vote:test');
    expect(t.state.rng).toEqual(split.state.rng);
    expect(t.state.rng).not.toEqual(s.rng);
    // Whatever the votes, the state after a resolution is the same.
    expect(tally(s, ['y', 'y'], 'vote:test').state).toEqual(
      tally(s, ['x', 'y'], 'vote:test').state,
    );
  });

  test('one player: nothing is drawn and the state is untouched', () => {
    const s = withSeed(5);
    const t = tally(s, ['x'], 'vote:test');
    expect(t.winner).toBe('x');
    expect(t.picked).toBeNull();
    expect(t.state).toBe(s);
  });

  test('a split draws exactly once, deterministically from the state', () => {
    const s = withSeed(5);
    const a = tally(s, ['x', 'y'], 'vote:test');
    const b = tally(s, ['x', 'y'], 'vote:test');
    expect(a).toEqual(b);
    expect(a.state.rng).not.toEqual(s.rng);
    expect(a.picked).not.toBeNull();
    expect(a.winner).toBe(['x', 'y'][a.picked as number]);
  });

  test('1-1: each option wins about half the time', () => {
    expect(share(['x', 'y'], 'x')).toBeGreaterThan(0.46);
    expect(share(['x', 'y'], 'x')).toBeLessThan(0.54);
  });

  test('2-1: the option with two votes wins about two thirds of the time', () => {
    const p = share(['x', 'y', 'x'], 'x');
    expect(p).toBeGreaterThan(0.63);
    expect(p).toBeLessThan(0.7);
  });

  test('2-2: each option wins about half the time', () => {
    const p = share(['x', 'y', 'x', 'y'], 'x');
    expect(p).toBeGreaterThan(0.46);
    expect(p).toBeLessThan(0.54);
  });

  test('3-1: the majority option wins about three quarters of the time', () => {
    const p = share(['x', 'x', 'y', 'x'], 'x');
    expect(p).toBeGreaterThan(0.72);
    expect(p).toBeLessThan(0.78);
  });
});

describe('a split PvE vote in a run', () => {
  const toPveChoice = (seed: number, players: readonly string[]): RunState => {
    const r = createRun(runArgs(players, seed), baseDeps);
    if (!r.ok) throw new Error(r.detail);
    return readyAll(placeCoreAll(r.state));
  };
  const split: readonly string[] = ['easy', 'hard', 'easy', 'hard'];

  function splitVoteWith(
    seed: number,
    players: readonly string[],
    votes: readonly string[],
  ): RunState {
    let s = toPveChoice(seed, players);
    for (let p = 0; p < players.length; p++) {
      s = ok(s, p, { type: 'vote', choice: votes[p] as string }).state;
    }
    return s;
  }

  function splitVote(seed: number, n: number) {
    const players = ['A', 'B', 'C', 'D'].slice(0, n);
    let s = toPveChoice(seed, players);
    expect(s.step).toBe('pve_choice');
    let fx: ReturnType<typeof ok>['effects'] = [];
    for (let p = 0; p < n; p++) {
      const r = ok(s, p, { type: 'vote', choice: split[p] as string });
      s = r.state;
      fx = r.effects;
    }
    return { s, fx };
  }

  test('1-1, 2-1 (as 2 of 3) and 2-2 are reproducible by replayRun, and the pick is one of the votes', () => {
    for (const n of [2, 3, 4]) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 12; seed++) {
        const { s, fx } = splitVote(seed, n);
        const picked = s.thisRound.pve?.difficulty as string;
        expect(split.slice(0, n)).toContain(picked);
        seen.add(picked);
        const e = fx.find((x) => x.type === 'vote_resolved');
        expect(e).toMatchObject({
          topic: 'pve',
          choice: picked,
          tickets: split.slice(0, n),
          picked: { random: true },
        });
        const players = ['A', 'B', 'C', 'D'].slice(0, n);
        const replayed = replayRun(
          runArgs(players, seed),
          s.actionLog,
          baseDeps,
        );
        expect(replayed.ok).toBe(true);
        if (replayed.ok) expect(replayed.state).toEqual(s);
        expect(
          validateRunState(JSON.parse(JSON.stringify(s)), baseDeps).ok,
        ).toBe(true);
      }
      // Over twelve seeds both options come up.
      expect(seen.size).toBe(2);
    }
  });

  test('changing a vote before the last vote changes what is counted', () => {
    let s = toPveChoice(3, ['A', 'B']);
    s = ok(s, 0, { type: 'vote', choice: 'easy' }).state;
    s = ok(s, 0, { type: 'vote', choice: 'hard' }).state;
    // Still waiting for player 1; changing to match makes it unanimous.
    expect(s.step).toBe('pve_choice');
    const r = ok(s, 1, { type: 'vote', choice: 'hard' });
    expect(r.state.thisRound.pve?.difficulty).toBe('hard');
    expect(
      r.effects.find((x) => x.type === 'vote_resolved'),
    ).not.toHaveProperty('picked');
  });

  test('a reload does not re-roll: the stored state keeps the result, and a late vote is refused', () => {
    const { s } = splitVote(4, 2);
    const reloaded = JSON.parse(JSON.stringify(s)) as RunState;
    expect(reloaded).toEqual(s);
    expect(reloaded.thisRound.pve?.difficulty).toBe(
      s.thisRound.pve?.difficulty,
    );
    // No vote is open any more.
    expect(
      applyIntent(reloaded, 0, { type: 'vote', choice: 'easy' }, baseDeps),
    ).toMatchObject({ ok: false });
  });

  test('unanimous and split votes leave the same run generator (2 to 4 players)', () => {
    for (const n of [2, 3, 4]) {
      const players = ['A', 'B', 'C', 'D'].slice(0, n);
      for (const seed of [1, 2, 3]) {
        const same = splitVoteWith(
          seed,
          players,
          players.map(() => 'easy'),
        );
        const diff = splitVoteWith(seed, players, split.slice(0, n));
        expect(same.rng).toEqual(diff.rng);
        const replayed = replayRun(
          runArgs(players, seed),
          same.actionLog,
          baseDeps,
        );
        expect(replayed.ok).toBe(true);
        if (replayed.ok) expect(replayed.state).toEqual(same);
      }
    }
  });

  test('a solo run draws nothing for its votes', () => {
    const s = toPveChoice(9, ['A']);
    const r = ok(s, 0, { type: 'vote', choice: 'easy' });
    const e = r.effects.find((x) => x.type === 'vote_resolved');
    expect(e).toMatchObject({ choice: 'easy', tickets: ['easy'] });
    expect(e).not.toHaveProperty('picked');
  });
});
