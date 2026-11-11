import { describe, expect, test } from 'vitest';
import { loadEconomyOrThrow, type EconomyConfig } from '@game/core';
import economyJson from '../../../content/economy.json';
import { fixedBattle } from './defaults.js';
import { createEconomyDeps, readShop } from './economy.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import { allowedIntents } from './selectors.js';
import {
  baseDeps,
  content,
  mapgenConfig,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from './test-support.js';
import type { Intent, RunDeps, RunState } from './types.js';
import { validateRunState } from './validate.js';

const economy = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
});

function depsFor(eco: EconomyConfig = economy): RunDeps {
  return createEconomyDeps(content, mapgenConfig, eco, {
    battle: fixedBattle(true),
  });
}

function start(deps: RunDeps, players: readonly string[] = ['Ann']): RunState {
  const r = createRun(runArgs(players), deps);
  if (!r.ok) throw new Error(r.detail);
  return placeCoreAll(r.state, deps);
}

/** From `build` (or a summary) to the next shop, everyone doing the default. */
function toShop(s0: RunState, deps: RunDeps): RunState {
  let s = s0;
  for (let i = 0; i < 20 && s.step !== 'shop'; i++) {
    if (s.step === 'pve_choice') s = voteAll(s, 'easy', deps);
    else if (s.step === 'event_choice') s = voteAll(s, 'stub_event_a', deps);
    else s = readyAll(s, deps);
  }
  expect(s.step).toBe('shop');
  return s;
}

