/**
 * The browser ghost pool (W3-1): a `GhostStore` over IndexedDB, falling back
 * to `localStorage`, then to memory, like the save store. It lives in its own
 * database so the saves database keeps its version.
 *
 * Bounded reads. A snapshot larger than the size bound is refused at write
 * time. `list` never reads a row it cannot use: it reads at most
 * `GHOST_LIST_LIMIT` rows, in the canonical order, and only rows marked as
 * within the bound; a row without that mark is never loaded.
 *
 * Layout. IndexedDB (version 2): database `coop-autobattler-ghosts`, object
 * store `ghosts`, key = `ghostStoreKey(bucket, ownerId, runId)`, value
 * `{ bucket, owner, runId, seq, size, fit?, value }`. `seq` is a counter kept
 * under the key `meta:seq` (so "oldest" never depends on the clock); `fit` is
 * 1 when `size` is within the bound. Index `listing` is
 * `[bucket, fit, owner, runId]` (rows without `fit` are not in it); index
 * `own` is `[bucket, owner, seq]` (read as keys only, for eviction). The
 * upgrade from version 1 (one snapshot per owner) empties the pool.
 * localStorage: per snapshot, `<prefix>ghost:<store key>` holds
 * `{ bucket, value }` and `<prefix>ghostmeta:<store key>` holds the small
 * `{ bucket, owner, runId, seq, size }`; the counter is `<prefix>ghost-seq`.
 * `list` reads the small meta keys and only then the values it will return.
 * Rows of the older shape `ghost:<[bucket, owner]>` (no meta key) are removed
 * when the store is made.
 * A stored value that is not valid JSON is returned as the raw string; the
 * caller validates everything it reads.
 */
import {
  isLowerBucketVersion,
  createMemoryGhostStore,
  evictionKeys,
  ghostStoreKey,
  GHOST_KEEP_PER_OWNER_BUCKET,
  GHOST_LIST_LIMIT,
  GHOST_STORE_DEFAULT_MAX_SIZE,
  type GhostStore,
} from '@game/session';
import {
  compareGhosts,
  ghostBucketKey,
  ghostBucketOf,
  type GhostBucket,
  type GhostSnapshot,
} from '@game/core';
import { DEFAULT_PREFIX, type StorageLike } from './local-storage-store.js';

export const GHOST_DB_NAME = 'coop-autobattler-ghosts';
const STORE = 'ghosts';

const OWN_INDEX = 'own';
const LISTING_INDEX = 'listing';
const SEQ_KEY = 'meta:seq';

interface Stored {
  readonly bucket: string;
  readonly value: unknown;
}

/** The largest snapshot (characters of JSON) accepted for a party and round. */
export type GhostMaxSize = (partySize: number, round: number) => number;

export interface GhostStoreOptions {
  readonly maxSize?: GhostMaxSize;
}

function sizeBound(
  options: GhostStoreOptions | undefined,
  partySize: number,
  round: number,
): number {
  try {
    const n = options?.maxSize?.(partySize, round);
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  } catch {
    // fall back to the fixed bound
  }
  return GHOST_STORE_DEFAULT_MAX_SIZE;
}

function compareStored(a: unknown, b: unknown): number {
  const id = (v: unknown): GhostSnapshot | null => {
    if (typeof v !== 'object' || v === null) return null;
    const o = (v as { owner?: { id?: unknown } }).owner;
    const r = (v as { runId?: unknown }).runId;
    return typeof o?.id === 'string' && typeof r === 'string'
      ? ({ owner: { id: o.id, label: '' }, runId: r } as GhostSnapshot)
      : null;
  };
  const x = id(a);
  const y = id(b);
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  return compareGhosts(x, y);
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => {
      resolve(r.result);
    };
    r.onerror = () => {
      reject(r.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('The transaction was aborted'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('The transaction failed'));
    };
  });
}

