/** Version comparison used by the ghost pool purge (`removeOlderVersions`). */
import { describe, expect, test } from 'vitest';
import { isLowerBucketVersion } from './ghost-store.js';

const lower = (bucketVersion: string, keep: string, rest = '|2|3') =>
  isLowerBucketVersion(`${bucketVersion}${rest}`, keep);

describe('isLowerBucketVersion', () => {
  test('compares parts numerically, not as strings', () => {
    expect(lower('1.9', '1.10')).toBe(true);
    expect(lower('1.10', '1.9')).toBe(false);
    expect(lower('2.0', '10.0')).toBe(true);
  });

  test('equal versions are not lower, a missing part counts as 0', () => {
    expect(lower('1.0', '1.0')).toBe(false);
    expect(lower('1', '1.0')).toBe(false);
    expect(lower('1.0', '1')).toBe(false);
    expect(lower('1.0.1', '1.0')).toBe(false);
    expect(lower('1.0', '1.0.1')).toBe(true);
  });

  test('a higher version is never lower', () => {
    expect(lower('2.0', '1.0')).toBe(false);
    expect(lower('1.1', '1.0')).toBe(false);
  });

  test('a bucket with an unreadable version counts as lower', () => {
    for (const v of ['', 'x', '1.x', '1.', '.1', '1..0', '-1.0', '1.0-beta']) {
      expect(lower(v, '1.0')).toBe(true);
    }
    expect(isLowerBucketVersion('', '1.0')).toBe(true);
  });

  test('a bucket key without a separator is read as a bare version', () => {
    expect(isLowerBucketVersion('0.9', '1.0')).toBe(true);
    expect(isLowerBucketVersion('1.0', '1.0')).toBe(false);
  });

  test('a malformed keepVersion makes nothing lower', () => {
    for (const keep of ['', 'x', '1.', '.1', '1..0', '1.x', '-1']) {
      expect(lower('0.1', keep)).toBe(false);
      expect(lower('', keep)).toBe(false);
    }
  });
});
