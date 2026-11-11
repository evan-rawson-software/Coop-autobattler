import {
  createMemorySaveStore,
  initSaves,
  startRun,
  type SaveStore,
} from '@game/session';
import { describe, expect, test } from 'vitest';
import { createMemoryFinishedRuns, type FinishedRuns } from './finished.js';
import { finishFirst } from './finish-first.js';
import { gameDeps } from './services.js';
import { INSTALLED_VERSION, RUN_VERSION } from './version.js';

interface Rig {
  readonly finished: FinishedRuns;
  readonly saves: SaveStore;
  readonly calls: string[];
  readonly fail: { finished: boolean; remove: boolean };
}

function rig(): Rig {
  const calls: string[] = [];
  const fail = { finished: false, remove: false };
  const memory = createMemorySaveStore();
  const baseFinished = createMemoryFinishedRuns();
  const finished: FinishedRuns = {
    put: (rec) => {
      if (fail.finished) return Promise.reject(new Error('quota'));
      calls.push('finished.put');
      return baseFinished.put(rec);
    },
    get: (id) => baseFinished.get(id),
  };
  const flaky: SaveStore = {
    list: () => memory.list(),
    get: (id) => memory.get(id),
    put: (rec) => memory.put(rec),
    listHistory: () => memory.listHistory(),
    bestDepthByPartySize: () => memory.bestDepthByPartySize(),
    appendHistory: (e) => {
      calls.push('history');
      return memory.appendHistory(e);
    },
    remove: (id) => {
      if (fail.remove) return Promise.reject(new Error('crash'));
      calls.push('remove');
      return memory.remove(id);
    },
  };
  return {
    finished,
    calls,
    fail,
    saves: finishFirst(flaky, finished, () => 77),
  };
}

async function endRun(saves: SaveStore) {
  const started = await startRun(
    { runId: 'r', runVersion: RUN_VERSION, seed: 4, players: ['You'], host: 0 },
    gameDeps(),
    saves,
    1,
    INSTALLED_VERSION,
  );
  if (!started.ok) throw new Error('start');
  return started.controller.dispatch(0, { type: 'abandon' }, 2);
}

describe('the finished record is durable before the save is removed', () => {
  test('it is written, then the save removed', async () => {
    const t = rig();
    const r = await endRun(t.saves);
    expect(r).toMatchObject({ ok: true });
    expect(t.calls).toEqual(['history', 'finished.put', 'remove']);
    expect((await t.finished.get('r'))?.state.outcome?.reason).toBe(
      'abandoned',
    );
    expect(await t.saves.get('r')).toBeNull();
  });

  test('if the finished record cannot be written the save stays, and the next start completes it', async () => {
    const t = rig();
    t.fail.finished = true;
    const r = await endRun(t.saves);
    expect(r).toMatchObject({ ok: true, warning: 'finish_incomplete' });
    // The run is at its last step in the save; nothing is lost.
    expect(await t.saves.get('r')).not.toBeNull();
    expect(await t.finished.get('r')).toBeNull();
    // Next start, storage works again.
    t.fail.finished = false;
    const init = await initSaves(t.saves, INSTALLED_VERSION, 9);
    expect(init.finished).toEqual(['r']);
    expect((await t.finished.get('r'))?.state.runId).toBe('r');
    expect(await t.saves.get('r')).toBeNull();
  });

  test('a crash after the finished record, before the removal, shows Run over at the next start', async () => {
    const t = rig();
    t.fail.remove = true;
    const r = await endRun(t.saves);
    expect(r).toMatchObject({ ok: true, warning: 'finish_incomplete' });
    expect(await t.finished.get('r')).not.toBeNull();
    expect(await t.saves.get('r')).not.toBeNull();
    t.fail.remove = false;
    const init = await initSaves(t.saves, INSTALLED_VERSION, 9);
    expect(init.finished).toEqual(['r']);
    expect(await t.saves.get('r')).toBeNull();
    expect(await t.finished.get('r')).not.toBeNull();
    const history = await t.saves.listHistory();
    expect(history.filter((h) => h.runId === 'r')).toHaveLength(1);
  });
});

describe('a save the game cannot read never gets a finished record', () => {
  async function stored(patch: (rec: Record<string, unknown>) => void) {
    const t = rig();
    // Put back a finished save as the stores hold it, then damage it.
    const base = createMemorySaveStore();
    const started = await startRun(
      {
        runId: 'u',
        runVersion: RUN_VERSION,
        seed: 4,
        players: ['You'],
        host: 0,
      },
      gameDeps(),
      base,
      1,
      INSTALLED_VERSION,
    );
    if (!started.ok) throw new Error('start');
    const rec = structuredClone(await base.get('u')) as Record<string, unknown>;
    const st = rec['state'] as Record<string, unknown>;
    st['outcome'] = { reason: 'abandoned' };
    (rec['summary'] as Record<string, unknown>)['outcome'] = 'abandoned';
    patch(rec);
    return { t, rec };
  }

  for (const [name, patch] of [
    [
      'unsupported format',
      (r: Record<string, unknown>) => {
        (r['state'] as Record<string, unknown>)['formatVersion'] = 999;
      },
    ],
    [
      'newer version',
      (r: Record<string, unknown>) => {
        r['runVersion'] = '99.0';
        (r['state'] as Record<string, unknown>)['runVersion'] = '99.0';
        (r['createArgs'] as Record<string, unknown>)['runVersion'] = '99.0';
      },
    ],
  ] as const) {
    test(`${name}: removed, no finished record`, async () => {
      const { t, rec } = await stored(patch);
      await t.saves.put(rec as never);
      expect(await t.saves.get('u')).not.toBeNull();
      await t.saves.remove('u');
      expect(await t.saves.get('u')).toBeNull();
      expect(await t.finished.get('u')).toBeNull();
    });
  }
});
