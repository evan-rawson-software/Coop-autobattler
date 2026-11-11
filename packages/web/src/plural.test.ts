import { describe, expect, test } from 'vitest';
import { count, plural } from './plural.js';

describe('plurals', () => {
  test('one is singular, everything else plural', () => {
    expect(count(1, 'wall')).toBe('1 wall');
    expect(count(0, 'wall')).toBe('0 walls');
    expect(count(2, 'turret')).toBe('2 turrets');
    expect(count(1, 'life', 'lives')).toBe('1 life');
    expect(plural(3, 'life', 'lives')).toBe('lives');
  });
});
