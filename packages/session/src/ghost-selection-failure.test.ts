/**
 * Review round 2 of #78: a failed automatic ghost selection is reported and
 * retried; `select_ghost` is offered only while a selection is owed; a store
 * value that throws cannot escape `presentCandidates`.
 */
import { describe, expect, test } from 'vitest';
import { fixedBattle } from './defaults.js';
import {
  begin,
  botRun,
  newRig,
  playUntil,
  type Game,
  type Rig,
} from './ghost-test-support.js';
import { SELECT_GHOST, ghostContext, presentCandidates } from './ghosts.js';
import { allowedIntents } from './selectors.js';
import type { SaveStore } from './save.js';
import { makeGameDeps } from './test-support.js';

const deps = makeGameDeps({
  ghosts: { ownerId: 'sel' },
  battle: fixedBattle(true),
});

/** A save store that refuses the write that records the chosen opponent. */
function flaky(rig: Rig, flag: { fail: boolean }): Rig {
  const inner = rig.saves;
  const saves: SaveStore = {
    ...inner,
    get: (id) => inner.get(id),
    put: async (rec) => {
      const s = rec.state;
      if (flag.fail && s.step === 'shop' && s.pvpOpponent !== null) {
        throw new Error('disk full');
      }
      await inner.put(rec);
    },
  };
  return { saves: saves as Rig['saves'], ghosts: rig.ghosts };
}

/** Play until the shop of a PvE leg is entered (the selection then fails). */
async function toShop(g: Game): Promise<void> {
  await playUntil(g, (s) => s.step === 'shop' && s.leg === 'pve');
}

describe('item 3: a failed automatic selection is surfaced and retried', () => {
  test('the dispatch reports the cause; the next call retries', async () => {
    const flag = { fail: true };
    const g = await begin(flaky(newRig(), flag), deps, { runId: 'sel-1' });
    await toShop(g);
    const s = g.controller.state;
    expect(s.step).toBe('shop');
    expect(s.pvpOpponent).toBeNull();
    expect(g.controller.selectionFailure?.reason).toBe('save_failed');

    // Leaving the shop is refused, and says why.
    const ready = await g.controller.dispatch(0, { type: 'ready' }, 5000);
    expect(ready.ok).toBe(false);
    if (!ready.ok) {
      expect(ready.reason).toBe('ghost_selection_pending');
      expect(ready.selectionFailure?.reason).toBe('save_failed');
    }

    // prepare retries (still failing) and reports it.
    const again = await g.controller.prepare(5001);
    expect(again?.reason).toBe('save_failed');

    // The cause goes away: prepare completes the selection.
    flag.fail = false;
    expect(await g.controller.prepare(5002)).toBeNull();
    expect(g.controller.state.pvpOpponent).not.toBeNull();
    expect(g.controller.selectionFailure).toBeNull();
    const ok = await g.controller.dispatch(0, { type: 'ready' }, 5003);
    expect(ok.ok).toBe(true);
  });

  test('the next dispatch also retries the selection', async () => {
    const flag = { fail: true };
    const g = await begin(flaky(newRig(), flag), deps, { runId: 'sel-2' });
    await toShop(g);
    expect(g.controller.state.pvpOpponent).toBeNull();
    flag.fail = false;
    const r = await g.controller.dispatch(0, { type: 'ready' }, 6000);
    expect(r.ok).toBe(true);
    expect(g.controller.selectionFailure).toBeNull();
  });
});

describe('item 4: nits', () => {
  const run = botRun(
    deps,
    { runId: 'nit', runVersion: '0.1', seed: 4, players: ['A', 'B'], host: 0 },
    1,
    (s) => s.step === 'shop' && s.leg === 'pve',
  );

  test('select_ghost is offered to the host only while a selection is pending', () => {
    const pending = run.state;
    expect(pending.pvpOpponent).toBeNull();
    expect(allowedIntents(pending, 0, deps)).toContain(SELECT_GHOST);
    expect(allowedIntents(pending, 1, deps)).not.toContain(SELECT_GHOST);
    const chosen = {
      ...pending,
      pvpOpponent: {
        round: pending.round,
        kind: 'boss' as const,
        label: 'the boss',
        ghost: null,
      },
    };
    expect(allowedIntents(chosen, 0, deps)).not.toContain(SELECT_GHOST);
    const build = { ...pending, step: 'build' as const };
    expect(allowedIntents(build, 0, deps)).not.toContain(SELECT_GHOST);
  });

  test('a store value that throws when read cannot escape presentCandidates', () => {
    const ctx = ghostContext(deps);
    if (ctx === null) throw new Error('ghosts are on');
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
        getPrototypeOf() {
          throw new Error('boom');
        },
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
    const getter = {
      get gameVersion(): string {
        throw new Error('boom');
      },
    };
    expect(() =>
      presentCandidates([hostile, getter, null, 5], run.state, ctx),
    ).not.toThrow();
    expect(presentCandidates([hostile, getter], run.state, ctx)).toEqual([]);
  });
});
