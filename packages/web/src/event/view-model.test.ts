import { describe, expect, test } from 'vitest';
import type { Json, RunState } from '@game/session';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import {
  playUntil,
  newRun,
  realDeps,
  reachStep,
  send,
} from '../run/test-run.js';
import { battleHeader, eventCards, followUpView } from './view-model.js';

const config = gameConfigs.events;

/** A run in the event step with these offers (1 to 3 of them). */
function withOffers(run: RunState, options: Json[]): RunState {
  return {
    ...run,
    pending: { options },
    votes: { topic: 'event', choices: [null] },
  };
}

describe('the battle header', () => {
  test('after a PvE battle: result, difficulty, archetype and the gold it paid', () => {
    const run = reachStep('event_choice');
    const h = battleHeader(run, realDeps());
    expect(h?.kind).toBe('pve');
    expect(h?.text).toMatch(
      /^PvE battle (won|lost) · (Easy|Medium|Hard) · \w+/,
    );
    expect(h?.text).not.toMatch(/arch_/);
    expect(h?.payout).toBe(
      h?.won === true
        ? `+${String(
            realDeps().rewards?.pveWin[
              (run.thisRound.pve?.difficulty ?? 'medium') as 'medium'
            ],
          )} gold`
        : 'No reward, and no life lost',
    );
  });

  test('after a PvP battle: the boss, and the life a loss costs', () => {
    const run = playUntil(
      newRun(),
      (s) => s.step === 'event_choice' && s.leg === 'pvp',
    );
    const h = battleHeader(run, realDeps());
    expect(h?.kind).toBe('pvp');
    expect(h?.text).toMatch(/vs\. the boss( \(\w+\))?$/);
    expect(h?.text).not.toMatch(/the boss \(Boss\)/);
    if (!h?.won) {
      expect(h?.payout).toMatch(/^−1 life · \+\d+ gold consolation$/);
    } else {
      expect(h.payout).toMatch(/^\+\d+ gold$/);
    }
  });

  test('no header when no battle has been fought', () => {
    expect(battleHeader(newRun(), realDeps())).toBeNull();
  });
});

describe('event cards', () => {
  const run = reachStep('event_choice');

  test('one to three cards, each saying what it does from its data', () => {
    const cards = eventCards(run, config, 0);
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards.length).toBeLessThanOrEqual(3);
    for (const c of cards) {
      expect(c.title).not.toMatch(/evt_/);
      expect(c.lines.length).toBeGreaterThan(0);
      expect(c.id).toBeTruthy();
    }
  });

  test('a Workshop states the tier count of its offer', () => {
    const [c] = eventCards(
      withOffers(run, [
        {
          id: 'evt_workshop',
          event: 'evt_workshop',
          type: 'workshop',
          tiers: 2,
        },
      ]),
      config,
      0,
    );
    expect(c?.title).toBe('Workshop');
    expect(c?.lines.join(' ')).toMatch(/by 2 tiers/);
  });

  test('cards do not repeat themselves and each event has its own icon', () => {
    const cards = eventCards(
      withOffers(run, [
        { id: 'a', type: 'workshop', tiers: 1 },
        { id: 'b', type: 'shrine', modifiers: ['mod_stout_walls'] },
        { id: 'c', type: 'windfall', gold: 3 },
      ]),
      config,
      0,
    );
    expect(new Set(cards.map((c) => c.icon)).size).toBe(3);
    const shrine = cards.find((c) => c.type === 'shrine');
    const text = [...(shrine?.lines ?? []), shrine?.flavour ?? ''].join(' ');
    expect(text.match(/lasts until the run ends/g)).toHaveLength(1);
    const workshop = cards.find((c) => c.type === 'workshop');
    expect(workshop?.lines.join(' ')).toMatch(/by 1 tier \(/);
    expect(
      `${workshop?.lines.join(' ') ?? ''} ${workshop?.flavour ?? ''}`,
    ).not.toMatch(/party|You pick/);
  });

  test('a Shrine lists the modifiers on offer with their effects', () => {
    const [c] = eventCards(
      withOffers(run, [
        {
          id: 'evt_shrine',
          event: 'evt_shrine',
          type: 'shrine',
          modifiers: ['mod_stout_walls', 'mod_drilled_troops'],
        },
      ]),
      config,
      0,
    );
    expect(c?.lines.join(' ')).toMatch(/Choose 1 of 2 run modifiers/);
    expect(c?.modifiers.map((m) => m.id)).toEqual([
      'mod_stout_walls',
      'mod_drilled_troops',
    ]);
    expect(c?.modifiers[0]?.effects).toEqual(['Walls: +25% health']);
    expect(c?.modifiers[1]?.effects).toEqual(['Your units: +10% strength']);
    expect(c?.modifiers[1]?.stacks).toBe(true);
  });

  test('a Windfall states its gold', () => {
    const [c] = eventCards(
      withOffers(run, [
        {
          id: 'evt_windfall',
          event: 'evt_windfall',
          type: 'windfall',
          gold: 4,
        },
      ]),
      config,
      0,
    );
    expect(c?.lines).toEqual(['Each player gets 4 gold.']);
  });

  test('the count can be 1, 2 or 3: the view never assumes three', () => {
    const offer = (n: number): Json => ({
      id: `evt_windfall#${String(n)}`,
      event: 'evt_windfall',
      type: 'windfall',
      gold: n,
    });
    for (const n of [1, 2, 3]) {
      const offers = Array.from({ length: n }, (_, i) => offer(i + 1));
      expect(eventCards(withOffers(run, offers), config, 0)).toHaveLength(n);
    }
  });

  test('an event type the screen does not know shows its own data', () => {
    const [c] = eventCards(
      withOffers(run, [
        { id: 'evt_x', event: 'evt_x', type: 'mystery', depth: 3 },
      ]),
      config,
      0,
    );
    expect(c?.lines).toEqual(['depth: 3']);
  });
});

