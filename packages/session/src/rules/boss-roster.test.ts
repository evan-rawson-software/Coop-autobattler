import { describe, expect, test } from 'vitest';
import type { ArchetypeDef, ThreatsConfig } from '@game/core';
import { begin, newRig, playUntil } from '../testing/ghost-test-support.js';
import { gameConfigs, makeGameDeps } from '../testing/test-support.js';
import { ghostContext, previousBossOf, selectGhost } from './ghosts.js';
import { replayRun } from './machine.js';
import type { RoundRecord, RunState } from './types.js';
import { validateRunState } from './validate.js';

const base = gameConfigs.threats.archetypes.find(
  (a) => a.id === 'arch_boss',
) as ArchetypeDef;

function boss(id: string, fromRound: number, minPartySize: number) {
  return { ...base, id, bossOnly: true, fromRound, minPartySize };
}

/** The shipped threats with the boss roster replaced by `bosses`. */
function threatsWith(bosses: ArchetypeDef[]): ThreatsConfig {
  return {
    ...gameConfigs.threats,
    archetypes: [
      ...gameConfigs.threats.archetypes.filter((a) => !a.bossOnly),
      ...bosses,
    ],
  };
}

const roster = threatsWith([
  boss('arch_boss', 1, 1),
  boss('arch_b', 3, 1),
  boss('arch_c', 5, 2),
]);

const atShop = (round: number) => (s: RunState) =>
  s.step === 'shop' && s.leg === 'pve' && s.round === round;
const atPvpSummary = (round: number) => (s: RunState) =>
  s.step === 'pvp_summary' && s.round === round;

async function shopState(): Promise<RunState> {
  const g = await begin(newRig(), makeGameDeps({ ghosts: { ownerId: 'x' } }), {
    runId: 'r',
    seed: 5,
  });
  return playUntil(g, atShop(1));
}

function bossOf(
  s: RunState,
  round: number,
  threats: ThreatsConfig,
  players = 1,
  history: readonly RoundRecord[] = [],
): string | undefined {
  const ctx = ghostContext(makeGameDeps({ ghosts: { ownerId: 'x' } }));
  if (ctx === null) throw new Error('no ghosts');
  const st: RunState = {
    ...s,
    round,
    history,
    players: Array.from({ length: players }, () => s.players[0] as never),
    rng: [round * 7919 + history.length, 11, 13, 17 + s.seed],
    pvpOpponent: null,
  };
  return selectGhost(st, [], ctx, threats).choice.boss;
}

function record(round: number, bossId: string): RoundRecord {
  return {
    round,
    pve: null,
    pvp: {
      won: true,
      opponent: { kind: 'boss', label: 'the boss', boss: bossId },
    },
  };
}

