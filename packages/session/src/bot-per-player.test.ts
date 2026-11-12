/**
 * The bots under the per-player design (issue #140): each bot builds only in
 * its own plot with its own buildings, feeds only what its collectors can
 * feed, shares one collector through a Splitter, and draws border links.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  isBorderEnd,
  validateGhostSnapshot,
  validateTeamState,
  type BuildingId,
  type TeamState,
} from '@game/core';
import { BOT_STRATEGIES, playBotRun, type BotRunResult } from './bot.js';
import {
  bestOwnedSupply,
  consumerNeed,
  coveragePercent,
} from './bot-layout.js';
import { ghostContext } from './ghosts.js';
import { Rng } from '@game/core';
import { planLayout } from './bot-layout.js';
import {
  content,
  makeGameDeps,
  mapgenConfig,
  newRun,
  placeCoreAll,
} from './test-support.js';
import type { CreateRunArgs } from './types.js';

// Whole bot runs: far over the default 5 s on a loaded machine.
vi.setConfig({ testTimeout: 120_000 });

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];
const deps = makeGameDeps({ ghosts: { ownerId: 'bot-test' } });

function play(
  strategy: (typeof BOT_STRATEGIES)[number],
  party: number,
  seed: number,
): BotRunResult {
  const args: CreateRunArgs = {
    runId: 'bot',
    runVersion: '1.0',
    seed,
    players: NAMES.slice(0, party),
    host: 0,
  };
  return playBotRun(deps, args, {
    strategy,
    seed,
    rerollCost: 1,
    maxRounds: 4,
  });
}

/** Number of joined links: a sending and a receiving half at one spot. */
function joined(team: TeamState): number {
  const sending = new Set<string>();
  let n = 0;
  for (const c of team.conduits) {
    if (isBorderEnd(c.to))
      sending.add(`${String(c.to.border)}:${String(c.to.y)}`);
  }
  for (const c of team.conduits) {
    if (
      isBorderEnd(c.from) &&
      sending.has(`${String(c.from.border)}:${String(c.from.y)}`)
    )
      n++;
  }
  return n;
}

