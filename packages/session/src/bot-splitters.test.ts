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
  // Measured before the fix: rush 9 placed of 171 bought (5 percent), siege 0
  // of 56. After: rush 104 of 115 (90 percent), siege 3 of 3.
  for (const strategy of ['rush', 'siege'] as const) {
    test(`${strategy}: most bought Splitters are placed, at every party size`, () => {
      let bought = 0;
      for (const party of [1, 2, 4]) {
        let placed = 0;
        let stashed = 0;
        for (const seed of SEEDS) {
          const t = run(strategy, party, seed).state.team;
          placed += t.buildings.filter((b) => b.def === 'bld_splitter').length;
          stashed += t.stash.filter((b) => b.def === 'bld_splitter').length;
        }
        bought += placed + stashed;
        expect(
          placed,
          `${strategy} party ${String(party)}`,
        ).toBeGreaterThanOrEqual(0.75 * (placed + stashed));
      }
      // The ratio means nothing if nothing is bought: rush buys plenty.
      if (strategy === 'rush') expect(bought).toBeGreaterThan(50);
    });
  }
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
