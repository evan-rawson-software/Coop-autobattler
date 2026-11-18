/**
 * Unit move and attack speed modifiers (issue #424): Quick march and Rapid
 * fire.
 */
import { describe, expect, test } from 'vitest';
import {
  fasterCooldown,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
} from './arena-sim.js';
import { findModifier, loadEvents, loadEventsOrThrow } from './events.js';
import {
  MAX_SPEED_MODIFIER_PERCENT,
  parseModifierEffect,
  unitSpeedPercent,
  withModifier,
  type TeamModifier,
} from './modifiers.js';
import { buildReferenceBoard } from './reference-boards.js';
import { content, mapgen, simConfig } from './testing/support.js';
import eventsJson from '../../../content/events.json';

const events = loadEventsOrThrow(eventsJson, { units: content.units });

function modifier(id: string): TeamModifier {
  const def = findModifier(events, id);
  if (def === undefined) throw new Error(`no modifier ${id}`);
  return { id: def.id, effects: def.effects };
}

const quick = modifier('mod_quick_march');
const rapid = modifier('mod_rapid_fire');

describe('content', () => {
  test('the shipped definitions', () => {
    expect(findModifier(events, 'mod_quick_march')).toEqual({
      id: 'mod_quick_march',
      stackable: true,
      effects: [{ kind: 'unit_move_speed_percent', percent: 10 }],
    });
    expect(findModifier(events, 'mod_rapid_fire')).toEqual({
      id: 'mod_rapid_fire',
      stackable: false,
      fromRound: 2,
      effects: [{ kind: 'unit_attack_speed_percent', percent: 15 }],
    });
  });

  test('percent is an integer from 1 to 100; units as for strength', () => {
    const parse = (e: object) => {
      const errors: string[] = [];
      return { e: parseModifierEffect(e, 'e', errors), errors };
    };
    for (const kind of [
      'unit_move_speed_percent',
      'unit_attack_speed_percent',
    ]) {
      expect(parse({ kind, percent: 1 }).e).toBeDefined();
      expect(
        parse({ kind, percent: MAX_SPEED_MODIFIER_PERCENT }).e,
      ).toBeDefined();
      for (const percent of [0, -10, 101, 1.5, '10']) {
        const r = parse({ kind, percent });
        expect(r.e, `${kind} ${String(percent)}`).toBeUndefined();
        expect(r.errors.length).toBeGreaterThan(0);
      }
      expect(parse({ kind, percent: 5, units: ['unit_raider'] }).e).toEqual({
        kind,
        percent: 5,
        units: ['unit_raider'],
      });
      expect(parse({ kind, percent: 5, units: [] }).e).toBeUndefined();
      expect(parse({ kind, percent: 5, target: 'all' }).errors.join()).toMatch(
        /unknown field "target"/,
      );
    }
  });

  test('loadEvents checks the units of a speed effect against the units file', () => {
    const load = (units: string[]) =>
      loadEvents(
        {
          offerCount: 1,
          events: [{ id: 'evt_a', type: 'x', weight: 1 }],
          modifiers: [
            {
              id: 'mod_x',
              stackable: false,
              effects: [{ kind: 'unit_move_speed_percent', percent: 5, units }],
            },
          ],
        },
        { units: content.units },
      );
    expect(load(['unit_soldier', 'unit_raider']).ok).toBe(true);
    expect(load(['unit_nope']).ok).toBe(false);
    expect(load(['unit_raider', 'unit_soldier']).ok).toBe(false);
  });
});

describe('fasterCooldown', () => {
  test('max(1, floor(base * 100 / (100 + s)))', () => {
    expect(fasterCooldown(4, 0)).toBe(4);
    expect(fasterCooldown(4, 10)).toBe(3); // floor(400 / 110): 33% faster
    expect(fasterCooldown(10, 15)).toBe(8);
    expect(fasterCooldown(1, 100)).toBe(1);
    expect(fasterCooldown(2, 100)).toBe(1);
    expect(fasterCooldown(3, 100)).toBe(1);
  });

  // The table of the rules reference ("Unit move and attack speed").
  test('cooldowns of the shipped units at 0 to 3 stacks of Quick march', () => {
    const rows = content.units
      .list()
      .map((u) => [
        u.id,
        ...[0, 1, 2, 3].map((n) => fasterCooldown(u.moveCooldownTicks, 10 * n)),
      ]);
    expect(rows).toEqual([
      ['unit_soldier', 6, 5, 5, 4],
      ['unit_raider', 4, 3, 3, 3],
      ['unit_familiar', 3, 2, 2, 2],
      ['unit_heavy', 6, 5, 5, 4],
      ['unit_golem', 10, 9, 8, 7],
      ['unit_lancer', 6, 5, 5, 4],
      ['unit_archer', 6, 5, 5, 4],
      ['unit_drone', 4, 3, 3, 3],
      ['unit_caster', 6, 5, 5, 4],
    ]);
  });

  test('attack cooldowns at 0 and 1 Rapid fire, and at 1 to 3 stacks', () => {
    const rows = content.units
      .list()
      .map((u) => [
        u.id,
        u.attackCooldownTicks,
        fasterCooldown(u.attackCooldownTicks, 15),
      ]);
    expect(rows).toEqual([
      ['unit_soldier', 10, 8],
      ['unit_raider', 8, 6],
      ['unit_familiar', 10, 8],
      ['unit_heavy', 10, 8],
      ['unit_golem', 14, 12],
      ['unit_lancer', 12, 10],
      ['unit_archer', 10, 8],
      ['unit_drone', 8, 6],
      ['unit_caster', 20, 17],
    ]);
  });
});

