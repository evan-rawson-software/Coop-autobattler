import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import mapgenJson from '../../../content/mapgen.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import terrainJson from '../../../content/terrain.json';
import unitsJson from '../../../content/units.json';
import type { Side } from './buildings.js';
import {
  addConduit,
  buildFlowGraph,
  conduitResource,
  type ConduitReason,
  type FlowGraph,
} from './conduits.js';
import { loadAllContentOrThrow } from './content.js';
import { generateMap } from './generate-map.js';
import { hashJson } from './hash.js';
import { listLegalCorePositions, type Cell, type GameMap } from './map.js';
import { loadMapgenOrThrow } from './mapgen.js';
import { Rng } from './rng.js';
import {
  addToStash,
  createTeamState,
  detachConduits,
  eraseConduit,
  moveBuilding,
  occupancy,
  placeCore,
  placeFromStash,
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

const A = 'res_a';
const B = 'res_b';

/**
 * A hand-made 24 x 16 board with one lake cell at (4, 5) and nodes: res_a at
 * (2, 2) and (12, 2), res_c at (20, 2), res_b at (11, 3).
 */
const lab: GameMap = {
  width: 24,
  height: 16,
  partySize: 1,
  plotWidth: 24,
  features: [{ x: 4, y: 5, feature: 'ter_lake' }],
  nodes: [
    { x: 2, y: 2, resource: 'res_a' },
    { x: 12, y: 2, resource: 'res_a' },
    { x: 20, y: 2, resource: 'res_c' },
    { x: 11, y: 3, resource: 'res_b' },
  ],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function got<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing value');
  return v;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) {
      deepFreeze(v);
    }
  }
  return value;
}

function valid(state: unknown): string[] {
  const r = validateTeamState(state, content, config);
  return r.ok ? [] : [...r.errors];
}

type Pairs = [number, number][];
const cellsOf = (pairs: Pairs): Cell[] => pairs.map(([x, y]) => ({ x, y }));

/** Builds a state step by step; the helpers throw on an unexpected rejection. */
class Lab {
  state: TeamState;
  constructor(map: GameMap = lab) {
    this.state = createTeamState(map);
  }
  put(def: string, x: number, y: number, rotation = 0): number {
    const s = addToStash(this.state, content, { def, tier: 1, owner: 0 });
    if (!s.ok) throw new Error(s.reason);
    const p = placeFromStash(s.state, content, { id: s.id, x, y, rotation });
    if (!p.ok)
      throw new Error(`${def} at ${String(x)},${String(y)}: ${p.reason}`);
    this.state = p.state;
    return s.id;
  }
  try(
    from: number,
    fromSide: string,
    to: number,
    toSide: string,
    cells: Pairs = [],
  ): ReturnType<typeof addConduit> {
    const before = this.state;
    const r = addConduit(this.state, content, {
      from: { building: from, side: fromSide },
      to: { building: to, side: toSide },
      cells: cellsOf(cells),
    });
    if (r.ok) this.state = r.state;
    else expect(this.state).toBe(before);
    return r;
  }
  link(
    from: number,
    fromSide: Side,
    to: number,
    toSide: Side,
    cells: Pairs = [],
  ): number {
    const r = this.try(from, fromSide, to, toSide, cells);
    if (!r.ok) throw new Error(`link rejected: ${r.reason} ${r.detail ?? ''}`);
    return r.id;
  }
  /** The reason a link is rejected with, or 'ACCEPTED'. Leaves the state alone on rejection. */
  why(
    from: number,
    fromSide: string,
    to: number,
    toSide: string,
    cells: Pairs = [],
  ): ConduitReason | 'ACCEPTED' {
    const r = this.try(from, fromSide, to, toSide, cells);
    return r.ok ? 'ACCEPTED' : r.reason;
  }
}

/** Nine buildings and seven conduits (IDs 10 to 16): the board of the flow tests. */
function sampleBoard(): { lab: Lab; ids: number[] } {
  const l = new Lab();
  const sa1 = l.put('bld_extractor', 2, 2);
  const p = l.put('bld_splitter', 2, 3);
  const b1 = l.put('bld_barracks', 2, 4);
  const b2 = l.put('bld_barracks', 5, 4);
  const sa2 = l.put('bld_extractor', 12, 2);
  const sb = l.put('bld_extractor', 11, 3, 90);
  const x = l.put('bld_crossover', 12, 3);
  const b3 = l.put('bld_barracks', 12, 4);
  const t = l.put('bld_turret', 13, 3, 90);
  l.link(sa1, 'north', p, 'south');
  l.link(p, 'north', b1, 'south');
  l.link(p, 'east', b2, 'south', [
    [3, 3],
    [4, 3],
    [5, 3],
  ]);
  l.link(sa2, 'north', x, 'south');
  l.link(sb, 'east', x, 'west');
  l.link(x, 'north', b3, 'south');
  l.link(x, 'east', t, 'west');
  return { lab: l, ids: [sa1, p, b1, b2, sa2, sb, x, b3, t] };
}

