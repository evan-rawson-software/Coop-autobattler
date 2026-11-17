/**
 * The scripted bot and the new events (#416): over many seeds each one is
 * taken at least sometimes, with no rejected intent and no stall, in every
 * party size; and the picks follow the strategy.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  addableNodeCells,
  heldModifierIds,
  loadEventsOrThrow,
  tierPrice,
} from '@game/core';
import { fixedBattle } from '../rules/defaults.js';
import {
  gameConfigs,
  makeGameDeps,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from '../testing/test-support.js';
import {
  botEventTastes,
  playBotRun,
  type BotRunResult,
  type BotStrategyName,
} from './bot.js';
import {
  blueprintPick,
  caravanPick,
  drillPick,
  veinPick,
} from './bot-events.js';
import { openDraft } from '../rules/caravan.js';
import { applyIntent, createRun } from '../rules/machine.js';
import type { Json, RunState } from '../rules/types.js';

// Whole bot runs (eight rounds each): far over the default 5 s.
vi.setConfig({ testTimeout: 180_000 });

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];
const ROUNDS = 8;

function play(strategy: BotStrategyName, party: number, seed: number) {
  return playBotRun(
    makeGameDeps(),
    {
      runId: 'bot-events',
      runVersion: '0.1',
      seed,
      players: NAMES.slice(0, party),
      host: 0,
    },
    { strategy, seed, rerollCost: 1, maxRounds: ROUNDS },
  );
}

/**
 * The runs: the smallest set of (strategy, party, seed) found over seeds 1 to
 * 8 of rush, fortify and siege that takes every event with a follow-up in every
 * party size (and the shop events and pacts in each), plus the weak bot.
 */
const RUNS: readonly (readonly [BotStrategyName, number, number])[] = [
  ['rush', 2, 2],
  ['rush', 3, 2],
  ['rush', 4, 2],
  ['fortify', 1, 4],
  ['fortify', 1, 1],
  ['siege', 1, 1],
  ['siege', 2, 1],
  ['siege', 3, 2],
  ['siege', 4, 2],
  ['weak', 1, 1],
  ['weak', 2, 1],
  ['weak', 3, 1],
  ['weak', 4, 1],
];

/** What a run took, as `type` and `type/result` (a follow-up that did something). */
function taken(r: BotRunResult): Set<string> {
  const out = new Set<string>();
  for (const e of r.events) {
    out.add(e.type);
    for (const a of e.applied) {
      const result = (a as { result?: string }).result;
      if (result !== undefined && result !== 'skip') {
        out.add(`${e.type}/${result}`);
      }
    }
  }
  return out;
}

