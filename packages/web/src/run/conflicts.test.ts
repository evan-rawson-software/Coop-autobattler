import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { startRun } from '@game/session';
import {
  createServices,
  gameDeps,
  getServices,
  type ServiceEnv,
} from './services.js';
import { closeRun, discardSavedRun, runStore, showRun } from './run-store.js';
import { INSTALLED_VERSION, RUN_VERSION } from './version.js';

Object.assign(globalThis, { IDBKeyRange });

type Listener = (e: Event) => void;

function fakeWindow() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, fn: Listener) {
      let set = listeners.get(type);
      if (set === undefined) listeners.set(type, (set = new Set()));
      set.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, extra: Record<string, unknown> = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) {
        fn(Object.assign(new Event(type), extra));
      }
    },
  };
}

function env(
  idb: IDBFactory,
  win: ServiceEnv['window'] = null,
  tabId = 't',
): ServiceEnv {
  return {
    indexedDB: idb,
    localStorage: null,
    broadcast: null,
    window: win,
    now: () => 1_000,
    tabId,
  };
}

const spec = (runId: string, seed = 9) => ({
  runId,
  runVersion: RUN_VERSION,
  seed,
  players: ['You'],
  host: 0,
});

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('a page restored from the back/forward cache', () => {
  test('a restored page whose save changed meanwhile is told, an unchanged one is not', async () => {
    const factory = new IDBFactory();
    const win = fakeWindow();
    const a = await createServices(env(factory, win, 'a'), gameDeps());
    const started = await startRun(
      spec('r'),
      gameDeps(),
      a.saves,
      1,
      INSTALLED_VERSION,
    );
    if (!started.ok) throw new Error('start');
    let told = 0;
    a.watch('r', () => {
      told += 1;
    });
    // Restored from the cache, nothing saved elsewhere: no conflict.
    win.dispatch('pageshow', { persisted: true });
    await tick();
    expect(told).toBe(0);
    // Another tab saves a later step.
    const b = await createServices(env(factory, null, 'b'), gameDeps());
    const there = await b.saves.get('r');
    expect(there).not.toBeNull();
    await b.saves.put({
      ...(there as object),
      actionCounter: 5,
    } as never);
    // A normal page show is ignored.
    win.dispatch('pageshow', { persisted: false });
    await tick();
    expect(told).toBe(0);
    // Restored from the cache after that save: conflict.
    win.dispatch('pageshow', { persisted: true });
    await tick();
    expect(told).toBe(1);
  });
});

describe('two tabs on one empty store', () => {
  test('starting the same run at the same moment lets exactly one write', async () => {
    const factory = new IDBFactory();
    const a = await createServices(env(factory, null, 'a'), gameDeps());
    const b = await createServices(env(factory, null, 'b'), gameDeps());
    let toldA = 0;
    let toldB = 0;
    a.watch('r', () => {
      toldA += 1;
    });
    b.watch('r', () => {
      toldB += 1;
    });
    const [ra, rb] = await Promise.all([
      startRun(spec('r'), gameDeps(), a.saves, 1, INSTALLED_VERSION),
      startRun(spec('r'), gameDeps(), b.saves, 1, INSTALLED_VERSION),
    ]);
    const winners = [ra, rb].filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    // The loser is the tab that is told; the winner is not.
    expect(toldA + toldB).toBe(1);
    expect(ra.ok ? toldA : toldB).toBe(0);
    expect(await a.saves.get('r')).not.toBeNull();
  });
});

describe('the unopenable-save panel', () => {
  test('Remove save never deletes a run another tab put there meanwhile', async () => {
    const services = await getServices();
    await services.saves.put({ runId: 'blocked-1' } as never);
    await showRun('blocked-1', { fresh: true });
    expect(runStore.get().status).toBe('blocked');
    // Another tab starts a real run under the same key.
    const elsewhere = await createServices(env(new IDBFactory()), gameDeps());
    const other = await startRun(
      spec('blocked-1', 4),
      gameDeps(),
      elsewhere.saves,
      2,
      INSTALLED_VERSION,
    );
    expect(other.ok).toBe(true);
    await services.saves.put((await elsewhere.saves.get('blocked-1')) as never);
    const r = await discardSavedRun('blocked-1');
    expect(r.ok).toBe(false);
    expect(await services.saves.get('blocked-1')).not.toBeNull();
    await tick();
    expect(runStore.get().status).toBe('ready');
    closeRun();
  });
});
