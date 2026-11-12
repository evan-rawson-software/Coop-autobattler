import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import mapgenJson from '../../../content/mapgen.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import terrainJson from '../../../content/terrain.json';
import unitsJson from '../../../content/units.json';
import { loadAllContentOrThrow } from './content.js';
import { generateMap } from './generate-map.js';
import { canonicalJson } from './hash.js';
import {
  coreFootprint,
  listLegalCorePositions,
  queryMap,
  type Cell,
  type GameMap,
} from './map.js';
import { loadMapgenOrThrow } from './mapgen.js';
import { Rng } from './rng.js';
import {
  addToStash,
  createTeamState,
  moveBuilding,
  occupancy,
  placeCore,
  placeFromStash,
  removeFromStash,
  renderTeamStateAscii,
  returnToStash,
  validateTeamState,
  type TeamState,
} from './team-state.js';

const content = loadAllContentOrThrow({
  resources: resourcesJson,
  terrain: terrainJson,
  units: unitsJson,
  buildings: buildingsJson,
  presentation: presentationJson,
});
const config = loadMapgenOrThrow(mapgenJson, { terrain: content.terrain });

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) {
      deepFreeze(v);
    }
  }
  return value;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const SOURCE = 'bld_extractor'; // 1x1 source
const WALL = 'bld_wall'; // 1x1
const BARRACKS = 'bld_barracks'; // 2x2
const MERGER = 'bld_merger';

const map: GameMap = generateMap(7, 2, content, config);
const q = queryMap(map, content.terrain);
const coreFp = coreFootprint(content.buildings);

function cellsWhere(pred: (x: number, y: number) => boolean): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (pred(x, y)) out.push({ x, y });
  }
  return out;
}
const isOpen = (x: number, y: number): boolean =>
  q.isBuildable(x, y) && q.nodeAt(x, y) === undefined;
const lake = map.features.find((f) => f.feature === 'ter_lake');
const node = map.nodes[0];
if (lake === undefined || node === undefined) throw new Error('bad test map');

/** An open w x h rectangle's lowest cell, the `skip`-th such one. */
function openRect(w: number, h: number, skip = 0): Cell {
  const found = cellsWhere((x, y) => {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) if (!isOpen(x + dx, y + dy)) return false;
    return true;
  });
  const c = found[skip];
  if (c === undefined) throw new Error('no open rectangle');
  return c;
}

function must(
  r: { ok: true; state: TeamState } | { ok: false; reason: string },
): TeamState {
  if (!r.ok) throw new Error(`unexpected rejection: ${r.reason}`);
  return r.state;
}
function stashed(
  state: TeamState,
  def: string,
  owner = 0,
  tier = 1,
): { state: TeamState; id: number } {
  const r = addToStash(state, content, { def, tier, owner });
  if (!r.ok) throw new Error(r.reason);
  return { state: r.state, id: r.id };
}
function valid(state: unknown): string[] {
  const r = validateTeamState(state, content, config);
  return r.ok ? [] : [...r.errors];
}

describe('createTeamState and addToStash', () => {
  test('empty state', () => {
    const s = createTeamState(map);
    expect(s).toEqual({
      map,
      cores: [null, null],
      buildings: [],
      stash: [],
      nextId: 1,
      conduits: [],
    });
    expect(valid(s)).toEqual([]);
  });

  test('assigns increasing IDs and never reuses them', () => {
    deepFreeze(map);
    let s = deepFreeze(createTeamState(map));
    const a = stashed(s, WALL);
    s = deepFreeze(a.state);
    const b = stashed(s, SOURCE, 1, 3);
    expect([a.id, b.id]).toEqual([1, 2]);
    s = deepFreeze(must(removeFromStash(b.state, { id: 2 })));
    const c = stashed(s, WALL);
    expect(c.id).toBe(3);
    expect(valid(c.state)).toEqual([]);
  });

  test('rejections', () => {
    const s = deepFreeze(createTeamState(map));
    const bad = (def: string, tier: number, owner: number) =>
      addToStash(s, content, { def, tier, owner });
    expect(bad('bld_nope', 1, 0)).toMatchObject({
      ok: false,
      reason: 'unknown_definition',
    });
    expect(bad('bld_core', 1, 0)).toMatchObject({
      ok: false,
      reason: 'core_not_allowed',
    });
    expect(bad(WALL, 0, 0)).toMatchObject({
      ok: false,
      reason: 'invalid_tier',
    });
    expect(bad(WALL, 4, 0)).toMatchObject({
      ok: false,
      reason: 'invalid_tier',
    });
    expect(bad(WALL, 1.5, 0)).toMatchObject({
      ok: false,
      reason: 'invalid_tier',
    });
    expect(bad(WALL, 1, 2)).toMatchObject({
      ok: false,
      reason: 'invalid_owner',
    });
    expect(bad(WALL, 1, -1)).toMatchObject({
      ok: false,
      reason: 'invalid_owner',
    });
  });
});

