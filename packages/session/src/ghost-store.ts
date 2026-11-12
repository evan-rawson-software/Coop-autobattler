/**
 * The ghost pool interface (W3-1) and its in-memory implementation.
 *
 * `session` defines the interface; it does no I/O. A browser implementation
 * (IndexedDB) lives in `packages/web`; the Godot version supplies a Steam one
 * behind the same interface. Every implementation must pass
 * `runGhostStoreConformance` from `@game/session/testing`.
 *
 * The pool is external, mutable and untrusted: what `list` and `get` return
 * is `unknown`, and a caller validates it (`validateGhostSnapshot`) before
 * use. The run machine never reads a store; the run controller does.
 */
import {
  compareGhosts,
  ghostBucketKey,
  ghostBucketOf,
  type GhostBucket,
  type GhostSnapshot,
} from '@game/core';

/**
 * The most snapshots kept per owner per bucket (version, party size, round).
 * A player's own past runs stay in the local pool, but only the last few per
 * round, so one old run cannot dominate the draw.
 */
export const GHOST_KEEP_PER_OWNER_BUCKET = 5;

/**
 * The largest snapshot (characters of JSON) a store accepts when it was given
 * no tighter bound. A store with the rules at hand passes
 * `ghostMaxSerializedSize` for the snapshot's party size and round instead.
 */
export const GHOST_STORE_DEFAULT_MAX_SIZE = 4_000_000;

/** The most rows a store's `list` returns (the contract allows 64 or more). */
export const GHOST_LIST_LIMIT = 64;

export interface GhostStore {
  /**
   * Store a snapshot under (bucket, owner, run). A snapshot of the same run
   * in the same bucket replaces the earlier one. After the write, at most
   * `GHOST_KEEP_PER_OWNER_BUCKET` snapshots of the owner remain in the
   * bucket: the oldest by the store's own save sequence number (a counter the
   * store keeps, never the clock) are dropped. A snapshot larger than the
   * store's size bound is rejected and changes nothing. The stored value is a
   * copy. Resolves when the write is complete; rejects without changing
   * anything otherwise.
   */
  save(snapshot: GhostSnapshot): Promise<void>;
  /**
   * The stored values of the bucket, in the canonical order (owner id, then
   * run id). Values are returned as stored, unvalidated. An implementation
   * may cap the number returned only if the cap is at least 64 (it reads in
   * that order, so a long bucket is cut deterministically), and it does not
   * return, and where it can does not read, a row marked oversized.
   */
  list(bucket: GhostBucket): Promise<readonly unknown[]>;
  /** The value stored for a run of an owner in a bucket, or null. */
  get(bucket: GhostBucket, ownerId: string, runId: string): Promise<unknown>;
  /** Remove every snapshot of every bucket. Resolves for an empty store. */
  clear(): Promise<void>;
  /**
   * Remove every snapshot whose bucket has a lower game version than
   * `keepVersion` (TA-8, PP-17: a new major version empties the pool); the
   * snapshots of `keepVersion` or a newer version and the save counter are
   * left alone, and a malformed `keepVersion` removes nothing.
   */
  removeOtherVersions(keepVersion: string): Promise<void>;
}

/** The game version of a bucket key (`version|partySize|round`). */
export function bucketKeyVersion(bucketKey: string): string {
  const i = bucketKey.indexOf('|');
  return i === -1 ? bucketKey : bucketKey.slice(0, i);
}

/**
 * Whether a bucket's game version is lower than `keepVersion` (numeric parts,
 * `major.minor`). A bucket version that cannot be read counts as lower; a
 * newer one (a stale tab or a downgraded build) is never lower. A malformed
 * `keepVersion` makes nothing lower, so a purge with it removes nothing.
 */
