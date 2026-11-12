import { describe, expect, test } from 'vitest';
import { soleCore } from '@game/core';
import { createDeps, fixedBattle } from './defaults.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import { allowedIntents, openVote, whoIsReady } from './selectors.js';
import {
  baseDeps,
  corePosition,
  deepFreeze,
  newRun,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from './test-support.js';
import {
  BUILTIN_INTENT_TYPES,
  STEPS,
  type Effect,
  type HandlerContext,
  type HandlerResult,
  type Intent,
  type RunDeps,
  type RunState,
  type Step,
} from './types.js';
import { validateRunState } from './validate.js';

/** The natural next action for every player. */
function autoStep(s: RunState, deps: RunDeps, fx: Effect[] = []): RunState {
  switch (s.step) {
    case 'core_placement':
      return placeCoreAll(s, deps, fx);
    case 'pve_choice':
      return voteAll(s, 'easy', deps, fx);
    case 'event_choice':
      return voteAll(s, 'stub_event_a', deps, fx);
    case 'build':
    case 'shop':
    case 'pve_summary':
    case 'pvp_summary':
      return readyAll(s, deps, fx);
    default:
      throw new Error(`cannot auto-play step ${s.step}`);
  }
}

/**
 * The choice a `vote_resolved` effect reports: it must be the ticket of the
 * `picked` player (or the shared choice if unanimous) among `tickets`.
 */
function pickedBy<T>(fx: readonly Effect[], tickets: readonly T[]): T {
  const e = fx.find((x) => x.type === 'vote_resolved');
  if (e?.type !== 'vote_resolved') throw new Error('no vote_resolved');
  expect(e.tickets).toEqual(tickets);
  const picked = e.picked;
  if (picked === undefined) {
    expect(new Set(tickets.map((t) => JSON.stringify(t))).size).toBe(1);
    return tickets[0] as T;
  }
  expect(picked.random).toBe(true);
  expect(e.choice).toEqual(tickets[picked.player]);
  return tickets[picked.player] as T;
}

const stepsOf = (fx: readonly Effect[]): Step[] =>
  fx.flatMap((e) => (e.type === 'step_changed' ? [e.to] : []));

describe('a solo run', () => {
  test('goes through three rounds in the specified order', () => {
    const deps = createDeps(baseDeps.content, baseDeps.mapgenConfig, {
      battle: fixedBattle(true),
    });
    let s = newRun(deps);
    expect(s.step).toBe('core_placement');
    expect(s.round).toBe(1);
    const fx: Effect[] = [];
    // core_placement, build, then three full rounds, ending in round 4's choice.
    for (let i = 0; i < 2 + 3 * 7; i++) s = autoStep(s, deps, fx);
    const oneRound: Step[] = [
      'pve_battle',
      'pve_summary',
      'event_choice',
      'shop',
      'pvp_battle',
      'pvp_summary',
      'event_choice',
      'shop',
      'pve_choice',
    ];
    const expected: Step[] = [
      'build',
      'pve_choice',
      ...oneRound,
      ...oneRound,
      ...oneRound,
    ];
    expect(stepsOf(fx)).toEqual(expected);
    expect(s.step).toBe('pve_choice');
    expect(s.round).toBe(4);
    expect(s.lives).toBe(5);
    expect(s.history.map((h) => h.round)).toEqual([1, 2, 3]);
    expect(s.history[0]).toMatchObject({
      pve: { difficulty: 'easy', won: true },
      pvp: { won: true, opponent: { kind: 'ghost' } },
    });
  });

  test('the round counter moves when the second shop ends', () => {
    const deps = createDeps(baseDeps.content, baseDeps.mapgenConfig, {
      battle: fixedBattle(true),
    });
    let s = newRun(deps);
    const rounds: number[] = [];
    for (let i = 0; i < 2 + 7; i++) {
      s = autoStep(s, deps);
      rounds.push(s.round);
    }
    // core, build, then pve_choice, pve_summary, event, shop, pvp_summary,
    // event, shop(second, ends round) -> round 2.
    expect(rounds).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2]);
    expect(s.step).toBe('pve_choice');
  });

  test('the stub resolver gives a deterministic run', () => {
    const play = (): RunState => {
      let s = newRun();
      for (let i = 0; i < 2 + 16; i++) {
        s = autoStep(s, baseDeps);
        if (s.step === 'run_over') break;
      }
      return s;
    };
    expect(play()).toEqual(play());
  });
});