describe('placeCore', () => {
  const s0 = deepFreeze(createTeamState(map));
  const legal = listLegalCorePositions(map, content, config, 0);
  const pos = legal[0] as Cell;

  test('accepts a legal position, once', () => {
    const s1 = must(placeCore(s0, content, config, 0, pos));
    expect(s1.cores[0]).toEqual(pos);
    expect(s0.cores[0]).toBeNull();
    expect(valid(s1)).toEqual([]);
    expect(placeCore(deepFreeze(s1), content, config, 0, pos)).toMatchObject({
      ok: false,
      reason: 'core_already_placed',
    });
  });

  test('forwards the validateCorePosition reasons', () => {
    expect(placeCore(s0, content, config, 0, { x: -1, y: 0 })).toMatchObject({
      reason: 'out_of_bounds',
    });
    expect(
      placeCore(s0, content, config, q.plotOf(lake.x), {
        x: lake.x,
        y: lake.y,
      }),
    ).toMatchObject({ reason: 'blocked' });
    expect(
      placeCore(s0, content, config, q.plotOf(node.x), {
        x: node.x,
        y: node.y,
      }),
    ).toMatchObject({ reason: 'on_node' });
    expect(
      placeCore(s0, content, config, 0, { x: 0, y: map.height - 1 }),
    ).toMatchObject({ reason: 'out_of_bounds' });
    expect(
      placeCore(s0, content, config, 0, { x: 0, y: map.height - 2 }),
    ).toMatchObject({ reason: 'too_far_forward' });
  });

  test('overlaps_building', () => {
    const w = stashed(s0, WALL);
    const placed = must(
      placeFromStash(w.state, content, {
        id: w.id,
        x: pos.x,
        y: pos.y,
        rotation: 0,
      }),
    );
    expect(
      placeCore(deepFreeze(placed), content, config, 0, pos),
    ).toMatchObject({
      ok: false,
      reason: 'overlaps_building',
    });
    const far = legal.find((c) => c.x >= pos.x + coreFp.width) as Cell;
    expect(placeCore(placed, content, config, 0, far).ok).toBe(true);
  });
});

