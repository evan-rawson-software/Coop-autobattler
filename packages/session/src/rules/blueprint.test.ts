/**
 * Blueprint (RS-4i5): which buildings are rare and when it is available, the
 * per-player offer and its stream, the follow-up (choose, skip, stale picks),
 * the held slot in the next shop (tier 1, normal price, kept by re-rolls,
 * bought once, gone after the shop) for 1 to 4 players through save and
 * reload, and the run-state checks.
 */
import { describe, expect, test } from 'vitest';
import {
  Rng,
  loadEventsOrThrow,
  offerWeightsAt,
  rareOfferDefs,
  rollOffers,
  tierPrice,
  type EconomyConfig,
} from '@game/core';
import { fixedBattle } from './defaults.js';
import {
  BLUEPRINT_PROMPT,
  blueprintChoice,
  blueprintHandler,
  type EventContext,
} from './events.js';
import { createGameDeps } from './game-deps.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import { economyHooks, heldSlot, readShop, type ShopData } from './economy.js';
import { addShopEffect, clearNextShop, setHeldOffer } from './shop-effects.js';
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
const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

const events = loadEventsOrThrow({
  offerCount: 3,
  events: gameConfigs.events.events
    .filter((e) => e.type === 'windfall' || e.type === 'blueprint')
    .map((e) => ({ ...e })),
  modifiers: gameConfigs.events.modifiers.map((m) => ({ ...m })),
});
const deps: RunDeps = createGameDeps(
  content,
  { ...gameConfigs, events },
  { battle: fixedBattle(true) },
);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const pend = (s: RunState) => s.pending as Record<string, Json>;
const offerOf = (s: RunState) => pend(s)['offer'] as Record<string, Json>;
const blueprintsOf = (s: RunState): string[][] =>
  offerOf(s)['blueprints'] as string[][];

/** The round-3 event step, then the Blueprint taken: the follow-up is open. */
function followUpAt(players: number, seed = 7): RunState {
  const r = createRun(runArgs(NAMES.slice(0, players), seed), deps);
  if (!r.ok) throw new Error(r.detail);
  let s = placeCoreAll(r.state, deps);
  for (let i = 0; i < 300; i++) {
    if (s.step === 'event_choice' && s.round === 3) break;
    if (s.step === 'pve_choice') s = voteAll(s, 'easy', deps);
    else if (s.step === 'event_choice') s = voteAll(s, 'evt_windfall', deps);
    else s = readyAll(s, deps);
  }
  expect(s.step).toBe('event_choice');
  return voteAll(s, 'evt_blueprint', deps);
}

/** Every player picks the first building offered to them (or `skip`). */
function chooseAll(s: RunState, pick: (p: number) => string): RunState {
  let cur = s;
  for (let p = 0; p < s.players.length; p++) {
    cur = ok(cur, p, { type: 'event_choose', choice: pick(p) }, deps).state;
  }
  return cur;
}
const first = (s: RunState) => (p: number) =>
  blueprintChoice(p, (blueprintsOf(s)[p] as string[])[0] as string);

const offersOf = (p: PlayerRunState) => (readShop(p) as ShopData).offers;

/** The rare buildings of today's content (weight at most 4, in file order). */
const RARE_FROM_3 = [
  'bld_crossover',
  'bld_wall_i',
  'bld_wall_o',
  'bld_wall_t',
  'bld_wall_s',
  'bld_wall_z',
  'bld_wall_l',
  'bld_wall_j',
  'bld_refinery_ab',
  'bld_golem_forge',
  'bld_refinery_bc',
  'bld_spire',
];

