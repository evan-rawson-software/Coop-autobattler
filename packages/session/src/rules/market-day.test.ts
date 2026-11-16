/**
 * Event `fromRound` (RS-4g) and Market day (RS-4i1): pools by round, the
 * wiring check, and the next-shop effects (extra offers, free first re-roll)
 * for one to four players, through save and reload.
 */
import { describe, expect, test } from 'vitest';
import { Rng, loadEventsOrThrow } from '@game/core';
import { fixedBattle } from './defaults.js';
import {
  checkEventHandlers,
  defaultEventHandlers,
  eventHooks,
} from './events.js';
import { createGameDeps } from './game-deps.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import { readShop } from './economy.js';
import {
  content,
  gameConfigs,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from '../testing/test-support.js';
import type { Json, PlayerRunState, RunDeps, RunState } from './types.js';
import { validateRunState } from './validate.js';

const economy = gameConfigs.economy;

/** Windfall and Market day only: both are offered whenever Market day may be. */
const twoEvents = loadEventsOrThrow({
  offerCount: 3,
  events: gameConfigs.events.events
    .filter((e) => e.type === 'windfall' || e.type === 'market_day')
    .map((e) => ({ ...e })),
  modifiers: gameConfigs.events.modifiers.map((m) => ({ ...m })),
});
const deps: RunDeps = createGameDeps(
  content,
  { ...gameConfigs, events: twoEvents },
  { battle: fixedBattle(true) },
);

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function offerIds(s: RunState): string[] {
  const o = (s.pending as Record<string, Json>)['options'] as {
    id: string;
  }[];
  return o.map((x) => x.id);
}

/** Play the default way until `stop`: easy PvE, Windfall at events. */
function until(s0: RunState, stop: (s: RunState) => boolean): RunState {
  let s = s0;
  for (let i = 0; i < 300 && !stop(s); i++) {
    if (s.step === 'pve_choice') s = voteAll(s, 'easy', deps);
    else if (s.step === 'event_choice') s = voteAll(s, 'evt_windfall', deps);
    else s = readyAll(s, deps);
  }
  if (!stop(s)) throw new Error(`did not reach the stop (at ${s.step})`);
  return s;
}

function atRound2Event(players: number): RunState {
  const names = ['Ann', 'Bo', 'Cy', 'Di'].slice(0, players);
  const r = createRun(runArgs(names, 7), deps);
  if (!r.ok) throw new Error(r.detail);
  return until(
    placeCoreAll(r.state, deps),
    (x) => x.step === 'event_choice' && x.round === 2,
  );
}

describe('event fromRound (RS-4g)', () => {
  const hooks = eventHooks(content, gameConfigs.events);
  const types = (round: number, seed: number): string[] => {
    const state = { ...atRound2Event(1), round };
    return (
      hooks.eventOffers(state, Rng.fromSeed(seed)) as Record<string, Json>[]
    )
      .map((o) => o['type'] as string)
      .sort();
  };

  test('Market day is never offered in round 1, and can be from round 2', () => {
    let seen = false;
    for (let seed = 1; seed <= 40; seed++) {
      expect(types(1, seed)).not.toContain('market_day');
      if (types(2, seed).includes('market_day')) seen = true;
    }
    expect(seen).toBe(true);
  });

  test('round 1 offers are the same with and without Market day in the file', () => {
    const without = eventHooks(
      content,
      loadEventsOrThrow({
        offerCount: 3,
        events: gameConfigs.events.events
          .filter((e) => e.type !== 'market_day')
          .map((e) => ({ ...e })),
        modifiers: gameConfigs.events.modifiers.map((m) => ({ ...m })),
      }),
    );
    const state = { ...atRound2Event(1), round: 1 };
    for (let seed = 1; seed <= 40; seed++) {
      expect(hooks.eventOffers(state, Rng.fromSeed(seed))).toEqual(
        without.eventOffers(state, Rng.fromSeed(seed)),
      );
    }
  });

  test('an always-available event with fromRound above 1 is refused at wiring', () => {
    const events = loadEventsOrThrow({
      offerCount: 3,
      events: [
        {
          id: 'evt_w',
          type: 'windfall',
          weight: 1,
          fromRound: 2,
          params: { gold: 4 },
        },
      ],
      modifiers: [],
    });
    expect(checkEventHandlers(events, defaultEventHandlers).join(' ')).toMatch(
      /always-available event must not have a "fromRound" above 1/,
    );
    expect(() => createGameDeps(content, { ...gameConfigs, events })).toThrow(
      /fromRound/,
    );
  });
});

describe('Market day', () => {
  for (const players of [1, 2, 3, 4]) {
    test(`${String(players)} player(s): extra offers and a free first re-roll in the next shop only`, () => {
      const s = atRound2Event(players);
      expect(offerIds(s).sort()).toEqual(['evt_market_day', 'evt_windfall']);
      let cur = voteAll(s, 'evt_market_day', deps);
      expect(cur.step).toBe('shop');
      const want = economy.shopOfferCount + 1;
      for (const p of cur.perPlayer) {
        expect(readShop(p)?.offers).toHaveLength(want);
        expect(p.nextShop).toEqual([
          { kind: 'extra_offers', count: 1 },
          { kind: 'free_rerolls', count: 1 },
        ]);
      }
      // Save and reload inside the shop keeps both.
      const reloaded = validateRunState(clone(cur), deps);
      expect(reloaded.ok).toBe(true);
      if (!reloaded.ok) return;
      expect(reloaded.state).toEqual(cur);

      // The first re-roll is free and still makes the extra offer.
      const gold = cur.perPlayer[0]?.gold as number;
      const first = ok(cur, 0, { type: 'reroll' }, deps);
      expect(first.state.perPlayer[0]?.gold).toBe(gold);
      expect(
        readShop(first.state.perPlayer[0] as PlayerRunState)?.offers,
      ).toHaveLength(want);
      expect(first.state.perPlayer[0]?.nextShop).toEqual([
        { kind: 'extra_offers', count: 1 },
      ]);
      expect(first.effects).toContainEqual({
        type: 'custom',
        name: 'rerolled',
        data: { player: 0, cost: 0 },
      });
      // Another player's re-rolls are not used up.
      if (players > 1) {
        expect(first.state.perPlayer[1]?.nextShop).toEqual(
          cur.perPlayer[1]?.nextShop,
        );
      }
      // The second costs the usual price and keeps the count.
      const second = ok(first.state, 0, { type: 'reroll' }, deps);
      expect(second.state.perPlayer[0]?.gold).toBe(gold - economy.rerollCost);
      expect(
        readShop(second.state.perPlayer[0] as PlayerRunState)?.offers,
      ).toHaveLength(want);
      // Reload after the free re-roll keeps what is left.
      const again = validateRunState(clone(first.state), deps);
      expect(again.ok && again.state).toEqual(first.state);

      // Replay is deterministic.
      const replayed = replayRun(
        runArgs(['Ann', 'Bo', 'Cy', 'Di'].slice(0, players), 7),
        first.state.actionLog,
        deps,
      );
      expect(replayed.ok && replayed.state).toEqual(first.state);

      // The shop that follows (after the PvP battle) has none of it.
      cur = until(
        cur,
        (x) => x.step === 'shop' && x.leg === 'pvp' && x.round === 2,
      );
      for (const p of cur.perPlayer) {
        expect(p.nextShop).toBeUndefined();
        expect('nextShop' in p).toBe(false);
        expect(readShop(p)?.offers).toHaveLength(economy.shopOfferCount);
      }
    });
  }

  test('the wall-shape limit still holds with the extra offer', () => {
    const s = voteAll(atRound2Event(1), 'evt_market_day', deps);
    let cur = s;
    for (let i = 0; i < 6; i++) {
      const offers = readShop(cur.perPlayer[0] as PlayerRunState)?.offers ?? [];
      const walls = new Set(
        offers
          .map((o) => o?.def ?? '')
          .filter((d) => d.startsWith('bld_wall_')),
      );
      expect(walls.size).toBeLessThanOrEqual(2);
      const r = applyIntent(cur, 0, { type: 'reroll' }, deps);
      if (!r.ok) break;
      cur = r.state;
    }
  });

  test('a saved nextShop outside the event and shop steps, or malformed, is rejected', () => {
    const s = voteAll(atRound2Event(1), 'evt_market_day', deps);
    const bad = (nextShop: unknown): boolean => {
      const c = clone(s) as unknown as { perPlayer: Record<string, unknown>[] };
      (c.perPlayer[0] as Record<string, unknown>)['nextShop'] = nextShop;
      return validateRunState(c, deps).ok;
    };
    expect(bad([{ kind: 'extra_offers', count: 2 }])).toBe(true);
    expect(bad([{ kind: 'extra_offers', count: 0 }])).toBe(false);
    expect(bad([{ kind: 'extra_offers', count: 11 }])).toBe(false);
    expect(bad([{ kind: 'bogus', count: 1 }])).toBe(false);
    expect(
      bad([
        { kind: 'free_rerolls', count: 1 },
        { kind: 'free_rerolls', count: 1 },
      ]),
    ).toBe(false);
    expect(bad('x')).toBe(false);
    const out = clone(readyAll(s, deps)) as unknown as {
      perPlayer: Record<string, unknown>[];
    };
    (out.perPlayer[0] as Record<string, unknown>)['nextShop'] = [
      { kind: 'extra_offers', count: 1 },
    ];
    expect(validateRunState(out, deps).ok).toBe(false);
  });

  test('abandoning in the shop clears the effects, so the final state validates', () => {
    const s = voteAll(atRound2Event(1), 'evt_market_day', deps);
    const r = ok(s, 0, { type: 'abandon' }, deps);
    expect(r.state.perPlayer[0]?.nextShop).toBeUndefined();
    expect(validateRunState(clone(r.state), deps).ok).toBe(true);
  });
});
