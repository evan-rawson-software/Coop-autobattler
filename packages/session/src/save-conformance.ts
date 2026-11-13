/**
 * Conformance tests every `SaveStore` implementation must pass. Test support:
 * not exported from the package index (it imports vitest); import it from
 * `@game/session/testing`.
 *
 *   runSaveStoreConformance('IndexedDB store', () => createIndexedDbStore(...));
 *
 * `makeStore` must return an EMPTY store each time it is called.
 */
import { describe, expect, test } from 'vitest';
import type { HistoryEntry, SaveRecord, SaveStore } from './save.js';
import type { CreateRunArgs, RunState } from './types.js';

function fakeRecord(
  runId: string,
  updatedAt: number,
  round = 1,
  extra: Partial<SaveRecord> = {},
): SaveRecord {
  const createArgs: CreateRunArgs = {
    runId,
    runVersion: '0.1',
    seed: 5,
    players: ['Ann'],
    host: 0,
  };
  // The store only needs the record to have the right shape, not a playable
  // state, so the state is a minimal stand-in.
  const state = {
    runId,
    runVersion: '0.1',
    formatVersion: 9,
    seed: 5,
    actionCounter: 0,
    actionLog: [],
    players: [{ index: 0, name: 'Ann' }],
    host: 0,
    round,
    step: 'build',
    lives: 5,
    history: [],
    thisRound: { pve: null, pvp: null },
    outcome: null,
  } as unknown as RunState;
  return {
    saveFormatVersion: 1,
    runId,
    runVersion: '0.1',
    installedVersionAtSave: '0.1.0',
    actionCounter: 0,
    hostName: 'Ann',
    playerNames: ['Ann'],
    createArgs,
    state,
    summary: { round, lives: 5, step: 'build', outcome: null },
    updatedAt,
    ...extra,
  };
}

function entry(
  runId: string,
  partySize: number,
  round: number,
  reason: HistoryEntry['reason'] = 'defeated',
): HistoryEntry {
  return {
    runId,
    partySize,
    round,
    reason,
    pvpWon: 1,
    pvpLost: 2,
    runVersion: '0.1',
    finishedAt: 1000 + round,
  };
}

