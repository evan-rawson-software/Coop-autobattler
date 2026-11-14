/** PP-1: ownership and own-plot checks on every board operation. */
import { describe, expect, test } from 'vitest';
import { addConduit } from './conduits.js';
import {
  addToStash,
  createTeamState,
  eraseConduit,
  moveBuilding,
  placeFromStash,
  removeFromStash,
  returnToStash,
  validateTeamState,
  type TeamState,
} from './team-state.js';
import { board, content, mapgen } from './testing/support.js';

// Two plots of 12 columns: plot 0 is x 0..11, plot 1 is x 12..23.
const NODES: [number, number, string][] = [
  [3, 2, 'res_a'],
  [11, 2, 'res_a'],
  [14, 2, 'res_a'],
];

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`unexpected rejection: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

function stash(s: TeamState, def: string, owner: number) {
  const r = must(addToStash(s, content, { def, tier: 1, owner }));
  return { state: r.state, id: r.id };
}

function put(
  s: TeamState,
  def: string,
  owner: number,
  x: number,
  y: number,
  rotation = 0,
) {
  const a = stash(s, def, owner);
  const p = must(
    placeFromStash(a.state, content, {
      actor: owner,
      id: a.id,
      x,
      y,
      rotation,
    }),
  );
  return { state: p.state, id: a.id };
}

const empty = (): TeamState => createTeamState(board(NODES, 24, 2));

describe('buildings: not_owner', () => {
  test('placing, moving, rotating, returning and removing need the owner', () => {
    const a = stash(empty(), 'bld_wall_block', 0);
    expect(
      placeFromStash(a.state, content, {
        actor: 1,
        id: a.id,
        x: 5,
        y: 5,
        rotation: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'not_owner' });
    expect(removeFromStash(a.state, { actor: 1, id: a.id })).toMatchObject({
      ok: false,
      reason: 'not_owner',
    });
    const p = put(empty(), 'bld_wall_block', 0, 5, 5);
    for (const rotation of [0, 90]) {
      expect(
        moveBuilding(p.state, content, {
          actor: 1,
          id: p.id,
          x: 6,
          y: 5,
          rotation,
        }),
      ).toMatchObject({ ok: false, reason: 'not_owner' });
    }
    expect(
      returnToStash(p.state, content, { actor: 1, id: p.id }),
    ).toMatchObject({ ok: false, reason: 'not_owner' });
    // The owner still can.
    must(
      moveBuilding(p.state, content, {
        actor: 0,
        id: p.id,
        x: 6,
        y: 5,
        rotation: 90,
      }),
    );
    must(returnToStash(p.state, content, { actor: 0, id: p.id }));
    must(removeFromStash(a.state, { actor: 0, id: a.id }));
  });

  test('unknown_building comes first, then invalid_owner, then not_owner', () => {
    const a = stash(empty(), 'bld_wall_block', 0);
    expect(returnToStash(a.state, content, { actor: 5, id: 99 })).toMatchObject(
      { reason: 'unknown_building' },
    );
    for (const actor of [-1, 2, 0.5, Number.NaN]) {
      expect(removeFromStash(a.state, { actor, id: a.id })).toMatchObject({
        reason: 'invalid_owner',
      });
    }
  });
});

describe('buildings: outside_own_plot', () => {
  test('a footprint cell in a neighbour plot is rejected, also on a move', () => {
    const a = stash(empty(), 'bld_wall_block', 0);
    const args = { actor: 0, id: a.id, y: 5, rotation: 0 };
    expect(placeFromStash(a.state, content, { ...args, x: 12 })).toMatchObject({
      ok: false,
      reason: 'outside_own_plot',
    });
    must(placeFromStash(a.state, content, { ...args, x: 11 }));
    // Barracks is 2x2: x = 11 puts its right column in plot 1.
    const b = stash(empty(), 'bld_barracks', 0);
    expect(
      placeFromStash(b.state, content, {
        actor: 0,
        id: b.id,
        x: 11,
        y: 5,
        rotation: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'outside_own_plot' });
    const p = put(empty(), 'bld_wall_block', 0, 11, 5);
    expect(
      moveBuilding(p.state, content, {
        actor: 0,
        id: p.id,
        x: 12,
        y: 5,
        rotation: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'outside_own_plot' });
    // Player 1 builds in plot 1 and not in plot 0.
    const c = stash(empty(), 'bld_wall_block', 1);
    expect(
      placeFromStash(c.state, content, {
        actor: 1,
        id: c.id,
        x: 5,
        y: 5,
        rotation: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'outside_own_plot' });
    must(
      placeFromStash(c.state, content, {
        actor: 1,
        id: c.id,
        x: 12,
        y: 5,
        rotation: 0,
      }),
    );
  });

  test('the plot rule comes before the terrain and node rules', () => {
    // A source on a node of the other plot: outside_own_plot, not a node problem.
    const a = stash(empty(), 'bld_extractor', 0);
    expect(
      placeFromStash(a.state, content, {
        actor: 0,
        id: a.id,
        x: 14,
        y: 2,
        rotation: 0,
      }),
    ).toMatchObject({ reason: 'outside_own_plot' });
    // A wall on a node of the own plot is still node_reserved.
    const w = stash(empty(), 'bld_wall_block', 0);
    expect(
      placeFromStash(w.state, content, {
        actor: 0,
        id: w.id,
        x: 3,
        y: 2,
        rotation: 0,
      }),
    ).toMatchObject({ reason: 'node_reserved' });
  });

  test('a solo board accepts everything it accepted before', () => {
    const solo = createTeamState(board(NODES, 24, 1));
    const a = stash(solo, 'bld_wall_block', 0);
    for (const x of [0, 12, 23]) {
      must(
        placeFromStash(a.state, content, {
          actor: 0,
          id: a.id,
          x,
          y: 5,
          rotation: 0,
        }),
      );
    }
  });
});

describe('conduits: owner and plot', () => {
  // Player 0: extractor on the node (11, 2) facing east, barracks at (10, 6).
  const setup = (): { state: TeamState; e: number; b: number } => {
    const e = put(empty(), 'bld_extractor', 0, 11, 2, 90);
    const b = put(e.state, 'bld_barracks', 0, 10, 6);
    return { state: b.state, e: e.id, b: b.id };
  };

  test('a conduit crossing the border is outside_own_plot', () => {
    const { state, e, b } = setup();
    expect(
      addConduit(state, content, {
        actor: 0,
        from: { building: e, side: 'east' },
        to: { building: b, side: 'south' },
        cells: [
          { x: 12, y: 2 },
          { x: 12, y: 3 },
          { x: 12, y: 4 },
          { x: 12, y: 5 },
          { x: 11, y: 5 },
        ],
      }),
    ).toMatchObject({ ok: false, reason: 'outside_own_plot' });
  });

  test('a conduit needs buildings of its actor (from before to)', () => {
    const { state, e, b } = setup();
    const args = {
      from: { building: e, side: 'north' },
      to: { building: b, side: 'south' },
      cells: [],
    };
    expect(addConduit(state, content, { actor: 1, ...args })).toMatchObject({
      ok: false,
      reason: 'not_owner',
      detail: String(e),
    });
    expect(addConduit(state, content, { actor: 7, ...args })).toMatchObject({
      reason: 'not_owner',
    });
    // Mixed owners: the end owned by someone else is named.
    const other = put(state, 'bld_barracks', 1, 14, 6);
    expect(
      addConduit(other.state, content, {
        actor: 0,
        from: { building: e, side: 'north' },
        to: { building: other.id, side: 'south' },
        cells: [],
      }),
    ).toMatchObject({
      reason: 'not_owner',
      detail: String(other.id),
    });
  });

  test('a conduit inside the own plot is accepted and records its owner', () => {
    const e = put(empty(), 'bld_extractor', 0, 11, 2);
    const b = put(e.state, 'bld_barracks', 0, 10, 6);
    const r = must(
      addConduit(b.state, content, {
        actor: 0,
        from: { building: e.id, side: 'north' },
        to: { building: b.id, side: 'south' },
        cells: [
          { x: 11, y: 3 },
          { x: 11, y: 4 },
          { x: 11, y: 5 },
        ],
      }),
    );
    expect(r.state.conduits[0]?.owner).toBe(0);
  });
});

describe('validateTeamState: ownership and plots', () => {
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const errorsOf = (data: unknown): string[] => {
    const r = validateTeamState(data, content, mapgen);
    return r.ok ? [] : [...r.errors];
  };

  test('a building outside its owner plot is rejected', () => {
    const s = put(empty(), 'bld_wall_block', 0, 5, 5).state;
    expect(errorsOf(s)).toEqual([]);
    const j = clone(s) as unknown as { buildings: { owner: number }[] };
    (j.buildings[0] as { owner: number }).owner = 1;
    expect(errorsOf(j).join('\n')).toContain('outside_own_plot');
  });

  test('a conduit with a wrong owner or an owner out of range is rejected', () => {
    const e = put(empty(), 'bld_extractor', 0, 3, 2);
    const b = put(e.state, 'bld_barracks', 0, 2, 3);
    const s = must(
      addConduit(b.state, content, {
        actor: 0,
        from: { building: e.id, side: 'north' },
        to: { building: b.id, side: 'south' },
        cells: [],
      }),
    ).state;
    expect(errorsOf(s)).toEqual([]);
    type J = { conduits: { owner?: number }[] };
    const wrong = clone(s) as unknown as J;
    (wrong.conduits[0] as { owner: number }).owner = 1;
    expect(errorsOf(wrong).join('\n')).toContain('not_owner');
    const range = clone(s) as unknown as J;
    (range.conduits[0] as { owner: number }).owner = 5;
    expect(errorsOf(range).join('\n')).toContain('"owner" must be an integer');
    const missing = clone(s) as unknown as J;
    delete (missing.conduits[0] as { owner?: number }).owner;
    expect(errorsOf(missing).join('\n')).toContain('"owner"');
  });
});

describe('eraseConduit', () => {
  test('unknown_conduit, invalid_owner, not_owner, then success', () => {
    const e = put(empty(), 'bld_extractor', 0, 3, 2);
    const b = put(e.state, 'bld_barracks', 0, 2, 3);
    const c = must(
      addConduit(b.state, content, {
        actor: 0,
        from: { building: e.id, side: 'north' },
        to: { building: b.id, side: 'south' },
        cells: [],
      }),
    );
    expect(c.state.conduits[0]?.owner).toBe(0);
    expect(eraseConduit(c.state, { actor: 0, id: 99 })).toMatchObject({
      reason: 'unknown_conduit',
    });
    expect(eraseConduit(c.state, { actor: 9, id: c.id })).toMatchObject({
      reason: 'invalid_owner',
    });
    expect(eraseConduit(c.state, { actor: 1, id: c.id })).toMatchObject({
      reason: 'not_owner',
    });
    expect(
      must(eraseConduit(c.state, { actor: 0, id: c.id })).state.conduits,
    ).toEqual([]);
  });
});