describe('accepted connections', () => {
  test('a direct connection has no cells and consumes an ID', () => {
    const l = new Lab();
    const s = l.put('bld_extractor', 2, 2);
    const b = l.put('bld_barracks', 2, 3);
    const nextBefore = l.state.nextId;
    const id = l.link(s, 'north', b, 'south');
    expect(id).toBe(nextBefore);
    expect(l.state.nextId).toBe(nextBefore + 1);
    expect(l.state.conduits).toEqual([
      {
        id,
        from: { building: s, side: 'north' },
        to: { building: b, side: 'south' },
        cells: [],
      },
    ]);
    expect(valid(l.state)).toEqual([]);
  });

  test('a direct connection works on either edge of a 2x2 side', () => {
    const l = new Lab();
    const s = l.put('bld_extractor', 2, 2);
    const b = l.put('bld_barracks', 1, 3); // (2, 3) is its right-hand south edge
    l.link(s, 'north', b, 'south');
    expect(valid(l.state)).toEqual([]);
  });

  test('a path conduit; it may run over a resource node', () => {
    const l = new Lab();
    const src = l.put('bld_extractor', 11, 3, 90); // res_b node, east output
    const t = l.put('bld_turret', 13, 1, 180); // input on its north side
    l.link(src, 'east', t, 'north', [
      [12, 3],
      [12, 2], // a res_a node cell
      [13, 2],
    ]);
    expect(valid(l.state)).toEqual([]);
    // While the conduit lies there, the node cannot take a source.
    const s = addToStash(l.state, content, {
      def: 'bld_extractor',
      tier: 1,
      owner: 0,
    });
    if (!s.ok) throw new Error('stash');
    const p = placeFromStash(s.state, content, {
      id: s.id,
      x: 12,
      y: 2,
      rotation: 0,
    });
    expect(p).toMatchObject({ ok: false, reason: 'overlaps_conduit' });
  });

  test('a path may end on either edge of a 2x2 side', () => {
    const l = new Lab();
    const s = l.put('bld_extractor', 2, 2);
    const b = l.put('bld_barracks', 2, 6); // south edges are outside (2,5) and (3,5)
    l.link(s, 'north', b, 'south', [
      [2, 3],
      [3, 3],
      [3, 4],
      [3, 5],
    ]);
    expect(valid(l.state)).toEqual([]);
  });

  test('a conduit may start and end beside other buildings and bend', () => {
    const l = new Lab();
    const s = l.put('bld_extractor', 2, 2);
    const b = l.put('bld_barracks', 6, 3); // input side south, outside (6,2), (7,2)
    l.link(s, 'north', b, 'south', [
      [2, 3],
      [3, 3],
      [3, 2],
      [4, 2],
      [5, 2],
      [6, 2],
    ]);
    expect(valid(l.state)).toEqual([]);
  });
});

describe('rejections, one per reason', () => {
  function base(): { l: Lab; s: number; b: number } {
    const l = new Lab();
    const s = l.put('bld_extractor', 2, 2);
    const b = l.put('bld_barracks', 2, 6);
    return { l, s, b };
  }
  const column: Pairs = [
    [2, 3],
    [2, 4],
    [2, 5],
  ];

  test('unknown_building', () => {
    const { l, s, b } = base();
    expect(l.why(99, 'north', b, 'south', column)).toBe('unknown_building');
    expect(l.why(s, 'north', 99, 'south', column)).toBe('unknown_building');
    // A stashed (not placed) building is unknown too.
    const st = addToStash(l.state, content, {
      def: 'bld_barracks',
      tier: 1,
      owner: 0,
    });
    if (!st.ok) throw new Error('stash');
    l.state = st.state;
    expect(l.why(s, 'north', st.id, 'south', column)).toBe('unknown_building');
  });

  test('not_an_output / not_an_input: wrong sides and wrong kinds', () => {
    const { l, s, b } = base();
    expect(l.why(s, 'south', b, 'south', column)).toBe('not_an_output');
    expect(l.why(s, 'up', b, 'south', column)).toBe('not_an_output');
    expect(l.why(b, 'north', b, 'south', column)).toBe('not_an_output'); // consumers have no output
    expect(l.why(s, 'north', b, 'north', column)).toBe('not_an_input');
    expect(l.why(s, 'north', s, 'south', column)).toBe('not_an_input'); // sources have no input
    // from is checked before to
    expect(l.why(s, 'east', b, 'north', column)).toBe('not_an_output');
    const w = l.put('bld_wall', 8, 8);
    const g = l.put('bld_gate', 9, 8);
    for (const id of [w, g]) {
      expect(l.why(id, 'north', b, 'south', column)).toBe('not_an_output');
      expect(l.why(s, 'north', id, 'south', column)).toBe('not_an_input');
    }
    // Rotation moves the sides: the extractor rotated 90 outputs east.
    const r = l.put('bld_extractor', 12, 2, 90);
    expect(l.why(r, 'north', b, 'south', column)).toBe('not_an_output');
  });

  test('not_an_output for the Core: it is not a building instance', () => {
    const { l, b } = base();
    const c = placeCore(l.state, content, config, { x: 8, y: 4 });
    if (!c.ok) throw new Error(c.reason);
    l.state = c.state;
    expect(l.why(0, 'north', b, 'south', column)).toBe('unknown_building');
  });

  test('side_in_use: an output or an input side holds one conduit', () => {
    const { l, s, b } = base();
    const b2 = l.put('bld_barracks', 8, 6);
    const s2 = l.put('bld_extractor', 12, 2);
    l.link(s, 'north', b, 'south', column);
    // Same output, other consumer (cells are not even looked at yet).
    expect(l.why(s, 'north', b2, 'south', [])).toBe('side_in_use');
    // Same input side, other source and the other edge of that side.
    expect(
      l.why(s2, 'north', b, 'south', [
        [12, 3],
        [3, 3],
      ]),
    ).toBe('side_in_use');
  });

  test('invalid_path', () => {
    const { l, s, b } = base();
    const bad = (cells: Pairs): string => l.why(s, 'north', b, 'south', cells);
    expect(bad([])).toBe('invalid_path'); // sides do not face
    expect(
      bad([
        [3, 3],
        [3, 4],
        [3, 5],
      ]),
    ).toBe('invalid_path'); // starts beside, not outside, the from edge
    expect(
      bad([
        [2, 3],
        [2, 4],
      ]),
    ).toBe('invalid_path'); // ends short of the to edge
    expect(
      bad([
        [2, 3],
        [2, 5],
      ]),
    ).toBe('invalid_path'); // not adjacent
    expect(
      bad([
        [2, 3],
        [3, 3],
        [2, 3],
        [2, 4],
        [2, 5],
      ]),
    ).toBe('invalid_path'); // repeat
    expect(
      bad([
        [2, 3],
        [2, 4],
        [2, 5],
        [2, 6],
      ]),
    ).toBe('invalid_path'); // goes on past the edge
    expect(
      bad([
        [2, 3],
        [2, -1],
      ]),
    ).toBe('invalid_path'); // out of bounds
    expect(
      bad([
        [2, 3],
        [2, 4],
        [2, 5],
        [24, 5],
      ]),
    ).toBe('invalid_path');
    // Raw, malformed cells.
    for (const cells of [[{ x: 1.5, y: 3 }], 'nope', null, [{ x: 2 }]]) {
      const r = addConduit(l.state, content, {
        from: { building: s, side: 'north' },
        to: { building: b, side: 'south' },
        cells: cells as unknown as Cell[],
      });
      expect(r).toMatchObject({ ok: false, reason: 'invalid_path' });
    }
  });

  test('invalid_path: direct connection is required, and only direct', () => {
    const l = new Lab();
    const s = l.put('bld_extractor', 2, 2);
    const b = l.put('bld_barracks', 2, 3);
    // They face each other: a path (even a "valid-looking" one) is refused.
    expect(l.why(s, 'north', b, 'south', [[2, 3]])).toBe('invalid_path');
    expect(l.why(s, 'north', b, 'south', [])).toBe('ACCEPTED');
  });

  test('blocked_by_feature', () => {
    const l = new Lab();
    const s = l.put('bld_extractor', 2, 2);
    const b = l.put('bld_barracks', 4, 6); // south edges are outside (4,5) (a lake) and (5,5)
    const toLake: Pairs = [
      [2, 3],
      [3, 3],
      [4, 3],
      [4, 4],
      [4, 5],
    ];
    expect(l.why(s, 'north', b, 'south', toLake)).toBe('blocked_by_feature');
    const ok: Pairs = [
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
      [5, 4],
      [5, 5],
    ];
    expect(l.why(s, 'north', b, 'south', ok)).toBe('ACCEPTED');
  });

  test('overlaps_building and overlaps_core', () => {
    const { l, s, b } = base();
    const w = l.put('bld_wall', 2, 4);
    expect(l.why(s, 'north', b, 'south', column)).toBe('overlaps_building');
    // The wall moves away; the Core takes that spot instead.
    const m = moveBuilding(l.state, content, {
      id: w,
      x: 8,
      y: 8,
      rotation: 0,
    });
    if (!m.ok) throw new Error(m.reason);
    const c = placeCore(m.state, content, config, { x: 2, y: 4 });
    if (!c.ok) throw new Error(c.reason);
    l.state = c.state;
    expect(l.why(s, 'north', b, 'south', column)).toBe('overlaps_core');
  });

  test('crosses_conduit: conduits never share a cell', () => {
    const { l, s, b } = base();
    const p = l.put('bld_splitter', 1, 4);
    const t = l.put('bld_turret', 4, 4, 90); // input on its west side, outside (3,4)
    l.link(s, 'north', b, 'south', column);
    // p's east output starts at (2,4), which the first conduit already holds.
    expect(
      l.why(p, 'east', t, 'west', [
        [2, 4],
        [3, 4],
      ]),
    ).toBe('crosses_conduit');
    expect(valid(l.state)).toEqual([]);
  });

  test('crossing a conduit is only possible through a crossover', () => {
    const l = new Lab();
    const s = l.put('bld_extractor', 2, 2);
    const x = l.put('bld_crossover', 2, 3);
    const b = l.put('bld_barracks', 2, 4);
    l.link(s, 'north', x, 'south');
    l.link(x, 'north', b, 'south');
    expect(valid(l.state)).toEqual([]);
  });

  test('check order: the first failing rule is reported', () => {
    const l = new Lab();
    const s = l.put('bld_extractor', 2, 2);
    const b = l.put('bld_barracks', 4, 6);
    l.put('bld_wall', 3, 3);
    // Wall (overlaps_building) and lake (blocked_by_feature): the feature wins.
    expect(
      l.why(s, 'north', b, 'south', [
        [2, 3],
        [3, 3],
        [4, 3],
        [4, 4],
        [4, 5],
      ]),
    ).toBe('blocked_by_feature');
    // Wrong side and a garbage path: the side wins.
    expect(l.why(s, 'south', b, 'south', [[9, 9]])).toBe('not_an_output');
    // Unknown building and a wrong side: unknown wins.
    expect(l.why(77, 'south', b, 'north', [])).toBe('unknown_building');
    // A busy side and a garbage path: side_in_use wins.
    const c = l.put('bld_barracks', 2, 12);
    const first = l.try(s, 'north', c, 'south', [
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
      [2, 7],
      [2, 8],
      [2, 9],
      [2, 10],
      [2, 11],
    ]);
    expect(first.ok).toBe(true);
    expect(l.why(s, 'north', b, 'south', [[0, 0]])).toBe('side_in_use');
  });
});

