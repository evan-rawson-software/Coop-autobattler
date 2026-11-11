import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  hashJson,
  loadEventsOrThrow,
  Rng,
  type TeamState,
} from '@game/core';
import { fixedBattle } from './defaults.js';
import {
  defaultEventHandlers,
  eventHooks,
  shrineHandler,
  type EventHandler,
} from './events.js';
import { createGameDeps } from './game-deps.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import { readPveOption, type PveOption } from './pve-options.js';
import { replayLastBattle, verifyLastBattle } from './replay.js';
import { allowedIntents, nextBattleInfo } from './selectors.js';
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
import type {
  BattleInput,
  BattleResolver,
  Json,
  RunDeps,
  RunState,
} from './types.js';
import { validateRunState } from './validate.js';
import type { BattleDetail } from './real-battle.js';

// ---------------------------------------------------------------------------
// Helpers

const rewards = gameConfigs.economy.rewards;

function pending(s: RunState): Record<string, Json> {
  return s.pending as Record<string, Json>;
}

function offersOf(s: RunState): Record<string, Json>[] {
  return pending(s)['options'] as Record<string, Json>[];
}

function optionsOf(list: readonly Json[]): PveOption[] {
  return list.map((o) => {
    const opt = readPveOption(o);
    if (opt === null) throw new Error('not a PvE option');
    return opt;
  });
}

