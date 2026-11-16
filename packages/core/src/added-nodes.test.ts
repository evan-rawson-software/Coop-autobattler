/**
 * Added nodes (Rich vein, RS-4i4): the cell rules, the cap, `allNodes`,
 * validation of a state that carries them, sources on them, and the hash of a
 * state without them.
 */
import { describe, expect, test } from 'vitest';
import {
  createBoardSim,
  createFlowContext,
  stepFlow,
  type SimEvent,
} from './flow-sim.js';
import { generateMap } from './generate-map.js';
import { canonicalJson, hashJson } from './hash.js';
import { allNodes, listLegalCorePositions, queryTeamMap } from './map.js';
import {
  addNode,
  addableNodeCells,
  addToStash,
  createTeamState,
  occupancy,
  placeCore,
  placeFromStash,
  validateTeamState,
  type TeamState,
} from './team-state.js';
import {
  Lab,
  board,
  content,
  got,
  mapgen,
  simConfig,
} from './testing/support.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const map = generateMap(7, 2, content, mapgen);
const FRONT = map.height - 1 - mapgen.frontMargin; // last allowed row

function withCores(): TeamState {
  let s = createTeamState(map);
  for (let p = 0; p < 2; p++) {
    const at = got(listLegalCorePositions(map, content, mapgen, p)[0]);
    const r = placeCore(s, content, mapgen, p, at);
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
  }
  return s;
}
const base = withCores();
const add = (
  s: TeamState,
  owner: number,
  x: number,
  y: number,
  resource = 'res_b',
  round = 3,
) => addNode(s, content, mapgen, { owner, x, y, resource, round });

function legal(s: TeamState, owner: number) {
  return addableNodeCells(s, content, mapgen, owner);
}

describe('the cap in content', () => {
  test('maxAddedNodesPerPlot is 3', () => {
    expect(mapgen.maxAddedNodesPerPlot).toBe(3);
  });
});

describe('legal cells', () => {
  test('are inside the owner plot, off the front row, free and buildable', () => {
    const cells = legal(base, 0);
    expect(cells.length).toBeGreaterThan(50);
    const q = queryTeamMap(base, content.terrain);
    const occ = occupancy(base, content);
    for (const c of cells) {
      expect(q.plotOf(c.x)).toBe(0);
      expect(c.y).toBeLessThanOrEqual(FRONT);
      expect(q.isBuildable(c.x, c.y)).toBe(true);
      expect(q.nodeAt(c.x, c.y)).toBeUndefined();
      expect(occ.buildingAt(c.x, c.y)).toBeNull();
    }
    // In (y, x) order, and the other plot has its own list.
    expect([...cells].sort((a, b) => a.y - b.y || a.x - b.x)).toEqual(cells);
    for (const c of legal(base, 1)) expect(q.plotOf(c.x)).toBe(1);
  });

  test('every legal cell is accepted and every other probed cell is refused', () => {
    const ok = new Set(
      legal(base, 0).map((c) => `${String(c.x)},${String(c.y)}`),
    );
    for (let y = -1; y <= map.height; y++) {
      for (let x = -1; x <= map.width; x++) {
        const r = add(base, 0, x, y);
        expect(r.ok, `(${String(x)}, ${String(y)})`).toBe(
          ok.has(`${String(x)},${String(y)}`),
        );
      }
    }
  });

  test('refusals name their reason', () => {
    const cells = legal(base, 0);
    const c = got(cells[0]);
    const feature = got(map.features.find((f) => f.x < map.plotWidth));
    const node = got(map.nodes.find((n) => n.x < map.plotWidth));
    const core = got(base.cores[0]) as { x: number; y: number };
    const reason = (r: ReturnType<typeof add>) => (r.ok ? 'ok' : r.reason);
    expect(reason(add(base, 0, -1, 0))).toBe('out_of_bounds');
    expect(reason(add(base, 0, map.plotWidth, c.y))).toBe('outside_own_plot');
    expect(reason(add(base, 0, c.x, map.height - 1))).toBe('front_row');
    expect(reason(add(base, 0, feature.x, feature.y))).toBe(
      'blocked_by_feature',
    );
    expect(reason(add(base, 0, node.x, node.y))).toBe('node_here');
    expect(reason(add(base, 0, core.x, core.y))).toBe('overlaps_core');
    expect(reason(add(base, 5, c.x, c.y))).toBe('invalid_owner');
    expect(reason(add(base, 0, c.x, c.y, 'res_ab_refined'))).toBe(
      'unknown_resource',
    );
    expect(reason(add(base, 0, c.x, c.y, 'res_b', 0))).toBe('invalid_round');
  });

  test('a building or a conduit on the cell refuses it', () => {
    const lab = new Lab(board([]));
    const wall = lab.put('bld_wall_block', 5, 5);
    expect(wall).toBeGreaterThan(0);
    const r = addNode(lab.state, content, mapgen, {
      owner: 0,
      x: 5,
      y: 5,
      resource: 'res_a',
      round: 3,
    });
    expect(r).toMatchObject({ ok: false, reason: 'overlaps_building' });
    const lab2 = new Lab(board([[2, 2, 'res_a']]));
    const a = lab2.put('bld_extractor', 2, 2);
    const b = lab2.put('bld_barracks', 2, 7);
    lab2.link(a, 'north', b, 'south', [
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
    ]);
    const onConduit = addNode(lab2.state, content, mapgen, {
      owner: 0,
      x: 2,
      y: 4,
      resource: 'res_a',
      round: 3,
    });
    expect(onConduit).toMatchObject({ ok: false, reason: 'overlaps_conduit' });
  });
});

