import { describe, expect, test } from 'vitest';
import { loadResources, loadResourcesOrThrow } from './resources.js';

const valid = {
  resources: [
    { id: 'res_a', name: 'Alpha', rarity: 'common' },
    { id: 'res_b', name: 'Beta', rarity: 'rare', color: '#112233', icon: 'b' },
    {
      id: 'res_b_refined',
      name: 'Gamma',
      rarity: 'rare',
      refinedFrom: ['res_a', 'res_b'],
    },
  ],
};

function errorsFor(data: unknown): readonly string[] {
  const result = loadResources(data);
  if (result.ok) throw new Error('expected failure');
  return result.errors;
}

function withResources(...resources: unknown[]): unknown {
  return { resources };
}

describe('loadResources', () => {
  test('loads a valid configuration and offers helpers', () => {
    const config = loadResourcesOrThrow(valid);
    expect(config.list().map((r) => r.id)).toEqual([
      'res_a',
      'res_b',
      'res_b_refined',
    ]);
    expect(config.listBase().map((r) => r.id)).toEqual(['res_a', 'res_b']);
    expect(config.get('res_b')?.rarity).toBe('rare');
    expect(config.get('nope')).toBeUndefined();
    expect(config.displayName('res_a')).toBe('Alpha');
    expect(() => config.displayName('nope')).toThrow(/Unknown resource ID/);
  });

  test('renaming in data changes helper output with no other edits', () => {
    const renamed = {
      resources: valid.resources.map((r) => ({ ...r, name: `${r.name}!` })),
    };
    const config = loadResourcesOrThrow(renamed);
    expect(config.list().map((r) => config.displayName(r.id))).toEqual([
      'Alpha!',
      'Beta!',
      'Gamma!',
    ]);
  });

  test('rejects non-object input and missing list', () => {
    expect(errorsFor(null)[0]).toMatch(/"resources" array/);
    expect(errorsFor({})[0]).toMatch(/"resources" array/);
    expect(errorsFor({ resources: [] })[0]).toMatch(/must not be empty/);
  });

  test('rejects duplicate IDs', () => {
    const errors = errorsFor(
      withResources(
        { id: 'res_a', name: 'A', rarity: 'common' },
        { id: 'res_a', name: 'B', rarity: 'common' },
      ),
    );
    expect(errors.join('\n')).toMatch(/duplicate id "res_a"/);
  });

  test('rejects missing and empty names', () => {
    const errors = errorsFor(
      withResources(
        { id: 'res_a', rarity: 'common' },
        { id: 'res_b', name: '  ', rarity: 'common' },
      ),
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/missing or empty "name"/);
  });

  test('rejects unknown refinedFrom IDs', () => {
    const errors = errorsFor(
      withResources(
        { id: 'res_a', name: 'A', rarity: 'common' },
        { id: 'res_b', name: 'B', rarity: 'common', refinedFrom: ['res_zzz'] },
      ),
    );
    expect(errors.join('\n')).toMatch(/unknown resource ID "res_zzz"/);
  });

  test('rejects a resource that lists itself in refinedFrom', () => {
    const errors = errorsFor(
      withResources({
        id: 'res_a',
        name: 'A',
        rarity: 'common',
        refinedFrom: ['res_a'],
      }),
    );
    expect(errors.join('\n')).toMatch(/lists itself/);
  });

  test('rejects more than two refinedFrom entries', () => {
    const errors = errorsFor(
      withResources(
        { id: 'res_a', name: 'A', rarity: 'common' },
        { id: 'res_b', name: 'B', rarity: 'common' },
        { id: 'res_c', name: 'C', rarity: 'common' },
        {
          id: 'res_d',
          name: 'D',
          rarity: 'common',
          refinedFrom: ['res_a', 'res_b', 'res_c'],
        },
      ),
    );
    expect(errors.join('\n')).toMatch(/at most 2/);
  });

  test('rejects unknown rarity values', () => {
    const errors = errorsFor(
      withResources({ id: 'res_a', name: 'A', rarity: 'legendary' }),
    );
    expect(errors.join('\n')).toMatch(/unknown rarity "legendary"/);
  });

  test('loadResourcesOrThrow lists every problem', () => {
    expect(() =>
      loadResourcesOrThrow(withResources({ id: '', rarity: 'x' })),
    ).toThrow(/Invalid resource configuration/);
  });
});
