import { describe, expect, test } from 'vitest';
import { addConduit } from './conduits.js';
import { hashJson } from './hash.js';
import type { GameMap } from './map.js';
import { content, mapgen } from './testing/support.js';
import {
  addToStash,
  createTeamState,
  eraseConduit,
  placeCore,
  placeFromStash,
  validateTeamState,
  type TeamState,
} from './team-state.js';

// Explicit conduit IDs and ID reclaim, the core support for exact undo (RS-5g).

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [{ x: 2, y: 2, resource: 'res_a' }],
};

const cells = Array.from({ length: 10 }, (_, i) => ({ x: 2 + i, y: 3 }));

function rig() {
  let team: TeamState = createTeamState(map);
  for (const [p, x] of [
    [0, 5],
    [1, 17],
  ] as const) {
    const r = placeCore(team, content, mapgen, p, { x, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    team = r.state;
  }
  const a = addToStash(team, content, {
    def: 'bld_extractor',
    tier: 1,
    owner: 0,
  });
  if (!a.ok) throw new Error(a.reason);
  const p = placeFromStash(a.state, content, {
    actor: 0,
    id: a.id,
    x: 2,
    y: 2,
    rotation: 0,
  });
  if (!p.ok) throw new Error(p.reason);
  const args = {
    actor: 0,
    from: { building: a.id, side: 'north' },
    to: { border: 0, y: 3 },
    cells,
  };
  return { team: p.state, building: a.id, args };
}

describe('explicit conduit ID', () => {
  test('re-adds an erased conduit under its old ID, exactly', () => {
    const { team, args } = rig();
    const added = addConduit(team, content, args);
    if (!added.ok) throw new Error(added.reason);
    const erased = eraseConduit(added.state, { actor: 0, id: added.id });
    if (!erased.ok) throw new Error(erased.reason);
    const back = addConduit(erased.state, content, { ...args, id: added.id });
    if (!back.ok) throw new Error(back.reason);
    expect(back.id).toBe(added.id);
    expect(hashJson(back.state)).toBe(hashJson(added.state));
    expect(validateTeamState(back.state, content, mapgen).ok).toBe(true);
  });

  test('refuses IDs never handed out, and used IDs', () => {
    const { team, building, args } = rig();
    for (const id of [0, team.nextId, team.nextId + 5, building]) {
      expect(addConduit(team, content, { ...args, id })).toMatchObject({
        ok: false,
        reason: 'invalid_conduit_id',
      });
    }
    const added = addConduit(team, content, args);
    if (!added.ok) throw new Error(added.reason);
    const twice = addConduit(added.state, content, { ...args, id: added.id });
    expect(twice).toMatchObject({ ok: false, reason: 'invalid_conduit_id' });
  });

  test('a plain add takes the owner counter, which moves by one; nextId is untouched', () => {
    const { team, args } = rig();
    const added = addConduit(team, content, args);
    if (!added.ok) throw new Error(added.reason);
    expect(added.id).toBe(4);
    expect(added.state.nextConduitId).toEqual([2, 1]);
    expect(added.state.nextId).toBe(team.nextId);
  });
});

describe('erase with reclaimId', () => {
  test('hands back the newest ID', () => {
    const { team, args } = rig();
    const added = addConduit(team, content, args);
    if (!added.ok) throw new Error(added.reason);
    const erased = eraseConduit(added.state, {
      actor: 0,
      id: added.id,
      reclaimId: true,
    });
    if (!erased.ok) throw new Error(erased.reason);
    expect(hashJson(erased.state)).toBe(hashJson(team));
    expect(validateTeamState(erased.state, content, mapgen).ok).toBe(true);
  });

  test('leaves nextId alone when the conduit is not the newest ID', () => {
    const { team, args } = rig();
    const added = addConduit(team, content, args);
    if (!added.ok) throw new Error(added.reason);
    const later = addToStash(added.state, content, {
      def: 'bld_wall',
      tier: 1,
      owner: 0,
    });
    if (!later.ok) throw new Error(later.reason);
    const erased = eraseConduit(later.state, {
      actor: 0,
      id: added.id,
      reclaimId: true,
    });
    if (!erased.ok) throw new Error(erased.reason);
    expect(erased.state.nextId).toBe(later.state.nextId);
  });

  test('without the flag nextId is unchanged', () => {
    const { team, args } = rig();
    const added = addConduit(team, content, args);
    if (!added.ok) throw new Error(added.reason);
    const erased = eraseConduit(added.state, { actor: 0, id: added.id });
    if (!erased.ok) throw new Error(erased.reason);
    expect(erased.state.nextId).toBe(added.state.nextId);
  });
});
