import { listLegalCorePositions } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { pendingCoreSpots } from './view-model.js';
import { BuildController } from './build-controller.js';
import { previewActions } from './undo.js';
import { previewMove, previewPlace } from './ops.js';
import { BuildSession } from './session.js';
import { groupStash } from './panels.js';

async function pair(): Promise<BuildSession> {
  return BuildSession.start(7, Date.now, ['Ann', 'Bo']);
}

async function placeBoth(s: BuildSession): Promise<void> {
  for (const p of [0, 1]) {
    s.setActing(p);
    const pos = listLegalCorePositions(
      s.run.team.map,
      content,
      content.mapgen,
      p,
    )[0];
    if (pos === undefined) throw new Error('no spot');
    const r = await s.dispatch({ type: 'place_core', x: pos.x, y: pos.y });
    if (!r.ok) throw new Error(r.reason);
    const ready = await s.dispatch({ type: 'ready' });
    if (!ready.ok) throw new Error(ready.reason);
  }
}

describe('acting player', () => {
  test('Core spots are the acting player plot only; partners spots are shown', async () => {
    const s = await pair();
    const ctl = new BuildController();
    ctl.attach(s);
    const w = s.run.team.map.plotWidth;
    expect(ctl.legalCorePositions.length).toBeGreaterThan(0);
    expect(ctl.legalCorePositions.every((c) => c.x < w)).toBe(true);
    expect(ctl.partnerCores()).toEqual([]);

    const pos = ctl.legalCorePositions[0];
    if (pos === undefined) throw new Error('no spot');
    await s.dispatch({ type: 'place_core', x: pos.x, y: pos.y });
    s.setActing(1);
    expect(ctl.legalCorePositions.every((c) => c.x >= w)).toBe(true);
    expect(ctl.partnerCores()).toEqual([{ player: 0, x: pos.x, y: pos.y }]);
    expect(pendingCoreSpots(s.run.pending)).toHaveLength(1);
  });

  test('previews and undo use the acting player, not the building owner', async () => {
    const s = await pair();
    await placeBoth(s);
    expect(s.run.step).toBe('build');
    const stash0 = s.run.team.stash.find((b) => b.owner === 0);
    if (stash0 === undefined) throw new Error('no stash');
    s.setActing(1);
    const place = previewActions(
      s.run.team,
      content,
      [{ t: 'place', id: stash0.id, x: 1, y: 1, rotation: 0 }],
      1,
    );
    expect(place).toMatchObject({ ok: false, reason: 'not_owner' });
    // Player 0 places a building; player 1 may not move it.
    s.setActing(0);
    let placed = false;
    for (let y = 0; y < s.run.team.map.height && !placed; y++) {
      for (let x = 0; x < s.run.team.map.plotWidth && !placed; x++) {
        const args = { id: stash0.id, x, y, rotation: 0 };
        if (previewPlace(s.run.team, content, args, 0).ok) {
          const r0 = await s.dispatch({ type: 'place_building', ...args });
          placed = r0.ok;
        }
      }
    }
    expect(placed).toBe(true);
    s.setActing(1);
    const mine = s.run.team.buildings.find((b) => b.id === stash0.id);
    if (mine === undefined) throw new Error('not placed');
    const mv = previewMove(
      s.run.team,
      content,
      { id: mine.id, x: mine.x, y: mine.y, rotation: mine.rotation },
      1,
    );
    expect(mv).toMatchObject({ ok: false, reason: 'not_owner' });
    const other = s.run.team.stash.find((b) => b.owner === 0);
    if (other === undefined) throw new Error('no second stash item');
    const r = await s.dispatch({
      type: 'place_building',
      id: other.id,
      x: 1,
      y: 1,
      rotation: 0,
    });
    expect(r).toMatchObject({ ok: false, reason: 'not_owner' });
  });

  test("undo and redo of player 1's own change preview as player 1 (BuildSession)", async () => {
    const s = await pair();
    await placeBoth(s);
    s.setActing(1);
    const item = s.run.team.stash.find((b) => b.owner === 1);
    if (item === undefined) throw new Error('no stash');
    const w = s.run.team.map.plotWidth;
    let cell: { x: number; y: number } | null = null;
    for (let y = 0; y < s.run.team.map.height && cell === null; y++) {
      for (let x = w; x < 2 * w && cell === null; x++) {
        const args = { id: item.id, x, y, rotation: 0 };
        if (previewPlace(s.run.team, content, args, 1).ok) cell = { x, y };
      }
    }
    if (cell === null) throw new Error('no legal cell');
    const placed = await s.act({
      t: 'place',
      id: item.id,
      ...cell,
      rotation: 0,
    });
    expect(placed).toEqual({ ok: true });
    expect(s.run.team.buildings.some((b) => b.id === item.id)).toBe(true);
    // Preview as player 0 would refuse (not_owner); the session uses player 1.
    expect(await s.undo()).toEqual({ ok: true });
    expect(s.run.team.buildings.some((b) => b.id === item.id)).toBe(false);
    expect(await s.redo()).toEqual({ ok: true });
    expect(s.run.team.buildings.some((b) => b.id === item.id)).toBe(true);
  });

  test('the stash lists the acting player buildings only', async () => {
    const s = await pair();
    await placeBoth(s);
    const count = (p: number): number =>
      groupStash(s.run.team, p).reduce((n, g) => n + g.ids.length, 0);
    expect(count(0)).toBe(s.run.team.stash.filter((b) => b.owner === 0).length);
    expect(count(0) + count(1)).toBe(s.run.team.stash.length);
    expect(count(1)).toBeGreaterThan(0);
  });

  test('switching ignores a player that does not exist', async () => {
    const s = await pair();
    s.setActing(5);
    expect(s.acting).toBe(0);
    s.setActing(1);
    expect(s.acting).toBe(1);
    expect(s.store.get().acting).toBe(1);
  });
});