describe('Blueprint: the definition and which buildings are rare', () => {
  test('the definition is from round 3 with choices 3 and maxOfferWeight 4', () => {
    expect(
      gameConfigs.events.events.find((e) => e.id === 'evt_blueprint'),
    ).toMatchObject({
      type: 'blueprint',
      fromRound: 3,
      params: { choices: 3, maxOfferWeight: 4 },
    });
  });

  test("rare buildings of today's content, by round", () => {
    expect(rareOfferDefs(economy, 3, 4)).toEqual(RARE_FROM_3);
    // Before round 3 the late buildings (refineries, golem forge, spire) are
    // not sold, so they are not rare yet: same gate as the shop roll.
    expect(rareOfferDefs(economy, 2, 4)).toEqual(
      RARE_FROM_3.filter(
        (d) =>
          ![
            'bld_refinery_ab',
            'bld_golem_forge',
            'bld_refinery_bc',
            'bld_spire',
          ].includes(d),
      ),
    );
    expect(rareOfferDefs(economy, 3, 1)).toEqual(['bld_wall_i']);
  });

  test('"eligible" is the shop roll\'s own gate: rare is exactly what a roll can offer', () => {
    for (const round of [1, 2, 3, 6]) {
      const weights = offerWeightsAt(economy, round);
      const rare = rareOfferDefs(economy, round, 4);
      for (const w of weights) {
        expect(rare.includes(w.def)).toBe(w.weight > 0 && w.weight <= 4);
      }
      // Whatever a roll offers at this round that has weight 4 or less is rare.
      const rng = Rng.fromSeed(99);
      for (let i = 0; i < 40; i++) {
        for (const o of rollOffers(rng, round, content, economy)) {
          const w = weights.find((x) => x.def === o.def)?.weight ?? 0;
          expect(w).toBeGreaterThan(0);
          if (w <= 4) expect(rare).toContain(o.def);
        }
      }
    }
  });

  test('available only when a rare building can be offered at this round', () => {
    const base = followUpAt(1);
    const def = events.events.find((e) => e.type === 'blueprint');
    if (def === undefined) throw new Error('no blueprint');
    const withWeights = (
      offerWeights: EconomyConfig['offerWeights'],
    ): EventContext => ({
      state: { ...base, round: 4 },
      content,
      config: events,
      economy: { ...economy, offerWeights },
    });
    const w = (d: string, weight: number, fromRound = 1) => ({
      def: d,
      weight,
      fromRound,
    });
    // Only heavy buildings: nothing is rare.
    expect(
      blueprintHandler.available(withWeights([w('bld_extractor', 24)]), def),
    ).toBe(false);
    // A rare one that starts at round 5 is not yet eligible at round 4 ...
    expect(
      blueprintHandler.available(
        withWeights([w('bld_extractor', 24), w('bld_spire', 4, 5)]),
        def,
      ),
    ).toBe(false);
    // ... and is at round 5.
    const ctx5 = withWeights([w('bld_extractor', 24), w('bld_spire', 4, 5)]);
    expect(
      blueprintHandler.available(
        { ...ctx5, state: { ...ctx5.state, round: 5 } },
        def,
      ),
    ).toBe(true);
    // No shop rules wired: never available.
    const bare: EventContext = {
      state: ctx5.state,
      content,
      config: events,
    };
    expect(blueprintHandler.available(bare, def)).toBe(false);
  });

  test('parameters are checked at wiring', () => {
    const bad = (params: Record<string, number>): string[] => {
      try {
        createGameDeps(
          content,
          {
            ...gameConfigs,
            events: loadEventsOrThrow({
              offerCount: 3,
              events: [
                ...gameConfigs.events.events.map((e) => ({ ...e })),
                {
                  id: 'evt_bp2',
                  type: 'blueprint',
                  weight: 1,
                  params,
                },
              ],
              modifiers: [],
            }),
          },
          {},
        );
        return [];
      } catch (e) {
        return [(e as Error).message];
      }
    };
    expect(bad({ choices: 3, maxOfferWeight: 4 })).toEqual([]);
    expect(bad({ choices: 0, maxOfferWeight: 4 }).join()).toMatch(/choices/);
    expect(bad({ choices: 3 }).join()).toMatch(/maxOfferWeight/);
  });
});

