import { addToStash, placeFromStash, type TeamState } from '@game/core';
import { describe, expect, test } from 'vitest';
import { fixedBattle } from './defaults.js';
import { applyIntent, createRun } from './machine.js';
import { sealedProducers } from './selectors.js';
import {
  content,
  makeGameDeps,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from './test-support.js';
import type { RunState } from './types.js';

const deps = makeGameDeps({ battle: fixedBattle(true) });

function inBuild(players: readonly string[]): RunState {
  const r = createRun(runArgs(players), deps);
  if (!r.ok) throw new Error(r.detail);
  return placeCoreAll(r.state, deps);
}

function put(
  team: TeamState,
  def: string,
  x: number,
  y: number,
): { team: TeamState; id: number } | null {
  // The building belongs to the player whose plot column `x` is in.
  const owner = Math.floor(x / team.map.plotWidth);
  const a = addToStash(team, content, { def, tier: 1, owner });
  if (!a.ok) return null;
  const p = placeFromStash(a.state, content, {
    actor: owner,
    id: a.id,
    x,
    y,
    rotation: 0,
  });
  return p.ok ? { team: p.state, id: a.id } : null;
}

/**
 * A barracks in a board corner closed in by four of `wall` (a gate may stand
 * in for one wall). The map is cleared of features so the corner is free.
 */
function sealIn(
  s: RunState,
  gate = false,
  producer = 'bld_barracks',
): { state: RunState; barracks: number; walls: number[] } {
  const w = s.team.map.width;
  const clear: TeamState = {
    ...s.team,
    map: { ...s.team.map, features: [], nodes: [] },
  };
  for (const [bx, dir] of [
    [0, 1],
    [w - 2, -1],
  ] as const) {
    let team = clear;
    const b = put(team, producer, bx, 0);
    if (b === null) continue;
    team = b.team;
    // The four cells next to the 2x2 footprint, inside the board.
    const sides: [number, number][] =
      dir === 1
        ? [
            [2, 0],
            [2, 1],
            [0, 2],
            [1, 2],
          ]
        : [
            [w - 3, 0],
            [w - 3, 1],
            [w - 2, 2],
            [w - 1, 2],
          ];
    const walls: number[] = [];
    let good = true;
    for (const [i, [x, y]] of sides.entries()) {
      const r = put(team, gate && i === 0 ? 'bld_gate' : 'bld_wall', x, y);
      if (r === null) {
        good = false;
        break;
      }
      team = r.team;
      walls.push(r.id);
    }
    if (good) return { state: { ...s, team }, barracks: b.id, walls };
  }
  throw new Error('could not seal a producer in');
}

describe('Ready is refused while a unit producer is sealed in (issue #37, 3a)', () => {
  test('solo: ready is rejected with sealed_producer and the ids, then works once opened', () => {
    const { state, barracks, walls } = sealIn(inBuild(['Ann']));
    expect(sealedProducers(state, deps)).toEqual([barracks]);
    const r = applyIntent(state, 0, { type: 'ready' }, deps);
    expect(r).toMatchObject({
      ok: false,
      reason: 'sealed_producer',
      detail: String(barracks),
    });
    // Nothing changed and the step did not advance.
    expect(state.step).toBe('build');
    // Return one wall to the stash: the producer can walk out.
    const opened = ok(
      state,
      0,
      { type: 'return_building', id: walls[0] as number },
      deps,
    ).state;
    expect(sealedProducers(opened, deps)).toEqual([]);
    expect(ok(opened, 0, { type: 'ready' }, deps).state.step).toBe(
      'pve_choice',
    );
  });

  test('a gate in the enclosure is not sealed', () => {
    const { state } = sealIn(inBuild(['Ann']), true);
    expect(sealedProducers(state, deps)).toEqual([]);
    expect(ok(state, 0, { type: 'ready' }, deps).state.step).toBe('pve_choice');
  });

  test('a walled-in Hangar (flying units) is never sealed and does not block Ready', () => {
    const { state } = sealIn(inBuild(['Ann']), false, 'bld_hangar');
    expect(sealedProducers(state, deps)).toEqual([]);
    expect(ok(state, 0, { type: 'ready' }, deps).state.step).toBe('pve_choice');
  });

  test('unplaced producers do not count', () => {
    const s = inBuild(['Ann']);
    expect(s.team.stash.some((b) => b.def === 'bld_barracks')).toBe(true);
    expect(sealedProducers(s, deps)).toEqual([]);
  });

  test('two players: a sealed producer blocks only its owner (PP-15)', () => {
    const { state, barracks } = sealIn(inBuild(['Ann', 'Bo']));
    const owner = state.team.buildings.find((b) => b.id === barracks)
      ?.owner as number;
    const other = 1 - owner;
    expect(applyIntent(state, owner, { type: 'ready' }, deps)).toMatchObject({
      ok: false,
      reason: 'sealed_producer',
      detail: String(barracks),
    });
    // The other player owns no sealed producer: their Ready is accepted.
    const r = ok(state, other, { type: 'ready' }, deps);
    expect(r.state.perPlayer[other]?.ready).toBe(true);
    expect(r.state.step).toBe('build');
  });

  test('also in the shop, but not in the summary steps', () => {
    let s = readyAll(inBuild(['Ann']), deps);
    s = voteAll(s, 'easy', deps);
    expect(s.step).toBe('pve_summary');
    const sealed = sealIn(s);
    // Summary steps have nothing to fix, so Ready is not refused there.
    expect(applyIntent(sealed.state, 0, { type: 'ready' }, deps).ok).toBe(true);
    s = readyAll(s, deps);
    s = voteAll(s, 'evt_windfall', deps);
    expect(s.step).toBe('shop');
    const inShop = sealIn(s);
    expect(applyIntent(inShop.state, 0, { type: 'ready' }, deps)).toMatchObject(
      {
        reason: 'sealed_producer',
      },
    );
  });
});
