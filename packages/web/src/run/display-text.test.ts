import { describe, expect, test } from 'vitest';
import { effectLine } from './display-text.js';

describe('effectLine', () => {
  test('an untargeted unit strength effect reads for all units', () => {
    expect(effectLine({ kind: 'unit_strength_percent', percent: 10 })).toBe(
      'Your units: +10% strength',
    );
  });

  test('a targeted effect names the unit types, lower-cased', () => {
    expect(
      effectLine({
        kind: 'unit_strength_percent',
        percent: 25,
        units: ['unit_archer'],
      }),
    ).toBe('+25% archer strength');
    expect(
      effectLine({
        kind: 'unit_strength_percent',
        percent: 20,
        units: ['unit_soldier', 'unit_raider'],
      }),
    ).toBe('+20% soldier and scamp strength');
  });

  test('three or more are listed with commas', () => {
    expect(
      effectLine({
        kind: 'unit_strength_percent',
        percent: 5,
        units: ['unit_soldier', 'unit_raider', 'unit_archer'],
      }),
    ).toBe('+5% soldier, scamp and archer strength');
  });

  test('other kinds are unchanged', () => {
    expect(effectLine({ kind: 'turret_damage_percent', percent: 20 })).toBe(
      'Arc turrets: +20% damage',
    );
  });

  test('speed effects read as move speed and attack speed', () => {
    expect(effectLine({ kind: 'unit_move_speed_percent', percent: 10 })).toBe(
      'Your units: +10% move speed',
    );
    expect(effectLine({ kind: 'unit_attack_speed_percent', percent: 15 })).toBe(
      'Your units: +15% attack speed',
    );
    expect(
      effectLine({
        kind: 'unit_move_speed_percent',
        percent: 10,
        units: ['unit_raider', 'unit_drone'],
      }),
    ).toBe('+10% scamp and whirligig move speed');
  });

  test('gold effects read as gold per shop and sell refund', () => {
    expect(effectLine({ kind: 'shop_income_flat', amount: 1 })).toBe(
      'Every player: +1 gold per shop',
    );
    expect(effectLine({ kind: 'sell_refund_percent', percent: 25 })).toBe(
      'Every player: +25% sell refund',
    );
  });

  test('armor, splash and capture speed effects (issue #426)', () => {
    expect(
      effectLine({ kind: 'unit_armor_flat', amount: 1, units: ['unit_golem'] }),
    ).toBe('+1 golem armor');
    expect(effectLine({ kind: 'unit_armor_flat', amount: 2 })).toBe(
      'Your units: +2 armor',
    );
    expect(
      effectLine({
        kind: 'unit_splash_percent',
        percent: 50,
        units: ['unit_caster'],
      }),
    ).toBe('+50% caster splash');
    expect(effectLine({ kind: 'unit_splash_percent', percent: 50 })).toBe(
      'Your units: +50% splash',
    );
    expect(effectLine({ kind: 'poi_capture_speed_percent', percent: 50 })).toBe(
      'Your units: +50% point capture speed',
    );
  });

  test('a negative percent reads with a real minus sign', () => {
    expect(effectLine({ kind: 'core_health_percent', percent: -15 })).toBe(
      'Your Core: −15% health',
    );
  });
});
