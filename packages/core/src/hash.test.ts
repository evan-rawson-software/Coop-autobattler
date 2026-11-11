import { describe, expect, test } from 'vitest';
import { canonicalJson, fnv1a32, hashJson } from './hash.js';
import { utf8Bytes } from './utf8.js';

describe('canonical JSON and hash', () => {
  test('sorts keys, no whitespace', () => {
    expect(canonicalJson({ b: [1, { z: null, a: true }], a: 'x' })).toBe(
      '{"a":"x","b":[1,{"a":true,"z":null}]}',
    );
  });

  test('key order does not matter', () => {
    expect(hashJson({ a: 1, b: 2 })).toBe(hashJson({ b: 2, a: 1 }));
  });

  test('string escaping', () => {
    expect(canonicalJson('a"\\\n\u0001\u007fé')).toBe(
      '"a\\"\\\\\\n\\u0001\u007fé"',
    );
  });

  test('rejects non-integers and unsupported values', () => {
    for (const bad of [
      1.5,
      NaN,
      Infinity,
      -0,
      undefined,
      () => 1,
      1n,
      Symbol('x'),
      new Date(0),
      new Map(),
      2 ** 60,
      '\ud800',
    ]) {
      expect(() => canonicalJson(bad)).toThrow();
    }
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson([undefined])).toThrow();
  });

  test('FNV-1a known vectors', () => {
    expect(fnv1a32([])).toBe(0x811c9dc5);
    expect(fnv1a32(utf8Bytes('a'))).toBe(0xe40c292c);
    expect(fnv1a32(utf8Bytes('foobar'))).toBe(0xbf9cf968);
  });

  test('hash format is 8 lowercase hex chars and pinned', () => {
    expect(hashJson([])).toMatch(/^[0-9a-f]{8}$/);
    expect(hashJson(null)).toBe('77074ba4');
    expect(hashJson({ a: 1 })).toBe('8b9e4511');
  });

  test('utf8Bytes', () => {
    expect(utf8Bytes('é')).toEqual([0xc3, 0xa9]);
    expect(utf8Bytes('€')).toEqual([0xe2, 0x82, 0xac]);
    expect(utf8Bytes('\u{1F600}')).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });
});
