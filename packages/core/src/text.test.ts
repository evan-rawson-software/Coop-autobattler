import { describe, expect, test } from 'vitest';
import { loadResourcesOrThrow } from './resources.js';
import { formatText, placeholderIds } from './text.js';

const resources = loadResourcesOrThrow({
  resources: [
    { id: 'res_a', name: 'Alpha', rarity: 'common' },
    { id: 'res_b', name: 'Beta', rarity: 'common' },
  ],
});

describe('formatText', () => {
  test('substitutes resource names, including repeats', () => {
    expect(
      formatText('Uses {res_a} and {res_b}, then {res_a}.', resources),
    ).toBe('Uses Alpha and Beta, then Alpha.');
  });

  test('leaves other text and braces alone', () => {
    expect(formatText('No placeholders { here } {x} {res_A}', resources)).toBe(
      'No placeholders { here } {x} {res_A}',
    );
    expect(formatText('', resources)).toBe('');
  });

  test('follows renames in the resource data', () => {
    const renamed = loadResourcesOrThrow({
      resources: [{ id: 'res_a', name: 'Zed', rarity: 'common' }],
    });
    expect(formatText('{res_a}', renamed)).toBe('Zed');
  });

  test('throws on an unknown resource', () => {
    expect(() => formatText('{res_zzz}', resources)).toThrow(
      /Unknown resource ID/,
    );
  });

  test('placeholderIds lists mentions in order', () => {
    expect(placeholderIds('{res_b} {res_a} {res_b}')).toEqual([
      'res_b',
      'res_a',
      'res_b',
    ]);
  });
});
