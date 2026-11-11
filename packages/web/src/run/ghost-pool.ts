/**
 * The browser ghost pool (W3-1): a `GhostStore` over IndexedDB, falling back
 * to `localStorage`, then to memory, like the save store. It lives in its own
 * database so the saves database keeps its version.
 *
 * Layout. IndexedDB: database `coop-autobattler-ghosts`, object store
 * `ghosts`, key = `ghostStoreKey(bucket, ownerId)`, value `{ bucket, value }`
 * with an index on `bucket` (the text of `ghostBucketKey`). localStorage: one
 * key per snapshot, `<prefix>ghost:<store key>`, holding the same record as
 * JSON. A stored value that is not valid JSON is returned as the raw string;
 * the caller validates everything it reads.
 */
import {
  createMemoryGhostStore,
  ghostStoreKey,
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
const BUCKET_INDEX = 'bucket';

interface Stored {
  readonly bucket: string;
  readonly value: unknown;
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
    const open = factory.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE);
        os.createIndex(BUCKET_INDEX, 'bucket');
      }
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
export function createIdbGhostStore(db: IDBDatabase): GhostStore {
  db.onversionchange = () => {
    db.close();
  };
  return {
    async save(snapshot) {
      const bucket = ghostBucketOf(snapshot);
      const record: Stored = {
        bucket: ghostBucketKey(bucket),
        value: JSON.parse(JSON.stringify(snapshot)) as unknown,
      };
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(
        record,
        ghostStoreKey(bucket, snapshot.owner.id),
      );
      await done(tx);
    },
    async list(bucket) {
      const tx = db.transaction(STORE, 'readonly');
      const rows = (await request(
        tx
          .objectStore(STORE)
          .index(BUCKET_INDEX)
          .getAll(ghostBucketKey(bucket)),
      )) as Stored[];
      return rows.map((r) => r.value).sort(compareStored);
    },
    async get(bucket, ownerId) {
      const tx = db.transaction(STORE, 'readonly');
      const row = (await request(
        tx.objectStore(STORE).get(ghostStoreKey(bucket, ownerId)),
      )) as Stored | undefined;
      return row === undefined ? null : row.value;
    },
    async clear() {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await done(tx);
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

/** A `GhostStore` over `localStorage` (or anything shaped like it). */
export function createLocalStorageGhostStore(
  ls: StorageLike,
  prefix: string = DEFAULT_PREFIX,
): GhostStore {
  const head = `${prefix}ghost:`;
  const keys = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k !== null && k.startsWith(head)) out.push(k);
    }
    return out;
  };
  return {
    save(snapshot) {
      const bucket = ghostBucketOf(snapshot);
      const record: Stored = {
        bucket: ghostBucketKey(bucket),
        value: snapshot,
      };
      try {
        ls.setItem(
          head + ghostStoreKey(bucket, snapshot.owner.id),
          JSON.stringify(record),
        );
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    list(bucket: GhostBucket) {
      const want = ghostBucketKey(bucket);
      const out: unknown[] = [];
      for (const k of keys()) {
        const row = parse(ls.getItem(k));
        if (row !== null && row.bucket === want) out.push(row.value);
      }
      return Promise.resolve(out.sort(compareStored));
    },
    get(bucket, ownerId) {
      const row = parse(ls.getItem(head + ghostStoreKey(bucket, ownerId)));
      return Promise.resolve(row === null ? null : row.value);
    },
    clear() {
      for (const k of keys()) ls.removeItem(k);
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
}): Promise<OpenedGhostStore> {
  if (env.indexedDB !== null) {
    try {
      const db = await openGhostDb(env.indexedDB);
      return { store: createIdbGhostStore(db), kind: 'indexeddb' };
    } catch {
      // fall through
    }
  }
  if (env.localStorage !== null) {
    return {
      store: createLocalStorageGhostStore(env.localStorage),
      kind: 'local',
    };
  }
  return { store: createMemoryGhostStore(), kind: 'memory' };
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
