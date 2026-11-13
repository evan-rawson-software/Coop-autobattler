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
import { baseDeps, content, mapgenConfig, newRun, ok } from './test-support.js';
import type { Intent, RunState } from './types.js';

// The `id` of `add_conduit` and the `reclaimId` of `erase_conduit` (RS-5g,
// issue #38) are checked like every other intent field, and an explicit id
// goes through the same step, Ready and ownership checks as a plain add.

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [
    { x: 2, y: 2, resource: 'res_a' },
    { x: 14, y: 2, resource: 'res_a' },
  ],
};

/** A build-step state: player 0 has an extractor and a barracks above it. */
function build(): { s: RunState; add: Intent } {
  let team: TeamState = createTeamState(map);
  for (const [p, x] of [
    [0, 5],
    [1, 17],
  ] as const) {
    const r = placeCore(team, content, mapgenConfig, p, { x, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    team = r.state;
  }
  const put = (def: string, y: number): number => {
    const a = addToStash(team, content, { def, tier: 1, owner: 0 });
    if (!a.ok) throw new Error(a.reason);
    const p = placeFromStash(a.state, content, {
      actor: 0,
      id: a.id,
      x: 2,
      y,
      rotation: 0,
    });
    if (!p.ok) throw new Error(p.reason);
    team = p.state;
    return a.id;
  };
  const e = put('bld_extractor', 2);
  const b = put('bld_barracks', 3);
  const s: RunState = {
    ...newRun(baseDeps, ['Ann', 'Bo']),
    step: 'build',
    team,
  };
  const add: Intent = {
    type: 'add_conduit',
    from: { building: e, side: 'north' },
    to: { building: b, side: 'south' },
    cells: [],
  };
  return { s, add };
}

const reason = (r: ReturnType<typeof applyIntent>): string =>
  r.ok ? 'ok' : r.reason;

describe('conduit id fields on intents', () => {
  test('a non-integer id or a non-boolean reclaimId is invalid_intent', () => {
    const { s, add } = build();
    const added = ok(s, 0, add).state;
    for (const id of [1.5, '4', null, Number.NaN, {}, true]) {
      const bad = { ...add, id } as unknown as Intent;
      expect(reason(applyIntent(s, 0, bad, baseDeps)), JSON.stringify(id)).toBe(
        'invalid_intent',
      );
      const erase = { type: 'erase_conduit', id } as unknown as Intent;
      expect(
        reason(applyIntent(added, 0, erase, baseDeps)),
        JSON.stringify(id),
      ).toBe('invalid_intent');
    }
    for (const reclaimId of ['yes', 1, 0, null, {}]) {
      const erase = {
        type: 'erase_conduit',
        id: 4,
        reclaimId,
      } as unknown as Intent;
      expect(reason(applyIntent(added, 0, erase, baseDeps))).toBe(
        'invalid_intent',
      );
    }
    // The well-formed fields go through.
    expect(
      applyIntent(
        added,
        0,
        { type: 'erase_conduit', id: 4, reclaimId: true },
        baseDeps,
      ).ok,
    ).toBe(true);
  });

  test('an explicit id is wrong_step outside the build and shop steps', () => {
    const { s, add } = build();
    const added = ok(s, 0, add).state;
    const erased = ok(added, 0, { type: 'erase_conduit', id: 4 }).state;
    const explicit = { ...add, id: 4 } as Intent;
    expect(reason(applyIntent(erased, 0, explicit, baseDeps))).toBe('ok');
    expect(
      reason(
        applyIntent({ ...erased, step: 'pve_summary' }, 0, explicit, baseDeps),
      ),
    ).toBe('wrong_step');
  });

  test('an explicit id is locked_ready for a Ready player', () => {
    const { s, add } = build();
    const added = ok(s, 0, add).state;
    const erased = ok(added, 0, { type: 'erase_conduit', id: 4 }).state;
    const ready = ok(erased, 0, { type: 'ready' }).state;
    expect(reason(applyIntent(ready, 0, { ...add, id: 4 }, baseDeps))).toBe(
      'locked_ready',
    );
  });

  test("an explicit id for another player's building is not_owner", () => {
    const { s, add } = build();
    // Player 1 has handed out a conduit id before, so their id 5 is in range.
    const withCounter: RunState = {
      ...s,
      team: { ...s.team, nextConduitId: [1, 2] },
    };
    expect(
      reason(applyIntent(withCounter, 1, { ...add, id: 5 }, baseDeps)),
    ).toBe('not_owner');
    // An id in the other player's space is refused first.
    expect(
      reason(applyIntent(withCounter, 1, { ...add, id: 4 }, baseDeps)),
    ).toBe('invalid_conduit_id');
  });
});
