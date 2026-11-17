import { describe, expect, test } from 'vitest';
import { createArenaSim, spawnUnitForTest } from './arena-sim.js';
import { startArenaBattle } from './arena-sim.js';
import { loadEconomy, loadEconomyOrThrow } from './economy.js';
import { findModifier, loadEvents, loadEventsOrThrow } from './events.js';
import { hashJson } from './hash.js';
import {
  sellRefundPercentFor,
  shopIncomeBonus,
  type ModifierEffect,
  heldModifierIds,
  modifierPercent,
  effectValue,
  parseModifierEffect,
  unitStrengthPercent,
  withModifier,
  type TeamModifier,
} from './modifiers.js';
import { simulatePveBattle } from './pve-battle.js';
import { buildReferenceBoard } from './reference-boards.js';
import { addToStash, raiseTier, validateTeamState } from './team-state.js';
import { generateThreat } from './threat-gen.js';
import { content, mapgen, simConfig, threats } from './testing/support.js';
import economyJson from '../../../content/economy.json';
import eventsJson from '../../../content/events.json';

const events = loadEventsOrThrow(eventsJson);
const config = { sim: simConfig, mapgen };

function modifier(id: string): TeamModifier {
  const def = findModifier(events, id);
  if (def === undefined) throw new Error(`no modifier ${id}`);
  return { id: def.id, effects: def.effects };
}

function fight(
  boardName: 'rush' | 'fortify' | 'poor',
  archetype: string,
  type: 'easy' | 'medium' | 'hard',
  round: number,
  mods: readonly string[],
): number {
  return fightResult(boardName, archetype, type, round, mods).winner;
}

function fightResult(
  boardName: 'rush' | 'fortify' | 'poor',
  archetype: string,
  type: 'easy' | 'medium' | 'hard',
  round: number,
  mods: readonly string[],
): { winner: number; kills: number } {
  let team = buildReferenceBoard(boardName, content, mapgen);
  for (const m of mods) team = withModifier(team, modifier(m));
  const threat = generateThreat(
    { seed: 9, round, type, partySize: 1, archetype },
    content,
    { threats, mapgen },
  );
  const r = simulatePveBattle(
    { round: 1, team, threat, seed: 3 },
    content,
    config,
  );
  if (!r.ok) throw new Error(r.error.message);
  return { winner: r.result.winner, kills: r.summary.sides[0].unitsKilled };
}

