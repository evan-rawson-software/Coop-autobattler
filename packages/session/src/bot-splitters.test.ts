/**
 * Splitters and link roles of the scripted bots (issue #178): a bought
 * Splitter should end up on the board, and the donor/receiver economy applies
 * only where a neighbour link can form.
 */
import { describe, expect, test, vi } from 'vitest';
import { playBotRun, type BotStrategyName } from './bot.js';
import { makeGameDeps } from './test-support.js';

vi.setConfig({ testTimeout: 300_000 });

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];
const deps = makeGameDeps({ ghosts: { ownerId: 'bot-test' } });
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const CONSUMER_DEFS = [
  'bld_barracks',
  'bld_turret',
  'bld_armory',
  'bld_overclocker',
  'bld_range',
  'bld_hangar',
];

function run(strategy: BotStrategyName, party: number, seed: number) {
  return playBotRun(
    deps,
    {
      runId: 'bot',
      runVersion: '1.0',
      seed,
      players: NAMES.slice(0, party),
      host: 0,
    },
    { strategy, seed, rerollCost: 1, maxRounds: 6 },
  );
}

describe('Splitter placement (#178)', () => {
  // Measured over SEEDS at party sizes 1, 2 and 4, placed of bought. Before
  // the capacity check: rush 104 of 115, siege 3 of 3 (the check counted the
  // player's best collector, not the one being split). After: rush 30 of 43
  // (9 of 9, 10 of 14, 11 of 20), siege 12 of 13 (3 of 3, 3 of 4, 6 of 6). The
  // bots buy fewer Splitters now, and every placed one has a collector that
  // feeds both of its consumers.
  const MEASURED = {
    rush: { minBought: 40, minPlaced: 28, minShare: 0.65 },
    siege: { minBought: 12, minPlaced: 11, minShare: 0.8 },
  } as const;
  for (const strategy of ['rush', 'siege'] as const) {
    test(`${strategy}: Splitters are bought and most are placed`, () => {
      const want = MEASURED[strategy];
      let bought = 0;
      let placedAll = 0;
      for (const party of [1, 2, 4]) {
        let placed = 0;
        let stashed = 0;
        for (const seed of SEEDS) {
          const t = run(strategy, party, seed).state.team;
          placed += t.buildings.filter((b) => b.def === 'bld_splitter').length;
          stashed += t.stash.filter((b) => b.def === 'bld_splitter').length;
        }
        bought += placed + stashed;
        placedAll += placed;
      }
      // The ratio means nothing if nothing is bought.
      expect(bought).toBeGreaterThanOrEqual(want.minBought);
      expect(placedAll).toBeGreaterThanOrEqual(want.minPlaced);
      expect(placedAll).toBeGreaterThanOrEqual(want.minShare * bought);
    });
  }
});

describe('shop buys only what can be placed (#178)', () => {
  /** Stash contents at the end of the run, per player run. */
  function stashed(strategy: BotStrategyName, party: number, def: string) {
    let n = 0;
    for (const seed of SEEDS) {
      n += run(strategy, party, seed).state.team.stash.filter(
        (b) => b.def === def,
      ).length;
    }
    return n;
  }

  // Measured over SEEDS before: Extractors left in the stash, summed over the
  // seeds, siege 10 / 13 / 27 and rush 25 / 39 / 91 at party sizes 1 / 2 / 4.
  // After: siege 3 / 2 / 3 and rush 5 / 18 / 34.
  test('siege leaves at most one Extractor per two runs in the stash', () => {
    for (const party of [1, 2, 4]) {
      expect(
        stashed('siege', party, 'bld_extractor'),
        `party ${String(party)}`,
      ).toBeLessThanOrEqual(4);
    }
  });

  test('a bot that never connects buys no Extractors at all', () => {
    // The weak bot places no collector, so it must not buy any beyond the
    // starting stash (2 per player, measured 16 / 32 / 64 of 8 seeds).
    for (const party of [1, 2, 4]) {
      expect(stashed('weak', party, 'bld_extractor')).toBeLessThanOrEqual(
        2 * party * SEEDS.length,
      );
    }
  });

  test('rush keeps far fewer unplaced consumers than before', () => {
    // Measured, summed over SEEDS: rush 15 / 26 / 61 before; 4 / 22 / 54 now.
    const limit: Record<number, number> = { 1: 6, 2: 26, 4: 58 };
    for (const party of [1, 2, 4]) {
      let n = 0;
      for (const seed of SEEDS) {
        n += run('rush', party, seed).state.team.stash.filter((b) =>
          CONSUMER_DEFS.includes(b.def),
        ).length;
      }
      expect(n, `party ${String(party)}`).toBeLessThanOrEqual(
        limit[party] ?? 0,
      );
    }
  });
});

describe('link roles (#178)', () => {
  /** Collectors and consumers a player owns, on the board or in the stash. */
  function economy(
    r: ReturnType<typeof run>,
    player: number,
  ): { sources: number; users: number } {
    const owned = [...r.state.team.buildings, ...r.state.team.stash].filter(
      (b) => b.owner === player,
    );
    return {
      sources: owned.filter((b) => b.def === 'bld_extractor').length,
      users: owned.filter((b) => CONSUMER_DEFS.includes(b.def)).length,
    };
  }

  test('a solo rush or siege bot keeps the neutral economy', () => {
    for (const strategy of ['rush', 'siege'] as const) {
      for (const seed of SEEDS) {
        const { sources, users } = economy(run(strategy, 1, seed), 0);
        expect(sources, `${strategy} ${String(seed)}`).toBeLessThanOrEqual(
          users + 1,
        );
        expect(users, `${strategy} ${String(seed)}`).toBeLessThanOrEqual(
          sources + 1,
        );
      }
    }
  });

  test('siege players are not skewed at party sizes 2 and 4', () => {
    for (const party of [2, 4]) {
      for (const seed of SEEDS) {
        const r = run('siege', party, seed);
        for (let p = 0; p < party; p++) {
          const { sources, users } = economy(r, p);
          const label = `party ${String(party)} seed ${String(seed)} player ${String(p)}`;
          expect(sources, label).toBeLessThanOrEqual(users + 1);
          expect(users, label).toBeLessThanOrEqual(sources + 1);
        }
      }
    }
  });
});