export function runSaveStoreConformance(
  name: string,
  makeStore: () => SaveStore | Promise<SaveStore>,
  /** An EMPTY store that refuses stale writes; omit to skip those cases. */
  makeStaleStore?: () => SaveStore | Promise<SaveStore>,
): void {
  describe(`SaveStore conformance: ${name}`, () => {
    test('starts empty; get is null; remove of an unknown ID resolves', async () => {
      const s = await makeStore();
      expect(await s.list()).toEqual([]);
      expect(await s.get('nope')).toBeNull();
      await expect(s.remove('nope')).resolves.toBeUndefined();
      expect(await s.listHistory()).toEqual([]);
      expect(await s.bestDepthByPartySize()).toEqual({});
    });

    test('put then get returns an equal record, signature preserved', async () => {
      const s = await makeStore();
      const rec = fakeRecord('a', 10, 3, { signature: 'sig-xyz' });
      await s.put(rec);
      expect(await s.get('a')).toEqual(rec);
    });

    test('a stored record is a copy: mutating what you passed or got changes nothing', async () => {
      const s = await makeStore();
      const rec = fakeRecord('a', 10);
      await s.put(rec);
      (rec.summary as { round: number }).round = 99;
      const got = (await s.get('a')) as SaveRecord;
      expect(got.summary.round).toBe(1);
      (got.summary as { round: number }).round = 77;
      expect(((await s.get('a')) as SaveRecord).summary.round).toBe(1);
    });

    test('put with an existing runId replaces it: one record per run', async () => {
      const s = await makeStore();
      await s.put(fakeRecord('a', 10, 1));
      await s.put(fakeRecord('a', 20, 2));
      const list = await s.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ runId: 'a', updatedAt: 20 });
      expect(((await s.get('a')) as SaveRecord).summary.round).toBe(2);
    });

    test('concurrent puts to one runId leave exactly one complete record', async () => {
      const s = await makeStore();
      const a = fakeRecord('a', 10, 1);
      const b = fakeRecord('a', 20, 2);
      await Promise.all([s.put(a), s.put(b)]);
      expect(await s.list()).toHaveLength(1);
      expect([a, b]).toContainEqual(await s.get('a'));
    });

    test('list is sorted by updatedAt descending, then runId; no limit', async () => {
      const s = await makeStore();
      await s.put(fakeRecord('b', 5));
      await s.put(fakeRecord('a', 5));
      await s.put(fakeRecord('c', 9));
      for (let i = 0; i < 60; i++) {
        await s.put(fakeRecord(`old-${String(i).padStart(2, '0')}`, 1));
      }
      const list = await s.list();
      expect(list).toHaveLength(63);
      expect(list.slice(0, 3).map((x) => x.runId)).toEqual(['c', 'a', 'b']);
      expect(list[3]?.runId).toBe('old-00');
      expect(list.at(-1)?.runId).toBe('old-59');
    });

    test('list entries carry the summary', async () => {
      const s = await makeStore();
      await s.put(fakeRecord('a', 10, 4));
      expect((await s.list())[0]).toMatchObject({
        corrupt: false,
        runId: 'a',
        runVersion: '0.1',
        hostName: 'Ann',
        playerNames: ['Ann'],
        summary: { round: 4, lives: 5, step: 'build', outcome: null },
      });
    });

    test('list flags a record whose run state has an unsupported format, and still returns it from get', async () => {
      const s = await makeStore();
      const good = fakeRecord('good', 10);
      const odd = fakeRecord('odd', 20);
      const unsupported: SaveRecord = {
        ...odd,
        state: { ...odd.state, formatVersion: 1 } as unknown as RunState,
      };
      await s.put(good);
      await s.put(unsupported);
      const list = await s.list();
      expect(list.map((x) => x.runId)).toEqual(['odd', 'good']);
      expect(list[0]).toMatchObject({
        corrupt: false,
        unsupportedFormat: true,
      });
      expect(list[1]).toMatchObject({ corrupt: false });
      expect(list[1]).not.toHaveProperty('unsupportedFormat');
      expect(await s.get('odd')).toEqual(unsupported);
    });

    test('remove deletes only that record', async () => {
      const s = await makeStore();
      await s.put(fakeRecord('a', 10));
      await s.put(fakeRecord('b', 11));
      await s.remove('a');
      expect(await s.get('a')).toBeNull();
      expect((await s.list()).map((x) => x.runId)).toEqual(['b']);
    });

    test('history keeps append order and ignores a second entry for a run', async () => {
      const s = await makeStore();
      await s.appendHistory(entry('x', 1, 4));
      await s.appendHistory(entry('y', 1, 2));
      await s.appendHistory(entry('x', 1, 9, 'abandoned'));
      const h = await s.listHistory();
      expect(h.map((e) => e.runId)).toEqual(['x', 'y']);
      expect(h[0]?.round).toBe(4);
    });

    test('bestDepthByPartySize is the highest round per party size', async () => {
      const s = await makeStore();
      await s.appendHistory(entry('a', 1, 4));
      await s.appendHistory(entry('b', 1, 7));
      await s.appendHistory(entry('c', 2, 3, 'version_wiped'));
      await s.appendHistory(entry('d', 1, 5));
      expect(await s.bestDepthByPartySize()).toEqual({ 1: 7, 2: 3 });
    });

    describe.skipIf(makeStaleStore === undefined)('stale writes', () => {
      const fresh = async (): Promise<SaveStore> =>
        (makeStaleStore as () => SaveStore | Promise<SaveStore>)();
      const at = (counter: number, round: number): SaveRecord =>
        fakeRecord('a', 10 + counter, round, { actionCounter: counter });

      test('a first write, then a higher counter, is stored', async () => {
        const s = await fresh();
        await s.put(at(1, 1));
        await s.put(at(2, 2));
        expect(((await s.get('a')) as SaveRecord).summary.round).toBe(2);
      });

      test('an equal or lower counter is refused and the stored record is unchanged', async () => {
        const s = await fresh();
        await s.put(at(5, 3));
        await expect(s.put(at(5, 9))).rejects.toMatchObject({
          name: 'StaleSaveError',
        });
        await expect(s.put(at(4, 9))).rejects.toMatchObject({
          name: 'StaleSaveError',
        });
        expect(((await s.get('a')) as SaveRecord).summary.round).toBe(3);
      });

      test('the counter is per run', async () => {
        const s = await fresh();
        await s.put(at(5, 3));
        await s.put(fakeRecord('b', 10, 1, { actionCounter: 1 }));
        expect(await s.list()).toHaveLength(2);
      });
    });
  });
}