describe('Blueprint: the offer and its stream', () => {
  test('per player, up to 3 distinct rare buildings of the round', () => {
    for (const players of [1, 2, 3, 4]) {
      const s = followUpAt(players);
      const lists = blueprintsOf(s);
      expect(lists).toHaveLength(players);
      for (const l of lists) {
        expect(l).toHaveLength(3);
        expect(new Set(l).size).toBe(3);
        for (const d of l) expect(RARE_FROM_3).toContain(d);
      }
    }
  });

  test("each player's list is drawn from the child stream <offer>.child(player): no other stream moves and the count of players does not matter", () => {
    const def = events.events.find((e) => e.type === 'blueprint');
    if (def === undefined) throw new Error('no blueprint');
    const s = followUpAt(1);
    const ctxFor = (n: number): EventContext => ({
      state: {
        ...s,
        round: 5,
        players: NAMES.slice(0, n).map((name, index) => ({ index, name })),
      },
      content,
      config: events,
      economy,
    });
    const rng = Rng.fromSeed(5);
    const before = rng.getState();
    const two = blueprintHandler.instantiate(ctxFor(2), def, rng);
    const four = blueprintHandler.instantiate(ctxFor(4), def, Rng.fromSeed(5));
    expect(rng.getState()).toEqual(before);
    const a = two['blueprints'] as string[][];
    const b = four['blueprints'] as string[][];
    expect(b.slice(0, 2)).toEqual(a);
    // Player 1's list is exactly what the child stream gives, alone.
    const solo = blueprintHandler.instantiate(ctxFor(2), def, Rng.fromSeed(5));
    expect(solo).toEqual(two);
    expect(a[0]).not.toEqual(a[1]);
  });

  test('fewer rare buildings than choices: all of them, once each', () => {
    const def = events.events.find((e) => e.type === 'blueprint');
    if (def === undefined) throw new Error('no blueprint');
    const s = followUpAt(1);
    const two = {
      ...economy,
      offerWeights: [
        { def: 'bld_extractor', weight: 24, fromRound: 1 },
        { def: 'bld_spire', weight: 4, fromRound: 1 },
        { def: 'bld_foundry', weight: 2, fromRound: 1 },
      ],
    };
    const out = blueprintHandler.instantiate(
      { state: s, content, config: events, economy: two },
      def,
      Rng.fromSeed(1),
    );
    expect((out['blueprints'] as string[][])[0]?.slice().sort()).toEqual([
      'bld_foundry',
      'bld_spire',
    ]);
  });
});

