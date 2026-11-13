/**
 * Conformance tests every `GhostStore` implementation must pass. Test
 * support: it imports vitest, so it is not exported from the package index;
 * import it from `@game/session/testing`.
 *
 *   runGhostStoreConformance('IndexedDB ghost store', () => createStore());
 *
 * `makeStore` must return an EMPTY store each time it is called. The store
 * only needs the snapshots to have the identifying fields, so the tests use
 * small stand-ins, not playable teams.
 */
import { describe, expect, test } from 'vitest';
import type { GhostBucket, GhostSnapshot } from '@game/core';
import { GHOST_KEEP_PER_OWNER_BUCKET, type GhostStore } from './ghost-store.js';

function fake(
  owner: string,
  runId: string,
  bucket: GhostBucket,
  extra: Record<string, unknown> = {},
): GhostSnapshot {
  return {
    formatVersion: 1,
    gameVersion: bucket.gameVersion,
    partySize: bucket.partySize,
    round: bucket.round,
    mapSeed: 1,
    team: { stand: 'in' },
    owner: { id: owner, label: `Label ${owner}` },
    runId,
    lives: 5,
    pvpRecord: { wins: 0, losses: 0 },
    ...extra,
  } as unknown as GhostSnapshot;
}

const B: GhostBucket = { gameVersion: '0.1', partySize: 1, round: 2 };

