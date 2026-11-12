import { describe, expect, test, vi } from 'vitest';
import { hashJson } from '@game/core';
import {
  BOT_STRATEGIES,
  isBotStrategy,
  playBotRun,
  type BotRunResult,
  type BotStrategyName,
} from './bot.js';
import { replayRun } from './machine.js';
import { makeGameDeps } from './test-support.js';
import type { CreateRunArgs } from './types.js';

// Whole bot runs: far over the default 5 s on a loaded machine.
vi.setConfig({ testTimeout: 120_000 });

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

function args(party: number, seed: number): CreateRunArgs {
  return {
    runId: 'bot',
    runVersion: '0.1',
    seed,
    players: NAMES.slice(0, party),
    host: 0,
  };
}

function play(
  strategy: BotStrategyName,
  party: number,
  seed: number,
  botSeed = seed,
): BotRunResult {
  return playBotRun(makeGameDeps(), args(party, seed), {
    strategy,
    seed: botSeed,
    rerollCost: 1,
  });
}

/** How many of each building type are on the board. */
function counts(r: BotRunResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of r.state.team.buildings) out[b.def] = (out[b.def] ?? 0) + 1;
  return out;
}

describe('bot player', () => {
  for (const strategy of BOT_STRATEGIES) {
    for (const party of [1, 4]) {
      test(`${strategy}, party of ${String(party)}: plays to defeat with no rejected intent`, () => {
        const r = play(strategy, party, 5);
        expect(r.rejected).toEqual([]);
        expect(r.state.step).toBe('run_over');
        expect(r.state.outcome?.reason).toBe('defeated');
        expect(r.state.round).toBeGreaterThanOrEqual(2);
        // The log replays to the same state (the run is a pure function of
        // its intents).
        const again = replayRun(
          args(party, 5),
          r.state.actionLog,
          makeGameDeps(),
        );
        expect(again.ok).toBe(true);
        if (again.ok) expect(hashJson(again.state)).toBe(hashJson(r.state));
      }, 60_000);
    }
  }

  test('the same strategy and seed give the same run', () => {
    for (const strategy of BOT_STRATEGIES) {
      const a = play(strategy, 2, 11);
      const b = play(strategy, 2, 11);
      expect(hashJson(b.state)).toBe(hashJson(a.state));
    }
  });

  test('the bot seed changes the factory', () => {
    const hashes = new Set<string>();
    for (let seed = 1; seed <= 4; seed++) {
      hashes.add(hashJson(play('fortify', 1, 5, seed).state.team));
    }
    expect(hashes.size).toBeGreaterThan(1);
  });

  test('a round limit stops the run early', () => {
    const r = playBotRun(makeGameDeps(), args(1, 5), {
      strategy: 'fortify',
      seed: 1,
      maxRounds: 2,
    });
    expect(r.rejected).toEqual([]);
    expect(r.state.round).toBe(3);
    expect(r.state.step).not.toBe('run_over');
  });

  test('strategies produce different factories', () => {
    const rushRun = play('rush', 1, 5);
    const rush = counts(rushRun);
    const fortify = counts(play('fortify', 1, 5));
    const siege = counts(play('siege', 1, 5));
    const weak = play('weak', 1, 5);
    expect(rush['bld_wall'] ?? 0).toBe(0);
    expect(fortify['bld_wall'] ?? 0).toBeGreaterThan(0);
    expect(rush['bld_barracks'] ?? 0).toBeGreaterThan(
      fortify['bld_barracks'] ?? 0,
    );
    expect(siege['bld_wall'] ?? 0).toBeGreaterThan(0);
    // The weak bot never draws a conduit; the others do.
    expect(weak.state.team.conduits).toHaveLength(0);
    expect(rushRun.state.team.conduits.length).toBeGreaterThan(0);
    const signatures = new Set(
      [rush, fortify, siege, counts(weak)].map((c) => JSON.stringify(c)),
    );
    expect(signatures.size).toBe(4);
  });

  test('strategy names are recognised', () => {
    expect(isBotStrategy('rush')).toBe(true);
    expect(isBotStrategy('nope')).toBe(false);
  });
});
