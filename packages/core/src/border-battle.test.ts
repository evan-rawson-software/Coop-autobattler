/** Border links in battle (issue #136, PP-4 "In battle"): CB-9a, CB-17a. */
import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  stepArena,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import { hashJson } from './hash.js';
import { startBattle, type Battle } from './battle.js';
import {
  addConduit,
  conduitsLostWith,
  type ConduitEndArg,
} from './conduits.js';
import { flowTotals } from './flow-sim.js';
import type { GameMap } from './map.js';
import type { Conduit, TeamState } from './team-state.js';
import { Lab, content, mapgen, simConfig } from './test-support.js';

const map2 = (): GameMap => ({
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [{ x: 2, y: 2, resource: 'res_a' }],
});

const cellsOf = (pairs: [number, number][]) =>
  pairs.map(([x, y]) => ({ x, y }));
const side = (building: number, s: string): ConduitEndArg => ({
  building,
  side: s,
});

interface Rig {
  state: TeamState;
  src: number;
  cons: number;
  send: number;
  recv: number | null;
}

/**
 * Player 0's extractor sends over border 0, row 3 (10 cells); player 1's
 * half carries on to a barracks (5 cells). `joined` false leaves the
 * receiving half out.
 */
function rig(joined = true): Rig {
  const lab = new Lab(map2());
  lab.core(5, 0, 0);
  lab.core(17, 0, 1);
  const src = lab.put('bld_extractor', 2, 2);
  const cons = lab.put('bld_barracks', 14, 6);
  const row: [number, number][] = [];
  for (let x = 2; x <= 11; x++) row.push([x, 3]);
  const s = addConduit(lab.state, content, {
    actor: 0,
    from: side(src, 'north'),
    to: { border: 0, y: 3 },
    cells: cellsOf(row),
  });
  if (!s.ok) throw new Error(s.reason);
  lab.state = s.state;
  let recv: number | null = null;
  if (joined) {
    const r = addConduit(lab.state, content, {
      actor: 1,
      from: { border: 0, y: 3 },
      to: side(cons, 'south'),
      cells: cellsOf([
        [12, 3],
        [13, 3],
        [14, 3],
        [14, 4],
        [14, 5],
      ]),
    });
    if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
    lab.state = r.state;
    recv = r.id;
  }
  return { state: lab.state, src, cons, send: s.id, recv };
}