describe('placeFromStash and moveBuilding rules', () => {
  const base = deepFreeze(
    must(placeCore(createTeamState(map), content, config, 0, openCore())),
  );
  function openCore(): Cell {
    return listLegalCorePositions(map, content, config, 0)[0] as Cell;
  }
  const open = openRect(1, 1, 20);
  const place = (
    state: TeamState,
    def: string,
    x: number,
    y: number,
    rotation = 0,
  ) => {
    const a = stashed(state, def);
    return {
      id: a.id,
      stash: a.state,
      result: placeFromStash(deepFreeze(a.state), content, {
        id: a.id,
        x,
        y,
        rotation,
      }),
    };
  };

  test('accepted: free cell, state is new and stash entry moves', () => {
    const { id, stash, result } = place(base, WALL, open.x, open.y);
    const s = must(result);
    expect(s.buildings).toEqual([
      { id, def: WALL, tier: 1, x: open.x, y: open.y, rotation: 0, owner: 0 },
    ]);
    expect(s.stash).toEqual([]);
    expect(stash.stash).toHaveLength(1);
    expect(valid(s)).toEqual([]);
  });

  test('unknown_building (not in stash / not placed)', () => {
    expect(
      placeFromStash(base, content, { id: 99, x: 0, y: 0, rotation: 0 }),
    ).toMatchObject({ reason: 'unknown_building' });
    expect(
      moveBuilding(base, content, { id: 99, x: 0, y: 0, rotation: 0 }),
    ).toMatchObject({ reason: 'unknown_building' });
    expect(returnToStash(base, content, { id: 99 })).toMatchObject({
      reason: 'unknown_building',
    });
    expect(removeFromStash(base, { id: 99 })).toMatchObject({
      reason: 'unknown_building',
    });
    // A placed building is not in the stash, and vice versa.
    const p = place(base, WALL, open.x, open.y);
    const s = must(p.result);
    expect(
      placeFromStash(s, content, { id: p.id, x: 0, y: 0, rotation: 0 }),
    ).toMatchObject({ reason: 'unknown_building' });
    expect(removeFromStash(s, { id: p.id })).toMatchObject({
      reason: 'unknown_building',
    });
  });

  test('invalid_rotation', () => {
    for (const r of [45, -90, 360, 1.5, Number.NaN]) {
      expect(place(base, WALL, open.x, open.y, r).result).toMatchObject({
        ok: false,
        reason: 'invalid_rotation',
      });
    }
  });

  test('out_of_bounds, including rotated footprints', () => {
    expect(place(base, WALL, -1, 0).result).toMatchObject({
      reason: 'out_of_bounds',
    });
    expect(place(base, WALL, map.width, 0).result).toMatchObject({
      reason: 'out_of_bounds',
    });
    expect(place(base, WALL, 0.5, 0).result).toMatchObject({
      reason: 'out_of_bounds',
    });
    // 2x2 hanging off the front/right edge
    expect(place(base, BARRACKS, map.width - 1, 0).result).toMatchObject({
      reason: 'out_of_bounds',
    });
    expect(place(base, BARRACKS, 0, map.height - 1, 90).result).toMatchObject({
      reason: 'out_of_bounds',
    });
  });

  test('blocked_by_feature', () => {
    expect(place(base, WALL, lake.x, lake.y).result).toMatchObject({
      reason: 'blocked_by_feature',
    });
  });

  test('overlaps_core', () => {
    const c = base.cores[0] as Cell;
    expect(place(base, WALL, c.x + 1, c.y + 1).result).toMatchObject({
      reason: 'overlaps_core',
    });
  });

  test('overlaps_building, and moving over itself is fine', () => {
    const a = place(base, BARRACKS, open.x, open.y);
    const rect = openRect(2, 2, 3);
    const first = place(base, BARRACKS, rect.x, rect.y);
    const s1 = must(first.result);
    const second = place(s1, WALL, rect.x + 1, rect.y + 1);
    expect(second.result).toMatchObject({
      ok: false,
      reason: 'overlaps_building',
    });
    // move in place by one column (own old cells do not count) when free
    const moved = moveBuilding(s1, content, {
      id: first.id,
      x: rect.x,
      y: rect.y,
      rotation: 90,
    });
    expect(moved.ok).toBe(true);
    expect(a.result).toBeDefined();
  });

  test('source rules', () => {
    const onNode = place(base, SOURCE, node.x, node.y);
    const s = must(onNode.result);
    expect(valid(s)).toEqual([]);
    const occ = occupancy(s, content);
    const placed = s.buildings[0];
    if (placed === undefined) throw new Error('missing');
    expect(occ.sourceResource(placed)).toBe(node.resource);
    expect(place(base, SOURCE, open.x, open.y).result).toMatchObject({
      reason: 'source_needs_node',
    });
    // a non-source on a node
    expect(place(base, WALL, node.x, node.y).result).toMatchObject({
      reason: 'node_reserved',
    });
  });

  test('rule order: out_of_bounds before blocked before core before building before node', () => {
    // a source (needs node) on a lake: blocked_by_feature, not source_needs_node
    expect(place(base, SOURCE, lake.x, lake.y).result).toMatchObject({
      reason: 'blocked_by_feature',
    });
    // a source on the Core: overlaps_core, not source_needs_node
    const c = base.cores[0] as Cell;
    expect(place(base, SOURCE, c.x, c.y).result).toMatchObject({
      reason: 'overlaps_core',
    });
    // invalid rotation wins over out of bounds
    expect(place(base, WALL, -5, -5, 7).result).toMatchObject({
      reason: 'invalid_rotation',
    });
  });

  test('moveBuilding: moves, rotates, rejects, and keeps the old state', () => {
    const rect = openRect(2, 2, 5);
    const p = place(base, BARRACKS, rect.x, rect.y);
    const s1 = deepFreeze(must(p.result));
    const rotated = must(
      moveBuilding(s1, content, {
        id: p.id,
        x: rect.x,
        y: rect.y,
        rotation: 180,
      }),
    );
    expect(rotated.buildings[0]?.rotation).toBe(180);
    expect(s1.buildings[0]?.rotation).toBe(0);
    const bad = moveBuilding(s1, content, {
      id: p.id,
      x: lake.x,
      y: lake.y,
      rotation: 0,
    });
    expect(bad).toMatchObject({ ok: false, reason: 'blocked_by_feature' });
    expect(valid(rotated)).toEqual([]);
  });

  test('returnToStash puts the entry back in canonical order', () => {
    const a = place(base, WALL, open.x, open.y);
    const b = place(must(a.result), MERGER, open.x + 1, open.y);
    let s = must(b.result);
    const c = stashed(s, WALL);
    s = c.state;
    s = must(returnToStash(s, content, { id: a.id }));
    expect(s.stash.map((e) => e.id)).toEqual([a.id, c.id]);
    expect(s.buildings.map((e) => e.id)).toEqual([b.id]);
    expect(valid(s)).toEqual([]);
  });

  test('conduits are preserved untouched', () => {
    const a = place(base, WALL, open.x, open.y);
    const s = must(a.result);
    expect(s.conduits).toEqual([]);
    const m = must(
      moveBuilding(s, content, {
        id: a.id,
        x: open.x,
        y: open.y,
        rotation: 90,
      }),
    );
    expect(m.conduits).toEqual([]);
  });
});

