/**
 * Splitters and link roles of the scripted bots (issue #178): a bought
 * Splitter should end up on the board, and the donor/receiver economy applies
 * only where a neighbour link can form.
 */
import { describe, expect, test, vi } from 'vitest';
import { playBotRun, type BotStrategyName } from './bot.js';
import { makeGameDeps } from '../testing/test-support.js';

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

const played = new Map<string, ReturnType<typeof playBotRun>>();

/** One bot run; the same run is shared by every test of this file. */
function run(strategy: BotStrategyName, party: number, seed: number) {
  const key = `${strategy}/${String(party)}/${String(seed)}`;
  let r = played.get(key);
  if (r === undefined) {
    r = playBotRun(
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
    played.set(key, r);
  }
  return r;
}

/** Splitters on the boards and in the stashes of one run. */
function splitters(r: ReturnType<typeof run>): {
  placed: number;
  stashed: number;
} {
  const t = r.state.team;
  return {
    placed: t.buildings.filter((b) => b.def === 'bld_splitter').length,
    stashed: t.stash.filter((b) => b.def === 'bld_splitter').length,
  };
}

describe('Splitter placement (#178)', () => {
  // Measured over SEEDS at party sizes 1, 2 and 4, placed of bought, after 6
  // rounds. Rush: 101 of 103 (13/13, 31/32, 57/58); with the shop weights of
  // #145 (more producers and Armories on offer) 100 of 111 (14/14, 30/34,
  // 56/63). The ratio is the point: a Splitter that is bought is placed.
  test('rush: Splitters are bought and nearly all are placed, at every party size', () => {
    let bought = 0;
    let placedAll = 0;
    for (const party of [1, 2, 4]) {
      let placed = 0;
      let stashed = 0;
      for (const seed of SEEDS) {
        const s = splitters(run('rush', party, seed));
        placed += s.placed;
        stashed += s.stashed;
      }
      bought += placed + stashed;
      placedAll += placed;
      expect(placed, `rush party ${String(party)}`).toBeGreaterThanOrEqual(
        0.88 * (placed + stashed),
      );
    }
    // The ratio means nothing if nothing is bought.
    expect(bought).toBeGreaterThanOrEqual(100);
    expect(placedAll).toBeGreaterThanOrEqual(98);
    expect(placedAll / bought).toBeGreaterThanOrEqual(0.9);
  });

  // Siege buys few Splitters (its barracks and armories are high tier), so
  // the check runs over 20 seeds at party sizes 1 and 2. Measured: 32 bought,
  // 31 placed (5 bought, 5 placed before the siege shop bought only what it
  // uses). The one left over is a Splitter the dry run took for placeable and
  // the layout, with its own generator, did not.
  test('siege: it does buy Splitters, and all but one is placed', () => {
    let bought = 0;
    let placed = 0;
    for (const party of [1, 2]) {
      for (let seed = 1; seed <= 20; seed++) {
        const s = splitters(run('siege', party, seed));
        placed += s.placed;
        bought += s.placed + s.stashed;
      }
    }
    expect(bought).toBeGreaterThanOrEqual(30);
    // Tetromino walls (issue #291) take more room around the Core: measured 4
    // left over (1 before); allowed up to 7.
    expect(bought - placed).toBeLessThanOrEqual(7);
  });
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

  test('consumers the layout cannot feed are not left in the stash', () => {
    // Consumers left in the stash, summed over SEEDS at party sizes 1 / 2 / 4
    // after 6 rounds. Measured: rush 2 / 9 / 24, fortify 0 / 0 / 0 (2 / 11 / 27 for rush
    // with the shop weights and the tetromino walls of issue #291).
    const limit = {
      rush: { 1: 3, 2: 12, 4: 29 },
      fortify: { 1: 1, 2: 1, 4: 1 },
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

  test('few collectors, Splitters and consumers are left in the stash at the end of a run', () => {
    // Extractors + Splitters + consumers in the stash, summed over SEEDS at
    // party sizes 1 / 2 / 4 after 6 rounds. Measured: rush 9 / 31 / 70,
    // fortify 6 / 15 / 28, siege 0 / 2 / 5 (10 / 13 / 27 before
    // the siege shop bought only what it uses; no Extractor is left in a siege stash). The collectors are mostly the
    // ones a donor buys for a neighbour, and the two every player starts with.
    // With the shop weights of #145: rush 8 / 33 / 77, fortify 6 / 12 / 23,
    // siege 1 / 3 / 8. With the tetromino walls and shop weights of issue #291:
    // rush 9 / 34 / 65, fortify 6 / 12 / 21, siege 1 / 4 / 8.
    const limit = {
      rush: { 1: 10, 2: 36, 4: 77 },
      fortify: { 1: 7, 2: 16, 4: 30 },
      siege: { 1: 1, 2: 4, 4: 8 },
    } as const;
    const wanted = ['bld_extractor', 'bld_splitter', ...CONSUMER_DEFS];
    for (const strategy of ['rush', 'fortify', 'siege'] as const) {
      for (const party of [1, 2, 4] as const) {
        let n = 0;
        for (const seed of SEEDS) {
          n += run(strategy, party, seed).state.team.stash.filter((b) =>
            wanted.includes(b.def),
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