describe('modifiers travel in team state and change battles', () => {
  test('a Core health modifier turns a lost battle into a won one', () => {
    expect(fight('fortify', 'arch_fortress', 'medium', 8, [])).toBe(1);
    expect(
      fight('fortify', 'arch_fortress', 'medium', 8, ['mod_fortified_core']),
    ).toBe(0);
  });

  test('a turret damage modifier makes the same turrets kill more', () => {
    // The party loses this round either way; with sharper turrets it kills
    // more of the wave first.
    const plain = fightResult('fortify', 'arch_fortress', 'hard', 14, []);
    const sharp = fightResult('fortify', 'arch_fortress', 'hard', 14, [
      'mod_sharp_turrets',
    ]);
    expect(plain.winner).toBe(1);
    expect(sharp.kills).toBeGreaterThan(plain.kills);
  });

  test('a unit strength modifier turns a lost battle into a won one', () => {
    expect(fight('poor', 'arch_rusher', 'medium', 5, [])).toBe(1);
    expect(
      fight('poor', 'arch_rusher', 'medium', 5, ['mod_drilled_troops']),
    ).toBe(0);
  });

  test('the outcome depends on the team state alone', () => {
    const base = buildReferenceBoard('rush', content, mapgen);
    const a = withModifier(base, modifier('mod_fortified_core'));
    // Round-trip the team through JSON: the modifier is all in the state.
    const copy = JSON.parse(JSON.stringify(a)) as typeof a;
    const v = validateTeamState(copy, content, mapgen);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(hashJson(v.state)).toBe(hashJson(a));
    expect(hashJson(a)).not.toBe(hashJson(base));
  });

  test('building and Core health at tick 0 follow the effects (integers, rounded down)', () => {
    const base = buildReferenceBoard('fortify', content, mapgen);
    const withMods = withModifier(
      withModifier(base, modifier('mod_stout_walls')),
      modifier('mod_fortified_core'),
    );
    const hp = (team: typeof base) =>
      createArenaSim(team, team, 4, content, simConfig).health.filter(
        (h) => h.side === 0,
      );
    const before = hp(base);
    const after = hp(withMods);
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) {
      const b = before[i];
      const a = after[i];
      if (b === undefined || a === undefined) throw new Error('missing');
      const placed = base.buildings.find(
        (p) => 'building' in b && p.id === b.building,
      );
      const def =
        placed === undefined ? undefined : content.buildings.get(placed.def);
      if ('core' in b) {
        expect(a.hp).toBe(Math.floor((b.hp * 120) / 100));
      } else if (def?.kind === 'defense' && def.defenseType === 'wall') {
        expect(a.hp).toBe(Math.floor((b.hp * 125) / 100));
      } else {
        expect(a.hp).toBe(b.hp);
      }
    }
  });

  test('effects of the same kind add up', () => {
    const base = buildReferenceBoard('rush', content, mapgen);
    const twice = withModifier(
      withModifier(base, modifier('mod_drilled_troops')),
      modifier('mod_drilled_troops'),
    );
    expect(modifierPercent(twice, 'unit_strength_percent', -50)).toBe(20);
    expect(heldModifierIds(twice)).toEqual([
      'mod_drilled_troops',
      'mod_drilled_troops',
    ]);
    expect(modifierPercent(base, 'unit_strength_percent', -50)).toBe(0);
  });

  test('a team without modifiers has no modifiers field', () => {
    const base = buildReferenceBoard('rush', content, mapgen);
    expect('modifiers' in base).toBe(false);
    const v = validateTeamState(base, content, mapgen);
    expect(v.ok).toBe(true);
    if (v.ok) expect('modifiers' in v.state).toBe(false);
  });

  test('validateTeamState rejects bad modifier data', () => {
    const base = buildReferenceBoard('rush', content, mapgen);
    const bad = (modifiers: unknown) =>
      validateTeamState({ ...base, modifiers }, content, mapgen).ok;
    expect(bad([])).toBe(false);
    expect(bad([{ id: 'x', effects: [] }])).toBe(false);
    expect(
      bad([
        { id: 'mod_x', effects: [{ kind: 'core_health_percent', percent: 0 }] },
      ]),
    ).toBe(false);
    expect(
      bad([{ id: 'mod_x', effects: [{ kind: 'gold', percent: 5 }] }]),
    ).toBe(false);
    expect(
      bad([
        { id: 'mod_x', effects: [{ kind: 'core_health_percent', percent: 5 }] },
      ]),
    ).toBe(true);
  });
});

describe('raiseTier (Workshop)', () => {
  test('raises a placed or stashed building by one, never above 3, adds nothing', () => {
    // The poor board is all tier 1, so its first building climbs 1 -> 3.
    const base = buildReferenceBoard('poor', content, mapgen);
    const placed = base.buildings[0];
    if (placed === undefined) throw new Error('no building');
    const r1 = raiseTier(base, { id: placed.id });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.buildings.find((b) => b.id === placed.id)?.tier).toBe(2);
    expect(r1.state.buildings).toHaveLength(base.buildings.length);
    expect(r1.state.stash).toHaveLength(base.stash.length);
    const r2 = raiseTier(r1.state, { id: placed.id });
    if (!r2.ok) throw new Error('second raise failed');
    expect(r2.state.buildings.find((b) => b.id === placed.id)?.tier).toBe(3);
    const r3 = raiseTier(r2.state, { id: placed.id });
    expect(r3.ok).toBe(false);

    const stashed = addToStash(base, content, {
      def: 'bld_wall_block',
      tier: 1,
      owner: 0,
    });
    if (!stashed.ok) throw new Error('stash failed');
    const r4 = raiseTier(stashed.state, { id: stashed.id });
    if (!r4.ok) throw new Error('stash raise failed');
    expect(r4.state.stash.find((b) => b.id === stashed.id)?.tier).toBe(2);
    expect(raiseTier(base, { id: 9999 })).toEqual({
      ok: false,
      reason: 'unknown_building',
    });
  });
});