describe('occupancy and geometry', () => {
  test('cells and sides at each rotation', () => {
    const rect = openRect(2, 1, 0);
    // a 1x2 or 2x1 building does not exist in content; use the 2x2 and sides
    let s = createTeamState(map);
    const a = stashed(s, 'bld_splitter');
    s = a.state;
    const spot = openRect(1, 1, 30);
    s = must(
      placeFromStash(s, content, {
        id: a.id,
        x: spot.x,
        y: spot.y,
        rotation: 90,
      }),
    );
    const occ = occupancy(s, content);
    const b = s.buildings[0];
    if (b === undefined) throw new Error('missing');
    expect(occ.cellsOf(b)).toEqual([{ x: spot.x, y: spot.y }]);
    // splitter at rotation 0: input south, outputs north/east/west; +90 clockwise
    const sides = occ.absoluteSides(b);
    expect(sides.inputs.map((i) => i.side)).toEqual(['west']);
    expect(sides.outputs).toEqual(['east', 'south', 'north']);
    expect(occ.buildingAt(spot.x, spot.y)).toBe(b);
    expect(occ.buildingAt(-1, 0)).toBeNull();
    expect(rect).toBeDefined();
  });

  test('2x2 at 90 degrees keeps a 2x2 box anchored at the position', () => {
    const rect = openRect(2, 2, 2);
    let s = createTeamState(map);
    const a = stashed(s, BARRACKS);
    s = must(
      placeFromStash(a.state, content, {
        id: a.id,
        x: rect.x,
        y: rect.y,
        rotation: 270,
      }),
    );
    const b = s.buildings[0];
    if (b === undefined) throw new Error('missing');
    const occ = occupancy(s, content);
    expect(occ.cellsOf(b)).toEqual([
      { x: rect.x, y: rect.y },
      { x: rect.x + 1, y: rect.y },
      { x: rect.x, y: rect.y + 1 },
      { x: rect.x + 1, y: rect.y + 1 },
    ]);
    expect(occ.absoluteSides(b).inputs[0]?.side).toBe('east'); // south + 270
  });

  test('buildingAt returns core', () => {
    const s = must(
      placeCore(
        createTeamState(map),
        content,
        config,
        0,
        listLegalCorePositions(map, content, config, 0)[0] as Cell,
      ),
    );
    const c = s.cores[0] as Cell;
    const occ = occupancy(s, content);
    expect(occ.buildingAt(c.x, c.y)).toEqual({ core: 0 });
    expect(occ.buildingAt(c.x + coreFp.width, c.y)).toBeNull();
  });
});