/** Side 0 has the rig, side 1 only its Cores. */
function start(state: TeamState): Battle {
  const lab = new Lab(map2());
  lab.core(5, 0, 0);
  lab.core(17, 0, 1);
  const r = startBattle(
    { teamA: state, teamB: lab.state, seed: 1 },
    content,
    { sim: simConfig, mapgen },
    {
      zone: {
        width: 24,
        depth: mapgen.neutralZone.depth,
        features: [],
        pointsOfInterest: [],
      },
    },
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.battle;
}

function conserved(b: Battle): void {
  for (const board of b.sim.boards) {
    const f = flowTotals(board);
    expect(f.produced).toBe(
      f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
    );
  }
}

function destroyAt(b: Battle, building: number, afterTicks: number): void {
  for (let t = 0; t < afterTicks; t++) {
    b.step();
    conserved(b);
  }
  const h = b.sim.health.find(
    (x) => 'building' in x && x.side === 0 && x.building === building,
  );
  if (h === undefined) throw new Error('no health entry');
  h.hp = 0;
  for (let t = 0; t < 300; t++) {
    b.step();
    conserved(b);
  }
}

const ofType = <T extends ArenaEvent['type']>(b: Battle, type: T) =>
  b.eventLog.filter(
    (e): e is Extract<ArenaEvent, { type: T }> => e.type === type,
  );

describe('destroying one end of a link', () => {
  test('the sending building falls: both halves go, in id order, and the items are lost', () => {
    const r = rig();
    const b = start(r.state);
    destroyAt(b, r.src, 60);
    expect(
      ofType(b, 'conduit_destroyed').map((e) => [e.side, e.conduit]),
    ).toEqual([
      [0, r.send],
      [0, r.recv],
    ]);
    expect(b.sim.teams[0].conduits).toEqual([]);
    expect(b.sim.boards[0].conduits).toEqual([]);
    expect(b.sim.boards[0].retired?.lost).toBeGreaterThan(0);
  });

  test('the receiving building falls: the sending half goes too and the source stalls', () => {
    const r = rig();
    const b = start(r.state);
    destroyAt(b, r.cons, 60);
    expect(
      ofType(b, 'conduit_destroyed').map((e) => [e.side, e.conduit]),
    ).toEqual([
      [0, r.send],
      [0, r.recv],
    ]);
    expect(b.sim.teams[0].buildings.map((x) => x.id)).toContain(r.src);
    expect(b.sim.teams[0].conduits).toEqual([]);
  });

  test('an open half attached to a destroyed building goes alone, with one event', () => {
    const r = rig(false);
    const b = start(r.state);
    destroyAt(b, r.src, 5);
    expect(ofType(b, 'conduit_destroyed')).toEqual([
      expect.objectContaining({ conduit: r.send }),
    ]);
  });
});

describe('both ends of a link fall in one tick', () => {
  test('exactly two conduit_destroyed events, one per half', () => {
    const r = rig();
    const b = start(r.state);
    for (let t = 0; t < 60; t++) b.step();
    for (const id of [r.src, r.cons]) {
      const h = b.sim.health.find(
        (x) => 'building' in x && x.side === 0 && x.building === id,
      );
      if (h === undefined) throw new Error('no health entry');
      h.hp = 0;
    }
    for (let t = 0; t < 5; t++) {
      b.step();
      conserved(b);
    }
    expect(
      ofType(b, 'conduit_destroyed').map((e) => [e.side, e.conduit]),
    ).toEqual([
      [0, r.send],
      [0, r.recv],
    ]);
    expect(b.sim.teams[0].buildings.map((x) => x.id)).not.toContain(r.src);
    expect(b.sim.teams[0].buildings.map((x) => x.id)).not.toContain(r.cons);
    expect(b.sim.teams[0].conduits).toEqual([]);
  });
});

describe('restore around the cut of a link', () => {
  test('restoring before and after the destruction continues like the straight run', () => {
    const cut = 60;
    const total = 140;
    const SRC = rig().src;
    const make = (): Battle => start(rig().state);
    const killSource = (b: Battle): void => {
      const h = b.sim.health.find(
        (x) => 'building' in x && x.side === 0 && x.building === SRC,
      );
      if (h === undefined) throw new Error('no health entry');
      h.hp = 0;
    };
    const ref = make();
    const hashes = [hashJson(ref.sim)];
    for (let t = 0; t < total; t++) {
      if (t === cut) killSource(ref);
      ref.step();
      hashes.push(hashJson(ref.sim));
    }
    expect(ref.sim.teams[0].conduits).toEqual([]);
    for (const at of [10, cut - 1, cut + 1, cut + 30]) {
      const a = make();
      for (let t = 0; t < at; t++) {
        if (t === cut) killSource(a);
        a.step();
      }
      const copy = JSON.parse(JSON.stringify(a.sim)) as ArenaSim;
      const ctx = createArenaContext(copy, content, simConfig);
      for (let t = at; t < total; t++) {
        if (t === cut) {
          const h = copy.health.find(
            (x) => 'building' in x && x.side === 0 && x.building === SRC,
          );
          if (h === undefined) throw new Error('no health entry');
          h.hp = 0;
        }
        stepArena(copy, ctx);
        expect(
          hashJson(copy),
          `restored at ${String(at)}, tick ${String(t + 1)}`,
        ).toBe(hashes[t + 1]);
      }
    }
  });
});

describe('a fallen Core removes no link', () => {
  test('the link keeps carrying after its owner Core falls', () => {
    const r = rig();
    const b = start(r.state);
    for (let t = 0; t < 40; t++) b.step();
    const core = b.sim.health.find((h) => 'core' in h && h.side === 0);
    if (core === undefined) throw new Error('no core');
    core.hp = 0;
    for (let t = 0; t < 5; t++) b.step();
    expect(ofType(b, 'core_destroyed').length).toBeGreaterThan(0);
    const delivered = (): number =>
      ofType(b, 'delivered').filter((e) => e.building === r.cons).length;
    const before = delivered();
    for (let t = 0; t < 400 && !b.isOver(); t++) {
      b.step();
      conserved(b);
    }
    expect(ofType(b, 'conduit_destroyed')).toEqual([]);
    expect(b.sim.teams[0].conduits).toHaveLength(2);
    expect(delivered()).toBeGreaterThan(before);
  });
});

describe('conduitsLostWith', () => {
  test('lists a link whole when either end building goes, and others not', () => {
    const r = rig();
    expect(conduitsLostWith(r.state.conduits, r.src)).toEqual([r.send, r.recv]);
    expect(conduitsLostWith(r.state.conduits, r.cons)).toEqual([
      r.send,
      r.recv,
    ]);
    expect(conduitsLostWith(r.state.conduits, 999)).toEqual([]);
  });

  test('a building with several links; a route building of the partner is left out', () => {
    const end = (building: number, side: 'north' | 'east' | 'south') => ({
      building,
      side,
    });
    const c = (
      id: number,
      owner: number,
      from: Conduit['from'],
      to: Conduit['to'],
    ): Conduit => ({ id, owner, from, to, cells: [] });
    const conduits: Conduit[] = [
      c(21, 0, end(1, 'east'), { border: 0, y: 3 }),
      c(22, 1, { border: 0, y: 3 }, end(11, 'south')),
      c(23, 0, end(1, 'north'), { border: 0, y: 5 }),
      c(24, 1, { border: 0, y: 5 }, end(12, 'south')),
      // The partner's route beyond its receiving building 11.
      c(25, 1, end(11, 'north'), end(14, 'south')),
      c(26, 0, end(2, 'north'), end(3, 'south')),
    ];
    expect(conduitsLostWith(conduits, 1)).toEqual([21, 22, 23, 24]);
    expect(conduitsLostWith(conduits, 12)).toEqual([23, 24]);
    expect(conduitsLostWith(conduits, 11)).toEqual([21, 22, 25]);
    expect(conduitsLostWith(conduits, 14)).toEqual([25]);
    expect(conduitsLostWith(conduits, 2)).toEqual([26]);
  });
});
