import { runSaveStoreConformance } from '@game/session/testing';
import { describe, expect, test } from 'vitest';
import {
  createLocalStorageSaveStore,
  createMemoryStorage,
  saveKey,
  StaleSaveError,
  STALE_MESSAGE,
  usableStorage,
  watchSaveKey,
} from './local-storage-store.js';

runSaveStoreConformance(
  'localStorage store (in-memory shim)',
  () => createLocalStorageSaveStore(createMemoryStorage()),
  () =>
    createLocalStorageSaveStore(createMemoryStorage(), undefined, {
      rejectStale: true,
    }),
);

describe('localStorage store details', () => {
  test('records survive a new store over the same storage (a reload)', async () => {
    const storage = createMemoryStorage();
    const a = createLocalStorageSaveStore(storage);
    storage.setItem('coop:save:x', JSON.stringify({ hello: 1 }));
    const b = createLocalStorageSaveStore(storage);
    expect(await b.get('x')).toEqual({ hello: 1 });
    expect((await a.list())[0]).toMatchObject({ corrupt: true, runId: 'x' });
  });

  test('a value that is not JSON is listed as corrupt, not lost', async () => {
    const storage = createMemoryStorage();
    storage.setItem('coop:save:bad', '{not json');
    const s = createLocalStorageSaveStore(storage);
    expect(await s.get('bad')).toBe('{not json');
    expect((await s.list())[0]).toMatchObject({ corrupt: true, runId: 'bad' });
  });

  test('a failed write (quota) leaves the old record intact', async () => {
    const storage = createMemoryStorage();
    const s = createLocalStorageSaveStore(storage);
    await s.put({ runId: 'a', updatedAt: 1, marker: 'old' } as never);
    const real = storage.setItem.bind(storage);
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    await expect(
      s.put({ runId: 'a', updatedAt: 2, marker: 'new' } as never),
    ).rejects.toThrow(/Quota/);
    storage.setItem = real;
    expect(await s.get('a')).toMatchObject({ marker: 'old' });
  });

  test('prefix keeps other keys out of the list', async () => {
    const storage = createMemoryStorage();
    storage.setItem('other:save:z', '{}');
    const s = createLocalStorageSaveStore(storage);
    expect(await s.list()).toEqual([]);
  });
});

describe('refusing a stale write (another tab saved first)', () => {
  const rec = (actionCounter: number, marker: string): never =>
    ({ runId: 'a', updatedAt: actionCounter, actionCounter, marker }) as never;

  test('a record with a higher counter is written; equal or lower is refused', async () => {
    const storage = createMemoryStorage();
    let stale = 0;
    const s = createLocalStorageSaveStore(storage, undefined, {
      rejectStale: true,
      onStale: () => (stale += 1),
    });
    await s.put(rec(3, 'first'));
    await s.put(rec(4, 'next'));
    await expect(s.put(rec(4, 'competing'))).rejects.toBeInstanceOf(
      StaleSaveError,
    );
    await expect(s.put(rec(2, 'older'))).rejects.toThrow(STALE_MESSAGE);
    expect(stale).toBe(2);
    expect(await s.get('a')).toMatchObject({ marker: 'next' });
  });

  test('the first save of a run, and a damaged stored value, can be written', async () => {
    const storage = createMemoryStorage();
    const s = createLocalStorageSaveStore(storage, undefined, {
      rejectStale: true,
    });
    await s.put(rec(0, 'new'));
    storage.setItem(saveKey('a'), '{not json');
    await s.put(rec(0, 'over damage'));
    expect(await s.get('a')).toMatchObject({ marker: 'over damage' });
  });

  test('two stores over one storage: the second tab write is refused', async () => {
    const storage = createMemoryStorage();
    const opts = { rejectStale: true } as const;
    const tabA = createLocalStorageSaveStore(storage, undefined, opts);
    const tabB = createLocalStorageSaveStore(storage, undefined, opts);
    await tabA.put(rec(5, 'both start here'));
    await tabA.put(rec(6, 'A re-rolled'));
    await expect(tabB.put(rec(6, 'B bought'))).rejects.toBeInstanceOf(
      StaleSaveError,
    );
    expect(await tabB.get('a')).toMatchObject({ marker: 'A re-rolled' });
  });

  test('without the option the plain store still replaces (conformance behaviour)', async () => {
    const s = createLocalStorageSaveStore(createMemoryStorage());
    await s.put(rec(1, 'x'));
    await s.put(rec(1, 'y'));
    expect(await s.get('a')).toMatchObject({ marker: 'y' });
  });
});

describe('watching the run key for changes from other tabs', () => {
  test('fires for the key and for clear(), not for other keys or areas', () => {
    const target = new EventTarget();
    const area = {};
    let n = 0;
    const stop = watchSaveKey(target, area, 'coop:save:x', () => (n += 1));
    const fire = (key: string | null, storageArea: unknown): void => {
      target.dispatchEvent(
        Object.assign(new Event('storage'), { key, storageArea }),
      );
    };
    fire('coop:save:x', area);
    fire(null, area);
    fire('coop:save:y', area);
    fire('coop:save:x', {});
    expect(n).toBe(2);
    stop();
    fire('coop:save:x', area);
    expect(n).toBe(2);
  });

  test('a storage that throws is reported as unusable', () => {
    const bad = createMemoryStorage();
    bad.setItem = () => {
      throw new Error('blocked');
    };
    expect(usableStorage(bad)).toBeNull();
    expect(usableStorage(createMemoryStorage())).not.toBeNull();
  });
});