describe('lives', () => {
  const lose = createDeps(baseDeps.content, baseDeps.mapgenConfig, {
    battle: fixedBattle(false),
  });

  test('five PvP losses end the run; PvE losses cost nothing', () => {
    let s = newRun(lose);
    s = autoStep(s, lose);
    s = autoStep(s, lose); // core, build -> pve_choice
    const livesAtPvpEnd: number[] = [];
    let guard = 0;
    while (s.step !== 'run_over' && guard++ < 200) {
      const before = s.step;
      s = autoStep(s, lose);
      if (before === 'pve_summary')
        expect(s.lives).toBe(5 - livesAtPvpEnd.length);
      if (before === 'pvp_summary') livesAtPvpEnd.push(s.lives);
    }
    expect(livesAtPvpEnd).toEqual([4, 3, 2, 1, 0]);
    expect(s.step).toBe('run_over');
    expect(s.outcome).toEqual({ reason: 'defeated', round: 5 });
    expect(s.history).toHaveLength(5);
    expect(s.history[4]?.pvp?.won).toBe(false);
    expect(s.history.every((h) => h.pve?.won === false)).toBe(true);
  });

  test('a life is only lost when the PvP summary ends', () => {
    let s = newRun(lose);
    s = autoStep(autoStep(s, lose), lose);
    for (let i = 0; i < 4; i++) s = autoStep(s, lose); // to the PvP summary
    expect(s.step).toBe('pvp_summary');
    expect(s.lives).toBe(5);
    const r = ok(s, 0, { type: 'ready' }, lose);
    expect(r.state.lives).toBe(4);
    expect(r.effects).toContainEqual({ type: 'life_lost', lives: 4 });
  });

  test('rules come from RunRules', () => {
    const harsh = createDeps(baseDeps.content, baseDeps.mapgenConfig, {
      battle: fixedBattle(false),
      rules: { startingLives: 2, pvpLossLifeCost: 2 },
    });
    let s = newRun(harsh);
    expect(s.lives).toBe(2);
    let guard = 0;
    while (s.step !== 'run_over' && guard++ < 50) s = autoStep(s, harsh);
    expect(s.outcome).toEqual({ reason: 'defeated', round: 1 });
  });

  test('the host can abandon; others cannot', () => {
    let s = newRun(baseDeps, ['A', 'B']);
    expect(applyIntent(s, 1, { type: 'abandon' }, baseDeps)).toMatchObject({
      ok: false,
      reason: 'not_host',
    });
    s = ok(s, 0, { type: 'abandon' }).state;
    expect(s.step).toBe('run_over');
    expect(s.outcome).toEqual({ reason: 'abandoned', round: 1 });
    expect(allowedIntents(s, 0)).toEqual([]);
  });
});