function start(
  deps: RunDeps,
  players: readonly string[] = ['Ann'],
  seed = 7,
): RunState {
  const r = createRun(runArgs(players, seed), deps);
  if (!r.ok) throw new Error(r.detail);
  return placeCoreAll(r.state, deps);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function detailOf(s: RunState): BattleDetail {
  const b = pending(s)['battle'] as Record<string, Json>;
  return b['detail'] as unknown as BattleDetail;
}

function totalBuildings(t: TeamState): number {
  return t.buildings.length + t.stash.length;
}

interface Policy {
  readonly difficulty?: string;
  /** Which event offer id to vote for. */
  readonly event?: (s: RunState) => string;
  /** Which follow-up option id to choose. */
  readonly choose?: (s: RunState) => string;
}

/** Do the next "default" thing everyone does in the current step. */
function step(s: RunState, deps: RunDeps, policy: Policy = {}): RunState {
  switch (s.step) {
    case 'pve_choice':
      return voteAll(s, policy.difficulty ?? 'easy', deps);
    case 'event_choice':
      return voteAll(
        s,
        policy.event?.(s) ?? (offersOf(s)[0]?.['id'] as string),
        deps,
      );
    case 'event_resolve': {
      const fu = pending(s)['followUp'] as Record<string, Json>;
      const first = (fu['options'] as Record<string, Json>[])[0];
      const id = policy.choose?.(s) ?? (first?.['id'] as string);
      let cur = s;
      for (let p = 0; p < s.players.length; p++) {
        cur = ok(cur, p, { type: 'event_choose', choice: id }, deps).state;
      }
      return cur;
    }
    default:
      return readyAll(s, deps);
  }
}

function until(
  s0: RunState,
  deps: RunDeps,
  stop: (s: RunState) => boolean,
  policy: Policy = {},
): RunState {
  let s = s0;
  for (let i = 0; i < 200 && !stop(s); i++) s = step(s, deps, policy);
  if (!stop(s)) throw new Error(`did not reach the stop (at ${s.step})`);
  return s;
}

/** A resolver that wins PvE and loses PvP, or the other way round. */
function scripted(pve: boolean, pvp: boolean): BattleResolver {
  const inner = fixedBattle(true);
  return {
    resolve(input: BattleInput) {
      const r = inner.resolve(input);
      return { ...r, won: input.kind === 'pve' ? pve : pvp };
    },
  };
}

const fixedDeps = (pve: boolean, pvp: boolean): RunDeps =>
  makeGameDeps({ battle: scripted(pve, pvp) });

// ---------------------------------------------------------------------------

describe('PvE options (RS-3, RS-3b, RS-6a)', () => {
  const deps = fixedDeps(true, true);

  test('three options exist in state before the first build step is shown', () => {
    const s = start(deps);
    expect(s.step).toBe('build');
    expect(s.upcomingPve?.round).toBe(1);
    const options = optionsOf(s.upcomingPve?.options ?? []);
    expect(options.map((o) => o.id)).toEqual(['easy', 'medium', 'hard']);
    const info = nextBattleInfo(s, deps);
    expect(info?.kind).toBe('pve');
    if (info?.kind !== 'pve') return;
    expect(info.options.map((o) => o.archetype)).toEqual(
      options.map((o) => o.archetype),
    );
    expect(info.options[0]?.summary.totalUnits).toBeGreaterThan(0);
    expect('threat' in (info.options[0] ?? {})).toBe(false);
  });

  test('harder options have strictly larger threat budgets and rewards', () => {
    for (const players of [['Ann'], ['Ann', 'Bo'], ['A', 'B', 'C', 'D']]) {
      let s = start(deps, players);
      for (let round = 1; round <= 4; round++) {
        // Round 1's options exist at the first build; the others at the
        // shop that ends the previous round.
        if (round > 1) {
          s = until(
            s,
            deps,
            (x) =>
              x.step === 'shop' && x.leg === 'pvp' && x.round === round - 1,
          );
        }
        const options = optionsOf(s.upcomingPve?.options ?? []);
        const [easy, medium, hard] = options;
        if (!easy || !medium || !hard) throw new Error('missing option');
        expect(easy.budget).toBeLessThan(medium.budget);
        expect(medium.budget).toBeLessThan(hard.budget);
        expect(easy.reward.gold).toBeLessThan(medium.reward.gold);
        expect(medium.reward.gold).toBeLessThan(hard.reward.gold);
        expect(easy.reward.gold).toBe(rewards.pveWin.easy);
        expect(hard.reward.gold).toBe(rewards.pveWin.hard);
        expect(easy.threat.partySize).toBe(players.length);
        expect(easy.threat.round).toBe(round);
      }
    }
  });

  test('options can be different archetypes', () => {
    const s = start(deps);
    const kinds = new Set(
      optionsOf(s.upcomingPve?.options ?? []).map((o) => o.archetype),
    );
    expect(kinds.size).toBe(3);
  });

  test('the options for the next round are stored before the shop that ends the round', () => {
    let s = start(deps);
    s = until(s, deps, (x) => x.step === 'shop' && x.leg === 'pvp');
    expect(s.round).toBe(1);
    expect(s.upcomingPve?.round).toBe(2);
    const stored = clone(s.upcomingPve?.options);
    const info = nextBattleInfo(s, deps);
    expect(info?.kind === 'pve' && info.round).toBe(2);
    // The choice step shows exactly the stored options.
    s = readyAll(s, deps);
    expect(s.step).toBe('pve_choice');
    expect(s.round).toBe(2);
    expect(s.upcomingPve).toBeNull();
    expect(pending(s)['options']).toEqual(stored);
  });

  test('the shop after the PvE leg shows "opponent unknown" and the stakes', () => {
    let s = start(deps);
    s = until(s, deps, (x) => x.step === 'shop' && x.leg === 'pve');
    const info = nextBattleInfo(s, deps);
    expect(info).toEqual({
      kind: 'pvp',
      round: 1,
      opponent: 'unknown',
      stakes: {
        winGold: rewards.pvpWin,
        lossGold: rewards.pvpLoss,
        lifeCost: 1,
      },
    });
    expect(nextBattleInfo({ ...s, step: 'pve_summary' }, deps)).toBeNull();
  });

  test('reloading a state (JSON round trip) changes nothing', () => {
    let s = start(deps);
    s = until(s, deps, (x) => x.step === 'shop' && x.leg === 'pvp');
    const loaded = validateRunState(clone(s), deps);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state).toEqual(s);
    const a = step(s, deps);
    const b = step(loaded.state, deps);
    expect(b).toEqual(a);
  });
});