/** Open the ghost database; rejects if IndexedDB cannot be used. */
export function openGhostDb(
  factory: IDBFactory,
  name: string = GHOST_DB_NAME,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, 2);
    open.onupgradeneeded = () => {
      const db = open.result;
      // Version 1 kept one snapshot per owner under another key; the pool is
      // a rebuildable cache, so it starts empty.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      const os = db.createObjectStore(STORE);
      os.createIndex(LISTING_INDEX, ['bucket', 'fit', 'owner', 'runId']);
      os.createIndex(OWN_INDEX, ['bucket', 'owner', 'seq']);
    };
    open.onsuccess = () => {
      resolve(open.result);
    };
    open.onerror = () => {
      reject(open.error ?? new Error('IndexedDB could not be opened'));
    };
    // A blocked open waits for the other tab; it is never an error.
  });
}

/** A `GhostStore` over an open IndexedDB database. */
export function createIdbGhostStore(
  db: IDBDatabase,
  options?: GhostStoreOptions,
): GhostStore {
  db.onversionchange = () => {
    db.close();
  };
  return {
    async save(snapshot) {
      const bucket = ghostBucketOf(snapshot);
      const value = JSON.parse(JSON.stringify(snapshot)) as unknown;
      const size = JSON.stringify(value).length;
      if (size > sizeBound(options, snapshot.partySize, snapshot.round)) {
        throw new Error('the ghost snapshot is too large');
      }
      const bk = ghostBucketKey(bucket);
      const owner = snapshot.owner.id;
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      const finished = done(tx);
      try {
        const meta = (await request(os.get(SEQ_KEY))) as
          { seq?: unknown } | undefined;
        const seq = (typeof meta?.seq === 'number' ? meta.seq : 0) + 1;
        os.put({ seq }, SEQ_KEY);
        os.put(
          {
            bucket: bk,
            owner,
            runId: snapshot.runId,
            seq,
            size,
            fit: 1,
            value,
          },
          ghostStoreKey(bucket, owner, snapshot.runId),
        );
        // Keys only: the values of the owner's other snapshots are not read.
        const own = await request(
          os
            .index(OWN_INDEX)
            .getAllKeys(
              IDBKeyRange.bound([bk, owner, 0], [bk, owner, Infinity]),
            ),
        );
        for (const k of own.slice(
          0,
          Math.max(0, own.length - GHOST_KEEP_PER_OWNER_BUCKET),
        )) {
          os.delete(k);
        }
      } catch (e) {
        tx.abort();
        await finished.catch(() => undefined);
        throw e;
      }
      await finished;
    },
    async list(bucket) {
      const bk = ghostBucketKey(bucket);
      const tx = db.transaction(STORE, 'readonly');
      const rows = (await request(
        tx
          .objectStore(STORE)
          .index(LISTING_INDEX)
          .getAll(IDBKeyRange.bound([bk, 1], [bk, 1, []]), GHOST_LIST_LIMIT),
      )) as { value: unknown }[];
      return rows.map((r) => r.value).sort(compareStored);
    },
    async get(bucket, ownerId, runId) {
      const tx = db.transaction(STORE, 'readonly');
      const row = (await request(
        tx.objectStore(STORE).get(ghostStoreKey(bucket, ownerId, runId)),
      )) as { value: unknown } | undefined;
      return row === undefined ? null : row.value;
    },
    async clear() {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await done(tx);
    },
    async removeOtherVersions(keepVersion) {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      const finished = done(tx);
      try {
        // Keys only: a row of the current version is never read.
        const keys = await request(os.getAllKeys());
        for (const k of keys) {
          if (typeof k !== 'string' || k === SEQ_KEY) continue;
          let bucket: unknown;
          try {
            bucket = (JSON.parse(k) as unknown[])[0];
          } catch {
            continue;
          }
          if (
            typeof bucket === 'string' &&
            isLowerBucketVersion(bucket, keepVersion)
          ) {
            os.delete(k);
          }
        }
      } catch (e) {
        tx.abort();
        await finished.catch(() => undefined);
        throw e;
      }
      await finished;
    },
  };
}

function parse(text: string | null): Stored | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && 'bucket' in v && 'value' in v
      ? (v as Stored)
      : { bucket: '', value: v };
  } catch {
    return { bucket: '', value: text };
  }
}