describe('resource typing', () => {
  test('a source conduit carries its node resource', () => {
    const l = new Lab();
    const sb = l.put('bld_extractor', 11, 3, 90);
    const t = l.put('bld_turret', 12, 3, 90);
    const c = l.link(sb, 'east', t, 'west');
    expect(conduitResource(l.state, content, c)).toBe(B);
    expect(conduitResource(l.state, content, 999)).toBeNull();
  });

  test('a consumer rejects a determined resource it does not take', () => {
    const l = new Lab();
    const sb = l.put('bld_extractor', 11, 3, 90); // res_b
    const barracks = l.put('bld_barracks', 12, 3, 90); // takes res_a
    expect(l.why(sb, 'east', barracks, 'west')).toBe('resource_mismatch');
    expect(l.state.conduits).toEqual([]);
  });

  test('an undetermined conduit never causes a rejection; it resolves later', () => {
    const l = new Lab();
    const sa = l.put('bld_extractor', 2, 2);
    const p = l.put('bld_splitter', 2, 3);
    const b1 = l.put('bld_barracks', 2, 4);
    const down = l.link(p, 'north', b1, 'south');
    expect(conduitResource(l.state, content, down)).toBeNull();
    const feed = l.link(sa, 'north', p, 'south');
    expect(conduitResource(l.state, content, feed)).toBe(A);
    expect(conduitResource(l.state, content, down)).toBe(A);
  });

  test('connecting an upstream source last can expose a far-downstream mismatch', () => {
    const l = new Lab();
    const sa = l.put('bld_extractor', 2, 2);
    const p = l.put('bld_splitter', 2, 3);
    const t = l.put('bld_turret', 2, 4); // takes res_b
    l.link(p, 'north', t, 'south');
    expect(l.why(sa, 'north', p, 'south')).toBe('resource_mismatch');
    expect(l.state.conduits).toHaveLength(1);
  });

  /** M (merger) fed by splitters P1 (west) and P2 (east), M feeds a barracks. */
  function mergerBoard(): {
    l: Lab;
    sa: number;
    sb: number;
    p1: number;
    p2: number;
    m: number;
    bm: number;
  } {
    const l = new Lab();
    const sa = l.put('bld_extractor', 2, 2);
    const sb = l.put('bld_extractor', 11, 3, 90);
    const p1 = l.put('bld_splitter', 5, 8);
    const m = l.put('bld_merger', 6, 8);
    const p2 = l.put('bld_splitter', 7, 8, 180);
    const bm = l.put('bld_barracks', 5, 9);
    l.link(p1, 'east', m, 'west');
    l.link(p2, 'west', m, 'east');
    return { l, sa, sb, p1, p2, m, bm };
  }
  const pathA: Pairs = [
    [2, 3],
    [2, 4],
    [2, 5],
    [2, 6],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
  ];
  const pathB: Pairs = [
    [12, 3],
    [12, 4],
    [12, 5],
    [12, 6],
    [12, 7],
    [12, 8],
    [12, 9],
    [11, 9],
    [10, 9],
    [9, 9],
    [8, 9],
    [7, 9],
  ];

  test('a merger rejects two different determined resources, found when a source is connected last', () => {
    const { l, sa, sb, p1, p2 } = mergerBoard();
    expect(l.why(sa, 'north', p1, 'south', pathA)).toBe('ACCEPTED'); // merger sees only res_a
    expect(l.why(sb, 'east', p2, 'north', pathB)).toBe('resource_mismatch');
    expect(valid(l.state)).toEqual([]);
  });

  test('a merger takes the same resource on two inputs', () => {
    const { l, sa, p1, p2, m } = mergerBoard();
    const sa2 = l.put('bld_extractor', 12, 2);
    expect(l.why(sa, 'north', p1, 'south', pathA)).toBe('ACCEPTED');
    // second res_a source into the east splitter
    expect(
      l.why(sa2, 'north', p2, 'north', [
        [12, 3],
        [12, 4],
        [12, 5],
        [12, 6],
        [12, 7],
        [12, 8],
        [12, 9],
        [11, 9],
        [10, 9],
        [9, 9],
        [8, 9],
        [7, 9],
      ]),
    ).toBe('ACCEPTED');
    const out = l.state.conduits.find((c) => c.from.building === m);
    expect(out).toBeUndefined(); // merger output not connected yet
  });

  test('a mismatch downstream of a merger appears when the source is connected last', () => {
    const { l, sb, p2, m, bm } = mergerBoard();
    l.link(m, 'north', bm, 'south'); // undetermined so far
    expect(l.why(sb, 'east', p2, 'north', pathB)).toBe('resource_mismatch'); // res_b into a res_a consumer
  });

  test('a crossover carries two resources through one building without mixing', () => {
    const { lab: l, ids } = sampleBoard();
    const x = ids[6];
    const byFrom = (building: number, side: string): number => {
      const c = l.state.conduits.find(
        (k) => k.from.building === building && k.from.side === side,
      );
      if (c === undefined) throw new Error('no conduit');
      return c.id;
    };
    expect(
      conduitResource(l.state, content, byFrom(x as number, 'north')),
    ).toBe(A);
    expect(conduitResource(l.state, content, byFrom(x as number, 'east'))).toBe(
      B,
    );
    const graph = buildFlowGraph(l.state, content);
    const north = graph.edges.find((e) => e.from === `${String(x)}.south`);
    const east = graph.edges.find((e) => e.from === `${String(x)}.west`);
    expect(north?.resource).toBe(A);
    expect(east?.resource).toBe(B);
  });

  test('crossover channels never mix: wrong consumers on each output are rejected', () => {
    const l = new Lab();
    const sa = l.put('bld_extractor', 12, 2);
    const sb = l.put('bld_extractor', 11, 3, 90);
    const x = l.put('bld_crossover', 12, 3);
    l.link(sa, 'north', x, 'south');
    l.link(sb, 'east', x, 'west');
    const wrongNorth = l.put('bld_turret', 12, 4); // north channel carries res_a
    const wrongEast = l.put('bld_barracks', 13, 3, 90); // east channel carries res_b
    expect(l.why(x, 'north', wrongNorth, 'south')).toBe('resource_mismatch');
    expect(l.why(x, 'east', wrongEast, 'west')).toBe('resource_mismatch');
  });

  test('a crossover output stays undetermined while only the other channel is fed', () => {
    const l = new Lab();
    const sb = l.put('bld_extractor', 11, 3, 90);
    const x = l.put('bld_crossover', 12, 3);
    const b3 = l.put('bld_barracks', 12, 4);
    const t = l.put('bld_turret', 13, 3, 90);
    l.link(sb, 'east', x, 'west');
    const north = l.link(x, 'north', b3, 'south');
    const east = l.link(x, 'east', t, 'west');
    expect(conduitResource(l.state, content, north)).toBeNull();
    expect(conduitResource(l.state, content, east)).toBe(B);
  });
});

