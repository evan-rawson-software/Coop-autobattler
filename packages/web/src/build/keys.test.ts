import { describe, expect, test } from 'vitest';
import {
  BuildController,
  DRY_TICKS_MAX,
  DRY_TICKS_MIN,
  clampDryTicks,
} from './build-controller.js';
import { buildRun, firstFit, stashIds } from './test-helpers.js';
import { content } from '../content.js';
import { deriveProblems } from './view-model.js';

const key = (k: string, ctrl = false) => ({
  key: k,
  ctrlKey: ctrl,
  shiftKey: false,
  metaKey: false,
});

async function withWall() {
  const s = await buildRun();
  const ctl = new BuildController();
  ctl.attach(s);
  const id = s.run.team.stash.find((x) => x.def.startsWith('bld_wall_'))
    ?.id as number;
  const c = firstFit(s.run.team, id);
  const r = await s.act({ t: 'place', id, x: c.x, y: c.y, rotation: 0 });
  expect(r.ok).toBe(true);
  return { s, ctl, id };
}

describe('Build keyboard', () => {
  test.each(['Delete', 'Backspace'])(
    '%s returns the selected building to the stash',
    async (k) => {
      const { s, ctl, id } = await withWall();
      ctl.select({ kind: 'building', id });
      expect(ctl.key(key(k))).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(s.run.team.buildings.some((b) => b.id === id)).toBe(false);
      expect(s.run.team.stash.some((x) => x.id === id)).toBe(true);
      expect(ctl.model.get().ui.selection).toBeNull();
    },
  );

  test('Delete with nothing selected does nothing', async () => {
    const { ctl } = await withWall();
    expect(ctl.key(key('Delete'))).toBe(false);
  });

  test('Ctrl+Y redoes like Ctrl+Shift+Z', async () => {
    const { s, ctl } = await withWall();
    await s.undo();
    expect(s.store.get().redoCount).toBe(1);
    ctl.key(key('y', true));
    await new Promise((r) => setTimeout(r, 0));
    expect(s.store.get().redoCount).toBe(0);
  });
});

describe('Test run length', () => {
  test('is clamped to the step and the limits', () => {
    expect(clampDryTicks(0, 600)).toBe(DRY_TICKS_MIN);
    expect(clampDryTicks(-300, 600)).toBe(DRY_TICKS_MIN);
    expect(clampDryTicks(1e9, 600)).toBe(DRY_TICKS_MAX);
    expect(clampDryTicks(620, 600)).toBe(600);
    expect(clampDryTicks(Number.NaN, 600)).toBe(600);
  });

  test('the controller keeps the clamped value', async () => {
    const { ctl } = await withWall();
    ctl.setDryTicks(0);
    expect(ctl.model.get().ui.dryTicks).toBe(DRY_TICKS_MIN);
  });
});

describe('Problems', () => {
  test('the free-nodes reminder names a stash source to pick up', async () => {
    const s = await buildRun();
    const p = deriveProblems(s.run.team, content, null).find(
      (x) => x.kind === 'free_nodes',
    );
    expect(p?.pick).toBe(stashIds(s.run.team, 'bld_extractor')[0]);
    expect(p?.focus).not.toBeNull();
  });
});

describe('Status message', () => {
  test('about a step is dropped when the step changes', async () => {
    const s = await buildRun();
    const ctl = new BuildController();
    ctl.attach(s);
    await ctl.toggleReady();
    expect(ctl.model.get().ui.status.text).toMatch(
      /^Everyone is ready: on to the .+\.$/,
    );
    expect(ctl.model.get().ui.status.text).not.toMatch(/_/);
    ctl.clearStaleStatus('pve_battle');
    expect(ctl.model.get().ui.status.text).toBe('');
  });
});
