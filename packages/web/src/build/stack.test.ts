import { describe, expect, test } from 'vitest';
import type { Cell, TeamState } from '@game/core';
import { content } from '../content.js';
import {
  chooseInput,
  freeInputSides,
  freeOutputSides,
  sideMarkers,
} from './sides.js';
import { KNOWN_REASONS } from './reasons.js';
import { buildRun, stashIds } from './test-helpers.js';
import {
  UndoStack,
  inverseOf,
  toIntent,
  type ApplyResult,
  type LayoutAction,
} from './undo.js';

const ok: ApplyResult = { ok: true };

describe('undo stack (pure)', () => {
  test('inverse of each layout change is the opposite intents', async () => {
    const s = await buildRun();
    const team = s.run.team;
    const id = stashIds(team, 'bld_wall')[0] as number;
    const place: LayoutAction = { t: 'place', id, x: 3, y: 3, rotation: 0 };
    expect(inverseOf(team, place)).toEqual([{ t: 'return', id }]);
    expect(toIntent(team, place)).toEqual({
      type: 'place_building',
      id,
      x: 3,
      y: 3,
      rotation: 0,
    });
    const conduit: LayoutAction = {
      t: 'add',
      from: { building: 1, side: 'north' },
      to: { building: 2, side: 'south' },
      cells: [{ x: 1, y: 1 }],
    };
    const [erase] = inverseOf(team, conduit);
    expect(erase?.t).toBe('erase');
    // An erase of something that is not there has no intent.
    expect(toIntent(team, erase as LayoutAction)).toBeNull();
  });

  test('move and return inverses carry the conduits they detach', async () => {
    const s = await buildRun();
    const t = s.run.team;
    const withConduit: TeamState = {
      ...t,
      buildings: [
        { id: 50, def: 'bld_wall', tier: 1, x: 2, y: 2, rotation: 0, owner: 0 },
      ],
      conduits: [
        {
          id: 51,
          from: { building: 50, side: 'north' },
          to: { building: 52, side: 'south' },
          cells: [{ x: 2, y: 3 }],
        },
      ],
    };
    const mv = inverseOf(withConduit, {
      t: 'move',
      id: 50,
      x: 5,
      y: 5,
      rotation: 90,
    });
    expect(mv).toEqual([
      { t: 'move', id: 50, x: 2, y: 2, rotation: 0 },
      {
        t: 'add',
        from: { building: 50, side: 'north' },
        to: { building: 52, side: 'south' },
        cells: [{ x: 2, y: 3 }],
      },
    ]);
    const ret = inverseOf(withConduit, { t: 'return', id: 50 });
    expect(ret[0]).toEqual({ t: 'place', id: 50, x: 2, y: 2, rotation: 0 });
    expect(ret).toHaveLength(2);
  });

  test('undo, redo, clearing and a rejected inverse', async () => {
    const s = await buildRun();
    const t = s.run.team;
    const stack = new UndoStack();
    const a: LayoutAction = { t: 'return', id: 99 };
    stack.record(a, t);
    stack.record(a, t);
    expect(stack.undoCount).toBe(2);
    const applied: LayoutAction[][] = [];
    const apply = (acts: readonly LayoutAction[]): Promise<ApplyResult> => {
      applied.push([...acts]);
      return Promise.resolve(ok);
    };
    expect(await stack.undo(apply)).toEqual(ok);
    expect(stack.undoCount).toBe(1);
    expect(stack.redoCount).toBe(1);
    expect(await stack.redo(apply)).toEqual(ok);
    expect(applied[1]).toEqual([a]);
    stack.record(a, t);
    expect(stack.redoCount).toBe(0);
    stack.clear();
    expect(await stack.undo(apply)).toBeNull();
    expect(await stack.redo(apply)).toBeNull();
    stack.record(a, t);
    const r = await stack.undo(() =>
      Promise.resolve({ ok: false as const, reason: 'overlaps_building' }),
    );
    expect(r).toEqual({ ok: false, reason: 'overlaps_building' });
    expect(stack.undoCount).toBe(0);
  });
});

describe('sides and markers', () => {
  test('free output and input sides shrink when conduits attach', async () => {
    const s = await buildRun();
    const t = s.run.team;
    const ex = stashIds(t, 'bld_extractor')[0] as number;
    const node = t.map.nodes[0] as Cell;
    await s.act({ t: 'place', id: ex, x: node.x, y: node.y, rotation: 0 });
    const b = s.run.team.buildings[0];
    if (b === undefined) throw new Error('no building');
    expect(freeOutputSides(s.run.team, content, b)).toEqual(['north']);
    expect(freeInputSides(s.run.team, content, b)).toEqual([]);
    const markers = sideMarkers(s.run.team, content, 'out');
    expect(markers).toHaveLength(1);
    expect(markers[0]?.cells).toEqual([{ x: node.x, y: node.y + 1 }]);
    expect(chooseInput(s.run.team, content, b, null).building).toBe(b.id);
  });
});

describe('reason table against core sources', () => {
  const sources = import.meta.glob<string>(
    [
      '../../../core/src/team-state.ts',
      '../../../core/src/conduits.ts',
      '../../../core/src/map.ts',
    ],
    { query: '?raw', import: 'default', eager: true },
  );

  test('every reason literal core can return has a message', () => {
    const found = new Set<string>();
    for (const text of Object.values(sources)) {
      for (const m of text.matchAll(/reason: '([a-z_]+)'/g)) {
        if (m[1] !== undefined) found.add(m[1]);
      }
    }
    expect(found.size).toBeGreaterThan(15);
    for (const r of found) {
      expect(KNOWN_REASONS, `no message for core reason "${r}"`).toContain(r);
    }
  });
});
