import { describe, expect, test } from 'vitest';
import type { Json } from './hash.js';
import { makeBattleKind, parseSideOptionsPair } from './battle-kind.js';
import { content, mapgen, simConfig } from './test-support.js';

const bare = {
  map: {
    width: 24,
    height: 16,
    partySize: 1,
    plotWidth: 24,
    features: [],
    nodes: [],
  },
  ops: [{ op: 'placeCore', actor: 0, x: 11, y: 0 }],
};

const kind = makeBattleKind(content, mapgen, simConfig);
const run = (sideOptions: Json): unknown =>
  kind({ teamA: bare, teamB: bare, seed: 1, sideOptions });

describe('battle golden kind: sideOptions validation', () => {
  test('known fields of the right types are accepted', () => {
    expect(
      parseSideOptionsPair([
        null,
        {
          freePower: true,
          unitStrengthPercent: 10,
          coreHealths: [30000],
          scheduledWaves: [{ tick: 1, unit: 'unit_soldier', count: 2 }],
        },
      ]),
    ).toEqual([
      null,
      {
        freePower: true,
        unitStrengthPercent: 10,
        coreHealths: [30000],
        scheduledWaves: [{ tick: 1, unit: 'unit_soldier', count: 2 }],
      },
    ]);
  });

  test('unknown keys are rejected with a TypeError that names the key', () => {
    expect(() => run([{ coreHealht: 5 }, null])).toThrow(TypeError);
    expect(() => run([{ coreHealht: 5 }, null])).toThrow(/coreHealht/);
    expect(() => run([null, { freePower: true, extra: 1 }])).toThrow(
      /unknown key "extra" in sideOptions\[1\]/,
    );
    expect(() =>
      run([
        { scheduledWaves: [{ tick: 1, unit: 'unit_soldier', count: 1, n: 1 }] },
        null,
      ]),
    ).toThrow(/unknown key "n" in sideOptions\[0\]\.scheduledWaves\[0\]/);
  });

  test.each([
    [[{ coreHealth: '30000' }, null], /coreHealth/],
    [[{ coreHealths: [0] }, null], /coreHealth/],
    [[{ coreHealth: 1.5 }, null], /coreHealth/],
    [[{ freePower: 1 }, null], /freePower/],
    [[{ unitStrengthPercent: -1 }, null], /unitStrengthPercent/],
    [[{ scheduledWaves: {} }, null], /scheduledWaves/],
    [[{ scheduledWaves: [3] }, null], /scheduledWaves\[0\]/],
    [[{ scheduledWaves: [{ tick: 1, unit: 5, count: 1 }] }, null], /unit/],
    [[{ scheduledWaves: [{ tick: -1, unit: 'u', count: 1 }] }, null], /tick/],
    [[{ scheduledWaves: [{ tick: 1, unit: 'u', count: 1.5 }] }, null], /count/],
    [[[], null], /object or null/],
    [[{}], /list of two/],
    ['x', /list of two/],
  ] as [Json, RegExp][])('wrong shape %j is a TypeError', (bad, re) => {
    expect(() => run(bad)).toThrow(TypeError);
    expect(() => run(bad)).toThrow(re);
  });

  test('a valid sideOptions pair still runs a battle', () => {
    const r = run([{ coreHealths: [100] }, null]) as {
      result: { ok: boolean };
    };
    expect(r.result.ok).toBe(true);
  });
});