function reject(s: RunState, p: number, intent: Intent, deps: RunDeps) {
  const r = applyIntent(s, p, intent, deps);
  if (r.ok) throw new Error('expected rejection');
  return r.reason;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function shopOf(s: RunState, p = 0) {
  const d = readShop(s.perPlayer[p] as RunState['perPlayer'][number]);
  if (d === null) throw new Error('no shop');
  return d;
}

describe('starting kit', () => {
  test('gold and kit are present in the first build', () => {
    const deps = depsFor();
    const s = start(deps);
    expect(s.step).toBe('build');
    expect(s.perPlayer[0]?.gold).toBe(10);
    expect(s.perPlayer[0]?.shop).toBeNull();
    const counts = new Map<string, number>();
    for (const e of s.team.stash) {
      expect(e.tier).toBe(1);
      expect(e.owner).toBe(0);
      counts.set(e.def, (counts.get(e.def) ?? 0) + 1);
    }
    expect([...counts.entries()].sort()).toEqual([
      ['bld_barracks', 1],
      ['bld_extractor', 2],
      ['bld_turret', 1],
      ['bld_wall', 3],
    ]);
  });

  test('with several players each gets the whole kit and their own gold', () => {
    const deps = depsFor();
    const s = start(deps, ['Ann', 'Bo']);
    expect(s.perPlayer.map((p) => p.gold)).toEqual([10, 10]);
    expect(s.team.stash.filter((e) => e.owner === 0)).toHaveLength(7);
    expect(s.team.stash.filter((e) => e.owner === 1)).toHaveLength(7);
  });
});

describe('the first build', () => {
  test('buy and reroll are wrong_step, sell is allowed', () => {
    const deps = depsFor();
    const s = start(deps);
    expect(reject(s, 0, { type: 'buy', slot: 0 }, deps)).toBe('wrong_step');
    expect(reject(s, 0, { type: 'reroll' }, deps)).toBe('wrong_step');
    const wall = s.team.stash.find((e) => e.def === 'bld_wall');
    const sold = ok(s, 0, { type: 'sell', id: wall?.id ?? -1 }, deps).state;
    expect(sold.perPlayer[0]?.gold).toBe(12);
    expect(sold.team.stash).toHaveLength(s.team.stash.length - 1);
    expect(allowedIntents(s, 0, deps)).toContain('sell');
    expect(allowedIntents(s, 0, deps)).not.toContain('buy');
  });
});

describe('shop step', () => {
  test('income and offers arrive on entering; offers are in the state', () => {
    const deps = depsFor();
    const s = toShop(start(deps), deps);
    expect(s.perPlayer[0]?.gold).toBe(13);
    const data = shopOf(s);
    expect(data.offers).toHaveLength(5);
    expect(data.offers.every((o) => o !== null && o.tier === 1)).toBe(true);
    expect(validateRunState(clone(s), deps).ok).toBe(true);
    // Intents legal in the shop.
    const allowed = allowedIntents(s, 0, deps);
    for (const t of ['buy', 'sell', 'reroll']) expect(allowed).toContain(t);
  });

  test('each player has their own offers', () => {
    const deps = depsFor();
    const s = toShop(start(deps, ['Ann', 'Bo']), deps);
    expect(shopOf(s, 0).offers).not.toEqual(shopOf(s, 1).offers);
  });

  test('rejections give the documented reason and change nothing', () => {
    const deps = depsFor();
    const s = toShop(start(deps, ['Ann', 'Bo']), deps);
    const bobWall = s.team.stash.find((e) => e.owner === 1);
    expect(s.step).toBe('shop');
    const before = clone(s);
    // Empty / bad slots.
    expect(reject(s, 0, { type: 'buy', slot: 7 }, deps)).toBe('no_such_offer');
    expect(reject(s, 0, { type: 'buy', slot: -1 }, deps)).toBe('no_such_offer');
    expect(reject(s, 0, { type: 'buy', slot: 'x' }, deps)).toBe(
      'invalid_intent',
    );
    // Another player's building.
    expect(reject(s, 0, { type: 'sell', id: bobWall?.id ?? -1 }, deps)).toBe(
      'not_owner',
    );
    // Not in the stash at all.
    expect(reject(s, 0, { type: 'sell', id: 12345 }, deps)).toBe(
      'not_in_stash',
    );
    expect(s).toEqual(before);

    // Placed on the board: not sellable.
    const mine = s.team.stash.find((e) => e.owner === 0);
    const placed = placeAnywhere(s, 0, mine?.id ?? -1, deps);
    expect(reject(placed, 0, { type: 'sell', id: mine?.id ?? -1 }, deps)).toBe(
      'not_in_stash',
    );

    // Too expensive: drain gold by selling nothing; set gold low through sells
    // is not possible, so use an economy where everything costs more.
    const poor = depsFor({ ...economy, startingGold: 0, baseIncomePerShop: 0 });
    const ps = toShop(start(poor), poor);
    const slot = shopOf(ps).offers.findIndex((o) => o !== null && o.price > 0);
    expect(reject(ps, 0, { type: 'buy', slot }, poor)).toBe('not_enough_gold');
    expect(reject(ps, 0, { type: 'reroll' }, poor)).toBe('not_enough_gold');
  });

  test('buying twice from one slot fails; bought slot stays empty', () => {
    const deps = depsFor();
    let s = toShop(start(deps), deps);
    const slot = shopOf(s).offers.findIndex((o) => o !== null && o.price <= 13);
    const price = shopOf(s).offers[slot]?.price ?? 0;
    s = ok(s, 0, { type: 'buy', slot }, deps).state;
    expect(s.perPlayer[0]?.gold).toBe(13 - price);
    expect(shopOf(s).offers[slot]).toBeNull();
    expect(reject(s, 0, { type: 'buy', slot }, deps)).toBe('no_such_offer');
    const bought = s.team.stash.at(-1);
    expect(bought?.owner).toBe(0);
    expect(validateRunState(clone(s), deps).ok).toBe(true);
  });

  test('reroll costs gold, replaces all offers, and is reproducible', () => {
    const deps = depsFor();
    const s0 = toShop(start(deps), deps);
    const s1 = ok(s0, 0, { type: 'reroll' }, deps).state;
    const s2 = ok(s1, 0, { type: 'reroll' }, deps).state;
    expect(s2.perPlayer[0]?.gold).toBe(11);
    const a = shopOf(s0).offers;
    const b = shopOf(s1).offers;
    const c = shopOf(s2).offers;
    expect(b).not.toEqual(a);
    expect(c).not.toEqual(b);
    expect(b.every((o) => o !== null)).toBe(true);

    // Save / reload before and after a re-roll keeps the offers.
    const loaded0 = validateRunState(clone(s0), deps);
    const loaded1 = validateRunState(clone(s1), deps);
    if (!loaded0.ok || !loaded1.ok) throw new Error('invalid');
    expect(shopOf(loaded0.state).offers).toEqual(a);
    expect(shopOf(loaded1.state).offers).toEqual(b);
    // A reloaded state continues with the same next re-roll.
    expect(ok(loaded1.state, 0, { type: 'reroll' }, deps).state).toEqual(s2);
  });

  test('replayRun from the seed and log reproduces offers and gold', () => {
    const deps = depsFor();
    let s = toShop(start(deps), deps);
    const checkpoints: RunState[] = [s];
    s = ok(s, 0, { type: 'reroll' }, deps).state;
    checkpoints.push(s);
    const slot = shopOf(s).offers.findIndex((o) => o !== null && o.price <= 12);
    s = ok(s, 0, { type: 'buy', slot }, deps).state;
    checkpoints.push(s);
    s = ok(s, 0, { type: 'reroll' }, deps).state;
    checkpoints.push(s);
    for (const cp of checkpoints) {
      const r = replayRun(runArgs(['Ann']), cp.actionLog, deps);
      if (!r.ok) throw new Error(r.reason);
      expect(r.state).toEqual(cp);
      expect(r.state.perPlayer).toEqual(cp.perPlayer);
    }
  });

  test('buying three identical buildings leaves three stash entries', () => {
    const eco: EconomyConfig = {
      ...economy,
      startingGold: 100,
      offerWeights: [{ def: 'bld_wall', weight: 1 }],
    };
    const deps = depsFor(eco);
    let s = toShop(start(deps), deps);
    const walls = s.team.stash.filter((e) => e.def === 'bld_wall').length;
    for (const slot of [0, 1, 2]) {
      s = ok(s, 0, { type: 'buy', slot }, deps).state;
    }
    const after = s.team.stash.filter((e) => e.def === 'bld_wall');
    expect(after).toHaveLength(walls + 3);
    expect(new Set(after.map((e) => e.id)).size).toBe(walls + 3);
  });
});

function placeAnywhere(
  s: RunState,
  player: number,
  id: number,
  deps: RunDeps,
): RunState {
  const map = s.team.map;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const r = applyIntent(
        s,
        player,
        { type: 'place_building', id, x, y, rotation: 0 },
        deps,
      );
      if (r.ok) return r.state;
    }
  }
  throw new Error('no legal cell');
}