describe('rewards (EC-6, EC-7)', () => {
  function goldBeforeAfterSummary(
    deps: RunDeps,
    difficulty: string,
    which: 'pve_summary' | 'pvp_summary',
  ) {
    let s = start(deps);
    s = until(s, deps, (x) => x.step === which, { difficulty });
    const before = s.perPlayer.map((p) => p.gold);
    const lives = s.lives;
    const after = readyAll(s, deps);
    return {
      gained: after.perPlayer.map((p, i) => p.gold - (before[i] as number)),
      livesLost: lives - after.lives,
    };
  }

  test('a PvE win pays more for harder options', () => {
    const deps = fixedDeps(true, true);
    const g = (d: string) =>
      goldBeforeAfterSummary(deps, d, 'pve_summary').gained[0];
    expect(g('easy')).toBe(rewards.pveWin.easy);
    expect(g('medium')).toBe(rewards.pveWin.medium);
    expect(g('hard')).toBe(rewards.pveWin.hard);
  });

  test('a PvE loss grants nothing and costs no life', () => {
    const deps = fixedDeps(false, true);
    for (const d of ['easy', 'medium', 'hard']) {
      const r = goldBeforeAfterSummary(deps, d, 'pve_summary');
      expect(r.gained).toEqual([0]);
      expect(r.livesLost).toBe(0);
    }
  });

  test('every player is paid', () => {
    const deps = fixedDeps(true, true);
    let s = start(deps, ['Ann', 'Bo', 'Cy']);
    s = until(s, deps, (x) => x.step === 'pve_summary');
    const before = s.perPlayer.map((p) => p.gold);
    const after = readyAll(s, deps);
    expect(
      after.perPlayer.map((p, i) => p.gold - (before[i] as number)),
    ).toEqual([3, 3, 3]);
  });

  test('a PvP win pays gold; a PvP loss pays the consolation and costs a life', () => {
    const win = goldBeforeAfterSummary(
      fixedDeps(true, true),
      'easy',
      'pvp_summary',
    );
    expect(win.gained).toEqual([rewards.pvpWin]);
    expect(win.livesLost).toBe(0);
    const loss = goldBeforeAfterSummary(
      fixedDeps(true, false),
      'easy',
      'pvp_summary',
    );
    expect(loss.gained).toEqual([rewards.pvpLoss]);
    expect(loss.livesLost).toBe(1);
  });
});

