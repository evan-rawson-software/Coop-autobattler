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

describe('feature-linked totals (issue #426)', () => {
  const stone: TeamModifier = {
    id: 'mod_stone_skin',
    effects: [{ kind: 'unit_armor_flat', amount: 1, units: ['unit_golem'] }],
  };
  const claim: TeamModifier = {
    id: 'mod_claimstakers',
    effects: [{ kind: 'poi_capture_speed_percent', percent: 50 }],
  };

  test('armor amounts and capture percents sum per kind', () => {
    const v = bonusView([stone, claim, stone, claim]);
    expect(v.totals.map((l) => l.text)).toEqual([
      '+2 golem armor',
      'Your units: +100% point capture speed',
    ]);
  });
});

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
      { text: 'Arc turrets: −15% damage', negative: true },
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

describe('totals with a drawback (#413)', () => {
  test('a sum below the floor is shown at the floor, as the simulation applies it', () => {
    const core = (percent: number) => ({
      id: 'mod_x',
      effects: [{ kind: 'core_health_percent' as const, percent }],
    });
    expect(totalEffects([core(20), core(-15)])).toEqual([
      { kind: 'core_health_percent', percent: 5 },
    ]);
    expect(totalEffects([core(-40), core(-30)])).toEqual([
      { kind: 'core_health_percent', percent: -50 },
    ]);
    expect(totalEffects([core(-15), core(15)])).toEqual([]);
  });
});
