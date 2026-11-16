import { describe, expect, test } from 'vitest';
import type { TeamModifier } from '@game/core';
import { bonusView, totalEffects } from './bonus-view.js';

const stout: TeamModifier = {
  id: 'mod_stout_walls',
  effects: [{ kind: 'building_health_percent', target: 'wall', percent: 25 }],
};
const drilled: TeamModifier = {
  id: 'mod_drilled_troops',
  effects: [{ kind: 'unit_strength_percent', percent: 10 }],
};
const vanguard: TeamModifier = {
  id: 'mod_vanguard',
  effects: [
    { kind: 'unit_strength_percent', percent: 25, units: ['unit_archer'] },
  ],
};

describe('bonusView', () => {
  test('nothing held gives nothing', () => {
    expect(bonusView(undefined)).toEqual({ count: 0, totals: [], held: [] });
    expect(totalEffects([])).toEqual([]);
  });

  test('stacks count each and show once with ×N', () => {
    const v = bonusView([stout, drilled, stout, stout]);
    expect(v.count).toBe(4);
    expect(v.held.map((h) => [h.id, h.count])).toEqual([
      ['mod_stout_walls', 3],
      ['mod_drilled_troops', 1],
    ]);
    expect(v.totals.map((l) => l.text)).toEqual([
      'Walls: +75% health',
      'Your units: +10% strength',
    ]);
  });

  test('targeted and untargeted unit strength stay apart', () => {
    const t = totalEffects([drilled, vanguard, drilled]);
    expect(t).toEqual([
      { kind: 'unit_strength_percent', percent: 20 },
      { kind: 'unit_strength_percent', percent: 25, units: ['unit_archer'] },
    ]);
  });

  test('mixed signs sum, and a negative total is flagged with a minus', () => {
    const curse: TeamModifier = {
      id: 'mod_synthetic_curse',
      effects: [
        { kind: 'building_health_percent', target: 'wall', percent: -40 },
        { kind: 'turret_damage_percent', percent: -15 },
      ],
    };
    const v = bonusView([stout, curse]);
    expect(v.totals).toEqual([
      { text: 'Walls: −15% health', negative: true },
      { text: 'Turrets: −15% damage', negative: true },
    ]);
    expect(v.held[1]?.lines.every((l) => l.negative)).toBe(true);
    expect(v.held[0]?.lines[0]?.negative).toBe(false);
  });

  test('a sum of zero is left out of the totals', () => {
    const undo: TeamModifier = {
      id: 'mod_synthetic_undo',
      effects: [
        { kind: 'building_health_percent', target: 'wall', percent: -25 },
      ],
    };
    expect(bonusView([stout, undo]).totals).toEqual([]);
  });
});
