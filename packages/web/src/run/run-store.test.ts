import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { hashJson } from '@game/core';
import {
  buildSaveRecord,
  openRun,
  startRun,
  type RunState,
} from '@game/session';
import { reachStep } from './test-run.js';
import {
  gameDeps,
  createServices,
  type ServiceEnv,
  type StorageStatus,
} from './services.js';
import { createStore } from '../app-state.js';
import { createMemoryStorage } from './local-storage-store.js';
import {
  abandonSavedRun,
  closeRun,
  createNewRun,
  RETRY_MESSAGE,
  discardSavedRun,
  runStore,
  showRun,
} from './run-store.js';
import { INSTALLED_VERSION, RUN_VERSION } from './version.js';

Object.assign(globalThis, { IDBKeyRange });

function env(idb: IDBFactory): ServiceEnv {
  return {
    indexedDB: idb,
    localStorage: null,
    broadcast: null,
    window: null,
    now: () => 1_000,
    tabId: 't',
  };
}

describe('saved runs in IndexedDB, as a page reload sees them', () => {
  test('several runs are saved at once, each listed once, and survive a reload', async () => {
    const factory = new IDBFactory();
    const a = await createServices(env(factory), gameDeps());
    expect(a.storage).toBe('indexeddb');
    const ids = ['r1', 'r2', 'r3'];
    for (const [i, runId] of ids.entries()) {
      const r = await startRun(
        {
          runId,
          runVersion: RUN_VERSION,
          seed: 5 + i,
          players: ['You'],
          host: 0,
        },
        gameDeps(),
        a.saves,
        100 + i,
        INSTALLED_VERSION,
      );
      expect(r.ok).toBe(true);
    }
    // "Close the browser": a new set of services over the same database.
    const b = await createServices(env(factory), gameDeps());
    const list = await b.saves.list();
    expect(list.map((x) => x.runId).sort()).toEqual(ids);
    for (const item of list) {
      expect(item.corrupt).toBe(false);
      if (!item.corrupt) expect(item.summary.step).toBe('core_placement');
    }
  });

  test('a reopened run is in the same step and the same state', async () => {
    const factory = new IDBFactory();
    const a = await createServices(env(factory), gameDeps());
    const started = await startRun(
      {
        runId: 'r',
        runVersion: RUN_VERSION,
        seed: 9,
        players: ['You'],
        host: 0,
      },
      gameDeps(),
      a.saves,
      1,
      INSTALLED_VERSION,
    );
    if (!started.ok) throw new Error('start');
    // Play to a shop through the controller, saving every action.
    const target: RunState = reachStep('shop', 9);
    for (const entry of target.actionLog) {
      const r = await started.controller.dispatch(
        entry.player,
        entry.intent as never,
        2,
      );
      expect(r.ok).toBe(true);
    }
    const before = started.controller.state;
    expect(before.step).toBe('shop');

    const b = await createServices(env(factory), gameDeps());
    const opened = await openRun('r', gameDeps(), b.saves, INSTALLED_VERSION);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.controller.state.step).toBe('shop');
      expect(hashJson(opened.controller.state)).toBe(hashJson(before));
      expect(opened.versionNotice).toBe(false);
    }
  });

  test('a second tab with a stale view is refused and told', async () => {
    const factory = new IDBFactory();
    const a = await createServices(env(factory), gameDeps());
    let told = 0;
    a.watch('r', () => {
      told += 1;
    });
    const started = await startRun(
      {
        runId: 'r',
        runVersion: RUN_VERSION,
        seed: 9,
        players: ['You'],
        host: 0,
      },
      gameDeps(),
      a.saves,
      1,
      INSTALLED_VERSION,
    );
    if (!started.ok) throw new Error('start');
    // Another tab opens the same run and makes the next move first.
    const other = await createServices(env(factory), gameDeps());
    const there = await openRun(
      'r',
      gameDeps(),
      other.saves,
      INSTALLED_VERSION,
    );
    if (!there.ok) throw new Error('open');
    const target = reachStep('build', 9);
    const first = target.actionLog[0];
    if (first === undefined) throw new Error('log');
    expect(
      (await there.controller.dispatch(0, first.intent as never, 2)).ok,
    ).toBe(true);
    // This tab still thinks it is at the start and makes a different move.
    const stale = await started.controller.dispatch(
      0,
      { type: 'propose_core', x: 0, y: 0 },
      3,
    );
    expect(stale).toMatchObject({ ok: false, reason: 'save_failed' });
    expect(told).toBe(1);
    expect(started.controller.state.step).toBe('core_placement');
  });
});

