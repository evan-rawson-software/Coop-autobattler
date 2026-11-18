/**
 * The Familiar Roost and the Familiar (issue #475, step 7/9 of #468): the
 * Beastbinder's own producer and unit. Battle behaviour is pinned by the
 * `arena-sim.familiar-*` golden vectors; this file checks the content, the
 * rebalance principle and the shop rules.
 */
import { describe, expect, test } from 'vitest';
import threatsJson from '../../../content/threats.json';
import economyJson from '../../../content/economy.json';
import { loadEconomyOrThrow } from './economy.js';
import { Rng } from './rng.js';
import { rollOffers } from './shop.js';
import { content, got } from './testing/support.js';

const economy = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
  specialists: content.specialists,
});
const ROOST = 'bld_familiar_roost';
const familiar = () => got(content.units.get('unit_familiar'));

describe('the Familiar in content', () => {
  test('fast and fragile: the shortest move cooldown of any ground unit', () => {
    const f = familiar();
    const soldier = got(content.units.get('unit_soldier'));
    expect(f).toMatchObject({
      health: 20,
      damage: 5,
      moveCooldownTicks: 3,
      flying: false,
      attackType: 'melee',
      armor: 0,
    });
    expect(f.reach).toBe(soldier.reach);
    expect(f.health).toBe(soldier.health / 2);
    expect(f.damage).toBeLessThan(soldier.damage);
    for (const u of content.units.list()) {
      if (u.id !== f.id && !u.flying) {
        expect(f.moveCooldownTicks).toBeLessThan(u.moveCooldownTicks);
      }
    }
  });

  test('no threat composition or signature uses it: it is player-only', () => {
    expect(JSON.stringify(threatsJson)).not.toContain('unit_familiar');
  });
});

describe('the Familiar Roost in content', () => {
  test('a 1x2 producer of Familiars with a Power input on the south side', () => {
    const d = got(content.buildings.get(ROOST));
    if (d.kind !== 'unit_producer') throw new Error('kind');
    expect(d.unit).toBe('unit_familiar');
    expect(d.footprint).toEqual({ width: 1, height: 2 });
    expect(d.inputs).toEqual([{ resource: 'res_b', side: 'south' }]);
    expect(d.outputs).toEqual([]);
    expect(d.tiers.map((t) => t.price)).toEqual([20, 40, 70]);
  });

  test('one Extractor of its tier feeds exactly one Roost (SC-13a)', () => {
    const d = got(content.buildings.get(ROOST));
    const ext = got(content.buildings.get('bld_extractor'));
    if (d.kind !== 'unit_producer' || ext.kind !== 'source') {
      throw new Error('kind');
    }
    d.tiers.forEach((t, i) => {
      const source = got(ext.tiers[i]);
      // Items needed per tick: costPerUnit / interval, against 1 / intervalTicks.
      expect(t.costPerUnit * source.intervalTicks).toBe(
        t.productionIntervalTicks,
      );
    });
  });
});

describe('the Familiar Roost in the shop (EC-3b)', () => {
  test('only the Beastbinder is offered it, from round 2', () => {
    let seen = 0;
    for (let seed = 0; seed < 150; seed++) {
      for (const other of [null, 'spec_flowmancer', 'spec_wardsmith']) {
        const r = rollOffers(Rng.fromSeed(seed), 4, content, economy, 0, other);
        expect(r.map((o) => o.def)).not.toContain(ROOST);
      }
      const r1 = rollOffers(
        Rng.fromSeed(seed),
        1,
        content,
        economy,
        0,
        'spec_beastbinder',
      );
      expect(r1.map((o) => o.def)).not.toContain(ROOST);
      const r2 = rollOffers(
        Rng.fromSeed(seed),
        2,
        content,
        economy,
        0,
        'spec_beastbinder',
      );
      seen += r2.filter((o) => o.def === ROOST).length;
    }
    expect(seen).toBeGreaterThan(0);
  });
});
