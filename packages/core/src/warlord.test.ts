import { describe, expect, test } from 'vitest';
import threatsJson from '../../../content/threats.json';
import { unitStats } from './arena-sim.js';
import { divFloor, mulPct } from './int.js';
import { MAX_HEALTH } from './limits.js';
import { startPveBattle } from './pve-battle.js';
import { buildStronghold, generateThreat } from './threat-gen.js';
import { loadThreats } from './threats.js';
import { content, got, mapgen, simConfig, threats } from './testing/support.js';

const configs = { threats, mapgen };
const warlord = got(
  threats.archetypes.find((a) => a.id === 'arch_boss_warlord'),
);
const champion = got(warlord.champion);
const make = (round: number, partySize: number, archetype = warlord.id) =>
  generateThreat(
    { seed: 7, round, type: 'boss', partySize, archetype },
    content,
    configs,
  );

describe('Warlord champion (MM-9d)', () => {
  test('the archetype is as specified', () => {
    expect(warlord.fromRound).toBe(9);
    expect(warlord.minPartySize).toBe(1);
    expect(champion).toEqual({
      unit: 'unit_golem',
      healthPercent: 600,
      sharePercent: 35,
    });
    expect(threats.unitCost.find((c) => c.unit === 'unit_golem')?.cost).toBe(
      50,
    );
  });

  test('every wave starts with one champion per plot; its health percent is what the share buys', () => {
    for (const [round, party] of [
      [9, 1],
      [12, 1],
      [20, 1],
      [16, 2],
      [30, 4],
    ] as const) {
      const p = make(round, party);
      const champs = p.waves.filter((w) => w.healthPercent !== undefined);
      expect(champs).toHaveLength(6);
      // Listed first in its tick.
      champs.forEach((w) => {
        expect(p.waves.find((x) => x.tick === w.tick)).toBe(w);
        expect(w.unit).toBe('unit_golem');
        expect(w.count).toBe(party);
        expect(w.healthPercent).toBeGreaterThanOrEqual(100);
        expect(w.healthPercent).toBeLessThanOrEqual(600);
      });
      // Non-champion entries have no healthPercent.
      expect(
        p.waves.filter((w) => w.healthPercent === undefined),
      ).not.toHaveLength(0);
      // The wave sizes grow, so the health percents never fall.
      const hp = champs.map((w) => w.healthPercent ?? 0);
      expect(hp).toEqual([...hp].sort((a, b) => a - b));
      // The cap counts the champions.
      const perTick = new Map<number, number>();
      for (const w of p.waves) {
        perTick.set(w.tick, (perTick.get(w.tick) ?? 0) + w.count);
      }
      for (const n of perTick.values()) {
        expect(n).toBeLessThanOrEqual(threats.maxUnitsPerWavePerPlot * party);
      }
    }
  });

  test('the health percent follows the integer formula', () => {
    // Round 20 solo, wave k: the share of the wave budget (35 percent).
    const p = make(20, 1);
    const budget = p.budget;
    const waveBudget = mulPct(budget, warlord.waveSharePercent);
    const sizes: number[] = [];
    for (let k = 0, s = 100; k < warlord.waves.count; k++) {
      sizes.push(s);
      s = mulPct(s, warlord.waves.growthPercent);
    }
    const sum = sizes.reduce((a, b) => a + b, 0);
    const expected = sizes.map((size) => {
      const wb = divFloor(waveBudget * size, sum);
      const share = mulPct(wb, champion.sharePercent);
      const full = mulPct(50, champion.healthPercent);
      return share >= full
        ? champion.healthPercent
        : Math.max(100, divFloor(share * 100, 50));
    });
    const got_ = p.waves
      .filter((w) => w.healthPercent !== undefined)
      .map((w) => w.healthPercent);
    expect(got_).toEqual(expected);
    expect(got_[5]).toBe(600);
  });

  test('other archetypes are untouched: no champion entries, no healthPercent', () => {
    for (const a of threats.archetypes) {
      if (a.champion !== undefined) continue;
      const p = generateThreat(
        { seed: 7, round: 12, type: 'boss', partySize: 2, archetype: a.id },
        content,
        configs,
      );
      expect(p.waves.some((w) => 'healthPercent' in w)).toBe(false);
      expect(p.waves.some((w) => w.unit === 'unit_golem')).toBe(false);
    }
  });

  test('unitStats applies the health percent after the strength, health only', () => {
    const golem = got(content.units.get('unit_golem'));
    const s = unitStats(0, golem, 50, 600);
    expect(s.health).toBe(mulPct(mulPct(golem.health, 150), 600));
    expect(s.damage).toBe(mulPct(golem.damage, 150));
    expect(s.armor).toBe(golem.armor);
    expect(unitStats(0, golem, 0, 600).health).toBe(1560);
    expect(unitStats(0, golem, 0, 100)).toBe(golem);
    expect(() => unitStats(0, golem, 0, 10 ** 12)).toThrow(RangeError);
  });

  test('the champion leads its wave and spawns with the scaled health', () => {
    const p = make(20, 1);
    const stronghold = buildStronghold(p, content, mapgen);
    const team = buildStronghold(
      generateThreat(
        {
          seed: 1,
          round: 1,
          type: 'easy',
          partySize: 1,
          archetype: 'arch_rusher',
        },
        content,
        configs,
      ),
      content,
      mapgen,
    );
    expect(stronghold.buildings.length).toBeGreaterThan(0);
    const started = startPveBattle(
      { round: p.round, team, threat: p, seed: 3 },
      content,
      {
        sim: simConfig,
        mapgen,
      },
    );
    if (!started.ok) throw new Error('battle refused');
    const { battle } = started;
    const firstWaveTick = got(p.waves[0]).tick;
    for (let i = 0; i <= firstWaveTick + 1; i++) battle.step();
    const spawned = battle.sim.units.filter((u) => u.side === 1);
    expect(spawned.length).toBeGreaterThan(1);
    const lead = got(spawned[0]);
    expect(lead.def).toBe('unit_golem');
    const golem = got(content.units.get('unit_golem'));
    expect(lead.hp).toBe(
      mulPct(
        mulPct(golem.health, 100 + p.unitStrengthPercent),
        got(p.waves[0]?.healthPercent),
      ),
    );
    expect(spawned.slice(1).every((u) => u.id > lead.id)).toBe(true);
  });
});