describe('loops', () => {
  test('a loop through two splitters and a merger is rejected', () => {
    const l = new Lab();
    const m = l.put('bld_merger', 5, 6);
    const p1 = l.put('bld_splitter', 5, 7);
    const p2 = l.put('bld_splitter', 8, 7, 90); // input west, outputs east, south, north
    l.link(m, 'north', p1, 'south');
    l.link(p1, 'east', p2, 'west', [
      [6, 7],
      [7, 7],
    ]);
    expect(
      l.why(p2, 'south', m, 'east', [
        [8, 6],
        [7, 6],
        [6, 6],
      ]),
    ).toBe('would_loop');
    expect(valid(l.state)).toEqual([]);
  });

  test('a building cannot feed itself', () => {
    const l = new Lab();
    const p = l.put('bld_splitter', 5, 7);
    expect(
      l.why(p, 'west', p, 'south', [
        [4, 7],
        [4, 6],
        [5, 6],
      ]),
    ).toBe('would_loop');
  });

  test('a flow through both channels of a crossover is no loop; through one channel twice is', () => {
    const l = new Lab();
    const x = l.put('bld_crossover', 15, 8);
    const p = l.put('bld_splitter', 15, 9);
    l.link(x, 'north', p, 'south');
    // north output -> splitter -> west input: channel S->N feeds channel W->E.
    l.link(p, 'west', x, 'west', [
      [14, 9],
      [14, 8],
    ]);
    // channel W->E (east output) back into the south input closes a cycle.
    expect(
      l.why(x, 'east', x, 'south', [
        [16, 8],
        [16, 7],
        [15, 7],
      ]),
    ).toBe('would_loop');
    // So does the S->N channel feeding itself.
    const l2 = new Lab();
    const x2 = l2.put('bld_crossover', 15, 8);
    const p2 = l2.put('bld_splitter', 15, 9);
    l2.link(x2, 'north', p2, 'south');
    expect(
      l2.why(p2, 'west', x2, 'south', [
        [14, 9],
        [14, 8],
        [14, 7],
        [15, 7],
      ]),
    ).toBe('would_loop');
  });

  test('two unrelated flows crossing one crossover are not a loop', () => {
    const { lab: l } = sampleBoard();
    expect(valid(l.state)).toEqual([]);
  });
});

