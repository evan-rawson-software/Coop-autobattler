import { describe, expect, test } from 'vitest';
import { ME } from '../build/session.js';
import { economy, simConfig } from '../build/setup.js';
import { content } from '../content.js';
import { buildShopView } from '../shop/view-model.js';
import {
  createMemoryStorage,
  saveKey,
  STALE_MESSAGE,
  type StorageLike,
} from './local-storage-store.js';
import {
  describeUnopenable,
  loadShopRun,
  shopRunId,
  UnopenableRunError,
} from './shop-run.js';

const ctx = { content, economy, sim: simConfig };
const KEY = saveKey(shopRunId('pvp'));

function failingStorage(): StorageLike {
  const s = createMemoryStorage();
  s.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  return s;
}

describe('two tabs on one saved run', () => {
  test('a re-roll in one tab is not undone by a buy in a stale tab', async () => {
    const storage = createMemoryStorage();
    const a = await loadShopRun({ storage });
    const b = await loadShopRun({ storage });
    expect(b.restored).toBe(true);
    const goldBefore = buildShopView(a.session.run, ME, ctx).gold;

    // Tab A re-rolls: gold goes down, offers change.
    expect((await a.session.dispatch({ type: 'reroll' })).ok).toBe(true);
    const rolled = buildShopView(a.session.run, ME, ctx);
    expect(rolled.gold).toBeLessThan(goldBefore);

    // Tab B still shows the old offers and buys one: refused, nothing shown.
    const old = b.session.run;
    const slot = buildShopView(old, ME, ctx).offers.findIndex((c) => c.canBuy);
    const r = await b.session.dispatch({ type: 'buy', slot });
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    expect(r.ok ? '' : r.detail).toBe(STALE_MESSAGE);
    expect(b.session.run).toBe(old);
    expect(b.conflict.get()).toBe(true);
    expect(a.conflict.get()).toBe(false);

    // B accepts nothing more.
    const again = await b.session.dispatch({ type: 'reroll' });
    expect(again).toMatchObject({ ok: false, reason: 'save_failed' });

    // A reload shows A's re-roll, with the refund of neither.
    const reloaded = await loadShopRun({ storage });
    expect(buildShopView(reloaded.session.run, ME, ctx)).toEqual(rolled);
    expect(reloaded.session.run.actionLog).toHaveLength(
      a.session.run.actionLog.length,
    );
  });
});

describe('a save that cannot be opened is kept', () => {
  async function planted(
    edit: (record: Record<string, unknown>) => unknown,
  ): Promise<{ storage: StorageLike; text: string }> {
    const storage = createMemoryStorage();
    await loadShopRun({ storage });
    const record = JSON.parse(storage.getItem(KEY) as string) as Record<
      string,
      unknown
    >;
    const text = JSON.stringify(edit(record));
    storage.setItem(KEY, text);
    return { storage, text };
  }

  const cases: [string, (r: Record<string, unknown>) => unknown, RegExp][] = [
    ['damaged text', () => '{not json', /damaged/],
    [
      'old run state format (version 1)',
      (r) => ({
        ...r,
        state: { ...(r['state'] as object), formatVersion: 1 },
      }),
      /format this version of the game cannot read/,
    ],
    [
      'a newer game version',
      (r) => ({
        ...r,
        runVersion: '9.0',
        createArgs: { ...(r['createArgs'] as object), runVersion: '9.0' },
        state: { ...(r['state'] as object), runVersion: '9.0' },
      }),
      /newer version of the game/,
    ],
  ];

  for (const [name, edit, words] of cases) {
    test(`${name}: an error with the reason, and the save is still there`, async () => {
      const { storage, text } = await planted(edit);
      const err = await loadShopRun({ storage }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnopenableRunError);
      expect((err as Error).message).toMatch(words);
      expect(storage.getItem(KEY)).toBe(text);
    });
  }

  test('discarding on purpose (fresh) starts a new run', async () => {
    const { storage } = await planted(() => '{not json');
    const run = await loadShopRun({ storage, fresh: true });
    expect(run.restored).toBe(false);
    expect(run.session.run.step).toBe('shop');
  });

  test('every reason has plain wording', () => {
    for (const r of [
      'corrupt',
      'unsupported_format',
      'newer',
      'older_major',
      'load_failed',
      'x',
    ]) {
      expect(describeUnopenable(r)).toMatch(/\.$/);
    }
  });
});

describe('where the run is kept', () => {
  test('working storage: saved locally', async () => {
    const run = await loadShopRun({ storage: createMemoryStorage() });
    expect(run.storage).toBe('local');
  });

  test('a failing localStorage falls back to memory, flagged as not saved', async () => {
    const run = await loadShopRun({ storage: failingStorage() });
    expect(run.storage).toBe('memory');
    expect(run.session.run.step).toBe('shop');
  });

  test('no localStorage at all falls back to memory', async () => {
    const run = await loadShopRun({ storage: null });
    expect(run.storage).toBe('memory');
  });
});
