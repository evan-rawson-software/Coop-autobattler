import { describe, expect, test } from 'vitest';
import { reachStep, realDeps, send } from '../run/test-run.js';
import { simConfig } from '../build/setup.js';
import { overloadClock, pveChoiceView } from './view-model.js';

describe('PvE choice cards', () => {
  const run = reachStep('pve_choice');
  const view = pveChoiceView(run, realDeps(), simConfig, 0);

  test('three cards: difficulty, archetype, what it does, threat and reward', () => {
    expect(view).not.toBeNull();
    const cards = view?.cards ?? [];
    expect(cards.map((c) => c.difficulty)).toEqual(['Easy', 'Medium', 'Hard']);
    for (const c of cards) {
      expect(c.archetype.length).toBeGreaterThan(2);
      // Plain words, not an id.
      expect(c.archetype).not.toMatch(/arch_/);
      expect(c.description.length).toBeGreaterThan(20);
      expect(c.level).toBeGreaterThanOrEqual(1);
      expect(c.level).toBeLessThanOrEqual(3);
      expect(c.facts.some((f) => /Core \d+ health/.test(f))).toBe(true);
      expect(c.rewardText).toMatch(/^\+\d+ gold$/);
    }
  });

  test('threat levels rise with difficulty and rewards do not fall', () => {
    const cards = view?.cards ?? [];
    expect(cards.map((c) => c.level)).toEqual([1, 2, 3]);
    const gold = cards.map((c) => Number(/\d+/.exec(c.rewardText)?.[0]));
    expect(gold[0]).toBeLessThan(gold[2] as number);
  });

  test('the stakes and the Overload deadline are stated', () => {
    expect(view?.stakes).toMatch(/Lose: no reward, and no life lost/);
    expect(view?.deadline).toMatch(/Destroy the stronghold before Overload/);
    // The time comes from the sim config, not from this file.
    expect(view?.deadline).toContain(overloadClock(simConfig));
    expect(overloadClock(simConfig)).toBe(
      `${String(Math.floor(simConfig.overloadStartTick / simConfig.ticksPerSecond / 60))}:${String((simConfig.overloadStartTick / simConfig.ticksPerSecond) % 60).padStart(2, '0')}`,
    );
  });

  test('a solo vote starts the battle at once', () => {
    const voted = send(run, { type: 'vote', choice: 'hard' });
    // A solo vote ends the step, so the vote is gone with it.
    expect(voted.step).toBe('pve_summary');
    expect(pveChoiceView(voted, realDeps(), simConfig, 0)).toBeNull();
  });

  test('no cards when the next battle is PvP', () => {
    // The first shop leads into the PvP battle, whose opponent is never shown.
    expect(
      pveChoiceView(reachStep('shop'), realDeps(), simConfig, 0),
    ).toBeNull();
  });
});
