import { readFileSync } from 'node:fs';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { runGhostStoreConformance } from '@game/session/testing';
import { ghostBucketKey, type GhostSnapshot } from '@game/core';
import {
  createIdbGhostStore,
  createLocalStorageGhostStore,
  GHOST_DB_NAME,
  installOwnerId,
  openGhostDb,
  openGhostStore,
  ownerLabelFor,
} from './ghost-pool.js';
import { DB_NAME, openDb } from './idb-store.js';
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
    ).toBe('Opponent: a recorded rival party');
    expect(
      opponentText({
        round: 1,
        pvpOpponent: { round: 1, kind: 'boss', label: 'the boss', ghost: null },
      }),
    ).toBe('Opponent: the boss');
    expect(
      opponentText({
        round: 1,
        pvpOpponent: {
          round: 1,
          kind: 'ghost',
          label: 'Bundled Rusher bot',
          ghost: null,
        },
      }),
    ).toBe('Opponent: a recorded rival party');
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

function settle(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('transaction failed'));
    };
  });
}

function fetchRow(
  db: IDBDatabase,
  store: string,
  key: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => {
      resolve(r.result);
    };
    r.onerror = () => {
      reject(r.error ?? new Error('get failed'));
    };
  });
}

describe('ghost pool upgrades and clean-up', () => {
  test('localStorage: removeOlderVersions removes rows and meta of other versions only', async () => {
    const ls = createMemoryStorage();
    const s = createLocalStorageGhostStore(ls);
    await s.save(snap('ann'));
    await s.save({ ...snap('bob'), gameVersion: '0.0' });
    ls.setItem('coop:save:run-1', '{"save":true}');
    const seq = ls.getItem('coop:ghost-seq');
    const names = (): string[] =>
      Array.from({ length: ls.length }, (_, i) => ls.key(i) as string);
    expect(names().filter((k) => k.startsWith('coop:ghost')).length).toBe(5);
    await s.removeOlderVersions(B.gameVersion);
    const left = names().filter((k) => k.startsWith('coop:ghost'));
    expect(left.length).toBe(3);
    expect(
      left.every(
        (k) => k === 'coop:ghost-seq' || k.includes(ghostBucketKey(B)),
      ),
    ).toBe(true);
    expect(ls.getItem('coop:ghost-seq')).toBe(seq);
    expect(ls.getItem('coop:save:run-1')).toBe('{"save":true}');
  });

  test('localStorage: removeOlderVersions keeps newer versions and drops orphan meta of lower ones', async () => {
    const ls = createMemoryStorage();
    const s = createLocalStorageGhostStore(ls);
    await s.save({ ...snap('new'), gameVersion: '2.0' });
    await s.save({ ...snap('old'), gameVersion: '0.0' });
    const orphan = (v: string): string =>
      `coop:ghostmeta:${JSON.stringify([`${v}|1|1`, 'zed', 'r'])}`;
    ls.setItem(orphan('0.0'), '{}');
    ls.setItem(orphan('3.0'), '{}');
    await s.removeOlderVersions(B.gameVersion);
    const keys = Array.from({ length: ls.length }, (_, i) => ls.key(i) ?? '');
    expect(keys.some((k) => k.includes('2.0|'))).toBe(true);
    expect(keys.some((k) => k.includes('0.0|'))).toBe(false);
    expect(keys).toContain(orphan('3.0'));
    expect(keys).not.toContain(orphan('0.0'));
  });

  test('IndexedDB: removeOlderVersions removes lower versions only', async () => {
    const s = createIdbGhostStore(await openGhostDb(new IDBFactory()));
    await s.save({ ...snap('new'), gameVersion: '2.0' });
    await s.save({ ...snap('cur') });
    await s.save({ ...snap('old'), gameVersion: '0.0' });
    await s.removeOlderVersions(B.gameVersion);
    const at = (gameVersion: string) =>
      s.list({ gameVersion, partySize: 1, round: 1 });
    expect(await at('2.0')).toHaveLength(1);
    expect(await at('0.1')).toHaveLength(1);
    expect(await at('0.0')).toHaveLength(0);
  });

  test('localStorage: old-shape ghost rows are removed at start-up and nothing else', async () => {
    const ls = createMemoryStorage();
    const bk = ghostBucketKey(B);
    const oldKey = `coop:ghost:${JSON.stringify([bk, 'ann'])}`;
    // Not positively old-shape ghost rows: they must stay.
    ls.setItem('coop:ghost:x', '{not json');
    ls.setItem('coop:ghost:["only-one"]', '1');
    ls.setItem('coop:ghost:[1,2]', '2');
    ls.setItem('coop:save:run-1', '{"save":true}');
    ls.setItem('coop:history', '[]');
    ls.setItem('other:ghost:["a","b"]', '3');
    // A current-shape row with its meta key.
    await createLocalStorageGhostStore(ls).save(snap('bob'));
    // Written by an older version, after the store above was made.
    ls.setItem(oldKey, JSON.stringify({ bucket: bk, value: { old: true } }));
    const keys = (): string[] =>
      Array.from({ length: ls.length }, (_, i) => ls.key(i) as string).sort();
    const before = keys();
    expect(before).toContain(oldKey);

    const s2 = createLocalStorageGhostStore(ls);
    expect(keys()).toEqual(before.filter((k) => k !== oldKey));
    expect(await s2.list(B)).toHaveLength(1);
    expect(ls.getItem('coop:save:run-1')).toBe('{"save":true}');
  });

  test('IndexedDB: a version 1 database upgrades to an empty version 2 pool and leaves the saves database alone', async () => {
    const factory = new IDBFactory();
    const savesDb = await openDb(factory, DB_NAME);
    const savesVersion = savesDb.version;
    const saveStores = Array.from(savesDb.objectStoreNames);
    const saveStore = saveStores[0] as string;
    const wsaves = savesDb.transaction(saveStore, 'readwrite');
    wsaves.objectStore(saveStore).put({ keep: 'me' }, 'k');
    await settle(wsaves);
    savesDb.close();

    // The ghost database as version 1 left it: a store with a bucket index.
    const v1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(GHOST_DB_NAME, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('ghosts').createIndex('bucket', 'bucket');
      };
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(open.error ?? new Error('open failed'));
      };
    });
    const wv1 = v1.transaction('ghosts', 'readwrite');
    wv1
      .objectStore('ghosts')
      .put({ bucket: ghostBucketKey(B), value: snap('old') }, 'ann');
    await settle(wv1);
    v1.close();

    const db = await openGhostDb(factory);
    expect(db.version).toBe(2);
    const indexes = db
      .transaction('ghosts', 'readonly')
      .objectStore('ghosts').indexNames;
    expect(Array.from(indexes).sort()).toEqual(['listing', 'own']);
    const store = createIdbGhostStore(db);
    expect(await store.list(B)).toEqual([]);
    await store.save(snap('ann'));
    expect(await store.list(B)).toHaveLength(1);
    db.close();

    const again = await openDb(factory, DB_NAME);
    expect(again.version).toBe(savesVersion);
    expect(Array.from(again.objectStoreNames)).toEqual(saveStores);
    expect(await fetchRow(again, saveStore, 'k')).toEqual({ keep: 'me' });
    again.close();
  });
});