describe('follow-ups', () => {
  /** Pick the first offer of `type` along the default path, if offered. */
  function pickEvent(type: string): RunState | null {
    for (let seed = 1; seed < 40; seed++) {
      let s = playUntil(newRun(seed), (r) => r.step === 'event_choice');
      const offer = (
        s.pending as unknown as { options: { id: string; type: string }[] }
      ).options.find((o) => o.type === type);
      if (offer === undefined) continue;
      s = send(s, { type: 'vote', choice: offer.id });
      if (s.step === 'event_resolve') return s;
    }
    return null;
  }

  test('a Workshop asks which building, from the options it stored', () => {
    const s = pickEvent('workshop');
    expect(s).not.toBeNull();
    const v = followUpView(s as RunState, config, content, 0);
    expect(v?.eventTitle).toBe('Workshop');
    expect(v?.prompt).toBe('Choose a building to raise');
    expect(v?.options.length).toBeGreaterThan(0);
    expect(v?.options[0]?.title).toMatch(/· tier \d$/);
    expect(v?.options[0]?.lines[0]).toMatch(/^Becomes tier \d\.$/);
  });

  test('a per-player Workshop follow-up shows own options, prices, new tiers and Skip', () => {
    const s = pickEvent('workshop') as RunState;
    const def = (s.team.buildings[0]?.def ?? 'wall') as string;
    const gold = s.perPlayer[0]?.gold ?? 0;
    const odd: RunState = {
      ...s,
      pending: {
        offer: { id: 'evt_w', type: 'workshop', tiers: 1 },
        followUp: {
          prompt: 'workshop_building',
          options: [
            { id: 'mine', def, tier: 1, newTier: 2, price: 1, player: 0 },
            { id: 'dear', def, tier: 1, newTier: 3, price: gold + 50 },
            { id: 'theirs', def, tier: 1, newTier: 2, price: 1, player: 1 },
            { id: 'skip', skip: true },
          ],
          votes: [null],
        },
      },
    };
    const v = followUpView(odd, config, content, 0);
    expect(v?.options.map((o) => o.id)).toEqual(['mine', 'dear', 'skip']);
    expect(v?.options[0]?.lines).toContain('Becomes tier 2.');
    expect(v?.options[0]?.lines).toContain('Costs 1 gold.');
    expect(v?.options[0]?.affordable).toBe(true);
    expect(v?.options[1]?.lines).toContain('Becomes tier 3.');
    expect(v?.options[1]?.affordable).toBe(false);
    expect(v?.options[2]).toMatchObject({ title: 'Skip', skip: true });
  });

  test('a Shrine asks which modifier and spells out the effects', () => {
    const s = pickEvent('shrine');
    expect(s).not.toBeNull();
    const v = followUpView(s as RunState, config, content, 0);
    expect(v?.prompt).toBe('Choose a run modifier');
    expect(v?.options.length).toBeGreaterThan(0);
    for (const o of v?.options ?? []) {
      expect(o.title).not.toMatch(/mod_/);
      expect(o.lines.some((l) => /\+\d+%/.test(l))).toBe(true);
    }
  });

  test('options it has never seen still show up, by id', () => {
    const s = pickEvent('shrine') as RunState;
    const odd: RunState = {
      ...s,
      pending: {
        offer: { id: 'evt_x', type: 'gamble' },
        followUp: {
          prompt: 'gamble_stake',
          options: [{ id: 'all_in' }],
          votes: [null],
        },
      },
    };
    const v = followUpView(odd, config, content, 0);
    expect(v?.prompt).toBe('Make a choice');
    expect(v?.options).toEqual([
      {
        id: 'all_in',
        title: 'all_in',
        lines: [],
        affordable: true,
        skip: false,
      },
    ]);
  });

  test('no follow-up outside event_resolve', () => {
    expect(followUpView(newRun(), config, content, 0)).toBeNull();
  });
});
