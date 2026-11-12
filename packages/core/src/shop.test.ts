import { describe, expect, test } from 'vitest';
import economyJson from '../../../content/economy.json';
import {
  loadEconomy,
  loadEconomyOrThrow,
  type EconomyConfig,
} from './economy.js';
import { generateMap } from './generate-map.js';
import { listLegalCorePositions } from './map.js';
import { Rng } from './rng.js';
import {
  buyOffer,
  rerollOffers,
  rollOffers,
  sellFromStash,
  sellValue,
  tierOddsFor,
  type PlayerShop,
} from './shop.js';
import {
  addToStash,
  createTeamState,
  placeCore,
  placeFromStash,
} from './team-state.js';
import { content, mapgen } from './test-support.js';
import { pickWeightedIndex } from './weighted.js';

const economy = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
});

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function newTeam(partySize = 2) {
  return createTeamState(generateMap(5, partySize, content, mapgen));
}

function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error('missing');
  return v;
}

describe('loadEconomy', () => {
  const ctx = { buildings: content.buildings };
  function errorsFor(change: (d: Record<string, unknown>) => void): string {
    const d = clone(economyJson) as unknown as Record<string, unknown>;
    change(d);
    const r = loadEconomy(d, ctx);
    return r.ok ? '' : r.errors.join('\n');
  }
  type Rows = Record<string, unknown>[];
  test('the shipped file loads', () => {
    expect(loadEconomy(economyJson, ctx).ok).toBe(true);
  });
  test('rejects an unknown building in offerWeights', () => {
    const e = errorsFor((d) => {
      at(d['offerWeights'] as Rows, 0)['def'] = 'bld_nope';
    });
    expect(e).toContain('unknown building "bld_nope"');
  });
  test('rejects the Core, duplicates and non-positive weights', () => {
    expect(
      errorsFor((d) => {
        at(d['offerWeights'] as Rows, 0)['def'] = 'bld_core';
      }),
    ).toContain('Core');
    expect(
      errorsFor((d) => {
        at(d['offerWeights'] as Rows, 1)['def'] = 'bld_extractor';
      }),
    ).toContain('duplicate');
    expect(
      errorsFor((d) => {
        at(d['offerWeights'] as Rows, 0)['weight'] = 0;
      }),
    ).toContain('"weight"');
  });
  test('rejects a tierOdds table that does not start at round 1', () => {
    expect(
      errorsFor((d) => {
        at(d['tierOdds'] as Rows, 0)['fromRound'] = 2;
      }),
    ).toContain('must start at round 1');
  });
  test('rejects unsorted tierOdds, bad weights and zero sums', () => {
    expect(
      errorsFor((d) => {
        at(d['tierOdds'] as Rows, 2)['fromRound'] = 3;
      }),
    ).toContain('greater than the previous');
    expect(
      errorsFor((d) => {
        at(d['tierOdds'] as Rows, 0)['weights'] = [0, 0, 0];
      }),
    ).toContain('positive sum');
    expect(
      errorsFor((d) => {
        at(d['tierOdds'] as Rows, 0)['weights'] = [1, -1, 0];
      }),
    ).toContain('non-negative');
  });
  test('rejects bad kit entries', () => {
    expect(
      errorsFor((d) => {
        at(d['startingKit'] as Rows, 0)['tier'] = 4;
      }),
    ).toContain('tier');
  });
});

describe('pickWeightedIndex', () => {
  test('uses one draw and never picks a zero weight', () => {
    const a = Rng.fromSeed(1);
    const b = Rng.fromSeed(1);
    const counts = [0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      const k = pickWeightedIndex(a, [3, 0, 1]);
      counts[k] = (counts[k] ?? 0) + 1;
      b.nextInt(4);
    }
    expect(counts[1]).toBe(0);
    expect(a.getState()).toEqual(b.getState());
  });
});

describe('tierOddsFor', () => {
  test('picks the largest fromRound not above the round', () => {
    const w = (r: number) => tierOddsFor(r, economy.tierOdds).weights;
    expect(w(1)).toEqual([100, 0, 0]);
    expect(w(2)).toEqual([100, 0, 0]);
    expect(w(3)).toEqual([80, 20, 0]);
    expect(w(7)).toEqual([60, 35, 5]);
    expect(w(12)).toEqual([25, 40, 35]);
    expect(w(99)).toEqual([25, 40, 35]);
  });
});