describe('wrong_step', () => {
  const none = [] as const;
  const legal: Record<Step, readonly string[]> = {
    core_placement: ['propose_core', 'vote', 'abandon'],
    build: ['ready', 'unready', 'abandon', ...boardNames()],
    pve_choice: ['vote', 'abandon'],
    pve_battle: ['abandon'],
    pve_summary: ['ready', 'unready', 'abandon'],
    event_choice: ['vote', 'abandon'],
    event_resolve: ['abandon'],
    shop: ['ready', 'unready', 'abandon', ...boardNames()],
    pvp_battle: ['abandon'],
    pvp_summary: ['ready', 'unready', 'abandon'],
    run_over: none,
  };
  function boardNames(): string[] {
    return [
      'place_building',
      'move_building',
      'return_building',
      'add_conduit',
      'erase_conduit',
    ];
  }

  // One state per step.
  function stateAt(step: Step): RunState {
    let s = newRun();
    const base = (): RunState => s;
    if (step === 'core_placement') return base();
    s = autoStep(s, baseDeps); // build
    if (step === 'build') return base();
    s = autoStep(s, baseDeps); // pve_choice
    if (step === 'pve_choice') return base();
    s = autoStep(s, baseDeps); // pve_summary
    if (step === 'pve_summary') return base();
    s = autoStep(s, baseDeps); // event_choice
    if (step === 'event_choice') return base();
    s = autoStep(s, baseDeps); // shop
    if (step === 'shop') return base();
    s = autoStep(s, baseDeps); // pvp_summary
    if (step === 'pvp_summary') return base();
    if (step === 'run_over') return ok(s, 0, { type: 'abandon' }).state;
    // Never saved by the machine, but the table must still cover them.
    return { ...s, step };
  }

  const samples: Intent[] = [
    { type: 'propose_core', x: 0, y: 0 },
    { type: 'vote', choice: 'easy' },
    { type: 'ready' },
    { type: 'unready' },
    { type: 'abandon' },
    { type: 'place_building', id: 1, x: 0, y: 0, rotation: 0 },
    { type: 'move_building', id: 1, x: 0, y: 0, rotation: 0 },
    { type: 'return_building', id: 1 },
    {
      type: 'add_conduit',
      from: { building: 1, side: 'north' },
      to: { building: 2, side: 'south' },
      cells: [],
    },
    { type: 'erase_conduit', id: 1 },
  ];

  test('the sample list covers every intent type', () => {
    expect(samples.map((i) => i.type).sort()).toEqual(
      [...BUILTIN_INTENT_TYPES].sort(),
    );
  });

  for (const step of STEPS) {
    test(`step ${step}`, () => {
      const s = deepFreeze(stateAt(step));
      expect(s.step).toBe(step);
      for (const intent of samples) {
        const r = applyIntent(s, 0, intent, baseDeps);
        if (legal[step].includes(intent.type)) {
          if (!r.ok) expect(r.reason).not.toBe('wrong_step');
        } else {
          expect(r).toEqual({ ok: false, reason: 'wrong_step' });
        }
        expect(allowedIntents(s, 0).includes(intent.type)).toBe(
          legal[step].includes(intent.type) &&
            !(intent.type === 'unready' && !s.perPlayer[0]?.ready),
        );
      }
    });
  }

  test('not_a_player', () => {
    const s = newRun();
    for (const p of [-1, 1, 2.5, Number.NaN]) {
      expect(applyIntent(s, p, { type: 'abandon' }, baseDeps)).toEqual({
        ok: false,
        reason: 'not_a_player',
      });
    }
    expect(allowedIntents(s, 3)).toEqual([]);
  });
});

describe('bookkeeping', () => {
  test('accepted intents are logged and counted; rejected ones are not', () => {
    let s = newRun();
    const rejected = applyIntent(s, 0, { type: 'ready' }, baseDeps);
    expect(rejected.ok).toBe(false);
    expect(s.actionCounter).toBe(0);
    const pos = corePosition(s);
    s = ok(s, 0, { type: 'propose_core', ...pos }).state;
    expect(s.actionCounter).toBe(1);
    expect(s.actionLog).toEqual([
      { n: 1, player: 0, intent: { type: 'propose_core', ...pos } },
    ]);
    const bad = applyIntent(s, 0, { type: 'propose_core', ...pos }, baseDeps);
    expect(bad).toEqual({ ok: false, reason: 'wrong_step' });
    expect(s.actionCounter).toBe(1);
    s = ok(s, 0, { type: 'ready' }).state;
    expect(s.actionCounter).toBe(2);
    expect(s.actionLog.map((a) => a.n)).toEqual([1, 2]);
  });

  test('nothing is mutated (deep-frozen inputs)', () => {
    const deps = createDeps(baseDeps.content, baseDeps.mapgenConfig, {
      battle: fixedBattle(false),
    });
    let s = deepFreeze(newRun(deps));
    for (let i = 0; i < 80 && s.step !== 'run_over'; i++) {
      s = deepFreeze(autoStep(s, deps));
    }
    expect(s.step).toBe('run_over');
  });

  test('createRun rejects bad arguments', () => {
    const bad = (a: Partial<ReturnType<typeof runArgs>>) =>
      createRun({ ...runArgs(), ...a }, baseDeps).ok;
    expect(bad({})).toBe(true);
    expect(bad({ players: [] })).toBe(false);
    expect(bad({ players: ['a', 'b', 'c', 'd', 'e'] })).toBe(false);
    expect(bad({ host: 1 })).toBe(false);
    expect(bad({ seed: -1 })).toBe(false);
    expect(bad({ runVersion: 'x' })).toBe(false);
    // The save format's rule: no leading zeros, no patch part.
    for (const v of ['01.2', '1.02', '00.0', '1.2.3', '1', '1.']) {
      expect(bad({ runVersion: v })).toBe(false);
    }
    for (const v of ['0.1', '1.0', '10.20']) {
      expect(bad({ runVersion: v })).toBe(true);
    }
  });

  test('the Core and starting hooks run once the Core is placed', () => {
    let kit = 0;
    const deps = createDeps(baseDeps.content, baseDeps.mapgenConfig, {
      hooks: {
        startingKit: (state) => {
          kit++;
          return {
            perPlayer: state.perPlayer.map((p) => ({ ...p, gold: 10 })),
          };
        },
      },
    });
    const s = placeCoreAll(newRun(deps), deps);
    expect(s.step).toBe('build');
    expect(soleCore(s.team)).not.toBeNull();
    expect(kit).toBe(1);
    expect(s.perPlayer[0]?.gold).toBe(10);
  });
});

