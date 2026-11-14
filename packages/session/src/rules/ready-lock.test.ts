import { describe, expect, test } from 'vitest';
import { fixedBattle } from './defaults.js';
import { applyIntent, createRun } from './machine.js';
import { allowedIntents } from './selectors.js';
import {
  makeGameDeps,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from '../testing/test-support.js';
import type { Intent, IntentHandler, RunState } from './types.js';

const probe: IntentHandler = {
  steps: ['build', 'shop', 'pve_summary'],
  handle: ({ state }) => ({ ok: true, state }),
};
const deps = makeGameDeps({
  battle: fixedBattle(true),
  handlers: { probe },
});

function inBuild(players: readonly string[]): RunState {
  const r = createRun(runArgs(players), deps);
  if (!r.ok) throw new Error(r.detail);
  const s = placeCoreAll(r.state, deps);
  expect(s.step).toBe('build');
  return s;
}

function inShop(players: readonly string[]): RunState {
  let s = inBuild(players);
  s = readyAll(s, deps);
  s = voteAll(s, 'easy', deps);
  s = readyAll(s, deps); // pve_summary
  s = voteAll(s, 'evt_windfall', deps);
  expect(s.step).toBe('shop');
  return s;
}

/** Intents that are all legal for player 0 when not Ready. */
function edits(s: RunState): Intent[] {
  const mine = s.team.stash.find((b) => b.owner === 0);
  const placed = s.team.buildings.find((b) => b.owner === 0);
  const id = mine?.id ?? 0;
  return [
    { type: 'sell', id },
    { type: 'probe' },
    { type: 'place_building', id, x: 0, y: 0, rotation: 0 },
    { type: 'move_building', id: placed?.id ?? id, x: 0, y: 0, rotation: 0 },
    { type: 'return_building', id: placed?.id ?? id },
    {
      type: 'add_conduit',
      from: { building: id, side: 'N' },
      to: { building: id, side: 'S' },
      cells: [],
    },
    { type: 'erase_conduit', id: 0 },
  ];
}

describe('Ready locks (issue #58)', () => {
  test('two players, build: a Ready player cannot edit; Unready lifts the lock', () => {
    const s0 = inBuild(['Ann', 'Bo']);
    const s = ok(s0, 0, { type: 'ready' }, deps).state;
    expect(s.step).toBe('build');
    for (const intent of edits(s0)) {
      const r = applyIntent(s, 0, intent, deps);
      expect(r, intent.type).toMatchObject({
        ok: false,
        reason: 'locked_ready',
      });
    }
    // The other player is not locked.
    const other = s.team.stash.find((b) => b.owner === 1);
    expect(
      applyIntent(s, 1, { type: 'sell', id: other?.id ?? 0 }, deps).ok,
    ).toBe(true);
    // A rejected intent changes nothing.
    expect(s.actionCounter).toBe(s0.actionCounter + 1);
    const back = ok(s, 0, { type: 'unready' }, deps).state;
    const mine = back.team.stash.find((b) => b.owner === 0);
    expect(
      applyIntent(back, 0, { type: 'sell', id: mine?.id ?? 0 }, deps).ok,
    ).toBe(true);
    expect(applyIntent(back, 0, { type: 'probe' }, deps).ok).toBe(true);
    for (const intent of edits(s0)) {
      const r = applyIntent(back, 0, intent, deps);
      expect(r.ok ? 'ok' : r.reason, intent.type).not.toBe('locked_ready');
    }
  });

  test('two players, shop: buy, sell and re-roll are locked while Ready', () => {
    const s0 = inShop(['Ann', 'Bo']);
    const s = ok(s0, 0, { type: 'ready' }, deps).state;
    const mine = s.team.stash.find((b) => b.owner === 0);
    for (const intent of [
      { type: 'buy', slot: 0 },
      { type: 'reroll' },
      { type: 'sell', id: mine?.id ?? 0 },
      { type: 'place_building', id: mine?.id ?? 0, x: 0, y: 0, rotation: 0 },
    ] as Intent[]) {
      expect(applyIntent(s, 0, intent, deps), intent.type).toMatchObject({
        ok: false,
        reason: 'locked_ready',
      });
    }
    const back = ok(s, 0, { type: 'unready' }, deps).state;
    expect(applyIntent(back, 0, { type: 'reroll' }, deps).ok).toBe(true);
    expect(applyIntent(back, 0, { type: 'buy', slot: 0 }, deps).ok).toBe(true);
  });

  test('a Ready player may still unready, and the host may abandon', () => {
    const s = ok(inBuild(['Ann', 'Bo']), 1, { type: 'ready' }, deps).state;
    expect(allowedIntents(s, 1, deps)).toEqual(['unready']);
    expect(allowedIntents(s, 0, deps)).toContain('sell');
    const aband = ok(s, 0, { type: 'abandon' }, deps);
    expect(aband.state.step).toBe('run_over');
    // Host ready, then abandon is still allowed.
    const hostReady = ok(
      inBuild(['Ann', 'Bo']),
      0,
      { type: 'ready' },
      deps,
    ).state;
    expect(allowedIntents(hostReady, 0, deps)).toEqual(['unready', 'abandon']);
    expect(ok(hostReady, 0, { type: 'abandon' }, deps).state.step).toBe(
      'run_over',
    );
    // Ready again is already_ready, not locked.
    expect(applyIntent(hostReady, 0, { type: 'ready' }, deps)).toMatchObject({
      reason: 'already_ready',
    });
  });

  test('when the last player readies the step advances and the flags reset', () => {
    const s = ok(inBuild(['Ann', 'Bo']), 0, { type: 'ready' }, deps).state;
    const next = ok(s, 1, { type: 'ready' }, deps).state;
    expect(next.step).toBe('pve_choice');
    expect(next.perPlayer.every((p) => !p.ready)).toBe(true);
  });

  test('one player: Ready advances at once, so no locked state exists', () => {
    const s = inBuild(['Ann']);
    const next = ok(s, 0, { type: 'ready' }, deps).state;
    expect(next.step).toBe('pve_choice');
    expect(next.perPlayer[0]?.ready).toBe(false);
    expect(allowedIntents(s, 0, deps)).toContain('sell');
    const shop = inShop(['Ann']);
    expect(ok(shop, 0, { type: 'ready' }, deps).state.step).not.toBe('shop');
  });

  test('summary steps are not locked (nothing to edit there)', () => {
    let s = readyAll(inBuild(['Ann', 'Bo']), deps);
    s = voteAll(s, 'easy', deps);
    expect(s.step).toBe('pve_summary');
    s = ok(s, 0, { type: 'ready' }, deps).state;
    expect(applyIntent(s, 0, { type: 'probe' }, deps).ok).toBe(true);
  });
});
