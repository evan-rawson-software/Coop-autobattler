import {
  createTeamState,
  generateMap,
  listLegalCorePositions,
  overloadDeadline,
  overloadOutcome,
  placeCore,
  type TeamState,
} from '@game/core';
import type { ComponentChildren, VNode } from 'preact';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { overloadLine } from '../choice/overload.js';
import { clock, coreMaxima, sideStats } from './derive.js';
import { CoreBars } from './panels.js';
import { Playback, simulateRecord } from './playback.js';
import { battleConfig } from './setup.js';
import type { BattleDescription } from './types.js';

/** A team with only its Cores: nothing fights, so Overload decides. */
const bare = (seed: number, players: number): TeamState => {
  const map = generateMap(seed, players, content, content.mapgen);
  let state = createTeamState(map);
  for (let p = 0; p < players; p++) {
    const placed = listLegalCorePositions(map, content, content.mapgen, p)
      .map((pos) => placeCore(state, content, content.mapgen, p, pos))
      .find((r) => r.ok);
    if (!placed?.ok) throw new Error('no Core spot');
    state = placed.state;
  }
  return state;
};

const describeBare = (
  players: number,
  healthA: readonly number[],
  healthB: readonly number[],
): BattleDescription => ({
  kind: 'versus',
  input: {
    teamA: bare(3, players),
    teamB: bare(4, players),
    seed: 9,
    sideOptions: [{ coreHealths: healthA }, { coreHealths: healthB }],
  },
});

const record = (d: BattleDescription) => {
  const r = simulateRecord(d, content, battleConfig);
  if (!r.ok) throw new Error(r.error.message);
  return r.record;
};

type Node = { field: string; cls: string };
/** The `data-field` and `class` of every field in a rendered tree. */
const walk = (node: ComponentChildren, out: Node[] = []): Node[] => {
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }
  if (Array.isArray(node)) {
    for (const n of node) walk(n as ComponentChildren, out);
    return out;
  }
  const v = node as VNode<Record<string, unknown>>;
  const f = v.props['data-field'];
  if (typeof f === 'string') {
    const c = v.props['class'];
    out.push({ field: f, cls: typeof c === 'string' ? c : '' });
  }
  if (typeof v.type === 'function') {
    return walk((v.type as (p: unknown) => ComponentChildren)(v.props), out);
  }
  walk(v.props['children'], out);
  return out;
};

const barsOf = (pb: Playback, side: 0 | 1): Node[] => {
  const s = sideStats(pb, content, side, battleConfig.sim.ticksPerSecond);
  return walk(
    CoreBars({
      label: 'Core',
      cores: s.cores,
      hp: s.coreHp,
      max: s.coreMax,
      side,
    }),
  );
};
const perCore = (nodes: Node[], side: 0 | 1) =>
  nodes.filter((n) => n.field.startsWith(`core-hp-${String(side)}-`));

describe('Core bars of a four-plot and a solo battle', () => {
  const d = describeBare(4, [300, 400, 500, 600], [700, 800, 900, 1000]);
  const rec = record(d);
  const pb = new Playback(d, content, battleConfig, rec);

  test('four against four: eight per-player bars', () => {
    const a = barsOf(pb, 0);
    const b = barsOf(pb, 1);
    expect(perCore(a, 0)).toHaveLength(4);
    expect(perCore(b, 1)).toHaveLength(4);
    expect(a.some((n) => n.field === 'cores-0')).toBe(true);
    expect(b.some((n) => n.field === 'cores-1')).toBe(true);
  });

  test('after a Core falls its bar reads fallen and the battle goes on; it ends when a side has none', () => {
    const falls = rec.eventLog.filter((e) => e.type === 'core_destroyed');
    const first = falls[0];
    if (first === undefined) throw new Error('no Core fell');
    expect(first.side).toBe(0);
    expect(rec.result.endTick).toBeGreaterThan(first.tick + 1);
    pb.seekTo(first.tick + 1);
    expect(pb.finished).toBe(false);
    const nodes = barsOf(pb, 0);
    expect(perCore(nodes, 0)).toHaveLength(4);
    expect(nodes.filter((n) => n.cls.includes('fallen'))).toHaveLength(1);
    expect(
      nodes.find((n) => n.field === `core-0-${String(first.core)}`)?.cls,
    ).toContain('fallen');
    pb.skip();
    expect(pb.finished).toBe(true);
    expect(rec.result.reason).toBe('core_destroyed');
    const standing = rec.summary.sides.map((s) => s.coresStanding);
    expect(Math.min(...standing)).toBe(0);
    expect(Math.max(...standing)).toBeGreaterThan(0);
    expect(falls[falls.length - 1]?.tick).toBe(rec.result.endTick - 1);
  }, 120_000);

  test('a solo battle has exactly one bar per side', () => {
    const solo = describeBare(1, [500], [700]);
    const p = new Playback(solo, content, battleConfig, record(solo));
    for (const side of [0, 1] as const) {
      const nodes = barsOf(p, side);
      expect(perCore(nodes, side)).toHaveLength(0);
      expect(nodes.some((n) => n.field.startsWith('cores-'))).toBe(false);
      expect(
        nodes.filter((n) => n.field === `core-hp-${String(side)}`),
      ).toHaveLength(1);
    }
  }, 120_000);
});

describe('the Overload line against the simulation', () => {
  const sim = battleConfig.sim;
  const cases: [string, number, number[], number[]][] = [
    ['three Cores, side A runs out first', 3, [300, 450, 600], [700, 800, 900]],
    [
      'four Cores, side B runs out first',
      4,
      [900, 800, 700, 600],
      [300, 400, 500, 450],
    ],
  ];
  for (const [name, players, ha, hb] of cases) {
    test(
      name,
      () => {
        const rec = record(describeBare(players, ha, hb));
        const maxA = coreMaxima(rec, 0);
        const maxB = coreMaxima(rec, 1);
        expect(maxA).toEqual(ha);
        expect(maxB).toEqual(hb);
        const maxima = [maxA, maxB];
        const falls = rec.eventLog.filter((e) => e.type === 'core_destroyed');
        // Under Overload alone, each Core falls on its own deadline.
        for (const f of falls) {
          const max = maxima[f.side]?.[f.core];
          if (max === undefined) throw new Error('unknown Core');
          expect(f.tick, `${String(f.side)}:${String(f.core)}`).toBe(
            overloadDeadline(sim, max).decayDestroysTick,
          );
        }
        // The side whose last Core really falls first, at that tick.
        const loser = rec.result.winner === 0 ? 1 : 0;
        const lastFall = Math.max(
          ...falls.filter((f) => f.side === loser).map((f) => f.tick),
        );
        const out = overloadOutcome(sim, maxA, maxB);
        expect(out.first).toBe(loser === 0 ? 'a' : 'b');
        expect(out.tick).toBe(lastFall);
        expect(rec.result.endTick).toBe(lastFall + 1);
        const line = overloadLine(sim, maxA, maxB);
        expect(line).toContain(clock(lastFall, sim.ticksPerSecond));
        expect(line).toContain(
          loser === 0 ? 'Yours falls first' : 'Theirs falls first',
        );
      },
      120_000,
    );
  }
});