describe('rollOffers', () => {
  test('gives shopOfferCount offers with slots, prices and valid buildings', () => {
    const offers = rollOffers(Rng.fromSeed(3), 12, content, economy);
    expect(offers).toHaveLength(economy.shopOfferCount);
    offers.forEach((o, i) => {
      expect(o.slot).toBe(i);
      const def = content.buildings.get(o.def);
      if (def === undefined) throw new Error('unknown');
      expect(def.kind).not.toBe('core');
      expect(o.tier).toBeGreaterThanOrEqual(1);
      expect(o.tier).toBeLessThanOrEqual(3);
      expect(o.price).toBe(
        (def.tiers[o.tier - 1] as unknown as { price: number }).price,
      );
    });
  });

  test('is reproducible from the stream', () => {
    const a = rollOffers(Rng.fromSeed(9), 5, content, economy);
    const b = rollOffers(Rng.fromSeed(9), 5, content, economy);
    expect(a).toEqual(b);
  });

  test('draw order is building then tier per slot', () => {
    const rng = Rng.fromSeed(11);
    const mirror = Rng.fromSeed(11);
    const offers = rollOffers(rng, 8, content, economy);
    const bw = economy.offerWeights.map((w) => w.weight);
    const tw = tierOddsFor(8, economy.tierOdds).weights;
    for (const o of offers) {
      const d = at(economy.offerWeights, pickWeightedIndex(mirror, bw)).def;
      const t = pickWeightedIndex(mirror, tw) + 1;
      expect([o.def, o.tier]).toEqual([d, t]);
    }
  });

  test('observed frequencies match the configured weights', () => {
    for (const round of [1, 3, 5, 8, 12]) {
      const rng = Rng.fromSeed(100 + round);
      const tiers = [0, 0, 0];
      const byDef = new Map<string, number>();
      let total = 0;
      for (let n = 0; n < 4000; n++) {
        for (const o of rollOffers(rng, round, content, economy)) {
          tiers[o.tier - 1] = (tiers[o.tier - 1] ?? 0) + 1;
          byDef.set(o.def, (byDef.get(o.def) ?? 0) + 1);
          total += 1;
        }
      }
      expect(total).toBe(20000);
      const tw = tierOddsFor(round, economy.tierOdds).weights;
      const tsum = tw[0] + tw[1] + tw[2];
      tw.forEach((w, i) => {
        const expected = w / tsum;
        const observed = at(tiers, i) / total;
        expect(Math.abs(observed - expected)).toBeLessThan(0.012);
        if (w === 0) expect(tiers[i]).toBe(0);
      });
      const wsum = economy.offerWeights.reduce((a, w) => a + w.weight, 0);
      for (const w of economy.offerWeights) {
        const observed = (byDef.get(w.def) ?? 0) / total;
        expect(Math.abs(observed - w.weight / wsum)).toBeLessThan(0.012);
      }
      for (const def of byDef.keys()) {
        expect(economy.offerWeights.some((w) => w.def === def)).toBe(true);
      }
    }
  });
});