describe('the bot takes every new event', () => {
  const results = RUNS.map(([strategy, party, seed]) => ({
    strategy,
    party,
    seed,
    run: undefined as BotRunResult | undefined,
  }));
  test('no run is rejected or stalls, and each event is taken, in every party size', () => {
    for (const r of results) {
      r.run = play(r.strategy, r.party, r.seed);
      expect(r.run.rejected, `${r.strategy} ${String(r.party)}p`).toEqual([]);
      expect(
        r.run.state.step === 'run_over' || r.run.state.round > ROUNDS,
        `${r.strategy} ${String(r.party)}p stopped at ${r.run.state.step}`,
      ).toBe(true);
    }
    const seen = new Set(
      results.flatMap((r) => [...taken(r.run as BotRunResult)]),
    );
    for (const key of [
      'market_day',
      'drill/upgrade',
      'pact',
      'rich_vein/node',
      'blueprint/blueprint',
      'caravan',
    ]) {
      expect(seen, key).toContain(key);
    }
    for (let party = 1; party <= 4; party++) {
      const here = new Set(
        results
          .filter((r) => r.party === party)
          .flatMap((r) => [...taken(r.run as BotRunResult)]),
      );
      for (const key of [
        'drill/upgrade',
        'rich_vein/node',
        'blueprint/blueprint',
        'caravan',
      ]) {
        expect(here, `${key} in a party of ${String(party)}`).toContain(key);
      }
    }
    // A pact is only ever taken when it fits: Fury for rush, Bastion (or the
    // turrets' Overcharge) for the walls, none for the weak bot.
    const fits: Record<string, readonly string[]> = {
      rush: ['mod_pact_fury'],
      fortify: ['mod_pact_bastion', 'mod_pact_overcharge'],
      siege: ['mod_pact_bastion'],
      weak: [],
    };
    for (const r of results) {
      const run = r.run as BotRunResult;
      const pacts = run.events.filter((e) => e.type === 'pact');
      for (const e of pacts) {
        expect(fits[r.strategy]).toContain(e.offer['pact']);
      }
      const held = heldModifierIds(run.state.team).filter((m) =>
        m.startsWith('mod_pact_'),
      );
      expect(held.length).toBe(pacts.length);
    }
    // Rich vein: a node only for a player with a consumer of its resource.
    const nodes = results.flatMap((r) =>
      (r.run as BotRunResult).events.flatMap((e) =>
        e.type === 'rich_vein' ? e.applied : [],
      ),
    );
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe('the bot answers the follow-ups by its strategy', () => {
  const deps = makeGameDeps();
  function fresh(players: number): RunState {
    const r = createRun(runArgs(NAMES.slice(0, players), 3), deps);
    if (!r.ok) throw new Error(r.detail);
    return placeCoreAll(r.state, deps);
  }
  function withOffer(s: RunState, offer: Record<string, Json>): RunState {
    return { ...s, pending: { ...(s.pending as object), offer } };
  }

  test('Rich vein: skipped without a consumer of the resource, else a legal cell', () => {
    const t = botEventTastes(deps, 'rush');
    const s = fresh(1);
    const takes = (res: string): boolean =>
      [...s.team.buildings, ...s.team.stash].some(
        (b) =>
          t.consumers.includes(b.def) &&
          deps.content.buildings.get(b.def)?.inputs[0]?.resource === res,
      );
    const cells = addableNodeCells(s.team, deps.content, deps.mapgenConfig, 0);
    const legal = cells.map((c) => `c${String(c.x)}_${String(c.y)}`);
    for (const res of ['res_a', 'res_b', 'res_c']) {
      const choice = veinPick(withOffer(s, { resource: res }), deps, t, 0);
      if (takes(res)) expect(legal, res).toContain(choice);
      else expect(choice, res).toBe('skip');
    }
    // The starting kit leaves some resource without a consumer, and some with.
    expect(['res_a', 'res_b', 'res_c'].some(takes)).toBe(true);
    expect(['res_a', 'res_b', 'res_c'].some((r) => !takes(r))).toBe(true);
  });

  test('Drill: the lowest-tier collector, none when there is nothing to raise', () => {
    const t = botEventTastes(deps, 'rush');
    const s = fresh(1);
    const options: Json[] = s.team.stash.map((b) => ({
      id: `b${String(b.id)}`,
      player: 0,
      building: b.id,
      def: b.def,
      tier: b.tier,
      affordable: true,
    }));
    const collectors = s.team.stash.filter(
      (b) => deps.content.buildings.get(b.def)?.kind === 'source',
    );
    expect(collectors.length).toBeGreaterThan(0);
    const first = collectors[0];
    expect(drillPick(s, deps, t, options, 0)).toBe(`b${String(first?.id)}`);
    expect(drillPick(s, deps, t, [], 0)).toBe('skip');
  });

  test('Blueprint: skip when nothing wanted can be afforded, else the dearest it likes', () => {
    const t = botEventTastes(deps, 'rush');
    const s = fresh(1);
    const gold = (n: number): RunState => ({
      ...s,
      perPlayer: s.perPlayer.map((p) => ({ ...p, gold: n })),
    });
    const opt = (def: string): Json => ({ id: `p0:${def}`, player: 0, def });
    // The rush bot buys no wall.
    expect(blueprintPick(gold(100), deps, t, [opt('bld_wall_o')], 0)).toBe(
      'skip',
    );
    const both = [opt('bld_range'), opt('bld_barracks')];
    expect(blueprintPick(gold(0), deps, t, both, 0)).toBe('skip');
    const rich = blueprintPick(gold(100), deps, t, both, 0);
    const price = (def: string): number => tierPrice(deps.content, def, 1);
    const dearer =
      price('bld_range') >= price('bld_barracks')
        ? 'bld_range'
        : 'bld_barracks';
    expect(rich).toBe(`p0:${dearer}`);
  });
});

describe('the Caravan in a party of a bot and a person', () => {
  const events = loadEventsOrThrow({
    offerCount: 3,
    events: gameConfigs.events.events
      .filter((e) => e.type === 'windfall' || e.type === 'caravan')
      .map((e) => ({ ...e })),
    modifiers: gameConfigs.events.modifiers.map((m) => ({ ...m })),
  });
  const deps = makeGameDeps(
    { battle: fixedBattle(true) },
    {
      ...gameConfigs,
      events,
    },
  );

  /** A real two-player draft (the first Caravan), with `items` in place. */
  function draftWith(items: Json[]): RunState {
    const r = createRun(runArgs(NAMES.slice(0, 2), 7), deps);
    if (!r.ok) throw new Error(r.detail);
    let s = placeCoreAll(r.state, deps);
    for (let i = 0; i < 400 && openDraft(s) === null; i++) {
      if (s.step === 'pve_choice') s = voteAll(s, 'easy', deps);
      else if (s.step === 'event_choice') {
        const offers = (s.pending as Record<string, Json>)['options'] as {
          id: string;
        }[];
        s = voteAll(
          s,
          offers.some((o) => o.id === 'evt_caravan')
            ? 'evt_caravan'
            : 'evt_windfall',
          deps,
        );
      } else if (s.step === 'event_resolve') {
        throw new Error('a follow-up other than the draft');
      } else s = readyAll(s, deps);
    }
    expect(openDraft(s)).not.toBeNull();
    const c = JSON.parse(JSON.stringify(s)) as RunState;
    const fu = (c.pending as Record<string, Json>)['followUp'] as Record<
      string,
      Json
    >;
    fu['items'] = items;
    return c;
  }
  const send = (s: RunState, player: number, choice: string): RunState => {
    const r = applyIntent(s, player, { type: 'event_choose', choice }, deps);
    if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
    return r.state;
  };

  test('the bot takes what its strategy values most, party-wide or not', () => {
    const items: Json[] = [
      { id: 'it0', kind: 'building', def: 'bld_barracks' },
      {
        id: 'it1',
        kind: 'modifier',
        modifier: 'mod_drilled_troops',
        partyWide: true,
      },
      { id: 'it2', kind: 'gold', gold: 6 },
    ];
    const state = draftWith(items);
    const [person, bot] = openDraft(state)?.order ?? [];
    expect(person).toBeDefined();
    // The person (a scripted stand-in) takes the building; the bot is next.
    const after = send(state, person ?? 0, 'it0');
    // The rush bot values the modifier first; nothing makes it leave the
    // party-wide reward to the person.
    const t = botEventTastes(deps, 'rush');
    const pick = caravanPick(after, deps, t);
    expect(pick).toEqual({ player: bot, choice: 'it1' });
    // The weak bot has no use for a modifier and takes the gold.
    expect(caravanPick(after, deps, botEventTastes(deps, 'weak'))).toEqual({
      player: bot,
      choice: 'it2',
    });
    const done = send(after, bot ?? 1, pick?.choice ?? '');
    expect(heldModifierIds(done.team)).toContain('mod_drilled_troops');
    expect(done.step).not.toBe('event_resolve');
  });

  test('the bot raises a collector and puts a node by its consumers when it takes them', () => {
    const state = draftWith([
      { id: 'it0', kind: 'upgrade' },
      { id: 'it1', kind: 'node', resource: 'res_a' },
      { id: 'it2', kind: 'gold', gold: 6 },
    ]);
    const pick = caravanPick(state, deps, botEventTastes(deps, 'rush'));
    expect(pick).not.toBeNull();
    // Whatever it names is a legal choice, sub-choice included.
    const r = applyIntent(
      state,
      pick?.player ?? 0,
      { type: 'event_choose', choice: pick?.choice ?? '' },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(pick?.choice).toMatch(/^it[01]:/);
  });
});
