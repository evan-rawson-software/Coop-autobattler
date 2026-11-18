/**
 * The scripted bot and the four new buildings (issue #443): where its layout
 * puts a Lancer hall, a Mortar and a Grand barracks, that whole bot runs buy
 * and use them, and that no bot places a Tunnel.
 */
import { describe, expect, test, vi } from 'vitest';
import { Rng, type TeamState } from '@game/core';
import {
  BOT_STRATEGIES,
  playBotRun,
  type BotRunResult,
  type BotStrategyName,
} from './bot.js';
import { planLayout } from './bot-layout.js';
import { createRun } from '../rules/machine.js';
import type { BoardIntent, RunDeps } from '../rules/types.js';
import {
  content,
  makeGameDeps,
  placeCoreAll,
  runArgs,
} from '../testing/test-support.js';

// Whole bot runs, as in bot.test.ts.
vi.setConfig({ testTimeout: 300_000 });

const style = {
  connect: true,
  walls: true,
  placeLeftovers: true,
  priority: ['bld_barracks', 'bld_lancer_hall', 'bld_mortar'],
};

/** A party-of-one build state of `seed` holding exactly `defs` in the stash. */
function withStash(seed: number, defs: readonly string[]): TeamState {
  const deps = makeGameDeps();
  const r = createRun(runArgs(['Ann'], seed), deps);
  if (!r.ok) throw new Error(r.detail);
  const base = placeCoreAll(r.state, deps).team;
  return {
    ...base,
    buildings: [],
    conduits: [],
    stash: defs.map((def, i) => ({
      id: base.nextId + i,
      def,
      tier: 1,
      owner: 0,
    })),
    nextId: base.nextId + defs.length,
  };
}

function layoutOf(team: TeamState): BoardIntent[] {
  return planLayout(
    team,
    0,
    content,
    team.map.plotWidth,
    style,
    Rng.fromSeed(1),
  );
}

