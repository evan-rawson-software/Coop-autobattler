/**
 * Bundled ghosts (W3-2, MM-12 cold start): a fixed set of snapshots shipped
 * with a build, offered to the selection as a second, READ-ONLY source next
 * to the local pool.
 *
 * Nothing here does I/O. A front end loads the file (lazily), hands the
 * parsed value to `bundledGhostsOf`, and wraps its local store with
 * `layerGhostStores`.
 *
 * Candidate order. `GhostStore.list` returns one bucket's rows in the
 * canonical order (owner id, then run id). The layered list is the UNION of
 * the local and the bundled rows of the bucket, one row per `ghostKey`
 * (a local row wins over a bundled one with the same key; bundled owner ids
 * start with `bundled-`, so in practice the keys never meet), sorted in the
 * canonical order over the union, then cut at `GHOST_LIST_LIMIT`. The order
 * depends on the contents of the two sources only, never on which loaded
 * first, so the same pool always gives the same listing. The selection does
 * not depend on the listing order beyond that: it puts eligible rows in an
 * order derived from `hashJson([runId, round, key])` and logs only the draw,
 * so replay and reload never read the pool at all.
 */
import { ghostBucketKey, type GhostBucket } from '@game/core';
import {
  compareStored,
  GHOST_LIST_LIMIT,
  type GhostStore,
} from './ghost-store.js';

/** The layout of the bundled file. */
export const BUNDLED_GHOST_FORMAT = 1;

/** Owner ids of bundled ghosts start with this; local ids never do. */
export const BUNDLED_OWNER_PREFIX = 'bundled-';

export interface BundledGhostFile {
  readonly format: typeof BUNDLED_GHOST_FORMAT;
  /** The game version (`major.minor`) the snapshots were taken on. */
  readonly gameVersion: string;
  /** Snapshots, validated by the selection like any other row. */
  readonly ghosts: readonly unknown[];
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * The snapshots of a loaded bundled file for the running version, or an
 * empty list when the file is not a bundled file or was made for another
 * game version (`major.minor`). Never throws; the rows stay unvalidated.
 */
export function bundledGhostsOf(
  raw: unknown,
  runningVersion: string,
): readonly unknown[] {
  try {
    const f = rec(raw);
    if (f === null || f['format'] !== BUNDLED_GHOST_FORMAT) return [];
    if (f['gameVersion'] !== runningVersion) return [];
    const ghosts = f['ghosts'];
    return Array.isArray(ghosts) ? (ghosts as readonly unknown[]) : [];
  } catch {
    return [];
  }
}

function bucketKeyOf(v: unknown): string | null {
  const r = rec(v);
  if (r === null) return null;
  const { gameVersion, partySize, round } = r;
  return typeof gameVersion === 'string' &&
    typeof partySize === 'number' &&
    typeof round === 'number'
    ? ghostBucketKey({ gameVersion, partySize, round })
    : null;
}

function identityOf(v: unknown): { owner: string; runId: string } | null {
  const r = rec(v);
  const owner = rec(r?.['owner']);
  const id = owner?.['id'];
  const runId = r?.['runId'];
  return typeof id === 'string' && typeof runId === 'string'
    ? { owner: id, runId }
    : null;
}

function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** A read-only `GhostStore` over fixed rows: `save` rejects, `clear` is a no-op. */
export function createBundledGhostStore(rows: readonly unknown[]): GhostStore {
  const byBucket = new Map<string, unknown[]>();
  for (const row of rows) {
    const key = bucketKeyOf(row);
    if (key === null || identityOf(row) === null) continue;
    const list = byBucket.get(key);
    if (list === undefined) byBucket.set(key, [row]);
    else list.push(row);
  }
  for (const list of byBucket.values()) list.sort(compareStored);
  return {
    save() {
      return Promise.reject(new Error('the bundled ghosts are read-only'));
    },
    list(bucket: GhostBucket) {
      const list = byBucket.get(ghostBucketKey(bucket)) ?? [];
      return Promise.resolve(copy(list.slice(0, GHOST_LIST_LIMIT)));
    },
    get(bucket, ownerId, runId) {
      const found = (byBucket.get(ghostBucketKey(bucket)) ?? []).find((r) => {
        const id = identityOf(r);
        return id !== null && id.owner === ownerId && id.runId === runId;
      });
      return Promise.resolve(found === undefined ? null : copy(found));
    },
    clear() {
      return Promise.resolve();
    },
  };
}

/**
 * The local store with the bundled ghosts as a second, read-only source.
 *
 *  - `save` and `clear` act on the local store only; the per-owner cap and
 *    eviction are the local store's and never see a bundled row.
 *  - `list` is the union described at the top of this file. `loadBundled`
 *    is called on the first read, once; if it rejects or gives null the pool
 *    is the local one. A failing local `list` leaves the bundled rows.
 *  - `get` reads the local store, then the bundled one.
 */
export function layerGhostStores(
  local: GhostStore,
  loadBundled: () => Promise<GhostStore | null>,
): GhostStore {
  let loading: Promise<GhostStore | null> | null = null;
  const bundled = (): Promise<GhostStore | null> => {
    loading ??= loadBundled().catch(() => null);
    return loading;
  };
  return {
    save: (snapshot) => local.save(snapshot),
    clear: () => local.clear(),
    async list(bucket) {
      const [own, shipped] = await Promise.all([
        local.list(bucket).then(
          (r) => ({ ok: true as const, rows: r }),
          (e: unknown) => ({ ok: false as const, error: e }),
        ),
        bundled().then((b) => (b === null ? [] : b.list(bucket))),
      ]);
      if (!own.ok && shipped.length === 0) throw own.error;
      const rows = own.ok ? own.rows : [];
      const seen = new Set<string>();
      for (const row of rows) {
        const id = identityOf(row);
        if (id !== null) seen.add(JSON.stringify([id.owner, id.runId]));
      }
      const merged = [...rows];
      for (const row of shipped) {
        const id = identityOf(row);
        if (id === null) continue;
        const key = JSON.stringify([id.owner, id.runId]);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
      return merged.sort(compareStored).slice(0, GHOST_LIST_LIMIT);
    },
    async get(bucket, ownerId, runId) {
      const own = await local.get(bucket, ownerId, runId);
      if (own !== null && own !== undefined) return own;
      const b = await bundled();
      return b === null ? null : b.get(bucket, ownerId, runId);
    },
  };
}
