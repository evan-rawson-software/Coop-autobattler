import { describe, expect, test } from 'vitest';
import {
  MAX_PARTY_SIZE,
  decodeConduitId,
  encodeConduitId,
} from './conduit-ids.js';
import { addConduit, buildFlowGraph } from './conduits.js';
import {
  createBoardSim,
  createFlowContext,
  flowTotals,
  stepFlow,
} from './flow-sim.js';
import type { GameMap } from './map.js';
import { content, mapgen, simConfig } from './testing/support.js';
import {
  addToStash,
  createTeamState,
  eraseConduit,
  placeCore,
  placeFromStash,
  validateTeamState,
  type TeamState,
} from './team-state.js';

// Every player has their own conduit ID space (issue #38): n * 4 + owner.

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

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

/** Two players, each with an extractor and a barracks right above it. */
function rig() {
  let team: TeamState = createTeamState(map);
  for (const [p, x] of [
    [0, 5],
    [1, 17],
  ] as const) {
    team = ok(placeCore(team, content, mapgen, p, { x, y: 0 })).state;
  }
  const ids: number[] = [];
  for (const [owner, x] of [
    [0, 2],
    [1, 14],
  ] as const) {
    for (const [def, y] of [
      ['bld_extractor', 2],
      ['bld_barracks', 3],
    ] as const) {
      const s = ok(addToStash(team, content, { def, tier: 1, owner }));
      team = ok(
        placeFromStash(s.state, content, {
          actor: owner,
          id: s.id,
          x,
          y,
          rotation: 0,
        }),
      ).state;
      ids.push(s.id);
    }
  }
  const [e0, b0, e1, b1] = ids as [number, number, number, number];
  const link = (actor: 0 | 1) => ({
    actor,
    from: { building: actor === 0 ? e0 : e1, side: 'north' },
    to: { building: actor === 0 ? b0 : b1, side: 'south' },
    cells: [],
  });
  return { team, link };
}

