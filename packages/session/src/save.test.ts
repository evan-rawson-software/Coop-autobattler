import { describe, expect, test } from 'vitest';
import { loadEconomyOrThrow, type EconomyConfig } from '@game/core';
import economyJson from '../../../content/economy.json';
import { fixedBattle } from './defaults.js';
import { createEconomyDeps, readShop } from './economy.js';
import { replayRun } from './machine.js';
import {
  initSaves,
  openRun,
  removeRun,
  startRun,
  type RunController,
} from './run-controller.js';
import {
  buildSaveRecord,
  parseSaveRecord,
  StaleSaveError,
  type SaveRecord,
} from './save.js';
import { runSaveStoreConformance } from './save-conformance.js';
import {
  createMemorySaveStore,
  type MemorySaveStore,
} from './save-store-memory.js';
import {
  content,
  coreMove,
  corePosition,
  mapgenConfig,
  runArgs,
} from './test-support.js';
import type { BattleResolver, Intent, RunDeps, RunState } from './types.js';
import { classify, compareVersions, parseVersion } from './version.js';

const economy = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
});

function depsFor(
  eco: EconomyConfig = economy,
  battle: BattleResolver = fixedBattle(true),
): RunDeps {
  return createEconomyDeps(content, mapgenConfig, eco, { battle });
}

const INSTALLED = '0.1.0';
let clock = 1000;
const tick = (): number => ++clock;

async function start(
  store: MemorySaveStore,
  deps: RunDeps = depsFor(),
  args = runArgs(),
): Promise<RunController> {
  const r = await startRun(args, deps, store, tick(), INSTALLED);
  if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
  return r.controller;
}

async function open(
  store: MemorySaveStore,
  deps: RunDeps = depsFor(),
  installed = INSTALLED,
  runId = 'run-1',
) {
  const r = await openRun(runId, deps, store, installed);
  if (!r.ok) throw new Error(`open: ${r.reason}`);
  return r;
}

function shopOf(s: RunState) {
  const d = readShop(s.perPlayer[0] as RunState['perPlayer'][number]);
  if (d === null) throw new Error('no shop');
  return d;
}

/** A simple, deterministic player: what to do next in the current state. */
function nextIntent(s: RunState, phase: Map<string, number>): Intent {
  const key = `${String(s.round)}${s.leg}${s.step}`;
  const n = phase.get(key) ?? 0;
  phase.set(key, n + 1);
  const options = (s.pending as { options?: { id: string }[] } | null)?.options;
  switch (s.step) {
    case 'core_placement':
      return coreMove(s);
    case 'pve_choice':
    case 'event_choice':
      return { type: 'vote', choice: options?.[0]?.id ?? '' };
    case 'build': {
      const stash = s.team.stash.find((e) => e.owner === 0);
      const node = s.team.map.nodes[0];
      if (n === 0 && stash !== undefined && node !== undefined) {
        return {
          type: 'place_building',
          id: stash.id,
          x: node.x,
          y: node.y,
          rotation: 90,
        };
      }
      return { type: 'ready' };
    }
    case 'shop':
      if (n === 0) return { type: 'reroll' };
      if (n === 1) return { type: 'buy', slot: 0 };
      if (n === 2) return { type: 'buy', slot: 1 };
      return { type: 'ready' };
    default:
      return { type: 'ready' };
  }
}

async function playUntil(
  c: RunController,
  stop: (s: RunState) => boolean,
  each?: (c: RunController) => Promise<void>,
): Promise<void> {
  const phase = new Map<string, number>();
  for (let i = 0; i < 300 && !stop(c.state); i++) {
    const intent = nextIntent(c.state, phase);
    const r = await c.dispatch(0, intent, tick());
    if (!r.ok && r.reason === 'save_failed') throw new Error('save failed');
    if (r.ok && each !== undefined) await each(c);
  }
  expect(stop(c.state)).toBe(true);
}

