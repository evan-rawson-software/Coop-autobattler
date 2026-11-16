/**
 * Drill (RS-4i2): availability by round and by collectors, options that list
 * only each player's own collectors below tier 3 at price 0, stale choices
 * dropped as skips, and 1 to 4 players through save and reload.
 */
import { describe, expect, test } from 'vitest';
import { Rng, raiseTier, type TeamState } from '@game/core';
import { fixedBattle } from './defaults.js';
import { eventHooks } from './events.js';
import { createGameDeps } from './game-deps.js';
import { applyIntent, createRun } from './machine.js';
import {
  content,
  gameConfigs,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from '../testing/test-support.js';
import type { Json, RunDeps, RunState } from './types.js';
import { validateRunState } from './validate.js';

const deps: RunDeps = createGameDeps(content, gameConfigs, {
  battle: fixedBattle(true),
});
const isSource = (def: string): boolean =>
  content.buildings.get(def)?.kind === 'source';

type Opt = Record<string, Json>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const pend = (s: RunState) => s.pending as Record<string, Json>;
const followUp = (s: RunState) => pend(s)['followUp'] as Record<string, Json>;
const optionsOf = (s: RunState) => followUp(s)['options'] as Opt[];
const mineOf = (s: RunState, p: number) =>
  optionsOf(s).filter((o) => o['player'] === p);
const tierOf = (s: RunState, id: unknown) =>
  [...s.team.buildings, ...s.team.stash].find((b) => b.id === id)?.tier;
const choose = (s: RunState, p: number, choice: string) =>
  applyIntent(s, p, { type: 'event_choose', choice }, deps);

/** A run at the event step of round 1, with the event offers set by hand. */
function atEvents(players: readonly string[]): RunState {
  const r = createRun(runArgs(players, 7), deps);
  if (!r.ok) throw new Error(r.detail);
  let s = placeCoreAll(r.state, deps);
  for (let i = 0; i < 20 && s.step !== 'event_choice'; i++) {
    s = s.step === 'pve_choice' ? voteAll(s, 'easy', deps) : readyAll(s, deps);
  }
  return s;
}

function drillStep(players: readonly string[]): RunState {
  const s = atEvents(players);
  const offer = { id: 'evt_drill', event: 'evt_drill', type: 'drill' };
  const forced: RunState = {
    ...s,
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

const withTeam = (s: RunState, team: TeamState): RunState => ({ ...s, team });
const offeredTypes = (s: RunState, round: number): string[] => {
  const offers = eventHooks(content, gameConfigs.events).eventOffers(
    { ...s, round },
    Rng.fromSeed(5),
  ) as readonly { type: string }[];
  return offers.map((o) => o.type);
};
const noCollectors = (t: TeamState): TeamState => ({
  ...t,
  buildings: t.buildings.filter((b) => !isSource(b.def)),
  stash: t.stash.filter((b) => !isSource(b.def)),
});

describe('Drill: availability', () => {
  const s = atEvents(['Ann']);
  const collectors = [...s.team.buildings, ...s.team.stash].filter((b) =>
    isSource(b.def),
  );

  test('the definition is from round 2 with no params', () => {
    const d = gameConfigs.events.events.find((e) => e.id === 'evt_drill');
    expect(d).toMatchObject({ type: 'drill', fromRound: 2, params: {} });
  });

  test('offered from round 2 when a collector is below tier 3 (the fixture has one)', () => {
    expect(collectors.length).toBeGreaterThan(0);
    const seen = (round: number) =>
      [1, 2, 3, 4, 5, 6, 7, 8].some((seed) =>
        (
          eventHooks(content, gameConfigs.events).eventOffers(
            { ...s, round },
            Rng.fromSeed(seed),
          ) as readonly { type: string }[]
        ).some((o) => o.type === 'drill'),
      );
    expect(seen(1)).toBe(false);
    expect(seen(2)).toBe(true);
  });

  test('not offered without a collector, or when all are tier 3', () => {
    const none = withTeam(s, noCollectors(s.team));
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(
        (
          eventHooks(content, gameConfigs.events).eventOffers(
            { ...none, round: 3 },
            Rng.fromSeed(seed),
          ) as readonly { type: string }[]
        ).map((o) => o.type),
      ).not.toContain('drill');
    }
    let maxed = s.team;
    for (const c of collectors) {
      for (let t = c.tier; t < 3; t++) {
        const r = raiseTier(maxed, { id: c.id });
        if (r.ok) maxed = r.state;
      }
    }
    expect(offeredTypes(withTeam(s, maxed), 3)).not.toContain('drill');
  });
});

describe('Drill: the follow-up', () => {
  test('options are only the owner’s collectors below tier 3, free, in instance order', () => {
    const s = drillStep(['Ann', 'Bo']);
    expect(s.step).toBe('event_resolve');
    expect(followUp(s)['prompt']).toBe('drill_building');
    expect(followUp(s)['perPlayer']).toBe(true);
    const opts = optionsOf(s);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(isSource(o['def'] as string)).toBe(true);
      expect(o['price']).toBe(0);
      expect(o['affordable']).toBe(true);
      expect(o['tier'] as number).toBeLessThan(3);
    }
    const ids = opts.map((o) => o['building'] as number);
    const byPlayer = [0, 1].flatMap((p) =>
      mineOf(s, p).map((o) => o['building'] as number),
    );
    expect(ids).toEqual(byPlayer);
    expect(validateRunState(clone(s), deps).ok).toBe(true);
  });

  test('a player with no collector starts on skip; a gold-less player still has options', () => {
    const s0 = drillStep(['Ann', 'Bo']);
    const owner = mineOf(s0, 0).length > 0 ? 0 : 1;
    const other = 1 - owner;
    // Remove every collector of `other` before the step opens.
    const base = atEvents(['Ann', 'Bo']);
    const team = noCollectorsOf(base.team, other);
    const forced: RunState = {
      ...withTeam(base, team),
      perPlayer: base.perPlayer.map((p) => ({ ...p, gold: 0 })),
      pending: {
        options: [
          { id: 'evt_drill', event: 'evt_drill', type: 'drill' },
          {
            id: 'evt_windfall',
            event: 'evt_windfall',
            type: 'windfall',
            gold: 4,
          },
        ],
      },
    };
    const s = voteAll(forced, 'evt_drill', deps);
    expect(s.step).toBe('event_resolve');
    const votes = followUp(s)['votes'] as (string | null)[];
    expect(votes[other]).toBe('skip');
    expect(mineOf(s, other)).toHaveLength(0);
    // The player with collectors has zero gold and can still take one.
    expect(mineOf(s, owner).length).toBeGreaterThan(0);
    expect(votes[owner]).toBeNull();
  });

  test('a building that is not a collector is refused', () => {
    const s = drillStep(['Ann']);
    const other = [...s.team.buildings, ...s.team.stash].find(
      (b) => !isSource(b.def) && b.tier < 3 && b.owner === 0,
    );
    expect(other).toBeDefined();
    const r = choose(s, 0, `b${String(other?.id)}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_choice');
  });

  test('a forged follow-up naming a non-collector is rejected by validateRunState', () => {
    const s = drillStep(['Ann']);
    const other = [...s.team.buildings, ...s.team.stash].find(
      (b) => !isSource(b.def) && b.tier < 3,
    );
    expect(other).toBeDefined();
    if (other === undefined) return;
    const bad = clone(s);
    const fu = (bad.pending as Record<string, Json>)['followUp'] as Record<
      string,
      Json
    >;
    (fu['options'] as Json[]).push({
      id: `b${String(other.id)}`,
      player: 0,
      building: other.id,
      def: other.def,
      tier: other.tier,
      newTier: other.tier + 1,
      price: 0,
      placed: s.team.buildings.some((b) => b.id === other.id),
      affordable: true,
    });
    expect(validateRunState(bad, deps).ok).toBe(false);
  });

  const resolved = (effects: readonly { type: string }[]): Opt[] =>
    (
      effects.find(
        (e) =>
          e.type === 'custom' &&
          (e as { name?: string }).name === 'event_resolved',
      ) as unknown as { data: { applied: Opt[] } }
    ).data.applied;

  test('a stored pick whose collector was sold is dropped as a skip', () => {
    const s = drillStep(['Ann', 'Bo']);
    const a = mineOf(s, 0)[0] as Opt;
    const r1 = choose(s, 0, a['id'] as string);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const team = {
      ...r1.state.team,
      buildings: r1.state.team.buildings.filter((x) => x.id !== a['building']),
      stash: r1.state.team.stash.filter((x) => x.id !== a['building']),
    };
    const r2 = choose(clone({ ...r1.state, team }), 1, 'skip');
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(resolved(r2.effects)[0]).toMatchObject({
      player: 0,
      result: 'skip',
      dropped: true,
      reason: 'invalid_choice',
    });
    expect(resolved(r2.effects)[1]).toEqual({ player: 1, result: 'skip' });
  });

  test('a stored pick whose collector is now tier 3 is dropped as a skip', () => {
    const s = drillStep(['Ann', 'Bo']);
    const b = mineOf(s, 1)[0] as Opt;
    const r1 = choose(s, 1, b['id'] as string);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    let team = r1.state.team;
    for (let t = b['tier'] as number; t < 3; t++) {
      const up = raiseTier(team, { id: b['building'] as number });
      if (up.ok) team = up.state;
    }
    const a = mineOf(s, 0)[0] as Opt;
    const r2 = choose(clone({ ...r1.state, team }), 0, a['id'] as string);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(resolved(r2.effects)[1]).toMatchObject({
      player: 1,
      result: 'skip',
      dropped: true,
    });
    expect(tierOf(r2.state, b['building'])).toBe(3);
    expect(tierOf(r2.state, a['building'])).toBe((a['tier'] as number) + 1);
  });

  test.each([1, 2, 3, 4])(
    '%i player(s): each raises one collector free, through save and reload',
    (n) => {
      const names = ['Ann', 'Bo', 'Cy', 'Di'].slice(0, n);
      let s = drillStep(names);
      const before = s.perPlayer.map((p) => p.gold);
      const picks: Opt[] = [];
      for (let p = 0; p < n; p++) {
        const o: Opt | undefined = mineOf(s, p)[0];
        if (o === undefined) {
          picks.push({});
          continue;
        }
        picks.push(o);
        const r = choose(clone(s), p, o['id'] as string);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        s = clone(r.state);
        expect(validateRunState(s, deps).ok).toBe(true);
      }
      expect(s.step).not.toBe('event_resolve');
      picks.forEach((o, p) => {
        if (o['building'] === undefined) return;
        expect(tierOf(s, o['building'])).toBe((o['tier'] as number) + 1);
        // free: only the shop income changed the gold
        expect(s.perPlayer[p]?.gold).toBe(
          (before[p] ?? 0) + gameConfigs.economy.baseIncomePerShop,
        );
      });
    },
  );
});

function noCollectorsOf(t: TeamState, player: number): TeamState {
  return {
    ...t,
    buildings: t.buildings.filter(
      (b) => b.owner !== player || !isSource(b.def),
    ),
    stash: t.stash.filter((b) => b.owner !== player || !isSource(b.def)),
  };
}