describe('state, JSON and replay', () => {
  function play(): RunState[] {
    let s = newRun();
    const out = [s];
    for (let i = 0; i < 2 + 8 * 4; i++) {
      if (s.step === 'run_over') break;
      s = autoStep(s, baseDeps);
      out.push(s);
    }
    return out;
  }

  test('round-trips through JSON and validates at every step', () => {
    for (const s of play()) {
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      const v = validateRunState(JSON.parse(JSON.stringify(s)), baseDeps);
      expect(v).toMatchObject({ ok: true });
    }
  });

  test('replaying the action log reproduces the state', () => {
    const states = play();
    expect(states.length).toBeGreaterThan(20);
    for (const s of states) {
      const r = replayRun(runArgs(), s.actionLog, baseDeps);
      expect(r).toEqual({ ok: true, state: s });
    }
  });

  test('replay reports the failing action', () => {
    const s = play()[3] as RunState;
    const log = [
      ...s.actionLog,
      { n: s.actionLog.length + 1, player: 0, intent: { type: 'abandon' } },
      { n: s.actionLog.length + 2, player: 0, intent: { type: 'ready' } },
    ];
    expect(replayRun(runArgs(), log, baseDeps)).toMatchObject({
      ok: false,
      reason: 'wrong_step',
      at: s.actionLog.length + 2,
    });
  });

  test('a different seed gives a different map and run', () => {
    const a = createRun(runArgs(['A'], 1), baseDeps);
    const b = createRun(runArgs(['A'], 2), baseDeps);
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(JSON.stringify(a.state.team.map)).not.toBe(
      JSON.stringify(b.state.team.map),
    );
    expect(a.state.rng).not.toEqual(b.state.rng);
  });

  test('the run rng advances as streams are drawn', () => {
    const s = newRun();
    const built = autoStep(s, baseDeps);
    expect(built.rng).not.toEqual(s.rng);
  });

  test('validateRunState reports problems and never throws', () => {
    const good = play()[5] as RunState;
    const bad = (mutate: (o: Record<string, unknown>) => void): string[] => {
      const o = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
      mutate(o);
      const v = validateRunState(o, baseDeps);
      return v.ok ? [] : [...v.errors];
    };
    expect(validateRunState(null, baseDeps)).toMatchObject({ ok: false });
    expect(validateRunState(42, baseDeps)).toMatchObject({ ok: false });
    expect(validateRunState({}, baseDeps)).toMatchObject({ ok: false });
    expect(bad((o) => (o['actionCounter'] = 99)).join()).toMatch(
      /actionCounter/,
    );
    expect(bad((o) => (o['perPlayer'] = [])).join()).toMatch(/perPlayer/);
    expect(bad((o) => (o['lives'] = 9)).join()).toMatch(/lives/);
    expect(bad((o) => (o['lives'] = 0)).join()).toMatch(/lives/);
    expect(bad((o) => (o['step'] = 'nope')).join()).toMatch(/step/);
    expect(bad((o) => (o['step'] = 'pve_battle')).join()).toMatch(/transient/);
    expect(
      bad((o) => (o['votes'] = { topic: 'core', choices: [null] })).join(),
    ).toMatch(/votes/);
    expect(
      bad((o) => (o['outcome'] = { reason: 'abandoned', round: 1 })).join(),
    ).toMatch(/outcome/);
    expect(bad((o) => (o['team'] = { nope: 1 })).join()).toMatch(/team/);
    expect(bad((o) => (o['extra'] = 1)).join()).toMatch(/unknown field/);
    expect(bad((o) => (o['pending'] = { x: Number.NaN })).join()).toMatch(
      /pending/,
    );
  });
});

