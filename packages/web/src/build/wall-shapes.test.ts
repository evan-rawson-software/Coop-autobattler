import { describe, expect, test } from 'vitest';
import type { TeamState } from '@game/core';
import { content } from '../content.js';
import { BuildController } from './build-controller.js';
import { footprintCells } from './geometry.js';
import { previewMove, previewPlace } from './ops.js';
import { groupStash } from './panels.js';
import { buildRun } from './test-helpers.js';

function def(id: string) {
  const d = content.buildings.get(id);
  if (d === undefined) throw new Error(`no ${id}`);
  return d;
}

describe('wall shapes in the Build screen (issue #291)', () => {
  test('the preview and fit cells are the rotated shape, not its box', () => {
    const t = def('bld_wall_t');
    expect(footprintCells(t, 4, 4, 0)).toEqual([
      { x: 5, y: 4 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]);
    // Turned clockwise once: the bar stands on the east side, the stem points west.
    expect(footprintCells(t, 4, 4, 90)).toEqual([
      { x: 5, y: 4 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 6 },
    ]);
    const l = def('bld_wall_l');
    expect(footprintCells(l, 0, 0, 0)).toHaveLength(4);
    // L turned to three quarters: a bar along the bottom, a post at its east end.
    expect(footprintCells(l, 0, 0, 270)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
    expect(footprintCells(def('bld_wall_o'), 1, 1, 90)).toHaveLength(4);
  });

  test('each wall shape is its own stash row; copies of one shape share a row', () => {
    const team = {
      stash: [
        { id: 1, def: 'bld_wall_l', tier: 1, owner: 0 },
        { id: 2, def: 'bld_wall_t', tier: 1, owner: 0 },
        { id: 3, def: 'bld_wall_l', tier: 1, owner: 0 },
        { id: 4, def: 'bld_wall_l', tier: 2, owner: 0 },
      ],
    } as unknown as TeamState;
    const rows = groupStash(team, 0).map((g) => [g.def, g.tier, g.ids]);
    expect(rows).toEqual([
      ['bld_wall_t', 1, [2]],
      ['bld_wall_l', 1, [1, 3]],
      ['bld_wall_l', 2, [4]],
    ]);
    expect(content.presentation.get('bld_wall_l')?.name).toBe('Wall (L)');
    expect(content.presentation.get('bld_wall_t')?.name).toBe('Wall (T)');
  });

  test('Rotate on a placed wall keeps it on the board when the same corner would not fit', async () => {
    const session = await buildRun();
    const ctl = new BuildController();
    ctl.attach(session);
    const team = session.run.team;
    const wall = team.stash.find(
      (x) => x.def.startsWith('bld_wall_') && x.def !== 'bld_wall_o',
    );
    expect(wall).toBeDefined();
    const id = (wall as { id: number }).id;
    // A cell where the wall stands turned once and the next turn, in place,
    // would run off the board (its top edge on the front row).
    let spot: { x: number; y: number } | null = null;
    const top = team.map.height;
    for (let y = top - 4; y < top && spot === null; y++) {
      for (let x = 0; x < team.map.width && spot === null; x++) {
        const put = previewPlace(team, content, { id, x, y, rotation: 90 }, 0);
        if (!put.ok) continue;
        const turn = previewMove(
          put.state,
          content,
          { id, x, y, rotation: 180 },
          0,
        );
        if (!turn.ok) spot = { x, y };
      }
    }
    expect(spot).not.toBeNull();
    const at = spot as { x: number; y: number };
    const r = await session.act({
      t: 'place',
      id,
      x: at.x,
      y: at.y,
      rotation: 90,
    });
    expect(r.ok).toBe(true);
    ctl.select({ kind: 'building', id });
    await ctl.rotate();
    const b = session.run.team.buildings.find((x) => x.id === id);
    expect(b?.rotation).toBe(180);
    expect(ctl.model.get().ui.status.kind).toBe('ok');
  });
});