describe('bots build per player', () => {
  for (const strategy of BOT_STRATEGIES) {
    for (const party of [1, 2, 3, 4]) {
      test(`${strategy}, party of ${String(party)}: no rejected action, own plot, own buildings, valid snapshots`, () => {
        const r = play(strategy, party, 3);
        expect(r.rejected).toEqual([]);
        const team = r.state.team;
        const pw = team.map.plotWidth;
        // Every building lies in its owner's plot; every Core in its owner's.
        for (const b of team.buildings) {
          expect(b.x).toBeGreaterThanOrEqual(b.owner * pw);
          expect(b.x).toBeLessThan((b.owner + 1) * pw);
        }
        team.cores.forEach((core, p) => {
          expect(core).not.toBeNull();
          expect(Math.floor((core?.x ?? -1) / pw)).toBe(p);
        });
        expect(validateTeamState(team, content, mapgenConfig)).toMatchObject({
          ok: true,
        });
        const vctx = ghostContext(deps);
        expect(vctx).not.toBeNull();
        for (const snap of r.snapshots) {
          const v = validateGhostSnapshot(snap, vctx as never);
          expect(v.ok, v.ok ? '' : v.errors.join('; ')).toBe(true);
        }
      }, 120_000);
    }
  }

  test('rush forms working border links at party sizes 2 to 4', () => {
    for (const party of [2, 3, 4]) {
      let links = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const r = play('rush', party, seed);
        expect(r.rejected).toEqual([]);
        links += joined(r.state.team);
      }
      expect(links, `party ${String(party)}`).toBeGreaterThan(0);
    }
  }, 300_000);

  test('a party of one never draws a border half', () => {
    const r = play('rush', 1, 3);
    expect(r.linkHalves).toBe(0);
  });

  test('the strategies without links draw none', () => {
    for (const strategy of ['fortify', 'weak'] as const) {
      const r = play(strategy, 2, 3);
      expect(
        r.state.team.conduits.some(
          (c) => isBorderEnd(c.from) || isBorderEnd(c.to),
        ),
      ).toBe(false);
    }
  });

  test('a connecting bot places no consumer its collectors cannot feed', () => {
    for (const strategy of ['rush', 'fortify', 'siege'] as const) {
      for (const seed of [4, 5, 6]) {
        const r = play(strategy, 2, seed);
        for (const b of r.state.team.buildings) {
          const def = content.buildings.get(b.def);
          if (
            def === undefined ||
            def.kind === 'route' ||
            def.inputs.length === 0
          ) {
            continue;
          }
          const supply = bestOwnedSupply(r.state.team, b.owner, content);
          const cover = coveragePercent(
            supply,
            consumerNeed(content, b.def, b.tier),
          );
          expect(
            cover,
            `${strategy} ${b.def} tier ${String(b.tier)}`,
          ).toBeGreaterThanOrEqual(20);
        }
      }
    }
  }, 300_000);

  // Known gap, see #178: since the rebalance (#145) every tier-1 consumer
  // needs exactly what one tier-1 collector gives, so the bot fills its
  // collector nodes first and rarely places a Splitter. This pins the measured
  // rate, it is not a goal: over 20 fixed seeds at most MAX_SPLITTER_SEEDS
  // solo rush runs hold a Splitter with two outputs. Lower it when #178 is
  // fixed.
  const MAX_SPLITTER_SEEDS = 5; // measured: 3
  test('few solo rush runs share a collector through a two-output Splitter (#178)', () => {
    let seeds = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const team = play('rush', 1, seed).state.team;
      const shares = team.buildings.some(
        (sp) =>
          sp.def === 'bld_splitter' &&
          team.conduits.filter(
            (c) => !isBorderEnd(c.from) && c.from.building === sp.id,
          ).length >= 2,
      );
      if (shares) seeds++;
    }
    expect(seeds).toBeLessThanOrEqual(MAX_SPLITTER_SEEDS);
  }, 600_000);

  const style = {
    connect: true,
    walls: true,
    placeLeftovers: true,
    priority: ['bld_barracks', 'bld_armory'],
  };

  /** The party-of-one build state with a clean stash of the given items. */
  function withStash(defs: readonly string[]) {
    const run = placeCoreAll(newRun(makeGameDeps(), ['Ann']), makeGameDeps());
    const base = run.team;
    const stash = defs.map((def, i) => ({
      id: base.nextId + i,
      def,
      tier: 1,
      owner: 0,
    }));
    return {
      ...base,
      buildings: [],
      conduits: [],
      stash,
      nextId: base.nextId + defs.length,
    };
  }

  test('layout leaves a consumer in the stash when one collector cannot feed it enough', () => {
    const team = withStash(['bld_extractor', 'bld_armory']);
    const armory = team.stash[1]?.id;
    // No shipped consumer needs more than four times a tier 1 collector any
    // more (one collector feeds one producer of its tier, #145), so the test
    // makes an Armory that costs ten times as much per step: its need is 500
    // against a supply of 50 (10 percent, under the 20 percent minimum).
    const base = content.buildings.get('bld_armory');
    if (base?.kind !== 'economy') throw new Error('no armory');
    const armoryDef = {
      ...base,
      tiers: base.tiers.map((t) => ({
        ...t,
        costPerStep: 10 * t.costPerStep,
      })),
    } as unknown as typeof base;
    const hungry = {
      ...content,
      buildings: {
        get: (id: BuildingId) =>
          id === 'bld_armory' ? armoryDef : content.buildings.get(id),
        list: () => content.buildings.list(),
      },
    };
    const plan = planLayout(
      team,
      0,
      hungry,
      team.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    expect(
      plan.some((i) => i.type === 'place_building' && i.id === armory),
    ).toBe(false);
  });

  test('layout feeds a barracks from one collector', () => {
    const team = withStash(['bld_extractor', 'bld_barracks']);
    const barracks = team.stash[1]?.id;
    const plan = planLayout(
      team,
      0,
      content,
      team.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    expect(
      plan.some((i) => i.type === 'place_building' && i.id === barracks),
    ).toBe(true);
    expect(plan.some((i) => i.type === 'add_conduit')).toBe(true);
  });

  test('layout puts one collector and a Splitter in front of two barracks', () => {
    const team = withStash([
      'bld_extractor',
      'bld_splitter',
      'bld_barracks',
      'bld_barracks',
    ]);
    const plan = planLayout(
      team,
      0,
      content,
      team.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    expect(plan.filter((i) => i.type === 'place_building')).toHaveLength(4);
    expect(plan.filter((i) => i.type === 'add_conduit')).toHaveLength(3);
  });
});
