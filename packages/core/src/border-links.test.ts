/**
 * Border conduit links (issue #135, PP-4): halves, joining, validation, the
 * flow graph and the flow simulation.
 */
import { describe, expect, test } from 'vitest';
import {
  addConduit,
  buildFlowGraph,
  conduitResource,
  type ConduitEndArg,
} from './conduits.js';
import {
  createBoardSim,
  createFlowContext,
  flowTotals,
  stepFlow,
  type BoardSim,
  type SimEvent,
} from './flow-sim.js';
import { Lab, board, content, simConfig, type Pairs } from './test-support.js';
import { eraseConduit, validateTeamState } from './team-state.js';
import { mapgen } from './test-support.js';

const cells = (pairs: Pairs) => pairs.map(([x, y]) => ({ x, y }));

/** Two plots of width 12: border 0 lies between x = 11 (player 0) and 12. */
function twoPlots(nodes: [number, number, string][] = [[2, 2, 'res_a']]) {
  return new Lab(board(nodes, 24, 2));
}

function row(from: number, to: number, y: number): Pairs {
  const out: Pairs = [];
  const step = from <= to ? 1 : -1;
  for (let x = from; x !== to + step; x += step) out.push([x, y]);
  return out;
}

function half(
  lab: Lab,
  actor: number,
  from: ConduitEndArg,
  to: ConduitEndArg,
  path: Pairs,
) {
  return addConduit(lab.state, content, {
    actor,
    from,
    to,
    cells: cells(path),
  });
}

/** Add a half and keep the result; throws on a refusal. */
function add(
  lab: Lab,
  actor: number,
  from: ConduitEndArg,
  to: ConduitEndArg,
  path: Pairs,
): number {
  const r = half(lab, actor, from, to, path);
  if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
  lab.state = r.state;
  return r.id;
}

const side = (building: number, s: string): ConduitEndArg => ({
  building,
  side: s,
});
const spot = (y: number, border = 0): ConduitEndArg => ({ border, y });

interface Run {
  sim: BoardSim;
  events: SimEvent[];
}

function simulate(lab: Lab, ticks: number, mode: 'hold' | 'drain'): Run {
  const events: SimEvent[] = [];
  const sim = createBoardSim(lab.state, content, simConfig);
  const ctx = createFlowContext(lab.state, content, simConfig, {
    consumers: mode,
    events,
  });
  for (let i = 0; i < ticks; i++) stepFlow(sim, ctx);
  return { sim, events };
}

const deliveredTicks = (r: Run, building: number): number[] =>
  r.events
    .filter((e) => e.type === 'delivered' && e.building === building)
    .map((e) => e.tick);

/**
 * Player 0's extractor (2,2) -> half along y = 3 to the border cell (11,3);
 * player 1's half from (12,3) to a barracks at (14,6): 10 + 5 cells.
 */
function linkedBoard(): { lab: Lab; src: number; cons: number } {
  const lab = twoPlots();
  const src = lab.put('bld_extractor', 2, 2);
  const cons = lab.put('bld_barracks', 14, 6);
  add(lab, 0, side(src, 'north'), spot(3), row(2, 11, 3));
  return { lab, src, cons };
}

function receivingPath(): Pairs {
  return [
    [12, 3],
    [13, 3],
    [14, 3],
    [14, 4],
    [14, 5],
  ];
}

const reasonOf = (r: ReturnType<typeof addConduit>): string =>
  r.ok ? 'ok' : r.reason;

