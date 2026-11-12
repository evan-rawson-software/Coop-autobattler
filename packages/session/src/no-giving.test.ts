import { Rng, loadEconomyOrThrow, type PlacedBuilding } from '@game/core';
import { describe, expect, test } from 'vitest';
import economyJson from '../../../content/economy.json';
import { planLayout } from './bot-layout.js';
import { fixedBattle } from './defaults.js';
import { createEconomyDeps } from './economy.js';
import { applyIntent, createRun } from './machine.js';
import { STEP_INTENTS } from './step-table.js';
import {
  content,
  corePosition,
  mapgenConfig,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from './test-support.js';
import {
  BUILTIN_INTENT_TYPES,
  type Intent,
  type RunDeps,
  type RunState,
  type Step,
} from './types.js';

// CP-29, CP-21i (PP-18): no intent moves gold, a stash entry or a placed
// building between players, and a building's `owner` never changes.
//
// The intent types come from the real lists (`BUILTIN_INTENT_TYPES`,
// `STEP_INTENTS`, `deps.handlers`), so a new intent type fails the coverage
// test below until it gets a case here.

const economy = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
});
const deps: RunDeps = createEconomyDeps(content, mapgenConfig, economy, {
  battle: fixedBattle(true),
});

const STEPS = Object.keys(STEP_INTENTS) as Step[];

/** The first state seen in each step of a 2-player run, played by default. */
function statesByStep(): Map<Step, RunState> {
  const r = createRun(runArgs(['Ann', 'Bo']), deps);
  if (!r.ok) throw new Error(r.detail);
  const seen = new Map<Step, RunState>();
  let s = r.state;
  seen.set(s.step, s);
  for (let i = 0; i < 30; i++) {
    const before = s.step;
    if (s.step === 'core_placement') s = placeCoreAll(s, deps);
    else if (s.step === 'pve_choice' || s.step === 'event_choice')
      s = voteAll(s, firstOption(s), deps);
    else s = readyAll(s, deps);
    if (!seen.has(s.step)) seen.set(s.step, s);
    if (s.step === before || s.step === 'run_over') break;
  }
  // Steps the machine passes through without waiting for input: the table
  // still lists their intents, so test them on a copy of a waiting state.
  const base = seen.get('build') as RunState;
  for (const step of STEPS)
    if (!seen.has(step)) seen.set(step, { ...base, step });
  return seen;
}

function firstOption(s: RunState): string {
  const p = s.pending as { options?: { id: string }[] } | null;
  const id = p?.options?.[0]?.id;
  if (id === undefined) throw new Error(`no options in step ${s.step}`);
  return id;
}

/** What player `p` owns: gold, stash and placed buildings, as plain data. */
function holdings(s: RunState, p: number): string {
  const mine = (b: { owner: number }) => b.owner === p;
  return JSON.stringify({
    gold: s.perPlayer[p]?.gold,
    stash: s.team.stash.filter(mine),
    placed: s.team.buildings.filter(mine),
  });
}

function ownersById(s: RunState): Map<number, number> {
  const m = new Map<number, number>();
  for (const b of s.team.buildings) m.set(b.id, b.owner);
  for (const b of s.team.stash) m.set(b.id, b.owner);
  return m;
}

/**
 * Empty when `after` only changed what `actor` may change; otherwise a
 * description of the violation.
 */
function violations(
  before: RunState,
  after: RunState,
  actor: number,
): string[] {
  const out: string[] = [];
  for (let p = 0; p < before.players.length; p++) {
    if (p !== actor && holdings(before, p) !== holdings(after, p))
      out.push(`player ${String(p)}'s gold, stash or buildings changed`);
  }
  const was = ownersById(before);
  for (const [id, owner] of ownersById(after))
    if (was.has(id) && was.get(id) !== owner)
      out.push(`building ${String(id)} changed owner`);
  return out;
}

/**
 * The actor's own board, laid out by the bot planner: a state in which
 * the actor has placed buildings and conduits, plus the planner's intents
 * (valid `place_building` and `add_conduit` instances, in sending order).
 */