describe('selectors', () => {
  test('whoIsReady, openVote and allowedIntents follow the state', () => {
    let s = newRun(baseDeps, ['A', 'B']);
    expect(openVote(s)).toMatchObject({ topic: 'core', waitingFor: [0, 1] });
    s = placeCoreAll(s);
    expect(openVote(s)).toBeNull();
    expect(whoIsReady(s)).toEqual([]);
    s = ok(s, 1, { type: 'ready' }).state;
    expect(whoIsReady(s)).toEqual([1]);
    expect(allowedIntents(s, 1)).toContain('unready');
    expect(allowedIntents(s, 1)).not.toContain('ready');
    expect(allowedIntents(s, 1)).not.toContain('abandon');
    expect(allowedIntents(s, 0)).toContain('abandon');
    expect(allowedIntents(s, 0)).not.toContain('unready');
    s = readyAll({
      ...s,
      perPlayer: s.perPlayer.map((p) => ({ ...p, ready: false })),
    });
    expect(s.step).toBe('pve_choice');
    const v = openVote(s);
    expect(v?.options).toEqual([
      { id: 'easy' },
      { id: 'medium' },
      { id: 'hard' },
    ]);
  });
});

describe('three players', () => {
  const names = ['A', 'B', 'C'];

  test('ready-up needs all three; un-ready works until the last readies', () => {
    let s = placeCoreAll(newRun(baseDeps, names));
    expect(s.step).toBe('build');
    s = ok(s, 0, { type: 'ready' }).state;
    s = ok(s, 1, { type: 'ready' }).state;
    expect(s.step).toBe('build');
    expect(applyIntent(s, 0, { type: 'ready' }, baseDeps)).toMatchObject({
      reason: 'already_ready',
    });
    s = ok(s, 1, { type: 'unready' }).state;
    expect(whoIsReady(s)).toEqual([0]);
    expect(applyIntent(s, 1, { type: 'unready' }, baseDeps)).toMatchObject({
      reason: 'not_ready',
    });
    s = ok(s, 1, { type: 'ready' }).state;
    s = ok(s, 2, { type: 'ready' }).state;
    expect(s.step).toBe('pve_choice');
    expect(whoIsReady(s)).toEqual([]);
    // Ready flags are reset; the flags a player had are gone, so un-ready fails.
    expect(applyIntent(s, 0, { type: 'unready' }, baseDeps)).toMatchObject({
      ok: false,
    });
  });

  function atPveChoice(): RunState {
    return autoStep(placeCoreAll(newRun(baseDeps, names)), baseDeps);
  }

  test('a 2-1 vote resolves to one of the three votes, picked at random', () => {
    let s = atPveChoice();
    s = ok(s, 0, { type: 'vote', choice: 'hard' }).state;
    s = ok(s, 1, { type: 'vote', choice: 'easy' }).state;
    expect(s.step).toBe('pve_choice');
    const r = ok(s, 2, { type: 'vote', choice: 'easy' });
    expect(r.state.step).toBe('pve_summary');
    expect(pickedBy(r.effects, ['hard', 'easy', 'easy'])).toBe(
      r.state.thisRound.pve?.difficulty,
    );
  });

  test('a 1-1-1 split resolves to one of the three votes, picked at random', () => {
    let s = atPveChoice();
    s = ok(s, 2, { type: 'vote', choice: 'medium' }).state;
    s = ok(s, 1, { type: 'vote', choice: 'easy' }).state;
    const r = ok(s, 0, { type: 'vote', choice: 'hard' });
    expect(pickedBy(r.effects, ['hard', 'easy', 'medium'])).toBe(
      r.state.thisRound.pve?.difficulty,
    );
  });

  test('a changed vote is honoured and the choice waits for the last vote', () => {
    let s = atPveChoice();
    s = ok(s, 0, { type: 'vote', choice: 'hard' }).state;
    s = ok(s, 1, { type: 'vote', choice: 'hard' }).state;
    // Player 1 changes their mind before the last vote.
    s = ok(s, 1, { type: 'vote', choice: 'medium' }).state;
    expect(s.step).toBe('pve_choice');
    expect(openVote(s)?.waitingFor).toEqual([2]);
    // Player 0 follows; the choice still waits for player 2.
    s = ok(s, 0, { type: 'vote', choice: 'medium' }).state;
    expect(s.step).toBe('pve_choice');
    // The last vote makes it unanimous: nothing is drawn.
    const r = ok(s, 2, { type: 'vote', choice: 'medium' });
    expect(r.state.thisRound.pve?.difficulty).toBe('medium');
    expect(r.effects.find((e) => e.type === 'vote_resolved')).toMatchObject({
      choice: 'medium',
      tickets: ['medium', 'medium', 'medium'],
    });
    expect(
      r.effects.find((e) => e.type === 'vote_resolved'),
    ).not.toHaveProperty('picked');
  });

  test('an unknown option is an invalid choice', () => {
    const s = atPveChoice();
    expect(
      applyIntent(s, 0, { type: 'vote', choice: 'nope' }, baseDeps),
    ).toMatchObject({
      ok: false,
      reason: 'invalid_choice',
    });
  });

  test('the Core resolves once all three have voted: one vote picked at random, legal positions only', () => {
    let s = newRun(baseDeps, names);
    const pos = corePosition(s);
    const off = { x: -1, y: -1 };
    expect(
      applyIntent(s, 0, { type: 'propose_core', ...off }, baseDeps),
    ).toMatchObject({
      ok: false,
    });
    s = ok(s, 0, { type: 'propose_core', ...pos }).state;
    s = ok(s, 1, { type: 'vote', choice: pos }).state;
    expect(s.step).toBe('core_placement');
    expect(soleCore(s.team)).toBeNull();
    // A vote for an unproposed position is refused.
    expect(
      applyIntent(s, 2, { type: 'vote', choice: { x: 99, y: 99 } }, baseDeps),
    ).toMatchObject({ ok: false, reason: 'invalid_choice' });
    // Player 2 proposes another spot; as the last vote it resolves 2-1.
    const other = require2(s, pos);
    expect(openVote(s)?.options).toHaveLength(1);
    const r = ok(s, 2, { type: 'propose_core', ...other });
    expect(r.state.step).toBe('build');
    expect(pickedBy(r.effects, [pos, pos, other])).toEqual(
      soleCore(r.state.team),
    );
  });

  test('a vote can change until the last player has voted', () => {
    let s = newRun(baseDeps, names);
    const pos = corePosition(s);
    const other = require2(s, pos);
    s = ok(s, 0, { type: 'propose_core', ...pos }).state;
    s = ok(s, 1, { type: 'propose_core', ...other }).state;
    // Player 0 changes to the other spot; still waiting for player 2.
    s = ok(s, 0, { type: 'vote', choice: other }).state;
    expect(s.step).toBe('core_placement');
    const r = ok(s, 2, { type: 'vote', choice: other });
    // Unanimous: no random pick.
    expect(r.state.step).toBe('build');
    expect(soleCore(r.state.team)).toEqual(other);
    expect(
      r.effects.find((e) => e.type === 'vote_resolved'),
    ).not.toHaveProperty('picked');
    expect(
      validateRunState(JSON.parse(JSON.stringify(r.state)), baseDeps).ok,
    ).toBe(true);
  });

  test('a 1-1 split of two players picks one of the two votes, and replays', () => {
    let s = newRun(baseDeps, ['Ann', 'Bo']);
    const pos = corePosition(s);
    const other = (() => {
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          if (dx === 0 && dy === 0) continue;
          const p = { x: pos.x + dx, y: pos.y + dy };
          if (applyIntent(s, 1, { type: 'propose_core', ...p }, baseDeps).ok) {
            return p;
          }
        }
      }
      throw new Error('no second legal position nearby');
    })();
    s = ok(s, 1, { type: 'propose_core', ...other }).state;
    expect(s.step).toBe('core_placement');
    const r = ok(s, 0, { type: 'propose_core', ...pos });
    s = r.state;
    expect(s.step).toBe('build');
    expect(pickedBy(r.effects, [pos, other])).toEqual(soleCore(s.team));
    const replayed = replayRun(runArgs(['Ann', 'Bo']), s.actionLog, baseDeps);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state).toEqual(s);
    expect(validateRunState(JSON.parse(JSON.stringify(s)), baseDeps).ok).toBe(
      true,
    );
  });

  function require2(s: RunState, not: { x: number; y: number }) {
    // Any other legal position: try neighbours until the machine accepts.
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const p = { x: not.x + dx, y: not.y + dy };
        if (dx === 0 && dy === 0) continue;
        const r = applyIntent(s, 2, { type: 'propose_core', ...p }, baseDeps);
        if (r.ok) return p;
      }
    }
    throw new Error('no second legal position nearby');
  }
});