describe('the cap', () => {
  test('a plot takes at most maxAddedNodesPerPlot, the other plot is unaffected', () => {
    let s = base;
    const cells = legal(s, 0);
    for (let i = 0; i < mapgen.maxAddedNodesPerPlot; i++) {
      const r = add(s, 0, got(cells[i * 9]).x, got(cells[i * 9]).y);
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
    }
    expect(s.addedNodes).toHaveLength(mapgen.maxAddedNodesPerPlot);
    expect(legal(s, 0)).toEqual([]);
    const spare = got(legal(base, 0)[1]);
    expect(add(s, 0, spare.x, spare.y)).toMatchObject({
      ok: false,
      reason: 'plot_full',
    });
    expect(legal(s, 1).length).toBeGreaterThan(0);
    const other = got(legal(s, 1)[0]);
    expect(add(s, 1, other.x, other.y).ok).toBe(true);
  });
});

describe('allNodes and the state', () => {
  test('allNodes is the generated nodes, then the added ones in order added', () => {
    expect(allNodes(base)).toBe(base.map.nodes);
    const [a, b] = legal(base, 0);
    const s1 = add(base, 0, got(a).x, got(a).y, 'res_a', 3);
    if (!s1.ok) throw new Error(s1.reason);
    const s2 = add(s1.state, 0, got(b).x, got(b).y, 'res_c', 4);
    if (!s2.ok) throw new Error(s2.reason);
    expect(allNodes(s2.state)).toEqual([
      ...map.nodes,
      { x: got(a).x, y: got(a).y, resource: 'res_a' },
      { x: got(b).x, y: got(b).y, resource: 'res_c' },
    ]);
    expect(s2.state.addedNodes?.map((n) => [n.owner, n.round])).toEqual([
      [0, 3],
      [0, 4],
    ]);
    expect(
      queryTeamMap(s2.state, content.terrain).nodeAt(got(b).x, got(b).y),
    ).toBe('res_c');
  });

  test('a state without added nodes has no field, so it keeps its hash', () => {
    expect('addedNodes' in base).toBe(false);
    expect(canonicalJson(base)).not.toContain('addedNodes');
    const c = got(legal(base, 0)[0]);
    const r = add(base, 0, c.x, c.y);
    if (!r.ok) throw new Error(r.reason);
    expect(hashJson(r.state)).not.toBe(hashJson(base));
    expect(canonicalJson(r.state)).toContain('"addedNodes"');
  });

  test('operations never mutate their input', () => {
    const c = got(legal(base, 0)[0]);
    const before = canonicalJson(base);
    add(base, 0, c.x, c.y);
    expect(canonicalJson(base)).toBe(before);
  });
});

