/** One Core per player in the team state (PP-2, issue #128). */
import { describe, expect, test } from 'vitest';
import { generateMap } from './generate-map.js';
import {
  coreFootprint,
  listLegalCorePositions,
  queryMap,
  validateCorePosition,
  type Cell,
} from './map.js';
import {
  addToStash,
  createTeamState,
  moveBuilding,
  occupancy,
  placeCore,
  placeFromStash,
  renderTeamStateAscii,
  validateTeamState,
  type TeamState,
} from './team-state.js';
import { content, mapgen } from './test-support.js';

const map = generateMap(7, 4, content, mapgen);
const q = queryMap(map, content.terrain);
const fp = coreFootprint(content.buildings);

function first(p: number): Cell {
  const c = listLegalCorePositions(map, content, mapgen, p)[0];
  if (c === undefined) throw new Error('no legal position');
  return c;
}
function must(
  r: { ok: true; state: TeamState } | { ok: false; reason: string },
): TeamState {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}
function allPlaced(): TeamState {
  let s = createTeamState(map);
  for (let p = 0; p < 4; p++)
    s = must(placeCore(s, content, mapgen, p, first(p)));
  return s;
}

describe('four-player state', () => {
  test('starts with four empty Core slots and holds one Core per plot', () => {
    expect(createTeamState(map).cores).toEqual([null, null, null, null]);
    const s = allPlaced();
    expect(s.cores).toHaveLength(4);
    s.cores.forEach((c, p) => {
      const core = c as Cell;
      expect(q.plotOf(core.x)).toBe(p);
      expect(q.plotOf(core.x + fp.width - 1)).toBe(p);
    });
    expect(
      validateTeamState(JSON.parse(JSON.stringify(s)), content, mapgen),
    ).toMatchObject({
      ok: true,
    });
  });

  test('a Core in another plot or across a plot border is outside_own_plot', () => {
    const s0 = createTeamState(map);
    const other = first(2);
    expect(placeCore(s0, content, mapgen, 0, other)).toEqual({
      ok: false,
      reason: 'outside_own_plot',
    });
    // Footprint spanning plots 0 and 1: its lowest x is the last column of 0.
    const span = { x: map.plotWidth - 1, y: first(0).y };
    expect(validateCorePosition(map, content, mapgen, 0, span)).toEqual({
      ok: false,
      reason: 'outside_own_plot',
    });
    expect(validateCorePosition(map, content, mapgen, 1, span)).toEqual({
      ok: false,
      reason: 'outside_own_plot',
    });
    // out_of_bounds comes first.
    expect(
      validateCorePosition(map, content, mapgen, 0, { x: -1, y: 0 }),
    ).toEqual({ ok: false, reason: 'out_of_bounds' });
  });

  test('listLegalCorePositions lists only the plot, by (y, x)', () => {
    for (let p = 0; p < 4; p++) {
      const list = listLegalCorePositions(map, content, mapgen, p);
      expect(list.length).toBeGreaterThan(0);
      for (const c of list) {
        expect(q.plotOf(c.x)).toBe(p);
        expect(q.plotOf(c.x + fp.width - 1)).toBe(p);
      }
      const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
      expect(list).toEqual(sorted);
    }
  });

  test('each player places exactly one Core', () => {
    let s = createTeamState(map);
    s = must(placeCore(s, content, mapgen, 2, first(2)));
    expect(s.cores.map((c) => c !== null)).toEqual([false, false, true, false]);
    expect(placeCore(s, content, mapgen, 2, first(2))).toEqual({
      ok: false,
      reason: 'core_already_placed',
    });
    const list = listLegalCorePositions(map, content, mapgen, 2);
    const another = list[list.length - 1] as Cell;
    expect(placeCore(s, content, mapgen, 2, another)).toEqual({
      ok: false,
      reason: 'core_already_placed',
    });
    // Other players can still place theirs.
    s = must(placeCore(s, content, mapgen, 0, first(0)));
    expect(s.cores[0]).toEqual(first(0));
    expect(placeCore(s, content, mapgen, 0, first(0))).toMatchObject({
      reason: 'core_already_placed',
    });
  });

  test('an actor that is not a player index is invalid_owner', () => {
    const s = createTeamState(map);
    for (const actor of [-1, 4, 1.5, Number.NaN]) {
      expect(placeCore(s, content, mapgen, actor, first(0))).toMatchObject({
        reason: 'invalid_owner',
      });
    }
  });
});

describe('every placed Core is an obstacle', () => {
  test('overlaps_core, overlaps_building and buildingAt', () => {
    const s = allPlaced();
    const c2 = s.cores[2] as Cell;
    const occ = occupancy(s, content);
    expect(occ.buildingAt(c2.x, c2.y)).toEqual({ core: 2 });
    expect(occ.buildingAt(c2.x + fp.width - 1, c2.y + fp.height - 1)).toEqual({
      core: 2,
    });
    const c0 = s.cores[0] as Cell;
    expect(occ.buildingAt(c0.x, c0.y)).toEqual({ core: 0 });

    const stash = addToStash(s, content, {
      def: 'bld_wall',
      tier: 1,
      owner: 2,
    });
    if (!stash.ok) throw new Error(stash.reason);
    expect(
      placeFromStash(stash.state, content, {
        id: stash.id,
        x: c2.x,
        y: c2.y,
        rotation: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'overlaps_core' });
    const ok = must(
      placeFromStash(stash.state, content, {
        id: stash.id,
        x: c2.x + fp.width,
        y: c2.y,
        rotation: 0,
      }),
    );
    expect(
      moveBuilding(ok, content, {
        id: stash.id,
        x: c2.x,
        y: c2.y,
        rotation: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'overlaps_core' });
  });
});

describe('validateTeamState and the ASCII picture', () => {
  test('a Core in another player plot, or a wrong-length list, is invalid', () => {
    const s = allPlaced();
    const json = JSON.parse(JSON.stringify(s)) as { cores: (Cell | null)[] };
    const swapped = { ...json, cores: [json.cores[1], null, null, null] };
    const r = validateTeamState(swapped, content, mapgen);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.join('\n')).toMatch(/cores\[0\].*outside_own_plot/);
    const short = validateTeamState(
      { ...json, cores: [json.cores[0]] },
      content,
      mapgen,
    );
    expect(short.ok).toBe(false);
    const old = validateTeamState({ ...json, core: null }, content, mapgen);
    expect(old.ok).toBe(false);
  });

  test('renderTeamStateAscii draws every Core', () => {
    const s = allPlaced();
    const lines = renderTeamStateAscii(s, content).split('\n');
    const grid = lines.slice(0, map.height).join('');
    expect(grid.split('').filter((ch) => ch === 'C')).toHaveLength(
      4 * fp.width * fp.height,
    );
  });
});
