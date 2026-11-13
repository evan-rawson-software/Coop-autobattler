import { describe, expect, test } from 'vitest';
import { MIN_SPRITE_PX, spriteHalf, spriteReach } from './sprite-size.js';

describe('unit sprite size', () => {
  test('never draws a box smaller than the minimum', () => {
    for (const r of [0, 2, 2.5, 4, 7.9, 8, 12]) {
      for (const diagonal of [false, true]) {
        expect(spriteHalf(r, diagonal) * 2).toBeGreaterThanOrEqual(
          MIN_SPRITE_PX,
        );
      }
    }
  });

  test('is unchanged above the minimum, with the diagonal shrink first', () => {
    expect(spriteHalf(20, false)).toBe(20);
    expect(spriteHalf(20, true)).toBeCloseTo(20 * Math.SQRT1_2);
    // 10 px radius turned: 7.07 would be below 8, so the floor wins.
    expect(spriteHalf(10, true)).toBe(8);
    expect(spriteHalf(10, false)).toBe(10);
  });

  test('health bars clear a floored sprite, and nothing else moves', () => {
    expect(spriteReach(2)).toBeCloseTo(8 * Math.SQRT2);
    expect(spriteReach(20)).toBe(0);
  });
});
