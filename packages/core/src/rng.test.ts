import { describe, expect, test } from 'vitest';
import { Rng } from './rng.js';

describe('Rng', () => {
  test('first outputs are pinned for known seeds', () => {
    const first = (seed: number) => {
      const r = Rng.fromSeed(seed);
      return Array.from({ length: 4 }, () => r.nextU32());
    };
    expect(first(0)).toEqual([1789933344, 44971166, 2521387044, 3848737593]);
    expect(first(1)).not.toEqual(first(2));
  });

  test('seeding step is pinned (splitmix32 of seed 0)', () => {
    expect(Rng.fromSeed(0).getState()).toEqual([
      0x64625032, 0xd9c0799c, 0xaf362e10, 0x7fa88912,
    ]);
  });

  test('state serialization round trip continues the same sequence', () => {
    const a = Rng.fromSeed(77);
    for (let i = 0; i < 13; i++) a.nextU32();
    const saved = JSON.parse(JSON.stringify(a.getState())) as number[];
    const b = Rng.fromState(saved);
    const fromA = Array.from({ length: 50 }, () => a.nextInt(1000));
    const fromB = Array.from({ length: 50 }, () => b.nextInt(1000));
    expect(fromB).toEqual(fromA);
    const uninterrupted = Rng.fromSeed(77);
    for (let i = 0; i < 13; i++) uninterrupted.nextU32();
    expect(
      Array.from({ length: 50 }, () => uninterrupted.nextInt(1000)),
    ).toEqual(fromA);
  });

  test('nextInt stays in range and covers it', () => {
    const r = Rng.fromSeed(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const x = r.nextInt(7);
      expect(Number.isInteger(x) && x >= 0 && x < 7).toBe(true);
      seen.add(x);
    }
    expect(seen.size).toBe(7);
    expect(Rng.fromSeed(1).nextInt(1)).toBe(0);
  });

  test('nextInt rejects bad bounds', () => {
    const r = Rng.fromSeed(1);
    for (const bad of [0, -1, 1.5, 2 ** 32, NaN]) {
      expect(() => r.nextInt(bad)).toThrow(RangeError);
    }
  });

  test('shuffle returns a permutation and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = Rng.fromSeed(3).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  test('pick works and throws on empty', () => {
    expect(['a', 'b']).toContain(Rng.fromSeed(1).pick(['a', 'b']));
    expect(() => Rng.fromSeed(1).pick([])).toThrow(RangeError);
  });

  test('child streams are independent of the parent and each other', () => {
    const parent = Rng.fromSeed(9);
    const before = parent.getState();
    const map = parent.child('map');
    const shop = parent.child('shop');
    expect(parent.getState()).toEqual(before);
    expect(map.nextU32()).not.toBe(shop.nextU32());
    expect(Rng.fromSeed(9).child('map').nextU32()).toBe(
      Rng.fromSeed(9).child('map').nextU32(),
    );
    expect(Rng.fromSeed(9).child(1).getState()).not.toEqual(
      Rng.fromSeed(9).child('1').getState(),
    );
  });

  test('fromState / fromSeed validate input', () => {
    expect(() => Rng.fromState([0, 0, 0, 0])).toThrow(RangeError);
    expect(() => Rng.fromState([1, 2, 3])).toThrow(RangeError);
    expect(() => Rng.fromSeed(-1)).toThrow(RangeError);
    expect(() => Rng.fromSeed(1.5)).toThrow(RangeError);
  });
});
