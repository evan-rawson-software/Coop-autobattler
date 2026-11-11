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

export interface GhostStore {
  /**
   * Store a snapshot. At most one snapshot is kept per owner per bucket
   * (version, party size, round): a snapshot of the same owner in the same
   * bucket is replaced, whichever run it came from. The stored value is a
   * copy. Resolves when the write is complete; rejects without changing
   * anything otherwise.
   */
  save(snapshot: GhostSnapshot): Promise<void>;
  /**
   * Every stored value of the bucket, in the canonical order (owner id, then
   * run id). Values are returned as stored, unvalidated. An implementation
   * may cap the number returned only if the cap is at least 64; the run
   * controller presents at most 16 of them anyway.
   */
  list(bucket: GhostBucket): Promise<readonly unknown[]>;
  /** The value stored for an owner in a bucket, or null. */
  get(bucket: GhostBucket, ownerId: string): Promise<unknown>;
  /** Remove every snapshot of every bucket. Resolves for an empty store. */
  clear(): Promise<void>;
}

/** The key under which a snapshot is stored: its bucket and its owner. */
export function ghostStoreKey(bucket: GhostBucket, ownerId: string): string {
  return JSON.stringify([ghostBucketKey(bucket), ownerId]);
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
  injectRaw(bucket: GhostBucket, ownerId: string, value: unknown): void;
  /** The number of stored values. */
  size(): number;
}

function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** In-memory `GhostStore`: for tests and the reference for the others. */
export function createMemoryGhostStore(): MemoryGhostStore {
  const items = new Map<string, { bucket: string; value: unknown }>();
  let fault: string | null = null;
  return {
    save(snapshot) {
      if (fault !== null) {
        const message = fault;
        fault = null;
        return Promise.reject(new Error(message));
      }
      const staged = copy(snapshot);
      items.set(ghostStoreKey(ghostBucketOf(snapshot), snapshot.owner.id), {
        bucket: ghostBucketKey(ghostBucketOf(snapshot)),
        value: staged,
      });
      return Promise.resolve();
    },
    list(bucket) {
      const key = ghostBucketKey(bucket);
      const out = [...items.values()]
        .filter((i) => i.bucket === key)
        .map((i) => copy(i.value));
      return Promise.resolve(out.sort(compareStored));
    },
    get(bucket, ownerId) {
      const found = items.get(ghostStoreKey(bucket, ownerId));
      return Promise.resolve(found === undefined ? null : copy(found.value));
    },
    clear() {
      items.clear();
      return Promise.resolve();
    },
    failNextSave(message = 'the ghost could not be written') {
      fault = message;
    },
    injectRaw(bucket, ownerId, value) {
      items.set(ghostStoreKey(bucket, ownerId), {
        bucket: ghostBucketKey(bucket),
        value: copy(value),
      });
    },
    size() {
      return items.size;
    },
  };
}