describe('the run store', () => {
  test('a new run is saved, listed, and shown at its step', async () => {
    const r = await createNewRun(12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = runStore.get();
    expect(st.status).toBe('ready');
    if (st.status !== 'ready') return;
    expect(st.run.runId).toBe(r.runId);
    expect(st.run.session.run.step).toBe('core_placement');
    expect(st.run.session.run.seed).toBe(12);
    closeRun();
    expect(runStore.get().status).toBe('idle');
    // Opening it again goes to the same step (the saved copy is the truth).
    await showRun(r.runId);
    const again = runStore.get();
    expect(again.status === 'ready' && again.run.session.run.step).toBe(
      'core_placement',
    );
    closeRun();
  });

  test('abandoning from the list ends the run on the Run over screen, and it stays there', async () => {
    const made = await createNewRun(13);
    if (!made.ok) throw new Error(made.message);
    closeRun();
    const r = await abandonSavedRun(made.runId);
    expect(r.ok).toBe(true);
    if (!r.ok || r.state === null) return;
    expect(r.state.step).toBe('run_over');
    expect(r.state.outcome?.reason).toBe('abandoned');
    // A reload finds no save, but the final state is kept.
    await showRun(made.runId, { fresh: true });
    const st = runStore.get();
    expect(st.status).toBe('over');
    if (st.status === 'over')
      expect(st.state.outcome?.reason).toBe('abandoned');
    closeRun();
  });

  test('an unknown run is reported as missing, never created', async () => {
    await showRun('nope', { fresh: true });
    expect(runStore.get().status).toBe('missing');
    closeRun();
  });

  test('a damaged save is blocked, kept, and can be discarded on purpose', async () => {
    const { getServices } = await import('./services.js');
    const services = await getServices();
    await services.saves.put({ runId: 'broken' } as never);
    await showRun('broken', { fresh: true });
    const st = runStore.get();
    expect(st.status).toBe('blocked');
    expect((await services.saves.get('broken')) !== null).toBe(true);
    const r = await discardSavedRun('broken');
    expect(r.ok).toBe(true);
    expect(await services.saves.get('broken')).toBeNull();
    closeRun();
  });
});

describe('abandoning and removing saves, by kind of row', () => {
  async function seed(
    runId: string,
    change: (s: RunState) => Record<string, unknown>,
    version = '0.1',
  ): Promise<void> {
    const { getServices } = await import('./services.js');
    const services = await getServices();
    const base = reachStep('build', 3);
    const state = { ...base, runId, ...change(base) } as unknown as RunState;
    const record = buildSaveRecord(
      {
        runId,
        runVersion: version,
        seed: 3,
        players: ['You'],
        host: 0,
      },
      state,
      INSTALLED_VERSION,
      5,
    );
    await services.saves.put(record);
  }

  async function stored(runId: string): Promise<boolean> {
    const { getServices } = await import('./services.js');
    return (await (await getServices()).saves.get(runId)) !== null;
  }

  test('a readable run is abandoned (not removed) and gets its summary', async () => {
    await seed('readable', () => ({}));
    const refused = await discardSavedRun('readable');
    expect(refused.ok).toBe(false);
    expect(await stored('readable')).toBe(true);
    const r = await abandonSavedRun('readable');
    expect(r.ok && r.state?.outcome?.reason).toBe('abandoned');
    expect(await stored('readable')).toBe(false);
    closeRun();
  });

  test.each([
    ['an unsupported format', 'unsupported', { formatVersion: 1 }, '0.1'],
    ['a newer version', 'newer', { runVersion: '9.0' }, '9.0'],
    ['a damaged save', 'damaged', { actionCounter: 'x' }, '0.1'],
  ])(
    '%s cannot be abandoned, and "Remove save" deletes it with no record',
    async (_name, runId, change, version) => {
      const { getServices } = await import('./services.js');
      const services = await getServices();
      await seed(runId, () => change, version);
      const historyBefore = (await services.saves.listHistory()).length;
      const abandoned = await abandonSavedRun(runId);
      expect(abandoned.ok).toBe(false);
      expect(await stored(runId)).toBe(true);
      const removed = await discardSavedRun(runId);
      expect(removed).toEqual({ ok: true, state: null });
      expect(await stored(runId)).toBe(false);
      expect((await services.saves.listHistory()).length).toBe(historyBefore);
      closeRun();
    },
  );

  test('a storage read failure removes nothing and says to retry', async () => {
    const { getServices } = await import('./services.js');
    const services = await getServices();
    await seed('flaky', () => ({}));
    const realGet = services.saves.get.bind(services.saves);
    services.saves.get = (id: string) =>
      id === 'flaky' ? Promise.reject(new Error('busy')) : realGet(id);
    try {
      const a = await abandonSavedRun('flaky');
      expect(a).toEqual({ ok: false, message: RETRY_MESSAGE });
      const d = await discardSavedRun('flaky');
      expect(d).toEqual({ ok: false, message: RETRY_MESSAGE });
    } finally {
      services.saves.get = realGet;
    }
    expect(await stored('flaky')).toBe(true);
    closeRun();
  });
});

describe('when IndexedDB cannot be used', () => {
  test('the fallback storage is named, and the note says other saves are not visible', async () => {
    const status = createStore<StorageStatus>({
      blocked: false,
      reloadNeeded: false,
      fallbackNote: null,
    });
    const broken = {
      open: () => {
        throw new Error('The database is locked');
      },
    } as unknown as IDBFactory;
    const services = await createServices(
      {
        indexedDB: broken,
        localStorage: createMemoryStorage(),
        broadcast: null,
        window: null,
        now: () => 1,
        tabId: 't',
      },
      gameDeps(),
      status,
    );
    expect(services.storage).toBe('local');
    expect(services.fallback).toBe('The database is locked');
    const note = status.get().fallbackNote ?? '';
    expect(note).toMatch(/local storage/);
    expect(note).toMatch(/other storage are not shown here/);
    expect(note).toMatch(/database is locked/);
  });

  test('IndexedDB in use needs no note', async () => {
    const status = createStore<StorageStatus>({
      blocked: false,
      reloadNeeded: false,
      fallbackNote: null,
    });
    const s = await createServices(env(new IDBFactory()), gameDeps(), status);
    expect(s.fallback).toBeNull();
    expect(status.get().fallbackNote).toBeNull();
  });
});
