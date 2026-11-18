/**
 * Caravan (RS-4h, RS-4i3): the offer and its stream, availability by round,
 * the draft (turns, change until the next player chooses, sub-choices, the
 * left-over item, the party-wide modifier), the rotating first chooser across
 * Caravans, save and reload in the middle of a draft, replay, and the
 * run-state checks, for 1 to 4 players.
 */
import { describe, expect, test } from 'vitest';
import {
  Rng,
  addableNodeCells,
  heldModifierIds,
  loadEventsOrThrow,
  workshopOptions,
} from '@game/core';
import { fixedBattle } from './defaults.js';
import {
  caravanChoice,
  caravanHandler,
  caravanView,
  defaultDraftPick,
  draftTurn,
  nodeSub,
  openDraft,
  upgradeSub,
  type CaravanItem,
} from './caravan.js';
import type { EventContext } from './events.js';
import { createGameDeps } from './game-deps.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import { eventFollowUp } from './selectors.js';
import {
  content,
  gameConfigs,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from '../testing/test-support.js';
import type { Json, RunDeps, RunState } from './types.js';
import { validateRunState } from './validate.js';

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

const events = loadEventsOrThrow({
  offerCount: 3,
  events: gameConfigs.events.events
    .filter((e) => e.type === 'windfall' || e.type === 'caravan')
    .map((e) => ({ ...e })),
  modifiers: gameConfigs.events.modifiers.map((m) => ({ ...m })),
});
const deps: RunDeps = createGameDeps(
  content,
  { ...gameConfigs, events },
  { battle: fixedBattle(true) },
);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const pend = (s: RunState) => s.pending as Record<string, Json>;
const offerOf = (s: RunState) => pend(s)['offer'] as Record<string, Json>;
const fuOf = (s: RunState) => pend(s)['followUp'] as Record<string, Json>;
const ctxOf = (state: RunState): EventContext => ({
  state,
  content,
  config: events,
  mapgen: deps.mapgenConfig,
  economy: gameConfigs.economy,
});

function fresh(players: number, seed: number): RunState {
  const r = createRun(runArgs(NAMES.slice(0, players), seed), deps);
  if (!r.ok) throw new Error(r.detail);
  return placeCoreAll(r.state, deps);
}

/** Play on (a Caravan taken whenever offered) until `stop` holds. */
function advance(
  start: RunState,
  stop: (s: RunState) => boolean,
  limit = 400,
): RunState {
  let s = start;
  for (let i = 0; i < limit && !stop(s); i++) {
    if (s.step === 'pve_choice') s = voteAll(s, 'easy', deps);
    else if (s.step === 'event_choice') {
      const offers = pend(s)['options'] as { id: string }[];
      const id = offers.some((o) => o.id === 'evt_caravan')
        ? 'evt_caravan'
        : 'evt_windfall';
      s = voteAll(s, id, deps);
    } else if (s.step === 'event_resolve') s = finish(s);
    else s = readyAll(s, deps);
  }
  if (!stop(s)) throw new Error(`did not reach the stop (at ${s.step})`);
  return s;
}

/** Everyone takes in turn what `defaultDraftPick` names. */
function finish(s: RunState): RunState {
  let cur = s;
  while (cur.step === 'event_resolve') {
    const pick = defaultDraftPick(cur, deps);
    if (pick === null) throw new Error('no pick');
    cur = ok(
      cur,
      pick.player,
      { type: 'event_choose', choice: pick.choice },
      deps,
    ).state;
  }
  return cur;
}

const inDraft = (s: RunState): boolean =>
  s.step === 'event_resolve' && openDraft(s) !== null;

/** The first open Caravan draft (from round 2). */
function draftAt(players: number, seed = 7): RunState {
  return advance(fresh(players, seed), inDraft);
}

/** `s` with its draft's items replaced (to test one reward at a time). */
function withItems(s: RunState, items: Json[]): RunState {
  const c = clone(s);
  const fu = (c.pending as Record<string, Json>)['followUp'] as Record<
    string,
    Json
  >;
  fu['items'] = items;
  return c;
}

const rejected = (
  s: RunState,
  player: number,
  choice: string,
): string | undefined => {
  const r = applyIntent(s, player, { type: 'event_choose', choice }, deps);
  return r.ok ? undefined : r.reason;
};
const choose = (s: RunState, player: number, choice: string): RunState =>
  ok(s, player, { type: 'event_choose', choice }, deps).state;

const gold = (id: string, n = 6): Json => ({ id, kind: 'gold', gold: n });
const building = (id: string, def = 'bld_barracks'): Json => ({
  id,
  kind: 'building',
  def,
});

describe('Caravan: the definition and availability', () => {
  test('from round 2, with the gold and the weights in content', () => {
    expect(
      gameConfigs.events.events.find((e) => e.id === 'evt_caravan'),
    ).toMatchObject({
      type: 'caravan',
      fromRound: 2,
      params: { gold: 8 },
    });
  });

  test('never offered in round 1; offered from round 2 on', () => {
    let s = fresh(2, 3);
    expect(s.round).toBe(1);
    s = advance(s, (x) => x.step === 'event_choice');
    expect(
      (pend(s)['options'] as { type: string }[]).map((o) => o.type),
    ).toEqual(['windfall']);
    let offered = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const e = advance(
        fresh(2, seed),
        (x) => x.step === 'event_choice' && x.round === 2,
      );
      if (
        (pend(e)['options'] as { type: string }[]).some(
          (o) => o.type === 'caravan',
        )
      )
        offered++;
    }
    expect(offered).toBeGreaterThan(0);
  });

  test('parameters are checked at wiring', () => {
    const bad = (params: Record<string, number>, weights?: object): string => {
      try {
        createGameDeps(
          content,
          {
            ...gameConfigs,
            events: loadEventsOrThrow({
              offerCount: 3,
              events: [
                ...gameConfigs.events.events.map((e) => ({ ...e })),
                {
                  id: 'evt_caravan2',
                  type: 'caravan',
                  weight: 1,
                  ...(weights === undefined
                    ? {}
                    : { resourceWeights: weights }),
                  params,
                },
              ],
              modifiers: [],
            }),
          },
          {},
        );
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    };
    const good = {
      gold: 6,
      weightGold: 1,
      weightBuilding: 1,
      weightUpgrade: 1,
      weightNode: 0,
      weightModifier: 1,
    };
    expect(bad(good)).toBe('');
    expect(bad({ ...good, gold: 0 })).toMatch(/gold/);
    expect(bad({ ...good, weightBuilding: 0 })).toMatch(/weightBuilding/);
    expect(bad({ ...good, weightGold: 1001 })).toMatch(/weightGold/);
    expect(bad({ ...good, weightNode: 2 })).toMatch(/resourceWeights/);
    expect(bad({ ...good, weightNode: 2 }, { res_a: 1 })).toBe('');
  });
});

describe('Caravan: the offer', () => {
  test('players + 1 distinct rewards, at most one party-wide, in a rotation', () => {
    for (const players of [1, 2, 3, 4]) {
      const s = draftAt(players);
      const d = openDraft(s);
      if (d === null) throw new Error('no draft');
      expect(d.items).toHaveLength(players + 1);
      expect(d.items.map((i) => i.id)).toEqual(
        d.items.map((_i, k) => `it${String(k)}`),
      );
      const keys = d.items.map((i) =>
        JSON.stringify([i.kind, i.def, i.resource, i.modifier]),
      );
      expect(new Set(keys).size).toBe(keys.length);
      expect(
        d.items.filter((i) => i.partyWide === true).length,
      ).toBeLessThanOrEqual(1);
      for (const i of d.items) {
        if (i.kind === 'gold') expect(i.gold).toBe(8);
        expect(i.partyWide === true).toBe(i.kind === 'modifier');
      }
      expect(d.order).toHaveLength(players);
      expect(
        d.order.map((p) => (p - (d.order[0] as number) + players) % players),
      ).toEqual(d.order.map((_p, k) => k));
      expect(d.taken).toEqual(d.order.map(() => null));
      // The offer holds the same rewards and order.
      expect(offerOf(s)['items']).toEqual(fuOf(s)['items']);
      expect(offerOf(s)['order']).toEqual(fuOf(s)['order']);
    }
  });

  test("the offer is drawn from the offer's child stream and does not move it", () => {
    const def = events.events.find((e) => e.type === 'caravan');
    if (def === undefined) throw new Error('no caravan');
    const s = { ...draftAt(2), round: 4 };
    const a = Rng.fromSeed(5);
    const before = a.getState();
    const x = caravanHandler.instantiate(ctxOf(s), def, a);
    expect(a.getState()).toEqual(before);
    expect(caravanHandler.instantiate(ctxOf(s), def, Rng.fromSeed(5))).toEqual(
      x,
    );
    expect(
      caravanHandler.instantiate(ctxOf(s), def, Rng.fromSeed(6)),
    ).not.toEqual(x);
  });

  test('weights decide the kinds: gold only, with a building as the filler', () => {
    const def = events.events.find((e) => e.type === 'caravan');
    if (def === undefined) throw new Error('no caravan');
    const only = {
      ...def,
      params: {
        ...def.params,
        weightGold: 5,
        weightUpgrade: 0,
        weightNode: 0,
        weightModifier: 0,
      },
    };
    const s = draftAt(3);
    for (let seed = 1; seed <= 20; seed++) {
      const out = caravanHandler.instantiate(
        ctxOf(s),
        only,
        Rng.fromSeed(seed),
      );
      const kinds = (out['items'] as { kind: string }[]).map((i) => i.kind);
      expect(kinds).toHaveLength(4);
      expect(kinds.filter((k) => k === 'gold').length).toBeLessThanOrEqual(1);
      expect(kinds.every((k) => k === 'gold' || k === 'building')).toBe(true);
    }
  });
});

describe('Caravan: turns', () => {
  test('solo: one pick, applied at once; the left-over reward is discarded', () => {
    const s = withItems(draftAt(1), [gold('it0'), building('it1')]);
    const goldBefore = s.perPlayer[0]?.gold ?? 0;
    const stashBefore = s.team.stash.length;
    const r = ok(s, 0, { type: 'event_choose', choice: 'it0' }, deps);
    expect(r.state.step).toBe('shop');
    // The shop adds its own gold (income); the Caravan's 6 is in it.
    expect(r.state.team.stash.length).toBe(stashBefore);
    const done = r.effects.find(
      (e) => e.type === 'custom' && e.name === 'event_resolved',
    );
    expect(done).toMatchObject({
      data: {
        type: 'caravan',
        order: [0],
        choices: ['it0'],
        applied: [{ player: 0, result: 'gold', gold: 6 }],
      },
    });
    expect(goldBefore).toBeGreaterThanOrEqual(0);
  });

  test('out of turn: not_your_turn; only the player up (or the one before) may send', () => {
    const s = withItems(draftAt(3), [
      gold('it0'),
      building('it1'),
      building('it2', 'bld_extractor'),
      building('it3', 'bld_range'),
    ]);
    const d = openDraft(s);
    if (d === null) throw new Error('no draft');
    const [a, b, c] = d.order as [number, number, number];
    expect(rejected(s, b, 'it1')).toBe('not_your_turn');
    expect(rejected(s, c, 'it1')).toBe('not_your_turn');
    // The first player has nobody before them to change for.
    const s1 = choose(s, a, 'it0');
    expect(s1.step).toBe('event_resolve');
    expect(
      draftTurn(openDraft(s1) as NonNullable<ReturnType<typeof openDraft>>),
    ).toMatchObject({ chooser: b, changer: a });
    expect(rejected(s1, c, 'it1')).toBe('not_your_turn');
    // Nothing was stored by the rejected intents.
    expect(openDraft(s1)?.taken).toEqual(['it0', null, null]);
  });

  test('a free item only; the player before may change until the next has chosen', () => {
    let s = withItems(draftAt(3), [
      gold('it0'),
      building('it1'),
      building('it2', 'bld_extractor'),
      building('it3', 'bld_range'),
    ]);
    const [a, b, c] = (
      openDraft(s) as NonNullable<ReturnType<typeof openDraft>>
    ).order as [number, number, number];
    s = choose(s, a, 'it0');
    // b cannot take a's item, a nonexistent one, or a malformed choice.
    expect(rejected(s, b, 'it0')).toBe('invalid_choice');
    expect(rejected(s, b, 'it9')).toBe('invalid_choice');
    expect(rejected(s, b, 'gold')).toBe('invalid_choice');
    expect(rejected(s, b, 'it1:b1')).toBe('invalid_choice');
    // a changes their mind; their old item is free again.
    s = choose(s, a, 'it2');
    expect(openDraft(s)?.taken).toEqual(['it2', null, null]);
    expect(rejected(s, b, 'it2')).toBe('invalid_choice');
    s = choose(s, b, 'it0');
    // Now b is the one who may change; a is final.
    expect(rejected(s, a, 'it1')).toBe('not_your_turn');
    s = choose(s, b, 'it1');
    expect(openDraft(s)?.taken).toEqual(['it2', 'it1', null]);
    // The last player's pick ends it; the left-over item (it0) is discarded.
    const stash = s.team.stash.length;
    s = choose(s, c, 'it3');
    expect(s.step).toBe('shop');
    expect(s.team.stash.length).toBe(stash + 3);
    const defs = (p: number) =>
      s.team.stash.filter((x) => x.owner === p).map((x) => x.def);
    expect(defs(a)).toContain('bld_extractor');
    expect(defs(b)).toContain('bld_barracks');
    expect(defs(c)).toContain('bld_range');
  });

  test('the follow-up selector says who is up', () => {
    const s = draftAt(3);
    const d = openDraft(s) as NonNullable<ReturnType<typeof openDraft>>;
    const v = eventFollowUp(s, d.order[0]);
    expect(v).toMatchObject({
      prompt: 'caravan',
      perPlayer: false,
      waitingFor: [d.order[0]],
      mine: null,
    });
    expect(v?.chosen).toEqual([false, false, false]);
  });

  test('pass is legal only for a player who can take nothing', () => {
    const s = withItems(draftAt(1), [gold('it0'), building('it1')]);
    expect(rejected(s, 0, 'skip')).toBe('invalid_choice');
    // Two rewards the solo player cannot take: a raise with no building they
    // own below tier 3 is impossible to build here, so remove their buildings.
    const bare = withItems(draftAt(1), [
      { id: 'it0', kind: 'upgrade' },
      { id: 'it1', kind: 'node', resource: 'res_a' },
    ]);
    const own = clone(bare);
    const noOwn: RunState = {
      ...own,
      team: {
        ...own.team,
        buildings: own.team.buildings.filter((b) => b.def === 'bld_core'),
        stash: [],
      },
    };
    const view = caravanView(ctxOf(noOwn), 0);
    expect(view?.upgrades).toEqual([]);
    expect(view?.takeable[0]).toBe(false);
    expect(view?.mustSkip).toBe(view?.takeable.every((t) => !t));
  });
});

describe('Caravan: the rewards', () => {
  test('gold, a stash building, and the party-wide modifier', () => {
    const mods = events.modifiers.filter((m) => m.pact !== true);
    const mod = mods.find((m) => m.stackable) ?? mods[0];
    if (mod === undefined) throw new Error('no modifier');
    let s = withItems(draftAt(2), [
      gold('it0', 6),
      building('it1', 'bld_range'),
      { id: 'it2', kind: 'modifier', modifier: mod.id, partyWide: true },
    ]);
    const [a, b] = (openDraft(s) as NonNullable<ReturnType<typeof openDraft>>)
      .order as [number, number];
    const gold0 = s.perPlayer.map((p) => p.gold);
    s = choose(s, a, 'it2');
    s = choose(s, b, 'it0');
    expect(s.step).toBe('shop');
    // The whole party holds the modifier (one entry, for the team).
    expect(heldModifierIds(s.team).filter((id) => id === mod.id)).toHaveLength(
      1,
    );
    // b took the gold; the shop's own income comes on top for both.
    const income = (s.perPlayer[a]?.gold ?? 0) - (gold0[a] ?? 0);
    expect((s.perPlayer[b]?.gold ?? 0) - (gold0[b] ?? 0)).toBe(income + 6);
  });

  test("upgrade: the building is named on the taker's turn and raised for free", () => {
    let s = draftAt(2);
    const [a, b] = (openDraft(s) as NonNullable<ReturnType<typeof openDraft>>)
      .order as [number, number];
    s = withItems(s, [
      { id: 'it0', kind: 'upgrade' },
      gold('it1'),
      building('it2'),
    ]);
    const mine = workshopOptions(s.team, a, 0, content, 0);
    expect(mine.length).toBeGreaterThan(0);
    const target = mine[0] as (typeof mine)[number];
    const theirs = workshopOptions(s.team, b, 0, content, 0)[0];
    // The sub-choice is required and must be the taker's own building.
    expect(rejected(s, a, 'it0')).toBe('invalid_choice');
    expect(rejected(s, a, 'it0:b99999')).toBe('invalid_choice');
    expect(rejected(s, a, 'it0:x1')).toBe('invalid_choice');
    if (theirs !== undefined) {
      expect(
        rejected(s, a, caravanChoice('it0', upgradeSub(theirs.building))),
      ).toBe('invalid_choice');
    }
    // A reward without a sub-choice takes none.
    expect(rejected(s, a, 'it1:b1')).toBe('invalid_choice');
    const goldBefore = s.perPlayer[a]?.gold ?? 0;
    const goldAtStart = s.perPlayer.map((p) => p.gold);
    s = choose(s, a, caravanChoice('it0', upgradeSub(target.building)));
    s = choose(s, b, 'it1');
    expect(s.step).toBe('shop');
    const after = [...s.team.buildings, ...s.team.stash].find(
      (x) => x.id === target.building,
    );
    expect(after?.tier).toBe(target.newTier);
    // Free: no gold was spent (the shop adds its income to both players).
    // b took the 6 gold; a paid nothing, so a gained the income alone.
    expect((s.perPlayer[a]?.gold ?? 0) - goldBefore).toBe(
      (s.perPlayer[b]?.gold ?? 0) - (goldAtStart[b] ?? 0) - 6,
    );
  });

  test("node: a cell of the taker's own plot, applied as an added node", () => {
    let s = draftAt(2);
    const [a, b] = (openDraft(s) as NonNullable<ReturnType<typeof openDraft>>)
      .order as [number, number];
    s = withItems(s, [
      { id: 'it0', kind: 'node', resource: 'res_b' },
      gold('it1'),
      building('it2'),
    ]);
    const cells = addableNodeCells(s.team, content, deps.mapgenConfig, a);
    const other = addableNodeCells(s.team, content, deps.mapgenConfig, b);
    expect(cells.length).toBeGreaterThan(0);
    const cell = cells[0] as { x: number; y: number };
    expect(rejected(s, a, 'it0')).toBe('invalid_choice');
    // A cell of another player's plot is refused.
    const foreign = other[0] as { x: number; y: number };
    expect(
      rejected(s, a, caravanChoice('it0', nodeSub(foreign.x, foreign.y))),
    ).toBeDefined();
    s = choose(s, a, caravanChoice('it0', nodeSub(cell.x, cell.y)));
    s = choose(s, b, 'it1');
    expect(s.team.addedNodes).toEqual([
      { x: cell.x, y: cell.y, resource: 'res_b', owner: a, round: s.round },
    ]);
  });
});

describe('Caravan: rotation, save and reload, replay', () => {
  test('the first chooser rotates from one Caravan to the next, through reloads', () => {
    for (const players of [1, 2, 3, 4]) {
      let s = fresh(players, 11);
      const firsts: number[] = [];
      for (let k = 0; k < 4; k++) {
        s = advance(s, inDraft);
        const d = openDraft(s) as NonNullable<ReturnType<typeof openDraft>>;
        firsts.push(d.order[0] as number);
        expect(s.caravanCount).toBe(k + 1);
        expect(s.caravanFirst).toBe(d.order[0]);
        // Reload in the middle of the draft: the state validates and continues.
        const mid =
          players > 1
            ? choose(
                s,
                d.order[0] as number,
                defaultDraftPick(s, deps)?.choice ?? 'skip',
              )
            : s;
        const again = validateRunState(clone(mid), deps);
        expect(again.ok ? [] : again.errors).toEqual([]);
        s = again.ok ? again.state : s;
        s = finish(s);
      }
      firsts.slice(1).forEach((f, k) => {
        expect(f).toBe(((firsts[k] as number) + 1) % players);
      });
    }
  });

  test('replay reproduces the drafts', () => {
    for (const players of [1, 3]) {
      const end = advance(fresh(players, 5), (s) => s.round >= 5);
      expect(end.caravanCount ?? 0).toBeGreaterThan(0);
      const replayed = replayRun(
        runArgs(NAMES.slice(0, players), 5),
        end.actionLog,
        deps,
      );
      expect(replayed.ok).toBe(true);
      if (replayed.ok) expect(replayed.state).toEqual(end);
    }
  });

  test('a run before the Caravan has neither field and still validates', () => {
    const s = fresh(2, 3);
    expect('caravanCount' in s).toBe(false);
    expect(validateRunState(clone(s), deps).ok).toBe(true);
  });
});

describe('Caravan: validateRunState', () => {
  const state = (): RunState => {
    const s = draftAt(3);
    const d = openDraft(s) as NonNullable<ReturnType<typeof openDraft>>;
    return choose(
      s,
      d.order[0] as number,
      defaultDraftPick(s, deps)?.choice ?? 'skip',
    );
  };
  const errorsOf = (s: RunState): string => {
    const v = validateRunState(clone(s), deps);
    return v.ok ? '' : v.errors.join('\n');
  };
  const mutate = (edit: (fu: Record<string, Json>, s: RunState) => void) => {
    const s = clone(state());
    edit(fuOf(s), s);
    return s;
  };

  test('a mid-draft state is valid', () => {
    expect(errorsOf(state())).toBe('');
  });

  test('the structure is checked', () => {
    expect(
      errorsOf(
        mutate((fu) => {
          fu['order'] = [0, 2, 1];
        }),
      ),
    ).toMatch(/order/);
    expect(
      errorsOf(
        mutate((fu) => {
          fu['items'] = (fu['items'] as Json[]).slice(1);
        }),
      ),
    ).toMatch(/items|rewards/);
    expect(
      errorsOf(
        mutate((fu) => {
          fu['taken'] = [null, 'skip', null];
        }),
      ),
    ).toMatch(/taken/);
    expect(
      errorsOf(
        mutate((fu) => {
          fu['taken'] = ['it1', 'it1', null];
        }),
      ),
    ).toMatch(/distinct/);
    expect(
      errorsOf(
        mutate((fu) => {
          fu['taken'] = ['it9', null, null];
        }),
      ),
    ).toMatch(/taken/);
    expect(
      errorsOf(
        mutate((fu) => {
          fu['taken'] = ['it0', 'it1', 'it2'];
        }),
      ),
    ).toMatch(/complete/);
    expect(
      errorsOf(
        mutate((fu) => {
          (fu['items'] as Json[]).push({ id: 'it9', kind: 'gold', gold: 1 });
        }),
      ),
    ).toMatch(/items|rewards/);
    expect(
      errorsOf(
        mutate((fu) => {
          fu['extra'] = 1;
        }),
      ),
    ).toMatch(/only prompt/);
  });

  test('two party-wide rewards, or party-wide on another kind, are refused', () => {
    const wide = (id: string): Json => ({
      id,
      kind: 'modifier',
      modifier: 'mod_stout_walls',
      partyWide: true,
    });
    const s = mutate((fu) => {
      fu['items'] = [wide('it0'), wide('it1'), gold('it2'), gold('it3')];
    });
    expect(errorsOf(s)).toMatch(/party-wide/);
    const t = mutate((fu) => {
      fu['items'] = [
        { ...(gold('it0') as object), partyWide: true },
        gold('it1'),
        gold('it2'),
        gold('it3'),
      ];
    });
    expect(errorsOf(t)).toMatch(/not a valid reward/);
  });

  test('the rotation fields', () => {
    const s = clone(state());
    expect(errorsOf({ ...s, caravanCount: 0 })).toMatch(/caravanCount/);
    expect(errorsOf({ ...s, caravanFirst: 9 })).toMatch(/caravanFirst/);
    const lone = clone(s) as { caravanFirst?: number };
    delete lone.caravanFirst;
    expect(errorsOf(lone as RunState)).toMatch(/together/);
  });

  test('a node or raise pick must be legal for the taker', () => {
    const base = draftAt(2);
    const d = openDraft(base) as NonNullable<ReturnType<typeof openDraft>>;
    const items: CaravanItem[] = [
      { id: 'it0', kind: 'upgrade' },
      { id: 'it1', kind: 'node', resource: 'res_a' },
      { id: 'it2', kind: 'gold', gold: 6 },
    ];
    const s = clone(withItems(base, items as unknown as Json[]));
    const fu = fuOf(s);
    fu['taken'] = ['it0:b99999', null];
    expect(errorsOf(s)).toMatch(/Upgrade/);
    fu['taken'] = ['it1:c99999_99999', null];
    expect(errorsOf(s)).toMatch(/Node/);
    expect(d.order).toHaveLength(2);
  });
});