describe('unitSpeedPercent', () => {
  test('sums only the matching kind and the units that apply', () => {
    let team = withModifier({}, quick);
    team = withModifier(team, quick);
    team = withModifier(team, rapid);
    team = withModifier(team, {
      id: 'mod_t',
      effects: [
        { kind: 'unit_move_speed_percent', percent: 7, units: ['unit_raider'] },
      ],
    });
    expect(
      unitSpeedPercent(team, 'unit_move_speed_percent', 'unit_raider'),
    ).toBe(27);
    expect(
      unitSpeedPercent(team, 'unit_move_speed_percent', 'unit_soldier'),
    ).toBe(20);
    expect(
      unitSpeedPercent(team, 'unit_attack_speed_percent', 'unit_soldier'),
    ).toBe(15);
    expect(
      unitSpeedPercent({}, 'unit_attack_speed_percent', 'unit_soldier'),
    ).toBe(0);
  });
});

describe('in battle', () => {
  const board = buildReferenceBoard('poor', content, mapgen);

  function start(a: readonly TeamModifier[], b: readonly TeamModifier[] = []) {
    let ta = board;
    for (const m of a) ta = withModifier(ta, m);
    let tb = board;
    for (const m of b) tb = withModifier(tb, m);
    return startArenaBattle(ta, tb, 4, content, simConfig);
  }

  test('a unit spawns with the reduced cooldowns, kept for its lifetime', () => {
    const s = start([quick, quick, quick, rapid]);
    const raider = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_raider',
      x: 2,
      y: 20,
    });
    expect(raider.moveCooldownTicks).toBe(3);
    expect(raider.attackCooldownTicks).toBe(6);
    // The other side holds none: its units have no extra fields at all.
    const theirs = spawnUnitForTest(s.sim, s.ctx, {
      side: 1,
      def: 'unit_raider',
      x: 8,
      y: 20,
    });
    expect('moveCooldownTicks' in theirs).toBe(false);
    expect('attackCooldownTicks' in theirs).toBe(false);
    // Taking a modifier later does not change a unit already spawned.
    s.sim.teams[0] = withModifier(s.sim.teams[0], quick);
    expect(raider.moveCooldownTicks).toBe(3);
  });

  test('a stack that changes nothing leaves the unit without the field', () => {
    const s = start([quick]);
    const soldier = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 2,
      y: 20,
    });
    expect(soldier.moveCooldownTicks).toBe(5);
    expect('attackCooldownTicks' in soldier).toBe(false);
  });

  test('Quick march makes a unit walk further in the same ticks', () => {
    const walked = (mods: readonly TeamModifier[]) => {
      const s = start(mods);
      const u = spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_soldier',
        x: 2,
        y: 20,
      });
      const y0 = u.py;
      for (let t = 0; t < 12; t++) stepArena(s.sim, s.ctx);
      return Math.abs(u.py - y0);
    };
    const none = walked([]);
    expect(walked([quick])).toBeGreaterThan(none);
    expect(walked([quick, quick, quick])).toBeGreaterThan(walked([quick]));
  });

  test('Rapid fire shortens the time between two attacks of a unit', () => {
    const gap = (mods: readonly TeamModifier[]) => {
      const s = start(mods);
      const a = spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_soldier',
        x: 2,
        y: 20,
      });
      spawnUnitForTest(s.sim, s.ctx, {
        side: 1,
        def: 'unit_golem',
        x: 2,
        y: 19,
      });
      const ticks: number[] = [];
      for (let t = 0; t < 120 && ticks.length < 3; t++) {
        stepArena(s.sim, s.ctx);
        for (const e of s.events) {
          if (e.type === 'unit_attacked' && e.unit === a.id && e.tick === t) {
            ticks.push(t);
          }
        }
      }
      return ticks.length === 3 ? (ticks[2] ?? 0) - (ticks[1] ?? 0) : -1;
    };
    expect(gap([])).toBe(10);
    expect(gap([rapid])).toBe(8);
  });
});
