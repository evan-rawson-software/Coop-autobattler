import { describe, expect, test } from 'vitest';
import { loadEconomyOrThrow } from '@game/core';
import economyJson from '../../../../content/economy.json';
import { createEconomyDeps } from '../rules/economy.js';
import { fixedBattle } from '../rules/defaults.js';
import { applyIntent, createRun } from '../rules/machine.js';
import { initSaves, openRun } from './run-controller.js';
import { buildSaveRecord, classifySave, type SaveRecord } from './save.js';
import { createMemorySaveStore } from './save-store-memory.js';
import { content, mapgenConfig, runArgs } from '../testing/test-support.js';
import type { SaveStore } from './save.js';

const deps = createEconomyDeps(
  content,
  mapgenConfig,
  loadEconomyOrThrow(economyJson, { buildings: content.buildings }),
  { battle: fixedBattle(true) },
);

const INSTALLED = '1.4.0';
const KEY = 'k';

const VERSIONS = {
  same: '1.4',
  newer: '1.5',
  older_minor: '1.3',
  older_major: '0.9',
} as const;
type VersionKind = keyof typeof VERSIONS;

const DAMAGES = ['none', 'shape', 'key', 'format', 'state'] as const;
type Damage = (typeof DAMAGES)[number];

function makeRecord(
  version: VersionKind,
  damage: Damage,
  ended: boolean,
): SaveRecord {
  const args = { ...runArgs(), runId: KEY, runVersion: VERSIONS[version] };
  const created = createRun(args, deps);
  if (!created.ok) throw new Error(created.detail);
  let state = created.state;
  if (ended) {
    const r = applyIntent(state, 0, { type: 'abandon' }, deps);
    if (!r.ok) throw new Error(r.reason);
    state = r.state;
  }
  const rec = buildSaveRecord(args, state, INSTALLED, 10);
  switch (damage) {
    case 'none':
      return rec;
    case 'shape':
      return { ...rec, hostName: 5 } as unknown as SaveRecord;
    case 'key':
      // Stored under KEY but claims another run (state and args agree).
      return buildSaveRecord(
        { ...args, runId: 'other' },
        { ...state, runId: 'other' },
        INSTALLED,
        10,
      );
    case 'format':
      return {
        ...rec,
        state: { ...state, formatVersion: 1 },
      } as unknown as SaveRecord;
    case 'state':
      // Well-formed record, but the state breaks a rule (too many lives).
      return {
        ...rec,
        state: { ...state, lives: 99 },
        summary: { ...rec.summary, lives: 99 },
      };
  }
}

function freshStore(rec: SaveRecord) {
  const store = createMemorySaveStore();
  store.injectRaw(KEY, rec);
  return store;
}

/** What `openRun` must say, from the documented order of checks. */
function expectedOpen(version: VersionKind, damage: Damage) {
  if (damage === 'shape' || damage === 'key') return 'corrupt';
  if (version === 'newer' || version === 'older_major') return version;
  if (damage === 'format') return 'unsupported_format';
  if (damage === 'state') return 'corrupt';
  return 'ok';
}

describe('initSaves classifies like openRun (issue #68)', () => {
  for (const version of Object.keys(VERSIONS) as VersionKind[]) {
    for (const damage of DAMAGES) {
      for (const ended of [false, true]) {
        const name = `${version} / ${damage} / ${ended ? 'ended' : 'running'}`;
        test(name, async () => {
          const rec = makeRecord(version, damage, ended);
          const open = await openRun(KEY, deps, freshStore(rec), INSTALLED);
          const said = open.ok ? 'ok' : open.reason;
          expect(said).toBe(expectedOpen(version, damage));
          expect(classifySave(rec, KEY, INSTALLED, deps).kind).toBe(
            said === 'ok' ? 'open' : said,
          );

          const store = freshStore(rec);
          const res = await initSaves(store, INSTALLED, 99, deps);
          const history = await store.listHistory();
          const kept = (await store.get(KEY)) !== null;
          expect(res.failed).toEqual([]);
          const lists = {
            wiped: res.wiped.map((w) => w.runId),
            wipedUnreadable: res.wipedUnreadable.map((w) => w.runId),
            finished: res.finished,
            newer: res.newer.map((n) => n.runId),
            unsupported: res.unsupported.map((u) => u.runId),
            corrupt: res.corrupt.map((c) => c.runId),
          };
          const only = (key: keyof typeof lists | null) => {
            for (const k of Object.keys(lists) as (keyof typeof lists)[]) {
              expect(lists[k]).toEqual(k === key ? [KEY] : []);
            }
          };

          if (said === 'ok') {
            // Readable: finished if it ended, else left as it is, unreported.
            if (ended) {
              only('finished');
              expect(kept).toBe(false);
              expect(history.map((h) => h.reason)).toEqual(['abandoned']);
            } else {
              only(null);
              expect(kept).toBe(true);
              expect(history).toEqual([]);
            }
          } else if (
            said === 'older_major' &&
            (damage === 'format' || damage === 'state')
          ) {
            // Old major that cannot be read: deleted, no history entry.
            only('wipedUnreadable');
            expect(kept).toBe(false);
            expect(history).toEqual([]);
          } else if (said === 'older_major' && damage === 'none') {
            // Readable old major: wiped, or finished with its own outcome.
            if (ended) {
              only('finished');
              expect(history.map((h) => h.reason)).toEqual(['abandoned']);
            } else {
              only('wiped');
              expect(history.map((h) => h.reason)).toEqual(['version_wiped']);
            }
            expect(kept).toBe(false);
          } else {
            // Anything else it cannot fully read (including an old-major
            // record whose shape or key is broken, so its version is not
            // trusted) is left alone, never finished or wiped, and reported.
            const bucket =
              said === 'newer'
                ? 'newer'
                : said === 'unsupported_format' || damage === 'format'
                  ? 'unsupported'
                  : 'corrupt';
            only(bucket);
            expect(kept).toBe(true);
            expect(history).toEqual([]);
            expect(await store.get(KEY)).toEqual(rec);
          }
        });
      }
    }
  }

  test('a second initSaves after a full pass changes nothing', async () => {
    const store = freshStore(makeRecord('older_major', 'none', false));
    await initSaves(store, INSTALLED, 1, deps);
    const again = await initSaves(store, INSTALLED, 2, deps);
    expect(again).toEqual({
      wiped: [],
      wipedUnreadable: [],
      finished: [],
      newer: [],
      unsupported: [],
      corrupt: [],
      failed: [],
    });
    expect(await store.listHistory()).toHaveLength(1);
  });
});