describe('Blueprint: the follow-up and the held slot', () => {
  for (const players of [1, 2, 3, 4]) {
    test(`${String(players)} player(s): the choice is held in the next shop only`, () => {
      const s = followUpAt(players);
      expect(s.step).toBe('event_resolve');
      expect((pend(s)['followUp'] as Record<string, Json>)['prompt']).toBe(
        BLUEPRINT_PROMPT,
      );
      const done = chooseAll(s, first(s));
      expect(done.step).toBe('shop');
      done.perPlayer.forEach((p, i) => {
        const def = (blueprintsOf(s)[i] as string[])[0] as string;
        expect(p.nextShop).toEqual([{ kind: 'held_offer', def }]);
        const offers = offersOf(p);
        expect(offers).toHaveLength(economy.shopOfferCount + 1);
        expect(offers[economy.shopOfferCount]).toEqual({
          slot: economy.shopOfferCount,
          def,
          tier: 1,
          price: tierPrice(content, def, 1),
        });
      });

      // Save and reload inside the shop keep it.
      const reloaded = validateRunState(clone(done), deps);
      expect(reloaded.ok && reloaded.state).toEqual(done);

      // Re-rolls (paid) replace the five offers and keep the held one.
      let cur = done;
      const held = offersOf(cur.perPlayer[0] as PlayerRunState)[
        economy.shopOfferCount
      ];
      const seen = new Set<string>();
      for (let i = 0; i < 3; i++) {
        cur = ok(cur, 0, { type: 'reroll' }, deps).state;
        const offers = offersOf(cur.perPlayer[0] as PlayerRunState);
        expect(offers).toHaveLength(economy.shopOfferCount + 1);
        expect(offers[economy.shopOfferCount]).toEqual(held);
        seen.add(JSON.stringify(offers.slice(0, economy.shopOfferCount)));
      }
      expect(seen.size).toBeGreaterThan(1);
      // The other players' shops did not change.
      if (players > 1) {
        expect(cur.perPlayer[1]).toEqual(done.perPlayer[1]);
      }
      const reloadedAgain = validateRunState(clone(cur), deps);
      expect(reloadedAgain.ok && reloadedAgain.state).toEqual(cur);

      // Buy it: normal price, once.
      const slot = economy.shopOfferCount;
      const gold = cur.perPlayer[0]?.gold as number;
      const bought = ok(cur, 0, { type: 'buy', slot }, deps);
      const p0 = bought.state.perPlayer[0] as PlayerRunState;
      expect(p0.gold).toBe(gold - (held?.price as number));
      expect(offersOf(p0)[slot]).toBeNull();
      expect(p0.nextShop).toBeUndefined();
      expect(bought.state.team.stash.some((e) => e.def === held?.def)).toBe(
        true,
      );
      expect(bought.effects).toContainEqual({
        type: 'custom',
        name: 'bought',
        data: {
          player: 0,
          slot,
          def: held?.def,
          tier: 1,
          price: held?.price,
          held: true,
        },
      });
      expect(applyIntent(bought.state, 0, { type: 'buy', slot }, deps).ok).toBe(
        false,
      );
      // After it was bought a re-roll does not bring it back.
      const rolled = ok(bought.state, 0, { type: 'reroll' }, deps).state;
      expect(offersOf(rolled.perPlayer[0] as PlayerRunState)).toHaveLength(
        economy.shopOfferCount,
      );
      const bought2 = validateRunState(clone(bought.state), deps);
      expect(bought2.ok && bought2.state).toEqual(bought.state);

      // Replay is deterministic.
      const replayed = replayRun(
        runArgs(NAMES.slice(0, players), 7),
        rolled.actionLog,
        deps,
      );
      expect(replayed.ok && replayed.state).toEqual(rolled);

      // The shop that follows (after the PvP battle) holds nothing of it.
      let after: RunState = done;
      for (let i = 0; i < 40; i++) {
        if (after.step === 'shop' && after.leg === 'pvp') break;
        if (after.step === 'pve_choice') after = voteAll(after, 'easy', deps);
        else if (after.step === 'event_choice') {
          after = voteAll(after, 'evt_windfall', deps);
        } else after = readyAll(after, deps);
      }
      expect(after.leg).toBe('pvp');
      for (const p of after.perPlayer) {
        expect('nextShop' in p).toBe(false);
        expect(offersOf(p)).toHaveLength(economy.shopOfferCount);
      }
    });
  }

  test('a player who skips gets nothing; the others are unaffected', () => {
    const s = followUpAt(3);
    const done = chooseAll(s, (p) =>
      p === 1
        ? 'skip'
        : blueprintChoice(p, (blueprintsOf(s)[p] as string[])[2] as string),
    );
    expect(done.step).toBe('shop');
    expect('nextShop' in (done.perPlayer[1] as PlayerRunState)).toBe(false);
    expect(offersOf(done.perPlayer[1] as PlayerRunState)).toHaveLength(
      economy.shopOfferCount,
    );
    for (const p of [0, 2]) {
      const pr = done.perPlayer[p] as PlayerRunState;
      expect(pr.nextShop).toEqual([
        { kind: 'held_offer', def: (blueprintsOf(s)[p] as string[])[2] },
      ]);
      expect(offersOf(pr)).toHaveLength(economy.shopOfferCount + 1);
    }
  });

  test('a choice can be changed until the last player has chosen; only own offers are legal', () => {
    const s = followUpAt(2);
    const [a, b] = blueprintsOf(s) as [string[], string[]];
    // Another player's option is refused.
    expect(
      applyIntent(
        s,
        0,
        { type: 'event_choose', choice: blueprintChoice(1, b[0] as string) },
        deps,
      ).ok,
    ).toBe(false);
    // A building that is not on the list is refused.
    expect(
      applyIntent(
        s,
        0,
        { type: 'event_choose', choice: blueprintChoice(0, 'bld_extractor') },
        deps,
      ).ok,
    ).toBe(false);
    let cur = ok(
      s,
      0,
      { type: 'event_choose', choice: blueprintChoice(0, a[0] as string) },
      deps,
    ).state;
    cur = ok(
      cur,
      0,
      { type: 'event_choose', choice: blueprintChoice(0, a[1] as string) },
      deps,
    ).state;
    expect(cur.step).toBe('event_resolve');
    const reloaded = validateRunState(clone(cur), deps);
    expect(reloaded.ok && reloaded.state).toEqual(cur);
    cur = ok(cur, 1, { type: 'event_choose', choice: 'skip' }, deps).state;
    expect(cur.step).toBe('shop');
    expect((cur.perPlayer[0] as PlayerRunState).nextShop).toEqual([
      { kind: 'held_offer', def: a[1] },
    ]);
  });

  test('a stored pick that is no longer on the list is applied as a skip', () => {
    const s = followUpAt(1);
    const offer = offerOf(s);
    const out = blueprintHandler.chooseEach?.(
      { state: s, content, config: events, economy },
      offer as never,
      [{ id: 'p0:bld_extractor', player: 0, def: 'bld_extractor' }],
    );
    expect(out?.ok).toBe(true);
    if (out?.ok !== true) return;
    expect(out.applied).toEqual([
      { player: 0, result: 'skip', dropped: true, reason: 'invalid_choice' },
    ]);
    expect(out.patch.perPlayer?.[0]?.nextShop).toBeUndefined();
  });

  test('with Market day too the held slot comes after the extra offers (7 offers)', () => {
    const s = followUpAt(1);
    const chosen = chooseAll(s, first(s));
    const p = addShopEffect(
      chosen.perPlayer[0] as PlayerRunState,
      'extra_offers',
      1,
    );
    expect(heldSlot(p, economy)).toBe(economy.shopOfferCount + 1);
    const hooks = economyHooks(content, economy);
    const patch = hooks.onShopEnter(
      { ...chosen, perPlayer: [p] },
      Rng.fromSeed(3),
    );
    const offers = offersOf(patch.perPlayer?.[0] as PlayerRunState);
    expect(offers).toHaveLength(economy.shopOfferCount + 2);
    expect(offers[economy.shopOfferCount + 1]?.def).toBe(
      (blueprintsOf(s)[0] as string[])[0],
    );
    expect(offers[economy.shopOfferCount + 1]?.tier).toBe(1);
  });

  test('the held offer does not move the shop stream', () => {
    const s = followUpAt(1);
    const chosen = chooseAll(s, first(s));
    const plain = {
      ...chosen,
      perPlayer: chosen.perPlayer.map((p) => clearNextShop(p)),
    };
    const hooks = economyHooks(content, economy);
    const a = hooks.onShopEnter(chosen, Rng.fromSeed(11));
    const b = hooks.onShopEnter(plain, Rng.fromSeed(11));
    const sa = readShop(a.perPlayer?.[0] as PlayerRunState) as ShopData;
    const sb = readShop(b.perPlayer?.[0] as PlayerRunState) as ShopData;
    expect(sa.stream).toEqual(sb.stream);
    expect(sa.offers.slice(0, economy.shopOfferCount)).toEqual(sb.offers);
  });
});