describe('versions', () => {
  test('parse, compare, classify', () => {
    expect(parseVersion('0.1')).toEqual({ major: 0, minor: 1, patch: null });
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    for (const bad of ['1', '1.2.3.4', 'a.b', '01.2', '', null, 5]) {
      expect(parseVersion(bad)).toBeNull();
    }
    expect(compareVersions('1.2.3', '1.10.0')).toBe(-1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(classify('1.2', '1.2.7')).toBe('same');
    expect(classify('1.1', '1.2.0')).toBe('older_minor');
    expect(classify('0.9', '1.0.0')).toBe('older_major');
    expect(classify('1.3', '1.2.9')).toBe('newer');
    expect(classify('2.0', '1.9.0')).toBe('newer');
    expect(() => classify('x', '1.0.0')).toThrow(RangeError);
  });
});

runSaveStoreConformance(
  'memory',
  () => createMemorySaveStore(),
  () => createMemorySaveStore({ rejectStale: true }),
);

describe('the memory store', () => {
  test('two overlapping puts at one counter: only the first is stored', async () => {
    const release: (() => void)[] = [];
    const store = createMemorySaveStore({
      rejectStale: true,
      beforePut: () =>
        new Promise<void>((resolve) => {
          release.push(resolve);
        }),
    });
    const state = (await start(createMemorySaveStore())).state;
    const mk = (round: number): SaveRecord => {
      const rec = buildSaveRecord(runArgs(), state, INSTALLED, 1);
      return { ...rec, summary: { ...rec.summary, round } };
    };
    const a = store.put(mk(1));
    const b = store.put(mk(2));
    await Promise.resolve();
    await Promise.resolve();
    release.forEach((r) => {
      r();
    });
    const results = await Promise.allSettled([a, b]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    const stored = (await store.get('run-1')) as SaveRecord;
    expect(stored.summary.round).toBe(1);
  });
});

describe('the save record', () => {
  test('carries the seed and the full action log; replays to the same state', async () => {
    const store = createMemorySaveStore();
    const deps = depsFor();
    const c = await start(store, deps);
    await playUntil(c, (s) => s.step === 'shop');
    const raw = await store.get('run-1');
    const parsed = parseSaveRecord(raw, deps);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    const rec = parsed.record;
    expect(rec.state.seed).toBe(rec.createArgs.seed);
    expect(rec.state.actionLog).toHaveLength(rec.actionCounter);
    expect(rec.actionCounter).toBe(c.state.actionCounter);
    expect(rec.installedVersionAtSave).toBe(INSTALLED);
    const replayed = replayRun(rec.createArgs, rec.state.actionLog, deps);
    expect(replayed.ok && replayed.state).toEqual(rec.state);
  });

  test('malformed records are corrupt, not thrown', async () => {
    const store = createMemorySaveStore();
    const deps = depsFor();
    const c = await start(store, deps);
    await playUntil(c, (s) => s.step === 'build');
    const good = (await store.get('run-1')) as SaveRecord;
    const clone = (): Record<string, unknown> =>
      JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'x',
      [],
      {},
      { ...clone(), state: undefined },
      { ...clone(), runId: 7 },
      { ...clone(), actionCounter: good.actionCounter + 1 },
      { ...clone(), summary: { ...good.summary, round: 99 } },
      { ...clone(), extra: 1 },
      { ...clone(), signature: 5 },
      { ...clone(), updatedAt: 1.5 },
      { ...clone(), state: { ...good.state, actionCounter: 0 } },
      { ...clone(), state: { ...good.state, step: 'pvp_battle' } },
      { ...clone(), createArgs: { ...good.createArgs, seed: 99 } },
    ];
    for (const raw of bad) {
      const r = parseSaveRecord(raw, deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    }
    // The good one still parses, and a signature is accepted and kept.
    expect(parseSaveRecord(good, deps).ok).toBe(true);
    const signed = { ...clone(), signature: 'abc' };
    const sr = parseSaveRecord(signed, deps);
    expect(sr.ok && sr.record.signature).toBe('abc');
  });

  test('older battles are not accumulated: history is results only', async () => {
    const store = createMemorySaveStore();
    const c = await start(store);
    await playUntil(c, (s) => s.round === 3 && s.step === 'pve_choice');
    const rec = (await store.get('run-1')) as SaveRecord;
    expect(rec.state.history).toHaveLength(2);
    expect(JSON.stringify(rec.state.history)).not.toContain('detail');
    // Only the pending (most recent) battle may carry detail, and at a
    // pve_choice there is none.
    expect(JSON.stringify(rec.state)).not.toContain('"detail"');
    const afterBattle = await start(createMemorySaveStore(), depsFor());
    await playUntil(afterBattle, (s) => s.step === 'pve_summary');
    expect(JSON.stringify(afterBattle.state)).toContain('"detail"');
  });
});

describe('the run controller', () => {
  test('1: a fresh controller resumes at exactly the state after every intent', async () => {
    const store = createMemorySaveStore();
    const deps = depsFor();
    const c = await start(store, deps);
    let checked = 0;
    await playUntil(
      c,
      (s) => s.round === 3 && s.step === 'pve_choice',
      async (ctl) => {
        const o = await open(store, deps);
        expect(o.controller.state).toEqual(ctl.state);
        expect(o.versionNotice).toBe(false);
        checked += 1;
      },
    );
    expect(checked).toBeGreaterThan(20);
    // The script bought, re-rolled and placed.
    const log = c.state.actionLog.map(
      (a) => (a.intent as { type: string }).type,
    );
    for (const t of ['buy', 'reroll', 'place_building', 'ready', 'vote']) {
      expect(log).toContain(t);
    }
  });

  test('2: offers survive reopening; a stored battle is not re-fought', async () => {
    const store = createMemorySaveStore();
    const deps = depsFor();
    const c = await start(store, deps);
    await playUntil(c, (s) => s.step === 'shop');
    await c.dispatch(0, { type: 'reroll' }, tick());
    const before = shopOf(c.state).offers;
    const o = await open(store, deps);
    expect(shopOf(o.controller.state).offers).toEqual(before);

    await playUntil(c, (s) => s.step === 'pve_summary' && s.round === 2);
    let calls = 0;
    const spy: BattleResolver = {
      resolve(input) {
        calls += 1;
        return fixedBattle(false).resolve(input);
      },
    };
    const spyDeps = depsFor(economy, spy);
    const o2 = await open(store, spyDeps);
    expect(calls).toBe(0);
    expect(o2.controller.state).toEqual(c.state);
    expect(JSON.stringify(o2.controller.state.pending)).toContain('"won":true');
  });

  test('3: stored outcomes survive a rules change; the next roll and battle use the new rules', async () => {
    const store = createMemorySaveStore();
    const deps = depsFor();
    const c = await start(store, deps);
    await playUntil(c, (s) => s.step === 'shop' && s.leg === 'pve');
    const storedOffers = shopOf(c.state).offers;
    const midShop = c.state;

    const newEco: EconomyConfig = {
      ...economy,
      rerollCost: 4,
      tierOdds: [{ fromRound: 1, weights: [0, 100, 0] }],
    };
    const newDeps = depsFor(newEco, fixedBattle(false));
    const o = await open(store, newDeps, '0.2.0');
    expect(o.versionNotice).toBe(true);
    expect(o.controller.state).toEqual(midShop);
    expect(shopOf(o.controller.state).offers).toEqual(storedOffers);
    expect(storedOffers.every((x) => x !== null && x.tier === 1)).toBe(true);

    // Continue: the pvp battle is fought by the new resolver (a loss), and the
    // next shop is rolled with the new odds.
    const ctl = o.controller;
    await playUntil(ctl, (s) => s.step === 'pvp_summary');
    expect(JSON.stringify(ctl.state.pending)).toContain('"won":false');

    // Another save, taken just after a battle under the old rules, shows the
    // old result when opened under the new rules.
    const store2 = createMemorySaveStore();
    const c2 = await start(store2, deps);
    await playUntil(c2, (s) => s.step === 'pve_summary');
    const o2 = await open(store2, newDeps, '0.2.0');
    expect(o2.versionNotice).toBe(true);
    expect(o2.controller.state).toEqual(c2.state);
    expect(JSON.stringify(o2.controller.state.pending)).toContain('"won":true');
    await playUntil(o2.controller, (s) => s.step === 'shop');
    const rolled = shopOf(o2.controller.state).offers;
    expect(rolled.every((x) => x !== null && x.tier === 2)).toBe(true);
    // The record kept the run's own version and the new installed version.
    const rec = (await store2.get('run-1')) as SaveRecord;
    expect(rec.runVersion).toBe('0.1');
    expect(rec.installedVersionAtSave).toBe('0.2.0');
  });

  test('4: startRun rejects an existing runId; one record per run', async () => {
    const store = createMemorySaveStore();
    const c = await start(store);
    await playUntil(c, (s) => s.step === 'build');
    const again = await startRun(
      runArgs(),
      depsFor(),
      store,
      tick(),
      INSTALLED,
    );
    expect(again).toMatchObject({ ok: false, reason: 'run_exists' });
    expect(store.size()).toBe(1);
    expect(((await store.get('run-1')) as SaveRecord).actionCounter).toBe(
      c.state.actionCounter,
    );
    const bad = await startRun(
      { ...runArgs(), seed: -1 },
      depsFor(),
      store,
      tick(),
      INSTALLED,
    );
    expect(bad).toMatchObject({ ok: false, reason: 'invalid_args' });
    // The store interface has no way to copy a record under a new ID.
    expect(
      Object.keys(store).some((k) => /copy|clone|duplicate/i.test(k)),
    ).toBe(false);
  });

  test('5: a failed write leaves the old save, the state, and a retry works', async () => {
    const store = createMemorySaveStore();
    const c = await start(store);
    await playUntil(c, (s) => s.step === 'build');
    const before = c.state;
    const savedBefore = await store.get('run-1');
    store.failNextPut();
    const intent: Intent = { type: 'ready' };
    const failed = await c.dispatch(0, intent, tick());
    expect(failed).toMatchObject({ ok: false, reason: 'save_failed' });
    expect(c.state).toBe(before);
    expect(await store.get('run-1')).toEqual(savedBefore);
    const retry = await c.dispatch(0, intent, tick());
    expect(retry.ok).toBe(true);
    expect(c.state.actionCounter).toBe(before.actionCounter + 1);
    expect((await open(store)).controller.state).toEqual(c.state);
    // A rejected intent writes nothing.
    let puts = 0;
    const counting = createMemorySaveStore({
      beforePut: () => {
        puts += 1;
      },
    });
    const c2 = await start(counting);
    const n = puts;
    const rej = await c2.dispatch(0, { type: 'ready' }, tick());
    expect(rej).toMatchObject({ ok: false, reason: 'core_not_placed' });
    expect(puts).toBe(n);
  });

  test('5a: a stale write is its own reason, and nothing is revealed', async () => {
    const store = createMemorySaveStore();
    const c = await start(store);
    await playUntil(c, (s) => s.step === 'build');
    const before = c.state;
    const savedBefore = await store.get('run-1');
    store.put = () => Promise.reject(new StaleSaveError());
    const r = await c.dispatch(0, { type: 'ready' }, tick());
    expect(r).toMatchObject({
      ok: false,
      reason: 'stale',
      detail: 'This run changed in another tab.',
    });
    expect(c.state).toBe(before);
    expect(await store.get('run-1')).toEqual(savedBefore);
  });

  test('5a: a tab holding a discarded run cannot overwrite the run started after it', async () => {
    const store = createMemorySaveStore({ rejectStale: true });
    const a = await start(store);
    await playUntil(a, (s) => s.step === 'build');
    // Tab B: the run is discarded and a new one starts under the same key.
    await store.remove('run-1');
    const b = await start(store);
    const second = (await store.get('run-1')) as SaveRecord;
    expect(a.state.actionCounter).toBeGreaterThan(b.state.actionCounter);
    const r = await a.dispatch(0, { type: 'ready' }, tick());
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    expect(await store.get('run-1')).toEqual(second);
    // The start stamp is carried unchanged on later writes of one run.
    await b.dispatch(
      0,
      { type: 'place_core', ...corePosition(b.state) },
      tick(),
    );
    const later = (await store.get('run-1')) as SaveRecord;
    expect(later.actionCounter).toBeGreaterThan(second.actionCounter);
    expect(later.startedAt).toBe(second.startedAt);
  });

  test('5b: a hook that throws mid-put leaves no partial record', async () => {
    const store = createMemorySaveStore({
      beforePut: (rec) => {
        if (rec.actionCounter === 2) throw new Error('disk full');
      },
    });
    const c = await start(store);
    await c.dispatch(
      0,
      { type: 'place_core', ...corePosition(c.state) },
      tick(),
    );
    const stored = await store.get('run-1');
    const r = await c.dispatch(0, { type: 'ready' }, tick());
    expect(r.ok).toBe(false);
    expect(await store.get('run-1')).toEqual(stored);
  });

  test('6: version handling at open and at start-up', async () => {
    const deps = depsFor();
    const store = createMemorySaveStore();
    const c = await start(store, deps);
    await playUntil(c, (s) => s.step === 'build');
    // Same major, run is an older minor: opens with a notice.
    const older = await open(store, deps, '0.5.0');
    expect(older.versionNotice).toBe(true);
    // Older major: not openable; initSaves wipes it.
    expect(await openRun('run-1', deps, store, '1.0.0')).toMatchObject({
      ok: false,
      reason: 'older_major',
    });
    // Newer than installed: not openable.
    const newer = createMemorySaveStore();
    await start(newer, deps, {
      ...runArgs(),
      runId: 'n',
      runVersion: '3.0',
    });
    expect(await openRun('n', deps, newer, '2.0.0')).toMatchObject({
      ok: false,
      reason: 'newer',
    });

    const s = createMemorySaveStore();
    await start(s, deps, { ...runArgs(), runId: 'old' });
    const k = await start(s, deps, {
      ...runArgs(),
      runId: 'keep',
      runVersion: '1.2',
    });
    await playUntil(k, (st) => st.step === 'build');
    await start(s, deps, { ...runArgs(), runId: 'future', runVersion: '2.0' });
    s.injectRaw('broken', { nope: true });
    const res = await initSaves(s, '1.4.0', 5000, deps);
    expect(res.wiped).toEqual([
      { runId: 'old', runVersion: '0.1', round: 1, hostName: 'Ann' },
    ]);
    expect(res.newer).toEqual([{ runId: 'future', runVersion: '2.0' }]);
    expect(res.corrupt.map((x) => x.runId)).toEqual(['broken']);
    expect(res.finished).toEqual([]);
    expect(await s.get('old')).toBeNull();
    expect(await s.get('future')).not.toBeNull();
    expect(await s.get('keep')).not.toBeNull();
    expect(await s.get('broken')).not.toBeNull();
    expect(await s.listHistory()).toEqual([
      {
        runId: 'old',
        partySize: 1,
        round: 1,
        reason: 'version_wiped',
        pvpWon: 0,
        pvpLost: 0,
        runVersion: '0.1',
        finishedAt: 5000,
      },
    ]);
    // Running again changes nothing.
    const again = await initSaves(s, '1.4.0', 6000, deps);
    expect(again.wiped).toEqual([]);
    expect((await s.listHistory()).length).toBe(1);
  });

  test('corrupt records are reported by openRun and not deleted', async () => {
    const store = createMemorySaveStore();
    await start(store);
    const good = (await store.get('run-1')) as SaveRecord;
    store.injectRaw('run-1', { ...good, actionCounter: 9 });
    const r = await openRun('run-1', depsFor(), store, INSTALLED);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('corrupt');
      expect(r.errors?.length).toBeGreaterThan(0);
    }
    expect(store.size()).toBe(1);
    expect((await store.list())[0]).toMatchObject({ runId: 'run-1' });
    expect(await openRun('missing', depsFor(), store, INSTALLED)).toMatchObject(
      {
        ok: false,
        reason: 'not_found',
      },
    );
  });

  test('a save with an unsupported run-state format is listed as such and openRun says so', async () => {
    const store = createMemorySaveStore();
    await start(store);
    const good = (await store.get('run-1')) as SaveRecord;
    // A normal save lists without the flag.
    expect((await store.list())[0]).not.toHaveProperty('unsupportedFormat');
    store.injectRaw('run-1', {
      ...good,
      state: { ...good.state, formatVersion: 1 },
    });
    const item = (await store.list())[0];
    expect(item).toMatchObject({
      corrupt: false,
      runId: 'run-1',
      unsupportedFormat: true,
    });
    const r = await openRun('run-1', depsFor(), store, INSTALLED);
    expect(r).toMatchObject({ ok: false, reason: 'unsupported_format' });
    // Left in the store, untouched.
    expect(store.size()).toBe(1);
    // Genuinely damaged data stays corrupt.
    store.injectRaw('run-1', { ...good, actionCounter: 9 });
    const damaged = (await store.list())[0];
    expect(damaged).toMatchObject({ corrupt: true, runId: 'run-1' });
    expect(damaged).not.toHaveProperty('unsupportedFormat');
    const reopened = await openRun('run-1', depsFor(), store, INSTALLED);
    expect(reopened).toMatchObject({ ok: false, reason: 'corrupt' });
    expect(reopened).not.toMatchObject({ reason: 'unsupported_format' });
  });

  test('an unsupported-format save from a newer or an older-major game reports the version first', async () => {
    const deps = depsFor();
    const store = createMemorySaveStore();
    await start(store, deps, {
      ...runArgs(),
      runId: 'newer',
      runVersion: '3.0',
    });
    await start(store, deps, { ...runArgs(), runId: 'old', runVersion: '0.1' });
    for (const id of ['newer', 'old']) {
      const good = (await store.get(id)) as SaveRecord;
      store.injectRaw(id, {
        ...good,
        state: { ...good.state, formatVersion: 1 },
      });
    }
    // Installed 2.0.0: 3.0 is newer, 0.1 is an older major.
    expect(await openRun('newer', deps, store, '2.0.0')).toEqual({
      ok: false,
      reason: 'newer',
    });
    expect(await openRun('old', deps, store, '2.0.0')).toEqual({
      ok: false,
      reason: 'older_major',
    });
    // Same major and minor as installed: the format is the reason.
    expect(await openRun('old', deps, store, '0.1.0')).toEqual({
      ok: false,
      reason: 'unsupported_format',
    });
  });

  test('openRun checks the run ID against the key before the format or version', async () => {
    const deps = depsFor();
    const store = createMemorySaveStore();
    await start(store, deps);
    const good = (await store.get('run-1')) as SaveRecord;
    store.injectRaw('other', {
      ...good,
      state: { ...good.state, formatVersion: 1 },
    });
    expect(await openRun('other', deps, store, INSTALLED)).toMatchObject({
      ok: false,
      reason: 'corrupt',
    });
  });

  test('a same-format save from a newer game that fails validation is "newer", not corrupt', async () => {
    const deps = depsFor();
    const store = createMemorySaveStore();
    await start(store, deps, { ...runArgs(), runId: 'n', runVersion: '3.0' });
    const good = (await store.get('n')) as SaveRecord;
    // A step this build does not know: fails validation, shape is fine.
    // The summary must stay consistent with the state for the shape check.
    store.injectRaw('n', {
      ...good,
      state: { ...good.state, step: 'future_step' },
      summary: { ...good.summary, step: 'future_step' },
    });
    expect(parseSaveRecord(await store.get('n'), deps).ok).toBe(false);
    expect(await openRun('n', deps, store, '2.0.0')).toEqual({
      ok: false,
      reason: 'newer',
    });
    // The same damage in a save of the installed version is corrupt.
    expect(await openRun('n', deps, store, '3.0.0')).toMatchObject({
      ok: false,
      reason: 'corrupt',
    });
  });

  test('initSaves lists unsupported-format saves and leaves them alone, even finished or old ones', async () => {
    const deps = depsFor();
    const store = createMemorySaveStore();
    await start(store, deps, { ...runArgs(), runId: 'fmt' });
    await start(store, deps, { ...runArgs(), runId: 'ended' });
    await start(store, deps, { ...runArgs(), runId: 'ok' });
    const fmt = (await store.get('fmt')) as SaveRecord;
    store.injectRaw('fmt', {
      ...fmt,
      state: { ...fmt.state, formatVersion: 1 },
    });
    const ended = (await store.get('ended')) as SaveRecord;
    store.injectRaw('ended', {
      ...ended,
      state: {
        ...ended.state,
        formatVersion: 1,
        outcome: { reason: 'defeated', round: 1 },
      },
      summary: { ...ended.summary, outcome: 'defeated' },
    });
    // Same major: the unreadable ones are listed and left alone.
    const res = await initSaves(store, '0.9.0', 9000, deps);
    expect(
      [...res.unsupported].sort((a, b) => (a.runId < b.runId ? -1 : 1)),
    ).toEqual([
      { runId: 'ended', runVersion: '0.1' },
      { runId: 'fmt', runVersion: '0.1' },
    ]);
    expect(res.finished).toEqual([]);
    expect(res.wiped).toEqual([]);
    expect(await store.get('fmt')).not.toBeNull();
    expect(await store.get('ended')).not.toBeNull();
    expect(await store.listHistory()).toEqual([]);
    // Installed 1.4.0 makes all three older majors (issue #71): the readable
    // one is wiped into history, the unreadable ones are deleted without.
    const major = await initSaves(store, '1.4.0', 9000, deps);
    expect(major.unsupported).toEqual([]);
    expect(major.wiped.map((w) => w.runId)).toEqual(['ok']);
    expect([...major.wipedUnreadable.map((w) => w.runId)].sort()).toEqual([
      'ended',
      'fmt',
    ]);
    expect(await store.get('fmt')).toBeNull();
    expect(await store.get('ended')).toBeNull();
    expect((await store.listHistory()).map((h) => h.runId)).toEqual(['ok']);
    // A normal start-up reports none.
    expect(
      (await initSaves(createMemorySaveStore(), '1.4.0', 1, deps)).unsupported,
    ).toEqual([]);
  });

  test('7: a finished run leaves the saved list and enters history', async () => {
    const store = createMemorySaveStore();
    const deps = depsFor(economy, fixedBattle(false));
    const c = await start(store, deps);
    await playUntil(c, (s) => s.outcome !== null);
    expect(c.state.outcome?.reason).toBe('defeated');
    expect(await store.list()).toEqual([]);
    const h = await store.listHistory();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      runId: 'run-1',
      partySize: 1,
      reason: 'defeated',
      pvpWon: 0,
      pvpLost: 5,
    });
    const depth = c.state.outcome?.round ?? 0;
    expect(await store.bestDepthByPartySize()).toEqual({ 1: depth });
    // A finished run's ID cannot be started again.
    expect(
      await startRun(runArgs(), deps, store, tick(), INSTALLED),
    ).toMatchObject({ ok: false, reason: 'run_exists' });

    // Abandon flows through the same path.
    const c2 = await start(store, deps, { ...runArgs(), runId: 'b' });
    const r = await c2.dispatch(0, { type: 'abandon' }, tick());
    expect(r.ok).toBe(true);
    expect(await store.list()).toEqual([]);
    expect((await store.listHistory()).map((e) => e.reason)).toEqual([
      'defeated',
      'abandoned',
    ]);
  });

  test('7b: an interruption between history and removal is finished at start-up', async () => {
    const deps = depsFor();
    const store = createMemorySaveStore();
    const c = await start(store);
    store.failNextRemove();
    const r = await c.dispatch(0, { type: 'abandon' }, tick());
    expect(r).toMatchObject({ ok: true, warning: 'finish_incomplete' });
    expect(await store.listHistory()).toHaveLength(1);
    expect(store.size()).toBe(1);
    const res = await initSaves(store, INSTALLED, tick(), deps);
    expect(res.finished).toEqual(['run-1']);
    expect(await store.listHistory()).toHaveLength(1);
    expect(store.size()).toBe(0);
  });

  test('removeRun abandons a saved run into history', async () => {
    const store = createMemorySaveStore();
    const c = await start(store);
    await playUntil(c, (s) => s.step === 'build');
    expect(await removeRun(store, 'run-1', 777)).toEqual({
      ok: true,
      recorded: true,
    });
    expect(await store.list()).toEqual([]);
    expect(await store.listHistory()).toMatchObject([
      { runId: 'run-1', reason: 'abandoned', finishedAt: 777 },
    ]);
    expect(await removeRun(store, 'run-1', 778)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    store.injectRaw('junk', 5);
    expect(await removeRun(store, 'junk', 779)).toEqual({
      ok: true,
      recorded: false,
    });
  });

  test('8: concurrent dispatches are applied and saved strictly in order', async () => {
    const gates: (() => void)[] = [];
    const written: number[] = [];
    const store = createMemorySaveStore({
      beforePut: (rec) => {
        if (rec.actionCounter === 0) return;
        return new Promise<void>((resolve) => {
          gates.push(() => {
            written.push(rec.actionCounter);
            resolve();
          });
        });
      },
    });
    const c = await start(store);
    const pos = corePosition(c.state);
    const p1 = c.dispatch(0, { type: 'place_core', ...pos }, 1);
    const p2 = c.dispatch(0, { type: 'ready' }, 2);
    const p3 = c.dispatch(0, { type: 'ready' }, 3);
    const order: number[] = [];
    void p1.then(() => order.push(1));
    void p2.then(() => order.push(2));
    void p3.then(() => order.push(3));
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    await flush();
    // Only the first put is in flight; the others have not even been applied.
    expect(gates).toHaveLength(1);
    expect(c.state.actionCounter).toBe(0);
    gates.shift()?.();
    await flush();
    expect(order).toEqual([1]);
    expect(c.state.actionCounter).toBe(1);
    expect(gates).toHaveLength(1);
    gates.shift()?.();
    await flush();
    gates.shift()?.();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(written).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    expect(c.state.actionCounter).toBe(3);
    expect(c.state.actionLog.map((a) => a.n)).toEqual([1, 2, 3]);
    expect(((await store.get('run-1')) as SaveRecord).actionCounter).toBe(3);
  });

  test('buildSaveRecord keeps a given signature', async () => {
    const store = createMemorySaveStore();
    const c = await start(store);
    const rec = buildSaveRecord(runArgs(), c.state, INSTALLED, 5, 'sig');
    expect(rec.signature).toBe('sig');
    await store.put(rec);
    expect(((await store.get('run-1')) as SaveRecord).signature).toBe('sig');
  });
});