describe('validateTeamState with added nodes', () => {
  const [c0, c1] = legal(base, 0);
  const good = (() => {
    const a = add(base, 0, got(c0).x, got(c0).y, 'res_a', 3);
    if (!a.ok) throw new Error(a.reason);
    const b = add(a.state, 0, got(c1).x, got(c1).y, 'res_c', 5);
    if (!b.ok) throw new Error(b.reason);
    return b.state;
  })();
  const check = (s: unknown) => validateTeamState(s, content, mapgen);
  const errs = (s: unknown): string => {
    const r = check(s);
    return r.ok ? '' : r.errors.join(' | ');
  };
  type Loose = { addedNodes: Record<string, unknown>[] } & Record<
    string,
    unknown
  >;
  const mutate = (f: (s: Loose) => void): Loose => {
    const s = clone(good) as unknown as Loose;
    f(s);
    return s;
  };

  test('a state with valid added nodes round-trips unchanged', () => {
    const r = check(clone(good));
    expect(r.ok).toBe(true);
    if (r.ok) expect(canonicalJson(r.state)).toBe(canonicalJson(good));
  });

  test('a state without them still validates and still has no field', () => {
    const r = check(clone(base));
    expect(r.ok).toBe(true);
    if (r.ok) expect('addedNodes' in r.state).toBe(false);
  });

  test('forged lists are rejected', () => {
    const feature = got(map.features.find((f) => f.x < map.plotWidth));
    const node = got(map.nodes.find((n) => n.x < map.plotWidth));
    const core = got(base.cores[0]) as { x: number; y: number };
    const other = got(legal(base, 1)[0]);
    const forged: [string, Loose, RegExp][] = [
      ['an empty list', mutate((s) => (s.addedNodes = [])), /non-empty/],
      [
        'on a feature',
        mutate((s) =>
          Object.assign(s.addedNodes[0] ?? {}, feature, { resource: 'res_a' }),
        ),
        /blocked_by_feature/,
      ],
      [
        'on a generated node',
        mutate((s) =>
          Object.assign(s.addedNodes[0] ?? {}, { x: node.x, y: node.y }),
        ),
        /node_here/,
      ],
      [
        'on the Core',
        mutate((s) =>
          Object.assign(s.addedNodes[0] ?? {}, { x: core.x, y: core.y }),
        ),
        /overlaps_core/,
      ],
      [
        'on the front row',
        mutate((s) =>
          Object.assign(s.addedNodes[0] ?? {}, { y: map.height - 1 }),
        ),
        /front_row/,
      ],
      [
        'in another plot',
        mutate((s) =>
          Object.assign(s.addedNodes[0] ?? {}, { x: other.x, y: other.y }),
        ),
        /outside_own_plot/,
      ],
      [
        'the same cell twice',
        mutate((s) =>
          Object.assign(s.addedNodes[1] ?? {}, {
            x: s.addedNodes[0]?.['x'],
            y: s.addedNodes[0]?.['y'],
          }),
        ),
        /node_here/,
      ],
      [
        'a refined resource',
        mutate((s) =>
          Object.assign(s.addedNodes[0] ?? {}, { resource: 'res_ab_refined' }),
        ),
        /not a base resource/,
      ],
      [
        'an unknown key',
        mutate((s) => Object.assign(s.addedNodes[0] ?? {}, { extra: 1 })),
        /unknown/i,
      ],
      [
        'a decreasing round',
        mutate((s) => Object.assign(s.addedNodes[1] ?? {}, { round: 1 })),
        /rounds must not decrease/,
      ],
      [
        'a fractional x',
        mutate((s) => Object.assign(s.addedNodes[0] ?? {}, { x: 1.5 })),
        /must be integers/,
      ],
    ];
    for (const [name, bad, re] of forged) {
      const e = errs(bad);
      expect(e, name).toMatch(re);
    }
  });

  test('more than the cap in one plot is rejected', () => {
    const cells = legal(base, 0);
    const bad = clone(base) as unknown as Record<string, unknown>;
    bad['addedNodes'] = cells
      .slice(0, mapgen.maxAddedNodesPerPlot + 1)
      .map((c) => ({ x: c.x, y: c.y, resource: 'res_a', owner: 0, round: 3 }));
    expect(errs(bad)).toMatch(/more than 3 added nodes/);
  });
});

