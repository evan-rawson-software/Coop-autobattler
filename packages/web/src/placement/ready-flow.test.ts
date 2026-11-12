import { listLegalCorePositions } from '@game/core';
import { describe, expect, test } from 'vitest';
import { BuildSession } from '../build/session.js';
import { content } from '../content.js';
import { hintText, verdictAt } from './view-model.js';

function spots(s: BuildSession, p: number) {
  return listLegalCorePositions(s.run.team.map, content, content.mapgen, p);
}

describe('Core placement: place, change until Ready, Unready reopens', () => {
  test('the step ends only when every player is placed and Ready', async () => {
    const s = await BuildSession.start(7, Date.now, ['Ann', 'Bo']);
    const [a1, a2] = spots(s, 0);
    const b1 = spots(s, 1)[0];
    if (!a1 || !a2 || !b1) throw new Error('no spots');

    // Place, then change the choice.
    expect((await s.dispatch({ type: 'place_core', ...a1 })).ok).toBe(true);
    expect((await s.dispatch({ type: 'place_core', ...a2 })).ok).toBe(true);
    expect((await s.dispatch({ type: 'ready' })).ok).toBe(true);
    // Ready: the choice is locked.
    const locked = await s.dispatch({ type: 'place_core', ...a1 });
    expect(locked).toMatchObject({ ok: false, reason: 'locked_ready' });
    // Unready reopens it.
    expect((await s.dispatch({ type: 'unready' })).ok).toBe(true);
    expect((await s.dispatch({ type: 'place_core', ...a1 })).ok).toBe(true);
    expect((await s.dispatch({ type: 'ready' })).ok).toBe(true);
    expect(s.run.step).toBe('core_placement');

    // The partner must place before Ready, then the step ends.
    s.setActing(1);
    expect((await s.dispatch({ type: 'ready' })).ok).toBe(false);
    expect((await s.dispatch({ type: 'place_core', ...b1 })).ok).toBe(true);
    expect((await s.dispatch({ type: 'ready' })).ok).toBe(true);
    expect(s.run.step).toBe('build');
    expect(s.run.team.cores[0]).toMatchObject(a1);
    expect(s.run.team.cores[1]).toMatchObject(b1);
  });

  test('a cell in another player plot is refused with a readable reason', async () => {
    const s = await BuildSession.start(7, Date.now, ['Ann', 'Bo']);
    const other = spots(s, 1)[0];
    if (!other) throw new Error('no spot');
    const v = verdictAt(s.run.team, content, other, 0);
    expect(v).toMatchObject({ ok: false, problem: 'outside_own_plot' });
    expect(v.text).toMatch(/own area/);
    const r = await s.dispatch({ type: 'place_core', ...other });
    expect(r).toMatchObject({ ok: false, reason: 'outside_own_plot' });
  });

  test('the hint tells a Ready player to Unready', () => {
    const v = {
      ok: true,
      problem: null,
      text: null,
      cells: [],
    } as const;
    expect(
      hintText({ hover: v, selected: null, message: null, ready: true }),
    ).toMatch(/Unready/);
  });
});
