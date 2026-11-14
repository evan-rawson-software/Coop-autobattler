import { describe, expect, test } from 'vitest';
import { Rng, tierPrice, workshopOptions, workshopPrice } from '@game/core';
import { fixedBattle } from './defaults.js';
import { defaultEventHandlers, eventHooks } from './events.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import { buildSaveRecord, parseSaveRecord } from '../app/save.js';
import { allowedIntents, eventFollowUp } from './selectors.js';
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

const deps = makeGameDeps({ battle: fixedBattle(true) });
const PERCENT = 80;

function atEvent(players: readonly string[], seed = 7): RunState {
  const r = createRun(runArgs(players, seed), deps);
  if (!r.ok) throw new Error(r.detail);
  let s = placeCoreAll(r.state, deps);
  for (let i = 0; i < 20 && s.step !== 'event_choice'; i++) {
    s = s.step === 'pve_choice' ? voteAll(s, 'easy', deps) : readyAll(s, deps);
  }
  if (s.step !== 'event_choice') throw new Error('no event step');
  return s;
}

/** The event step with the given gold, and the Workshop forced as a pick. */
function workshopStep(players: readonly string[], golds: readonly number[]) {
  const s = atEvent(players);
  const forced: RunState = {
    ...s,
    perPlayer: s.perPlayer.map((p, i) => ({ ...p, gold: golds[i] ?? 0 })),
    pending: {
      options: [
        {
          id: 'evt_workshop',
          event: 'evt_workshop',
          type: 'workshop',
          workshopPricePercent: PERCENT,
        },
        {
          id: 'evt_windfall',
          event: 'evt_windfall',
          type: 'windfall',
          gold: 4,
        },
      ],
    },
  };
  return voteAll(forced, 'evt_workshop', deps);
}

type Opt = Record<string, Json>;
function optionsOf(s: RunState): Opt[] {
  const fu = (s.pending as Record<string, Json>)['followUp'] as Record<
    string,
    Json
  >;
  return fu['options'] as Opt[];
}
function mineOf(s: RunState, player: number): Opt[] {
  return optionsOf(s).filter((o) => o['player'] === player);
}
function choose(s: RunState, player: number, choice: string) {
  return applyIntent(s, player, { type: 'event_choose', choice }, deps);
}
function tierOf(s: RunState, id: number): number {
  const b = [...s.team.buildings, ...s.team.stash].find((x) => x.id === id);
  if (b === undefined) throw new Error('no building');
  return b.tier;
}
function count(s: RunState): number {
  return s.team.buildings.length + s.team.stash.length;
}
function roundTrips(s: RunState) {
  expect(validateRunState(JSON.parse(JSON.stringify(s)), deps).ok).toBe(true);
}

