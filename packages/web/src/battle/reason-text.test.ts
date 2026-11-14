import type { BattleReason } from '@game/core';
import { describe, expect, test } from 'vitest';
import { genericReasonText, reasonText, stepText } from './panels.js';

// Each reason picks its own text, and a double fall words differently from the
// time limit. A wrong key in code reads as the wrong text, or as the raw key.

const REASONS: readonly BattleReason[] = [
  'core_destroyed',
  'tiebreak_overkill',
  'tiebreak_building_damage',
  'tiebreak_kills',
  'tiebreak_attacker',
  'time_limit',
];

const side = (standing: number, health = 100) => ({
  coresStanding: standing,
  coreHealth: health,
  coreMaxHealth: 200,
});
const alive = [side(1), side(1)] as const;
const bothDown = [side(0, 0), side(0, 0)] as const;

describe('genericReasonText', () => {
  const texts = REASONS.map((r) => genericReasonText(r, 'Hub'));

  test('every reason has its own text with no slot left unfilled', () => {
    expect(new Set(texts).size).toBe(REASONS.length);
    for (const t of texts) expect(t).not.toMatch(/[{}]/);
    expect(texts[0]).toContain('Hub');
  });

  test('each text says what decided the battle', () => {
    const by = Object.fromEntries(REASONS.map((r, i) => [r, texts[i]]));
    expect(by['core_destroyed']).toMatch(/Last Hub destroyed/);
    expect(by['tiebreak_overkill']).toMatch(/overkill/);
    expect(by['tiebreak_building_damage']).toMatch(/damage to buildings/);
    expect(by['tiebreak_kills']).toMatch(/more kills/);
    expect(by['tiebreak_attacker']).toMatch(/attacker/);
    expect(by['time_limit']).toMatch(/Time ran out/);
  });
});

describe('stepText', () => {
  test('a destroyed Core has no step text', () => {
    expect(stepText('core_destroyed', 'Hub', alive)).toBeNull();
  });

  test('the time limit names the figure that decided it', () => {
    const cores = stepText('time_limit', 'Hub', [side(2), side(1)]);
    expect(cores).toMatch(/more Hubs standing/);
    expect(cores).toContain('(2 vs 1)');
    const share = stepText('time_limit', 'Hub', [side(1, 80), side(1, 120)]);
    expect(share).toMatch(/more Hub health left/);
  });

  test('a double fall and the time limit read differently for each tie step', () => {
    for (const r of [
      'tiebreak_building_damage',
      'tiebreak_kills',
      'tiebreak_attacker',
    ] as const) {
      const time = stepText(r, 'Hub', alive);
      const double = stepText(r, 'Hub', bothDown);
      expect(time).toMatch(/^Time ran out/);
      expect(double).toMatch(/^Both last Hubs fell at once/);
      expect(time).not.toBe(double);
    }
  });

  test('each tie step says its own deciding figure', () => {
    expect(stepText('tiebreak_building_damage', 'Hub', alive)).toMatch(
      /more damage to buildings/,
    );
    expect(stepText('tiebreak_kills', 'Hub', bothDown)).toMatch(/more kills/);
    expect(stepText('tiebreak_attacker', 'Hub', alive)).toMatch(/attacker/);
  });

  test('overkill is a time-limit step only; a double fall falls back to the generic text', () => {
    expect(stepText('tiebreak_overkill', 'Hub', alive)).toMatch(
      /^Time ran out.*less overkill/,
    );
    expect(stepText('tiebreak_overkill', 'Hub', bothDown)).toBeNull();
    expect(reasonText('tiebreak_overkill', 'Hub', bothDown)).toBe(
      genericReasonText('tiebreak_overkill', 'Hub'),
    );
  });
});
