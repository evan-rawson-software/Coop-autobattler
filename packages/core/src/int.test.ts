import { describe, expect, test } from 'vitest';
import {
  addInt,
  clamp,
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