describe('the event step', () => {
  const deps = fixedDeps(true, true);

  function atEvent(d: RunDeps = deps, players: readonly string[] = ['Ann']) {
    return until(start(d, players), d, (x) => x.step === 'event_choice');
  }

  test('three distinct offers, drawn and stored before they are shown', () => {
    for (let seed = 1; seed <= 25; seed++) {
      let s = start(deps, ['Ann'], seed);
      s = until(s, deps, (x) => x.step === 'event_choice');
      while (s.round < 4) {
        const offers = offersOf(s);
        expect(offers).toHaveLength(3);
        expect(new Set(offers.map((o) => o['id'])).size).toBe(3);
        expect(
          new Set(offers.map((o) => canonicalJson({ ...o, id: 0 }))).size,
        ).toBe(3);
        s = until(s, deps, (x) => x.step === 'event_choice' && x !== s);
      }
    }
  });

  test('offers are the same after reload and after replay', () => {
    const s = atEvent();
    const reloaded = validateRunState(clone(s), deps);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(offersOf(reloaded.state)).toEqual(offersOf(s));
    const replayed = replayRun(runArgs(), s.actionLog, deps);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.state).toEqual(s);
    // Applying the same vote to the reloaded state gives the same result.
    const id = offersOf(s)[0]?.['id'] as string;
    expect(voteAll(reloaded.state, id, deps)).toEqual(voteAll(s, id, deps));
  });

  test('Workshop: raises one owned building by one tier and adds none', () => {
    const s = atEvent();
    const before = s.team;
    let cur = voteAll(s, 'evt_workshop', deps);
    expect(cur.step).toBe('event_resolve');
    expect(allowedIntents(cur, 0, deps)).toContain('event_choose');
    const fu = pending(cur)['followUp'] as Record<string, Json>;
    const options = fu['options'] as Record<string, Json>[];
    expect(options.length).toBeGreaterThan(0);
    const target = options[1] ?? options[0];
    const id = target?.['id'] as string;
    const building = target?.['building'] as number;
    cur = step(cur, deps, { choose: () => id });
    expect(cur.step).toBe('shop');
    expect(totalBuildings(cur.team)).toBe(totalBuildings(before));
    const find = (t: TeamState) =>
      [...t.buildings, ...t.stash].find((b) => b.id === building);
    expect(find(cur.team)?.tier).toBe((find(before)?.tier as number) + 1);
    for (const b of [...cur.team.buildings, ...cur.team.stash]) {
      if (b.id !== building) {
        expect(b.tier).toBe(
          find(before) &&
            [...before.buildings, ...before.stash].find((x) => x.id === b.id)
              ?.tier,
        );
      }
    }
  });

  test('Workshop never raises above tier 3 and is not offered without a candidate', () => {
    const s = atEvent();
    const maxed: RunState = {
      ...s,
      team: {
        ...s.team,
        buildings: s.team.buildings.map((b) => ({ ...b, tier: 3 })),
        stash: s.team.stash.map((b) => ({ ...b, tier: 3 })),
      },
    };
    const hooks = eventHooks(content, gameConfigs.events);
    for (let i = 0; i < 20; i++) {
      const offers = hooks.eventOffers(maxed, Rng.fromSeed(i + 1)) as Record<
        string,
        Json
      >[];
      expect(offers.some((o) => o['type'] === 'workshop')).toBe(false);
      expect(offers).toHaveLength(3);
      expect(new Set(offers.map((o) => o['id'])).size).toBe(3);
      expect(
        new Set(offers.map((o) => canonicalJson({ ...o, id: 0 }))).size,
      ).toBe(3);
    }
    // One building below tier 3 is the only candidate.
    const one: RunState = {
      ...maxed,
      team: {
        ...maxed.team,
        stash: maxed.team.stash.map((b, i) =>
          i === 0 ? { ...b, tier: 2 } : b,
        ),
      },
    };
    const fu = defaultEventHandlers['workshop']?.resolve(
      { state: one, content, config: gameConfigs.events },
      { id: 'evt_workshop', event: 'evt_workshop', type: 'workshop' },
    );
    expect(fu?.followUp?.options).toHaveLength(1);
  });

  test('Shrine: choose one of three modifiers; it is stored in team state', () => {
    const s = atEvent();
    expect(s.team.modifiers).toBeUndefined();
    let cur = voteAll(s, 'evt_shrine', deps);
    expect(cur.step).toBe('event_resolve');
    const fu = pending(cur)['followUp'] as Record<string, Json>;
    const options = fu['options'] as Record<string, Json>[];
    expect(options).toHaveLength(3);
    expect(new Set(options.map((o) => o['id'])).size).toBe(3);
    const choice = options[2]?.['id'] as string;
    cur = step(cur, deps, { choose: () => choice });
    expect(cur.step).toBe('shop');
    expect(cur.team.modifiers?.map((m) => m.id)).toEqual([choice]);
    expect(cur.team.modifiers?.[0]?.effects.length).toBeGreaterThan(0);
    expect(totalBuildings(cur.team)).toBe(totalBuildings(s.team));
    expect(validateRunState(clone(cur), deps).ok).toBe(true);
  });

  test('Shrine does not offer a modifier already held, unless it stacks', () => {
    const s = atEvent();
    const heldAll: RunState = {
      ...s,
      team: {
        ...s.team,
        modifiers: gameConfigs.events.modifiers.map((m) => ({
          id: m.id,
          effects: m.effects,
        })),
      },
    };
    const ctx = { state: heldAll, content, config: gameConfigs.events };
    const def = gameConfigs.events.events.find((e) => e.type === 'shrine');
    if (def === undefined) throw new Error('no shrine');
    const data = shrineHandler.instantiate(ctx, def, Rng.fromSeed(5));
    // Only the stackable modifiers remain.
    const stackable = gameConfigs.events.modifiers
      .filter((m) => m.stackable)
      .map((m) => m.id);
    expect(data['modifiers']).toEqual(stackable);
    // With none held, the offer has three.
    const fresh = shrineHandler.instantiate(
      { ...ctx, state: s },
      def,
      Rng.fromSeed(5),
    );
    expect((fresh['modifiers'] as Json[]).length).toBe(3);
  });

  test('Windfall: gold to every player', () => {
    const s = atEvent(deps, ['Ann', 'Bo']);
    const before = s.perPlayer.map((p) => p.gold);
    const cur = voteAll(s, 'evt_windfall', deps);
    expect(cur.step).toBe('shop');
    const income = gameConfigs.economy.baseIncomePerShop;
    cur.perPlayer.forEach((p, i) => {
      expect(p.gold).toBe((before[i] as number) + 4 + income);
    });
  });

  test('the follow-up is a party vote: partial votes wait, a tie goes to the host', () => {
    const s = atEvent(deps, ['Ann', 'Bo']);
    let cur = voteAll(s, 'evt_workshop', deps);
    const fu = pending(cur)['followUp'] as Record<string, Json>;
    const options = fu['options'] as Record<string, Json>[];
    const a = options[0]?.['id'] as string;
    const b = options[1]?.['id'] as string;
    cur = ok(cur, 1, { type: 'event_choose', choice: b }, deps).state;
    expect(cur.step).toBe('event_resolve');
    const bad = applyIntent(
      cur,
      0,
      { type: 'event_choose', choice: 'nope' },
      deps,
    );
    expect(bad.ok).toBe(false);
    cur = ok(cur, 0, { type: 'event_choose', choice: a }, deps).state;
    expect(cur.step).toBe('shop');
    // Host (player 0) chose a; the tie went to the host.
    const id = options[0]?.['building'] as number;
    const was = [...s.team.buildings, ...s.team.stash].find((x) => x.id === id);
    const now = [...cur.team.buildings, ...cur.team.stash].find(
      (x) => x.id === id,
    );
    expect(now?.tier).toBe((was?.tier as number) + 1);
  });

  test('the event choice and follow-up are replayable', () => {
    let s = atEvent();
    s = voteAll(s, 'evt_shrine', deps);
    s = step(s, deps);
    const replayed = replayRun(runArgs(), s.actionLog, deps);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state).toEqual(s);
  });

  test('a third event type needs only data plus one handler', () => {
    const tribute: EventHandler = {
      type: 'tribute',
      available: () => true,
      instantiate: (_c, def) => ({ gold: def.params['gold'] ?? 0 }),
      resolve: ({ state }, offer) => ({
        patch: {
          perPlayer: state.perPlayer.map((p) => ({
            ...p,
            gold: p.gold + (offer['gold'] as number),
          })),
        },
        followUp: null,
      }),
    };
    const events = loadEventsOrThrow({
      offerCount: 3,
      events: [
        ...gameConfigs.events.events.map((e) => ({ ...e })),
        {
          id: 'evt_tribute',
          type: 'tribute',
          weight: 50,
          repeatable: false,
          params: { gold: 9 },
        },
      ],
      modifiers: gameConfigs.events.modifiers.map((m) => ({ ...m })),
    });
    const d = createGameDeps(
      content,
      { ...gameConfigs, events },
      {
        battle: scripted(true, true),
        eventHandlers: { ...defaultEventHandlers, tribute },
      },
    );
    let found = false;
    for (let seed = 1; seed <= 12 && !found; seed++) {
      const s = until(
        start(d, ['Ann'], seed),
        d,
        (x) => x.step === 'event_choice',
      );
      const offer = offersOf(s).find((o) => o['id'] === 'evt_tribute');
      if (offer === undefined) continue;
      found = true;
      const before = s.perPlayer[0]?.gold as number;
      const cur = voteAll(s, 'evt_tribute', d);
      expect(cur.step).toBe('shop');
      expect(cur.perPlayer[0]?.gold).toBe(
        before + 9 + gameConfigs.economy.baseIncomePerShop,
      );
    }
    expect(found).toBe(true);
  });

  test('an event type without a handler is rejected when the deps are built', () => {
    const events = loadEventsOrThrow({
      offerCount: 3,
      events: [
        { id: 'evt_odd', type: 'unheard_of', weight: 1, repeatable: false },
      ],
      modifiers: [],
    });
    expect(() => createGameDeps(content, { ...gameConfigs, events })).toThrow(
      /no handler for type "unheard_of"/,
    );
  });
});