describe('a run saved before the per-player design (issue #139)', () => {
  /** What a save looked like before `core` became `cores`, format 4. */
  function preChange(version: VersionKind): SaveRecord {
    const rec = makeRecord(version, 'none', false);
    // Also without the `owner` that conduits carry since the ownership rules.
    const team = {
      ...rec.state.team,
      core: null,
      conduits: [
        { id: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, cells: [] },
      ],
    } as Record<string, unknown>;
    delete team['cores'];
    return {
      ...rec,
      state: { ...rec.state, formatVersion: 4, team },
    } as unknown as SaveRecord;
  }

  test('an old-major save is wiped at start-up, never reported as damaged', async () => {
    const rec = preChange('older_major');
    const open = await openRun(KEY, deps, freshStore(rec), INSTALLED);
    expect(open.ok ? 'ok' : open.reason).toBe('older_major');
    expect(classifySave(rec, KEY, INSTALLED, deps).kind).toBe('older_major');
    const store = freshStore(rec);
    const res = await initSaves(store, INSTALLED, 99, deps);
    expect(res.wipedUnreadable.map((w) => w.runId)).toEqual([KEY]);
    expect(res.corrupt).toEqual([]);
    expect(await store.get(KEY)).toBeNull();
  });

  test('a pre-change state under the current major is unsupported, not corrupt', async () => {
    const rec = preChange('same');
    const open = await openRun(KEY, deps, freshStore(rec), INSTALLED);
    expect(open.ok ? 'ok' : open.reason).toBe('unsupported_format');
  });
});

describe.each([5, 6])(
  'a run-state format %i save, before the Core placement without a vote (issue #131)',
  (previous) => {
    const format5 = (version: VersionKind): SaveRecord => {
      const rec = makeRecord(version, 'none', false);
      return {
        ...rec,
        state: {
          ...rec.state,
          formatVersion: previous,
          step: 'core_placement',
          votes: { topic: 'core', choices: [null] },
          pending: { proposals: [] },
        },
      } as unknown as SaveRecord;
    };

    test('under the current major it is unsupported_format, never damaged', async () => {
      const rec = format5('same');
      const open = await openRun(KEY, deps, freshStore(rec), INSTALLED);
      expect(open.ok ? 'ok' : open.reason).toBe('unsupported_format');
      const res = await initSaves(freshStore(rec), INSTALLED, 99, deps);
      expect(res.corrupt).toEqual([]);
    });

    test('under an older major it is wiped at start-up', async () => {
      const rec = format5('older_major');
      const store = freshStore(rec);
      const res = await initSaves(store, INSTALLED, 99, deps);
      expect(res.wipedUnreadable.map((w) => w.runId)).toEqual([KEY]);
      expect(res.corrupt).toEqual([]);
      expect(await store.get(KEY)).toBeNull();
    });
  },
);

/** A store whose chosen method rejects (a fake for a failing disk). */
function failing(
  inner: ReturnType<typeof createMemorySaveStore>,
  method: 'appendHistory' | 'remove',
  fail: { on: boolean },
): SaveStore {
  return {
    list: () => inner.list(),
    get: (id) => inner.get(id),
    put: (r) => inner.put(r),
    remove: (id) =>
      fail.on && method === 'remove'
        ? Promise.reject(new Error('disk'))
        : inner.remove(id),
    listHistory: () => inner.listHistory(),
    appendHistory: (e) =>
      fail.on && method === 'appendHistory'
        ? Promise.reject(new Error('disk'))
        : inner.appendHistory(e),
    bestDepthByPartySize: () => inner.bestDepthByPartySize(),
  };
}

