import { describe, expect, test } from 'vitest';
import type { Json } from '@game/core';
import { content, mapgen, simConfig } from '../kinds.js';
import { makeFlowSimKind } from './flow-sim.js';

describe('golden kind flow-sim: take validation', () => {
  const run = makeFlowSimKind(content, mapgen, simConfig);
  const base = { seed: 1, partySize: 1, ops: [], ticks: 0, consumers: 'hold' };
  const withTake = (take: Json): Json => ({ ...base, take });

  test('a valid take is accepted', () => {
    expect(() =>
      run(withTake({ building: 4, side: 'south', every: 25 })),
    ).not.toThrow();
  });

  test.each([
    ['a fractional building', { building: 1.5, side: 'south', every: 2 }],
    ['a string building', { building: '4', side: 'south', every: 2 }],
    ['a missing building', { side: 'south', every: 2 }],
    ['an unknown side', { building: 4, side: 'up', every: 2 }],
    ['a numeric side', { building: 4, side: 3, every: 2 }],
    ['a fractional every', { building: 4, side: 'south', every: 2.5 }],
    ['every below 1', { building: 4, side: 'south', every: 0 }],
    ['a non-object take', 7],
    ['a null take', null],
  ] as [string, Json][])('%s is rejected', (_name, take) => {
    expect(() => run(withTake(take))).toThrow(TypeError);
  });
});
