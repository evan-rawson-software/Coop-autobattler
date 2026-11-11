import { describe, expect, test } from 'vitest';
import {
  SKIP_CHOICE,
  applyIntent,
  type Json,
  type RunState,
} from '@game/session';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import {
  playUntil,
  newRun,
  realDeps,
  reachStep,
  send,
} from '../run/test-run.js';
import {
  appliedNotice,
  battleHeader,
  eventCards,
  followUpView,
} from './view-model.js';

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

  test('a Workshop asks which of my buildings, with where, tiers, price and Skip', () => {
    const s = pickEvent('workshop');
    expect(s).not.toBeNull();
    const run = s as RunState;
    const v = followUpView(run, config, content, 0, realDeps());
    expect(v?.eventTitle).toBe('Workshop');
    expect(v?.perPlayer).toBe(true);
    expect(v?.prompt).toMatch(/Choose one of your buildings/);
    const cards = (v?.options ?? []).filter((o) => !o.skip);
    expect(cards.length).toBeGreaterThan(0);
    for (const o of cards) {
      expect(o.building?.where).toMatch(
        /^(On the board at column \d+, row \d+|In your stash)$/,
      );
      expect(o.building?.newTier).toBe((o.building?.tier ?? 0) + 1);
      expect(o.lines).toContain(`Costs ${String(o.building?.price)} gold`);
    }
    // The last option is always Skip, with the session's id.
    expect(v?.options.at(-1)).toMatchObject({
      id: SKIP_CHOICE,
      title: 'Skip',
      skip: true,
    });
  });

  test('the price is the session price from current content, not a stored number', () => {
    const s = pickEvent('workshop') as RunState;
    const pending = s.pending as unknown as {
      followUp: { options: Record<string, Json>[] };
    };
    const stale: RunState = {
      ...s,
      pending: {
        ...(s.pending as object),
        followUp: {
          ...pending.followUp,
          options: pending.followUp.options.map((o) => ({ ...o, price: 9999 })),
        },
      },
    };
    const shown = followUpView(stale, config, content, 0, realDeps());
    const fresh = followUpView(s, config, content, 0, realDeps());
    expect(shown?.options.map((o) => o.building?.price)).toEqual(
      fresh?.options.map((o) => o.building?.price),
    );
    expect(shown?.options[0]?.building?.price).not.toBe(9999);
  });

  test('an option the player cannot pay is disabled with the reason', () => {
    const s = pickEvent('workshop') as RunState;
    const poor: RunState = {
      ...s,
      perPlayer: s.perPlayer.map((p) => ({ ...p, gold: 0 })),
    };
    const v = followUpView(poor, config, content, 0, realDeps());
    const first = (v?.options ?? []).find((o) => !o.skip);
    expect(first?.affordable).toBe(false);
    expect(first?.disabledReason).toMatch(
      /^Not enough gold: it costs \d+, you have 0\./,
    );
    expect(v?.options.at(-1)?.affordable).toBe(true);
  });

  test('identical buildings are told apart by their board position', () => {
    const s = pickEvent('workshop') as RunState;
    const v = followUpView(s, config, content, 0, realDeps());
    const placed = (v?.options ?? []).filter((o) => o.building?.placed);
    const wheres = placed.map((o) => o.building?.where);
    expect(new Set(wheres).size).toBe(wheres.length);
  });

  test('with a party, a chosen player sees who is still choosing, not what', () => {
    const s = pickEvent('workshop') as RunState;
    const two: RunState = {
      ...s,
      players: [...s.players, { index: 1, name: 'Ana' }],
      perPlayer: [...s.perPlayer, { ...(s.perPlayer[0] as object) } as never],
      pending: {
        ...(s.pending as object),
        followUp: {
          ...(s.pending as { followUp: object }).followUp,
          votes: [SKIP_CHOICE, null],
        },
      },
    };
    const v = followUpView(two, config, content, 0, realDeps());
    expect(v?.voted).toBe(SKIP_CHOICE);
    expect(v?.waiting).toMatch(/Waiting for other players: Ana/);
    expect(v?.waiting).not.toMatch(/skip/i);
    expect(v?.chosen).toEqual([
      { name: 'You', done: true },
      { name: 'Ana', done: false },
    ]);
  });

  test('a solo Workshop pick buys the upgrade and the notice says so', () => {
    const s = pickEvent('workshop') as RunState;
    const v = followUpView(s, config, content, 0, realDeps());
    const pick = (v?.options ?? []).find((o) => !o.skip && o.affordable);
    if (pick?.building === null || pick === undefined) return;
    const r = applyIntent(
      s,
      0,
      { type: 'event_choose', choice: pick.id },
      realDeps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const eff = r.effects.find(
      (e) => e.type === 'custom' && e.name === 'event_resolved',
    );
    const applied = (eff as unknown as { data: { applied: Json[] } }).data
      .applied;
    expect(appliedNotice(applied, 0, content)).toBe(
      `Upgraded ${pick.building.name} to tier ${String(pick.building.newTier)} for ${String(pick.building.price)} gold.`,
    );
    expect(applied[0]).toMatchObject({
      result: 'upgrade',
      price: pick.building.price,
    });
  });

  test('appliedNotice words a skip and a dropped pick', () => {
    expect(appliedNotice([{ player: 0, result: 'skip' }], 0, content)).toBe(
      'You skipped the Workshop.',
    );
    expect(
      appliedNotice(
        [
          {
            player: 0,
            result: 'skip',
            dropped: true,
            reason: 'not_enough_gold',
          },
        ],
        0,
        content,
      ),
    ).toBe('Your upgrade could not be paid for and was skipped.');
    expect(
      appliedNotice([{ player: 1, result: 'skip' }], 0, content),
    ).toBeNull();
  });

  test('a Shrine asks which modifier and spells out the effects', () => {
    const s = pickEvent('shrine');
    expect(s).not.toBeNull();
    const v = followUpView(s as RunState, config, content, 0, realDeps());
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
    const v = followUpView(odd, config, content, 0, realDeps());
    expect(v?.prompt).toBe('Make a choice');
    expect(v?.options).toEqual([
      {
        id: 'all_in',
        title: 'all_in',
        lines: [],
        affordable: true,
        disabledReason: null,
        skip: false,
        building: null,
      },
    ]);
  });

  test('no follow-up outside event_resolve', () => {
    expect(followUpView(newRun(), config, content, 0, realDeps())).toBeNull();
  });
});
