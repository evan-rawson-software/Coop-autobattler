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
import type { GhostStore } from './ghost-store.js';

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
      expect(await s.get(B, 'ann')).toBeNull();
      await s.clear();
      expect(await s.list(B)).toEqual([]);
    });

    test('a saved snapshot is listed and fetched as stored', async () => {
      const s = await makeStore();
      const g = fake('ann', 'run-a', B);
      await s.save(g);
      expect(await s.list(B)).toEqual([g]);
      expect(await s.get(B, 'ann')).toEqual(g);
      expect(await s.get(B, 'bob')).toBeNull();
    });

    test('stored values are copies', async () => {
      const s = await makeStore();
      const g = fake('ann', 'run-a', B);
      await s.save(g);
      (g as unknown as { lives: number }).lives = 1;
      const [got] = await s.list(B);
      expect((got as { lives: number }).lives).toBe(5);
      (got as { lives: number }).lives = 2;
      expect(((await s.get(B, 'ann')) as { lives: number }).lives).toBe(5);
    });

    test('one snapshot per owner per bucket: a newer one replaces it', async () => {
      const s = await makeStore();
      await s.save(fake('ann', 'run-a', B));
      await s.save(fake('ann', 'run-b', B, { lives: 3 }));
      const list = (await s.list(B)) as GhostSnapshot[];
      expect(list).toHaveLength(1);
      expect(list[0]?.runId).toBe('run-b');
      expect(list[0]?.lives).toBe(3);
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
      for (const o of others) expect(await s.list(o)).toHaveLength(1);
    });

    test('clear removes every bucket and the store is usable after', async () => {
      const s = await makeStore();
      await s.save(fake('ann', 'run-a', B));
      await s.save(fake('bob', 'run-b', { ...B, round: 5 }));
      await s.clear();
      expect(await s.list(B)).toEqual([]);
      expect(await s.list({ ...B, round: 5 })).toEqual([]);
      expect(await s.get(B, 'ann')).toBeNull();
      await s.save(fake('ann', 'run-c', B));
      expect(await s.list(B)).toHaveLength(1);
    });

    test('owner ids with odd characters do not collide', async () => {
      const s = await makeStore();
      await s.save(fake('a|b', 'r1', B));
      await s.save(fake('a', 'r2', B));
      await s.save(fake('"a"', 'r3', B));
      expect(await s.list(B)).toHaveLength(3);
      expect(((await s.get(B, 'a|b')) as GhostSnapshot).runId).toBe('r1');
    });
  });
}
