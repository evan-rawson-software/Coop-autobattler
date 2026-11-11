import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import type { SaveRecord } from '@game/session';
import { runSaveStoreConformance } from '@game/session/testing';
import { openIndexedDbStores } from './idb-store.js';
import { StaleSaveError } from './local-storage-store.js';

runSaveStoreConformance('IndexedDB store', async () => {
  const stores = await openIndexedDbStores(new IDBFactory());
  return stores.saves;
});

function record(runId: string, counter: number, round = 1): SaveRecord {
  return {
    saveFormatVersion: 1,
    runId,
    runVersion: '0.1',
    installedVersionAtSave: '0.1.0',
    actionCounter: counter,
    hostName: 'Ann',
    playerNames: ['Ann'],
    createArgs: {
      runId,
      runVersion: '0.1',
      seed: 1,
      players: ['Ann'],
      host: 0,
    },
    state: {
      runId,
      actionCounter: counter,
      round,
    } as unknown as SaveRecord['state'],
    summary: { round, lives: 5, step: 'build', outcome: null },
    updatedAt: 10 + counter,
  };
}

describe('IndexedDB store: stale writes', () => {
  test('a write that would overwrite newer progress is refused and reported', async () => {
    const factory = new IDBFactory();
    const stale: string[] = [];
    const tab = await openIndexedDbStores(factory, {
      rejectStale: true,
      onStale: (id) => stale.push(id),
    });
    await tab.saves.put(record('a', 0));
    await tab.saves.put(record('a', 1));
    await tab.saves.put(record('a', 2, 7));
    // Another tab (same database) saved step 3; this one still thinks it is at 2.
    const other = await openIndexedDbStores(factory, { rejectStale: true });
    await other.saves.put(record('a', 3, 8));
    await expect(tab.saves.put(record('a', 3, 9))).rejects.toBeInstanceOf(
      StaleSaveError,
    );
    await expect(tab.saves.put(record('a', 2, 9))).rejects.toBeInstanceOf(
      StaleSaveError,
    );
    expect(stale).toEqual(['a', 'a']);
    const kept = (await tab.saves.get('a')) as SaveRecord;
    expect(kept.actionCounter).toBe(3);
    expect(kept.summary.round).toBe(8);
  });

  test('without the option the plain store rewrites freely', async () => {
    const stores = await openIndexedDbStores(new IDBFactory());
    await stores.saves.put(record('a', 5));
    await stores.saves.put(record('a', 5, 2));
    expect(((await stores.saves.get('a')) as SaveRecord).summary.round).toBe(2);
  });

  test('a stale write for one run does not affect another', async () => {
    const stores = await openIndexedDbStores(new IDBFactory(), {
      rejectStale: true,
    });
    await stores.saves.put(record('a', 4));
    await stores.saves.put(record('b', 0));
    await stores.saves.put(record('b', 1));
    expect((await stores.saves.list()).map((x) => x.runId).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  test('onWritten is called for puts and removes', async () => {
    const seen: string[] = [];
    const stores = await openIndexedDbStores(new IDBFactory(), {
      onWritten: (id) => seen.push(id),
    });
    await stores.saves.put(record('a', 0));
    await stores.saves.remove('a');
    expect(seen).toEqual(['a', 'a']);
  });

  test('a stored value that is not a record is listed as damaged and returned as is', async () => {
    const factory = new IDBFactory();
    const stores = await openIndexedDbStores(factory, { dbName: 'x' });
    await stores.saves.put({ runId: 'bad' } as unknown as SaveRecord);
    const [item] = await stores.saves.list();
    expect(item?.corrupt).toBe(true);
    expect(await stores.saves.get('bad')).toEqual({ runId: 'bad' });
  });
});

describe('IndexedDB store: finished runs', () => {
  test('keeps a final state by run id', async () => {
    const stores = await openIndexedDbStores(new IDBFactory());
    expect(await stores.finished.get('r')).toBeNull();
    const state = { runId: 'r', round: 3 } as unknown as SaveRecord['state'];
    await stores.finished.put({ runId: 'r', state, finishedAt: 5 });
    expect((await stores.finished.get('r'))?.state).toEqual(state);
  });
});
