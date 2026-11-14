import {
  addToStash,
  createTeamState,
  placeCore,
  placeFromStash,
  type GameMap,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { applyIntent } from './machine.js';
import {
  baseDeps,
  content,
  mapgenConfig,
  newRun,
  ok,
} from '../testing/test-support.js';
import type { Intent, RunState } from './types.js';

// Border conduit halves through session intents (issue #136, PP-4, CP-21i):
// `add_conduit` and `erase_conduit` take border ends and name the acting
// player; a refusal reaches the player who sent it.

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [{ x: 2, y: 2, resource: 'res_a' }],
};

/** A build-step state of two players with an extractor and a barracks. */
function build(): { s: RunState; src: number; cons: number } {
  let team: TeamState = createTeamState(map);
  for (const [p, x] of [
    [0, 5],
    [1, 17],
  ] as const) {
    const r = placeCore(team, content, mapgenConfig, p, { x, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    team = r.state;
  }
  const put = (def: string, owner: number, x: number, y: number): number => {
    const a = addToStash(team, content, { def, tier: 1, owner });
    if (!a.ok) throw new Error(a.reason);
    const p = placeFromStash(a.state, content, {
      actor: owner,
      id: a.id,
      x,
      y,
      rotation: 0,
    });
    if (!p.ok) throw new Error(p.reason);
    team = p.state;
    return a.id;
  };
  const src = put('bld_extractor', 0, 2, 2);
  const cons = put('bld_barracks', 1, 14, 6);
  const s: RunState = {
    ...newRun(baseDeps, ['Ann', 'Bo']),
    step: 'build',
    team,
  };
  return { s, src, cons };
}

const row = (from: number, to: number, y: number) => {
  const out: { x: number; y: number }[] = [];
  for (let x = from; x <= to; x++) out.push({ x, y });
  return out;
};

function sendingHalf(src: number): Intent {
  return {
    type: 'add_conduit',
    from: { building: src, side: 'north' },
    to: { border: 0, y: 3 },
    cells: row(2, 11, 3),
  };
}

function receivingHalf(cons: number): Intent {
  return {
    type: 'add_conduit',
    from: { border: 0, y: 3 },
    to: { building: cons, side: 'south' },
    cells: [
      { x: 12, y: 3 },
      { x: 13, y: 3 },
      { x: 14, y: 3 },
      { x: 14, y: 4 },
      { x: 14, y: 5 },
    ],
  };
}

describe('border halves as intents', () => {
  test('each player adds their own half and the two join', () => {
    const { s, src, cons } = build();
    const a = ok(s, 0, sendingHalf(src)).state;
    const b = ok(a, 1, receivingHalf(cons)).state;
    expect(b.team.conduits.map((c) => c.owner)).toEqual([0, 1]);
  });

  test('a refusal names the reason and changes nothing', () => {
    const { s, src, cons } = build();
    // Player 1 cannot draw a half from player 0's building ...
    expect(applyIntent(s, 1, sendingHalf(src), baseDeps)).toMatchObject({
      ok: false,
      reason: 'not_owner',
    });
    // ... nor a half at a border that is not theirs.
    const far: Intent = {
      ...receivingHalf(cons),
      from: { border: 5, y: 3 },
    };
    expect(applyIntent(s, 1, far, baseDeps)).toMatchObject({
      ok: false,
      reason: 'invalid_border',
    });
  });

  test('a remaining player erases their own half; the absent one is untouched (CP-21i)', () => {
    const { s, src, cons } = build();
    const a = ok(s, 0, sendingHalf(src)).state;
    const b = ok(a, 1, receivingHalf(cons)).state;
    const [h0, h1] = b.team.conduits;
    if (h0 === undefined || h1 === undefined) throw new Error('halves');
    // Player 0 cannot touch player 1's half.
    expect(
      applyIntent(b, 0, { type: 'erase_conduit', id: h1.id }, baseDeps),
    ).toMatchObject({ ok: false, reason: 'not_owner' });
    // Player 0 erases their own; player 1's half stays, now open.
    const c = ok(b, 0, { type: 'erase_conduit', id: h0.id }).state;
    expect(c.team.conduits).toEqual([h1]);
  });
});