interface Meta {
  readonly bucket: string;
  readonly owner: string;
  readonly runId: string;
  readonly seq: number;
  readonly size: number;
}

function parseMeta(text: string | null): Meta | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as Partial<Meta> | null;
    return v !== null &&
      typeof v === 'object' &&
      typeof v.bucket === 'string' &&
      typeof v.owner === 'string' &&
      typeof v.runId === 'string' &&
      typeof v.seq === 'number' &&
      typeof v.size === 'number'
      ? (v as Meta)
      : null;
  } catch {
    return null;
  }
}

/** A `GhostStore` over `localStorage` (or anything shaped like it). */
export function createLocalStorageGhostStore(
  ls: StorageLike,
  prefix: string = DEFAULT_PREFIX,
  options?: GhostStoreOptions,
): GhostStore {
  const head = `${prefix}ghost:`;
  const metaHead = `${prefix}ghostmeta:`;
  const seqKey = `${prefix}ghost-seq`;
  const keysWith = (h: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k !== null && k.startsWith(h)) out.push(k);
    }
    return out;
  };
  const metas = (): { key: string; meta: Meta }[] => {
    const out: { key: string; meta: Meta }[] = [];
    for (const k of keysWith(metaHead)) {
      const meta = parseMeta(ls.getItem(k));
      if (meta !== null) out.push({ key: k.slice(metaHead.length), meta });
    }
    return out;
  };
  /**
   * Before the run id joined the key, a row was `ghost:<[bucket, owner]>` with
   * no meta key. Such rows are never listed or reached, but they use quota
   * that the saves share, so they are removed once, when the store is made.
   * Only a key whose rest is a JSON array of exactly two strings and that has
   * no meta key counts; anything else under `ghost:` is left alone.
   */
  function removeOldShapeGhostRows(): void {
    try {
      for (const k of keysWith(head)) {
        const rest = k.slice(head.length);
        if (ls.getItem(metaHead + rest) !== null) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(rest);
        } catch {
          continue;
        }
        if (
          Array.isArray(parsed) &&
          parsed.length === 2 &&
          parsed.every((x) => typeof x === 'string')
        ) {
          ls.removeItem(k);
        }
      }
    } catch {
      // a clean-up that fails is not an error: the rows only cost quota
    }
  }
  removeOldShapeGhostRows();
  return {
    save(snapshot) {
      const bucket = ghostBucketOf(snapshot);
      const bk = ghostBucketKey(bucket);
      const owner = snapshot.owner.id;
      const record: Stored = { bucket: bk, value: snapshot };
      const text = JSON.stringify(record);
      const size = JSON.stringify(snapshot).length;
      if (size > sizeBound(options, snapshot.partySize, snapshot.round)) {
        return Promise.reject(new Error('the ghost snapshot is too large'));
      }
      const key = ghostStoreKey(bucket, owner, snapshot.runId);
      try {
        const old = Number(ls.getItem(seqKey));
        const seq = (Number.isInteger(old) && old >= 0 ? old : 0) + 1;
        ls.setItem(head + key, text);
        try {
          ls.setItem(
            metaHead + key,
            JSON.stringify({
              bucket: bk,
              owner,
              runId: snapshot.runId,
              seq,
              size,
            }),
          );
          ls.setItem(seqKey, String(seq));
        } catch (e) {
          ls.removeItem(head + key);
          ls.removeItem(metaHead + key);
          throw e;
        }
        const own = metas()
          .filter((m) => m.meta.bucket === bk && m.meta.owner === owner)
          .map((m) => ({ key: m.key, seq: m.meta.seq }));
        for (const k of evictionKeys(own, GHOST_KEEP_PER_OWNER_BUCKET)) {
          ls.removeItem(head + k);
          ls.removeItem(metaHead + k);
        }
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    list(bucket: GhostBucket) {
      const want = ghostBucketKey(bucket);
      const cap = sizeBound(options, bucket.partySize, bucket.round);
      // Only the small meta keys are read to choose; the values after.
      const chosen = metas()
        .filter((m) => m.meta.bucket === want && m.meta.size <= cap)
        .sort((a, b) =>
          compareGhosts(
            { owner: { id: a.meta.owner, label: '' }, runId: a.meta.runId },
            { owner: { id: b.meta.owner, label: '' }, runId: b.meta.runId },
          ),
        )
        .slice(0, GHOST_LIST_LIMIT);
      const out: unknown[] = [];
      for (const m of chosen) {
        const row = parse(ls.getItem(head + m.key));
        if (row !== null && row.bucket === want) out.push(row.value);
      }
      return Promise.resolve(out.sort(compareStored));
    },
    get(bucket, ownerId, runId) {
      const row = parse(
        ls.getItem(head + ghostStoreKey(bucket, ownerId, runId)),
      );
      return Promise.resolve(row === null ? null : row.value);
    },
    removeOtherVersions(keepVersion) {
      try {
        for (const k of keysWith(head)) {
          const rest = k.slice(head.length);
          let bucket: unknown;
          try {
            bucket = (JSON.parse(rest) as unknown[])[0];
          } catch {
            continue;
          }
          if (
            typeof bucket === 'string' &&
            isLowerBucketVersion(bucket, keepVersion)
          ) {
            ls.removeItem(k);
            ls.removeItem(metaHead + rest);
          }
        }
        // A meta key whose row is gone: remove it if its version is lower.
        for (const k of keysWith(metaHead)) {
          const rest = k.slice(metaHead.length);
          if (ls.getItem(head + rest) !== null) continue;
          let bucket: unknown;
          try {
            bucket = (JSON.parse(rest) as unknown[])[0];
          } catch {
            continue;
          }
          if (
            typeof bucket === 'string' &&
            isLowerBucketVersion(bucket, keepVersion)
          ) {
            ls.removeItem(k);
          }
        }
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    clear() {
      for (const k of keysWith(head)) ls.removeItem(k);
      for (const k of keysWith(metaHead)) ls.removeItem(k);
      ls.removeItem(seqKey);
      return Promise.resolve();
    },
  };
}

export type GhostStorageKind = 'indexeddb' | 'local' | 'memory';

export interface OpenedGhostStore {
  readonly store: GhostStore;
  readonly kind: GhostStorageKind;
}

/** Best available ghost storage: IndexedDB, then localStorage, then memory. */
export async function openGhostStore(env: {
  readonly indexedDB: IDBFactory | null;
  readonly localStorage: StorageLike | null;
  readonly maxSize?: GhostMaxSize;
}): Promise<OpenedGhostStore> {
  const options: GhostStoreOptions =
    env.maxSize === undefined ? {} : { maxSize: env.maxSize };
  if (env.indexedDB !== null) {
    try {
      const db = await openGhostDb(env.indexedDB);
      return { store: createIdbGhostStore(db, options), kind: 'indexeddb' };
    } catch {
      // fall through
    }
  }
  if (env.localStorage !== null) {
    return {
      store: createLocalStorageGhostStore(
        env.localStorage,
        DEFAULT_PREFIX,
        options,
      ),
      kind: 'local',
    };
  }
  return { store: createMemoryGhostStore(options), kind: 'memory' };
}

const OWNER_KEY = `${DEFAULT_PREFIX}owner-id`;

/**
 * A stable identifier for this install, kept in `localStorage`. Without
 * storage a fresh one is made for the page (such a page keeps no ghosts
 * between visits anyway).
 */
export function installOwnerId(ls: StorageLike | null): string {
  try {
    const old = ls?.getItem(OWNER_KEY) ?? null;
    if (old !== null && old !== '') return old;
  } catch {
    // unreadable: make a new one
  }
  const bytes = new Uint32Array(3);
  crypto.getRandomValues(bytes);
  const id = `dev-${[...bytes].map((n) => n.toString(36)).join('')}`;
  try {
    ls?.setItem(OWNER_KEY, id);
  } catch {
    // the id lasts for this page only
  }
  return id;
}

/** What opponents see for an owner id: a short anonymous name. */
export function ownerLabelFor(ownerId: string): string {
  return `Runner ${ownerId.slice(-4)}`;
}
