import { describe, expect, test } from 'vitest';
import { createArenaSim } from './arena-sim.js';
import { loadEconomy, loadEconomyOrThrow } from './economy.js';
import { findModifier, loadEvents, loadEventsOrThrow } from './events.js';
import { hashJson } from './hash.js';
import {
  heldModifierIds,
  modifierPercent,
  withModifier,
  type TeamModifier,
} from './modifiers.js';
import { simulatePveBattle } from './pve-battle.js';
import { buildReferenceBoard } from './reference-boards.js';
import { addToStash, raiseTier, validateTeamState } from './team-state.js';
import { generateThreat } from './threat-gen.js';
import { content, mapgen, simConfig, threats } from './test-support.js';
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
  const r = simulatePveBattle({ team, threat, seed: 3 }, content, config);
  if (!r.ok) throw new Error(r.error.message);
  return { winner: r.result.winner, kills: r.summary.sides[0].unitsKilled };
}

describe('modifiers travel in team state and change battles', () => {
  test('a Core health modifier turns a lost battle into a won one', () => {
    expect(fight('fortify', 'arch_fortress', 'medium', 6, [])).toBe(1);
    expect(
      fight('fortify', 'arch_fortress', 'medium', 6, ['mod_fortified_core']),
    ).toBe(0);
  });

  test('a turret damage modifier makes the same turrets kill more', () => {
    // The party loses this round either way; with sharper turrets it kills
    // more of the wave first.
    const plain = fightResult('fortify', 'arch_fortress', 'hard', 12, []);
    const sharp = fightResult('fortify', 'arch_fortress', 'hard', 12, [
      'mod_sharp_turrets',
    ]);
    expect(plain.winner).toBe(1);
    expect(sharp.kills).toBeGreaterThan(plain.kills);
  });

  test('a unit strength modifier turns a lost battle into a won one', () => {
    expect(fight('rush', 'arch_fortress', 'hard', 4, [])).toBe(1);
    expect(
      fight('rush', 'arch_fortress', 'hard', 4, ['mod_drilled_troops']),
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
    expect(modifierPercent(twice, 'unit_strength_percent')).toBe(20);
    expect(heldModifierIds(twice)).toEqual([
      'mod_drilled_troops',
      'mod_drilled_troops',
    ]);
    expect(modifierPercent(base, 'unit_strength_percent')).toBe(0);
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
    const base = buildReferenceBoard('rush', content, mapgen);
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
      def: 'bld_wall',
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
    ]);
    expect(events.modifiers.length).toBeGreaterThanOrEqual(3);
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
    expect(() => modifierPercent(team, 'core_health_percent')).toThrow(
      RangeError,
    );
    expect(() => modifierPercent(team, 'core_health_percent')).toThrow(
      /core_health_percent.*9007199254740991/,
    );
    // Other kinds are unaffected.
    expect(modifierPercent(team, 'unit_strength_percent')).toBe(0);
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
