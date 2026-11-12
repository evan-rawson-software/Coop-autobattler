import { listLegalCorePositions } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { pendingCoreSpots } from './view-model.js';
import { BuildController } from './build-controller.js';
import { previewActions } from './undo.js';
import { previewMove } from './ops.js';
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
    const mine = s.run.team.buildings.find((b) => b.owner === 0);
    if (mine !== undefined) {
      const mv = previewMove(
        s.run.team,
        content,
        { id: mine.id, x: mine.x, y: mine.y, rotation: mine.rotation },
        1,
      );
      expect(mv).toMatchObject({ ok: false, reason: 'not_owner' });
    }
    const r = await s.dispatch({
      type: 'place_building',
      id: stash0.id,
      x: 1,
      y: 1,
      rotation: 0,
    });
    expect(r).toMatchObject({ ok: false, reason: 'not_owner' });
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
