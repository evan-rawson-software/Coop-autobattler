import { runSaveStoreConformance } from '@game/session/testing';
import { describe, expect, test } from 'vitest';
import {
  createLocalStorageSaveStore,
  createMemoryStorage,
} from './local-storage-store.js';

runSaveStoreConformance('localStorage store (in-memory shim)', () =>
  createLocalStorageSaveStore(createMemoryStorage()),
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
