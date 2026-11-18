/**
 * The bot and the Transmuter (issue #476): the layout planner sets a stashed
 * Transmuter to the resource of a consumer the plot has no open node for,
 * feeds it from a collector of another resource and places the consumer
 * after it; the siege bot (the Alchemist) buys one for that.
 */
import { describe, expect, test, vi } from 'vitest';
import { Rng, loadEconomyOrThrow, type TeamState } from '@game/core';
import economyJson from '../../../../content/economy.json';
import { playBotRun } from './bot.js';
import { chainPlaceable, planLayout } from './bot-layout.js';
import { fixedBattle } from '../rules/defaults.js';
import { createRun } from '../rules/machine.js';
import type { BoardIntent } from '../rules/types.js';
import {
  content,
  gameConfigs,
  makeGameDeps,
  placeCoreAll,
  runArgs,
} from '../testing/test-support.js';

vi.setConfig({ testTimeout: 300_000 });

/** The shipped economy with the signature buildings heavily weighted. */
const shipped = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
  specialists: content.specialists,
});
const busy = {
  ...shipped,
  offerWeights: shipped.offerWeights.map((w) =>
    w.specialist === undefined ? w : { ...w, weight: 60 },
  ),
};

const style = {
  connect: true,
  walls: true,
  placeLeftovers: true,
  priority: ['bld_barracks'],
};

/**
 * A party-of-one build state with exactly `defs` in the stash and no node of
 * the resources in `without` anywhere on the map.
 */
function withStash(
  defs: readonly string[],
  without: readonly string[] = [],
): TeamState {
  const deps = makeGameDeps();
  const r = createRun(runArgs(['Ann'], 7), deps);
  if (!r.ok) throw new Error(r.detail);
  const base = placeCoreAll(r.state, deps).team;
  return {
    ...base,
    map: {
      ...base.map,
      nodes: base.map.nodes.filter((n) => !without.includes(n.resource)),
    },
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

function plan(team: TeamState): BoardIntent[] {
  return planLayout(
    team,
    0,
    content,
    team.map.plotWidth,
    style,
    Rng.fromSeed(3),
  );
}

const placements = (intents: readonly BoardIntent[]) =>
  intents.flatMap((i) => (i.type === 'place_building' ? [i] : []));

describe('the layout planner and a Transmuter', () => {
  test('no Ore node: the Transmuter, set to Ore, takes Power or Flux and feeds the Barracks', () => {
    const team = withStash(
      ['bld_transmuter', 'bld_barracks', 'bld_extractor'],
      ['res_a'],
    );
    const [tId, bId, eId] = team.stash.map((b) => b.id) as [
      number,
      number,
      number,
    ];
    const out = plan(team);
    const t = placements(out).find((i) => i.id === tId);
    expect(t?.resource).toBe('res_a');
    expect(placements(out).some((i) => i.id === bId)).toBe(true);
    expect(placements(out).some((i) => i.id === eId)).toBe(true);
    const wires = out.flatMap((i) =>
      i.type === 'add_conduit' && 'building' in i.from && 'building' in i.to
        ? [[i.from.building, i.to.building]]
        : [],
    );
    expect(wires).toEqual([
      [eId, tId],
      [tId, bId],
    ]);
  });

  test('with an open Ore node it stays in the stash and the Extractor serves the Barracks', () => {
    const team = withStash(['bld_transmuter', 'bld_barracks', 'bld_extractor']);
    const out = placements(plan(team));
    expect(out.some((i) => i.id === team.stash[0]?.id)).toBe(false);
  });

  test('with no collector to feed it, nothing is placed', () => {
    const team = withStash(['bld_transmuter', 'bld_barracks'], ['res_a']);
    expect(placements(plan(team))).toEqual([]);
  });

  test('a Transmuter alone, with nothing to feed, is not placed', () => {
    const team = withStash(['bld_transmuter', 'bld_extractor'], ['res_a']);
    expect(placements(plan(team)).some((i) => i.id === team.stash[0]?.id)).toBe(
      false,
    );
  });
});

describe('buying a Transmuter', () => {
  const probe = (team: TeamState): boolean =>
    chainPlaceable(team, 0, content, team.map.plotWidth, style, [
      { def: 'bld_transmuter', tier: 1 },
      { def: 'bld_barracks', tier: 1 },
      { def: 'bld_extractor', tier: 1 },
    ]);

  test('worth it only where the plot has no open node of the resource the consumer takes', () => {
    expect(probe(withStash([], ['res_a']))).toBe(true);
    expect(probe(withStash([]))).toBe(false);
  });
});

describe('a whole siege run (an Alchemist)', () => {
  test('on plots with one node of each common resource the bot buys, sets and wires a Transmuter', () => {
    let onBoard = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = playBotRun(
        makeGameDeps(
          { battle: fixedBattle(true) },
          {
            ...gameConfigs,
            economy: busy,
            mapgen: {
              ...gameConfigs.mapgen,
              nodesPerPlot: { common: 1, rare: 1 },
            },
          },
        ),
        { runId: 'tm', runVersion: '0.1', seed, players: ['Ann'], host: 0 },
        { strategy: 'siege', seed, rerollCost: busy.rerollCost, maxRounds: 12 },
      );
      expect(r.rejected).toEqual([]);
      for (const b of r.state.team.buildings.filter(
        (x) => x.def === 'bld_transmuter',
      )) {
        onBoard++;
        expect(b.resource).toBeDefined();
        // Wired in and out.
        const wired = r.state.team.conduits.filter(
          (c) =>
            ('building' in c.from && c.from.building === b.id) ||
            ('building' in c.to && c.to.building === b.id),
        );
        expect(wired.length).toBe(2);
      }
    }
    expect(onBoard).toBeGreaterThan(0);
  });
});
