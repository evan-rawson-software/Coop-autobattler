/**
 * A run saved under an older minor version continues under the current
 * numbers (issue #50 follow-up): stored Workshop prices are display data, the
 * price charged is computed when the player chooses.
 */
import { describe, expect, test } from 'vitest';
import { workshopPrice } from '@game/core';
import { createGameDeps } from './game-deps.js';
import { fixedBattle } from './defaults.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import { classifySave, buildSaveRecord } from '../app/save.js';
import { eventFollowUp } from './selectors.js';
import {
  content,
  gameConfigs,
  makeGameDeps,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from '../testing/test-support.js';
import type { Json, RunState } from './types.js';
import { validateRunState } from './validate.js';

const PERCENT = 80;
const deps = makeGameDeps({ battle: fixedBattle(true) });

/** The same content with every purchasable tier price changed by `f`. */
function repriced(f: (price: number) => number): typeof content {
  const list = content.buildings.list().map((b) => ({
    ...b,
    tiers: b.tiers.map((t) => ('price' in t ? { ...t, price: f(t.price) } : t)),
  })) as unknown as ReturnType<typeof content.buildings.list>;
  return {
    ...content,
    buildings: {
      get: (id: string) => list.find((b) => b.id === id),
      list: () => list,
    },
  };
}
const dearContent = repriced((p) => p + 40);
const cheapContent = repriced((p) => Math.max(1, p - 2));
const changedConfigs = {
  ...gameConfigs,
  economy: {
    ...gameConfigs.economy,
    rewards: {
      pveWin: { easy: 30, medium: 50, hard: 80 },
      pvpWin: 60,
      pvpLoss: 20,
    },
  },
};
// makeGameDeps takes content from the shared module; rebuild with other content.
const depsWith = (c: typeof content) =>
  createGameDeps(c, changedConfigs, { battle: fixedBattle(true) });
const dear = depsWith(dearContent);
const cheap = depsWith(cheapContent);

type Opt = Record<string, Json>;
const pend = (s: RunState) => s.pending as Record<string, Json>;
const optionsOf = (s: RunState) =>
  (pend(s)['followUp'] as Record<string, Json>)['options'] as Opt[];
const mineOf = (s: RunState, p: number) =>
  optionsOf(s).filter((o) => o['player'] === p);

function forcedEvent(
  players: readonly string[],
  golds: readonly number[],
  type: 'workshop' | 'shrine',
): { event: RunState; follow: RunState; steps: Map<string, RunState> } {
  const r = createRun(runArgs(players, 7), deps);
  if (!r.ok) throw new Error(r.detail);
  const steps = new Map<string, RunState>();
  let s = placeCoreAll(r.state, deps);
  for (let i = 0; i < 20 && s.step !== 'event_choice'; i++) {
    steps.set(s.step, s);
    s = s.step === 'pve_choice' ? voteAll(s, 'easy', deps) : readyAll(s, deps);
  }
  steps.set(s.step, s);
  const offer =
    type === 'workshop'
      ? {
          id: 'evt_workshop',
          event: 'evt_workshop',
          type: 'workshop',
          workshopPricePercent: PERCENT,
        }
      : {
          id: 'evt_shrine',
          event: 'evt_shrine',
          type: 'shrine',
          modifiers: ['mod_stout_walls', 'mod_sharp_turrets'],
        };
  const forced: RunState = {
    ...s,
    perPlayer: s.perPlayer.map((p, i) => ({ ...p, gold: golds[i] ?? 0 })),
    pending: {
      options: [
        offer,
        {
          id: 'evt_windfall',
          event: 'evt_windfall',
          type: 'windfall',
          gold: 4,
        },
      ],
    },
  };
  const follow = voteAll(forced, offer.id, deps);
  steps.set('event_choice', forced);
  return { event: forced, follow, steps };
}

const reopen = (s: RunState, d: typeof deps) =>
  validateRunState(JSON.parse(JSON.stringify(s)), d);
const choose = (s: RunState, p: number, choice: string, d = deps) =>
  applyIntent(s, p, { type: 'event_choose', choice }, d);

describe('a save mid-Workshop under changed prices', () => {
  const { follow } = forcedEvent(['Ann', 'Bo'], [500, 500], 'workshop');

  test('is not corrupt and opens (also when prices fall)', () => {
    expect(reopen(follow, dear).ok).toBe(true);
    expect(reopen(follow, cheap).ok).toBe(true);
    const rec = buildSaveRecord(runArgs(['Ann', 'Bo'], 7), follow, '0.2.0', 1);
    for (const d of [dear, cheap]) {
      const c = classifySave(
        JSON.parse(JSON.stringify(rec)),
        follow.runId,
        '0.2.0',
        d,
      );
      expect(c.kind).toBe('open');
    }
  });

  test('choosing charges the new price, not the stored one', () => {
    const o = mineOf(follow, 0)[0] as Opt;
    const now = workshopPrice(
      dearContent,
      o['def'] as string,
      o['newTier'] as number,
      PERCENT,
    );
    expect(now).not.toBe(o['price']);
    const a = ok(follow, 1, { type: 'event_choose', choice: 'skip' }, dear);
    const done = ok(
      a.state,
      0,
      { type: 'event_choose', choice: o['id'] as string },
      dear,
    ).state;
    const income = gameConfigs.economy.baseIncomePerShop;
    expect(done.perPlayer[0]?.gold).toBe(500 - now + income);
  });

  test('a player who could pay the stored price but not the current one gets not_enough_gold and can skip', () => {
    const s = forcedEvent(['Ann'], [40], 'workshop').follow;
    const o = mineOf(s, 0).find((x) => (x['price'] as number) <= 40) as Opt;
    expect(o).toBeDefined();
    const now = workshopPrice(
      dearContent,
      o['def'] as string,
      o['newTier'] as number,
      PERCENT,
    );
    expect(now).toBeGreaterThan(40);
    const r = choose(s, 0, o['id'] as string, dear);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_enough_gold');
    expect(choose(s, 0, 'skip', dear).ok).toBe(true);
  });

  test('a tampered stored price has no effect on what is charged', () => {
    for (const price of [0, 1, 999999]) {
      const o = mineOf(follow, 0)[0] as Opt;
      const t = {
        ...follow,
        pending: {
          ...pend(follow),
          followUp: {
            ...(pend(follow)['followUp'] as Record<string, Json>),
            options: optionsOf(follow).map((x) =>
              x['id'] === o['id'] && x['player'] === 0 ? { ...x, price } : x,
            ),
          },
        },
      } as RunState;
      expect(reopen(t, deps).ok).toBe(true);
      const skip1 = ok(t, 1, { type: 'event_choose', choice: 'skip' }, deps);
      const done = ok(
        skip1.state,
        0,
        { type: 'event_choose', choice: o['id'] as string },
        deps,
      ).state;
      const real = workshopPrice(
        content,
        o['def'] as string,
        o['newTier'] as number,
        PERCENT,
      );
      expect(done.perPlayer[0]?.gold).toBe(
        500 - real + gameConfigs.economy.baseIncomePerShop,
      );
    }
  });

  test('a bad stored price type is still rejected by validation', () => {
    for (const price of [-1, 1.5, 'x', null]) {
      const t = {
        ...follow,
        pending: {
          ...pend(follow),
          followUp: {
            ...(pend(follow)['followUp'] as Record<string, Json>),
            options: optionsOf(follow).map((x, i) =>
              i === 0 ? { ...x, price } : x,
            ),
          },
        },
      } as RunState;
      expect(reopen(t, deps).ok).toBe(false);
    }
    const t = {
      ...follow,
      pending: {
        ...pend(follow),
        followUp: {
          ...(pend(follow)['followUp'] as Record<string, Json>),
          options: optionsOf(follow).map((x, i) =>
            i === 0 ? { ...x, affordable: 'yes' } : x,
          ),
        },
      },
    } as RunState;
    expect(reopen(t, deps).ok).toBe(false);
  });

  test('eventFollowUp with deps shows the current price and affordability', () => {
    const stored = eventFollowUp(follow, 0);
    const view = eventFollowUp(follow, 0, dear);
    const o = view?.options[0] as Opt;
    const s0 = stored?.options[0] as Opt;
    expect(o['price']).toBe(
      workshopPrice(
        dearContent,
        o['def'] as string,
        o['newTier'] as number,
        PERCENT,
      ),
    );
    expect(o['storedPrice']).toBe(s0['price']);
    expect(o['affordable']).toBe(500 >= (o['price'] as number));
    expect(stored?.options[0]).toEqual(s0);
    const poor = forcedEvent(['Ann'], [40], 'workshop').follow;
    const pv = eventFollowUp(poor, 0, dear)?.options as Opt[];
    expect(pv.some((x) => x['affordable'] === false)).toBe(true);
  });
});

describe('Workshop: structure is still checked', () => {
  const { follow } = forcedEvent(['Ann', 'Bo'], [500, 500], 'workshop');
  const cases: [string, Record<string, Json>][] = [
    ['tier', { tier: 2, newTier: 3 }],
    ['def', { def: 'nothing' }],
    ['owner', { player: 1 }],
    ['building id', { building: 99999, id: 'b99999' }],
    ['newTier', { newTier: 3 }],
    ['placed', { placed: true }],
  ];
  for (const [name, patch] of cases) {
    test(`${name}: rejected by validation and by event_choose`, () => {
      const o = mineOf(follow, 0)[0] as Opt;
      const fu = pend(follow)['followUp'] as Record<string, Json>;
      const t = {
        ...follow,
        pending: {
          ...pend(follow),
          followUp: {
            ...fu,
            options: optionsOf(follow).map((x) =>
              x === o ? { ...x, ...patch } : x,
            ),
          },
        },
      } as RunState;
      expect(reopen(t, deps).ok).toBe(false);
      const id = (patch['id'] as string | undefined) ?? (o['id'] as string);
      expect(choose(t, 0, id).ok).toBe(false);
    });
  }
});

describe('Workshop: pre-filled votes and affordable are defaults only', () => {
  test('a player pre-filled with skip in tampered data can still choose an upgrade', () => {
    const { follow } = forcedEvent(['Ann', 'Bo'], [500, 500], 'workshop');
    const fu = pend(follow)['followUp'] as Record<string, Json>;
    const pre = {
      ...follow,
      pending: { ...pend(follow), followUp: { ...fu, votes: ['skip', null] } },
    } as RunState;
    expect(reopen(pre, deps).ok).toBe(true);
    const o = mineOf(pre, 0)[0] as Opt;
    const mid = ok(
      pre,
      0,
      { type: 'event_choose', choice: o['id'] as string },
      deps,
    );
    const done = ok(
      mid.state,
      1,
      { type: 'event_choose', choice: 'skip' },
      deps,
    ).state;
    expect(done.step).toBe('shop');
    const b = [...done.team.buildings, ...done.team.stash].find(
      (x) => x.id === o['building'],
    );
    expect(b?.tier).toBe(o['newTier']);
  });

  test('a false stored affordable is not trusted by the apply path', () => {
    const { follow } = forcedEvent(['Ann'], [500], 'workshop');
    const fu = pend(follow)['followUp'] as Record<string, Json>;
    const t = {
      ...follow,
      pending: {
        ...pend(follow),
        followUp: {
          ...fu,
          options: optionsOf(follow).map((x) => ({ ...x, affordable: false })),
        },
      },
    } as RunState;
    const o = mineOf(t, 0)[0] as Opt;
    expect(choose(t, 0, o['id'] as string).ok).toBe(true);
  });
});

describe('replay with unchanged content', () => {
  test('a played Workshop run replays to an equal state', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = createRun(runArgs(['Ann'], seed), deps);
      if (!r.ok) throw new Error(r.detail);
      let s = placeCoreAll(r.state, deps);
      for (let i = 0; i < 20 && s.step !== 'event_choice'; i++) {
        s =
          s.step === 'pve_choice'
            ? voteAll(s, 'easy', deps)
            : readyAll(s, deps);
      }
      const offers = pend(s)['options'] as Opt[];
      if (!offers.some((o) => o['id'] === 'evt_workshop')) continue;
      s = voteAll(s, 'evt_workshop', deps);
      if (s.step !== 'event_resolve') continue;
      const own = mineOf(s, 0).find((o) => o['affordable'] === true);
      if (own === undefined) continue;
      s = ok(
        s,
        0,
        { type: 'event_choose', choice: own['id'] as string },
        deps,
      ).state;
      const re = replayRun(runArgs(['Ann'], seed), s.actionLog, deps);
      expect(re.ok).toBe(true);
      if (re.ok) expect(re.state).toEqual(s);
      return;
    }
    throw new Error('no seed offered an affordable Workshop');
  });
});