export function runGhostStoreConformance(
  name: string,
  makeStore: () => GhostStore | Promise<GhostStore>,
): void {
  describe(`GhostStore conformance: ${name}`, () => {
    test('an empty store lists nothing, gets null and clears', async () => {
      const s = await makeStore();
      expect(await s.list(B)).toEqual([]);
      expect(await s.get(B, 'ann', 'run-a')).toBeNull();
      await s.clear();
      expect(await s.list(B)).toEqual([]);
    });

    test('a saved snapshot is listed and fetched as stored', async () => {
      const s = await makeStore();
      const g = fake('ann', 'run-a', B);
      await s.save(g);
      expect(await s.list(B)).toEqual([g]);
      expect(await s.get(B, 'ann', 'run-a')).toEqual(g);
      expect(await s.get(B, 'bob', 'run-a')).toBeNull();
      expect(await s.get(B, 'ann', 'run-x')).toBeNull();
    });

    test('stored values are copies', async () => {
      const s = await makeStore();
      const g = fake('ann', 'run-a', B);
      await s.save(g);
      (g as unknown as { lives: number }).lives = 1;
      const [got] = await s.list(B);
      expect((got as { lives: number }).lives).toBe(5);
      (got as { lives: number }).lives = 2;
      expect(
        ((await s.get(B, 'ann', 'run-a')) as { lives: number }).lives,
      ).toBe(5);
    });

    test('the same run in the same bucket is replaced, not added', async () => {
      const s = await makeStore();
      await s.save(fake('ann', 'run-a', B));
      await s.save(fake('ann', 'run-a', B, { lives: 3 }));
      const list = (await s.list(B)) as GhostSnapshot[];
      expect(list).toHaveLength(1);
      expect(list[0]?.lives).toBe(3);
    });

    test('the last GHOST_KEEP_PER_OWNER_BUCKET snapshots of an owner are kept, oldest dropped', async () => {
      const s = await makeStore();
      const k = GHOST_KEEP_PER_OWNER_BUCKET;
      for (let i = 1; i <= k + 1; i++) {
        await s.save(fake('ann', `run-${String(i)}`, B));
      }
      await s.save(fake('bob', 'run-b', B));
      const ids = ((await s.list(B)) as GhostSnapshot[]).map(
        (g) => `${g.owner.id}/${g.runId}`,
      );
      // run-1 (the oldest save) is gone; the other owner is untouched.
      expect(ids).toEqual([
        'ann/run-2',
        'ann/run-3',
        'ann/run-4',
        'ann/run-5',
        'ann/run-6',
        'bob/run-b',
      ]);
      expect(await s.get(B, 'ann', 'run-1')).toBeNull();
    });

    test('oldest means saved longest ago, not the smallest run id; a re-save is newest', async () => {
      const s = await makeStore();
      const k = GHOST_KEEP_PER_OWNER_BUCKET;
      // Run ids in descending order: the first saved has the largest id.
      for (let i = k; i >= 1; i--) {
        await s.save(fake('ann', `run-${String(i)}`, B));
      }
      // Re-saving the oldest (run-5) makes it the newest.
      await s.save(fake('ann', `run-${String(k)}`, B, { lives: 2 }));
      await s.save(fake('ann', 'run-new', B));
      const ids = ((await s.list(B)) as GhostSnapshot[]).map((g) => g.runId);
      expect(ids).toHaveLength(k);
      expect(ids).toContain('run-5');
      expect(ids).toContain('run-new');
      expect(ids).not.toContain('run-4');
    });

    test('the cap is per bucket: other buckets keep their snapshots', async () => {
      const s = await makeStore();
      const other: GhostBucket = { ...B, round: 3 };
      await s.save(fake('ann', 'o-1', other));
      for (let i = 1; i <= GHOST_KEEP_PER_OWNER_BUCKET + 1; i++) {
        await s.save(fake('ann', `run-${String(i)}`, B));
      }
      expect(await s.list(other)).toHaveLength(1);
      expect(await s.list(B)).toHaveLength(GHOST_KEEP_PER_OWNER_BUCKET);
    });

    test('other owners coexist, listed by owner id then run id', async () => {
      const s = await makeStore();
      await s.save(fake('zed', 'run-1', B));
      await s.save(fake('ann', 'run-2', B));
      await s.save(fake('bob', 'run-3', B));
      const list = (await s.list(B)) as GhostSnapshot[];
      expect(list.map((g) => g.owner.id)).toEqual(['ann', 'bob', 'zed']);
    });

    test('buckets are separate by version, party size and round', async () => {
      const s = await makeStore();
      const others: GhostBucket[] = [
        { ...B, gameVersion: '0.2' },
        { ...B, partySize: 2 },
        { ...B, round: 3 },
      ];
      await s.save(fake('ann', 'run-a', B));
      for (const [i, o] of others.entries()) {
        await s.save(fake('ann', `run-${String(i)}`, o));
      }
      expect(await s.list(B)).toHaveLength(1);
      for (const o of others) {
        const list = (await s.list(o)) as GhostSnapshot[];
        expect(list).toHaveLength(1);
        expect(list[0]?.round).toBe(o.round);
        expect(list[0]?.partySize).toBe(o.partySize);
        expect(list[0]?.gameVersion).toBe(o.gameVersion);
      }
      // Replacing in one bucket leaves the others.
      await s.save(fake('ann', 'run-new', B));
      expect(await s.list(B)).toHaveLength(2);
      for (const o of others) expect(await s.list(o)).toHaveLength(1);
    });

    test('clear removes every bucket and the store is usable after', async () => {
      const s = await makeStore();
      await s.save(fake('ann', 'run-a', B));
      await s.save(fake('bob', 'run-b', { ...B, round: 5 }));
      await s.clear();
      expect(await s.list(B)).toEqual([]);
      expect(await s.list({ ...B, round: 5 })).toEqual([]);
      expect(await s.get(B, 'ann', 'run-a')).toBeNull();
      await s.save(fake('ann', 'run-c', B));
      expect(await s.list(B)).toHaveLength(1);
    });

    test('removeOlderVersions drops other game versions and leaves the kept one', async () => {
      const s = await makeStore();
      const old: GhostBucket = { gameVersion: '0.1', partySize: 2, round: 3 };
      const cur: GhostBucket = { gameVersion: '1.0', partySize: 2, round: 3 };
      await s.save(fake('ann', 'old-a', old));
      await s.save(fake('bob', 'old-b', { ...old, round: 5 }));
      await s.save(fake('ann', 'cur-a', cur));
      await s.save(fake('bob', 'cur-b', cur));
      await s.removeOlderVersions('1.0');
      expect(await s.list(old)).toEqual([]);
      expect(await s.list({ ...old, round: 5 })).toEqual([]);
      expect(await s.get(old, 'ann', 'old-a')).toBeNull();
      expect(await s.list(cur)).toHaveLength(2);
      // Nothing left to remove, and the store is usable after.
      await s.removeOlderVersions('1.0');
      await s.save(fake('cy', 'cur-c', cur));
      expect(await s.list(cur)).toHaveLength(3);
      // An empty store is fine too.
      await s.clear();
      await s.removeOlderVersions('1.0');
    });

    test('removeOlderVersions removes lower versions only and nothing for a malformed keepVersion', async () => {
      const s = await makeStore();
      const old: GhostBucket = { gameVersion: '0.1', partySize: 2, round: 3 };
      const cur: GhostBucket = { gameVersion: '1.0', partySize: 2, round: 3 };
      const newer: GhostBucket = { gameVersion: '2.0', partySize: 2, round: 3 };
      await s.save(fake('ann', 'old-a', old));
      await s.save(fake('ann', 'cur-a', cur));
      await s.save(fake('ann', 'new-a', newer));
      for (const bad of ['', 'abc', '1.x', '1..0', 'NaN']) {
        await s.removeOlderVersions(bad);
      }
      expect(await s.list(old)).toHaveLength(1);
      expect(await s.list(cur)).toHaveLength(1);
      expect(await s.list(newer)).toHaveLength(1);
      await s.removeOlderVersions('1.0');
      expect(await s.list(old)).toEqual([]);
      expect(await s.list(cur)).toHaveLength(1);
      expect(await s.list(newer)).toHaveLength(1);
    });

    test('owner ids with odd characters do not collide', async () => {
      const s = await makeStore();
      await s.save(fake('a|b', 'r1', B));
      await s.save(fake('a', 'r2', B));
      await s.save(fake('"a"', 'r3', B));
      expect(await s.list(B)).toHaveLength(3);
      expect(((await s.get(B, 'a|b', 'r1')) as GhostSnapshot).runId).toBe('r1');
    });
  });
}
