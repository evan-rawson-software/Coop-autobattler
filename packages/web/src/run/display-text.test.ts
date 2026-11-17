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
    ).toBe('+20% soldier and raider strength');
  });

  test('three or more are listed with commas', () => {
    expect(
      effectLine({
        kind: 'unit_strength_percent',
        percent: 5,
        units: ['unit_soldier', 'unit_raider', 'unit_archer'],
      }),
    ).toBe('+5% soldier, raider and archer strength');
  });

  test('other kinds are unchanged', () => {
    expect(effectLine({ kind: 'turret_damage_percent', percent: 20 })).toBe(
      'Turrets: +20% damage',
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
    ).toBe('+10% raider and drone move speed');
  });

  test('a negative percent reads with a real minus sign', () => {
    expect(effectLine({ kind: 'core_health_percent', percent: -15 })).toBe(
      'Your Core: −15% health',
    );
  });
});