describe('joining', () => {
  test('two matching halves form one link of the combined length', () => {
    const { lab, src, cons } = linkedBoard();
    // Alone the sending half is open: no edge.
    expect(buildFlowGraph(lab.state, content).edges).toEqual([]);
    const recv = add(lab, 1, spot(3), side(cons, 'south'), receivingPath());
    const graph = buildFlowGraph(lab.state, content);
    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0];
    expect(edge).toMatchObject({
      conduitId: 4,
      linkedConduit: recv,
      from: String(src),
      to: String(cons),
      fromSide: 'north',
      toSide: 'south',
      length: 15,
      resource: 'res_a',
    });
    const consumer = graph.nodes.find((n) => n.building === cons);
    expect(consumer?.inputs[0]?.conduit).toBe(recv);
    expect(conduitResource(lab.state, content, recv)).toBe('res_a');
    expect(conduitResource(lab.state, content, 4)).toBe('res_a');
  });

  test('resources arrive after the combined conduit length, like one conduit', () => {
    const { lab, cons } = linkedBoard();
    add(lab, 1, spot(3), side(cons, 'south'), receivingPath());
    const link = simulate(lab, 400, 'drain');
    // The same chain as a single 15-cell conduit on a one-plot board.
    const one = new Lab(board([[2, 2, 'res_a']], 24, 1));
    const s = one.put('bld_extractor', 2, 2);
    const c = one.put('bld_barracks', 14, 6);
    one.link(s, 'north', c, 'south', [...row(2, 11, 3), ...receivingPath()]);
    const single = simulate(one, 400, 'drain');
    expect(deliveredTicks(link, cons).length).toBeGreaterThan(5);
    expect(deliveredTicks(link, cons)).toEqual(deliveredTicks(single, c));
    expect(flowTotals(link.sim).lost).toBe(0);
  });

  test('a link also carries resources the other way', () => {
    const lab = twoPlots([[14, 2, 'res_a']]);
    const src = lab.put('bld_extractor', 14, 2);
    const cons = lab.put('bld_barracks', 2, 6);
    // Player 1 sends: (14,3) .. (12,3); player 0 receives (11,3) .. (2,5).
    add(lab, 1, side(src, 'north'), spot(3), [
      [14, 3],
      [13, 3],
      [12, 3],
    ]);
    add(lab, 0, spot(3), side(cons, 'south'), [
      [11, 3],
      [10, 3],
      [9, 3],
      [8, 3],
      [7, 3],
      [6, 3],
      [5, 3],
      [4, 3],
      [3, 3],
      [2, 3],
      [2, 4],
      [2, 5],
    ]);
    const r = simulate(lab, 300, 'drain');
    expect(deliveredTicks(r, cons).length).toBeGreaterThan(3);
    expect(flowTotals(r.sim).lost).toBe(0);
  });

  test('a link of two direct halves has length 0 and works', () => {
    const lab = twoPlots([[11, 3, 'res_a']]);
    const src = lab.put('bld_extractor', 11, 3);
    const sp = lab.put('bld_splitter', 11, 4);
    lab.link(src, 'north', sp, 'south');
    const cons = lab.put('bld_barracks', 12, 3, 90);
    add(lab, 0, side(sp, 'east'), spot(4), []);
    add(lab, 1, spot(4), side(cons, 'west'), []);
    const graph = buildFlowGraph(lab.state, content);
    const edge = graph.edges.find((e) => e.linkedConduit !== null);
    expect(edge?.length).toBe(0);
    const r = simulate(lab, 200, 'drain');
    expect(deliveredTicks(r, cons).length).toBeGreaterThan(3);
    expect(flowTotals(r.sim).lost).toBe(0);
  });
});

describe('open halves', () => {
  test('one half alone, or two of the same kind, carry nothing and lose nothing', () => {
    const { lab, src } = linkedBoard();
    const alone = simulate(lab, 300, 'drain');
    expect(flowTotals(alone.sim).lost).toBe(0);
    expect(flowTotals(alone.sim).consumed).toBe(0);
    const source = alone.sim.sources[0];
    expect(source?.lost).toBe(0);
    expect(source?.stalledTicks).toBeGreaterThan(0);
    const out = buildFlowGraph(lab.state, content).nodes.find(
      (n) => n.building === src,
    );
    expect(out?.outputs[0]).toEqual({ side: 'north', conduit: 4, open: true });

    // Two sending halves at one spot stay open.
    const two = twoPlots([
      [2, 2, 'res_a'],
      [14, 2, 'res_a'],
    ]);
    const a = two.put('bld_extractor', 2, 2);
    const b = two.put('bld_extractor', 14, 2);
    add(two, 0, side(a, 'north'), spot(3), row(2, 11, 3));
    add(two, 1, side(b, 'north'), spot(3), row(14, 12, 3));
    expect(buildFlowGraph(two.state, content).edges).toEqual([]);
    const r = simulate(two, 300, 'drain');
    expect(flowTotals(r.sim).lost).toBe(0);
    expect(flowTotals(r.sim).consumed).toBe(0);
  });

  test('an open receiving half delivers nothing: the input has no conduit', () => {
    const lab = twoPlots();
    const cons = lab.put('bld_barracks', 14, 6);
    add(lab, 1, spot(3), side(cons, 'south'), receivingPath());
    const node = buildFlowGraph(lab.state, content).nodes.find(
      (n) => n.building === cons,
    );
    expect(node?.inputs[0]?.conduit).toBeNull();
    expect(conduitResource(lab.state, content, 4)).toBeNull();
  });

  test('a splitter with an open half and a consumer sends everything to the consumer', () => {
    const lab = twoPlots([[3, 2, 'res_a']]);
    const src = lab.put('bld_extractor', 3, 2);
    const sp = lab.put('bld_splitter', 3, 3);
    const cons = lab.put('bld_barracks', 1, 3, 270);
    lab.link(src, 'north', sp, 'south');
    lab.link(sp, 'west', cons, 'east');
    add(lab, 0, side(sp, 'east'), spot(3), row(4, 11, 3));
    const r = simulate(lab, 400, 'drain');
    const source = r.sim.sources[0];
    expect(flowTotals(r.sim).lost).toBe(0);
    expect(source?.stalledTicks).toBe(0);
    expect(deliveredTicks(r, cons).length).toBeGreaterThanOrEqual(
      (source?.produced ?? 0) - 1,
    );
  });
});

