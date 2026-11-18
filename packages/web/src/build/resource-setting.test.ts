/**
 * The building resource setting on the Build screen (issue #473): choosing a
 * resource when placing, changing it on a placed building, the status texts
 * and undo / redo (RS-5g), which puts a detached conduit back.
 */
import { addToStash, type Cell, type TeamState } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { BuildController } from './build-controller.js';
import { firstFit, buildRun } from './test-helpers.js';
import { resourceName } from './view-model.js';
import { proposePath } from './autoroute.js';
import type { BuildSession } from './session.js';

const WELL = 'bld_mana_well';

/** A solo run with a Mana Well in the stash (the starting kit has none). */
async function withWell(): Promise<{
  s: BuildSession;
  ctl: BuildController;
  well: number;
}> {
  const s = await buildRun();
  const added = addToStash(s.run.team, content, {
    def: WELL,
    tier: 1,
    owner: 0,
  });
  if (!added.ok) throw new Error(added.reason);
  Object.assign(s.run.team, added.state);
  const ctl = new BuildController();
  ctl.attach(s);
  return { s, ctl, well: added.id };
}

const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

const stored = (s: BuildSession, id: number) =>
  s.run.team.buildings.find((b) => b.id === id);

/** Hold the well, choose a resource, and drop it on the first free cell. */
async function placeByHand(
  s: BuildSession,
  ctl: BuildController,
  id: number,
  resource: string | null,
): Promise<Cell> {
  const at = firstFit(s.run.team, id);
  ctl.pickFromStash(id);
  if (resource !== null) ctl.setPlaceResource(resource);
  ctl.onBoardPointer({
    type: 'down',
    hit: { board: 'own', x: at.x, y: at.y, building: null },
    shiftKey: false,
    external: false,
  });
  await settle();
  return at;
}

describe('placing a building with the resource setting', () => {
  test('it takes the chosen resource and shows no node rule', async () => {
    const { s, ctl, well } = await withWell();
    await placeByHand(s, ctl, well, 'res_c');
    expect(stored(s, well)?.resource).toBe('res_c');
    expect(ctl.model.get().ui.status.kind).toBe('ok');
  });

  test('without a choice it takes the first base resource', async () => {
    const { s, ctl, well } = await withWell();
    expect(ctl.placeResourceOf()).toBe(content.resources.listBase()[0]?.id);
    await placeByHand(s, ctl, well, null);
    expect(stored(s, well)?.resource).toBe(content.resources.listBase()[0]?.id);
  });

  test('choosing while holding says what the next one will make', async () => {
    const { ctl, well } = await withWell();
    ctl.pickFromStash(well);
    ctl.setPlaceResource('res_b');
    expect(ctl.model.get().ui.status.text).toBe(
      `The next ${content.presentation.get(WELL)?.name ?? ''} will make ${resourceName(content, 'res_b')}.`,
    );
    // Something that is not a base resource is ignored.
    ctl.setPlaceResource('res_ab_refined');
    expect(ctl.placeResourceOf()).toBe('res_b');
  });

  test('the ghost is judged with the chosen resource', async () => {
    const { s, ctl, well } = await withWell();
    const at = firstFit(s.run.team, well);
    ctl.pickFromStash(well);
    ctl.hover(at);
    expect(ctl.model.get().ui.ghost?.ok).toBe(true);
  });
});

describe('changing the resource of a placed building', () => {
  async function wired() {
    const { s, ctl, well } = await withWell();
    await placeByHand(s, ctl, well, 'res_a');
    const team = s.run.team;
    const bk = team.stash.find((x) => x.def === 'bld_barracks')?.id as number;
    const placed = await s.act({
      t: 'place',
      id: bk,
      ...firstFitAbove(team, bk, stored(s, well) as { x: number; y: number }),
      rotation: 0,
    });
    expect(placed).toEqual({ ok: true });
    const from = { building: well, side: 'north' as const };
    const to = { building: bk, side: 'south' as const };
    const cells = proposePath(s.run.team, content, from, to, [], 0);
    expect(cells).not.toBeNull();
    expect(await s.act({ t: 'add', from, to, cells: cells as never })).toEqual({
      ok: true,
    });
    return { s, ctl, well, bk };
  }

  function firstFitAbove(
    team: TeamState,
    id: number,
    near: { x: number; y: number },
  ): Cell {
    // A free spot a few cells north of the well, for the barracks.
    for (let dy = 3; dy < 8; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const at = { x: near.x + dx, y: near.y + dy };
        const free = firstFit(team, id, 0, (c) => c.x !== at.x || c.y !== at.y);
        if (free.x === at.x && free.y === at.y) return at;
      }
    }
    throw new Error('no place for the barracks');
  }

  test('the setting changes and the conduit is detached, with the text', async () => {
    const { s, ctl, well } = await wired();
    expect(s.run.team.conduits).toHaveLength(1);
    await ctl.setResource(well, 'res_b');
    expect(stored(s, well)?.resource).toBe('res_b');
    expect(s.run.team.conduits).toHaveLength(0);
    expect(ctl.model.get().ui.status.text).toContain('1 conduit was detached');
    expect(ctl.model.get().ui.status.text).toContain(
      resourceName(content, 'res_b'),
    );
  });

  test('undo puts back the old resource and the conduit; redo changes it again', async () => {
    const { s, ctl, well } = await wired();
    const before = JSON.stringify(s.run.team);
    await ctl.setResource(well, 'res_c');
    const after = JSON.stringify(s.run.team);
    expect(after).not.toBe(before);
    expect((await s.undo())?.ok).toBe(true);
    expect(stored(s, well)?.resource).toBe('res_a');
    expect(s.run.team.conduits).toHaveLength(1);
    expect(JSON.stringify(s.run.team)).toBe(before);
    expect((await s.redo())?.ok).toBe(true);
    expect(JSON.stringify(s.run.team)).toBe(after);
  });

  test('the same resource does nothing and is not recorded', async () => {
    const { s, ctl, well } = await wired();
    const undo = s.stack.undoCount;
    await ctl.setResource(well, 'res_a');
    expect(s.stack.undoCount).toBe(undo);
    expect(s.run.team.conduits).toHaveLength(1);
  });

  test('undoing the placement returns the well, and redo places it with its setting', async () => {
    const { s, ctl, well } = await withWell();
    await placeByHand(s, ctl, well, 'res_b');
    expect((await s.undo())?.ok).toBe(true);
    expect(stored(s, well)).toBeUndefined();
    expect((await s.redo())?.ok).toBe(true);
    expect(stored(s, well)?.resource).toBe('res_b');
  });

  test('undoing a return puts the setting back', async () => {
    const { s, ctl, well } = await withWell();
    await placeByHand(s, ctl, well, 'res_c');
    ctl.select({ kind: 'building', id: well });
    await ctl.returnSelected();
    expect(stored(s, well)).toBeUndefined();
    expect((await s.undo())?.ok).toBe(true);
    expect(stored(s, well)?.resource).toBe('res_c');
  });

  test('a Ready player cannot change it', async () => {
    const { s, ctl, well } = await wired();
    expect((await s.dispatch({ type: 'ready' })).ok).toBe(true);
    await ctl.setResource(well, 'res_b');
    expect(stored(s, well)?.resource).toBe('res_a');
    expect(ctl.model.get().ui.status.kind).toBe('error');
  });
});