describe('placement and detaching', () => {
  test('placing or moving a building onto a conduit cell is rejected', () => {
    const { lab: l, ids } = sampleBoard();
    const [, , b1] = ids;
    // Conduit 12 lies on (3,3), (4,3), (5,3).
    const wall = addToStash(l.state, content, {
      def: 'bld_wall',
      tier: 1,
      owner: 0,
    });
    if (!wall.ok) throw new Error('stash');
    expect(
      placeFromStash(wall.state, content, {
        id: wall.id,
        x: 4,
        y: 3,
        rotation: 0,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'overlaps_conduit',
    });
    expect(
      placeFromStash(wall.state, content, {
        id: wall.id,
        x: 4,
        y: 7,
        rotation: 0,
      }).ok,
    ).toBe(true);
    // b1 (not attached to conduit 12) cannot move onto it.
    expect(
      moveBuilding(l.state, content, {
        id: b1 as number,
        x: 4,
        y: 2,
        rotation: 0,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'overlaps_conduit',
    });
    // A rejected move detaches nothing.
    expect(l.state.conduits).toHaveLength(7);
  });

  test('placeCore refuses a conduit cell', () => {
    const { lab: l } = sampleBoard();
    expect(placeCore(l.state, content, config, { x: 4, y: 2 })).toMatchObject({
      ok: false,
      reason: 'overlaps_conduit',
    });
    expect(placeCore(l.state, content, config, { x: 8, y: 4 }).ok).toBe(true);
  });

  test('a building may move onto cells of its own, detached, conduits', () => {
    const { lab: l, ids } = sampleBoard();
    const b2 = ids[3] as number;
    const r = moveBuilding(l.state, content, {
      id: b2,
      x: 4,
      y: 3,
      rotation: 0,
    }); // covers (4,3), (5,3)
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.conduits.map((c) => c.id)).toEqual([
        10, 11, 13, 14, 15, 16,
      ]);
      expect(valid(r.state)).toEqual([]);
    }
  });

  test('moving removes exactly the conduits attached to the building', () => {
    const { lab: l, ids } = sampleBoard();
    const x = ids[6] as number;
    const r = moveBuilding(l.state, content, {
      id: x,
      x: 15,
      y: 12,
      rotation: 0,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.conduits.map((c) => c.id)).toEqual([10, 11, 12]);
    expect(valid(r.state)).toEqual([]);
    // Rotating in place also detaches.
    const p = ids[1] as number;
    const pb = l.state.buildings.find((b) => b.id === p);
    const rot = moveBuilding(l.state, content, {
      id: p,
      x: pb?.x ?? 0,
      y: pb?.y ?? 0,
      rotation: 90,
    });
    if (!rot.ok) throw new Error(rot.reason);
    expect(rot.state.conduits.map((c) => c.id)).toEqual([13, 14, 15, 16]);
  });

  test('returning to the stash removes exactly the conduits attached to the building', () => {
    const { lab: l, ids } = sampleBoard();
    const p = ids[1] as number;
    const r = returnToStash(l.state, content, { id: p });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.conduits.map((c) => c.id)).toEqual([13, 14, 15, 16]);
    expect(r.state.stash.map((s) => s.id)).toEqual([p]);
    expect(valid(r.state)).toEqual([]);
  });

  test('detachConduits and eraseConduit', () => {
    const { lab: l, ids } = sampleBoard();
    expect(detachConduits(l.state, 9999)).toBe(l.state);
    const sa1 = ids[0] as number;
    expect(detachConduits(l.state, sa1).conduits.map((c) => c.id)).toEqual([
      11, 12, 13, 14, 15, 16,
    ]);
    const e = eraseConduit(l.state, { id: 12 });
    if (!e.ok) throw new Error(e.reason);
    expect(e.state.conduits.map((c) => c.id)).toEqual([10, 11, 13, 14, 15, 16]);
    expect(e.state.nextId).toBe(l.state.nextId);
    expect(eraseConduit(e.state, { id: 12 })).toEqual({
      ok: false,
      reason: 'unknown_conduit',
    });
    // The ID is never reused.
    const again = addConduit(e.state, content, {
      from: { building: ids[1] as number, side: 'east' },
      to: { building: ids[3] as number, side: 'south' },
      cells: cellsOf([
        [3, 3],
        [4, 3],
        [5, 3],
      ]),
    });
    expect(again).toMatchObject({ ok: true, id: l.state.nextId });
  });
});