describe('real battles', () => {
  const deps = makeGameDeps();

  test('PvE: the voted option fights; the detail is small and has no event log', () => {
    let s = start(deps);
    s = until(s, deps, (x) => x.step === 'pve_summary', {
      difficulty: 'medium',
    });
    const d = detailOf(s);
    expect(d.kind).toBe('pve');
    expect(d.source).toEqual({ type: 'option' });
    expect(d.round).toBe(1);
    expect(JSON.stringify(d).length).toBeLessThan(1500);
    expect('eventLog' in d).toBe(false);
    expect(d.summary.events).toBeGreaterThan(10);
    expect(d.summary.coreMaxHealth[0]).toBeGreaterThan(0);
    expect(s.thisRound.pve?.difficulty).toBe('medium');
    expect(s.thisRound.pve?.opponent.kind).toBe('pve');
  });

  test('PvE replay re-simulates exactly and its hash equals the stored one', () => {
    let s = start(deps);
    s = until(s, deps, (x) => x.step === 'pve_summary');
    const r = replayLastBattle(s, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.battle.sim.tick).toBe(0);
    while (!r.battle.isOver()) r.battle.step();
    expect(hashJson(r.battle.eventLog)).toBe(detailOf(s).summary.eventLogHash);
    expect(r.battle.result()?.endTick).toBe(detailOf(s).summary.endTick);
    expect(verifyLastBattle(s, deps)).toBe(true);
    expect(verifyLastBattle(clone(s), deps)).toBe(true);
  });

  test('PvP (no ghost pool yet): fights a generated boss, which can be replayed', () => {
    let s = start(deps);
    s = until(s, deps, (x) => x.step === 'pvp_summary');
    const d = detailOf(s);
    expect(d.kind).toBe('pvp');
    expect(d.source.type).toBe('generated');
    if (d.source.type === 'generated') {
      expect(d.source.input.type).toBe('boss');
      expect(d.source.input.round).toBe(1);
    }
    expect(s.thisRound.pvp?.opponent.kind).toBe('boss');
    expect(verifyLastBattle(s, deps)).toBe(true);
  });

  test('a replay is only offered in a summary step, and only for an unchanged team', () => {
    const s = start(deps);
    expect(replayLastBattle(s, deps)).toEqual({
      ok: false,
      reason: 'wrong_step',
    });
    const sum = until(s, deps, (x) => x.step === 'pve_summary');
    // The team cannot change between the battle and the end of the summary.
    for (const intent of [
      { type: 'place_building', id: 1, x: 0, y: 0, rotation: 0 },
      { type: 'return_building', id: 1 },
      { type: 'sell', id: 1 },
      { type: 'buy', slot: 0 },
      { type: 'event_choose', choice: 'x' },
    ]) {
      const r = applyIntent(sum, 0, intent, deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('wrong_step');
    }
    const tampered: RunState = {
      ...sum,
      team: { ...sum.team, nextId: sum.team.nextId + 1 },
    };
    expect(replayLastBattle(tampered, deps)).toEqual({
      ok: false,
      reason: 'team_changed',
    });
  });

  test('the ghost seam: findPvpOpponent can supply a team', () => {
    const ghostDeps = makeGameDeps({
      findPvpOpponent: (input) => ({
        label: 'ghost of the test',
        team: input.state.team,
      }),
    });
    let s = start(ghostDeps);
    s = until(s, ghostDeps, (x) => x.step === 'pvp_summary');
    expect(s.thisRound.pvp?.opponent).toEqual({
      kind: 'ghost',
      label: 'ghost of the test',
    });
    expect(detailOf(s).source.type).toBe('ghost');
    expect(verifyLastBattle(s, ghostDeps)).toBe(true);
  });

  test('a Shrine modifier reaches the next battle through team state', () => {
    const fortified = (s0: RunState): RunState => {
      let s = s0;
      s = until(s, deps, (x) => x.step === 'event_choice');
      s = voteAll(s, 'evt_shrine', deps);
      const fu = pending(s)['followUp'] as Record<string, Json>;
      const ids = (fu['options'] as Record<string, Json>[]).map((o) => o['id']);
      if (!ids.includes('mod_fortified_core')) return s0;
      return step(s, deps, { choose: () => 'mod_fortified_core' });
    };
    // Find a seed where the Shrine offers the Core modifier.
    for (let seed = 1; seed <= 40; seed++) {
      const s0 = start(deps, ['Ann'], seed);
      const s = fortified(s0);
      if (s === s0) continue;
      const withMod = until(s, deps, (x) => x.step === 'pvp_summary');
      const base = until(s0, deps, (x) => x.step === 'pvp_summary');
      const a = detailOf(withMod).summary.coreMaxHealth[0];
      const b = detailOf(base).summary.coreMaxHealth[0];
      expect(a).toBe(Math.floor((b * 120) / 100));
      expect(verifyLastBattle(withMod, deps)).toBe(true);
      return;
    }
    throw new Error('no seed offered the Core modifier');
  });
});

describe('a whole run with real battles', () => {
  function play(players: readonly string[], seed: number) {
    const deps = makeGameDeps();
    let s = start(deps, players, seed);
    const initial = s;
    const states: RunState[] = [s];
    let guard = 0;
    let boughtOrKit = totalBuildings(s.team);
    while (s.step !== 'run_over' && guard++ < 300) {
      const before = totalBuildings(s.team);
      const next = step(s, deps, {
        difficulty:
          guard % 3 === 0 ? 'hard' : guard % 3 === 1 ? 'easy' : 'medium',
        event: (x) => {
          const offers = offersOf(x);
          return offers[guard % offers.length]?.['id'] as string;
        },
      });
      // Only the shop adds buildings (and the starting kit, before this loop).
      expect(totalBuildings(next.team)).toBe(before);
      s = next;
      states.push(s);
      boughtOrKit = totalBuildings(s.team);
    }
    expect(boughtOrKit).toBe(totalBuildings(initial.team));
    return { deps, s, states, initial };
  }

  test('solo: reaches the end through applyIntent; replayRun gives the same state', () => {
    const { deps, s } = play(['Ann'], 7);
    expect(s.step).toBe('run_over');
    expect(s.outcome?.reason).toBe('defeated');
    expect(s.lives).toBe(0);
    expect(s.history.length).toBeGreaterThanOrEqual(5);
    const replayed = replayRun(runArgs(['Ann'], 7), s.actionLog, deps);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state).toEqual(s);
  });

  test('two players: every state validates, and replay matches', () => {
    const { deps, s, states } = play(['Ann', 'Bo'], 11);
    for (const st of states) {
      if (st.step === 'run_over') continue;
      const v = validateRunState(clone(st), deps);
      expect(v.ok ? [] : v.errors).toEqual([]);
    }
    const replayed = replayRun(runArgs(['Ann', 'Bo'], 11), s.actionLog, deps);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state).toEqual(s);
  });

  test('PvE losses never cost a life; only PvP losses do', () => {
    const { s, states } = play(['Ann'], 3);
    let livesLostInPvp = 0;
    for (let i = 1; i < states.length; i++) {
      const prev = states[i - 1] as RunState;
      const cur = states[i] as RunState;
      if (cur.lives < prev.lives) {
        expect(prev.step).toBe('pvp_summary');
        livesLostInPvp += prev.lives - cur.lives;
      }
    }
    expect(livesLostInPvp).toBe(5 - s.lives);
  });
});