describe('Blueprint: the saved state is checked', () => {
  const inShop = chooseAll(followUpAt(1), first(followUpAt(1)));
  const check = (nextShop: unknown, base: RunState = inShop): boolean => {
    const c = clone(base) as unknown as {
      perPlayer: Record<string, unknown>[];
    };
    (c.perPlayer[0] as Record<string, unknown>)['nextShop'] = nextShop;
    return validateRunState(c, deps).ok;
  };

  test('held_offer entries: shape, known building, one of a kind', () => {
    expect(check([{ kind: 'held_offer', def: 'bld_spire' }])).toBe(true);
    expect(
      check([
        { kind: 'extra_offers', count: 1 },
        { kind: 'free_rerolls', count: 1 },
        { kind: 'held_offer', def: 'bld_spire' },
      ]),
    ).toBe(true);
    expect(check([{ kind: 'held_offer', def: 'bld_nope' }])).toBe(false);
    expect(check([{ kind: 'held_offer', def: '' }])).toBe(false);
    expect(check([{ kind: 'held_offer', count: 1 }])).toBe(false);
    expect(check([{ kind: 'held_offer', def: 'bld_spire', count: 1 }])).toBe(
      false,
    );
    expect(
      check([
        { kind: 'held_offer', def: 'bld_spire' },
        { kind: 'held_offer', def: 'bld_spire' },
      ]),
    ).toBe(false);
  });

  test('a held offer outside the event and shop steps is rejected', () => {
    const s = readyAll(inShop, deps);
    expect(s.step).not.toBe('shop');
    const withHeld = setHeldOffer(
      s.perPlayer[0] as PlayerRunState,
      'bld_spire',
    );
    const c = clone({ ...s, perPlayer: [withHeld] });
    expect(validateRunState(c, deps).ok).toBe(false);
  });

  test('a Blueprint follow-up whose options are damaged is rejected', () => {
    const s = followUpAt(2);
    const c = clone(s) as unknown as {
      pending: { followUp: { options: Record<string, unknown>[] } };
    };
    expect(validateRunState(clone(s), deps).ok).toBe(true);
    (c.pending.followUp.options[0] as Record<string, unknown>)['def'] =
      'bld_nope';
    expect(validateRunState(c, deps).ok).toBe(false);
  });

  test('abandoning in the shop clears it, so the final state validates', () => {
    const r = ok(inShop, 0, { type: 'abandon' }, deps);
    expect('nextShop' in (r.state.perPlayer[0] as PlayerRunState)).toBe(false);
    expect(validateRunState(clone(r.state), deps).ok).toBe(true);
  });
});