export function isLowerBucketVersion(
  bucket: string,
  keepVersion: string,
): boolean {
  if (!/^\d+(\.\d+)*$/.test(keepVersion)) return false;
  const version = bucketKeyVersion(bucket);
  if (!/^\d+(\.\d+)*$/.test(version)) return true;
  const a = version.split('.').map(Number);
  const b = keepVersion.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** The key under which a snapshot is stored: its bucket and its owner. */
export function ghostStoreKey(
  bucket: GhostBucket,
  ownerId: string,
  runId: string,
): string {
  return JSON.stringify([ghostBucketKey(bucket), ownerId, runId]);
}

/** Keys to drop so that `keep` remain: the oldest sequence numbers first. */
export function evictionKeys(
  entries: readonly { readonly key: string; readonly seq: number }[],
  keep: number,
): string[] {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  return sorted.slice(0, Math.max(0, sorted.length - keep)).map((e) => e.key);
}

/** Canonical order for raw stored values; unreadable ones sort last. */
export function compareStored(a: unknown, b: unknown): number {
  const ra = readIdentity(a);
  const rb = readIdentity(b);
  if (ra === null || rb === null) {
    return ra === rb ? 0 : ra === null ? 1 : -1;
  }
  return compareGhosts(ra, rb);
}

function readIdentity(
  v: unknown,
): Pick<GhostSnapshot, 'owner' | 'runId'> | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = (v as { owner?: unknown }).owner;
  const r = (v as { runId?: unknown }).runId;
  if (typeof o !== 'object' || o === null || typeof r !== 'string') return null;
  const id = (o as { id?: unknown }).id;
  if (typeof id !== 'string') return null;
  return { owner: { id, label: '' }, runId: r };
}

export interface MemoryGhostStore extends GhostStore {
  /** The next `save` rejects and changes nothing. */
  failNextSave(message?: string): void;
  /** Plant any value in a bucket under an owner id (to test damaged data). */
  injectRaw(
    bucket: GhostBucket,
    ownerId: string,
    value: unknown,
    runId?: string,
  ): void;
  /** The number of stored values. */
  size(): number;
}

function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** In-memory `GhostStore`: for tests and the reference for the others. */
export function createMemoryGhostStore(
  options: {
    readonly maxSize?: (partySize: number, round: number) => number;
  } = {},
): MemoryGhostStore {
  interface Item {
    readonly bucket: string;
    readonly owner: string;
    readonly seq: number;
    readonly value: unknown;
  }
  const items = new Map<string, Item>();
  let counter = 0;
  let fault: string | null = null;
  const maxSize =
    options.maxSize ?? ((): number => GHOST_STORE_DEFAULT_MAX_SIZE);
  const put = (
    bucket: GhostBucket,
    ownerId: string,
    runId: string,
    value: unknown,
  ): void => {
    const bk = ghostBucketKey(bucket);
    counter += 1;
    items.set(ghostStoreKey(bucket, ownerId, runId), {
      bucket: bk,
      owner: ownerId,
      seq: counter,
      value,
    });
    const own: { key: string; seq: number }[] = [];
    for (const [key, i] of items) {
      if (i.bucket === bk && i.owner === ownerId) own.push({ key, seq: i.seq });
    }
    for (const key of evictionKeys(own, GHOST_KEEP_PER_OWNER_BUCKET)) {
      items.delete(key);
    }
  };
  return {
    save(snapshot) {
      if (fault !== null) {
        const message = fault;
        fault = null;
        return Promise.reject(new Error(message));
      }
      const staged = copy(snapshot);
      if (
        JSON.stringify(staged).length >
        maxSize(snapshot.partySize, snapshot.round)
      ) {
        return Promise.reject(new Error('the ghost snapshot is too large'));
      }
      put(ghostBucketOf(snapshot), snapshot.owner.id, snapshot.runId, staged);
      return Promise.resolve();
    },
    list(bucket) {
      const key = ghostBucketKey(bucket);
      const out = [...items.values()]
        .filter((i) => i.bucket === key)
        .map((i) => copy(i.value))
        .sort(compareStored);
      return Promise.resolve(out.slice(0, GHOST_LIST_LIMIT));
    },
    get(bucket, ownerId, runId) {
      const found = items.get(ghostStoreKey(bucket, ownerId, runId));
      return Promise.resolve(found === undefined ? null : copy(found.value));
    },
    clear() {
      items.clear();
      counter = 0;
      return Promise.resolve();
    },
    removeOtherVersions(keepVersion) {
      for (const [key, i] of [...items]) {
        if (isLowerBucketVersion(i.bucket, keepVersion)) items.delete(key);
      }
      return Promise.resolve();
    },
    failNextSave(message = 'the ghost could not be written') {
      fault = message;
    },
    injectRaw(bucket, ownerId, value, runId = 'injected') {
      put(bucket, ownerId, runId, copy(value));
    },
    size() {
      return items.size;
    },
  };
}