describe('Workshop price (issue #50)', () => {
  test('is 80% of the shop price at the tier raised to, rounded down, for every building', () => {
    let checked = 0;
    for (const b of content.buildings.list()) {
      const def = b.id;
      for (const tier of [1, 2]) {
        const t = b.tiers[tier];
        if (t === undefined || !('price' in t)) continue;
        const shop = tierPrice(content, def, tier + 1);
        expect(workshopPrice(content, def, tier + 1, PERCENT)).toBe(
          Math.floor((shop * 80) / 100),
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(18);
  });

  test('every option offered carries that price, current and new tier', () => {
    const s = workshopStep(['Ann', 'Bo'], [100, 100]);
    expect(s.step).toBe('event_resolve');
    for (const o of optionsOf(s)) {
      const price = workshopPrice(
        content,
        o['def'] as string,
        (o['tier'] as number) + 1,
        PERCENT,
      );
      expect(o['price']).toBe(price);
      expect(o['newTier']).toBe((o['tier'] as number) + 1);
      expect(o['affordable']).toBe(true);
    }
  });

  test('workshopOptions lists only own buildings below tier 3', () => {
    const s = atEvent(['Ann', 'Bo']);
    const team = {
      ...s.team,
      stash: s.team.stash.map((b, i) => (i % 2 === 0 ? { ...b, tier: 3 } : b)),
    };
    for (const player of [0, 1]) {
      const list = workshopOptions(team, player, 1000, content, PERCENT);
      for (const o of list) {
        const b = [...team.buildings, ...team.stash].find(
          (x) => x.id === o.building,
        );
        expect(b?.owner).toBe(player);
        expect(o.tier).toBeLessThan(3);
      }
      expect(list.map((o) => o.building)).toEqual(
        [...list.map((o) => o.building)].sort((a, b) => a - b),
      );
    }
  });
});

describe('Workshop, one player', () => {
  const players = ['Ann'];

  test('buying an upgrade pays 80% from own gold, raises one tier, adds nothing', () => {
    const s = workshopStep(players, [100]);
    expect(allowedIntents(s, 0, deps)).toContain('event_choose');
    const opt = mineOf(s, 0)[1] as Opt;
    const r = ok(
      s,
      0,
      { type: 'event_choose', choice: opt['id'] as string },
      deps,
    );
    const next = r.state;
    expect(next.step).toBe('shop');
    expect(tierOf(next, opt['building'] as number)).toBe(
      (opt['tier'] as number) + 1,
    );
    // The shop pays income on entering, so compare against the known income.
    expect(next.perPlayer[0]?.gold).toBe(
      100 - (opt['price'] as number) + gameConfigs.economy.baseIncomePerShop,
    );
    expect(count(next)).toBe(count(s));
    for (const b of [...next.team.stash, ...next.team.buildings]) {
      if (b.id !== opt['building']) expect(b.tier).toBe(tierOf(s, b.id));
    }
    roundTrips(next);
  });

  test('skip is allowed even when an upgrade is affordable', () => {
    const s = workshopStep(players, [100]);
    expect(mineOf(s, 0).some((o) => o['affordable'] === true)).toBe(true);
    const next = ok(s, 0, { type: 'event_choose', choice: 'skip' }, deps).state;
    expect(next.step).toBe('shop');
    expect(next.team).toEqual(s.team);
    expect(next.perPlayer[0]?.gold).toBe(
      100 + gameConfigs.economy.baseIncomePerShop,
    );
    roundTrips(next);
  });

  test('an upgrade the player cannot afford is rejected; skip still works', () => {
    // Enough for a wall (7) but not a turret (28).
    const s = workshopStep(players, [8]);
    const dear = mineOf(s, 0).find((o) => o['affordable'] === false) as Opt;
    expect(dear).toBeDefined();
    const r = choose(s, 0, dear['id'] as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_enough_gold');
    expect(choose(s, 0, 'skip').ok).toBe(true);
  });

  test('buildings at tier 3 are never offered; unknown ids are invalid', () => {
    const s = workshopStep(players, [1000]);
    for (const o of optionsOf(s)) expect(o['tier']).toBeLessThan(3);
    const r = choose(s, 0, 'b99999');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_choice');
  });
});

describe('Workshop, two players', () => {
  const players = ['Ann', 'Bo'];

  test('each player chooses for themselves; applied when the last has chosen', () => {
    const s = workshopStep(players, [100, 100]);
    const a = mineOf(s, 0)[0] as Opt;
    const b = mineOf(s, 1)[0] as Opt;
    const first = ok(
      s,
      0,
      { type: 'event_choose', choice: a['id'] as string },
      deps,
    );
    expect(first.state.step).toBe('event_resolve');
    // Nothing applied yet.
    expect(first.state.team).toEqual(s.team);
    expect(first.state.perPlayer.map((p) => p.gold)).toEqual([100, 100]);
    const view = eventFollowUp(first.state, 1);
    expect(view?.perPlayer).toBe(true);
    expect(view?.chosen).toEqual([true, false]);
    expect(view?.waitingFor).toEqual([1]);
    expect(view?.options.every((o) => (o as Opt)['player'] === 1)).toBe(true);
    const last = ok(
      first.state,
      1,
      { type: 'event_choose', choice: b['id'] as string },
      deps,
    );
    const next = last.state;
    expect(next.step).toBe('shop');
    expect(tierOf(next, a['building'] as number)).toBe(a['newTier']);
    expect(tierOf(next, b['building'] as number)).toBe(b['newTier']);
    const income = gameConfigs.economy.baseIncomePerShop;
    expect(next.perPlayer.map((p) => p.gold)).toEqual([
      100 - (a['price'] as number) + income,
      100 - (b['price'] as number) + income,
    ]);
    // No party vote and no random draw.
    expect(last.effects.some((e) => e.type === 'vote_resolved')).toBe(false);
    roundTrips(next);
  });

  test('a save taken mid-choice (one player chosen, one not) restores to the same follow-up state', () => {
    const s = workshopStep(players, [100, 100]);
    const a = mineOf(s, 0)[1] as Opt;
    const b = mineOf(s, 1)[0] as Opt;
    const mid = ok(
      s,
      0,
      { type: 'event_choose', choice: a['id'] as string },
      deps,
    ).state;
    // Through the save record and JSON, as a reload does.
    const record = buildSaveRecord(runArgs(players, 7), mid, '1.0.0', 1);
    const parsed = parseSaveRecord(JSON.parse(JSON.stringify(record)), deps);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    const back = parsed.record.state;
    expect(back).toEqual(mid);
    expect(back.step).toBe('event_resolve');
    for (const player of [0, 1]) {
      expect(eventFollowUp(back, player)).toEqual(eventFollowUp(mid, player));
      expect(allowedIntents(back, player, deps)).toEqual(
        allowedIntents(mid, player, deps),
      );
    }
    expect(eventFollowUp(back, 0)?.chosen).toEqual([true, false]);
    expect(eventFollowUp(back, 0)?.waitingFor).toEqual([1]);
    // The first choice is still changeable, and the restored run finishes.
    const changed = ok(
      back,
      0,
      { type: 'event_choose', choice: 'skip' },
      deps,
    ).state;
    expect(changed.step).toBe('event_resolve');
    const done = ok(
      changed,
      1,
      { type: 'event_choose', choice: b['id'] as string },
      deps,
    ).state;
    expect(done.step).toBe('shop');
    expect(tierOf(done, a['building'] as number)).toBe(a['tier']);
    expect(tierOf(done, b['building'] as number)).toBe(b['newTier']);
  });

  test('a choice can be changed until the last player has chosen', () => {
    const s = workshopStep(players, [100, 100]);
    const [a0, a1] = mineOf(s, 0) as [Opt, Opt];
    const b = mineOf(s, 1)[0] as Opt;
    let cur = ok(
      s,
      0,
      { type: 'event_choose', choice: a0['id'] as string },
      deps,
    ).state;
    cur = ok(
      cur,
      0,
      { type: 'event_choose', choice: a1['id'] as string },
      deps,
    ).state;
    cur = ok(cur, 0, { type: 'event_choose', choice: 'skip' }, deps).state;
    cur = ok(
      cur,
      0,
      { type: 'event_choose', choice: a0['id'] as string },
      deps,
    ).state;
    expect(cur.step).toBe('event_resolve');
    const next = ok(
      cur,
      1,
      { type: 'event_choose', choice: b['id'] as string },
      deps,
    ).state;
    expect(tierOf(next, a0['building'] as number)).toBe(a0['newTier']);
    expect(tierOf(next, a1['building'] as number)).toBe(a1['tier']);
    roundTrips(next);
  });

  test("a player cannot take another player's building", () => {
    const s = workshopStep(players, [100, 100]);
    const theirs = mineOf(s, 1)[0] as Opt;
    const r = choose(s, 0, theirs['id'] as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_owner');
    // The state is untouched.
    expect(eventFollowUp(s)?.chosen).toEqual([false, false]);
  });

  test('both skipping changes nothing and moves on', () => {
    const s = workshopStep(players, [100, 100]);
    const next = ok(
      ok(s, 1, { type: 'event_choose', choice: 'skip' }, deps).state,
      0,
      { type: 'event_choose', choice: 'skip' },
      deps,
    ).state;
    expect(next.step).toBe('shop');
    expect(next.team).toEqual(s.team);
  });

  test('a player with nothing affordable has only skip and needs no answer', () => {
    const s = workshopStep(players, [100, 0]);
    expect(eventFollowUp(s)?.chosen).toEqual([false, true]);
    expect(mineOf(s, 1).every((o) => o['affordable'] === false)).toBe(true);
    const bad = choose(s, 1, mineOf(s, 1)[0]?.['id'] as string);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('not_enough_gold');
    const a = mineOf(s, 0)[0] as Opt;
    const next = ok(
      s,
      0,
      { type: 'event_choose', choice: a['id'] as string },
      deps,
    ).state;
    expect(next.step).toBe('shop');
    expect(tierOf(next, a['building'] as number)).toBe(a['newTier']);
  });

  test('when nobody can afford anything the step is skipped', () => {
    const s = workshopStep(players, [0, 0]);
    expect(s.step).toBe('shop');
  });
});

describe('Workshop, four players', () => {
  const players = ['A', 'B', 'C', 'D'];

  test('mixed choices are applied together in player order', () => {
    const s = workshopStep(players, [100, 100, 100, 3]);
    expect(eventFollowUp(s)?.chosen).toEqual([false, false, false, true]);
    const picks = [0, 1, 2].map((p) => mineOf(s, p)[0] as Opt);
    let cur = s;
    cur = ok(
      cur,
      2,
      { type: 'event_choose', choice: picks[2]?.['id'] as string },
      deps,
    ).state;
    cur = ok(
      cur,
      1,
      { type: 'event_choose', choice: picks[1]?.['id'] as string },
      deps,
    ).state;
    expect(cur.step).toBe('event_resolve');
    cur = ok(
      cur,
      0,
      { type: 'event_choose', choice: picks[0]?.['id'] as string },
      deps,
    ).state;
    expect(cur.step).toBe('shop');
    const income = gameConfigs.economy.baseIncomePerShop;
    picks.forEach((o, p) => {
      expect(tierOf(cur, o['building'] as number)).toBe(o['newTier']);
      expect(cur.perPlayer[p]?.gold).toBe(
        100 - (o['price'] as number) + income,
      );
    });
    expect(cur.perPlayer[3]?.gold).toBe(3 + income);
    roundTrips(cur);
  });
});

describe('Workshop offers', () => {
  const hooks = eventHooks(content, gameConfigs.events);
  const types = (s: RunState, seed: number) =>
    (hooks.eventOffers(s, Rng.fromSeed(seed)) as Record<string, Json>[]).map(
      (o) => o['type'],
    );
  const withGold = (s: RunState, golds: number[]): RunState => ({
    ...s,
    perPlayer: s.perPlayer.map((p, i) => ({ ...p, gold: golds[i] ?? 0 })),
  });

  test('offered only if some player owns an eligible building they can afford', () => {
    const base = atEvent(['Ann', 'Bo']);
    // Nobody can pay for any upgrade (the cheapest costs 3).
    for (let seed = 1; seed <= 40; seed++) {
      expect(types(withGold(base, [0, 2]), seed)).not.toContain('workshop');
    }
    // One player with gold is enough.
    let seen = false;
    for (let seed = 1; seed <= 40; seed++) {
      seen = seen || types(withGold(base, [0, 100]), seed).includes('workshop');
    }
    expect(seen).toBe(true);
  });

  test('not offered when every building is at tier 3', () => {
    const base = withGold(atEvent(['Ann']), [1000]);
    const maxed: RunState = {
      ...base,
      team: {
        ...base.team,
        buildings: base.team.buildings.map((b) => ({ ...b, tier: 3 })),
        stash: base.team.stash.map((b) => ({ ...b, tier: 3 })),
      },
    };
    for (let seed = 1; seed <= 40; seed++) {
      expect(types(maxed, seed)).not.toContain('workshop');
    }
  });

  test('the percentage comes from the event params and is stored in the offer', () => {
    const base = withGold(atEvent(['Ann']), [1000]);
    const offers = hooks.eventOffers(base, Rng.fromSeed(3)) as Record<
      string,
      Json
    >[];
    const w = offers.find((o) => o['type'] === 'workshop');
    expect(w?.['workshopPricePercent']).toBe(80);
  });
});

describe('Workshop in a played run (replay)', () => {
  for (const players of [['Ann'], ['Ann', 'Bo'], ['A', 'B', 'C', 'D']]) {
    test(`${String(players.length)} player(s): the choices replay to the same state`, () => {
      let done = 0;
      for (let seed = 1; seed <= 60 && done < 2; seed++) {
        let s = atEvent(players, seed);
        const offers = (s.pending as Record<string, Json>)['options'] as Opt[];
        if (!offers.some((o) => o['id'] === 'evt_workshop')) continue;
        s = voteAll(s, 'evt_workshop', deps);
        expect(s.step).toBe('event_resolve');
        roundTrips(s);
        for (let p = 0; p < players.length; p++) {
          const own = mineOf(s, p).find((o) => o['affordable'] === true);
          const choice =
            done === 0 && own !== undefined ? (own['id'] as string) : 'skip';
          s = ok(s, p, { type: 'event_choose', choice }, deps).state;
        }
        expect(s.step).toBe('shop');
        const re = replayRun(runArgs(players, seed), s.actionLog, deps);
        expect(re.ok).toBe(true);
        if (re.ok) expect(re.state).toEqual(s);
        roundTrips(s);
        done += 1;
      }
      expect(done).toBe(2);
    });
  }
});

describe('Workshop: tampered option data is not trusted', () => {
  const players = ['Ann', 'Bo'];
  function tamper(s: RunState, player: number, patch: Record<string, Json>) {
    const pending = s.pending as Record<string, Json>;
    const fu = pending['followUp'] as Record<string, Json>;
    let done = false;
    const options = (fu['options'] as Opt[]).map((o) => {
      if (!done && o['player'] === player) {
        done = true;
        return { ...o, ...patch };
      }
      return o;
    });
    return {
      ...s,
      pending: { ...pending, followUp: { ...fu, options } },
    } as RunState;
  }

  const cases: [string, (o: Opt) => Record<string, Json>][] = [
    ['tier', (o) => ({ tier: (o['tier'] as number) + 1 })],
    ['def', () => ({ def: 'nothing' })],
    ['owner', () => ({ player: 1 })],
  ];
  for (const [name, patch] of cases) {
    test(`${name}: rejected by validateRunState and by event_choose`, () => {
      const s = workshopStep(players, [100, 100]);
      const o = mineOf(s, 0)[0] as Opt;
      const bad = tamper(s, 0, patch(o));
      expect(validateRunState(JSON.parse(JSON.stringify(bad)), deps).ok).toBe(
        false,
      );
      const r = applyIntent(
        bad,
        0,
        { type: 'event_choose', choice: o['id'] as string },
        deps,
      );
      expect(r.ok).toBe(false);
    });
  }

  test('a Workshop follow-up without perPlayer: true fails validation', () => {
    const s = workshopStep(players, [100, 100]);
    const pending = s.pending as Record<string, Json>;
    const fu = { ...(pending['followUp'] as Record<string, Json>) };
    delete fu['perPlayer'];
    const bad = { ...s, pending: { ...pending, followUp: fu } };
    const r = validateRunState(JSON.parse(JSON.stringify(bad)), deps);
    expect(r.ok).toBe(false);
  });

  test('checkParams needs an integer percent', () => {
    const handler = defaultEventHandlers['workshop'];
    const def = (p: number) =>
      ({ params: { workshopPricePercent: p } }) as never;
    expect(handler?.checkParams?.(def(80))).toBeNull();
    expect(handler?.checkParams?.(def(80.5))).toMatch(/integer/);
  });
});
