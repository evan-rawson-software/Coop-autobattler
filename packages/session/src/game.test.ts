import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  generateThreat,
  hashJson,
  loadEventsOrThrow,
  pickWeightedIndex,
  Rng,
  withModifier,
  type TeamState,
} from '@game/core';
import { fixedBattle } from './defaults.js';
import {
  checkEventHandlers,
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

function optionsOf(list: readonly Json[], partySize = 1): PveOption[] {
  return list.map((o) => {
    const opt = readPveOption(o, partySize);
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
      // A per-player follow-up (Workshop): everyone skips unless told.
      const id =
        policy.choose?.(s) ??
        (fu['perPlayer'] === true ? 'skip' : (first?.['id'] as string));
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
        const options = optionsOf(s.upcomingPve?.options ?? [], players.length);
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

  test('readPveOption refuses an option whose Cores do not match the party size', () => {
    const s = start(deps);
    const raw = s.upcomingPve?.options ?? [];
    expect(raw.length).toBe(3);
    expect(optionsOf(raw)).toHaveLength(3);
    for (const o of raw) {
      expect(readPveOption(o, 2)).toBeNull();
      const t = clone(o) as unknown as {
        threat: { stronghold: { cores: unknown } };
      };
      t.threat.stronghold.cores = [];
      expect(readPveOption(t, 1)).toBeNull();
      t.threat.stronghold.cores = 'x';
      expect(readPveOption(t, 1)).toBeNull();
      delete (t.threat as { stronghold?: unknown }).stronghold;
      expect(readPveOption(t, 1)).toBeNull();
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

  test('the round record keeps the gold actually paid for the PvE battle', () => {
    for (const [won, d, want] of [
      [true, 'easy', rewards.pveWin.easy],
      [true, 'hard', rewards.pveWin.hard],
      [false, 'medium', 0],
    ] as const) {
      const deps = fixedDeps(won, true);
      let s = start(deps);
      s = until(s, deps, (x) => x.step === 'pve_summary', { difficulty: d });
      expect(s.thisRound.pve?.goldPaid).toBeUndefined();
      s = readyAll(s, deps);
      expect(s.thisRound.pve?.goldPaid).toBe(want);
      expect(validateRunState(JSON.parse(JSON.stringify(s)), deps).ok).toBe(
        true,
      );
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
    ).toEqual([rewards.pveWin.easy, rewards.pveWin.easy, rewards.pveWin.easy]);
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
      expect(offers.map((o) => o['type']).sort()).toEqual([
        'shrine',
        'windfall',
      ]);
    }
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

  test('the Shrine follow-up is a party vote: partial votes wait, a split picks one vote at random', () => {
    const s = atEvent(deps, ['Ann', 'Bo']);
    let cur = voteAll(s, 'evt_shrine', deps);
    const fu = pending(cur)['followUp'] as Record<string, Json>;
    expect(fu['perPlayer']).toBeUndefined();
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
    const last = ok(cur, 0, { type: 'event_choose', choice: a }, deps);
    cur = last.state;
    expect(cur.step).toBe('shop');
    // Player 0 chose a, player 1 chose b: one of the two votes was picked.
    const resolved = last.effects.find((e) => e.type === 'vote_resolved');
    expect(resolved).toMatchObject({ topic: 'event', tickets: [a, b] });
    const winner = resolved?.type === 'vote_resolved' ? resolved.choice : null;
    expect([a, b]).toContain(winner);
    expect(cur.team.modifiers?.map((m) => m.id)).toEqual([winner]);
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
      events: [{ id: 'evt_odd', type: 'unheard_of', weight: 1 }],
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

  test('the ghost seam: a ghost team that differs from the party brings its own modifiers', () => {
    const ghostDeps = makeGameDeps({
      findPvpOpponent: (input) => ({
        label: 'ghost of the test',
        // Not the party's team: its modifiers are its own, not the party's.
        team: withModifier(
          { ...input.state.team, modifiers: [] },
          {
            id: 'mod_ghost_core',
            effects: [{ kind: 'core_health_percent', percent: 50 }],
          },
        ),
      }),
    });
    let s = start(ghostDeps);
    s = until(s, ghostDeps, (x) => x.step === 'pvp_summary');
    expect(s.thisRound.pvp?.opponent).toEqual({
      kind: 'ghost',
      label: 'ghost of the test',
    });
    // The party holds no Core-health modifier of its own.
    expect(
      (s.team.modifiers ?? []).some((m) =>
        m.effects.some((e) => e.kind === 'core_health_percent'),
      ),
    ).toBe(false);
    const d = detailOf(s);
    expect(d.source.type).toBe('ghost');
    if (d.source.type === 'ghost') {
      expect(d.source.team).not.toEqual(s.team);
    }
    // The ghost's modifier applies to side 1; the party has none.
    const [mine, theirs] = d.summary.coreMaxHealth;
    expect(theirs).toBe(Math.floor((mine * 150) / 100));
    expect(verifyLastBattle(s, ghostDeps)).toBe(true);
  });

  test('a generated PvP threat is stored, and replay uses the stored profile', () => {
    let s = start(deps);
    s = until(s, deps, (x) => x.step === 'pvp_summary');
    const d = detailOf(s);
    expect(d.source.type).toBe('generated');
    if (d.source.type !== 'generated') return;
    expect(d.source.threat.round).toBe(1);
    expect(d.source.threat.archetype).toBe(d.source.input.archetype);
    // Same threat content: it is what generateThreat gives for the input.
    expect(d.source.threat).toEqual(
      generateThreat(d.source.input, content, {
        threats: gameConfigs.threats,
        mapgen: gameConfigs.mapgen,
      }),
    );
    // Content changes later in the run: the replay must not follow them.
    const changed = {
      ...gameConfigs,
      threats: {
        ...gameConfigs.threats,
        baseBudget: gameConfigs.threats.baseBudget * 3,
      },
    };
    const regenerated = generateThreat(d.source.input, content, {
      threats: changed.threats,
      mapgen: changed.mapgen,
    });
    expect(hashJson(regenerated)).not.toBe(hashJson(d.source.threat));
    const changedDeps = makeGameDeps({}, changed);
    expect(verifyLastBattle(s, changedDeps)).toBe(true);
    expect(verifyLastBattle(clone(s), changedDeps)).toBe(true);
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
      const v = validateRunState(clone(st), deps);
      expect(v.ok ? [] : v.errors).toEqual([]);
    }
    const replayed = replayRun(runArgs(['Ann', 'Bo'], 11), s.actionLog, deps);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state).toEqual(s);
  });

  test('abandoning from any state of the run leaves a state that validates', () => {
    const { deps, states } = play(['Ann', 'Bo'], 11);
    let abandoned = 0;
    for (const st of states) {
      if (st.step === 'run_over') continue;
      const r = applyIntent(st, 0, { type: 'abandon' }, deps);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      abandoned += 1;
      expect(r.state.step).toBe('run_over');
      expect(r.state.upcomingPve).toBeNull();
      const v = validateRunState(clone(r.state), deps);
      expect(v.ok ? [] : v.errors).toEqual([]);
    }
    expect(abandoned).toBeGreaterThan(30);
  });

  test('four players, one Core each: the first battle is fought and a lost PvP battle costs exactly one life', () => {
    const { deps, s, states } = play(['A', 'B', 'C', 'D'], 5);
    expect(states[0]?.team.cores.filter((c) => c !== null)).toHaveLength(4);
    const fought = states.filter((x) => x.step === 'pve_summary');
    expect(fought.length).toBeGreaterThan(0);
    let lost = 0;
    for (let i = 1; i < states.length; i++) {
      const prev = states[i - 1] as RunState;
      const cur = states[i] as RunState;
      if (cur.lives < prev.lives) {
        expect(prev.step).toBe('pvp_summary');
        expect(cur.lives).toBe(prev.lives - 1);
        lost += 1;
      }
    }
    expect(lost).toBeGreaterThan(0);
    expect(s.lives).toBe(5 - lost);
    expect(s.team.cores.every((c) => c !== null)).toBe(true);
    const replayed = replayRun(
      runArgs(['A', 'B', 'C', 'D'], 5),
      s.actionLog,
      deps,
    );
    expect(replayed.ok && replayed.state).toEqual(s);
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

// ---------------------------------------------------------------------------
// Review findings

describe('abandoning a run', () => {
  const deps = fixedDeps(true, true);

  test('in the first build step, while the PvE options are stored', () => {
    const s = start(deps);
    expect(s.step).toBe('build');
    expect(s.upcomingPve).not.toBeNull();
    const r = ok(s, 0, { type: 'abandon' }, deps).state;
    expect(r.step).toBe('run_over');
    expect(r.outcome).toEqual({ reason: 'abandoned', round: 1 });
    expect(r.upcomingPve).toBeNull();
    const v = validateRunState(clone(r), deps);
    expect(v.ok ? [] : v.errors).toEqual([]);
  });

  test('in the shop that ends a round, while the next options are stored', () => {
    const s = until(
      start(deps),
      deps,
      (x) => x.step === 'shop' && x.leg === 'pvp',
    );
    expect(s.upcomingPve).not.toBeNull();
    const r = ok(s, 0, { type: 'abandon' }, deps).state;
    expect(r.step).toBe('run_over');
    expect(r.upcomingPve).toBeNull();
    expect(r.pending).toBeNull();
    const v = validateRunState(clone(r), deps);
    expect(v.ok ? [] : v.errors).toEqual([]);
  });
});

describe('the upcomingPve invariant (validateRunState)', () => {
  const deps = fixedDeps(true, true);
  const check = (s: RunState) => validateRunState(clone(s), deps);
  const errorsOf = (s: RunState): string =>
    (() => {
      const r = check(s);
      return r.ok ? '' : r.errors.join('\n');
    })();

  test('is set exactly in the first build and the round-ending shop', () => {
    const build = start(deps);
    const pveShop = until(
      build,
      deps,
      (x) => x.step === 'shop' && x.leg === 'pve',
    );
    const pvpShop = until(
      build,
      deps,
      (x) => x.step === 'shop' && x.leg === 'pvp',
    );
    const eventPve = until(build, deps, (x) => x.step === 'event_choice');
    const summary = until(build, deps, (x) => x.step === 'pvp_summary');
    const choice = until(build, deps, (x) => x.step === 'pve_choice');
    const stored = pvpShop.upcomingPve;
    for (const s of [build, pvpShop]) expect(check(s).ok).toBe(true);
    for (const s of [pveShop, eventPve, summary, choice]) {
      expect(s.upcomingPve).toBeNull();
      expect(check(s).ok).toBe(true);
    }
    // Missing where it is required.
    expect(errorsOf({ ...build, upcomingPve: null })).toMatch(
      /upcomingPve: must be set/,
    );
    expect(errorsOf({ ...pvpShop, upcomingPve: null })).toMatch(
      /upcomingPve: must be set/,
    );
    // Present where it must be null.
    for (const s of [pveShop, eventPve, summary, choice]) {
      expect(errorsOf({ ...s, upcomingPve: stored })).toMatch(
        /upcomingPve: must be null/,
      );
    }
    // A pve-leg event step, a pvp-leg event step and the pvp-leg shop differ.
    const eventPvp = until(
      build,
      deps,
      (x) => x.step === 'event_choice' && x.leg === 'pvp',
    );
    expect(errorsOf({ ...eventPvp, upcomingPve: stored })).toMatch(
      /must be null/,
    );
    // Wrong round.
    expect(
      errorsOf({
        ...pvpShop,
        upcomingPve: { round: 1, options: stored?.options ?? [] },
      }),
    ).toMatch(/round does not match/);
  });
});

describe('the run-state format version', () => {
  const deps = fixedDeps(true, true);

  test('a new run has version 8; version 1 and other versions are rejected clearly', () => {
    const s = start(deps);
    expect(s.formatVersion).toBe(9);
    expect(validateRunState(clone(s), deps).ok).toBe(true);
    // A version-1 state: the old version, and no upcomingPve field.
    const old = clone(s) as unknown as Record<string, unknown>;
    old['formatVersion'] = 1;
    delete old['upcomingPve'];
    const r = validateRunState(old, deps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/unsupported format version 1/);
    for (const v of [2, 3, 4, 5, 6, 7, '8', null, 0]) {
      const o = clone(s) as unknown as Record<string, unknown>;
      o['formatVersion'] = v;
      const x = validateRunState(o, deps);
      expect(x.ok ? [] : x.errors.join()).toMatch(/unsupported format version/);
    }
  });
});

describe('event offers: one per type, up to three (issue #48)', () => {
  const deps = fixedDeps(true, true);
  const hooks = eventHooks(content, gameConfigs.events);
  const atEvent = until(start(deps), deps, (x) => x.step === 'event_choice');
  const tier3 = (s: RunState): RunState => ({
    ...s,
    team: {
      ...s.team,
      buildings: s.team.buildings.map((b) => ({ ...b, tier: 3 })),
      stash: s.team.stash.map((b) => ({ ...b, tier: 3 })),
    },
  });
  const holding = (s: RunState, ids: readonly string[]): RunState => ({
    ...s,
    team: {
      ...s.team,
      modifiers: gameConfigs.events.modifiers
        .filter((m) => ids.includes(m.id))
        .map((m) => ({ id: m.id, effects: m.effects })),
    },
  });
  const offersFor = (s: RunState, seed: number) =>
    hooks.eventOffers(s, Rng.fromSeed(seed)) as Record<string, Json>[];

  test('Workshop unavailable and only three modifiers eligible: a Shrine and the Windfall', () => {
    // Five modifiers; two non-stackable ones held leaves three.
    const state = holding(tier3(atEvent), [
      'mod_stout_walls',
      'mod_sharp_turrets',
    ]);
    const eligible = [
      'mod_fortified_core',
      'mod_drilled_troops',
      'mod_reinforced_frames',
    ];
    for (let seed = 1; seed <= 300; seed++) {
      const offers = offersFor(state, seed);
      expect(offers.map((o) => o['type']).sort()).toEqual([
        'shrine',
        'windfall',
      ]);
      const shrine = offers.find((o) => o['type'] === 'shrine');
      expect(shrine?.['modifiers']).toEqual(eligible);
    }
  });

  test('exactly one weighted draw per offer happens, none wasted', () => {
    const state = holding(tier3(atEvent), [
      'mod_stout_walls',
      'mod_sharp_turrets',
    ]);
    for (let seed = 1; seed <= 50; seed++) {
      const rng = Rng.fromSeed(seed);
      hooks.eventOffers(state, rng);
      // Reference: the two weighted picks of the first pass (shrine 10,
      // windfall 6, in file order), then nothing.
      const ref = Rng.fromSeed(seed);
      const first = pickWeightedIndex(ref, [10, 6]);
      pickWeightedIndex(ref, [first === 0 ? 6 : 10]);
      expect(rng.getState()).toEqual(ref.getState());
    }
  });

  test('three types available: three offers, never two of one type', () => {
    // Even with a fourth eligible modifier, there is no second Shrine.
    for (const state of [
      atEvent,
      holding(atEvent, ['mod_stout_walls']),
      holding(atEvent, ['mod_stout_walls', 'mod_sharp_turrets']),
    ]) {
      for (let seed = 1; seed <= 100; seed++) {
        const offers = offersFor(state, seed);
        expect(offers.map((o) => o['type']).sort()).toEqual([
          'shrine',
          'windfall',
          'workshop',
        ]);
        expect(offers.map((o) => o['id'])).toEqual(
          offers.map((o) => o['event']),
        );
      }
    }
  });

  test('two types available (no modifier can be taken): two offers', () => {
    const noMods = eventHooks(
      content,
      loadEventsOrThrow({
        offerCount: 3,
        events: gameConfigs.events.events.map((e) => ({ ...e })),
        modifiers: [],
      }),
    );
    for (let seed = 1; seed <= 100; seed++) {
      const offers = noMods.eventOffers(atEvent, Rng.fromSeed(seed)) as Record<
        string,
        Json
      >[];
      expect(offers.map((o) => o['type']).sort()).toEqual([
        'windfall',
        'workshop',
      ]);
    }
  });

  test('a run with two offers replays to the same state', () => {
    const events = loadEventsOrThrow({
      offerCount: 3,
      events: gameConfigs.events.events.map((e) => ({ ...e })),
      modifiers: [],
    });
    const d = makeGameDeps(
      { battle: scripted(true, true) },
      { ...gameConfigs, events },
    );
    let s = until(start(d, ['Ann', 'Bo']), d, (x) => x.step === 'event_choice');
    expect(offersOf(s)).toHaveLength(2);
    s = voteAll(s, 'evt_windfall', d);
    s = until(s, d, (x) => x.step === 'event_choice');
    s = voteAll(s, 'evt_workshop', d);
    s = step(s, d);
    const replayed = replayRun(runArgs(['Ann', 'Bo']), s.actionLog, d);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state).toEqual(s);
  });

  test('a Shrine with fewer than three eligible modifiers offers what is left; with none it is not offered', () => {
    const state = tier3(atEvent);
    const stackable = gameConfigs.events.modifiers
      .filter((m) => m.stackable)
      .map((m) => m.id);
    const nonStackable = gameConfigs.events.modifiers
      .filter((m) => !m.stackable)
      .map((m) => m.id);
    // Three non-stackable held: one non-stackable and the stackable one left.
    const two = holding(state, nonStackable.slice(0, 3));
    const left = [nonStackable[3] as string, ...stackable];
    for (let seed = 1; seed <= 50; seed++) {
      const shrine = offersFor(two, seed).find((o) => o['type'] === 'shrine');
      expect([...(shrine?.['modifiers'] as string[])].sort()).toEqual(
        [...left].sort(),
      );
    }
    // No modifier can be taken at all: configuration with no modifiers.
    const none = loadEventsOrThrow({
      offerCount: 3,
      events: gameConfigs.events.events.map((e) => ({ ...e })),
      modifiers: [],
    });
    const noneHooks = eventHooks(content, none);
    for (let seed = 1; seed <= 50; seed++) {
      const offers = noneHooks.eventOffers(
        tier3(atEvent),
        Rng.fromSeed(seed),
      ) as Record<string, Json>[];
      expect(offers.map((o) => o['type'])).toEqual(['windfall']);
    }
  });

  describe('several definitions of one type', () => {
    const twoWindfalls = loadEventsOrThrow({
      offerCount: 3,
      events: [
        ...gameConfigs.events.events.map((e) => ({ ...e })),
        {
          id: 'evt_windfall_big',
          type: 'windfall',
          weight: 3,
          params: { gold: 9 },
        },
      ],
      modifiers: gameConfigs.events.modifiers.map((m) => ({ ...m })),
    });
    const twoHooks = eventHooks(content, twoWindfalls);

    test('never both are offered, each can appear, one draw per offer', () => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 300; seed++) {
        const rng = Rng.fromSeed(seed);
        const offers = twoHooks.eventOffers(atEvent, rng) as Record<
          string,
          Json
        >[];
        const types = offers.map((o) => o['type']);
        expect(new Set(types).size).toBe(types.length);
        for (const o of offers) {
          if (o['type'] === 'windfall') seen.add(o['id'] as string);
        }
        // RNG use: exactly one draw per offer made.
        const probe = Rng.fromSeed(seed);
        for (let k = 0; k < offers.length; k++) probe.nextU32();
        expect(rng.getState()).toEqual(probe.getState());
      }
      expect([...seen].sort()).toEqual(['evt_windfall', 'evt_windfall_big']);
    });

    test('with only the two Windfalls, exactly one offer', () => {
      const only = eventHooks(
        content,
        loadEventsOrThrow({
          offerCount: 3,
          events: twoWindfalls.events
            .filter((e) => e.type === 'windfall')
            .map((e) => ({ ...e })),
          modifiers: [],
        }),
      );
      for (let seed = 1; seed <= 50; seed++) {
        expect(only.eventOffers(atEvent, Rng.fromSeed(seed))).toHaveLength(1);
      }
    });

    test('a full run with both definitions replays to the same state', () => {
      for (const players of [['Ann'], ['Ann', 'Bo', 'Cy']]) {
        const d = makeGameDeps(
          { battle: scripted(true, true) },
          { ...gameConfigs, events: twoWindfalls },
        );
        const s0 = start(d, players);
        const s = until(s0, d, (x) => x.step === 'event_choice');
        const offers = offersOf(s);
        expect(
          offers.filter((o) => o['type'] === 'windfall').length,
        ).toBeLessThanOrEqual(1);
        const cur = voteAll(s, offers[0]?.['id'] as string, d);
        const r = replayRun(runArgs(players, 7), cur.actionLog, d);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.state).toEqual(cur);
      }
    });
  });

  test('one offer is enough for the machine: vote, shop, validate', () => {
    const none = loadEventsOrThrow({
      offerCount: 3,
      events: [
        {
          id: 'evt_windfall',
          type: 'windfall',
          weight: 1,
          params: { gold: 4 },
        },
      ],
      modifiers: [],
    });
    const d = makeGameDeps(
      { battle: scripted(true, true) },
      { ...gameConfigs, events: none },
    );
    const s = until(
      start(d, ['Ann', 'Bo']),
      d,
      (x) => x.step === 'event_choice',
    );
    expect(offersOf(s)).toHaveLength(1);
    expect(validateRunState(clone(s), d).ok).toBe(true);
    const cur = voteAll(s, 'evt_windfall', d);
    expect(cur.step).toBe('shop');
    // The validator rejects an event step with no offer at all.
    const empty: RunState = { ...s, pending: { options: [] } };
    expect(validateRunState(clone(empty), d).ok).toBe(false);
  });

  test('wiring needs an always-available event so there is at least one offer', () => {
    const events = loadEventsOrThrow({
      offerCount: 3,
      events: [
        {
          id: 'evt_workshop',
          type: 'workshop',
          weight: 1,
          params: {},
        },
      ],
      modifiers: [],
    });
    expect(() => createGameDeps(content, { ...gameConfigs, events })).toThrow(
      /always available/,
    );
    const hooksOnly = eventHooks(content, events);
    expect(() =>
      hooksOnly.eventOffers(tier3(atEvent), Rng.fromSeed(1)),
    ).toThrow(/no event could be offered/);
  });
});

describe('event follow-ups', () => {
  const base = (options: readonly Json[]): EventHandler => ({
    type: 'oracle',
    available: () => true,
    instantiate: () => ({}),
    resolve: () => ({
      patch: {},
      followUp: { prompt: 'oracle', options },
    }),
  });
  const oracle = (options: readonly Json[]): EventHandler => ({
    ...base(options),
    canAskFollowUp: true,
    choose: () => ({ ok: true, patch: {} }),
  });
  const events = loadEventsOrThrow({
    offerCount: 3,
    events: [
      {
        id: 'evt_windfall',
        type: 'windfall',
        weight: 1,
        params: { gold: 4 },
      },
      {
        id: 'evt_oracle',
        type: 'oracle',
        weight: 50,
        params: {},
      },
    ],
    modifiers: [],
  });
  const depsWith = (handler: EventHandler): RunDeps =>
    createGameDeps(
      content,
      { ...gameConfigs, events },
      {
        battle: scripted(true, true),
        eventHandlers: { ...defaultEventHandlers, oracle: handler },
      },
    );
  const atEvent = (d: RunDeps) =>
    until(start(d), d, (x) => x.step === 'event_choice');

  test('a follow-up with no options goes straight to the shop', () => {
    const d = depsWith(oracle([]));
    const cur = voteAll(atEvent(d), 'evt_oracle', d);
    expect(cur.step).toBe('shop');
    expect(allowedIntents(cur, 0, d)).toContain('ready');
    expect(validateRunState(clone(cur), d).ok).toBe(true);
  });

  test('a follow-up with options is asked', () => {
    const d = depsWith(oracle([{ id: 'a' }, { id: 'b' }]));
    let cur = voteAll(atEvent(d), 'evt_oracle', d);
    expect(cur.step).toBe('event_resolve');
    cur = ok(cur, 0, { type: 'event_choose', choice: 'b' }, d).state;
    expect(cur.step).toBe('shop');
  });

  test('wiring rejects a handler that can ask for a follow-up but cannot apply one', () => {
    const noChoose: EventHandler = {
      ...base([{ id: 'a' }]),
      canAskFollowUp: true,
    };
    expect(() => depsWith(noChoose)).toThrow(/follow-up but has no "choose"/);
    // The shipped handlers declare it and have it.
    for (const t of ['workshop', 'shrine'] as const) {
      expect(defaultEventHandlers[t]?.canAskFollowUp).toBe(true);
    }
    expect(typeof defaultEventHandlers['shrine']?.choose).toBe('function');
    expect(typeof defaultEventHandlers['workshop']?.chooseEach).toBe(
      'function',
    );
    expect(
      checkEventHandlers(gameConfigs.events, defaultEventHandlers),
    ).toEqual([]);
  });

  test('a handler that returns a follow-up without declaring it is an error when it happens', () => {
    const undeclared: EventHandler = {
      ...base([{ id: 'a' }]),
      choose: () => ({ ok: true, patch: {} }),
    };
    const d = depsWith(undeclared);
    expect(() => voteAll(atEvent(d), 'evt_oracle', d)).toThrow(
      /does not declare canAskFollowUp/,
    );
  });
});

describe('a Shrine modifier changes the outcome of a real battle', () => {
  // A modifier far stronger than the shipped ones, so that the party's thin
  // board (it never wins without help) wins a battle it would have lost. The
  // seed was found by searching seeds 1 to 40 at test-writing time: at this
  // seed the Shrine offers it and the second PvE battle flips from a loss to
  // a win.
  const SEED = 8;
  const events = loadEventsOrThrow({
    offerCount: 3,
    events: gameConfigs.events.events.map((e) => ({ ...e })),
    modifiers: [
      ...gameConfigs.events.modifiers.map((m) => ({ ...m })),
      {
        id: 'mod_titan',
        stackable: false,
        effects: [
          { kind: 'core_health_percent', percent: 1000 },
          { kind: 'turret_damage_percent', percent: 1000 },
          { kind: 'unit_strength_percent', percent: 1000 },
        ],
      },
    ],
  });
  const deps = makeGameDeps({}, { ...gameConfigs, events });

  /** Place every stash building on the free cells nearest the Core. */
  function layout(s0: RunState): RunState {
    let s = s0;
    const core = s.team.cores[0] ?? null;
    if (core === null) throw new Error('no core');
    const cells: { x: number; y: number }[] = [];
    for (let x = 0; x < s.team.map.width; x++) {
      for (let y = 0; y < s.team.map.height; y++) cells.push({ x, y });
    }
    const dist = (c: { x: number; y: number }) =>
      Math.abs(c.x - core.x) + Math.abs(c.y - core.y);
    cells.sort((a, b) => dist(a) - dist(b) || a.x - b.x || a.y - b.y);
    const order = ['bld_turret', 'bld_barracks', 'bld_wall', 'bld_extractor'];
    const stash = [...s.team.stash].sort(
      (a, b) => order.indexOf(a.def) - order.indexOf(b.def),
    );
    for (const b of stash) {
      for (const c of cells) {
        let placed = false;
        for (const rotation of [0, 90, 180, 270]) {
          const r = applyIntent(
            s,
            0,
            { type: 'place_building', id: b.id, x: c.x, y: c.y, rotation },
            deps,
          );
          if (r.ok) {
            s = r.state;
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
    return s;
  }

  /** Winners of the first four battles; the Shrine (or a Windfall) is the first event. */
  function winners(takeTitan: boolean): {
    pve1: boolean;
    pvp1: boolean;
    pve2: boolean;
    shrineOffer: boolean;
  } {
    let s = layout(start(deps, ['Ann'], SEED));
    expect(s.team.stash).toHaveLength(0);
    const won: boolean[] = [];
    let shrineOffer = false;
    for (let i = 0; i < 60 && won.length < 3; i++) {
      if (s.step === 'pve_summary' || s.step === 'pvp_summary') {
        won.push(detailOf(s).summary.winner === 0);
      }
      s = step(s, deps, {
        difficulty: 'easy',
        event: (x) => {
          const offers = offersOf(x);
          const shrine = offers.find((o) => o['type'] === 'shrine');
          const first = x.round === 1 && x.leg === 'pve';
          if (first && shrine !== undefined) {
            shrineOffer = (shrine['modifiers'] as string[]).includes(
              'mod_titan',
            );
          }
          return (
            takeTitan && first && shrine !== undefined
              ? shrine['id']
              : offers.find((o) => o['type'] === 'windfall')?.['id']
          ) as string;
        },
        choose: () => 'mod_titan',
      });
    }
    expect(won).toHaveLength(3);
    return {
      pve1: won[0] as boolean,
      pvp1: won[1] as boolean,
      pve2: won[2] as boolean,
      shrineOffer,
    };
  }

  test('taking the modifier flips a battle the same run loses without it', () => {
    const without = winners(false);
    const withIt = winners(true);
    expect(withIt.shrineOffer).toBe(true);
    // Before the Shrine: identical.
    expect(withIt.pve1).toBe(without.pve1);
    // After it: the run without it loses the second PvE battle, the run with it wins.
    expect(without.pve2).toBe(false);
    expect(withIt.pve2).toBe(true);
  });
});
