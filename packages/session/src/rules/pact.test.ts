/**
 * Pact (RS-4i6): available from round 4 while some pact is not held; the offer
 * names one pact; voting for it takes it with no follow-up; each pact is held
 * once; the Shrine never offers a pact; 1 to 4 players through save and
 * reload.
 */
import { describe, expect, test } from 'vitest';
import { Rng, heldModifierIds } from '@game/core';
import { fixedBattle } from './defaults.js';
import { eventHooks } from './events.js';
import { createGameDeps } from './game-deps.js';
import { createRun } from './machine.js';
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
const PACTS = gameConfigs.events.modifiers
  .filter((m) => m.pact === true)
  .map((m) => m.id);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Offer = { type: string; id: string; [k: string]: Json | undefined };
const offersAt = (s: RunState, round: number, seed: number): Offer[] =>
  eventHooks(content, gameConfigs.events).eventOffers(
    { ...s, round },
    Rng.fromSeed(seed),
  ) as unknown as Offer[];

function atEvents(players: readonly string[]): RunState {
  const r = createRun(runArgs(players, 7), deps);
  if (!r.ok) throw new Error(r.detail);
  let s = placeCoreAll(r.state, deps);
  for (let i = 0; i < 20 && s.step !== 'event_choice'; i++) {
    s = s.step === 'pve_choice' ? voteAll(s, 'easy', deps) : readyAll(s, deps);
  }
  return s;
}

/** The event step with a Pact of `pact` and a Windfall on offer. */
function pactStep(players: readonly string[], pact: string): RunState {
  const s = atEvents(players);
  const forced: RunState = {
    ...s,
    pending: {
      options: [
        { id: 'evt_pact', event: 'evt_pact', type: 'pact', pact },
        {
          id: 'evt_windfall',
          event: 'evt_windfall',
          type: 'windfall',
          gold: 4,
        },
      ],
    },
  };
  return voteAll(forced, 'evt_pact', deps);
}

const hold = (s: RunState, id: string): RunState => ({
  ...s,
  team: {
    ...s.team,
    modifiers: [
      ...(s.team.modifiers ?? []),
      {
        id,
        effects:
          gameConfigs.events.modifiers.find((m) => m.id === id)?.effects ?? [],
      },
    ],
  },
});

describe('Pact: availability and the offer', () => {
  const s = atEvents(['Ann']);

  test('the definition is from round 4 and the pacts are flagged', () => {
    const d = gameConfigs.events.events.find((e) => e.id === 'evt_pact');
    expect(d).toMatchObject({ type: 'pact', fromRound: 4 });
    expect(PACTS).toEqual([
      'mod_pact_fury',
      'mod_pact_bastion',
      'mod_pact_overcharge',
    ]);
  });

  test('never offered before round 4, offered from round 4', () => {
    const seen = (round: number) =>
      Array.from({ length: 30 }, (_, i) => i + 1).some((seed) =>
        offersAt(s, round, seed).some((o) => o.type === 'pact'),
      );
    for (const r of [1, 2, 3]) expect(seen(r)).toBe(false);
    expect(seen(4)).toBe(true);
  });

  test('the offer names one unheld pact, the same on every draw of a seed', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const o = offersAt(s, 5, seed).find((x) => x.type === 'pact');
      if (o === undefined) continue;
      expect(PACTS).toContain(o['pact']);
      expect(offersAt(s, 5, seed)).toEqual(offersAt(s, 5, seed));
    }
  });

  test('a held pact is never offered; none left means no Pact offer', () => {
    const held = hold(s, 'mod_pact_fury');
    for (let seed = 1; seed <= 60; seed++) {
      for (const o of offersAt(held, 6, seed)) {
        if (o.type === 'pact') expect(o['pact']).not.toBe('mod_pact_fury');
      }
    }
    const all = PACTS.reduce(hold, s);
    for (let seed = 1; seed <= 60; seed++) {
      expect(offersAt(all, 6, seed).some((o) => o.type === 'pact')).toBe(false);
    }
  });

  test('the Shrine never offers a pact', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const o of offersAt(s, 9, seed)) {
        if (o.type !== 'shrine') continue;
        for (const id of o['modifiers'] as string[]) {
          expect(PACTS).not.toContain(id);
        }
      }
    }
  });
});

describe('Pact: taking it', () => {
  test.each([
    ['one player', ['Ann']],
    ['two players', ['Ann', 'Bo']],
    ['three players', ['Ann', 'Bo', 'Cy']],
    ['four players', ['Ann', 'Bo', 'Cy', 'Di']],
  ] as const)('%s: voting takes the pact, no follow-up', (_n, names) => {
    const base = atEvents(names);
    for (const pact of PACTS) {
      const s = pactStep(names, pact);
      // No follow-up: the step is over and the team holds the pact.
      expect(s.step).not.toBe('event_resolve');
      expect(heldModifierIds(s.team)).toContain(pact);
      const def = gameConfigs.events.modifiers.find((m) => m.id === pact);
      expect(s.team.modifiers?.at(-1)?.effects).toEqual(def?.effects);
      expect(s.team.modifiers?.length).toBe(
        (base.team.modifiers?.length ?? 0) + 1,
      );
      // Through save and reload.
      const reloaded = clone(s);
      expect(validateRunState(reloaded, deps).ok).toBe(true);
      expect(reloaded.team).toEqual(s.team);
    }
  });

  test('taking another event leaves the pact free', () => {
    const s = atEvents(['Ann']);
    const forced: RunState = {
      ...s,
      pending: {
        options: [
          {
            id: 'evt_pact',
            event: 'evt_pact',
            type: 'pact',
            pact: 'mod_pact_fury',
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
    const after = voteAll(forced, 'evt_windfall', deps);
    expect(heldModifierIds(after.team)).not.toContain('mod_pact_fury');
  });

  test('a Pact offer whose pact is already held changes nothing', () => {
    const s = hold(atEvents(['Ann']), 'mod_pact_fury');
    const forced: RunState = {
      ...s,
      pending: {
        options: [
          {
            id: 'evt_pact',
            event: 'evt_pact',
            type: 'pact',
            pact: 'mod_pact_fury',
          },
        ],
      },
    };
    const after = voteAll(forced, 'evt_pact', deps);
    expect(
      heldModifierIds(after.team).filter((x) => x === 'mod_pact_fury'),
    ).toHaveLength(1);
  });

  test('a replayed run is the same (deterministic offers)', () => {
    const a = atEvents(['Ann', 'Bo']);
    const b = atEvents(['Ann', 'Bo']);
    expect(a.pending).toEqual(b.pending);
  });
});