describe('loadEvents', () => {
  test('the shipped file loads', () => {
    expect(events.offerCount).toBe(3);
    expect(events.events.map((e) => e.type)).toEqual([
      'workshop',
      'shrine',
      'windfall',
      'drill',
      'market_day',
      'pact',
      'rich_vein',
      'blueprint',
      'caravan',
    ]);
    expect(events.events.map((e) => e.fromRound)).toEqual([
      undefined,
      undefined,
      undefined,
      2,
      2,
      4,
      3,
      3,
      2,
    ]);
    expect(events.modifiers.length).toBeGreaterThanOrEqual(3);
  });

  test('an event fromRound is an integer from 1 to 1000, or absent', () => {
    const load = (fromRound: unknown) =>
      loadEvents({
        offerCount: 1,
        events: [{ id: 'evt_a', type: 'x', weight: 1, fromRound }],
        modifiers: [],
      });
    const ok = load(3);
    expect(ok.ok && ok.config.events[0]?.fromRound).toBe(3);
    const none = loadEvents({
      offerCount: 1,
      events: [{ id: 'evt_a', type: 'x', weight: 1 }],
      modifiers: [],
    });
    expect(none.ok && 'fromRound' in (none.config.events[0] ?? {})).toBe(false);
    for (const bad of [0, 1001, 1.5, '2'])
      expect(load(bad).ok, String(bad)).toBe(false);
  });

  test('reports problems', () => {
    const r = loadEvents({
      offerCount: 0,
      events: [
        { id: 'evt_a', type: 'x', weight: 1 },
        { id: 'evt_a', type: 'x', weight: 1 },
      ],
      modifiers: [
        {
          id: 'mod_a',
          stackable: false,
          effects: [{ kind: 'nope', percent: 1 }],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(/offerCount/);
    expect(r.errors.join('\n')).toMatch(/duplicate id "evt_a"/);
    expect(r.errors.join('\n')).toMatch(/unknown effect kind/);
  });
});

describe('rewards in the economy file', () => {
  const ctx = { buildings: content.buildings };
  test('the shipped rewards load and increase with difficulty', () => {
    const eco = loadEconomyOrThrow(economyJson, ctx);
    expect(eco.rewards.pveWin.easy).toBeLessThan(eco.rewards.pveWin.medium);
    expect(eco.rewards.pveWin.medium).toBeLessThan(eco.rewards.pveWin.hard);
  });

  test('a flat reward table is rejected', () => {
    const flat = {
      ...economyJson,
      rewards: {
        pveWin: { easy: 3, medium: 3, hard: 8 },
        pvpWin: 6,
        pvpLoss: 2,
      },
    };
    const r = loadEconomy(flat, ctx);
    expect(r.ok).toBe(false);
  });
});

describe('modifier percent sums are checked', () => {
  const huge = (kind: 'core_health_percent' | 'building_health_percent') =>
    ({
      id: 'mod_test_huge',
      effects: [
        kind === 'core_health_percent'
          ? { kind, percent: Number.MAX_SAFE_INTEGER }
          : { kind, target: 'all', percent: Number.MAX_SAFE_INTEGER },
      ],
    }) as const satisfies TeamModifier;

  test('a sum past the safe bound is a RangeError naming the kind and the bound', () => {
    const team = withModifier(
      withModifier({}, huge('core_health_percent')),
      huge('core_health_percent'),
    );
    expect(() => modifierPercent(team, 'core_health_percent', -50)).toThrow(
      RangeError,
    );
    expect(() => modifierPercent(team, 'core_health_percent', -50)).toThrow(
      /core_health_percent.*9007199254740991/,
    );
    // Other kinds are unaffected.
    expect(modifierPercent(team, 'unit_strength_percent', -50)).toBe(0);
  });

  test('an extreme stack fails at battle setup naming the kind, not a generic message', () => {
    const base = buildReferenceBoard('fortify', content, mapgen);
    const coreStack = withModifier(base, huge('core_health_percent'));
    expect(() =>
      createArenaSim(coreStack, base, 4, content, simConfig),
    ).toThrow(/core_health_percent/);
    const wallStack = withModifier(base, huge('building_health_percent'));
    expect(() =>
      createArenaSim(wallStack, base, 4, content, simConfig),
    ).toThrow(/building_health_percent/);
    // A product that stays safe but passes MAX_HEALTH exceeds the maximum health.
    const big = withModifier(base, {
      id: 'mod_test_big',
      effects: [{ kind: 'core_health_percent', percent: 1_000_000_000_000 }],
    });
    expect(() => createArenaSim(big, base, 4, content, simConfig)).toThrow(
      RangeError,
    );
  });
});

describe('per-unit-type strength and round gating (#423)', () => {
  const sharp = modifier('mod_sharpshooters');
  const vanguard = modifier('mod_vanguard');
  const drilled = modifier('mod_drilled_troops');

  test('the shipped stackable and targeted modifiers', () => {
    const stack = (id: string) => findModifier(events, id)?.stackable;
    for (const id of [
      'mod_stout_walls',
      'mod_sharp_turrets',
      'mod_fortified_core',
      'mod_drilled_troops',
      'mod_reinforced_frames',
    ]) {
      expect(stack(id), id).toBe(true);
    }
    for (const id of [
      'mod_sharpshooters',
      'mod_hornet_swarm',
      'mod_vanguard',
    ]) {
      expect(stack(id), id).toBe(false);
    }
    expect(sharp.effects).toEqual([
      { kind: 'unit_strength_percent', percent: 25, units: ['unit_archer'] },
    ]);
    expect(vanguard.effects).toEqual([
      {
        kind: 'unit_strength_percent',
        percent: 20,
        units: ['unit_soldier', 'unit_raider'],
      },
    ]);
  });

  test('unitStrengthPercent sums untargeted effects and those listing the unit', () => {
    let team = withModifier({}, sharp);
    team = withModifier(team, vanguard);
    team = withModifier(team, drilled);
    team = withModifier(team, drilled);
    expect(unitStrengthPercent(team, 'unit_archer', -50)).toBe(45);
    expect(unitStrengthPercent(team, 'unit_soldier', -50)).toBe(40);
    expect(unitStrengthPercent(team, 'unit_raider', -50)).toBe(40);
    expect(unitStrengthPercent(team, 'unit_drone', -50)).toBe(20);
    expect(unitStrengthPercent({}, 'unit_archer', -50)).toBe(0);
  });

  test('units are validated: non-empty, unit IDs, no duplicates', () => {
    const at = (units: unknown) => {
      const errors: string[] = [];
      const e = parseModifierEffect(
        { kind: 'unit_strength_percent', percent: 5, units },
        'e',
        errors,
      );
      return { e, errors };
    };
    expect(at(['unit_archer']).e).toEqual({
      kind: 'unit_strength_percent',
      percent: 5,
      units: ['unit_archer'],
    });
    for (const bad of [
      [],
      'unit_archer',
      ['archer'],
      [1],
      ['unit_a', 'unit_a'],
    ]) {
      const r = at(bad);
      expect(r.e, JSON.stringify(bad)).toBeUndefined();
      expect(r.errors.join(), JSON.stringify(bad)).toMatch(/units/);
    }
    // Only this effect kind takes `units`.
    const errors: string[] = [];
    parseModifierEffect(
      { kind: 'core_health_percent', percent: 5, units: ['unit_archer'] },
      'e',
      errors,
    );
    expect(errors.join()).toMatch(/unknown field "units"/);
  });

  test('a targeted bonus changes only the listed unit types at spawn', () => {
    const board = buildReferenceBoard('poor', content, mapgen);
    const plain = startArenaBattle(board, board, 4, content, simConfig);
    const boosted = startArenaBattle(
      withModifier(board, sharp),
      board,
      4,
      content,
      simConfig,
    );
    const stats = (b: typeof plain, def: string, x: number) => {
      const u = spawnUnitForTest(b.sim, b.ctx, { side: 0, def, x, y: 20 });
      return [u.hp, u.damage];
    };
    expect(stats(boosted, 'unit_soldier', 1)).toEqual(
      stats(plain, 'unit_soldier', 1),
    );
    expect(stats(boosted, 'unit_archer', 4)).not.toEqual(
      stats(plain, 'unit_archer', 4),
    );
  });

  test('loadEvents: fromRound bounds, unknown units, units order', () => {
    const mod = (extra: object, effect: object = {}) => ({
      offerCount: 1,
      events: [{ id: 'evt_a', type: 'x', weight: 1 }],
      modifiers: [
        {
          id: 'mod_a',
          stackable: false,
          ...extra,
          effects: [
            {
              kind: 'unit_strength_percent',
              percent: 5,
              units: ['unit_soldier', 'unit_raider'],
              ...effect,
            },
          ],
        },
      ],
    });
    const errorsOf = (data: object) => {
      const r = loadEvents(data, { units: content.units });
      return r.ok ? [] : r.errors.join('\n');
    };
    expect(errorsOf(mod({}))).toEqual([]);
    const ok = loadEvents(mod({ fromRound: 3 }), { units: content.units });
    expect(ok.ok && ok.config.modifiers[0]?.fromRound).toBe(3);
    for (const bad of [0, -1, 1.5, '2', 1001]) {
      expect(errorsOf(mod({ fromRound: bad })), String(bad)).toMatch(
        /fromRound/,
      );
    }
    expect(errorsOf(mod({}, { units: ['unit_nope'] }))).toMatch(
      /unknown unit "unit_nope"/,
    );
    expect(
      errorsOf(mod({}, { units: ['unit_raider', 'unit_soldier'] })),
    ).toMatch(/order of the units file/);
    expect(errorsOf(mod({}, { units: [] }))).toMatch(/units/);
  });
});

describe('negative effects and the sum floor (#413)', () => {
  const min = simConfig.minModifierSumPercent;
  const eff = (percent: number): TeamModifier => ({
    id: 'mod_x',
    effects: [{ kind: 'core_health_percent', percent }],
  });

  test('percent is an integer from -90 to 1000, never 0', () => {
    const ok = (percent: unknown): boolean => {
      const errors: string[] = [];
      return (
        parseModifierEffect(
          { kind: 'core_health_percent', percent },
          'e',
          errors,
        ) !== undefined && errors.length === 0
      );
    };
    expect(ok(-90)).toBe(true);
    expect(ok(-1)).toBe(true);
    expect(ok(1000)).toBe(true);
    expect(ok(-91)).toBe(false);
    expect(ok(0)).toBe(false);
    expect(ok(1001)).toBe(false);
    expect(ok(-1.5)).toBe(false);
  });

  test('saved team state accepts a negative percent and rejects -91 and 0', () => {
    const base = buildReferenceBoard('rush', content, mapgen);
    const ok = (percent: number) =>
      validateTeamState({ ...base, modifiers: [eff(percent)] }, content, mapgen)
        .ok;
    expect(ok(-15)).toBe(true);
    expect(ok(-91)).toBe(false);
    expect(ok(0)).toBe(false);
  });

  test('sums with mixed signs add up, and a low sum is raised to the floor', () => {
    const sum = (...p: number[]) =>
      modifierPercent(
        p.reduce<{ modifiers?: readonly TeamModifier[] }>(
          (t, x) => withModifier(t, eff(x)),
          {},
        ),
        'core_health_percent',
        min,
      );
    expect(min).toBe(-50);
    expect(sum(30, -15)).toBe(15);
    expect(sum(-20, -20)).toBe(-40);
    expect(sum(-40, -30)).toBe(-50);
    expect(sum(-90, 20)).toBe(-50);
    expect(sum(-90, 50)).toBe(-40);
    expect(sum()).toBe(0);
  });

  test('the Core health is floor(value * (100 + sum) / 100) with the sum clamped', () => {
    const base = buildReferenceBoard('rush', content, mapgen);
    const coreHp = (mods: readonly number[]) =>
      createArenaSim(
        mods.reduce((t, x) => withModifier(t, eff(x)), base),
        base,
        4,
        content,
        simConfig,
      ).health.find((h) => h.side === 0 && 'core' in h)?.hp ?? 0;
    const plain = coreHp([]);
    expect(coreHp([-15])).toBe(Math.floor((plain * 85) / 100));
    expect(coreHp([-40, -30])).toBe(Math.floor(plain / 2));
    expect(coreHp([-90])).toBe(Math.floor(plain / 2));
    expect(coreHp([-90, 60])).toBe(Math.floor((plain * 70) / 100));
    expect(coreHp([20, -15])).toBe(Math.floor((plain * 105) / 100));
  });

  test('unit strength: untargeted plus targeted, clamped per unit type', () => {
    const team = withModifier(
      withModifier(
        {},
        {
          id: 'mod_a',
          effects: [{ kind: 'unit_strength_percent', percent: -40 }],
        },
      ),
      {
        id: 'mod_b',
        effects: [
          {
            kind: 'unit_strength_percent',
            percent: -30,
            units: ['unit_archer'],
          },
        ],
      },
    );
    expect(unitStrengthPercent(team, 'unit_archer', min)).toBe(-50);
    expect(unitStrengthPercent(team, 'unit_soldier', min)).toBe(-40);
  });

  test('a turret drawback lowers the turret health only; shipped pacts are well formed', () => {
    const base = buildReferenceBoard('fortify', content, mapgen);
    const turretHp = (t: typeof base) =>
      createArenaSim(t, base, 4, content, simConfig)
        .health.filter((h) => h.side === 0 && 'building' in h)
        .map((h) => h.hp);
    const withPact = withModifier(base, modifier('mod_pact_overcharge'));
    const a = turretHp(base);
    const b = turretHp(withPact);
    expect(b.length).toBe(a.length);
    expect(b.some((x, i) => x < (a[i] ?? 0))).toBe(true);
    expect(b.every((x, i) => x <= (a[i] ?? 0))).toBe(true);
    const pacts = events.modifiers.filter((m) => m.pact === true);
    expect(pacts.map((m) => m.id)).toEqual([
      'mod_pact_fury',
      'mod_pact_bastion',
      'mod_pact_overcharge',
    ]);
    for (const m of pacts) {
      expect(m.stackable).toBe(false);
      expect(m.effects.some((e) => effectValue(e) > 0)).toBe(true);
      expect(m.effects.some((e) => effectValue(e) < 0)).toBe(true);
    }
  });

  test('loadEvents: pact needs a benefit and a drawback and is not stackable', () => {
    const load = (pact: unknown, stackable: boolean, percents: number[]) =>
      loadEvents({
        offerCount: 1,
        events: [{ id: 'evt_a', type: 'x', weight: 1 }],
        modifiers: [
          {
            id: 'mod_p',
            stackable,
            pact,
            effects: percents.map((percent) => ({
              kind: 'core_health_percent',
              percent,
            })),
          },
        ],
      });
    expect(load(true, false, [20, -10]).ok).toBe(true);
    expect(load(true, false, [20]).ok).toBe(false);
    expect(load(true, false, [-10]).ok).toBe(false);
    expect(load(true, true, [20, -10]).ok).toBe(false);
    expect(load(false, false, [20, -10]).ok).toBe(false);
    expect(load(undefined, false, [20]).ok).toBe(true);
  });
});

describe('gold effects (issue #425)', () => {
  const tithe = { kind: 'shop_income_flat', amount: 1 } as const;
  const scrap = { kind: 'sell_refund_percent', percent: 25 } as const;

  test('parse: amount 1 to 10 and percent 1 to 90, no other fields', () => {
    const parse = (raw: unknown) => {
      const errors: string[] = [];
      return { out: parseModifierEffect(raw, 'e', errors), errors };
    };
    expect(parse(tithe).out).toEqual(tithe);
    expect(parse(scrap).out).toEqual(scrap);
    expect(parse({ kind: 'shop_income_flat', amount: 10 }).out).toBeDefined();
    for (const bad of [0, 11, 1.5, -1, '1']) {
      expect(
        parse({ kind: 'shop_income_flat', amount: bad }).out,
      ).toBeUndefined();
    }
    expect(parse({ kind: 'shop_income_flat', percent: 5 }).out).toBeUndefined();
    expect(
      parse({ kind: 'shop_income_flat', amount: 1, units: [] }).errors,
    ).not.toEqual([]);
    for (const bad of [0, -5, 91, 2.5]) {
      expect(
        parse({ kind: 'sell_refund_percent', percent: bad }).out,
      ).toBeUndefined();
    }
    expect(
      parse({ kind: 'sell_refund_percent', percent: 90 }).out,
    ).toBeDefined();
  });

  test('income bonus sums the amounts; the refund percent is capped at 90', () => {
    const team = (...effects: ModifierEffect[]) => ({
      modifiers: effects.map((e, i) => ({
        id: `mod_x${String(i)}`,
        effects: [e],
      })),
    });
    expect(shopIncomeBonus({})).toBe(0);
    expect(shopIncomeBonus(team(tithe, tithe, tithe))).toBe(3);
    expect(sellRefundPercentFor({}, 50)).toBe(50);
    expect(sellRefundPercentFor(team(scrap), 50)).toBe(75);
    expect(sellRefundPercentFor(team(scrap, scrap), 50)).toBe(90);
    expect(sellRefundPercentFor(team(scrap, scrap, scrap), 50)).toBe(90);
    // A base above the cap is never lowered by taking the modifier.
    expect(sellRefundPercentFor(team(scrap), 95)).toBe(95);
    // Tithe does not touch the refund and Scrap dealer does not touch income.
    expect(sellRefundPercentFor(team(tithe), 50)).toBe(50);
    expect(shopIncomeBonus(team(scrap))).toBe(0);
  });

  test('the arena ignores them: a battle with them hashes as without', () => {
    expect(modifierPercent({}, 'core_health_percent', -50)).toBe(0);
    const held = {
      modifiers: [{ id: 'mod_tithe', effects: [tithe] }],
    };
    expect(modifierPercent(held, 'core_health_percent', -50)).toBe(0);
    expect(modifierPercent(held, 'turret_damage_percent', -50)).toBe(0);
    expect(unitStrengthPercent(held, 'unit_archer', -50)).toBe(0);
  });
});
