import { describe, expect, test } from 'vitest';
import {
  addInt,
  addSaturating,
  clamp,
  compareFractions,
  divFloor,
  maxInt,
  minInt,
  modFloor,
  mulBps,
  mulDiv,
  mulInt,
  mulPct,
} from './int.js';

describe('int helpers', () => {
  test('addInt is exact to the safe limit and throws beyond it', () => {
    expect(addInt(2 ** 31, 2 ** 31)).toBe(2 ** 32);
    expect(addInt(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(addInt(-5, 3)).toBe(-2);
    expect(() => addInt(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => addInt(1.5, 1)).toThrow(RangeError);
  });

  test('mulDiv floors, including negatives', () => {
    expect(mulDiv(7, 3, 2)).toBe(10);
    expect(mulDiv(-7, 3, 2)).toBe(-11);
    expect(mulDiv(7, 3, -2)).toBe(-11);
    expect(mulDiv(-7, -3, 2)).toBe(10);
    expect(mulDiv(0, 5, -3)).toBe(0);
    expect(Object.is(mulDiv(0, 5, -3), 0)).toBe(true);
  });

  test('mulDiv throws on overflow, zero divisor and non-integers', () => {
    expect(() => mulDiv(2 ** 30, 2 ** 30, 1)).toThrow(RangeError);
    expect(() => mulDiv(1, 1, 0)).toThrow(RangeError);
    expect(() => mulDiv(1.5, 1, 1)).toThrow(RangeError);
    expect(mulDiv(2 ** 26, 2 ** 26, 2 ** 26)).toBe(2 ** 26);
  });

  test('divFloor and modFloor', () => {
    expect(divFloor(-1, 2)).toBe(-1);
    expect(modFloor(-1, 2)).toBe(1);
    expect(modFloor(7, -3)).toBe(-2);
    expect(divFloor(7, -3)).toBe(-3);
  });

  test('basis points and percent', () => {
    expect(mulBps(999, 2500)).toBe(249);
    expect(mulBps(100, 15000)).toBe(150);
    expect(mulPct(99, 50)).toBe(49);
  });

  test('clamp, min, max', () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-5, 1, 3)).toBe(1);
    expect(clamp(2, 1, 3)).toBe(2);
    expect(() => clamp(1, 3, 1)).toThrow(RangeError);
    expect(minInt(2, 3)).toBe(2);
    expect(maxInt(2, 3)).toBe(3);
    expect(() => minInt(1.2, 3)).toThrow(RangeError);
    expect(() => maxInt(NaN, 3)).toThrow(RangeError);
  });
});

describe('mulInt', () => {
  test('multiplies exactly and throws past the safe range', () => {
    expect(mulInt(3_000_000_000, 3)).toBe(9_000_000_000);
    expect(mulInt(-4, 0)).toBe(0);
    expect(Object.is(mulInt(-4, 0), 0)).toBe(true);
    expect(() => mulInt(2 ** 40, 2 ** 20)).toThrow(RangeError);
    expect(() => mulInt(1.5, 2)).toThrow(RangeError);
  });
});

describe('addSaturating', () => {
  test('adds exactly and stops at the cap', () => {
    expect(addSaturating(3, 4, 100)).toBe(7);
    expect(addSaturating(60, 40, 100)).toBe(100);
    expect(addSaturating(100, 100, 100)).toBe(100);
    const cap = 2 ** 52;
    expect(addSaturating(cap, 2 ** 51, cap)).toBe(cap);
    expect(addSaturating(cap - 1, 1, cap)).toBe(cap);
  });

  test('throws on negative, non-integer and out-of-range operands', () => {
    expect(() => addSaturating(-1, 1, 10)).toThrow(RangeError);
    expect(() => addSaturating(1.5, 1, 10)).toThrow(RangeError);
    expect(() => addSaturating(11, 1, 10)).toThrow(RangeError);
    expect(() => addSaturating(1, Number.MAX_SAFE_INTEGER, 10)).toThrow(
      RangeError,
    );
  });
});

describe('compareFractions', () => {
  const reference = (a: number, b: number, c: number, d: number): number => {
    const l = a * d;
    const r = c * b;
    return l < r ? -1 : l > r ? 1 : 0;
  };
  const exact = (a: number, b: number, c: number, d: number): number => {
    const l = BigInt(a) * BigInt(d);
    const r = BigInt(c) * BigInt(b);
    return l < r ? -1 : l > r ? 1 : 0;
  };

  test('basic cases', () => {
    expect(compareFractions(1, 2, 2, 4)).toBe(0);
    expect(compareFractions(1, 3, 1, 2)).toBe(-1);
    expect(compareFractions(2, 3, 1, 2)).toBe(1);
    expect(compareFractions(0, 5, 0, 9)).toBe(0);
    expect(compareFractions(0, 5, 1, 9)).toBe(-1);
    expect(compareFractions(7, 7, 9, 9)).toBe(0);
    expect(compareFractions(10, 3, 3, 1)).toBe(1);
  });

  test('matches the cross-multiplication reference on random small values', () => {
    let seed = 12345;
    const next = (m: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % m;
    };
    for (let i = 0; i < 20000; i++) {
      const m = 1 + next(i % 2 === 0 ? 12 : 3000);
      const a = next(m + 1) * next(3);
      const b = 1 + next(m);
      const c = next(m + 1) * next(3);
      const d = 1 + next(m);
      expect(
        compareFractions(a, b, c, d),
        `${String(a)}/${String(b)} ${String(c)}/${String(d)}`,
      ).toBe(reference(a, b, c, d));
    }
  });

  test('is exact near the 1e12 caps, where the product would be unsafe', () => {
    const M = 1_000_000_000_000;
    // Products near 1e24: far past 2^53, so a cross-multiplication would be wrong.
    const cases: [number, number, number, number][] = [
      [M, M, M - 1, M - 1],
      [M - 1, M, M - 2, M - 1],
      [M - 1, M, M - 2, M - 1],
      [M - 1, M - 1, M - 2, M - 2],
      [1, M, 1, M - 1],
      [1, M, 2, 2 * M],
      [M - 1, M, 999_999_999_999, 1_000_000_000_000],
      [123_456_789_012, 987_654_321_098, 123_456_789_013, 987_654_321_099],
      [500_000_000_000, M, 499_999_999_999, 999_999_999_999],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, 1, 1],
      [
        Number.MAX_SAFE_INTEGER - 1,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER - 2,
        Number.MAX_SAFE_INTEGER - 1,
      ],
    ];
    for (const [a, b, c, d] of cases) {
      expect(compareFractions(a, b, c, d)).toBe(exact(a, b, c, d));
      expect(compareFractions(c, d, a, b)).toBe(-exact(a, b, c, d) || 0);
    }
    // Fractions that differ only in the last place of the cross product.
    let seed = 99;
    const next = (m: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed * 4096 + (Math.imul(seed, 22695477) >>> 20)) % m;
    };
    for (let i = 0; i < 3000; i++) {
      const b = 1 + next(M);
      const d = 1 + next(M);
      const a = next(b + 1);
      const c =
        i % 2 === 0
          ? next(d + 1)
          : Math.min(d, Math.max(0, Math.floor((a * d) / b)));
      expect(compareFractions(a, b, c, d)).toBe(exact(a, b, c, d));
    }
  });

  test('rejects invalid input', () => {
    expect(() => compareFractions(1, 0, 1, 1)).toThrow(RangeError);
    expect(() => compareFractions(-1, 1, 1, 1)).toThrow(RangeError);
    expect(() => compareFractions(1.5, 1, 1, 1)).toThrow(RangeError);
  });
});
