import {
  addItemToStash,
  createTeamState,
  placeFromStash,
  type GameMap,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { wardReach } from './ward-reach.js';

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 1,
  plotWidth: 24,
  features: [],
  nodes: [],
};

const WARD = 'bld_rune_ward';

/** A state with buildings placed: [def, x, y]. */
function placed(...list: [string, number, number][]): TeamState {
  let s = createTeamState(map);
  for (const [def, x, y] of list) {
    const bought = addItemToStash(s, content, { def, tier: 1, owner: 0 });
    if (!bought.ok) throw new Error(bought.reason);
    const r = placeFromStash(bought.state, content, {
      actor: 0,
      id: bought.id,
      x,
      y,
      rotation: 0,
    });
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
  }
  return s;
}

describe('the reach of a Rune Ward', () => {
  test('a Ward reaches the four cells that share an edge with it', () => {
    const r = wardReach(placed(), content, WARD, { x: 5, y: 5 }, 0);
    expect(r?.reach).toEqual([
      { x: 5, y: 6 },
      { x: 6, y: 5 },
      { x: 5, y: 4 },
      { x: 4, y: 5 },
    ]);
    expect(r?.covered).toEqual([]);
  });

  test('cells outside the map are left out', () => {
    const r = wardReach(placed(), content, WARD, { x: 0, y: 0 }, 0);
    expect(r?.reach).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]);
  });

  test('walls and gates of the owner on those cells are covered; a diagonal is not in reach', () => {
    const team = placed(
      ['bld_wall_block', 6, 5],
      ['bld_gate', 5, 6],
      ['bld_wall_block', 4, 4],
      ['bld_turret', 4, 5],
    );
    const r = wardReach(team, content, WARD, { x: 5, y: 5 }, 0);
    expect(r?.covered).toEqual([
      { x: 5, y: 6 },
      { x: 6, y: 5 },
    ]);
    // A wall of another owner is not covered.
    expect(wardReach(team, content, WARD, { x: 5, y: 5 }, 1)?.covered).toEqual(
      [],
    );
  });

  test('a building being moved does not count', () => {
    const team = placed(['bld_wall_block', 6, 5]);
    const id = team.buildings[0]?.id as number;
    expect(
      wardReach(team, content, WARD, { x: 5, y: 5 }, 0, id)?.covered,
    ).toEqual([]);
  });

  test('anything but a Ward has no reach', () => {
    expect(
      wardReach(placed(), content, 'bld_turret', { x: 5, y: 5 }, 0),
    ).toBeNull();
    expect(
      wardReach(placed(), content, 'bld_wall_block', { x: 5, y: 5 }, 0),
    ).toBeNull();
  });
});
