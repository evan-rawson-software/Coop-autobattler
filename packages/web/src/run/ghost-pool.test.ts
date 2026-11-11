import { readFileSync } from 'node:fs';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { runGhostStoreConformance } from '@game/session/testing';
import { ghostBucketKey, type GhostSnapshot } from '@game/core';
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

Object.assign(globalThis, { IDBKeyRange });

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

describe('ghost pool bounds', () => {
  const big = (owner: string, run: string, pad: number): GhostSnapshot =>
    ({
      ...snap(owner),
      runId: run,
      pad: 'x'.repeat(pad),
    }) as unknown as GhostSnapshot;
  const small = (owner: string, run: string): GhostSnapshot => ({
    ...snap(owner),
    runId: run,
  });
  const maxSize = (): number => 2000;
  const bucketKey = ghostBucketKey(B);

  test('localStorage: an oversized snapshot is refused at write time', async () => {
    const ls = createMemoryStorage();
    const s = createLocalStorageGhostStore(ls, undefined, { maxSize });
    await expect(s.save(big('ann', 'r1', 5000))).rejects.toThrow(/too large/);
    expect(ls.length).toBe(0);
    await s.save(small('ann', 'r2'));
    expect(await s.list(B)).toHaveLength(1);
  });

  test('IndexedDB: an oversized snapshot is refused at write time', async () => {
    const s = createIdbGhostStore(await openGhostDb(new IDBFactory()), {
      maxSize,
    });
    await expect(s.save(big('ann', 'r1', 5000))).rejects.toThrow(/too large/);
    expect(await s.list(B)).toEqual([]);
    await s.save(small('ann', 'r2'));
    expect(await s.list(B)).toHaveLength(1);
  });

  test('localStorage: list never reads the value of a row marked oversized', async () => {
    const ls = createMemoryStorage();
    const reads: string[] = [];
    const spy = {
      get length() {
        return ls.length;
      },
      key: (i: number) => ls.key(i),
      getItem: (k: string) => {
        reads.push(k);
        return ls.getItem(k);
      },
      setItem: (k: string, v: string) => {
        ls.setItem(k, v);
      },
      removeItem: (k: string) => {
        ls.removeItem(k);
      },
    };
    const s = createLocalStorageGhostStore(spy, undefined, { maxSize });
    await s.save(small('ann', 'ok'));
    // Planted, as an older version or an editor could leave it: a huge value
    // with a meta record that says so, and one with no meta record at all.
    const huge = JSON.stringify({
      bucket: bucketKey,
      value: { ...snap('bob'), pad: 'y'.repeat(50_000) },
    });
    ls.setItem('coop:ghost:HUGE', huge);
    ls.setItem(
      'coop:ghostmeta:HUGE',
      JSON.stringify({
        bucket: bucketKey,
        owner: 'bob',
        runId: 'run-bob',
        seq: 99,
        size: 50_000,
      }),
    );
    ls.setItem('coop:ghost:NOMETA', huge);
    reads.length = 0;
    const listed = (await s.list(B)) as GhostSnapshot[];
    expect(listed.map((g) => g.owner.id)).toEqual(['ann']);
    expect(reads).not.toContain('coop:ghost:HUGE');
    expect(reads).not.toContain('coop:ghost:NOMETA');
  });

  test('IndexedDB: a row without the fit mark is not listed', async () => {
    const db = await openGhostDb(new IDBFactory());
    const s = createIdbGhostStore(db, { maxSize });
    await s.save(small('ann', 'ok'));
    const tx = db.transaction('ghosts', 'readwrite');
    tx.objectStore('ghosts').put(
      {
        bucket: bucketKey,
        owner: 'bob',
        runId: 'r',
        seq: 50,
        size: 99999,
        value: { pad: 'z'.repeat(50_000) },
      },
      'planted-key',
    );
    await new Promise<void>((res) => {
      tx.oncomplete = () => {
        res();
      };
    });
    expect(await s.list(B)).toHaveLength(1);
  });

  test('both stores return at most 64 rows of a long bucket, in canonical order', async () => {
    const idb = createIdbGhostStore(await openGhostDb(new IDBFactory()));
    const local = createLocalStorageGhostStore(createMemoryStorage());
    for (let i = 0; i < 200; i++) {
      const g = small(`o${String(i).padStart(3, '0')}`, `r${String(i)}`);
      await idb.save(g);
      await local.save(g);
    }
    for (const s of [idb, local]) {
      const ids = ((await s.list(B)) as GhostSnapshot[]).map((g) => g.owner.id);
      expect(ids).toHaveLength(64);
      expect(ids).toEqual([...ids].sort());
      expect(ids[0]).toBe('o000');
    }
  });

  test('the save sequence survives a new store instance over the same storage', async () => {
    const ls = createMemoryStorage();
    const factory = new IDBFactory();
    for (const make of [
      async () => createIdbGhostStore(await openGhostDb(factory)),
      () => Promise.resolve(createLocalStorageGhostStore(ls)),
    ]) {
      const first = await make();
      for (let i = 1; i <= 3; i++)
        await first.save(small('ann', `r${String(i)}`));
      const second = await make();
      for (let i = 4; i <= 6; i++)
        await second.save(small('ann', `r${String(i)}`));
      const ids = ((await second.list(B)) as GhostSnapshot[]).map(
        (g) => g.runId,
      );
      expect(ids).toEqual(['r2', 'r3', 'r4', 'r5', 'r6']);
    }
  });

  test('Clear ghost pool is under Developer in the menu and nowhere else', () => {
    const dir = new URL('..', import.meta.url);
    const menu = readFileSync(new URL('menu/MainMenu.tsx', dir), 'utf8');
    const open = menu.indexOf('<details class="developer">');
    const close = menu.indexOf('</details>', open);
    const at = menu.indexOf('clear-ghosts');
    expect(open).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(open);
    expect(at).toBeLessThan(close);
    expect(menu.indexOf('clear-ghosts', at + 1)).toBe(-1);
    for (const f of [
      'run/RunScreen.tsx',
      'run/RunBar.tsx',
      'run/RunGate.tsx',
    ]) {
      expect(readFileSync(new URL(f, dir), 'utf8')).not.toMatch(
        /ghosts\.clear/,
      );
    }
  });
});