describe('buy, sell, reroll', () => {
  const offers = [
    { slot: 0, def: 'bld_wall', tier: 1, price: 4 },
    { slot: 1, def: 'bld_turret', tier: 3, price: 65 },
    { slot: 2, def: 'bld_wall', tier: 1, price: 4 },
    { slot: 3, def: 'bld_wall', tier: 1, price: 4 },
  ];
  const shop: PlayerShop = { gold: 10, offers };

  test('buying pays, stashes for the buyer and empties the slot', () => {
    const team = newTeam();
    const r = buyOffer(shop, team, content, { slot: 0, owner: 1 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.shop.gold).toBe(6);
    expect(r.shop.offers[0]).toBeNull();
    expect(r.team.stash).toEqual([
      { id: 1, def: 'bld_wall', tier: 1, owner: 1 },
    ]);
    expect(shop.gold).toBe(10);
    const again = buyOffer(r.shop, r.team, content, { slot: 0, owner: 1 });
    expect(again).toEqual({ ok: false, reason: 'no_such_offer' });
  });

  test('rejections leave inputs untouched', () => {
    const team = newTeam();
    const before = clone({ shop, team });
    expect(buyOffer(shop, team, content, { slot: 1, owner: 0 })).toEqual({
      ok: false,
      reason: 'not_enough_gold',
    });
    expect(buyOffer(shop, team, content, { slot: 9, owner: 0 })).toEqual({
      ok: false,
      reason: 'no_such_offer',
    });
    expect(buyOffer(shop, team, content, { slot: -1, owner: 0 }).ok).toBe(
      false,
    );
    expect(
      rerollOffers({ gold: 0, offers }, Rng.fromSeed(1), 1, content, economy),
    ).toEqual({ ok: false, reason: 'not_enough_gold' });
    expect(clone({ shop, team })).toEqual(before);
  });

  test('a third identical building stays a separate entry', () => {
    let team = newTeam(1);
    let s: PlayerShop = { gold: 20, offers };
    for (const slot of [0, 2, 3]) {
      const r = buyOffer(s, team, content, { slot, owner: 0 });
      if (!r.ok) throw new Error(r.reason);
      s = r.shop;
      team = r.team;
    }
    expect(team.stash).toHaveLength(3);
    expect(new Set(team.stash.map((e) => e.id)).size).toBe(3);
    expect(team.stash.every((e) => e.def === 'bld_wall' && e.tier === 1)).toBe(
      true,
    );
    expect(s.gold).toBe(8);
  });

  test('selling refunds the rounded-down percent; only own stash entries', () => {
    let team = newTeam();
    const a = addToStash(team, content, { def: 'bld_wall', tier: 2, owner: 0 });
    if (!a.ok) throw new Error(a.reason);
    const b = addToStash(a.state, content, {
      def: 'bld_wall',
      tier: 1,
      owner: 1,
    });
    if (!b.ok) throw new Error(b.reason);
    team = b.state;
    expect(sellValue(content, economy, 'bld_wall', 1)).toBe(2);
    expect(sellValue(content, economy, 'bld_wall', 2)).toBe(4);
    expect(sellValue(content, economy, 'bld_extractor', 1)).toBe(5);
    expect(sellValue(content, economy, 'bld_splitter', 1)).toBe(2);
    expect(
      sellFromStash(shop, team, content, economy, { id: b.id, owner: 0 }),
    ).toEqual({ ok: false, reason: 'not_owner' });
    expect(
      sellFromStash(shop, team, content, economy, { id: 99, owner: 0 }),
    ).toEqual({ ok: false, reason: 'not_in_stash' });
    const r = sellFromStash(shop, team, content, economy, {
      id: a.id,
      owner: 0,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.shop.gold).toBe(14);
    expect(r.team.stash.map((e) => e.id)).toEqual([b.id]);
  });

  test('a placed building cannot be sold', () => {
    const map = generateMap(5, 1, content, mapgen);
    const pos = at(listLegalCorePositions(map, content, mapgen, 0), 0);
    const c = placeCore(createTeamState(map), content, mapgen, 0, pos);
    if (!c.ok) throw new Error(c.reason);
    const a = addToStash(c.state, content, {
      def: 'bld_wall',
      tier: 1,
      owner: 0,
    });
    if (!a.ok) throw new Error(a.reason);
    let placed = null;
    for (let y = 0; y < map.height && placed === null; y++) {
      for (let x = 0; x < map.width && placed === null; x++) {
        const p = placeFromStash(a.state, content, {
          actor: 0,
          id: a.id,
          x,
          y,
          rotation: 0,
        });
        if (p.ok) placed = p.state;
      }
    }
    if (placed === null) throw new Error('no legal cell');
    expect(
      sellFromStash(shop, placed, content, economy, { id: a.id, owner: 0 }),
    ).toEqual({ ok: false, reason: 'not_in_stash' });
  });

  test('reroll charges and replaces every offer', () => {
    const rng = Rng.fromSeed(4);
    const r = rerollOffers({ gold: 3, offers }, rng, 1, content, economy);
    if (!r.ok) throw new Error(r.reason);
    expect(r.shop.gold).toBe(2);
    expect(r.shop.offers).toHaveLength(economy.shopOfferCount);
    expect(r.shop.offers.every((o) => o !== null)).toBe(true);
  });
});

describe('alternate configuration', () => {
  test('a different config changes behaviour without code changes', () => {
    const alt: EconomyConfig = {
      ...economy,
      shopOfferCount: 2,
      rerollCost: 7,
      sellRefundPercent: 100,
      offerWeights: [{ def: 'bld_gate', weight: 1 }],
      tierOdds: [{ fromRound: 1, weights: [0, 0, 1] }],
    };
    const offers = rollOffers(Rng.fromSeed(1), 1, content, alt);
    expect(offers).toEqual([
      { slot: 0, def: 'bld_gate', tier: 3, price: 30 },
      { slot: 1, def: 'bld_gate', tier: 3, price: 30 },
    ]);
    expect(sellValue(content, alt, 'bld_gate', 3)).toBe(30);
    expect(
      rerollOffers({ gold: 6, offers }, Rng.fromSeed(1), 1, content, alt),
    ).toEqual({ ok: false, reason: 'not_enough_gold' });
  });
});