describe('extension handlers', () => {
  const testBuy = (advance: boolean) => ({
    steps: ['shop', 'build'] as Step[],
    handle: ({ state, player, intent }: HandlerContext): HandlerResult => {
      const cost = typeof intent.cost === 'number' ? intent.cost : 0;
      const me = state.perPlayer[player];
      if (me === undefined || me.gold < cost) {
        return { ok: false, reason: 'not_enough_gold' };
      }
      return {
        ok: true,
        state: {
          ...state,
          perPlayer: state.perPlayer.map((p, i) =>
            i === player ? { ...p, gold: p.gold - cost } : p,
          ),
        },
        effects: [{ type: 'custom', name: 'bought', data: cost }],
        advance,
      };
    },
  });

  const deps = createDeps(baseDeps.content, baseDeps.mapgenConfig, {
    hooks: {
      startingKit: (s) => ({
        perPlayer: s.perPlayer.map((p) => ({ ...p, gold: 5 })),
      }),
    },
    handlers: { test_buy: testBuy(false) },
  });

  test('works in build and shop, is rejected elsewhere', () => {
    let s = newRun(deps);
    expect(
      applyIntent(s, 0, { type: 'test_buy', cost: 1 }, deps),
    ).toMatchObject({
      reason: 'wrong_step',
    });
    s = placeCoreAll(s, deps);
    expect(allowedIntents(s, 0, deps)).toContain('test_buy');
    const r = ok(s, 0, { type: 'test_buy', cost: 2 }, deps);
    expect(r.state.perPlayer[0]?.gold).toBe(3);
    expect(r.state.actionCounter).toBe(r.state.actionLog.length);
    expect(r.effects).toEqual([{ type: 'custom', name: 'bought', data: 2 }]);
    expect(
      applyIntent(r.state, 0, { type: 'test_buy', cost: 9 }, deps),
    ).toEqual({
      ok: false,
      reason: 'not_enough_gold',
    });
    // Replaying the log reproduces the state.
    expect(replayRun(runArgs(), r.state.actionLog, deps)).toEqual({
      ok: true,
      state: r.state,
    });
    // Through to pve_choice and the summary: rejected.
    let t = readyAll(r.state, deps);
    expect(t.step).toBe('pve_choice');
    expect(applyIntent(t, 0, { type: 'test_buy' }, deps)).toMatchObject({
      reason: 'wrong_step',
    });
    t = voteAll(t, 'easy', deps);
    expect(t.step).toBe('pve_summary');
    expect(allowedIntents(t, 0, deps)).not.toContain('test_buy');
    expect(applyIntent(t, 0, { type: 'test_buy' }, deps)).toMatchObject({
      reason: 'wrong_step',
    });
  });

  test('an unregistered type is unknown_intent', () => {
    const s = placeCoreAll(newRun());
    expect(applyIntent(s, 0, { type: 'test_buy' }, baseDeps)).toMatchObject({
      ok: false,
      reason: 'unknown_intent',
    });
    expect(applyIntent(s, 0, { type: 'toString' }, baseDeps)).toMatchObject({
      reason: 'unknown_intent',
    });
  });

  test('a handler can end the step; an event follow-up uses event_resolve', () => {
    const d = createDeps(baseDeps.content, baseDeps.mapgenConfig, {
      hooks: {
        resolveEvent: (_s, offer) => ({ patch: {}, followUp: { for: offer } }),
      },
      handlers: {
        test_buy: testBuy(true),
        test_finish: {
          steps: ['event_resolve'],
          handle: ({ state }) => ({ ok: true, state, advance: true }),
        },
      },
    });
    let s = placeCoreAll(newRun(d), d);
    // advance:true in build completes the build step.
    s = ok(s, 0, { type: 'test_buy' }, d).state;
    expect(s.step).toBe('pve_choice');
    s = voteAll(s, 'easy', d);
    s = readyAll(s, d);
    expect(s.step).toBe('event_choice');
    s = voteAll(s, 'stub_event_b', d);
    expect(s.step).toBe('event_resolve');
    expect(s.pending).toEqual({
      offer: { id: 'stub_event_b' },
      followUp: { for: { id: 'stub_event_b' } },
    });
    expect(applyIntent(s, 0, { type: 'ready' }, d)).toMatchObject({
      reason: 'wrong_step',
    });
    s = ok(s, 0, { type: 'test_finish' }, d).state;
    expect(s.step).toBe('shop');
    expect(validateRunState(JSON.parse(JSON.stringify(s)), d)).toMatchObject({
      ok: true,
    });
  });
});

