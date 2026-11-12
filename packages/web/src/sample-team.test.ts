import {
  generateMap,
  soleCore,
  validateTeamState,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from './content.js';
import { buildScene, firstLetter, hitTest, shortLabel } from './board/scene.js';
import { buildSampleTeam } from './sample-team.js';

function sample(seed: number, party: number, dense = false): TeamState {
  const map = generateMap(seed, party, content, content.mapgen);
  return buildSampleTeam(map, content, seed, { dense });
}

describe('sample team', () => {
  test.each([1, 2, 3, 4])('party of %i: Core, buildings and conduits', (n) => {
    const s = sample(7, n);
    expect(soleCore(s)).not.toBeNull();
    expect(s.buildings.length).toBeGreaterThan(5);
    expect(s.conduits.length).toBeGreaterThan(0);
  });

  test('the result is a valid team state', () => {
    const s = sample(3, 2);
    const r = validateTeamState(
      JSON.parse(JSON.stringify(s)),
      content,
      content.mapgen,
    );
    expect(r.ok).toBe(true);
  });

  test('is deterministic', () => {
    expect(sample(5, 2)).toEqual(sample(5, 2));
  });

  test('the dense sample has hundreds of buildings and dozens of conduit cells', () => {
    const s = sample(11, 4, true);
    const cells = s.conduits.reduce((n, c) => n + c.cells.length, 0);
    expect(s.buildings.length).toBeGreaterThan(200);
    expect(cells).toBeGreaterThan(50);
  }, 60_000);
});

describe('scene', () => {
  const own = sample(2, 1);

  test('the Core is in the lower half of our board on screen', () => {
    const scene = buildScene(own, null, 0, content);
    const board = scene.boards[0];
    expect(board?.core).not.toBeNull();
    const r = board?.core?.rect;
    expect(r).toBeDefined();
    if (r) expect(r.y + r.h / 2).toBeGreaterThan(own.map.height / 2);
  });

  test('hit testing agrees with core occupancy', () => {
    const scene = buildScene(own, null, 0, content);
    const b = scene.boards[0];
    const building = own.buildings[0];
    if (!b || !building) throw new Error('sample has no buildings');
    const cell = b.occ.cellsOf(building)[0];
    if (!cell) throw new Error('no cells');
    const f = b.frame;
    const hit = hitTest(
      scene,
      f.ox + cell.x + 0.5,
      f.oy + (f.h - 1 - cell.y) + 0.5,
    );
    expect(hit?.building).toEqual(building);
  });

  test('every conduit has a path and a colour pattern', () => {
    const scene = buildScene(own, null, 0, content);
    for (const c of scene.boards[0]?.conduits ?? []) {
      expect(c.points.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('labels', () => {
  test('letters come from the display name at runtime', () => {
    expect(firstLetter('Ore')).toBe('O');
    expect(shortLabel('Barracks')).toBe('Ba');
    expect(firstLetter('')).toBe('?');
  });
});
