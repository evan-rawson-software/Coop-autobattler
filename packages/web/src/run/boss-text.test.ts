import { describe, expect, test } from 'vitest';
import { screenTexts } from '../build/texts.js';
import { bossInfo, bossMechanic } from './boss-text.js';

describe('boss text', () => {
  test.each([
    [
      'arch_boss',
      'Boss',
      'Every third wave is a swarm of raiders.',
      'Counter: Defense against swarms.',
    ],
    [
      'arch_boss_brood',
      'Brood',
      'Its Cores burst out a swarm of units each time their health falls to 75%, 50% and 25%.',
      "Counter: Keep defense at home; don't go all-in on attack.",
    ],
    [
      'arch_boss_linked',
      'Bonded',
      'Its Cores share one health pool: a hit on any Core hurts them all, and they fall together.',
      'Counter: A strong lane carries a weak one: total pressure matters.',
    ],
    [
      'arch_boss_pylons',
      'Pylons',
      'Its Cores take no damage while the pylons beside them stand.',
      'Counter: Bring enough units to break through, and ranged units to reach the pylons.',
    ],
    [
      'arch_boss_warlord',
      'Warlord',
      "Every wave is led by a champion Golem with several times a Golem's health.",
      'Counter: Focused damage and walls that delay it; its armor shrugs off splash.',
    ],
  ])(
    '%s has a name, a mechanic and a counter',
    (id, name, mechanic, counter) => {
      expect(bossInfo(id)).toEqual({ id, name, mechanic, counter });
    },
  );

  test('an older save, with no boss recorded, gets the generic lines', () => {
    const info = bossInfo(undefined);
    expect(info.id).toBeNull();
    expect(info.name).toBe('Boss');
    expect(info.mechanic).toBe(
      'A computer-made stronghold, not another party.',
    );
    expect(info.counter).toBe(
      'Counter: Defense at home, and enough attack to break through.',
    );
  });

  test('an archetype the table does not know gets the generic lines', () => {
    const info = bossInfo('arch_boss_future');
    expect(info.mechanic).toBe(bossInfo(undefined).mechanic);
    expect(info.id).toBe('arch_boss_future');
  });

  test('the words come from the presentation file', () => {
    const texts = {
      ...screenTexts,
      bossMechanicBurst: 'Bursts.',
      bossCounterBurst: 'Hold.',
      uiNextBossCounter: 'Try: {advice}',
    };
    expect(bossInfo('arch_boss_brood', texts)).toMatchObject({
      mechanic: 'Bursts.',
      counter: 'Try: Hold.',
    });
    expect(bossMechanic('arch_boss_brood', texts)).toBe('Bursts.');
  });
});