describe('validation', () => {
  test('invalid_border, not_owner and border_spot_in_use', () => {
    const lab = twoPlots([
      [2, 2, 'res_a'],
      [4, 2, 'res_a'],
    ]);
    const src = lab.put('bld_extractor', 2, 2);
    const to = (end: ConduitEndArg, actor = 0) =>
      reasonOf(half(lab, actor, side(src, 'north'), end, row(2, 11, 3)));
    expect(to(spot(3, 1))).toBe('invalid_border'); // no border 1 with two plots
    expect(to(spot(3, -1))).toBe('invalid_border');
    expect(to(spot(16))).toBe('invalid_border'); // y out of range
    expect(to(spot(-1))).toBe('invalid_border');
    expect(to({ border: 0, y: 1.5 })).toBe('invalid_border');
    expect(to(spot(3))).toBe('ok');
    // The building's owner is checked before the border.
    expect(to(spot(3), 1)).toBe('not_owner');
    // The actor must be one of the two neighbours (three plots).
    const three = new Lab(board([[2, 2, 'res_a']], 36, 3));
    const t = three.put('bld_extractor', 2, 2);
    expect(
      reasonOf(
        addConduit(three.state, content, {
          actor: 0,
          from: side(t, 'north'),
          to: spot(3, 1),
          cells: cells(row(2, 11, 3)),
        }),
      ),
    ).toBe('invalid_border');
    // One half per player per spot; a building side holds one conduit.
    add(lab, 0, side(src, 'north'), spot(3), row(2, 11, 3));
    const other = lab.put('bld_extractor', 4, 2);
    expect(
      reasonOf(half(lab, 0, side(other, 'north'), spot(3), row(4, 11, 3))),
    ).toBe('border_spot_in_use');
    expect(to(spot(5))).toBe('side_in_use');
  });

  test('a half must end on the owner border cell and stay in the owner plot', () => {
    const lab = twoPlots();
    const src = lab.put('bld_extractor', 2, 2);
    const run = (path: Pairs) =>
      reasonOf(half(lab, 0, side(src, 'north'), spot(3), path));
    expect(run(row(2, 10, 3))).toBe('invalid_path'); // stops short
    expect(run(row(2, 12, 3))).toBe('invalid_path'); // ends on the neighbour's cell
    expect(run([])).toBe('invalid_path');
    // Goes through the neighbour's plot and comes back to the border cell.
    expect(run([[2, 3], [2, 4], ...row(3, 12, 4), [12, 3], [11, 3]])).toBe(
      'outside_own_plot',
    );
    // A direct half takes no cells; the wrong side needs cells.
    const sp = lab.put('bld_splitter', 11, 8);
    expect(reasonOf(half(lab, 0, side(sp, 'east'), spot(8), [[11, 9]]))).toBe(
      'invalid_path',
    );
    expect(reasonOf(half(lab, 0, side(sp, 'west'), spot(8), []))).toBe(
      'invalid_path',
    );
    expect(reasonOf(half(lab, 0, side(sp, 'east'), spot(8), []))).toBe('ok');
  });

  test('a receiving half starts on the border cell, and is the actor’s own', () => {
    const lab = twoPlots();
    const cons = lab.put('bld_barracks', 14, 6);
    expect(
      reasonOf(
        half(lab, 1, spot(3), side(cons, 'south'), receivingPath().slice(1)),
      ),
    ).toBe('invalid_path');
    expect(reasonOf(half(lab, 0, spot(3), side(cons, 'south'), []))).toBe(
      'not_owner',
    );
  });

  test('a mismatch across a link is refused with the usual reason', () => {
    const mergerBoard = () => {
      const lab = twoPlots([
        [2, 2, 'res_a'],
        [16, 2, 'res_b'],
      ]);
      const a = lab.put('bld_extractor', 2, 2);
      const b = lab.put('bld_extractor', 16, 2);
      const m = lab.put('bld_merger', 14, 6);
      return { lab, a, b, m };
    };
    const intoEast = (lab: Lab, b: number, m: number) =>
      half(lab, 1, side(b, 'north'), side(m, 'east'), [
        [16, 3],
        [16, 4],
        [16, 5],
        [16, 6],
        [15, 6],
      ]);
    // The link brings res_a into a merger that also takes res_b.
    const x = mergerBoard();
    add(x.lab, 0, side(x.a, 'north'), spot(3), row(2, 11, 3));
    add(x.lab, 1, spot(3), side(x.m, 'south'), receivingPath());
    expect(reasonOf(intoEast(x.lab, x.b, x.m))).toBe('resource_mismatch');
    // The half that completes the join is the one refused.
    const y = mergerBoard();
    add(y.lab, 0, side(y.a, 'north'), spot(3), row(2, 11, 3));
    add(y.lab, 1, side(y.b, 'north'), side(y.m, 'east'), [
      [16, 3],
      [16, 4],
      [16, 5],
      [16, 6],
      [15, 6],
    ]);
    expect(
      reasonOf(half(y.lab, 1, spot(3), side(y.m, 'south'), receivingPath())),
    ).toBe('resource_mismatch');
  });

  test('a loop through a link is refused', () => {
    // Merger M (plot 0) -> link -> splitter S (plot 1) -> link -> M.
    const lab = twoPlots();
    const m = lab.put('bld_merger', 9, 5);
    const s = lab.put('bld_splitter', 14, 10);
    add(lab, 0, side(m, 'north'), spot(9), [
      ...[6, 7, 8, 9].map((y): [number, number] => [9, y]),
      [10, 9],
      [11, 9],
    ]);
    add(lab, 1, spot(9), side(s, 'south'), [
      [12, 9],
      [13, 9],
      [14, 9],
    ]);
    add(lab, 1, side(s, 'west'), spot(12), [
      [13, 10],
      [13, 11],
      [13, 12],
      [12, 12],
    ]);
    const back = half(lab, 0, spot(12), side(m, 'west'), [
      [11, 12],
      [10, 12],
      [9, 12],
      [8, 12],
      ...[11, 10, 9, 8, 7, 6, 5].map((y): [number, number] => [8, y]),
    ]);
    expect(reasonOf(back)).toBe('would_loop');
  });
});

