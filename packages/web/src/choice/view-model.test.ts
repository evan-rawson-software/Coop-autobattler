import { describe, expect, test } from 'vitest';
import { reachStep, realDeps, send } from '../run/test-run.js';
import { simConfig } from '../build/setup.js';
import { coreMaxHealth } from '@game/core';
import { overloadLine } from './overload.js';
import { overloadClock, pveChoiceView, threatFacts } from './view-model.js';

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

  test('the stakes and the Overload start are stated', () => {
    expect(view?.stakes).toMatch(/Lose: no reward, and no life lost/);
    expect(view?.overloadAt).toBe(overloadClock(simConfig));
    expect(overloadClock(simConfig)).toBe('3:00');
  });

  test('each card says which Core Overload destroys first', () => {
    for (const c of view?.cards ?? []) {
      expect(c.overload).toMatch(/^Overload at 3:00 would /);
      expect(c.overload).not.toMatch(/Destroy the stronghold before/);
    }
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

describe('threat facts use the right plural', () => {
  test('1 wall, 1 turret and 1 enemy unit are singular', () => {
    const o = {
      summary: {
        totalUnits: 1,
        walls: 1,
        turrets: 1,
        coreHealth: 90,
        firstWaveTick: null,
      },
    } as unknown as Parameters<typeof threatFacts>[0];
    const facts = threatFacts(o, simConfig);
    expect(facts).toContain('1 enemy unit');
    expect(facts).toContain('1 wall');
    expect(facts).toContain('1 turret');
    const many = threatFacts(
      {
        summary: { ...o.summary, totalUnits: 4, walls: 2, turrets: 3 },
      } as never,
      simConfig,
    );
    expect(many).toEqual(
      expect.arrayContaining(['4 enemy units', '2 walls', '3 turrets']),
    );
  });
});

describe('the Overload line', () => {
  test('a smaller stronghold Core falls first: outlasting it wins', () => {
    // The small (stronghold) Core falls at 3:30; the larger one would fall later.
    expect(overloadLine(simConfig, 500, 42)).toBe(
      "Overload at 3:00 would destroy the stronghold's Core first at 3:30 — outlasting it wins.",
    );
  });
  test('a larger stronghold Core: the party Core falls first', () => {
    expect(overloadLine(simConfig, 500, 2140)).toMatch(
      /would destroy your Core first at \d+:\d\d — break the stronghold before then\.$/,
    );
  });
  test('equal Cores fall together', () => {
    expect(overloadLine(simConfig, 500, 500)).toMatch(/both Cores at/);
  });
  test('a Core the decay cannot destroy in time is not named', () => {
    expect(overloadLine(simConfig, 50000, 60000)).toMatch(
      /would not destroy either Core/,
    );
  });
  test('a side falls with its last Core: several Cores per side', () => {
    // Each side's last-Core tick is its largest deadline, so the strongest Core counts.
    expect(overloadLine(simConfig, [500, 42, 42], [500, 500, 42, 42])).toMatch(
      /both Cores at/,
    );
    expect(overloadLine(simConfig, [500, 500, 500], [42, 42])).toBe(
      "Overload at 3:00 would destroy the stronghold's Core first at 3:30 — outlasting it wins.",
    );
    expect(overloadLine(simConfig, [42], [500, 42, 42, 42])).toMatch(
      /would destroy your Core first/,
    );
  });
  test('the party Core is read from content', () => {
    const run = reachStep('pve_choice');
    expect(coreMaxHealth(run.team, realDeps().content)).toBe(500);
  });
});
