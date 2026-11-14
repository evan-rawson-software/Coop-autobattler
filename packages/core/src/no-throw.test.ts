/**
 * The non-throwing variants give exactly the result of the throwing ones:
 * the value where those return, null where they throw.
 */
import { describe, expect, test } from 'vitest';
import { canonicalJson, canonicalJsonOrNull } from './hash.js';
import { content } from './testing/support.js';
import { hasLoneSurrogate, utf8Bytes } from './utf8.js';
import { workshopPrice, workshopPriceOrNull } from './workshop.js';

function orNull<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

describe('non-throwing variants', () => {
  test('canonicalJsonOrNull matches canonicalJson', () => {
    const values: unknown[] = [
      null,
      true,
      0,
      -0,
      1.5,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 1,
      NaN,
      'a"\\\n\u0001é😀',
      '\ud800',
      'x\udc00y',
      [1, 'a', [null]],
      [1, undefined],
      { b: 1, a: [2, { c: '\ud800' }] },
      { a: undefined },
      { a: () => 1 },
      new Map(),
      Object.create(null) as unknown,
      [{ z: 1, y: { x: [3n] } }],
    ];
    for (const v of values) {
      expect(canonicalJsonOrNull(v)).toBe(orNull(() => canonicalJson(v)));
    }
  });

  test('hasLoneSurrogate matches the utf8Bytes check', () => {
    for (const s of [
      '',
      'abc',
      '😀',
      '\ud800',
      '\udc00',
      'a\ud800b',
      '😀\ud83d',
    ]) {
      expect(hasLoneSurrogate(s)).toBe(orNull(() => utf8Bytes(s)) === null);
    }
  });

  test('workshopPriceOrNull matches workshopPrice', () => {
    const defs = [...content.buildings.list().map((b) => b.id), 'bld_nope'];
    const tiers = [-1, 0, 1, 2, 3, 4, 1.5, NaN];
    const percents = [0, 80, 100, 1.5, NaN, Number.MAX_SAFE_INTEGER];
    for (const def of defs) {
      for (const tier of tiers) {
        for (const pct of percents) {
          expect(workshopPriceOrNull(content, def, tier, pct)).toBe(
            orNull(() => workshopPrice(content, def, tier, pct)),
          );
        }
      }
    }
  });
});