describe('erasing', () => {
  test('either owner removes their own half; the other half stays, open', () => {
    const { lab, cons } = linkedBoard();
    const recv = add(lab, 1, spot(3), side(cons, 'south'), receivingPath());
    expect(buildFlowGraph(lab.state, content).edges).toHaveLength(1);
    const wrong = eraseConduit(lab.state, { actor: 1, id: 4 });
    expect(wrong).toEqual({ ok: false, reason: 'not_owner' });
    const bad0 = eraseConduit(lab.state, { actor: 0, id: recv });
    expect(bad0).toEqual({ ok: false, reason: 'not_owner' });
    const gone = eraseConduit(lab.state, { actor: 1, id: recv });
    if (!gone.ok) throw new Error(gone.reason);
    expect(gone.state.conduits.map((c) => c.id)).toEqual([4]);
    const graph = buildFlowGraph(gone.state, content);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes[0]?.outputs[0]?.open).toBe(true);
    const gone0 = eraseConduit(lab.state, { actor: 0, id: 4 });
    if (!gone0.ok) throw new Error(gone0.reason);
    expect(gone0.state.conduits.map((c) => c.id)).toEqual([recv]);
    expect(validateTeamState(gone0.state, content, mapgen).ok).toBe(true);
  });
});

describe('validateTeamState', () => {
  test('accepts a linked board and rejects a half to a foreign border', () => {
    const { lab, cons } = linkedBoard();
    add(lab, 1, spot(3), side(cons, 'south'), receivingPath());
    const ok = validateTeamState(
      JSON.parse(JSON.stringify(lab.state)),
      content,
      mapgen,
    );
    expect(ok.ok).toBe(true);
    const doc = JSON.parse(JSON.stringify(lab.state)) as {
      conduits: { to: Record<string, number> }[];
    };
    const first = doc.conduits[0];
    if (first === undefined) throw new Error('no conduit');
    first.to = { border: 5, y: 3 };
    const bad = validateTeamState(doc, content, mapgen);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join('\n')).toContain('invalid_border');
    }
    // A half whose owner does not own its building end (not the duplicate-spot
    // rule, which has its own test below).
    const foreign = JSON.parse(JSON.stringify(lab.state)) as {
      conduits: { owner: number }[];
    };
    const owned = foreign.conduits[0];
    if (owned === undefined) throw new Error('no conduit');
    owned.owner = 1;
    const notOwned = validateTeamState(foreign, content, mapgen);
    expect(notOwned.ok).toBe(false);
    if (!notOwned.ok) expect(notOwned.errors.join('\n')).toContain('not_owner');
  });

  test('two halves of one player at one spot are border_spot_in_use', () => {
    const lab = twoPlots([
      [2, 2, 'res_a'],
      [4, 10, 'res_a'],
    ]);
    const a = lab.put('bld_extractor', 2, 2);
    const b = lab.put('bld_extractor', 4, 10);
    add(lab, 0, side(a, 'north'), spot(3), row(2, 11, 3));
    add(lab, 0, side(b, 'north'), spot(11), row(4, 11, 11));
    const ok = validateTeamState(
      JSON.parse(JSON.stringify(lab.state)),
      content,
      mapgen,
    );
    expect(ok.ok).toBe(true);
    const doc = JSON.parse(JSON.stringify(lab.state)) as {
      conduits: { to: { border: number; y: number } }[];
    };
    const second = doc.conduits[1];
    if (second === undefined) throw new Error('no conduit');
    second.to = { border: 0, y: 3 };
    const bad = validateTeamState(doc, content, mapgen);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join('\n')).toContain('border_spot_in_use');
  });

  test('a half on a solo board, and at the outer border for 2 to 4 players', () => {
    const lab = twoPlots();
    const src = lab.put('bld_extractor', 2, 2);
    add(lab, 0, side(src, 'north'), spot(3), row(2, 11, 3));
    const doc = JSON.parse(JSON.stringify(lab.state)) as {
      map: { partySize: number; width: number };
      conduits: { to: { border: number; y: number } }[];
    };
    const errorsOf = (d: unknown): string => {
      const r = validateTeamState(d, content, mapgen);
      return r.ok ? 'ok' : r.errors.join('\n');
    };
    const solo = JSON.parse(JSON.stringify(doc)) as typeof doc;
    solo.map.partySize = 1;
    solo.map.width = 12;
    expect(errorsOf(solo)).toContain('invalid_border');
    for (const n of [2, 3, 4]) {
      const d = JSON.parse(JSON.stringify(doc)) as typeof doc;
      d.map.partySize = n;
      d.map.width = n * 12;
      const c = d.conduits[0];
      if (c === undefined) throw new Error('no conduit');
      c.to = { border: n - 1, y: 3 };
      expect(errorsOf(d), `N = ${String(n)}`).toContain('invalid_border');
    }
  });

  test('two receiving halves at one spot stay open and give no edges', () => {
    const lab = twoPlots([
      [2, 2, 'res_a'],
      [14, 2, 'res_a'],
    ]);
    const mine = lab.put('bld_barracks', 2, 6);
    const theirs = lab.put('bld_barracks', 14, 6);
    add(lab, 0, spot(3), side(mine, 'south'), [
      ...row(11, 2, 3),
      [2, 4],
      [2, 5],
    ]);
    add(lab, 1, spot(3), side(theirs, 'south'), receivingPath());
    expect(buildFlowGraph(lab.state, content).edges).toEqual([]);
    for (const c of lab.state.conduits) {
      expect(conduitResource(lab.state, content, c.id)).toBe(null);
    }
  });
});
