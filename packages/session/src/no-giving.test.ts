import type { PlacedBuilding } from '@game/core';
import { describe, expect, test } from 'vitest';
import { fixedBattle } from './defaults.js';
import { createEconomyDeps, readShop } from './economy.js';
import { applyIntent, createRun } from './machine.js';
import { allowedIntents } from './selectors.js';
import {
  content,
  mapgenConfig,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from './test-support.js';
import { loadEconomyOrThrow } from '@game/core';
import economyJson from '../../../content/economy.json';
import type { Intent, RunDeps, RunState } from './types.js';

// CP-29, CP-21i (PP-18): no intent moves gold, a stash entry or a placed
// building between players, and a building's `owner` never changes.

const economy = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
});
const deps: RunDeps = createEconomyDeps(content, mapgenConfig, economy, {
  battle: fixedBattle(true),
});

function toStep(step: string): RunState {
  const r = createRun(runArgs(['Ann', 'Bo']), deps);
  if (!r.ok) throw new Error(r.detail);
  let s = placeCoreAll(r.state, deps);
  for (let i = 0; i < 20 && s.step !== step; i++) {
    if (s.step === 'pve_choice') s = voteAll(s, 'easy', deps);
    else if (s.step === 'event_choice') s = voteAll(s, 'stub_event_a', deps);
    else s = readyAll(s, deps);
  }
  expect(s.step).toBe(step);
  return s;
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
      out.push(`player ${p}'s gold, stash or buildings changed`);
  }
  const was = ownersById(before);
  for (const [id, owner] of ownersById(after))
    if (was.has(id) && was.get(id) !== owner)
      out.push(`building ${id} changed owner`);
  return out;
}

/** Every intent shape a player could send, aimed at both players' things. */
function candidates(
  s: RunState,
  actor: number,
  whose: 'own' | 'foreign',
): Intent[] {
  const pick = (b: { owner: number }) =>
    whose === 'own' ? b.owner === actor : b.owner !== actor;
  const ids = [
    ...s.team.buildings.filter(pick).map((b: PlacedBuilding) => b.id),
    ...s.team.stash.filter(pick).map((b) => b.id),
    9999,
  ];
  const out: Intent[] = [
    { type: 'ready' },
    { type: 'unready' },
    { type: 'reroll' },
    { type: 'give', to: 1, gold: 5 },
    { type: 'give_gold', player: 1, amount: 5 },
    { type: 'transfer', id: ids[0] ?? 0, to: 1 },
  ];
  for (let slot = 0; slot < 6; slot++) out.push({ type: 'buy', slot });
  for (const id of ids) {
    out.push({ type: 'sell', id });
    out.push({ type: 'return_building', id });
    out.push({ type: 'erase_conduit', id });
    for (const [x, y] of [
      [0, 0],
      [3, 3],
      [10, 10],
    ] as const) {
      out.push({ type: 'place_building', id, x, y, rotation: 0 });
      out.push({ type: 'move_building', id, x, y, rotation: 0 });
    }
  }
  return out;
}

describe('no giving (CP-29, CP-21i)', () => {
  for (const step of ['build', 'shop']) {
    test(`no intent changes another player's holdings or an owner in ${step}`, () => {
      const s = toStep(step);
      expect(s.players.length).toBe(2);
      // Both players hold something, so a leak would show.
      for (let p = 0; p < 2; p++) {
        expect(
          s.team.buildings.some((b) => b.owner === p) ||
            s.team.stash.some((b) => b.owner === p),
        ).toBe(true);
      }
      let accepted = 0;
      for (const actor of [0, 1]) {
        for (const intent of candidates(s, actor, 'own')) {
          const r = applyIntent(s, actor, intent, deps);
          if (!r.ok) continue;
          accepted++;
          expect(violations(s, r.state, actor), JSON.stringify(intent)).toEqual(
            [],
          );
        }
      }
      expect(accepted).toBeGreaterThan(0);
    });
  }

  // Known gap, owned by issue #129 (CP-28): the board intents do not check
  // who owns the building yet, so a player can place, move or return a
  // partner's building. Remove `.fails` when #129 lands.
  test.fails(
    "board intents on another player's buildings change nothing (needs #129)",
    () => {
      const s = toStep('build');
      for (const actor of [0, 1]) {
        for (const intent of candidates(s, actor, 'foreign')) {
          const r = applyIntent(s, actor, intent, deps);
          if (r.ok) expect(violations(s, r.state, actor)).toEqual([]);
        }
      }
    },
  );

  test('the economy intents available to a player never include a give', () => {
    const s = toStep('shop');
    for (const p of [0, 1])
      for (const t of allowedIntents(s, p, deps))
        expect(t).not.toMatch(/give|gift|transfer/);
    expect(readShop(s.perPlayer[0] as never)).not.toBeNull();
  });

  test('the checker can fail: it flags gold, stash, building and owner changes', () => {
    const s = toStep('shop');
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
    const first = s.team.stash[0] ?? s.team.buildings[0];
    const flipped = {
      ...s,
      team: {
        ...s.team,
        stash: s.team.stash.map((b) =>
          b.id === first?.id ? { ...b, owner: 1 - b.owner } : b,
        ),
        buildings: s.team.buildings.map((b) =>
          b.id === first?.id ? { ...b, owner: 1 - b.owner } : b,
        ),
      },
    };
    expect(
      violations(s, flipped, 0).some((v) => v.includes('changed owner')),
    ).toBe(true);
  });
});
