import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import type { GhostSnapshot } from '@game/core';
import {
  createIdbGhostStore,
  createLocalStorageGhostStore,
  openGhostDb,
} from './ghost-pool.js';
import { createServices, gameDeps, type ServiceEnv } from './services.js';
import {
  createMemoryStorage,
  type StorageLike,
} from './local-storage-store.js';
import { RUN_VERSION } from './version.js';

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

const snap = (owner: string, version: string): GhostSnapshot =>
  ({
    gameVersion: version,
    partySize: 2,
    round: 3,
    owner: { id: owner, label: owner },
    runId: `run-${owner}`,
  }) as unknown as GhostSnapshot;

describe('start-up clean-up of the local ghost pool (TA-8, PP-17)', () => {
  test('rows of older game versions are removed, the current version is untouched', async () => {
    const factory = new IDBFactory();
    const pool = createIdbGhostStore(await openGhostDb(factory));
    await pool.save(snap('ann', '0.1'));
    await pool.save(snap('bob', '0.1'));
    await pool.save(snap('cy', RUN_VERSION));
    const services = await createServices(env(factory), gameDeps());
    expect(services.ghostStorage).toBe('indexeddb');
    const check = createIdbGhostStore(await openGhostDb(factory));
    const bucket = { partySize: 2, round: 3 };
    expect(await check.list({ gameVersion: '0.1', ...bucket })).toEqual([]);
    expect(
      await check.list({ gameVersion: RUN_VERSION, ...bucket }),
    ).toHaveLength(1);
  });

  test('a purge that rejects does not block start-up', async () => {
    const ls = createMemoryStorage();
    await createLocalStorageGhostStore(ls).save(snap('ann', '0.1'));
    const failing: StorageLike = {
      get length() {
        return ls.length;
      },
      key: (i) => ls.key(i),
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => {
        ls.setItem(k, v);
      },
      removeItem: (k) => {
        if (k.includes('ghost')) throw new Error('remove failed');
        ls.removeItem(k);
      },
    };
    const services = await createServices(
      { ...env(new IDBFactory()), indexedDB: null, localStorage: failing },
      gameDeps(),
    );
    expect(services.ghostStorage).toBe('local');
  });
});