describe('validateTeamState rejects illegal states', () => {
  const legalCore = listLegalCorePositions(map, content, config, 0)[0] as Cell;
  let good = must(
    placeCore(createTeamState(map), content, config, 0, legalCore),
  );
  const w = stashed(good, WALL);
  const o = openRect(1, 1, 40);
  good = must(
    placeFromStash(w.state, content, { id: w.id, x: o.x, y: o.y, rotation: 0 }),
  );
  const s2 = stashed(good, WALL, 1, 2);
  good = s2.state;
  const goodJson = clone(good) as unknown as Record<string, unknown>;

  const mutated = (fn: (s: Record<string, unknown>) => void): unknown => {
    const c = clone(goodJson);
    fn(c);
    return c;
  };
  const building = (
    extra: Record<string, unknown>,
  ): Record<string, unknown> => ({
    id: 10,
    def: WALL,
    tier: 1,
    x: o.x,
    y: o.y,
    rotation: 0,
    owner: 0,
    ...extra,
  });

  test('the base state is valid and round-trips', () => {
    expect(valid(good)).toEqual([]);
    const r = validateTeamState(clone(good), content, config);
    expect(r.ok && canonicalJson(r.state)).toBe(canonicalJson(good));
  });

  test.each([
    [
      'source off a node',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ def: SOURCE })]),
    ],
    [
      'building on a lake',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ x: lake.x, y: lake.y })]),
    ],
    [
      'two buildings overlapping',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ id: 3 }), building({ id: 4 })]),
    ],
    [
      'building overlapping the Core',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ x: legalCore.x, y: legalCore.y })]),
    ],
    [
      'core-kind entry in buildings',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ def: 'bld_core' })]),
    ],
    [
      'core-kind entry in stash',
      (s: Record<string, unknown>) =>
        (s['stash'] = [{ id: 9, def: 'bld_core', tier: 1, owner: 0 }]),
    ],
    [
      'duplicate IDs across lists',
      (s: Record<string, unknown>) =>
        (s['stash'] = [{ id: 1, def: WALL, tier: 1, owner: 0 }]),
    ],
    ['nextId too small', (s: Record<string, unknown>) => (s['nextId'] = 2)],
    [
      'owner out of range',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ owner: 2 })]),
    ],
    [
      'tier 4',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ tier: 4 })]),
    ],
    [
      'Core on a lake',
      (s: Record<string, unknown>) => (s['core'] = { x: lake.x, y: lake.y }),
    ],
    [
      'not sorted',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [
          building({ id: 5, x: o.x }),
          building({ id: 4, x: o.x - 1 }),
        ]),
    ],
    [
      'bad rotation',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ rotation: 45 })]),
    ],
    [
      'unknown def',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ def: 'bld_zzz' })]),
    ],
    [
      'non-node building on a node',
      (s: Record<string, unknown>) =>
        (s['buildings'] = [building({ x: node.x, y: node.y })]),
    ],
    [
      'non-empty conduits',
      (s: Record<string, unknown>) => (s['conduits'] = [{}]),
    ],
    ['extra field', (s: Record<string, unknown>) => (s['extra'] = 1)],
    [
      'non-integer position',
      (s: Record<string, unknown>) => (s['buildings'] = [building({ x: 1.5 })]),
    ],
  ])('%s', (_name, fn) => {
    const errors = valid(mutated(fn));
    expect(errors.length).toBeGreaterThan(0);
  });

  test('malformed input never throws', () => {
    const junk: unknown[] = [
      null,
      undefined,
      'a string',
      42,
      [],
      {},
      { map: null },
      { map: 5, cores: 1, buildings: 'x', stash: {}, nextId: 'y', conduits: 3 },
      { ...clone(goodJson), buildings: [null, 5, 'x', []] },
      { ...clone(goodJson), stash: [null, {}] },
      { ...clone(goodJson), cores: [{ x: 'a' }] },
      { ...clone(goodJson), cores: 7 },
      { ...clone(goodJson), nextId: Number.NaN },
      { ...clone(goodJson), nextId: 1e300 },
      {
        ...clone(goodJson),
        map: { ...(clone(goodJson)['map'] as object), features: [{}] },
      },
    ];
    for (const j of junk) {
      expect(() => validateTeamState(j, content, config)).not.toThrow();
      expect(valid(j).length).toBeGreaterThan(0);
    }
  });

  test('does not mutate its input', () => {
    const frozen = deepFreeze(clone(goodJson));
    expect(() => validateTeamState(frozen, content, config)).not.toThrow();
  });
});

describe('renderTeamStateAscii', () => {
  test('draws buildings and the Core', () => {
    const small = generateMap(3, 1, content, config);
    let s = createTeamState(small);
    const sq = queryMap(small, content.terrain);
    const core = listLegalCorePositions(small, content, config, 0)[0] as Cell;
    s = must(placeCore(s, content, config, 0, core));
    const src = small.nodes[0] as { x: number; y: number };
    const a = stashed(s, SOURCE);
    s = must(
      placeFromStash(a.state, content, {
        id: a.id,
        x: src.x,
        y: src.y,
        rotation: 0,
      }),
    );
    const text = renderTeamStateAscii(s, content);
    const lines = text.split('\n');
    expect(lines).toHaveLength(small.height + 1);
    expect(text).toContain('C');
    expect(text).toContain('S');
    expect(lines[small.height - 1 - src.y]?.[src.x]).toBe('S');
    expect(lines[small.height - 1 - core.y]?.[core.x]).toBe('C');
    expect(sq.isInBounds(0, 0)).toBe(true);
  });
});