interface Spot {
  def: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the plan puts each stashed building. */
function spots(
  team: TeamState,
  plan: readonly BoardIntent[],
): Map<number, Spot> {
  const out = new Map<number, Spot>();
  for (const i of plan) {
    if (i.type !== 'place_building') continue;
    const b = team.stash.find((s) => s.id === i.id);
    const fp = content.buildings.get(b?.def ?? '')?.footprint;
    if (b === undefined || fp === undefined) continue;
    out.set(i.id, {
      def: b.def,
      x: i.x,
      y: i.y,
      w: fp.width,
      h: fp.height,
    });
  }
  return out;
}

function conduitsInto(plan: readonly BoardIntent[], id: number): number {
  return plan.filter(
    (i) =>
      i.type === 'add_conduit' && 'building' in i.to && i.to.building === id,
  ).length;
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('layout of the new buildings (#443)', () => {
  test('a Grand barracks, a Merger and two collectors are wired whole or not at all', () => {
    let whole = 0;
    for (const seed of SEEDS) {
      const team = withStash(seed, [
        'bld_extractor',
        'bld_extractor',
        'bld_merger',
        'bld_grand_barracks',
      ]);
      const plan = layoutOf(team);
      const placed = spots(team, plan);
      const [e1, e2, merger, barracks] = team.stash.map((b) => b.id) as [
        number,
        number,
        number,
        number,
      ];
      if (placed.size === 0) continue;
      expect([...placed.keys()].sort(), `seed ${String(seed)}`).toEqual(
        [e1, e2, merger, barracks].sort(),
      );
      // Two collectors into the Merger, the Merger into the Grand barracks.
      expect(conduitsInto(plan, merger)).toBe(2);
      expect(conduitsInto(plan, barracks)).toBe(1);
      whole++;
    }
    // Measured: 7 of the 8 seeds have the two free Ore nodes and the 3x3 hole.
    expect(whole).toBeGreaterThanOrEqual(6);
  });

  test('a Lancer hall goes beside or behind a Barracks, else along the edge', () => {
    let beside = 0;
    let placedHalls = 0;
    for (const seed of SEEDS) {
      const team = withStash(seed, [
        'bld_extractor',
        'bld_extractor',
        'bld_barracks',
        'bld_lancer_hall',
      ]);
      const plan = layoutOf(team);
      const at = spots(team, plan);
      const hall = [...at.values()].find((s) => s.def === 'bld_lancer_hall');
      const barracks = [...at.values()].find((s) => s.def === 'bld_barracks');
      if (hall === undefined || barracks === undefined) continue;
      placedHalls++;
      const overlapX =
        hall.x < barracks.x + barracks.w && barracks.x < hall.x + hall.w;
      const overlapY =
        hall.y < barracks.y + barracks.h && barracks.y < hall.y + hall.h;
      const next =
        (overlapY &&
          (hall.x + hall.w === barracks.x ||
            barracks.x + barracks.w === hall.x)) ||
        (overlapX && hall.y + hall.h === barracks.y);
      if (next) beside++;
    }
    // Measured: 7 of 8 seeds place both, and the hall is next to the Barracks
    // in all 7.
    expect(placedHalls).toBeGreaterThanOrEqual(6);
    expect(beside).toBe(placedHalls);
  });

  test('a Mortar is placed near the Core with walls in front of it', () => {
    let withWalls = 0;
    let placedMortars = 0;
    for (const seed of SEEDS) {
      const team = withStash(seed, [
        'bld_extractor',
        'bld_mortar',
        'bld_wall_o',
        'bld_wall_o',
      ]);
      const plan = layoutOf(team);
      const at = spots(team, plan);
      const mortar = [...at.values()].find((s) => s.def === 'bld_mortar');
      if (mortar === undefined) continue;
      placedMortars++;
      const core = team.cores[0];
      if (core === null || core === undefined) throw new Error('no core');
      // Near the Core: no farther than the collector it is wired to is.
      expect(
        Math.abs(mortar.x - core.x) + Math.abs(mortar.y - core.y),
        `seed ${String(seed)}`,
      ).toBeLessThanOrEqual(12);
      const walls = [...at.values()].filter((s) => s.def === 'bld_wall_o');
      // In front: above the Mortar (units walk toward higher y).
      if (walls.length > 0 && walls.every((w) => w.y >= mortar.y + mortar.h)) {
        withWalls++;
      }
    }
    expect(placedMortars).toBeGreaterThanOrEqual(6);
    expect(withWalls).toBe(placedMortars);
  });
});

/** Which buildings of `defs` stood on the board in any battle of the run. */
function played(
  strategy: BotStrategyName,
  party: number,
  seed: number,
  defs: readonly string[],
  maxRounds?: number,
): { result: BotRunResult; seen: Set<string>; wiring: Map<string, number> } {
  const base = makeGameDeps();
  const seen = new Set<string>();
  const wiring = new Map<string, number>();
  const inner = base.battle;
  const deps: RunDeps = {
    ...base,
    battle: {
      ...(inner.replay === undefined
        ? {}
        : { replay: inner.replay.bind(inner) }),
      resolve(input) {
        const t = input.state.team;
        for (const b of t.buildings) {
          if (!defs.includes(b.def)) continue;
          seen.add(b.def);
          const into = t.conduits.filter(
            (c) => 'building' in c.to && c.to.building === b.id,
          ).length;
          wiring.set(b.def, Math.max(wiring.get(b.def) ?? 0, into));
        }
        return inner.resolve(input);
      },
    },
  };
  const result = playBotRun(
    deps,
    {
      runId: 'new',
      runVersion: '0.1',
      seed,
      players: ['Ann', 'Bo', 'Cy', 'Di'].slice(0, party),
      host: 0,
    },
    {
      strategy,
      seed,
      rerollCost: 1,
      ...(maxRounds === undefined ? {} : { maxRounds }),
    },
  );
  return { result, seen, wiring };
}

// Seeds found to buy and place each building (the bot is deterministic): a
// search over seeds 1 to 160 of rush, fortify and siege at party sizes 1 and 2
// found a Lancer hall in about 5 percent of the runs, a Mortar in 2 percent (fortify,
// siege), a Grand barracks and its Merger in 3 percent of rush runs.
describe('whole bot runs use the new buildings (#443)', () => {
  test('rush buys a Grand barracks and a Merger and wires them', () => {
    const { result, seen, wiring } = played('rush', 2, 10, [
      'bld_grand_barracks',
      'bld_merger',
    ]);
    expect(result.rejected).toEqual([]);
    expect(seen.has('bld_grand_barracks')).toBe(true);
    expect(seen.has('bld_merger')).toBe(true);
    expect(wiring.get('bld_grand_barracks')).toBe(1);
    expect(wiring.get('bld_merger')).toBe(2);
  });

  // The Rune Ward (#474) changed the fortify shops: searched again over 1 to
  // 120 (party of 2): a Mortar is placed in seeds 24, 43, 47, 86, 93, 115
  // (none in 1 to 40 with a party of 1).
  // Event tuning (#417: Workshop 70%, Windfall and Caravan gold 8, the bots'
  // event order): seed 24 no longer places one; seed 43 does (searched in the
  // order of the list above).
  test('fortify places a Mortar', () => {
    const { result, seen } = played('fortify', 2, 43, ['bld_mortar']);
    expect(result.rejected).toEqual([]);
    expect(seen.has('bld_mortar')).toBe(true);
  });

  test('fortify places a Lancer hall', () => {
    const { result, seen } = played('fortify', 1, 9, ['bld_lancer_hall']);
    expect(result.rejected).toEqual([]);
    expect(seen.has('bld_lancer_hall')).toBe(true);
  });

  test('no bot ever places a Tunnel end', () => {
    for (const strategy of BOT_STRATEGIES) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { result, seen } = played(
          strategy,
          2,
          seed,
          ['bld_tunnel_in', 'bld_tunnel_out'],
          8,
        );
        expect(result.rejected).toEqual([]);
        expect(seen.size, `${strategy} seed ${String(seed)}`).toBe(0);
        expect(
          result.state.team.buildings.filter((b) =>
            b.def.startsWith('bld_tunnel'),
          ),
        ).toEqual([]);
      }
    }
  });
});
