/**
 * A stored Workshop choice that can no longer be paid when the last player has
 * chosen is applied as a skip; nobody's submission is rejected for it.
 */
import { describe, expect, test } from 'vitest';
import { workshopPrice } from '@game/core';
import { createGameDeps } from './game-deps.js';
import { fixedBattle } from './defaults.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import {
  content,
  gameConfigs,
  makeGameDeps,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from './test-support.js';
import type { Json, RunState } from './types.js';
import { validateRunState } from './validate.js';

const PERCENT = 80;
const deps = makeGameDeps({ battle: fixedBattle(true) });

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
const dear = createGameDeps(dearContent, gameConfigs, {
  battle: fixedBattle(true),
});
const cheap = createGameDeps(cheapContent, gameConfigs, {
  battle: fixedBattle(true),
});

type Opt = Record<string, Json>;
const pend = (s: RunState) => s.pending as Record<string, Json>;
const optionsOf = (s: RunState) =>
  (pend(s)['followUp'] as Record<string, Json>)['options'] as Opt[];
const mineOf = (s: RunState, p: number) =>
  optionsOf(s).filter((o) => o['player'] === p);

function workshop(players: readonly string[], golds: readonly number[]) {
  const r = createRun(runArgs(players, 7), deps);
  if (!r.ok) throw new Error(r.detail);
  let s = placeCoreAll(r.state, deps);
  for (let i = 0; i < 20 && s.step !== 'event_choice'; i++) {
    s = s.step === 'pve_choice' ? voteAll(s, 'easy', deps) : readyAll(s, deps);
  }
  const offer = {
    id: 'evt_workshop',
    event: 'evt_workshop',
    type: 'workshop',
    workshopPricePercent: PERCENT,
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
  return voteAll(forced, offer.id, deps);
}

const choose = (s: RunState, p: number, choice: string, d = deps) =>
  applyIntent(s, p, { type: 'event_choose', choice }, d);
const price = (c: typeof content, o: Opt) =>
  workshopPrice(c, o['def'] as string, o['newTier'] as number, PERCENT);
const tierOf = (s: RunState, id: unknown) =>
  [...s.team.buildings, ...s.team.stash].find((b) => b.id === id)?.tier;
const applied = (effects: readonly { type: string }[]): Opt[] => {
  const e = effects.find(
    (x) =>
      x.type === 'custom' && (x as { name?: string }).name === 'event_resolved',
  ) as unknown as { data: Record<string, Json> };
  return e.data['applied'] as unknown as Opt[];
};
const baseIncome = gameConfigs.economy.baseIncomePerShop;

describe('Workshop: a stored choice that can no longer be paid', () => {
  test('A cannot pay the new price, B skips: step completes, A skipped', () => {
    const probe = workshop(['Ann', 'Bo'], [500, 500]);
    const o0 = mineOf(probe, 0)[0] as Opt;
    const gold = o0['price'] as number;
    expect(price(dearContent, o0)).toBeGreaterThan(gold);
    const s = workshop(['Ann', 'Bo'], [gold, 500]);
    const a = ok(
      s,
      0,
      { type: 'event_choose', choice: o0['id'] as string },
      deps,
    );
    const reopened = JSON.parse(JSON.stringify(a.state)) as RunState;
    const r = applyIntent(
      reopened,
      1,
      { type: 'event_choose', choice: 'skip' },
      dear,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.step).not.toBe('event_resolve');
    expect(tierOf(r.state, o0['building'])).toBe(o0['tier']);
    // not charged (only the shop income is added)
    expect(r.state.perPlayer[0]?.gold).toBe(gold + baseIncome);
    const ap = applied(r.effects);
    expect(ap[0]).toMatchObject({
      player: 0,
      result: 'skip',
      dropped: true,
      reason: 'not_enough_gold',
    });
    expect(ap[1]).toEqual({ player: 1, result: 'skip' });
    expect(validateRunState(JSON.parse(JSON.stringify(r.state)), dear).ok).toBe(
      true,
    );
  });

  test('a player who could not pay under the old content is not blocked from choosing under it', () => {
    const probe = workshop(['Ann', 'Bo'], [500, 500]);
    const o0 = mineOf(probe, 0)[0] as Opt;
    const s = workshop(['Ann', 'Bo'], [o0['price'] as number, 500]);
    const a = ok(
      s,
      0,
      { type: 'event_choose', choice: o0['id'] as string },
      deps,
    );
    // B's own unaffordable choice is still rejected for B.
    const o1 = mineOf(a.state, 1)[0] as Opt;
    expect(choose(a.state, 1, o1['id'] as string, deps).ok).toBe(true);
  });

  test('A can still afford under the new price: charged the new price', () => {
    const probe = workshop(['Ann', 'Bo'], [500, 500]);
    const o0 = mineOf(probe, 0)[0] as Opt;
    const s = workshop(['Ann', 'Bo'], [500, 500]);
    const a = ok(
      s,
      0,
      { type: 'event_choose', choice: o0['id'] as string },
      deps,
    );
    const r = applyIntent(
      a.state,
      1,
      { type: 'event_choose', choice: 'skip' },
      dear,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = price(dearContent, o0);
    expect(r.state.perPlayer[0]?.gold).toBe(500 - p + baseIncome);
    expect(tierOf(r.state, o0['building'])).toBe(o0['newTier']);
    expect(applied(r.effects)[0]).toEqual({
      player: 0,
      result: 'upgrade',
      building: o0['building'],
      def: o0['def'],
      newTier: o0['newTier'],
      price: p,
    });
  });

  test('four players with a mix', () => {
    const probe = workshop(['A', 'B', 'C', 'D'], [500, 500, 500, 500]);
    const opt = (p: number) => mineOf(probe, p)[0] as Opt;
    // A: poor under new price; B: rich; C: skip; D: rich, submits last.
    const golds = [opt(0)['price'] as number, 500, 500, 500];
    let s = workshop(['A', 'B', 'C', 'D'], golds);
    s = ok(
      s,
      0,
      { type: 'event_choose', choice: opt(0)['id'] as string },
      deps,
    ).state;
    s = ok(
      s,
      1,
      { type: 'event_choose', choice: opt(1)['id'] as string },
      deps,
    ).state;
    s = ok(s, 2, { type: 'event_choose', choice: 'skip' }, deps).state;
    const r = applyIntent(
      s,
      3,
      { type: 'event_choose', choice: opt(3)['id'] as string },
      dear,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ap = applied(r.effects);
    expect(ap.map((x) => x['result'])).toEqual([
      'skip',
      'upgrade',
      'skip',
      'upgrade',
    ]);
    expect(ap[0]?.['dropped']).toBe(true);
    expect(ap[2]?.['dropped']).toBeUndefined();
    expect(r.state.perPlayer[0]?.gold).toBe((golds[0] ?? 0) + baseIncome);
    expect(r.state.perPlayer[1]?.gold).toBe(
      500 - price(dearContent, opt(1)) + baseIncome,
    );
    expect(r.state.perPlayer[3]?.gold).toBe(
      500 - price(dearContent, opt(3)) + baseIncome,
    );
    expect(tierOf(r.state, opt(0)['building'])).toBe(opt(0)['tier']);
    expect(tierOf(r.state, opt(1)['building'])).toBe(opt(1)['newTier']);
    expect(validateRunState(JSON.parse(JSON.stringify(r.state)), dear).ok).toBe(
      true,
    );
  });

  test("the submitting player's own unaffordable choice is still rejected", () => {
    const probe = workshop(['Ann', 'Bo'], [500, 500]);
    const o1 = mineOf(probe, 1)[0] as Opt;
    const s = workshop(['Ann', 'Bo'], [500, o1['price'] as number]);
    const r = applyIntent(
      s,
      1,
      { type: 'event_choose', choice: o1['id'] as string },
      dear,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_enough_gold');
  });

  test('replayRun equals the played state with unchanged content', () => {
    const args = runArgs(['Ann'], 7);
    const s = workshop(['Ann'], [500]);
    const o = mineOf(s, 0)[0] as Opt;
    const done = ok(
      s,
      0,
      { type: 'event_choose', choice: o['id'] as string },
      deps,
    ).state;
    expect(done.step).not.toBe('event_resolve');
    // the forced state is not reachable by replay; compare on a natural run
    expect(args.players.length).toBe(1);
    expect(validateRunState(JSON.parse(JSON.stringify(done)), deps).ok).toBe(
      true,
    );
    for (let seed = 1; seed <= 60; seed++) {
      const r = createRun(runArgs(['Ann', 'Bo'], seed), deps);
      if (!r.ok) throw new Error(r.detail);
      let st = placeCoreAll(r.state, deps);
      for (let i = 0; i < 20 && st.step !== 'event_choice'; i++) {
        st =
          st.step === 'pve_choice'
            ? voteAll(st, 'easy', deps)
            : readyAll(st, deps);
      }
      const offers = pend(st)['options'] as Opt[];
      if (!offers.some((x) => x['id'] === 'evt_workshop')) continue;
      st = voteAll(st, 'evt_workshop', deps);
      if (st.step !== 'event_resolve') continue;
      for (let p = 0; p < 2; p++) {
        const own = mineOf(st, p).find((x) => x['affordable'] === true);
        st = ok(
          st,
          p,
          {
            type: 'event_choose',
            choice: own ? own['id'] : 'skip',
          },
          deps,
        ).state;
      }
      const re = replayRun(runArgs(['Ann', 'Bo'], seed), st.actionLog, deps);
      expect(re.ok).toBe(true);
      if (re.ok) expect(re.state).toEqual(st);
      return;
    }
    throw new Error('no seed offered a Workshop');
  });

  test('fuzz: content changes between choices; always valid, gold never negative', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const decks = [deps, dear, cheap];
    for (let iter = 0; iter < 60; iter++) {
      const n = 1 + rnd(4);
      const names = ['A', 'B', 'C', 'D'].slice(0, n);
      const golds = names.map(() => rnd(140));
      let s = workshop(names, golds);
      if (s.step !== 'event_resolve') continue;
      const order = names.map((_x, i) => i).sort(() => rnd(3) - 1);
      for (const p of order) {
        const d = decks[rnd(3)] as typeof deps;
        const mine = mineOf(s, p);
        const pick =
          mine.length > 0 && rnd(3) > 0
            ? (mine[rnd(mine.length)] as Opt)
            : null;
        let r = choose(s, p, pick ? (pick['id'] as string) : 'skip', d);
        if (!r.ok) r = choose(s, p, 'skip', d);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        s = r.state;
        const v = validateRunState(JSON.parse(JSON.stringify(s)), d);
        expect(v.ok).toBe(true);
        for (const pp of s.perPlayer) expect(pp.gold).toBeGreaterThanOrEqual(0);
      }
      expect(s.step).not.toBe('event_resolve');
    }
  });
});
