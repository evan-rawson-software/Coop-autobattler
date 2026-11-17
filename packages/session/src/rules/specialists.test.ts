/**
 * Specialists in snapshots and ghosts (RS-13, MM-1e): a snapshot carries each
 * player's specialist, ghost validation accepts every real snapshot (with or
 * without the optional field) and refuses a wrong one, and the bot picks from
 * a fixed table without drawing anything.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  canonicalJson,
  ghostMaxSerializedSize,
  validateGhostSnapshot,
  type GhostSnapshot,
} from '@game/core';
import { fixedBattle } from './defaults.js';
import { BOT_STRATEGIES, playBotRun } from '../bot/bot.js';
import { botRun } from '../testing/ghost-test-support.js';
import { ghostContext } from './ghosts.js';
import {
  content,
  makeGameDeps,
  testSpecialist,
} from '../testing/test-support.js';
import type { CreateRunArgs, RunState } from './types.js';

vi.setConfig({ testTimeout: 120_000 });

const ROSTER = content.specialists.ids();
const NAMES = ['A', 'B', 'C', 'D'];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function argsFor(runId: string, seed: number, party: number): CreateRunArgs {
  return {
    runId,
    runVersion: '0.1',
    seed,
    players: NAMES.slice(0, party),
    host: 0,
  };
}

const deps = makeGameDeps({
  ghosts: { ownerId: 'dev' },
  battle: fixedBattle(true),
  rules: { startingLives: 99, pvpLossLifeCost: 1 },
});
const ctx = (() => {
  const c = ghostContext(deps);
  if (c === null) throw new Error('ghosts are on');
  return c;
})();

const snapshotsOf = (party: number, round: number): GhostSnapshot[] =>
  botRun(
    deps,
    argsFor(`s${String(party)}`, 7, party),
    1,
    (s: RunState) => s.round >= round && s.step === 'pvp_summary',
  ).snapshots;

describe("snapshots carry each player's specialist (MM-1e)", () => {
  for (const party of [1, 2, 4]) {
    test(`party of ${String(party)}: every real snapshot has the picks and is accepted`, () => {
      const snaps = snapshotsOf(party, 3);
      expect(snaps.length).toBeGreaterThan(0);
      for (const s of snaps) {
        expect(s.team.specialists).toEqual(
          Array.from({ length: party }, (_, p) => testSpecialist(p)),
        );
        const r = validateGhostSnapshot(clone(s), ctx);
        expect(r.ok, r.ok ? '' : r.errors.join('; ')).toBe(true);
      }
    });
  }

  test('a snapshot without the field (written before specialists) stays valid', () => {
    const [s] = snapshotsOf(2, 1) as [GhostSnapshot];
    const old = clone(s) as unknown as { team: Record<string, unknown> };
    delete old.team['specialists'];
    expect(canonicalJson(old)).not.toContain('specialists');
    const r = validateGhostSnapshot(old, ctx);
    expect(r.ok, r.ok ? '' : r.errors.join('; ')).toBe(true);
  });

  test('a snapshot with the same specialist for everyone (duplicates) is valid', () => {
    const [s] = snapshotsOf(3, 1) as [GhostSnapshot];
    const dup = clone(s) as unknown as { team: Record<string, unknown> };
    dup.team['specialists'] = [ROSTER[0], ROSTER[0], ROSTER[0]];
    expect(validateGhostSnapshot(dup, ctx).ok).toBe(true);
  });

  test('a wrong field is refused: unknown id, wrong length, wrong type, all-null', () => {
    const [s] = snapshotsOf(2, 1) as [GhostSnapshot];
    for (const bad of [
      ['spec_nope', ROSTER[0]],
      [ROSTER[0]],
      [ROSTER[0], ROSTER[0], ROSTER[0]],
      [1, 2],
      'spec_flowmancer',
      [null, null],
      [],
    ]) {
      const o = clone(s) as unknown as { team: Record<string, unknown> };
      o.team['specialists'] = bad;
      expect(validateGhostSnapshot(o, ctx).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test('the size bound has room for the longest specialist IDs of a full party', () => {
    const [s] = snapshotsOf(4, 1) as [GhostSnapshot];
    const longest = ROSTER.reduce((a, b) => (b.length > a.length ? b : a));
    const o = clone(s) as unknown as { team: Record<string, unknown> };
    o.team['specialists'] = [longest, longest, longest, longest];
    const bytes = canonicalJson(o).length;
    expect(bytes).toBeLessThan(ghostMaxSerializedSize(4, 1, ctx));
  });
});

describe('the bot picks a specialist from a fixed table', () => {
  const expected = {
    rush: 'spec_beastbinder',
    fortify: 'spec_wardsmith',
    siege: 'spec_alchemist',
    weak: 'spec_flowmancer',
  } as const;

  test('every strategy has a pick in the roster, one of each across the four', () => {
    expect(new Set(Object.values(expected)).size).toBe(4);
    for (const v of Object.values(expected)) expect(ROSTER).toContain(v);
    expect(Object.keys(expected).sort()).toEqual([...BOT_STRATEGIES].sort());
  });

  for (const strategy of BOT_STRATEGIES) {
    test(`${strategy}: every player of the party takes ${expected[strategy]}, whatever the bot seed`, () => {
      for (const seed of [1, 2]) {
        const r = playBotRun(makeGameDeps(), argsFor('b', 5, 2), {
          strategy,
          seed,
          rerollCost: 1,
          maxRounds: 1,
        });
        expect(r.rejected).toEqual([]);
        expect(r.state.team.specialists).toEqual([
          expected[strategy],
          expected[strategy],
        ]);
      }
    });
  }
});
