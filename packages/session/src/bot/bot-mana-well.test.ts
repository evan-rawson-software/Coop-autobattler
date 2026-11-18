/**
 * The bot and the Mana Well (issue #473): the layout planner puts a stashed
 * Well on an open cell, set to the resource of a consumer, only when the plot
 * has no free node of that resource; it never puts one on a node as it does a
 * node collector.
 */
import { describe, expect, test } from 'vitest';
import { Rng, type TeamState } from '@game/core';
import { planLayout, wouldPlace } from './bot-layout.js';
import { createRun } from '../rules/machine.js';
import type { BoardIntent } from '../rules/types.js';
import {
  content,
  makeGameDeps,
  placeCoreAll,
  runArgs,
} from '../testing/test-support.js';

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

describe('the layout planner and a Mana Well', () => {
  test('a plot with no Ore node: the Well, set to Ore, feeds the Barracks', () => {
    const team = withStash(['bld_barracks', 'bld_mana_well'], ['res_a']);
    const wellId = team.stash[1]?.id as number;
    const barracksId = team.stash[0]?.id as number;
    const out = plan(team);
    const well = placements(out).find((i) => i.id === wellId);
    expect(well).toBeDefined();
    expect(well?.resource).toBe('res_a');
    expect(placements(out).some((i) => i.id === barracksId)).toBe(true);
    const wire = out.find(
      (i) =>
        i.type === 'add_conduit' &&
        'building' in i.from &&
        i.from.building === wellId,
    );
    expect(wire).toBeDefined();
    // Never on a node, which would waste it.
    const nodes = new Set(
      team.map.nodes.map((n) => `${String(n.x)},${String(n.y)}`),
    );
    expect(nodes.has(`${String(well?.x)},${String(well?.y)}`)).toBe(false);
  });

  test("the resource is the consumer's: a Power consumer gets a Power Well", () => {
    const team = withStash(['bld_hangar', 'bld_mana_well'], ['res_b']);
    const well = placements(plan(team)).find(
      (i) => i.id === (team.stash[1]?.id as number),
    );
    expect(well?.resource).toBe('res_b');
  });

  test('with free Ore nodes the Extractor is used and the Well stays in the stash', () => {
    const team = withStash(['bld_barracks', 'bld_mana_well', 'bld_extractor']);
    const out = placements(plan(team));
    const wellId = team.stash[1]?.id as number;
    const extractorId = team.stash[2]?.id as number;
    expect(out.some((i) => i.id === extractorId)).toBe(true);
    expect(out.some((i) => i.id === wellId)).toBe(false);
  });

  test('a Well alone, with nothing to feed, is not placed', () => {
    const team = withStash(['bld_mana_well'], ['res_a']);
    expect(placements(plan(team))).toEqual([]);
  });

  test('buying: a Well counts only where the plot lacks the node a liked consumer needs', () => {
    const noOre = withStash([], ['res_a']);
    const withOre = withStash([]);
    const probe = (team: TeamState): boolean =>
      wouldPlace(
        team,
        0,
        content,
        team.map.plotWidth,
        style,
        'collector',
        { def: 'bld_mana_well', tier: 1 },
        [{ def: 'bld_barracks', tier: 1 }],
      );
    expect(probe(noOre)).toBe(true);
    expect(probe(withOre)).toBe(false);
  });
});
