/**
 * The bot and the Rune Ward (issue #474): the layout planner wires a stashed
 * Ward to a Power collector like a turret, prefers a cell that touches a wall
 * of the player, and puts a wall beside a Ward that has none.
 */
import { describe, expect, test } from 'vitest';
import { Rng, type TeamState } from '@game/core';
import { planLayout } from './bot-layout.js';
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
  priority: ['bld_rune_ward'],
};

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

const plan = (team: TeamState): BoardIntent[] =>
  planLayout(team, 0, content, team.map.plotWidth, style, Rng.fromSeed(3));
const placements = (intents: readonly BoardIntent[]) =>
  intents.flatMap((i) => (i.type === 'place_building' ? [i] : []));

describe('the layout planner and a Rune Ward', () => {
  test('a Ward and a Power collector: the Ward is placed and wired', () => {
    const team = withStash(['bld_rune_ward', 'bld_extractor']);
    const wardId = team.stash[0]?.id as number;
    const out = plan(team);
    expect(placements(out).some((i) => i.id === wardId)).toBe(true);
    expect(
      out.some(
        (i) =>
          i.type === 'add_conduit' &&
          'building' in i.to &&
          i.to.building === wardId,
      ),
    ).toBe(true);
  });

  test('a wall in the stash goes beside the Ward, sharing an edge with it', () => {
    const team = withStash(['bld_rune_ward', 'bld_extractor', 'bld_wall_o']);
    const wardId = team.stash[0]?.id as number;
    const wallId = team.stash[2]?.id as number;
    const out = placements(plan(team));
    const ward = out.find((i) => i.id === wardId);
    const wall = out.find((i) => i.id === wallId);
    expect(ward).toBeDefined();
    expect(wall).toBeDefined();
    if (ward === undefined || wall === undefined) return;
    // `bld_wall_o` is the 2x2 square.
    const cells = [0, 1].flatMap((dx) =>
      [0, 1].map((dy) => ({ x: wall.x + dx, y: wall.y + dy })),
    );
    expect(
      cells.some((c) => Math.abs(c.x - ward.x) + Math.abs(c.y - ward.y) === 1),
    ).toBe(true);
  });

  test('a Ward alone, with nothing to feed it, is not placed', () => {
    const team = withStash(['bld_rune_ward']);
    expect(placements(plan(team))).toEqual([]);
  });
});
