import { describe, expect, test } from 'vitest';
import {
  checkGhostSnapshotShape,
  validateGhostSnapshot,
  type GhostSnapshot,
} from '@game/core';
import {
  createGameDeps,
  createMemoryGhostStore,
  createMemorySaveStore,
  ghostContext,
  layerGhostStores,
  openRun,
  startRun,
  type GhostStore,
  type RunDeps,
} from '@game/session';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import { driveToShop } from './drive.js';
import { loadBundledGhostStore } from './bundled-ghosts.js';
import { INSTALLED_VERSION, RUN_VERSION } from './version.js';
import file from './bundled-ghosts.json';

const deps: RunDeps = createGameDeps(content, gameConfigs, {
  ghosts: { ownerId: 'dev-test', ownerLabel: 'Runner test' },
});
const snapshots = (file as { ghosts: unknown[] }).ghosts;

function bucket(partySize: number, round: number) {
  return { gameVersion: RUN_VERSION, partySize, round };
}

function layered(): {
  local: GhostStore;
  pool: GhostStore;
} {
  const local = createMemoryGhostStore();
  return {
    local,
    pool: layerGhostStores(local, () => loadBundledGhostStore(RUN_VERSION)),
  };
}

describe('the bundled ghost file', () => {
  test('every snapshot passes the real validation and the selection bounds', () => {
    const vctx = ghostContext(deps);
    expect(vctx).not.toBeNull();
    if (vctx === null) return;
    expect(snapshots.length).toBeGreaterThan(0);
    for (const s of snapshots) {
      const v = validateGhostSnapshot(s, vctx);
      expect(v.ok ? [] : v.errors).toEqual([]);
      const shape = checkGhostSnapshotShape(
        s,
        content,
        content.mapgen,
        undefined,
        vctx,
      );
      expect(shape.ok ? [] : shape.errors).toEqual([]);
    }
  });

  test('covers party sizes 1-4 and rounds 1-6, several ghosts per bucket, all labelled as bundled bots', () => {
    const all = snapshots as GhostSnapshot[];
    for (let party = 1; party <= 4; party++) {
      for (let round = 1; round <= 6; round++) {
        const here = all.filter(
          (g) => g.partySize === party && g.round === round,
        );
        expect(here.length).toBeGreaterThanOrEqual(4);
        expect(new Set(here.map((g) => g.owner.id)).size).toBeGreaterThan(1);
      }
    }
    for (const g of all) {
      expect(g.owner.id.startsWith('bundled-')).toBe(true);
      expect(g.owner.label.startsWith('Bundled ')).toBe(true);
      expect(g.gameVersion).toBe(RUN_VERSION);
    }
  });
});

describe('the bundled source in the pool', () => {
  test('a fresh pool lists bundled ghosts; clearing the local pool keeps them', async () => {
    const { local, pool } = layered();
    expect(await local.list(bucket(1, 1))).toEqual([]);
    const rows = await pool.list(bucket(1, 1));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    await pool.clear();
    expect(await pool.list(bucket(1, 1))).toEqual(rows);
  });

  test('the bundled rows are read-only and outside the per-owner cap', async () => {
    const { local, pool } = layered();
    const [first] = await pool.list(bucket(1, 1));
    await expect(
      loadBundledGhostStore(RUN_VERSION).then((s) =>
        s?.save(first as GhostSnapshot),
      ),
    ).rejects.toThrow();
    // Seven local snapshots of one owner: the local cap drops the oldest two;
    // the bundled rows are all still there.
    const before = (await pool.list(bucket(1, 1))).length;
    for (let i = 0; i < 7; i++) {
      await pool.save({
        ...(first as GhostSnapshot),
        owner: { id: 'dev-me', label: 'Me' },
        runId: `mine-${String(i)}`,
      });
    }
    const after = await pool.list(bucket(1, 1));
    expect(after.length).toBe(before + 5);
    expect(await local.list(bucket(1, 1))).toHaveLength(5);
    expect(
      after.filter((r) => (r as GhostSnapshot).owner.id.startsWith('bundled-')),
    ).toHaveLength(before);
  });

  test('the listing is the union in the canonical order, the same however it is read', async () => {
    const { pool } = layered();
    const [first] = await pool.list(bucket(1, 1));
    await pool.save({
      ...(first as GhostSnapshot),
      owner: { id: 'dev-me', label: 'Me' },
      runId: 'mine',
    });
    const a = (await pool.list(bucket(1, 1))) as GhostSnapshot[];
    const b = (await pool.list(bucket(1, 1))) as GhostSnapshot[];
    expect(b).toEqual(a);
    const ids = a.map((g) => `${g.owner.id}\u0000${g.runId}`);
    expect(ids).toEqual([...ids].sort());
    expect(ids.some((i) => i.startsWith('dev-me'))).toBe(true);
  });

  test('a file for another version, a damaged file and a failing load leave the local pool', async () => {
    expect(await loadBundledGhostStore('9.9')).toBeNull();
    expect(
      await loadBundledGhostStore('0.1', () => Promise.resolve(null)),
    ).toBe(null);
    expect(
      await loadBundledGhostStore('0.1', () =>
        Promise.resolve({ format: 1, gameVersion: '0.1', ghosts: 'no' }),
      ),
    ).toBeNull();
    expect(
      await loadBundledGhostStore('0.1', () =>
        Promise.reject(new Error('missing')),
      ),
    ).toBeNull();
    const local = createMemoryGhostStore();
    const pool = layerGhostStores(local, () =>
      loadBundledGhostStore('0.1', () => Promise.reject(new Error('missing'))),
    );
    expect(await pool.list(bucket(1, 1))).toEqual([]);
    const other = layerGhostStores(createMemoryGhostStore(), () =>
      loadBundledGhostStore('9.9'),
    );
    expect(
      await other.list({ gameVersion: '9.9', partySize: 1, round: 1 }),
    ).toEqual([]);
  });
});

describe('a run with only the bundled source', () => {
  test('meets a bundled ghost at the first PvP battle, and a reload keeps it', async () => {
    const { pool } = layered();
    const saves = createMemorySaveStore();
    const args = {
      runId: 'fresh-run',
      runVersion: RUN_VERSION,
      seed: 3,
      players: ['You'],
      host: 0,
    };
    const started = await startRun(args, deps, saves, 1000, INSTALLED_VERSION, {
      ghostStore: pool,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const c = started.controller;
    await driveToShop(
      () => c.state,
      (intent) => c.dispatch(0, intent, 2000),
      { next: 'pvp' },
    );
    const chosen = c.state.pvpOpponent;
    expect(chosen?.kind).toBe('ghost');
    expect(chosen?.label.startsWith('Bundled ')).toBe(true);

    // Reload with the local pool cleared and the bundled file gone.
    const gone = layerGhostStores(createMemoryGhostStore(), () =>
      Promise.reject(new Error('missing')),
    );
    const reopened = await openRun(
      'fresh-run',
      deps,
      saves,
      INSTALLED_VERSION,
      {
        ghostStore: gone,
      },
    );
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    await reopened.controller.prepare(3000);
    expect(reopened.controller.state.pvpOpponent).toEqual(chosen);
  });
});