describe('a source on an added node', () => {
  const run = (state: TeamState): { events: SimEvent[]; tick: number } => {
    const events: SimEvent[] = [];
    const sim = createBoardSim(state, content, simConfig);
    const ctx = createFlowContext(state, content, simConfig, {
      consumers: 'hold',
      events,
    });
    for (let i = 0; i < 400; i++) stepFlow(sim, ctx);
    return { events, tick: 400 };
  };
  const network = (lab: Lab): void => {
    const src = lab.put('bld_extractor', 2, 2);
    const cons = lab.put('bld_barracks', 2, 6);
    lab.link(src, 'north', cons, 'south', [
      [2, 3],
      [2, 4],
      [2, 5],
    ]);
  };

  test('can be placed there, and produces as on a generated node', () => {
    const generated = new Lab(board([[2, 2, 'res_a']]));
    network(generated);

    const added = new Lab(board([]));
    // Without the node an extractor does not fit.
    const stash = addToStash(added.state, content, {
      def: 'bld_extractor',
      tier: 1,
      owner: 0,
    });
    if (!stash.ok) throw new Error(stash.reason);
    expect(
      placeFromStash(stash.state, content, {
        actor: 0,
        id: stash.id,
        x: 2,
        y: 2,
        rotation: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'source_needs_node' });
    const r = addNode(added.state, content, mapgen, {
      owner: 0,
      x: 2,
      y: 2,
      resource: 'res_a',
      round: 3,
    });
    if (!r.ok) throw new Error(r.reason);
    added.state = r.state;
    network(added);

    const a = run(generated.state);
    const b = run(added.state);
    expect(b.events.length).toBeGreaterThan(0);
    expect(b.events).toEqual(a.events);
    expect(validateTeamState(clone(added.state), content, mapgen).ok).toBe(
      true,
    );
  });

  test('a non-source cannot be built on an added node', () => {
    const lab = new Lab(board([]));
    const r = addNode(lab.state, content, mapgen, {
      owner: 0,
      x: 4,
      y: 4,
      resource: 'res_b',
      round: 3,
    });
    if (!r.ok) throw new Error(r.reason);
    const s = addToStash(r.state, content, {
      def: 'bld_wall_block',
      tier: 1,
      owner: 0,
    });
    if (!s.ok) throw new Error(s.reason);
    expect(
      placeFromStash(s.state, content, {
        actor: 0,
        id: s.id,
        x: 4,
        y: 4,
        rotation: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'node_reserved' });
  });
});

describe('the event definition loader', () => {
  test('resourceWeights are in the shipped file and bounded by the loader', async () => {
    const { loadEvents } = await import('./events.js');
    const mk = (resourceWeights: unknown) =>
      loadEvents({
        offerCount: 1,
        events: [
          { id: 'evt_a', type: 'rich_vein', weight: 1, resourceWeights },
        ],
        modifiers: [],
      });
    expect(mk({ res_a: 3 }).ok).toBe(true);
    for (const bad of [
      {},
      [],
      { res_a: 0 },
      { res_a: 1001 },
      { res_a: 1.5 },
      { x: 1 },
    ]) {
      expect(mk(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    const names = loadEvents(
      {
        offerCount: 1,
        events: [
          {
            id: 'evt_a',
            type: 'rich_vein',
            weight: 1,
            resourceWeights: { res_ab_refined: 1 },
          },
        ],
        modifiers: [],
      },
      { resources: content.resources },
    );
    expect(names.ok).toBe(false);
  });

  test('maxAddedNodesPerPlot is bounded by the mapgen loader', async () => {
    const { loadMapgen } = await import('./mapgen.js');
    const mapgenJson = (await import('../../../content/mapgen.json')).default;
    const load = (v: unknown) =>
      loadMapgen(
        { ...mapgenJson, maxAddedNodesPerPlot: v },
        { terrain: content.terrain },
      );
    expect(load(0).ok).toBe(true);
    expect(load(16).ok).toBe(true);
    expect(load(17).ok).toBe(false);
    expect(load(-1).ok).toBe(false);
    expect(load(1.5).ok).toBe(false);
    const without: Record<string, unknown> = { ...mapgenJson };
    delete without['maxAddedNodesPerPlot'];
    expect(loadMapgen(without, { terrain: content.terrain }).ok).toBe(false);
  });
});
