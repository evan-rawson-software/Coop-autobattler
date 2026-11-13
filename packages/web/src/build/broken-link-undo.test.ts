import {
  addToStash,
  brokenLinks,
  buildFlowGraph,
  createTeamState,
  placeCore,
  placeFromStash,
  validateTeamState,
  type GameMap,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import {
  UndoStack,
  applyAction,
  previewActions,
  type LayoutAction,
} from './undo.js';

// An undo is never refused over a link (issue #38): the link is broken instead.

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [],
};

type Add = Extract<LayoutAction, { t: 'add' | 'erase' }> & { t: 'add' };
const cells = (path: string) =>
  path.split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number);
    return { x: x as number, y: y as number };
  });

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

const run = (team: TeamState, a: LayoutAction, actor: number): TeamState =>
  ok(applyAction(team, content, a, actor)).state;

function put(
  team: TeamState,
  owner: number,
  def: string,
  x: number,
  y: number,
) {
  const s = ok(addToStash(team, content, { def, tier: 1, owner }));
  const p = ok(
    placeFromStash(s.state, content, {
      actor: owner,
      id: s.id,
      x,
      y,
      rotation: 0,
    }),
  );
  return { team: p.state, id: s.id };
}

describe('undo through a link that now conflicts', () => {
  test('the undo goes through, the link is broken, and mends when the cause goes', async () => {
    let team = createTeamState(map);
    for (const [p, x] of [
      [0, 5],
      [1, 17],
    ] as const) {
      team = ok(placeCore(team, content, content.mapgen, p, { x, y: 0 })).state;
    }
    const ids: Record<string, number> = {};
    for (const [name, owner, def, x, y] of [
      ['m', 0, 'bld_merger', 9, 5],
      ['x', 0, 'bld_splitter', 6, 12],
      ['s', 1, 'bld_splitter', 14, 10],
    ] as const) {
      const r = put(team, owner, def, x, y);
      team = r.team;
      ids[name] = r.id;
    }
    const m = ids['m'] as number;
    const x = ids['x'] as number;
    const s = ids['s'] as number;
    // Loop: M -> row 9 link -> S -> row 12 link -> X -> reroute -> M.
    const send9: Add = {
      t: 'add',
      from: { building: m, side: 'north' },
      to: { border: 0, y: 9 },
      cells: cells('9,6 9,7 9,8 9,9 10,9 11,9'),
    };
    const recv9: Add = {
      t: 'add',
      from: { border: 0, y: 9 },
      to: { building: s, side: 'south' },
      cells: cells('12,9 13,9 14,9'),
    };
    const send12: Add = {
      t: 'add',
      from: { building: s, side: 'west' },
      to: { border: 0, y: 12 },
      cells: cells('13,10 13,11 13,12 12,12'),
    };
    const recv12: Add = {
      t: 'add',
      from: { border: 0, y: 12 },
      to: { building: x, side: 'south' },
      cells: cells('11,12 10,12 9,12 8,12 7,12 7,11 6,11'),
    };
    const reroute: Add = {
      t: 'add',
      from: { building: x, side: 'west' },
      to: { building: m, side: 'west' },
      cells: cells('5,12 5,11 5,10 5,9 5,8 5,7 5,6 5,5 6,5 7,5 8,5'),
    };
    for (const [a, who] of [
      [send9, 0],
      [recv9, 1],
      [send12, 1],
      [recv12, 0],
    ] as const) {
      team = run(team, a, who);
    }
    expect(brokenLinks(team, content)).toEqual([]);

    // Player 1 erases the half that feeds the row 9 link, and can undo it.
    const stack = new UndoStack();
    const erase: LayoutAction = { ...recv9, t: 'erase' };
    const before = team;
    team = run(team, erase, 1);
    stack.record(erase, before);

    // Player 0 reroutes: with that link open this closes no loop.
    team = run(team, reroute, 0);
    expect(brokenLinks(team, content)).toEqual([]);
    // The same half added by hand is refused: it would close a loop.
    expect(previewActions(team, content, [recv9], 1)).toMatchObject({
      ok: false,
      reason: 'would_loop',
    });

    // The undo is not refused.
    const r = await stack.undo(
      (actions) => {
        for (const a of actions) team = run(team, a, 1);
        return Promise.resolve({ ok: true });
      },
      (actions) => previewActions(team, content, actions, 1),
    );
    expect(r).toEqual({ ok: true });
    expect(
      validateTeamState(
        JSON.parse(JSON.stringify(team)),
        content,
        content.mapgen,
      ).ok,
    ).toBe(true);
    const broken = buildFlowGraph(team, content).brokenLinks;
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ border: 0, y: 12, reason: 'would_loop' });

    // Player 0 removes the reroute: the link is joined again.
    team = run(team, { ...reroute, t: 'erase' }, 0);
    expect(brokenLinks(team, content)).toEqual([]);
    expect(buildFlowGraph(team, content).edges).toHaveLength(2);
  });
});
