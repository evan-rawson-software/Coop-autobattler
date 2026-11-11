import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Json } from '@game/core';
import { goldenKinds } from './kinds.js';

const kind = goldenKinds['battle'] as (input: Json) => { result: Json };

interface Side {
  readonly buildingDamageDealt: number;
  readonly unitsKilled: number;
  readonly coreHealth: number;
}
interface Out {
  readonly result: {
    readonly result: { winner: number; reason: string; endTick: number };
    readonly summary: { sides: [Side, Side] };
  };
}

describe('time-limit ladder vectors (mutation coverage)', () => {
  const vectors = JSON.parse(
    readFileSync(new URL('../../../golden/battle.json', import.meta.url), 'utf8'),
  ) as { id: string; input: Json }[];
  const play = (id: string): Out => {
    const v = vectors.find((x) => x.id === id);
    if (v === undefined) throw new Error(`missing vector ${id}`);
    return kind(v.input) as unknown as Out;
  };

  test.each([
    ['battle.time-limit-fraction-side0', 0],
    ['battle.time-limit-fraction-side1', 1],
  ])('%s: the Core health fraction decides before the ladder', (id, winner) => {
    const { result, summary } = play(id).result;
    expect(result).toEqual({ winner, reason: 'time_limit', endTick: 12000 });
    const [a, b] = summary.sides;
    // The winner has the healthier Core but the loser has dealt more
    // building damage: a ladder that ran first would pick the loser.
    const w = winner === 0 ? a : b;
    const l = winner === 0 ? b : a;
    expect(w.coreHealth).toBeGreaterThan(l.coreHealth);
    expect(l.buildingDamageDealt).toBeGreaterThan(w.buildingDamageDealt);
  });

  test.each([
    ['battle.time-limit-building-damage', 1, 'tiebreak_building_damage'],
    ['battle.time-limit-kills', 1, 'tiebreak_kills'],
    ['battle.time-limit-attacker', 0, 'tiebreak_attacker'],
  ])('%s: equal fractions go down the ladder', (id, winner, reason) => {
    const { result, summary } = play(id).result;
    expect(result).toEqual({ winner, reason, endTick: 12000 });
    expect(summary.sides[0].coreHealth).toBe(summary.sides[1].coreHealth);
  });
});
