/**
 * The bot and the Familiar Roost (issue #475): the layout planner wires a
 * stashed Roost to a Power collector like any consumer, and the rush bot (the
 * Beastbinder) buys, places and uses it.
 */
import { describe, expect, test, vi } from 'vitest';
import { Rng, type TeamState } from '@game/core';
import { playBotRun } from './bot.js';
import { planLayout } from './bot-layout.js';
import { createRun } from '../rules/machine.js';
import {
  content,
  makeGameDeps,
  placeCoreAll,
  runArgs,
} from '../testing/test-support.js';

vi.setConfig({ testTimeout: 300_000 });

function withStash(defs: readonly string[]): TeamState {
  const deps = makeGameDeps();
  const r = createRun(runArgs(['Ann'], 7), deps);
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

describe('the bot and a Familiar Roost', () => {
  test('a Roost and a Power collector: the Roost is placed and wired', () => {
    const team = withStash(['bld_familiar_roost', 'bld_extractor']);
    const roostId = team.stash[0]?.id as number;
    const out = planLayout(
      team,
      0,
      content,
      team.map.plotWidth,
      {
        connect: true,
        walls: false,
        placeLeftovers: true,
        priority: ['bld_familiar_roost'],
      },
      Rng.fromSeed(3),
    );
    expect(
      out.some((i) => i.type === 'place_building' && i.id === roostId),
    ).toBe(true);
    expect(
      out.some(
        (i) =>
          i.type === 'add_conduit' &&
          'building' in i.to &&
          i.to.building === roostId,
      ),
    ).toBe(true);
  });

  test('a whole rush run (a Beastbinder) holds a Roost on the board', () => {
    const r = playBotRun(
      makeGameDeps({ ghosts: { ownerId: 'bot-test' } }),
      {
        runId: 'bot',
        runVersion: '1.0',
        seed: 2,
        players: ['Ann', 'Bo'],
        host: 0,
      },
      { strategy: 'rush', seed: 2, rerollCost: 1, maxRounds: 6 },
    );
    expect(r.rejected).toEqual([]);
    expect(
      r.state.team.buildings.filter((b) => b.def === 'bld_familiar_roost')
        .length,
    ).toBeGreaterThan(0);
  });
});
