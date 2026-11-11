import { describe, expect, test } from 'vitest';
import { BuildController } from '../build/build-controller.js';
import { READY_LOCK_TEXT } from '../build/lock.js';
import { loadShopRun, optionsFromUrl, shopRunId } from './shop-run.js';

const KEY_C = { key: 'c', ctrlKey: false, shiftKey: false, metaKey: false };

describe('the two-player sample route', () => {
  test('?players=2 picks the two-player run', () => {
    expect(optionsFromUrl('?players=2').players).toBe(2);
    expect(optionsFromUrl('').players).toBe(1);
  });

  test('starts in a shop with two players; Ready keeps the undo history and the tools locked', async () => {
    const run = await loadShopRun({ storage: null, players: 2 });
    expect(run.runId).toBe(shopRunId('pvp', 2));
    expect(run.session.run.step).toBe('shop');
    expect(run.session.run.perPlayer).toHaveLength(2);

    const ctl = new BuildController();
    ctl.attach(run.session, true);
    const ui = () => ctl.model.get().ui;
    // Something on the undo stack, so a wrongly cleared history shows.
    run.session.stack.record({ t: 'return', id: 0 }, run.session.run.team);
    const depth = run.session.stack.undoCount;
    expect(depth).toBe(1);

    // Ready with the partner not ready: locked, and Undo leaves the history.
    expect((await run.session.dispatch({ type: 'ready' })).ok).toBe(true);
    expect(run.session.run.step).toBe('shop');
    await ctl.undo();
    expect(ui().status.text).toBe(READY_LOCK_TEXT);
    expect(run.session.stack.undoCount).toBe(depth);
    await ctl.redo();
    expect(ui().status.text).toBe(READY_LOCK_TEXT);
    // Tool keys do not reach a disabled tool.
    expect(ctl.key(KEY_C)).toBe(true);
    expect(ui().tool).toBe('select');

    // Unready reopens the tools.
    expect((await run.session.dispatch({ type: 'unready' })).ok).toBe(true);
    ctl.key(KEY_C);
    expect(ui().tool).toBe('conduit');
  });
});