describe('a scripted solo run', () => {
  test('two rounds: income, buy, place, sell, gold never negative', () => {
    const deps = depsFor();
    let s = start(deps);
    expect(s.perPlayer[0]?.gold).toBe(10);
    const golds: number[] = [];
    let shops = 0;
    let steps = 0;
    while (s.round < 3 && s.step !== 'run_over' && steps++ < 100) {
      if (s.step === 'pve_choice') s = voteAll(s, 'easy', deps);
      else if (s.step === 'event_choice') s = voteAll(s, 'stub_event_a', deps);
      else if (s.step === 'shop') {
        shops += 1;
        const entered = s.perPlayer[0]?.gold ?? 0;
        golds.push(entered);
        // Buy the cheapest affordable offer, place it, then sell a wall.
        const offers = shopOf(s).offers.flatMap((o) => (o === null ? [] : [o]));
        const cheapest = [...offers].sort((a, b) => a.price - b.price)[0];
        if (cheapest !== undefined && cheapest.price <= entered) {
          s = ok(s, 0, { type: 'buy', slot: cheapest.slot }, deps).state;
          expect(s.perPlayer[0]?.gold).toBe(entered - cheapest.price);
          const entry = s.team.stash.at(-1);
          s = placeAnywhere(s, 0, entry?.id ?? -1, deps);
          expect(s.team.buildings.some((b) => b.id === entry?.id)).toBe(true);
        }
        const wall = s.team.stash.find((e) => e.def === 'bld_wall');
        if (wall !== undefined) {
          const g = s.perPlayer[0]?.gold ?? 0;
          s = ok(s, 0, { type: 'sell', id: wall.id }, deps).state;
          expect(s.perPlayer[0]?.gold).toBe(g + 2);
        }
        s = readyAll(s, deps);
      } else s = readyAll(s, deps);
      for (const p of s.perPlayer) expect(p.gold).toBeGreaterThanOrEqual(0);
    }
    expect(shops).toBe(4);
    // Income is paid on entering each shop: entering gold is previous + 3.
    expect(golds[0]).toBe(13);
    expect(validateRunState(clone(s), deps).ok).toBe(true);
  });
});

describe('configuration', () => {
  test('an alternate economy changes kit, gold, income and offers', () => {
    const alt: EconomyConfig = {
      ...economy,
      startingGold: 50,
      startingKit: [{ def: 'bld_gate', tier: 2, count: 2 }],
      baseIncomePerShop: 9,
      shopOfferCount: 3,
      rerollCost: 4,
      sellRefundPercent: 100,
      offerWeights: [{ def: 'bld_merger', weight: 1 }],
      tierOdds: [{ fromRound: 1, weights: [0, 1, 0] }],
    };
    const deps = depsFor(alt);
    let s = start(deps);
    expect(s.perPlayer[0]?.gold).toBe(50);
    expect(s.team.stash.map((e) => [e.def, e.tier])).toEqual([
      ['bld_gate', 2],
      ['bld_gate', 2],
    ]);
    s = toShop(s, deps);
    expect(s.perPlayer[0]?.gold).toBe(59);
    expect(shopOf(s).offers).toHaveLength(3);
    expect(shopOf(s).offers.every((o) => o?.def === 'bld_merger')).toBe(true);
    expect(shopOf(s).offers.every((o) => o?.tier === 2)).toBe(true);
    s = ok(s, 0, { type: 'reroll' }, deps).state;
    expect(s.perPlayer[0]?.gold).toBe(55);
    const id = s.team.stash[0]?.id ?? -1;
    s = ok(s, 0, { type: 'sell', id }, deps).state;
    expect(s.perPlayer[0]?.gold).toBe(55 + 16);
  });

  test('the default deps are untouched by the economy', () => {
    expect(baseDeps.handlers).toEqual({});
  });
});
