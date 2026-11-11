import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { runGhostStoreConformance } from '@game/session/testing';
import type { GhostSnapshot } from '@game/core';
import {
  createIdbGhostStore,
  createLocalStorageGhostStore,
  installOwnerId,
  openGhostDb,
  openGhostStore,
  ownerLabelFor,
} from './ghost-pool.js';
import { createMemoryStorage } from './local-storage-store.js';
import { opponentText } from '../shop/view-model.js';

runGhostStoreConformance('IndexedDB ghost store', async () =>
  createIdbGhostStore(await openGhostDb(new IDBFactory())),
);

runGhostStoreConformance('localStorage ghost store (in-memory shim)', () =>
  createLocalStorageGhostStore(createMemoryStorage()),
);

const B = { gameVersion: '0.1', partySize: 1, round: 1 };
const snap = (owner: string): GhostSnapshot =>
  ({
    formatVersion: 1,
    gameVersion: '0.1',
    partySize: 1,
    round: 1,
    owner: { id: owner, label: owner },
    runId: `run-${owner}`,
  }) as unknown as GhostSnapshot;

describe('browser ghost pool', () => {
  test('snapshots survive reopening the database and a new store over the same storage', async () => {
    const factory = new IDBFactory();
    const a = createIdbGhostStore(await openGhostDb(factory));
    await a.save(snap('ann'));
    const b = createIdbGhostStore(await openGhostDb(factory));
    expect(await b.list(B)).toHaveLength(1);
    const ls = createMemoryStorage();
    await createLocalStorageGhostStore(ls).save(snap('ann'));
    expect(await createLocalStorageGhostStore(ls).list(B)).toHaveLength(1);
  });

  test('a damaged localStorage value is returned as it is, not lost', async () => {
    const ls = createMemoryStorage();
    ls.setItem('coop:ghost:x', '{not json');
    const s = createLocalStorageGhostStore(ls);
    expect(await s.list(B)).toEqual([]);
    await s.clear();
    expect(ls.getItem('coop:ghost:x')).toBeNull();
  });

  test('falls back: IndexedDB, then localStorage, then memory', async () => {
    const idb = await openGhostStore({
      indexedDB: new IDBFactory(),
      localStorage: createMemoryStorage(),
    });
    expect(idb.kind).toBe('indexeddb');
    const failing = {
      open: () => {
        throw new Error('no idb');
      },
    } as unknown as IDBFactory;
    const local = await openGhostStore({
      indexedDB: failing,
      localStorage: createMemoryStorage(),
    });
    expect(local.kind).toBe('local');
    const mem = await openGhostStore({ indexedDB: null, localStorage: null });
    expect(mem.kind).toBe('memory');
    await mem.store.save(snap('ann'));
    expect(await mem.store.list(B)).toHaveLength(1);
  });

  test('the install owner id is stable and anonymous', () => {
    const ls = createMemoryStorage();
    const id = installOwnerId(ls);
    expect(installOwnerId(ls)).toBe(id);
    expect(installOwnerId(null)).not.toBe('');
    expect(ownerLabelFor(id)).toMatch(/^Runner /);
  });

  test('the opponent line says ghost or boss, or that it is not known yet', () => {
    expect(opponentText({ pvpOpponent: null, round: 1 })).toMatch(/unknown/i);
    expect(
      opponentText({
        round: 1,
        pvpOpponent: {
          round: 1,
          kind: 'ghost',
          label: 'Runner ab12',
          ghost: null,
        },
      }),
    ).toBe('Opponent: a ghost of Runner ab12');
    expect(
      opponentText({
        round: 1,
        pvpOpponent: { round: 1, kind: 'boss', label: 'the boss', ghost: null },
      }),
    ).toBe('Opponent: the boss (no ghost available)');
  });
});