function laidOut(s: RunState, actor: number): { s: RunState; plan: Intent[] } {
  const plan = planLayout(
    s.team,
    actor,
    content,
    s.team.map.plotWidth,
    { connect: true, walls: true, placeLeftovers: true, priority: [] },
    Rng.fromSeed(5),
  );
  let cur = s;
  for (const intent of plan) {
    const r = applyIntent(cur, actor, intent, deps);
    if (r.ok) cur = r.state;
  }
  return { s: cur, plan };
}

type Maker = (s: RunState, actor: number, whose: 'own' | 'foreign') => Intent[];

function owned(
  list: readonly { id: number; owner: number }[],
  actor: number,
  whose: 'own' | 'foreign',
): number[] {
  return list
    .filter((b) => (whose === 'own') === (b.owner === actor))
    .map((b) => b.id);
}

/**
 * Valid instances of each intent type, for the state `s`. Board instances
 * use the laid-out copy of the state, so move, return and erase have
 * something to act on.
 */
const MAKERS: Record<string, Maker> = {
  propose_core: (s) => [{ type: 'propose_core', ...corePosition(s) }],
  vote: (s) =>
    s.step === 'core_placement'
      ? [{ type: 'vote', choice: corePosition(s) }]
      : [{ type: 'vote', choice: firstOption(s) }],
  ready: () => [{ type: 'ready' }],
  unready: () => [{ type: 'unready' }],
  abandon: () => [{ type: 'abandon' }],
  place_building: (s, actor, whose) => {
    const lay = laidOut(s, actor);
    const fromPlan = lay.plan.filter((i) => i.type === 'place_building');
    const stash = owned(s.team.stash, actor, whose);
    return whose === 'own'
      ? fromPlan
      : stash.map((id) => ({
          type: 'place_building',
          id,
          x: 0,
          y: 0,
          rotation: 0,
        }));
  },
  move_building: (s, actor, whose) => {
    const lay = laidOut(s, actor).s;
    const ids = owned(lay.team.buildings, actor, whose);
    const out: Intent[] = [];
    for (const id of ids)
      for (const [x, y] of [
        [0, 0],
        [1, 1],
        [2, 0],
        [0, 2],
        [3, 3],
      ] as const)
        out.push({ type: 'move_building', id, x, y, rotation: 0 });
    return out;
  },
  return_building: (s, actor, whose) =>
    owned(laidOut(s, actor).s.team.buildings, actor, whose).map((id) => ({
      type: 'return_building',
      id,
    })),
  add_conduit: (s, actor) =>
    laidOut(s, actor).plan.filter((i) => i.type === 'add_conduit'),
  erase_conduit: (s, actor) => {
    const lay = laidOut(s, actor).s;
    const mine = new Set(owned(lay.team.buildings, actor, 'own'));
    return lay.team.conduits
      .filter((c) => mine.has(c.from.building) || mine.has(c.to.building))
      .map((c) => ({ type: 'erase_conduit', id: c.id }));
  },
  // Economy handlers (`deps.handlers`).
  buy: () => [0, 1, 2, 3, 4].map((slot) => ({ type: 'buy', slot })),
  sell: (s, actor, whose) =>
    owned(s.team.stash, actor, whose).map((id) => ({ type: 'sell', id })),
  reroll: () => [{ type: 'reroll' }],
};

/** The state a step's intents are tried on, as a board with a laid-out plan. */
/** The state an instance of `type` is valid in. */
function baseFor(
  type: string,
  s: RunState,
  actor: number,
  intent: Intent,
): RunState {
  if (ON_LAID_OUT.has(type)) return laidOut(s, actor).s;
  if (type !== 'add_conduit') return s;
  // A conduit needs the buildings and earlier conduits of the plan first.
  const key = JSON.stringify(intent);
  let cur = s;
  for (const step of laidOut(s, actor).plan) {
    if (JSON.stringify(step) === key) break;
    const r = applyIntent(cur, actor, step, deps);
    if (r.ok) cur = r.state;
  }
  return cur;
}

const ON_LAID_OUT = new Set([
  'move_building',
  'return_building',
  'erase_conduit',
]);
const HANDLER_TYPES = Object.keys(deps.handlers).sort();

