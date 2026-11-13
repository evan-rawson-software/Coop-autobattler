import {
  addConduit,
  addToStash,
  createTeamState,
  hashJson,
  placeCore,
  placeFromStash,
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

// Undo restores the exact previous team state, ids and nextId included,
// checked with the full state hash (issue #38, RS-5g).

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [
    { x: 2, y: 2, resource: 'res_a' },
    { x: 8, y: 2, resource: 'res_a' },
  ],
};

const row = (from: number, to: number, y: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ x: from + i, y }));

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

function stash(team: TeamState, def: string) {
  return ok(addToStash(team, content, { def, tier: 1, owner: 0 }));
}

function put(team: TeamState, id: number, x: number, y: number): TeamState {
  return ok(placeFromStash(team, content, { actor: 0, id, x, y, rotation: 0 }))
    .state;
}

/** Cores, two extractors (ids e1, e2), a barracks, a wall; no conduits. */
function base() {
  let team = createTeamState(map);
  for (const [p, x] of [
    [0, 5],
    [1, 17],
  ] as const) {
    team = ok(placeCore(team, content, content.mapgen, p, { x, y: 0 })).state;
  }
  const e1 = stash(team, 'bld_extractor');
  const e2 = stash(e1.state, 'bld_extractor');
  const b = stash(e2.state, 'bld_barracks');
  const w = stash(b.state, 'bld_wall');
  team = put(put(put(w.state, e1.id, 2, 2), e2.id, 8, 2), b.id, 5, 4);
  return { team, e1: e1.id, e2: e2.id, b: b.id, w: w.id };
}

type Add = Extract<LayoutAction, { t: 'add' | 'erase' }>;

function conduits(r: ReturnType<typeof base>) {
  const direct: Add = {
    t: 'add',
    from: { building: r.e1, side: 'north' },
    to: { building: r.b, side: 'south' },
    cells: row(2, 5, 3),
  };
  const half: Add = {
    t: 'add',
    from: { building: r.e2, side: 'north' },
    to: { border: 0, y: 3 },
    cells: row(8, 11, 3),
  };
  return { direct, half };
}

function withConduits(team: TeamState, list: readonly Add[]): TeamState {
  let t = team;
  for (const a of list) {
    t = ok(
      addConduit(t, content, {
        actor: 0,
        from: a.from,
        to: a.to,
        cells: a.cells,
      }),
    ).state;
  }
  return t;
}

/** The session's behaviour on a team: record, apply, undo, redo. */
class Rig {
  state: TeamState;
  readonly stack = new UndoStack();
  constructor(state: TeamState) {
    this.state = state;
  }
  act(a: LayoutAction): void {
    const before = this.state;
    this.state = ok(applyAction(this.state, content, a, 0)).state;
    this.stack.record(a, before);
  }
  private apply = (actions: readonly LayoutAction[]) => {
    for (const a of actions) {
      const r = applyAction(this.state, content, a, 0);
      if (!r.ok)
        return Promise.resolve({ ok: false as const, reason: r.reason });
      this.state = r.state;
    }
    return Promise.resolve({ ok: true as const });
  };
  private check = (actions: readonly LayoutAction[]) =>
    previewActions(this.state, content, actions, 0);
  async undo(): Promise<void> {
    expect(await this.stack.undo(this.apply, this.check)).toEqual({ ok: true });
  }
  async redo(): Promise<void> {
    expect(await this.stack.redo(this.apply, this.check)).toEqual({ ok: true });
  }
}

async function roundTrip(start: TeamState, action: LayoutAction) {
  const rig = new Rig(start);
  const h0 = hashJson(start);
  rig.act(action);
  const h1 = hashJson(rig.state);
  expect(h1).not.toBe(h0);
  await rig.undo();
  expect(hashJson(rig.state)).toBe(h0);
  await rig.redo();
  expect(hashJson(rig.state)).toBe(h1);
  await rig.undo();
  expect(hashJson(rig.state)).toBe(h0);
}

describe('undo restores the full state hash', () => {
  const r = base();
  const { direct, half } = conduits(r);
  // The wall is placed at (10,8) for the actions that need a placed one.
  const placedWall = put(r.team, r.w, 10, 8);
  // Both conduits have ids that are not the newest, plus a second stash entry.
  const wired = withConduits(placedWall, [direct, half]);
  const lateStash = stash(wired, 'bld_wall').state;

  test('place', async () => {
    await roundTrip(r.team, { t: 'place', id: r.w, x: 10, y: 8, rotation: 0 });
  });
  test('move without a conduit', async () => {
    await roundTrip(placedWall, {
      t: 'move',
      id: r.w,
      x: 11,
      y: 9,
      rotation: 0,
    });
  });
  test('move with an attached conduit', async () => {
    await roundTrip(lateStash, { t: 'move', id: r.b, x: 7, y: 4, rotation: 0 });
  });
  test('return without a conduit', async () => {
    await roundTrip(placedWall, { t: 'return', id: r.w });
  });
  test('return with an attached conduit', async () => {
    await roundTrip(lateStash, { t: 'return', id: r.b });
  });
  test('return with a border-link half', async () => {
    await roundTrip(lateStash, { t: 'return', id: r.e2 });
  });
  test('add', async () => {
    await roundTrip(placedWall, direct);
    await roundTrip(withConduits(placedWall, [direct]), half);
  });
  test('erase', async () => {
    await roundTrip(lateStash, { ...direct, t: 'erase' });
    await roundTrip(lateStash, { ...half, t: 'erase' });
  });

  test('interleaved: add A, add B, erase A, then undo all the way', async () => {
    const rig = new Rig(r.team);
    const h0 = hashJson(r.team);
    rig.act(direct);
    const hA = hashJson(rig.state);
    rig.act(half);
    const hAB = hashJson(rig.state);
    rig.act({ ...direct, t: 'erase' });
    await rig.undo();
    expect(hashJson(rig.state)).toBe(hAB);
    await rig.undo();
    expect(hashJson(rig.state)).toBe(hA);
    await rig.undo();
    expect(hashJson(rig.state)).toBe(h0);
  });
});