describe('flow graph', () => {
  const expected: FlowGraph = {
    nodes: [
      {
        key: '1',
        building: 1,
        channel: null,
        def: 'bld_extractor',
        kind: 'source',
        produces: A,
        inputs: [],
        outputs: [{ side: 'north', conduit: 10 }],
      },
      {
        key: '2',
        building: 2,
        channel: null,
        def: 'bld_splitter',
        kind: 'splitter',
        produces: null,
        inputs: [{ side: 'south', conduit: 10, requires: null }],
        outputs: [
          { side: 'north', conduit: 11 },
          { side: 'east', conduit: 12 },
          { side: 'west', conduit: null },
        ],
      },
      {
        key: '3',
        building: 3,
        channel: null,
        def: 'bld_barracks',
        kind: 'consumer',
        produces: null,
        inputs: [{ side: 'south', conduit: 11, requires: A }],
        outputs: [],
      },
      {
        key: '4',
        building: 4,
        channel: null,
        def: 'bld_barracks',
        kind: 'consumer',
        produces: null,
        inputs: [{ side: 'south', conduit: 12, requires: A }],
        outputs: [],
      },
      {
        key: '5',
        building: 5,
        channel: null,
        def: 'bld_extractor',
        kind: 'source',
        produces: A,
        inputs: [],
        outputs: [{ side: 'north', conduit: 13 }],
      },
      {
        key: '6',
        building: 6,
        channel: null,
        def: 'bld_extractor',
        kind: 'source',
        produces: B,
        inputs: [],
        outputs: [{ side: 'east', conduit: 14 }],
      },
      {
        key: '7.south',
        building: 7,
        channel: 'south',
        def: 'bld_crossover',
        kind: 'crossover',
        produces: null,
        inputs: [{ side: 'south', conduit: 13, requires: null }],
        outputs: [{ side: 'north', conduit: 15 }],
      },
      {
        key: '7.west',
        building: 7,
        channel: 'west',
        def: 'bld_crossover',
        kind: 'crossover',
        produces: null,
        inputs: [{ side: 'west', conduit: 14, requires: null }],
        outputs: [{ side: 'east', conduit: 16 }],
      },
      {
        key: '8',
        building: 8,
        channel: null,
        def: 'bld_barracks',
        kind: 'consumer',
        produces: null,
        inputs: [{ side: 'south', conduit: 15, requires: A }],
        outputs: [],
      },
      {
        key: '9',
        building: 9,
        channel: null,
        def: 'bld_turret',
        kind: 'consumer',
        produces: null,
        inputs: [{ side: 'west', conduit: 16, requires: B }],
        outputs: [],
      },
    ],
    edges: [
      {
        conduitId: 10,
        from: '1',
        to: '2',
        fromSide: 'north',
        toSide: 'south',
        length: 0,
        resource: A,
      },
      {
        conduitId: 11,
        from: '2',
        to: '3',
        fromSide: 'north',
        toSide: 'south',
        length: 0,
        resource: A,
      },
      {
        conduitId: 12,
        from: '2',
        to: '4',
        fromSide: 'east',
        toSide: 'south',
        length: 3,
        resource: A,
      },
      {
        conduitId: 13,
        from: '5',
        to: '7.south',
        fromSide: 'north',
        toSide: 'south',
        length: 0,
        resource: A,
      },
      {
        conduitId: 14,
        from: '6',
        to: '7.west',
        fromSide: 'east',
        toSide: 'west',
        length: 0,
        resource: B,
      },
      {
        conduitId: 15,
        from: '7.south',
        to: '8',
        fromSide: 'north',
        toSide: 'south',
        length: 0,
        resource: A,
      },
      {
        conduitId: 16,
        from: '7.west',
        to: '9',
        fromSide: 'east',
        toSide: 'west',
        length: 0,
        resource: B,
      },
    ],
    order: ['1', '2', '3', '4', '5', '6', '7.south', '7.west', '8', '9'],
  };

  test('matches a hand-written expectation', () => {
    const { lab: l } = sampleBoard();
    expect(buildFlowGraph(l.state, content)).toEqual(expected);
  });

  test('is plain data with a stable hash and does not mutate its input', () => {
    const { lab: l } = sampleBoard();
    const frozen = deepFreeze(clone(l.state));
    const g = buildFlowGraph(frozen, content);
    expect(hashJson(g)).toBe(hashJson(clone(g)));
    expect(JSON.parse(JSON.stringify(g))).toEqual(g);
  });

  test('buildings without conduits are left out; an empty board has an empty graph', () => {
    const l = new Lab();
    l.put('bld_wall', 3, 3);
    expect(buildFlowGraph(l.state, content)).toEqual({
      nodes: [],
      edges: [],
      order: [],
    });
  });

  test('a splitter lists its outputs clockwise from north at its rotation', () => {
    const l = new Lab();
    const p = l.put('bld_splitter', 8, 8, 90); // input west; outputs east, south, north
    const t1 = l.put('bld_turret', 8, 9); // above: north output
    const t2 = l.put('bld_turret', 9, 8, 90); // right: east output
    const c1 = l.link(p, 'north', t1, 'south');
    const c2 = l.link(p, 'east', t2, 'west');
    const g = buildFlowGraph(l.state, content);
    const node = g.nodes.find((n) => n.building === p);
    expect(node?.outputs).toEqual([
      { side: 'north', conduit: c1 },
      { side: 'east', conduit: c2 },
      { side: 'south', conduit: null },
    ]);
    expect(node?.inputs).toEqual([
      { side: 'west', conduit: null, requires: null },
    ]);
  });
});

describe('rendering', () => {
  test('conduit cells are drawn with *', () => {
    const { lab: l } = sampleBoard();
    const lines = renderTeamStateAscii(l.state, content).split('\n');
    for (const [x, y] of [
      [3, 3],
      [4, 3],
      [5, 3],
    ]) {
      expect(lines[lab.height - 1 - (y as number)]?.[x as number]).toBe('*');
    }
    expect(lines[lines.length - 1]).toContain('*=conduit');
  });
});