describe('champion loader bounds', () => {
  const ctx = { units: content.units, buildings: content.buildings };
  const errs = (
    f: (c: Record<string, unknown>, a: Record<string, unknown>) => void,
  ) => {
    const d = JSON.parse(JSON.stringify(threatsJson)) as Record<
      string,
      unknown
    >;
    const list = d['archetypes'] as Record<string, unknown>[];
    const a = got(list.find((x) => x['id'] === 'arch_boss_warlord'));
    f(a['champion'] as Record<string, unknown>, a);
    const r = loadThreats(d, ctx);
    return r.ok ? '' : r.errors.join('\n');
  };

  test('the shipped content loads', () => {
    expect(errs(() => undefined)).toBe('');
  });

  test('bounds', () => {
    expect(errs((c) => (c['healthPercent'] = 99))).toMatch(/healthPercent/);
    expect(errs((c) => (c['healthPercent'] = 1001))).toMatch(/at most 1000/);
    expect(errs((c) => (c['sharePercent'] = 0))).toMatch(/sharePercent/);
    expect(errs((c) => (c['sharePercent'] = 61))).toMatch(/at most 60/);
    expect(errs((c) => (c['unit'] = 'unit_nope'))).toMatch(/unit/);
    expect(errs((c) => (c['extra'] = 1))).toMatch(/unknown field/);
    expect(MAX_HEALTH).toBeGreaterThan(260 * 10);
  });

  test('a champion needs a unitCost', () => {
    const d = JSON.parse(JSON.stringify(threatsJson)) as Record<
      string,
      unknown
    >;
    d['unitCost'] = (d['unitCost'] as { unit: string }[]).filter(
      (c) => c.unit !== 'unit_golem',
    );
    const r = loadThreats(d, ctx);
    expect(r.ok ? '' : r.errors.join('\n')).toMatch(/has no unitCost/);
  });

  test('not together with brood, linkedCores or pylons; boss-only', () => {
    expect(
      errs(
        (_c, a) => (a['brood'] = { thresholdsPercent: [50], sharePercent: 10 }),
      ),
    ).toMatch(/cannot be combined with "brood"/);
    expect(errs((_c, a) => (a['linkedCores'] = true))).toMatch(
      /cannot be combined with "linkedCores"/,
    );
    expect(
      errs(
        (_c, a) =>
          (a['pylons'] = {
            perPlot: 3,
            sharePercent: 25,
            minDistance: 2,
            maxDistance: 4,
          }),
      ),
    ).toMatch(/cannot be combined with "pylons"/);
    expect(errs((_c, a) => (a['bossOnly'] = false))).toMatch(
      /only allowed when "bossOnly" is true/,
    );
  });
});