describe('board edits', () => {
  test('place, move, return and conduit intents delegate to core', () => {
    const deps = createDeps(baseDeps.content, baseDeps.mapgenConfig, {
      hooks: {
        startingKit: (s) => {
          const [id] = [s.team.nextId];
          return {
            team: {
              ...s.team,
              stash: [
                ...s.team.stash,
                { id, def: 'bld_extractor', tier: 1, owner: 0 },
              ],
              nextId: id + 1,
            },
          };
        },
      },
    });
    let s = placeCoreAll(newRun(deps), deps);
    const stashed = s.team.stash[0];
    expect(stashed).toBeDefined();
    const node = s.team.map.nodes[0];
    if (node === undefined || stashed === undefined) throw new Error('setup');
    const place: Intent = {
      type: 'place_building',
      id: stashed.id,
      x: node.x,
      y: node.y,
      rotation: 0,
    };
    // Rejected placements pass the core reason through and change nothing.
    const bad = applyIntent(s, 0, { ...place, x: -5 }, deps);
    expect(bad).toMatchObject({ ok: false });
    expect(s.actionCounter).toBe(placeCoreAllCount(deps));
    s = ok(s, 0, place, deps).state;
    expect(s.team.buildings).toHaveLength(1);
    s = ok(
      s,
      0,
      {
        type: 'move_building',
        id: stashed.id,
        x: node.x,
        y: node.y,
        rotation: 90,
      },
      deps,
    ).state;
    expect(s.team.buildings[0]?.rotation).toBe(90);
    s = ok(s, 0, { type: 'return_building', id: stashed.id }, deps).state;
    expect(s.team.buildings).toHaveLength(0);
    expect(s.team.stash).toHaveLength(1);
    expect(
      applyIntent(s, 0, { type: 'erase_conduit', id: 99 }, deps),
    ).toMatchObject({
      ok: false,
      reason: 'unknown_conduit',
    });
    expect(
      applyIntent(
        s,
        0,
        {
          type: 'place_building',
          id: 'x' as unknown as number,
          x: 0,
          y: 0,
          rotation: 0,
        },
        deps,
      ),
    ).toMatchObject({ reason: 'invalid_intent' });
  });

  function placeCoreAllCount(deps: RunDeps): number {
    return placeCoreAll(newRun(deps), deps).actionCounter;
  }
});
