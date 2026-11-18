/**
 * The Rune Ward (issue #474, step 6/9 of #468): the Wardsmith's own defense.
 * Its battle behaviour is pinned by the `arena-sim.ward-*` golden vectors;
 * this file checks the content, the loader bounds and the shop rules.
 */
import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import { loadBuildings } from './buildings.js';
import { Rng } from './rng.js';
import { loadEconomyOrThrow } from './economy.js';
import { rollOffers } from './shop.js';
import { content, got } from './testing/support.js';
import economyJson from '../../../content/economy.json';

const economy = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
  specialists: content.specialists,
});

function wardDef() {
  const d = got(content.buildings.get('bld_rune_ward'));
  if (d.kind !== 'defense' || d.defenseType !== 'ward') throw new Error('kind');
  return d;
}

describe('the Rune Ward in content', () => {
  test('a 1x1 defense of type ward with one Power input on the south side', () => {
    const d = wardDef();
    expect(d.footprint).toEqual({ width: 1, height: 1 });
    expect(d.inputs).toEqual([{ resource: 'res_b', side: 'south' }]);
    expect(d.outputs).toEqual([]);
  });

  test('numbers of the three tiers (proposed, tuned in #477)', () => {
    const t = wardDef().tiers;
    expect(t.map((x) => x.reflectDamage)).toEqual([2, 3, 4]);
    expect(t.map((x) => x.costPerStrike)).toEqual([1, 1, 1]);
    expect(t.map((x) => x.health)).toEqual([120, 200, 300]);
    expect(t.map((x) => x.price)).toEqual([8, 18, 36]);
  });

  test('it is not a wall, so no wall rule and no wall bonus reaches it', () => {
    expect(wardDef().defenseType).not.toBe('wall');
  });
});

describe('ward tier bounds in the loader', () => {
  function load(patch: (b: Record<string, unknown>) => void): string {
    const raw = JSON.parse(JSON.stringify(buildingsJson)) as {
      buildings: Record<string, unknown>[];
    };
    patch(got(raw.buildings.find((b) => b['id'] === 'bld_rune_ward')));
    const r = loadBuildings(raw, {
      resources: content.resources,
      units: content.units,
    });
    return r.ok ? '' : r.errors.join('\n');
  }
  const tier = (b: Record<string, unknown>): Record<string, unknown> =>
    got((b['tiers'] as Record<string, unknown>[])[0]);

  test('the shipped content loads', () => {
    expect(load(() => undefined)).toBe('');
  });
  test('reflectDamage and costPerStrike are required integers from 1', () => {
    expect(load((b) => delete tier(b)['reflectDamage'])).toMatch(
      /reflectDamage/,
    );
    expect(load((b) => (tier(b)['reflectDamage'] = 0))).toMatch(
      /reflectDamage/,
    );
    expect(load((b) => delete tier(b)['costPerStrike'])).toMatch(
      /costPerStrike/,
    );
    expect(load((b) => (tier(b)['costPerStrike'] = 0))).toMatch(
      /costPerStrike/,
    );
    expect(load((b) => (tier(b)['costPerStrike'] = 1.5))).toMatch(
      /costPerStrike/,
    );
  });
  test('a ward needs exactly one input that names a resource, and no output', () => {
    expect(load((b) => (b['inputs'] = []))).toMatch(/ward needs/);
    expect(load((b) => (b['inputs'] = [{ side: 'south' }]))).toMatch(
      /must name a "resource"/,
    );
    expect(load((b) => (b['outputs'] = ['north']))).toMatch(/ward needs/);
  });
  test('the strike fields are not valid on a wall', () => {
    expect(
      load((b) => {
        b['defenseType'] = 'wall';
        b['inputs'] = [];
      }),
    ).toMatch(/reflectDamage/);
  });
});

describe('the Rune Ward in the shop (EC-3b, issue #291)', () => {
  const WARD = 'bld_rune_ward';
  test('only the Wardsmith is offered it, from round 2', () => {
    let seenByWardsmith = 0;
    for (let seed = 0; seed < 150; seed++) {
      for (const other of [null, 'spec_flowmancer', 'spec_alchemist']) {
        const r = rollOffers(Rng.fromSeed(seed), 4, content, economy, 0, other);
        expect(r.map((o) => o.def)).not.toContain(WARD);
      }
      const r1 = rollOffers(
        Rng.fromSeed(seed),
        1,
        content,
        economy,
        0,
        'spec_wardsmith',
      );
      expect(r1.map((o) => o.def)).not.toContain(WARD);
      const r2 = rollOffers(
        Rng.fromSeed(seed),
        2,
        content,
        economy,
        0,
        'spec_wardsmith',
      );
      seenByWardsmith += r2.filter((o) => o.def === WARD).length;
    }
    expect(seenByWardsmith).toBeGreaterThan(0);
  });

  test('it does not count towards the limit of wall shapes per set of offers', () => {
    // A Wardsmith's offers hold the Ward next to two different wall shapes
    // (the most one set may hold) in some roll.
    let found = false;
    for (let seed = 0; seed < 600 && !found; seed++) {
      const offers = rollOffers(
        Rng.fromSeed(seed),
        2,
        content,
        economy,
        0,
        'spec_wardsmith',
      );
      const walls = new Set(
        offers
          .map((o) => o.def)
          .filter((d) => {
            const def = content.buildings.get(d);
            return def?.kind === 'defense' && def.defenseType === 'wall';
          }),
      );
      expect(walls.size).toBeLessThanOrEqual(2);
      if (walls.size === 2 && offers.some((o) => o.def === WARD)) found = true;
    }
    expect(found).toBe(true);
  });
});
