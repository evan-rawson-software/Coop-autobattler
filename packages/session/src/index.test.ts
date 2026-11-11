import { expect, test } from 'vitest';
import { add } from './index.js';

test('session re-exports core', () => {
  expect(add(1, 1)).toBe(2);
});