describe('the boss is chosen in the shop (#397)', () => {
  test('with the shipped content round 2 offers only arch_boss, and the battle uses it', async () => {
    const deps = makeGameDeps({ ghosts: { ownerId: 'x' } });
    const g = await begin(newRig(), deps, { runId: 'r', seed: 5 });
    const shop2 = await playUntil(g, atShop(2));
    const end = await playUntil(g, atPvpSummary(2));
    expect(shop2.pvpOpponent).toMatchObject({
      kind: 'boss',
      boss: 'arch_boss',
    });
    expect(end.history.at(-1)?.pvp?.opponent.boss).toBe('arch_boss');
    expect(end.thisRound.pvp?.opponent).toEqual({
      kind: 'boss',
      label: 'arch_boss',
      boss: 'arch_boss',
    });
    expect(validateRunState(JSON.parse(JSON.stringify(end)), deps).ok).toBe(
      true,
    );
  });

  test('the eligible set grows by round', async () => {
    const s = await shopState();
    const seen = (round: number): string[] => {
      const out = new Set<string>();
      for (let i = 0; i < 80; i++) {
        const st = { ...s, seed: i };
        out.add(bossOf(st, round, roster, 2) as string);
      }
      return [...out].sort();
    };
    expect(seen(1)).toEqual(['arch_boss']);
    expect(seen(2)).toEqual(['arch_boss']);
    expect(seen(3)).toEqual(['arch_b', 'arch_boss']);
    expect(seen(5)).toEqual(['arch_b', 'arch_boss', 'arch_c']);
  });

  test('a solo run never gets a boss that needs two players', async () => {
    const s = await shopState();
    for (let i = 0; i < 80; i++) {
      expect(bossOf({ ...s, seed: i }, 9, roster, 1)).not.toBe('arch_c');
    }
  });

  test('the boss of the previous boss battle is not drawn again, a single boss repeats', async () => {
    const s = await shopState();
    for (let i = 0; i < 60; i++) {
      const st = { ...s, seed: i };
      const hist = [record(1, 'arch_boss'), { round: 2, pve: null, pvp: null }];
      // Two eligible (arch_boss, arch_b): never the previous one, even with a
      // round without a boss battle in between.
      expect(bossOf(st, 3, roster, 1, hist)).toBe('arch_b');
      expect(bossOf(st, 3, roster, 1, [record(1, 'arch_b')])).toBe('arch_boss');
      // One eligible: it repeats.
      expect(bossOf(st, 2, roster, 1, hist)).toBe('arch_boss');
    }
  });

  test('previousBossOf reads the most recent boss battle', async () => {
    const s = await shopState();
    const h = [
      record(1, 'arch_b'),
      {
        round: 2,
        pve: null,
        pvp: { won: true, opponent: { kind: 'ghost' as const, label: 'g' } },
      },
    ];
    expect(previousBossOf({ ...s, history: h })).toBe('arch_b');
    expect(previousBossOf({ ...s, history: [] })).toBeUndefined();
  });

  test('replayRun reproduces the logged boss choice', async () => {
    const deps = makeGameDeps({ ghosts: { ownerId: 'x' } });
    const g = await begin(newRig(), deps, { runId: 'r', seed: 5 });
    const end = await playUntil(g, atPvpSummary(2));
    const r = replayRun(g.args, end.actionLog, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(end);
  });

  test('a saved opponent without a boss still loads, battles and replays as before', async () => {
    // Deps without the threats: the shop fixes no boss, as in an older save.
    const full = makeGameDeps({ ghosts: { ownerId: 'x' } });
    const deps = {
      ...full,
      ghosts: { ...(full.ghosts as object), threats: undefined } as never,
    };
    const g = await begin(newRig(), deps, { runId: 'r', seed: 5 });
    const shop = await playUntil(g, atShop(1));
    expect(shop.pvpOpponent).toEqual({
      round: 1,
      kind: 'boss',
      label: 'the boss',
      ghost: null,
    });
    expect(validateRunState(JSON.parse(JSON.stringify(shop)), full).ok).toBe(
      true,
    );
    const end = await playUntil(g, atPvpSummary(1));
    expect(end.thisRound.pvp?.opponent.kind).toBe('boss');
    const r = replayRun(g.args, end.actionLog, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(end);
  });

  test('validation checks the field', async () => {
    const full = makeGameDeps({ ghosts: { ownerId: 'x' } });
    const s = await shopState();
    const errs = (v: unknown): string[] => {
      const r = validateRunState(JSON.parse(JSON.stringify(v)), full);
      return r.ok ? [] : [...r.errors];
    };
    const opp = s.pvpOpponent as NonNullable<RunState['pvpOpponent']>;
    expect(errs(s)).toEqual([]);
    expect(errs({ ...s, pvpOpponent: { ...opp, boss: 7 } }).join()).toMatch(
      /boss/,
    );
    expect(
      errs({ ...s, pvpOpponent: { ...opp, boss: 'arch_rusher' } }).join(),
    ).toMatch(/boss-only/);
    expect(
      errs({
        ...s,
        pvpOpponent: {
          ...opp,
          kind: 'ghost',
          label: 'x',
          ghost: null,
        },
      }).length,
    ).toBeGreaterThan(0);
  });
});
