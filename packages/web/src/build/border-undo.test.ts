import {
  addConduit,
  addToStash,
  buildFlowGraph,
  createTeamState,
  eraseConduit,
  placeCore,
  placeFromStash,
  returnToStash,
  type GameMap,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { linkMap, makeDrawIndex } from '../battle/draw.js';
import { buildScene } from '../board/scene.js';
import {
  UndoStack,
  inverseOf,
  layoutHash,
  previewActions,
  type LayoutAction,
} from './undo.js';

// Border halves in undo and redo (issue #136, #169, RS-5g, PP-4).

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [{ x: 2, y: 2, resource: 'res_a' }],
};

const row = (from: number, to: number, y: number) => {
  const out: { x: number; y: number }[] = [];
  for (let x = from; x <= to; x++) out.push({ x, y });
  return out;
};

type AddAction = Extract<LayoutAction, { t: 'add' | 'erase' }>;

function rig(): { team: TeamState; src: number; half: AddAction } {
  let team = createTeamState(map);
  for (const [p, x] of [
    [0, 5],
    [1, 17],
  ] as const) {
    const r = placeCore(team, content, content.mapgen, p, { x, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    team = r.state;
  }
  const a = addToStash(team, content, {
    def: 'bld_extractor',
    tier: 1,
    owner: 0,
  });
  if (!a.ok) throw new Error(a.reason);
  const p = placeFromStash(a.state, content, {
    actor: 0,
    id: a.id,
    x: 2,
    y: 2,
    rotation: 0,
  });
  if (!p.ok) throw new Error(p.reason);
  const half: AddAction = {
    t: 'add',
    from: { building: a.id, side: 'north' },
    to: { border: 0, y: 3 },
    cells: row(2, 11, 3),
  };
  const c = addConduit(p.state, content, {
    actor: 0,
    from: half.from,
    to: half.to,
    cells: half.cells,
  });
  if (!c.ok) throw new Error(c.reason);
  return { team: c.state, src: a.id, half };
}

describe('undo with border halves', () => {
  test('returning a building is undone together with its half', () => {
    const { team, src, half } = rig();
    const inverse = inverseOf(team, { t: 'return', id: src });
    expect(inverse).toEqual([
      { t: 'place', id: src, x: 2, y: 2, rotation: 0 },
      half,
    ]);
    // Applying the return and then the inverse gives the same layout.
    expect(
      previewActions(team, content, [{ t: 'return', id: src }], 0).ok,
    ).toBe(true);
    const returned = returnToStash(team, content, { actor: 0, id: src });
    if (!returned.ok) throw new Error(returned.reason);
    expect(returned.state.conduits).toEqual([]);
    expect(layoutHash(returned.state)).not.toBe(layoutHash(team));
    const placed = placeFromStash(returned.state, content, {
      actor: 0,
      id: src,
      x: 2,
      y: 2,
      rotation: 0,
    });
    if (!placed.ok) throw new Error(placed.reason);
    const undone = addConduit(placed.state, content, {
      actor: 0,
      from: half.from,
      to: half.to,
      cells: half.cells,
    });
    if (!undone.ok) throw new Error(undone.reason);
    expect(layoutHash(undone.state)).toBe(layoutHash(team));
  });

  test('erasing a half is undone by adding it again', () => {
    const { team, half } = rig();
    const c = team.conduits[0];
    if (c === undefined) throw new Error('no half');
    const erased = eraseConduit(team, { actor: 0, id: c.id });
    if (!erased.ok) throw new Error(erased.reason);
    expect(previewActions(team, content, [{ ...half, t: 'erase' }], 0).ok).toBe(
      true,
    );
    expect(previewActions(erased.state, content, [half], 0).ok).toBe(true);
    // The restored layout equals the original.
    const back = addConduit(erased.state, content, {
      actor: 0,
      from: half.from,
      to: half.to,
      cells: half.cells,
    });
    if (!back.ok) throw new Error(back.reason);
    expect(layoutHash(back.state)).toBe(layoutHash(team));
  });

  test('an undo the board no longer allows is refused and the history is kept', async () => {
    const { team, src } = rig();
    const stack = new UndoStack();
    stack.record({ t: 'return', id: src }, team);
    // The player returns the source; then a wall is put on the half's path.
    const r1 = returnToStash(team, content, { actor: 0, id: src });
    if (!r1.ok) throw new Error(r1.reason);
    const w = addToStash(r1.state, content, {
      def: 'bld_wall',
      tier: 1,
      owner: 0,
    });
    if (!w.ok) throw new Error(w.reason);
    const w2 = placeFromStash(w.state, content, {
      actor: 0,
      id: w.id,
      x: 5,
      y: 3,
      rotation: 0,
    });
    if (!w2.ok) throw new Error(w2.reason);
    const board = w2.state;
    let applied = false;
    const r = await stack.undo(
      () => {
        applied = true;
        return Promise.resolve({ ok: true as const });
      },
      (acts) => previewActions(board, content, acts, 0),
    );
    expect(r).toMatchObject({ ok: false, kept: true });
    expect(applied).toBe(false);
    expect(stack.undoCount).toBe(1);
    // With the wall gone the same undo is accepted.
    const ok = await stack.undo(
      () => Promise.resolve({ ok: true as const }),
      (acts) => previewActions(r1.state, content, acts, 0),
    );
    expect(ok).toEqual({ ok: true });
    expect(stack.redoCount).toBe(1);
  });
});

describe('link drawing and flow view', () => {
  test('linkMap pairs a sending half with its receiving half only when joined', () => {
    const { team } = rig();
    expect(linkMap(team, content).size).toBe(0); // open half: no link
    expect(buildFlowGraph(team, content).edges).toEqual([]);
    const b = addToStash(team, content, {
      def: 'bld_barracks',
      tier: 1,
      owner: 1,
    });
    if (!b.ok) throw new Error(b.reason);
    const p = placeFromStash(b.state, content, {
      actor: 1,
      id: b.id,
      x: 14,
      y: 6,
      rotation: 0,
    });
    if (!p.ok) throw new Error(p.reason);
    const r = addConduit(p.state, content, {
      actor: 1,
      from: { border: 0, y: 3 },
      to: { building: b.id, side: 'south' },
      cells: [
        { x: 12, y: 3 },
        { x: 13, y: 3 },
        { x: 14, y: 3 },
        { x: 14, y: 4 },
        { x: 14, y: 5 },
      ],
    });
    if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
    const send = team.conduits[0]?.id ?? -1;
    expect([...linkMap(r.state, content)]).toEqual([[send, r.id]]);
  });

  test('the draw index runs a joined link along both halves, in order', () => {
    const { team } = rig();
    const b = addToStash(team, content, {
      def: 'bld_barracks',
      tier: 1,
      owner: 1,
    });
    if (!b.ok) throw new Error(b.reason);
    const p = placeFromStash(b.state, content, {
      actor: 1,
      id: b.id,
      x: 14,
      y: 6,
      rotation: 0,
    });
    if (!p.ok) throw new Error(p.reason);
    const r = addConduit(p.state, content, {
      actor: 1,
      from: { border: 0, y: 3 },
      to: { building: b.id, side: 'south' },
      cells: [
        { x: 12, y: 3 },
        { x: 13, y: 3 },
        { x: 14, y: 3 },
        { x: 14, y: 4 },
        { x: 14, y: 5 },
      ],
    });
    if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
    const send = team.conduits[0]?.id ?? -1;
    const scene = buildScene(r.state, r.state, 4, content);
    const labels = { own: 'a', enemy: 'b' };
    const lm = linkMap(r.state, content);
    const joined = makeDrawIndex(scene, labels, [lm, lm]);
    const apart = makeDrawIndex(scene, labels);
    const sendCells = apart.conduitCells[0].get(send) ?? [];
    const recvCells = apart.conduitCells[0].get(r.id) ?? [];
    expect(sendCells).toHaveLength(10);
    expect(recvCells).toHaveLength(5);
    // Without the link map each half keeps only its own cells.
    expect(apart.conduitCells[0].get(send)).toEqual(sendCells);
    // With it, the sending half's id runs along both halves.
    expect(joined.conduitCells[0].get(send)).toEqual([
      ...sendCells,
      ...recvCells,
    ]);
    expect(joined.conduitCells[1].get(send)).toHaveLength(15);
    // The receiving half's own entry is not changed.
    expect(joined.conduitCells[0].get(r.id)).toEqual(recvCells);
  });
});