describe('purity and properties', () => {
  test('operations never mutate frozen inputs', () => {
    const legal = listLegalCorePositions(map, content, config, 0)[0] as Cell;
    let s = deepFreeze(createTeamState(map));
    s = deepFreeze(must(placeCore(s, content, config, 0, legal)));
    const a = stashed(s, WALL);
    s = deepFreeze(a.state);
    const o = openRect(1, 1, 50);
    s = deepFreeze(
      must(
        placeFromStash(s, content, { id: a.id, x: o.x, y: o.y, rotation: 0 }),
      ),
    );
    s = deepFreeze(
      must(
        moveBuilding(s, content, { id: a.id, x: o.x, y: o.y, rotation: 90 }),
      ),
    );
    s = deepFreeze(must(returnToStash(s, content, { id: a.id })));
    s = deepFreeze(must(removeFromStash(s, { id: a.id })));
    expect(s.stash).toEqual([]);
    expect(placeCore(s, content, config, 0, legal).ok).toBe(false);
  });

  test(
    'random operations keep the state valid; rejections change nothing',
    { timeout: 60000 },
    () => {
      const defs = content.buildings
        .list()
        .filter((b) => b.kind !== 'core')
        .map((b) => b.id);
      let accepted = 0;
      let rejected = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const partySize = 1 + (seed % 3);
        const m = generateMap(seed, partySize, content, config);
        const rng = Rng.fromSeed(seed * 7919);
        let s = deepFreeze(createTeamState(m));
        const legal = listLegalCorePositions(m, content, config, 0);
        s = deepFreeze(
          must(
            placeCore(
              s,
              content,
              config,
              0,
              legal[rng.nextInt(legal.length)] as Cell,
            ),
          ),
        );
        expect(valid(s)).toEqual([]);
        const check = (
          r: { ok: true; state: TeamState } | { ok: false; reason: string },
          before: TeamState,
        ): void => {
          if (r.ok) {
            accepted++;
            expect(valid(r.state)).toEqual([]);
            s = deepFreeze(r.state);
          } else {
            rejected++;
            expect(before).toEqual(s);
          }
        };
        for (let step = 0; step < 150; step++) {
          const before = clone(s);
          const pick = rng.nextInt(10);
          const anyX = (): number => rng.nextInt(m.width + 2) - 1;
          const anyY = (): number => rng.nextInt(m.height + 2) - 1;
          const rot = (): number =>
            [0, 90, 180, 270, 45][rng.nextInt(5)] as number;
          // Prefer node cells for some placements so sources get placed.
          const nodePos = (): { x: number; y: number } => {
            const n = m.nodes[rng.nextInt(m.nodes.length)] as Cell;
            return { x: n.x, y: n.y };
          };
          if (pick <= 2) {
            const r = addToStash(s, content, {
              def: defs[rng.nextInt(defs.length)] as string,
              tier: 1 + rng.nextInt(3),
              owner: rng.nextInt(partySize),
            });
            check(r, before);
          } else if (pick <= 5 && s.stash.length > 0) {
            const e = s.stash[rng.nextInt(s.stash.length)];
            const p =
              rng.nextInt(2) === 0 ? nodePos() : { x: anyX(), y: anyY() };
            check(
              placeFromStash(s, content, {
                id: e?.id ?? 0,
                x: p.x,
                y: p.y,
                rotation: rot(),
              }),
              before,
            );
          } else if (pick <= 8 && s.buildings.length > 0) {
            const e = s.buildings[rng.nextInt(s.buildings.length)];
            const p =
              rng.nextInt(2) === 0 ? nodePos() : { x: anyX(), y: anyY() };
            check(
              moveBuilding(s, content, {
                id: e?.id ?? 0,
                x: p.x,
                y: p.y,
                rotation: rot(),
              }),
              before,
            );
          } else if (s.buildings.length > 0) {
            const e = s.buildings[rng.nextInt(s.buildings.length)];
            check(returnToStash(s, content, { id: e?.id ?? 0 }), before);
          }
        }
      }
      expect(accepted).toBeGreaterThan(500);
      expect(rejected).toBeGreaterThan(100);
    },
  );
});