describe('every step with pending choices survives changed numbers', () => {
  const w = forcedEvent(['Ann', 'Bo'], [500, 500], 'workshop');
  const sh = forcedEvent(['Ann', 'Bo'], [500, 500], 'shrine');
  const states: [string, RunState][] = [
    ['pve_choice', w.steps.get('pve_choice') as RunState],
    ['event_choice', w.event],
    ['workshop follow-up', w.follow],
    ['shrine follow-up', sh.follow],
    [
      'shop',
      ok(
        ok(w.follow, 0, { type: 'event_choose', choice: 'skip' }, deps).state,
        1,
        { type: 'event_choose', choice: 'skip' },
        deps,
      ).state,
    ],
  ];
  for (const [name, s] of states) {
    test(`${name}: never corrupt under changed prices and rewards`, () => {
      const rec = buildSaveRecord(runArgs(['Ann', 'Bo'], 7), s, '0.2.0', 1);
      for (const d of [dear, cheap]) {
        const c = classifySave(
          JSON.parse(JSON.stringify(rec)),
          s.runId,
          '0.2.0',
          d,
        );
        expect(c.kind).toBe('open');
      }
    });
  }
  test('the steps are the ones named', () => {
    expect(states.map(([, s]) => s.step)).toEqual([
      'pve_choice',
      'event_choice',
      'event_resolve',
      'event_resolve',
      'shop',
    ]);
  });
});