describe('the conduit id space', () => {
  test('the constant covers the largest party size in the content', () => {
    expect(MAX_PARTY_SIZE).toBeGreaterThanOrEqual(mapgen.maxPartySize);
  });

  test('encode and decode agree', () => {
    for (let owner = 0; owner < MAX_PARTY_SIZE; owner++) {
      for (const n of [1, 2, 17]) {
        expect(decodeConduitId(encodeConduitId(owner, n))).toEqual({
          owner,
          n,
        });
      }
    }
  });

  test('each owner counts their own ids and nextId is untouched', () => {
    const { team, link } = rig();
    expect(team.nextConduitId).toEqual([1, 1]);
    const a = ok(addConduit(team, content, link(0)));
    const b = ok(addConduit(a.state, content, link(1)));
    expect([a.id, b.id]).toEqual([4, 5]);
    expect(b.state.nextConduitId).toEqual([2, 2]);
    expect(b.state.nextId).toBe(team.nextId);
    expect(b.state.conduits.map((c) => c.id)).toEqual([4, 5]);
    // Without a reclaim, an erased id is never handed out again.
    const erased = ok(eraseConduit(b.state, { actor: 0, id: a.id }));
    const again = ok(addConduit(erased.state, content, link(0)));
    expect(again.id).toBe(8);
    expect(again.state.nextConduitId).toEqual([3, 2]);
    expect(validateTeamState(again.state, content, mapgen).ok).toBe(true);
  });

  test('an explicit id outside the actor space is refused', () => {
    const { team, link } = rig();
    const a = ok(addConduit(team, content, link(0)));
    const erased = ok(eraseConduit(a.state, { actor: 0, id: a.id }));
    const refused = (id: number, actor: 0 | 1 = 0) =>
      addConduit(erased.state, content, { ...link(actor), id });
    // 5 is player 1's id n = 1; 8 and 12 are not below player 0's counter;
    // 0, 2 and 4.5 are no ids at all.
    for (const id of [5, 8, 12, 0, 2, 4.5, -4]) {
      expect(refused(id)).toMatchObject({
        ok: false,
        reason: 'invalid_conduit_id',
      });
    }
    // Player 1 has handed out nothing, so even their own n = 1 is refused.
    expect(refused(5, 1)).toMatchObject({
      ok: false,
      reason: 'invalid_conduit_id',
    });
    // The right one works and leaves the counters alone.
    const back = ok(refused(4));
    expect(back.id).toBe(4);
    expect(back.state.nextConduitId).toEqual([2, 1]);
    // And a used id is refused.
    expect(
      addConduit(back.state, content, { ...link(0), id: 4 }),
    ).toMatchObject({ ok: false, reason: 'invalid_conduit_id' });
  });

  test('reclaim only moves the owner counter, and only for the newest', () => {
    const { team, link } = rig();
    const a = ok(addConduit(team, content, link(0)));
    const b = ok(addConduit(a.state, content, link(1)));
    const e0 = ok(
      eraseConduit(b.state, { actor: 0, id: a.id, reclaimId: true }),
    );
    expect(e0.state.nextConduitId).toEqual([1, 2]);
    const e1 = ok(
      eraseConduit(e0.state, { actor: 1, id: b.id, reclaimId: true }),
    );
    expect(e1.state.nextConduitId).toEqual([1, 1]);
    // Not the newest: erase 8, re-add 4 explicitly, erase it again with reclaim.
    const first = ok(addConduit(team, content, link(0)));
    const gone = ok(eraseConduit(first.state, { actor: 0, id: first.id }));
    const second = ok(addConduit(gone.state, content, link(0)));
    const erase2 = ok(eraseConduit(second.state, { actor: 0, id: second.id }));
    const old = ok(addConduit(erase2.state, content, { ...link(0), id: 4 }));
    const kept = ok(
      eraseConduit(old.state, { actor: 0, id: 4, reclaimId: true }),
    );
    expect(kept.state.nextConduitId).toEqual([3, 1]);
  });

  test('the validator checks the owner of an id and the counters', () => {
    const { team, link } = rig();
    const a = ok(addConduit(team, content, link(1)));
    const json = JSON.parse(JSON.stringify(a.state)) as {
      conduits: { id: number }[];
      nextConduitId: number[];
    };
    const check = (edit: (j: typeof json) => void): string[] => {
      const j = JSON.parse(JSON.stringify(json)) as typeof json;
      edit(j);
      const r = validateTeamState(j, content, mapgen);
      return r.ok ? [] : [...r.errors];
    };
    expect(check(() => undefined)).toEqual([]);
    const wrong = check((j) => {
      const c = j.conduits[0];
      if (c !== undefined) c.id = 4;
    });
    expect(wrong.some((e) => e.includes('does not belong'))).toBe(true);
    // A conduit number below 1 is invalid (id 1 is player 1's number 0).
    const zero = check((j) => {
      const c = j.conduits[0] as { id: number; owner: number } | undefined;
      if (c !== undefined) {
        c.id = 1;
        c.owner = 1;
      }
    });
    expect(zero.some((e) => e.includes('below 1'))).toBe(true);
    for (const bad of [[1, 1], [2], [2, 0], [2, 2, 2], [2, 1.5]]) {
      expect(
        check((j) => {
          j.nextConduitId = bad;
        }).some((e) => e.includes('nextConduitId')),
      ).toBe(true);
    }
    // A building and a conduit may now share a number.
    const shared = ok(addConduit(team, content, link(0)));
    expect(shared.state.buildings.some((b) => b.id === shared.id)).toBe(true);
    expect(validateTeamState(shared.state, content, mapgen).ok).toBe(true);
  });

  test('a conduit id equal to a building id validates and runs', () => {
    const { team, link } = rig();
    const shared = ok(addConduit(team, content, link(0)));
    expect(shared.state.buildings.some((b) => b.id === shared.id)).toBe(true);
    expect(validateTeamState(shared.state, content, mapgen).ok).toBe(true);
    expect(buildFlowGraph(shared.state, content).edges).toHaveLength(1);
    const sim = createBoardSim(shared.state, content, simConfig);
    const flow = createFlowContext(shared.state, content, simConfig, {
      consumers: 'drain',
    });
    for (let i = 0; i < 100; i++) stepFlow(sim, flow);
    const t = flowTotals(sim);
    expect(t.consumed).toBeGreaterThan(0);
    expect(t.produced).toBe(
      t.inConduits + t.held + t.inBuffers + t.consumed + t.lost,
    );
  });

  test('a team where both players own conduits runs as pinned', () => {
    const { team, link } = rig();
    const a = ok(addConduit(team, content, link(0)));
    const b = ok(addConduit(a.state, content, link(1)));
    expect([a.id, b.id]).toEqual([4, 5]);
    const sim = createBoardSim(b.state, content, simConfig);
    const flow = createFlowContext(b.state, content, simConfig, {
      consumers: 'drain',
    });
    for (let i = 0; i < 100; i++) stepFlow(sim, flow);
    // Each player's own conduit feeds their own barracks, five items each.
    expect(
      sim.consumers.map((c) => [c.building, c.inputs.map((x) => x.consumed)]),
    ).toEqual([
      [2, [5]],
      [4, [5]],
    ]);
    expect(flowTotals(sim)).toEqual({
      produced: 10,
      inConduits: 0,
      held: 0,
      inBuffers: 0,
      consumed: 10,
      lost: 0,
    });
  });
});