describe('validateTeamState and conduits', () => {
  const good = (): TeamState => sampleBoard().lab.state;
  type J = {
    nextId: number;
    buildings: { id: number; def: string }[];
    conduits: {
      id: number;
      from: { building: number; side: string };
      to: { building: number; side: string };
      cells: { x: number; y: number }[];
    }[];
  };
  const mutated = (fn: (j: J) => void): string[] => {
    const j = clone(good()) as unknown as J;
    fn(j);
    return valid(j);
  };
  const has = (errors: string[], text: string): void => {
    expect(errors.some((e) => e.includes(text))).toBe(true);
  };

  test('accepts a good network', () => {
    expect(valid(good())).toEqual([]);
  });

  test('flags every kind of broken conduit', () => {
    has(
      mutated((j) => {
        got(j.conduits[0]).from.building = 999;
      }),
      'unknown_building',
    );
    has(
      mutated((j) => {
        got(j.conduits[0]).from.side = 'south';
      }),
      'not_an_output',
    );
    has(
      mutated((j) => {
        got(j.conduits[0]).to.side = 'north';
      }),
      'not_an_input',
    );
    has(
      mutated((j) => {
        got(j.conduits[2]).cells.pop();
      }),
      'invalid_path',
    );
    has(
      mutated((j) => {
        got(j.conduits[2]).cells = [
          { x: 3, y: 3 },
          { x: 4, y: 3 },
          { x: 4, y: 4 },
          { x: 5, y: 4 },
          { x: 5, y: 3 },
        ];
      }),
      'overlaps_building',
    );
    has(
      mutated((j) => {
        got(j.conduits[2]).cells = [
          { x: 3, y: 3 },
          { x: 4, y: 3 },
          { x: 5, y: 3 },
          { x: 5, y: 3 },
        ];
      }),
      'invalid_path',
    );
    // A second conduit on the same output side: both are flagged.
    has(
      mutated((j) => {
        const c = clone(got(j.conduits[1]));
        c.id = 20;
        j.nextId = 21;
        j.conduits.push(c);
      }),
      'side_in_use',
    );
    // A conduit sharing a cell with another.
    const l = new Lab();
    const s0 = l.put('bld_extractor', 2, 2);
    const b0 = l.put('bld_barracks', 2, 6);
    const p0 = l.put('bld_splitter', 1, 4);
    const t0 = l.put('bld_turret', 4, 4, 90);
    l.link(s0, 'north', b0, 'south', [
      [2, 3],
      [2, 4],
      [2, 5],
    ]);
    const j = clone(l.state) as unknown as J;
    j.conduits.push({
      id: j.nextId,
      from: { building: p0, side: 'east' },
      to: { building: t0, side: 'west' },
      cells: [
        { x: 2, y: 4 },
        { x: 3, y: 4 },
      ],
    });
    j.nextId += 1;
    has(valid(j), 'crosses_conduit');
    // On the lake.
    has(
      mutated((j) => {
        got(j.conduits[2]).cells = [{ x: 4, y: 5 }];
      }),
      'invalid_path',
    );
  });

  test('flags id, order and nextId problems', () => {
    has(
      mutated((j) => {
        got(j.conduits[0]).id = 1;
      }),
      'duplicate instance ID 1',
    );
    has(
      mutated((j) => {
        got(j.conduits[1]).id = 10;
      }),
      'duplicate instance ID 10',
    );
    has(
      mutated((j) => {
        j.conduits.reverse();
      }),
      'not sorted',
    );
    has(
      mutated((j) => {
        j.nextId = 16;
      }),
      'nextId',
    );
    has(
      mutated((j) => {
        got(j.conduits[0]).id = 0;
      }),
      '"id" must be a positive integer',
    );
  });

  test('flags a resource mismatch and a loop in stored data', () => {
    has(
      mutated((j) => {
        got(j.buildings.find((b) => b.id === 8)).def = 'bld_turret';
      }),
      'resource_mismatch',
    );
    const l = new Lab();
    const m = l.put('bld_merger', 5, 6);
    const p1 = l.put('bld_splitter', 5, 7);
    const p2 = l.put('bld_splitter', 8, 7, 90);
    l.link(m, 'north', p1, 'south');
    l.link(p1, 'east', p2, 'west', [
      [6, 7],
      [7, 7],
    ]);
    const j = clone(l.state) as unknown as J;
    j.conduits.push({
      id: j.nextId,
      from: { building: p2, side: 'south' },
      to: { building: m, side: 'east' },
      cells: [
        { x: 8, y: 6 },
        { x: 7, y: 6 },
        { x: 6, y: 6 },
      ],
    });
    j.nextId += 1;
    has(valid(j), 'would_loop');
  });

  test('never throws on hostile conduits', () => {
    const hostile: unknown[] = [
      null,
      5,
      'x',
      {},
      [null],
      [5],
      [{}],
      [{ id: 'a' }],
      [[]],
      [{ id: 1, from: null, to: null, cells: null }],
      [
        {
          id: 1,
          from: { building: 1, side: 'up' },
          to: { building: 2, side: 'north' },
          cells: [],
        },
      ],
      [
        {
          id: 1,
          from: { building: 1, side: 'north' },
          to: { building: 2, side: 'south' },
          cells: [{ x: 1.5, y: 2 }],
          extra: 1,
        },
      ],
      [
        {
          id: 1,
          from: { building: 1, side: 'north' },
          to: { building: 1, side: 'north' },
          cells: [{ x: 1e300, y: -5 }],
        },
      ],
    ];
    for (const conduits of hostile) {
      const j = { ...clone(good()), conduits } as unknown;
      expect(() => validateTeamState(j, content, config)).not.toThrow();
      expect(valid(j).length).toBeGreaterThan(0);
    }
  });

  test('random corruption never throws', () => {
    const rng = Rng.fromSeed(99);
    const base = clone(good()) as unknown as Record<string, unknown>;
    const junk = [null, -1, 0, 1.5, 'north', [], {}, 1e9, true];
    for (let i = 0; i < 300; i++) {
      const j = clone(base) as unknown as {
        conduits: Record<string, unknown>[];
      };
      const c = got(j.conduits[rng.nextInt(j.conduits.length)]);
      const keys = ['id', 'from', 'to', 'cells'];
      c[got(keys[rng.nextInt(4)])] = junk[rng.nextInt(junk.length)];
      expect(() => validateTeamState(j, content, config)).not.toThrow();
    }
  });
});

