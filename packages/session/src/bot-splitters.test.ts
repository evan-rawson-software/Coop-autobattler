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
  // Measured over SEEDS at party sizes 1, 2 and 4, placed of bought. On main:
  // rush 104 of 115 (15/15, 32/33, 57/67), siege 3 of 3. Now: rush 101 of 111
  // (14/14, 30/30, 57/67), siege 3 of 3 (only the solo bot buys any). Every
  // placed Splitter on main fed both its consumers; the ratio is the placement.
  const MEASURED = {
    rush: { minBought: 100, minPlaced: 95 },
    siege: { minBought: 3, minPlaced: 3 },
  } as const;
  for (const strategy of ['rush', 'siege'] as const) {
    test(`${strategy}: Splitters are bought and most are placed, at every party size`, () => {
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
        expect(
          placed,
          `${strategy} party ${String(party)}`,
        ).toBeGreaterThanOrEqual(0.75 * (placed + stashed));
      }
      // The ratio means nothing if nothing is bought.
      expect(bought).toBeGreaterThanOrEqual(want.minBought);
      expect(placedAll).toBeGreaterThanOrEqual(want.minPlaced);
    });
  }
});

describe('shop buys only what can be placed (#178)', () => {
  function stashed(strategy: BotStrategyName, party: number, def: string) {
    let n = 0;
    for (const seed of SEEDS) {
      n += run(strategy, party, seed).state.team.stash.filter(
        (b) => b.def === def,
      ).length;
    }
    return n;
  }

  test('a bot that never connects buys no Extractors at all', () => {
    // The weak bot places no collector, so it must not buy any beyond the
    // starting stash (2 per player run). Measured over SEEDS: 16 / 32 / 64 at
    // party sizes 1 / 2 / 4 (33 / 69 / 121 on main).
    for (const party of [1, 2, 4]) {
      expect(stashed('weak', party, 'bld_extractor')).toBeLessThanOrEqual(
        2 * party * SEEDS.length,
      );
    }
  });

  test('rush and fortify leave few consumers they cannot feed in the stash', () => {
    // Consumers left in the stash, summed over SEEDS at party sizes 1 / 2 / 4.
    // Measured now: rush 8 / 10 / 35, fortify 10 / 18 / 39. On main: rush
    // 15 / 26 / 61, fortify 16 / 26 / 55.
    const limit = {
      rush: { 1: 8, 2: 10, 4: 35 },
      fortify: { 1: 10, 2: 18, 4: 39 },
    } as const;
    for (const strategy of ['rush', 'fortify'] as const) {
      for (const party of [1, 2, 4] as const) {
        let n = 0;
        for (const seed of SEEDS) {
          n += run(strategy, party, seed).state.team.stash.filter((b) =>
            CONSUMER_DEFS.includes(b.def),
          ).length;
        }
        expect(n, `${strategy} party ${String(party)}`).toBeLessThanOrEqual(
          limit[strategy][party],
        );
      }
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
