import { describe, expect, test } from 'vitest';
import {
  clamp,
  divFloor,
  maxInt,
  minInt,
  modFloor,
  mulBps,
  mulDiv,
  mulPct,
} from './int.js';

describe('int helpers', () => {
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