describe('purity', () => {
  test('operations never mutate frozen inputs', () => {
    const { lab: l, ids } = sampleBoard();
    const s = deepFreeze(clone(l.state));
    expect(() => {
      addConduit(s, content, {
        from: { building: ids[1] as number, side: 'west' },
        to: { building: ids[2] as number, side: 'south' },
        cells: [],
      });
      eraseConduit(s, { id: 12 });
      detachConduits(s, ids[1] as number);
      buildFlowGraph(s, content);
      conduitResource(s, content, 10);
      moveBuilding(s, content, {
        id: ids[6] as number,
        x: 15,
        y: 12,
        rotation: 0,
      });
      returnToStash(s, content, { id: ids[1] as number });
      renderTeamStateAscii(s, content);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Property test

/** A shortest free path between the cells outside two sides, or null. */
function route(
  state: TeamState,
  from: Cell[],
  to: Cell[],
  occ: ReturnType<typeof occupancy>,
  used: Set<number>,
  blocked: (x: number, y: number) => boolean,
): Cell[] | null {
  const { width, height } = state.map;
  const free = (c: Cell): boolean =>
    c.x >= 0 &&
    c.y >= 0 &&
    c.x < width &&
    c.y < height &&
    occ.buildingAt(c.x, c.y) === null &&
    !used.has(c.y * width + c.x) &&
    !blocked(c.x, c.y);
  const goal = new Set(to.map((c) => c.y * width + c.x));
  const prev = new Map<number, number>();
  const queue: Cell[] = [];
  for (const c of from) {
    if (free(c) && !prev.has(c.y * width + c.x)) {
      prev.set(c.y * width + c.x, -1);
      queue.push(c);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] as Cell;
    const k = c.y * width + c.x;
    if (goal.has(k)) {
      const out: Cell[] = [];
      for (let at = k; at !== -1; at = prev.get(at) as number) {
        out.push({ x: at % width, y: Math.floor(at / width) });
      }
      return out.reverse();
    }
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as const) {
      const n = { x: c.x + dx, y: c.y + dy };
      const nk = n.y * width + n.x;
      if (free(n) && !prev.has(nk)) {
        prev.set(nk, k);
        queue.push(n);
      }
    }
  }
  return null;
}

describe('property: random operations', () => {
  test('state stays valid, rejections change nothing, the flow graph is orderable', () => {
    const defs = content.buildings
      .list()
      .filter((b) => b.kind !== 'core')
      .map((b) => b.id);
    const reasons = new Map<string, number>();
    let acceptedConduits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const partySize = 1 + (seed % 3);
      const m = generateMap(seed, partySize, content, config);
      const rng = Rng.fromSeed(seed * 104729);
      let s = deepFreeze(createTeamState(m));
      const legal = listLegalCorePositions(m, content, config);
      const core = placeCore(
        s,
        content,
        config,
        legal[rng.nextInt(legal.length)] as Cell,
      );
      if (!core.ok) throw new Error(core.reason);
      s = deepFreeze(core.state);
      const accept = (
        r: { ok: true; state: TeamState } | { ok: false; reason: string },
        before: TeamState,
      ): void => {
        if (r.ok) {
          expect(valid(r.state)).toEqual([]);
          const g = buildFlowGraph(r.state, content);
          const at = new Map(g.order.map((k, i) => [k, i]));
          expect(g.order).toHaveLength(g.nodes.length);
          for (const e of g.edges) {
            expect(at.get(e.from) as number).toBeLessThan(
              at.get(e.to) as number,
            );
          }
          s = deepFreeze(r.state);
        } else {
          reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
          expect(before).toEqual(s);
        }
      };
      for (let step = 0; step < 200; step++) {
        const before = clone(s);
        const pick = rng.nextInt(12);
        const nodePos = (): Cell => {
          const n = m.nodes[rng.nextInt(m.nodes.length)] as Cell;
          return { x: n.x, y: n.y };
        };
        const anyPos = (): Cell => ({
          x: rng.nextInt(m.width),
          y: rng.nextInt(m.height),
        });
        const rot = (): number => [0, 90, 180, 270][rng.nextInt(4)] as number;
        if (pick <= 2) {
          accept(
            addToStash(s, content, {
              def: defs[rng.nextInt(defs.length)] as string,
              tier: 1 + rng.nextInt(3),
              owner: rng.nextInt(partySize),
            }),
            before,
          );
        } else if (pick <= 4 && s.stash.length > 0) {
          const e = s.stash[rng.nextInt(s.stash.length)];
          const p = rng.nextInt(2) === 0 ? nodePos() : anyPos();
          accept(
            placeFromStash(s, content, {
              id: e?.id ?? 0,
              x: p.x,
              y: p.y,
              rotation: rot(),
            }),
            before,
          );
        } else if (pick === 5 && s.buildings.length > 0) {
          const e = s.buildings[rng.nextInt(s.buildings.length)];
          const p = anyPos();
          accept(
            moveBuilding(s, content, {
              id: e?.id ?? 0,
              x: p.x,
              y: p.y,
              rotation: rot(),
            }),
            before,
          );
        } else if (pick === 6 && s.buildings.length > 0) {
          const e = s.buildings[rng.nextInt(s.buildings.length)];
          accept(returnToStash(s, content, { id: e?.id ?? 0 }), before);
        } else if (pick === 7 && s.conduits.length > 0) {
          const c = s.conduits[rng.nextInt(s.conduits.length)];
          accept(eraseConduit(s, { id: c?.id ?? 0 }), before);
        } else if (pick === 8) {
          accept(
            eraseConduit(s, { id: 1 + rng.nextInt(s.nextId + 2) }),
            before,
          );
        } else if (s.buildings.length >= 2) {
          // Try to wire two buildings along a real path (sometimes a garbage side).
          const occ = occupancy(s, content);
          const a = got(s.buildings[rng.nextInt(s.buildings.length)]);
          const b = got(s.buildings[rng.nextInt(s.buildings.length)]);
          const outs = occ.absoluteSides(a).outputs;
          const ins = occ.absoluteSides(b).inputs;
          if (outs.length === 0 || ins.length === 0) continue;
          const fromSide = outs[rng.nextInt(outs.length)] as Side;
          const toSide = got(ins[rng.nextInt(ins.length)]).side;
          const edge = (id: number, side: Side): Cell[] => {
            const bb = got(s.buildings.find((x) => x.id === id));
            const cells = occ.cellsOf(bb);
            const xs = cells.map((c) => c.x);
            const ys = cells.map((c) => c.y);
            const [x0, x1, y0, y1] = [
              Math.min(...xs),
              Math.max(...xs),
              Math.min(...ys),
              Math.max(...ys),
            ];
            const out: Cell[] = [];
            if (side === 'north')
              for (let x = x0; x <= x1; x++) out.push({ x, y: y1 + 1 });
            if (side === 'south')
              for (let x = x0; x <= x1; x++) out.push({ x, y: y0 - 1 });
            if (side === 'east')
              for (let y = y0; y <= y1; y++) out.push({ x: x1 + 1, y });
            if (side === 'west')
              for (let y = y0; y <= y1; y++) out.push({ x: x0 - 1, y });
            return out;
          };
          const used = new Set<number>();
          for (const c of s.conduits)
            for (const k of c.cells) used.add(k.y * m.width + k.x);
          const pathCells = route(
            s,
            edge(a.id, fromSide),
            edge(b.id, toSide),
            occ,
            used,
            (x, y) => {
              const f = m.features.some((q) => q.x === x && q.y === y);
              return f;
            },
          );
          const r = addConduit(s, content, {
            from: {
              building: a.id,
              side: rng.nextInt(20) === 0 ? 'nowhere' : fromSide,
            },
            to: { building: b.id, side: toSide },
            cells: pathCells ?? (rng.nextInt(2) === 0 ? [] : [anyPos()]),
          });
          if (r.ok) acceptedConduits++;
          accept(r, before);
        }
      }
    }
    expect(acceptedConduits).toBeGreaterThan(30);
    for (const reason of [
      'would_loop',
      'resource_mismatch',
      'side_in_use',
      'invalid_path',
    ]) {
      expect(reasons.has(reason)).toBe(true);
    }
  });
});