describe('initSaves when the store fails', () => {
  for (const method of ['appendHistory', 'remove'] as const) {
    test(`${method} rejects: the save is kept, reported failed, retried next start without duplicate history`, async () => {
      const inner = freshStore(makeRecord('same', 'none', true));
      const fail = { on: true };
      const store = failing(inner, method, fail);
      const first = await initSaves(store, INSTALLED, 5, deps);
      expect(first.failed).toEqual([KEY]);
      expect(first.finished).toEqual([]);
      expect(await inner.get(KEY)).not.toBeNull();
      expect(await inner.listHistory()).toHaveLength(
        method === 'remove' ? 1 : 0,
      );
      fail.on = false;
      const second = await initSaves(store, INSTALLED, 6, deps);
      expect(second.failed).toEqual([]);
      expect(second.finished).toEqual([KEY]);
      expect(await inner.get(KEY)).toBeNull();
      expect(await inner.listHistory()).toHaveLength(1);
    });
  }
});

describe('a run-state format 2 save in a Workshop (format 3 change)', () => {
  test('openRun and initSaves both say unsupported_format and keep it', async () => {
    const rec = makeRecord('same', 'none', false);
    const old = {
      ...rec,
      summary: { ...rec.summary, step: 'event_resolve' },
      state: {
        ...rec.state,
        formatVersion: 2,
        step: 'event_resolve',
        pending: {
          offer: {
            id: 'evt_workshop',
            event: 'evt_workshop',
            type: 'workshop',
          },
          followUp: {
            prompt: 'workshop_building',
            options: [{ id: 'b1', owner: 0, price: 5 }],
            votes: [null],
          },
        },
      },
    } as unknown as SaveRecord;
    const store = freshStore(old);
    const open = await openRun(KEY, deps, store, INSTALLED);
    expect(open).toMatchObject({ ok: false, reason: 'unsupported_format' });
    const res = await initSaves(store, INSTALLED, 9, deps);
    expect(res.unsupported.map((u) => u.runId)).toEqual([KEY]);
    expect(res.failed).toEqual([]);
    expect(await store.get(KEY)).toEqual(old);
    expect(await store.listHistory()).toEqual([]);
  });
});

describe('a run-state format 7 save with a PvE threat of the old shape (issue #138)', () => {
  /** Format 7 stored `stronghold.coreHealth` and `corePosition`, no `cores`. */
  const oldShape = (version: VersionKind): SaveRecord => {
    const rec = makeRecord(version, 'none', false);
    return {
      ...rec,
      state: {
        ...rec.state,
        formatVersion: 7,
        upcomingPve: {
          options: [
            {
              threat: {
                stronghold: {
                  coreHealth: 500,
                  corePosition: { x: 11, y: 5 },
                  buildings: [],
                },
              },
            },
          ],
        },
      },
    } as unknown as SaveRecord;
  };

  test('under the current major it is unsupported_format, never damaged and never a crash', async () => {
    const rec = oldShape('same');
    const open = await openRun(KEY, deps, freshStore(rec), INSTALLED);
    expect(open.ok ? 'ok' : open.reason).toBe('unsupported_format');
    const res = await initSaves(freshStore(rec), INSTALLED, 99, deps);
    expect(res.corrupt).toEqual([]);
    expect(res.unsupported.map((u) => u.runId)).toEqual([KEY]);
  });

  test('under an older major it is wiped at start-up', async () => {
    const store = freshStore(oldShape('older_major'));
    const res = await initSaves(store, INSTALLED, 99, deps);
    expect(res.wipedUnreadable.map((w) => w.runId)).toEqual([KEY]);
    expect(res.corrupt).toEqual([]);
    expect(await store.get(KEY)).toBeNull();
  });
});

describe('a run-state format 8 save with one shared conduit id counter (issue #38)', () => {
  /** Format 8 had no `nextConduitId` in the team state. */
  const old = (version: VersionKind): SaveRecord => {
    const rec = makeRecord(version, 'none', false);
    const team: Record<string, unknown> = { ...rec.state.team };
    delete team['nextConduitId'];
    return {
      ...rec,
      state: { ...rec.state, formatVersion: 8, team },
    } as unknown as SaveRecord;
  };

  test('under the current major it is unsupported_format, never damaged', async () => {
    const rec = old('same');
    const open = await openRun(KEY, deps, freshStore(rec), INSTALLED);
    expect(open.ok ? 'ok' : open.reason).toBe('unsupported_format');
    const res = await initSaves(freshStore(rec), INSTALLED, 99, deps);
    expect(res.corrupt).toEqual([]);
    expect(res.unsupported.map((u) => u.runId)).toEqual([KEY]);
  });

  test('under an older major it is wiped at start-up', async () => {
    const store = freshStore(old('older_major'));
    const res = await initSaves(store, INSTALLED, 99, deps);
    expect(res.wipedUnreadable.map((w) => w.runId)).toEqual([KEY]);
    expect(await store.get(KEY)).toBeNull();
  });
});