describe('no giving (CP-29, CP-21i)', () => {
  const byStep = statesByStep();

  test('every real intent type has a case here', () => {
    const real = [...BUILTIN_INTENT_TYPES, ...HANDLER_TYPES].sort();
    expect(
      Object.keys(MAKERS).sort(),
      'an intent type was added or removed: add or drop its case in MAKERS and check it cannot give gold or buildings',
    ).toEqual(real);
  });

  test('the game reaches every step the table lists', () => {
    for (const step of STEPS) expect(byStep.has(step)).toBe(true);
  });

  const acceptedTypes = new Set<string>();

  for (const step of STEPS) {
    test(`step ${step}: no valid intent from any player affects another player`, () => {
      const s = byStep.get(step) as RunState;
      expect(s.players.length).toBe(2);
      const types = [
        ...STEP_INTENTS[step],
        ...HANDLER_TYPES.filter((t) =>
          (deps.handlers[t]?.steps ?? []).includes(step),
        ),
      ];
      for (const type of types) {
        let tried = 0;
        for (const actor of [0, 1]) {
          for (const intent of (MAKERS[type] as Maker)(s, actor, 'own')) {
            tried++;
            // Move, return and erase need something already on the board.
            const base = baseFor(type, s, actor, intent);
            const r = applyIntent(base, actor, intent, deps);
            if (!r.ok) continue;
            acceptedTypes.add(type);
            expect(
              violations(base, r.state, actor),
              `${type} by player ${String(actor)}: ${JSON.stringify(intent)}`,
            ).toEqual([]);
          }
        }
        expect(tried, `no instance of ${type} in step ${step}`).toBeGreaterThan(
          0,
        );
      }
    });
  }

  test('every intent type was accepted at least once, so its instance was valid', () => {
    const all = [...BUILTIN_INTENT_TYPES, ...HANDLER_TYPES];
    // `unready` is accepted only after `ready`: tried on a Ready player.
    const s = byStep.get('build') as RunState;
    const readied = applyIntent(s, 0, { type: 'ready' }, deps);
    if (!readied.ok) throw new Error('ready rejected');
    expect(applyIntent(readied.state, 0, { type: 'unready' }, deps).ok).toBe(
      true,
    );
    acceptedTypes.add('unready');
    expect(all.filter((t) => !acceptedTypes.has(t))).toEqual([]);
  });

  test('an unknown intent such as a give is rejected and changes nothing', () => {
    const s = byStep.get('shop') as RunState;
    for (const intent of [
      { type: 'give', to: 1, gold: 5 },
      { type: 'transfer', id: 1, to: 1 },
    ] as Intent[]) {
      const r = applyIntent(s, 0, intent, deps);
      expect(r).toMatchObject({ ok: false, reason: 'unknown_intent' });
    }
  });

  // PP-1 (issue #129): the board intents check who owns the building, so a
  // player cannot place, move or return a partner's building.
  test("board intents on another player's buildings change nothing", () => {
    const s = byStep.get('build') as RunState;
    for (const type of ['place_building', 'move_building', 'return_building']) {
      for (const actor of [0, 1]) {
        for (const intent of (MAKERS[type] as Maker)(s, actor, 'foreign')) {
          const r = applyIntent(s, actor, intent, deps);
          if (r.ok) expect(violations(s, r.state, actor)).toEqual([]);
        }
      }
    }
  });

  test('the checker can fail: it flags gold, stash, building and owner changes', () => {
    const s = byStep.get('shop') as RunState;
    const gold = {
      ...s,
      perPlayer: s.perPlayer.map((pp, i) =>
        i === 1 ? { ...pp, gold: pp.gold + 5 } : pp,
      ),
    };
    expect(violations(s, gold, 0)).not.toEqual([]);
    expect(violations(s, gold, 1)).toEqual([]);
    const stash = { ...s, team: { ...s.team, stash: s.team.stash.slice(1) } };
    expect(violations(s, stash, 9)).not.toEqual([]);
    const first: PlacedBuilding | { id: number } | undefined =
      s.team.stash[0] ?? s.team.buildings[0];
    const flip = <T extends { id: number; owner: number }>(b: T): T =>
      b.id === first?.id ? { ...b, owner: 1 - b.owner } : b;
    const flipped = {
      ...s,
      team: {
        ...s.team,
        stash: s.team.stash.map(flip),
        buildings: s.team.buildings.map(flip),
      },
    };
    expect(
      violations(s, flipped, 0).some((v) => v.includes('changed owner')),
    ).toBe(true);
  });
});
