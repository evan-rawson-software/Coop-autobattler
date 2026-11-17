/**
 * The family bonuses of the specialists (issue #471; CB-51a, CB-57, EC-8a,
 * EC-8b): each acts only on the buildings and units of the player who picked
 * the specialist, is summed with the Shrine effects of the same kind and
 * applied once, and uses the integer rounding rule of the spec.
 */
import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  createArenaSim,
  rampBonus,
  runArena,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import {
  createBoardSim,
  createFlowContext,
  scaledInterval,
  stepFlow,
  type SimEvent,
} from './flow-sim.js';
import { maxHealthOf } from './max-health.js';
import type { ArenaBuilding } from './arena.js';
import { specialistEffectsOf, specialistPercent } from './specialists.js';
import { setSpecialist, type TeamState } from './team-state.js';
import { tinyMap } from './testing/ramp-scenarios.js';
import { content, got, Lab, simConfig } from './testing/support.js';

const GAP = 4;
const FLOW = 'spec_flowmancer';
const WARD = 'spec_wardsmith';
const BEAST = 'spec_beastbinder';
const ALCH = 'spec_alchemist';

/** A 24 x 16 map of two plots with the given nodes. */
const twoPlots = (nodes: [number, number, string][] = []) => ({
  ...tinyMap(nodes),
  width: 24,
  partySize: 2,
});

function pick(state: TeamState, picks: (string | null)[]): TeamState {
  let s = state;
  picks.forEach((id, player) => {
    if (id === null) return;
    const r = setSpecialist(s, content, player, id);
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
  });
  return s;
}

/** The opposing side: Cores only, on a board of the same size. */
const foe = (): TeamState => {
  const lab = new Lab(twoPlots());
  lab.core(5, 6, 0);
  lab.core(17, 6, 1);
  return lab.state;
};

function ofType<T extends ArenaEvent['type']>(
  events: readonly ArenaEvent[],
  type: T,
): Extract<ArenaEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<ArenaEvent, { type: T }> => e.type === type,
  );
}

describe('the effect readers', () => {
  test('specialistEffectsOf: the owner only, nothing without a pick', () => {
    const team = { specialists: [WARD, null] };
    expect(specialistEffectsOf(team, content.specialists, 0)).toHaveLength(3);
    expect(specialistEffectsOf(team, content.specialists, 1)).toEqual([]);
    expect(specialistEffectsOf(team, content.specialists, 5)).toEqual([]);
    expect(specialistEffectsOf(team, content.specialists, -1)).toEqual([]);
    expect(specialistEffectsOf({}, content.specialists, 0)).toEqual([]);
    expect(specialistEffectsOf(team, undefined, 0)).toEqual([]);
    expect(
      specialistEffectsOf(
        { specialists: ['spec_nobody'] },
        content.specialists,
        0,
      ),
    ).toEqual([]);
  });

  test('specialistPercent matches the target of a health effect', () => {
    const effects = specialistEffectsOf(
      { specialists: [WARD] },
      content.specialists,
      0,
    );
    const pct = (t: string) =>
      specialistPercent(effects, 'building_health_percent', t);
    expect(pct('wall')).toBe(15);
    expect(pct('gate')).toBe(15);
    expect(pct('turret')).toBe(15);
    expect(pct('unit_producer')).toBe(0);
    expect(pct('source')).toBe(0);
    expect(specialistPercent(effects, 'unit_health_percent')).toBe(0);
  });
});

describe('Flowmancer: collectors of the owner produce faster (CB-51a)', () => {
  // Plot 0: tiers 1, 2 and 3 on ore at x = 0, 2, 4; plot 1 the same at 12, 14,
  // 16. Nothing is connected, so every item is lost at the source's cadence.
  function build(picks: (string | null)[]) {
    const lab = new Lab(
      twoPlots([0, 2, 4, 12, 14, 16].map((x) => [x, 0, 'res_a'])),
    );
    lab.core(5, 6, 0);
    lab.core(17, 6, 1);
    const ids = [0, 2, 4, 12, 14, 16].map((x, i) =>
      lab.put('bld_extractor', x, 0, 0, (i % 3) + 1),
    );
    return { state: pick(lab.state, picks), ids };
  }
  const ticksOf = (events: ArenaEvent[], side: number, building: number) =>
    ofType(events, 'produced')
      .filter((e) => e.side === side && e.building === building)
      .map((e) => e.tick);

  test('intervals 20, 14 and 10 become 18, 12 and 9 for the owner only', () => {
    const { state, ids } = build([FLOW, null]);
    const { sim, ctx, events } = startArenaBattle(
      state,
      foe(),
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 100);
    // The first countdown is the full interval; the bonus is read at a reset.
    expect(ticksOf(events, 0, got(ids[0])).slice(0, 4)).toEqual([
      19, 37, 55, 73,
    ]);
    expect(ticksOf(events, 0, got(ids[1])).slice(0, 4)).toEqual([
      13, 25, 37, 49,
    ]);
    expect(ticksOf(events, 0, got(ids[2])).slice(0, 4)).toEqual([
      9, 18, 27, 36,
    ]);
    // The neighbour's collectors (player 1, the same side) are untouched.
    expect(ticksOf(events, 0, got(ids[3])).slice(0, 3)).toEqual([19, 39, 59]);
    expect(ticksOf(events, 0, got(ids[4])).slice(0, 3)).toEqual([13, 27, 41]);
    expect(ticksOf(events, 0, got(ids[5])).slice(0, 3)).toEqual([9, 19, 29]);
  });

  test('the rule is max(1, floor(T * 100 / (100 + P)))', () => {
    expect([20, 14, 10].map((t) => scaledInterval(t, 10))).toEqual([18, 12, 9]);
    expect(scaledInterval(1, 10)).toBe(1);
  });

  test('the same board without a pick runs on the base cadence', () => {
    const { state, ids } = build([null, null]);
    const { sim, ctx, events } = startArenaBattle(
      state,
      foe(),
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 100);
    expect(ticksOf(events, 0, got(ids[0])).slice(0, 3)).toEqual([19, 39, 59]);
  });

  test('inside the Overclocker cap: ramp total plus bonus, at most 25', () => {
    const lab = new Lab(twoPlots());
    lab.core(5, 6, 0);
    lab.core(17, 6, 1);
    lab.put('bld_overclocker', 0, 1, 0, 3); // +5 per step, 5 steps
    lab.put('bld_overclocker', 12, 1, 0, 3);
    const state = pick(lab.state, [FLOW, FLOW]);
    const { sim, ctx } = startArenaBattle(
      state,
      foe(),
      GAP,
      content,
      simConfig,
    );
    // Before any step the bonus is the specialist's alone.
    expect(rampBonus(sim, ctx, 0, 'source_speed', 0)).toBe(10);
    expect(rampBonus(sim, ctx, 0, 'source_speed', 1)).toBe(10);
    const steps = [0, 1, 2, 3, 4, 5].map((n) => {
      for (const r of sim.ramps) if (r.building === 1) r.steps = n;
      return rampBonus(sim, ctx, 0, 'source_speed', 0);
    });
    // 10 + 5n, never above the cap of 25; player 1 does not gain from it.
    expect(steps).toEqual([10, 15, 20, 25, 25, 25]);
    expect(rampBonus(sim, ctx, 0, 'source_speed', 1)).toBe(10);
    // It does not touch the strength total.
    expect(rampBonus(sim, ctx, 0, 'unit_strength', 0)).toBe(0);
  });

  test('a player without the Flowmancer gets nothing from a partner who picked it', () => {
    const state = pick(new Lab(twoPlots()).state, [FLOW, null]);
    const { sim, ctx } = startArenaBattle(
      state,
      foe(),
      GAP,
      content,
      simConfig,
    );
    expect(rampBonus(sim, ctx, 0, 'source_speed', 0)).toBe(10);
    expect(rampBonus(sim, ctx, 0, 'source_speed', 1)).toBe(0);
    expect(rampBonus(sim, ctx, 1, 'source_speed', 0)).toBe(0);
  });
});

describe('Wardsmith: walls, gates and turrets of the owner have more health', () => {
  function build(picks: (string | null)[]) {
    const lab = new Lab(twoPlots());
    lab.core(5, 0, 0);
    lab.core(17, 0, 1);
    const ids: Record<string, number[]> = {};
    for (const [name, def, dx, dy, tier] of [
      ['wall', 'bld_wall_i', 0, 4, 1],
      ['block', 'bld_wall_block', 5, 4, 1],
      ['gate', 'bld_gate', 6, 4, 1],
      ['turret', 'bld_turret', 7, 4, 2],
      ['mortar', 'bld_mortar', 8, 4, 2],
      ['barracks', 'bld_barracks', 0, 8, 1],
    ] as const) {
      ids[name] = [0, 12].map((x0) => lab.put(def, x0 + dx, dy, 0, tier));
    }
    return { state: pick(lab.state, picks), ids };
  }
  const hp = (sim: ArenaSim, id: number) =>
    got(sim.health.find((h) => 'building' in h && h.building === id)).hp;

  test('only the owner, only the three families, rounded down', () => {
    const { state, ids } = build([WARD, null]);
    const sim = createArenaSim(state, foe(), GAP, content, simConfig);
    const at = (name: string, player: number) =>
      hp(sim, got(got(ids[name])[player]));
    // Base: wall 250, block 100, gate 80, turret tier 2, mortar tier 2.
    expect(at('wall', 0)).toBe(287); // floor(250 * 115 / 100) = 287.5
    expect(at('block', 0)).toBe(115);
    expect(at('gate', 0)).toBe(92);
    expect(at('turret', 0)).toBe(Math.floor((at('turret', 1) * 115) / 100));
    expect(at('mortar', 0)).toBe(Math.floor((at('mortar', 1) * 115) / 100));
    // The neighbour's and every other building of the owner: unchanged.
    expect(at('wall', 1)).toBe(250);
    expect(at('block', 1)).toBe(100);
    expect(at('gate', 1)).toBe(80);
    expect(at('barracks', 0)).toBe(at('barracks', 1));
    expect(hp(sim, got(ids['barracks']?.[0]))).toBe(60);
  });

  test('the Core is not boosted', () => {
    const { state } = build([WARD, WARD]);
    const sim = createArenaSim(state, foe(), GAP, content, simConfig);
    const cores = sim.health.filter((h) => 'core' in h);
    expect(cores.filter((h) => h.side === 0).map((h) => h.hp)).toEqual([
      500, 500,
    ]);
  });

  test('summed with the Shrine effects of the owner and applied once', () => {
    const { state, ids } = build([WARD, null]);
    const stout = {
      id: 'mod_stout_walls',
      effects: [
        { kind: 'building_health_percent', target: 'wall', percent: 25 },
      ],
    } as const;
    const frames = {
      id: 'mod_reinforced_frames',
      effects: [
        { kind: 'building_health_percent', target: 'all', percent: 10 },
      ],
    } as const;
    const sim = createArenaSim(
      { ...state, modifiers: [stout, frames] },
      foe(),
      GAP,
      content,
      simConfig,
    );
    const at = (name: string, player: number) =>
      hp(sim, got(got(ids[name])[player]));
    // Owner: 15 + 25 + 10 = 50 on a wall, applied once (not 1.15 * 1.35).
    expect(at('wall', 0)).toBe(375);
    expect(at('block', 0)).toBe(150);
    // A gate gets 15 + 10; the Barracks only the Shrine's 10.
    expect(at('gate', 0)).toBe(100);
    expect(at('barracks', 0)).toBe(66);
    // The partner has the party-wide Shrine effects and no specialist.
    expect(at('wall', 1)).toBe(337); // 250 * 135 / 100
    expect(at('gate', 1)).toBe(88);
    expect(at('barracks', 1)).toBe(66);
  });

  test('the sum floor of EC-8 applies to the summed percent', () => {
    const { state, ids } = build([WARD, null]);
    const pact = {
      id: 'mod_test_curse',
      effects: [
        { kind: 'building_health_percent', target: 'wall', percent: -90 },
      ],
    } as const;
    const sim = createArenaSim(
      { ...state, modifiers: [pact] },
      foe(),
      GAP,
      content,
      simConfig,
    );
    const w = (player: number) => hp(sim, got(got(ids['wall'])[player]));
    // -90 + 15 = -75, raised to -50: 125. The partner has -90 raised to -50.
    expect(w(0)).toBe(125);
    expect(w(1)).toBe(125);
  });

  test('maxHealthOf agrees (the Build preview and the simulation share it)', () => {
    const { state, ids } = build([WARD, null]);
    const b = (player: number): ArenaBuilding => ({
      ref: 0,
      side: 0,
      id: got(got(ids['wall'])[player]),
      player: -1,
      kind: 'defense',
      defenseType: 'wall',
      def: 'bld_wall_i',
      cells: [],
      alive: true,
    });
    expect(
      maxHealthOf(state, b(0), content, simConfig.minModifierSumPercent),
    ).toBe(287);
    expect(
      maxHealthOf(state, b(1), content, simConfig.minModifierSumPercent),
    ).toBe(250);
  });
});

describe('Beastbinder: units of the owner have more health (CB-51a)', () => {
  function build(picks: (string | null)[]) {
    const lab = new Lab(twoPlots([0, 12].map((x) => [x, 0, 'res_a'])));
    lab.core(5, 6, 0);
    lab.core(17, 6, 1);
    for (const x of [0, 12]) {
      const e = lab.put('bld_extractor', x, 0);
      const b = lab.put('bld_barracks', x, 1);
      lab.link(e, 'north', b, 'south');
    }
    return pick(lab.state, picks);
  }

  test('soldiers from the owner barracks have 44 health, the neighbour 40', () => {
    const { sim, ctx } = startArenaBattle(
      build([BEAST, null]),
      foe(),
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 150);
    const mine = sim.units.filter((u) => u.side === 0 && u.owner === 0);
    const theirs = sim.units.filter((u) => u.side === 0 && u.owner === 1);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    for (const u of mine)
      expect([u.hp, u.maxHp, u.damage]).toEqual([44, 44, 6]);
    for (const u of theirs)
      expect([u.hp, u.maxHp, u.damage]).toEqual([40, 40, 6]);
    // The other side (no specialist) is untouched.
    expect(sim.units.filter((u) => u.side === 1)).toEqual([]);
  });

  test('summed with the strength percent and applied once; damage unchanged', () => {
    const { sim, ctx } = startArenaBattle(
      build([BEAST, null]),
      foe(),
      GAP,
      content,
      simConfig,
    );
    const mk = (owner: number, x: number) =>
      spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_soldier',
        x,
        y: 10,
        owner,
      });
    const plain = mk(0, 1);
    expect([plain.hp, plain.damage]).toEqual([44, 6]);
    const other = mk(1, 14);
    expect([other.hp, other.damage]).toEqual([40, 6]);
    // The side's strength percent and the specialist's health percent add and
    // are applied once: 40 * (100 + 15 + 10) / 100 = 50 (applying them one
    // after the other would give floor(46 * 110 / 100) = 50 here too, so the
    // damage and the partner below pin the rule).
    sim.teams[0] = {
      ...sim.teams[0],
      modifiers: [
        {
          id: 'mod_test_strength',
          effects: [{ kind: 'unit_strength_percent', percent: 15 }],
        },
      ],
    };
    const both = mk(0, 3);
    expect(both.hp).toBe(50); // floor(40 * 125 / 100)
    expect(both.damage).toBe(6); // floor(6 * 115 / 100) = 6
    const strong = mk(1, 16);
    expect(strong.hp).toBe(46); // 40 * 115 / 100, no specialist
  });

  test('a unit with no owner (a scheduled wave) gets nothing', () => {
    const { sim, ctx } = startArenaBattle(
      build([BEAST, BEAST]),
      foe(),
      GAP,
      content,
      simConfig,
    );
    // The wave and burst spawn paths pass no ramp owner: the only other way
    // to a unit without an owner is a guard, which is not a Beastbinder's.
    const a = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 1,
      y: 10,
      owner: 1,
    });
    expect(a.hp).toBe(44);
    expect(ctx.specialist[1]).toBeDefined();
    // The foe side has no picks: its context has no bonus at all.
    expect(ctx.specialist[1]?.every((b) => b.unitHealth === 0)).toBe(true);
  });
});

describe('Alchemist: refineries and ramp buildings of the owner work faster (CB-57)', () => {
  test('the ramp step interval of the owner is shortened, the neighbour is not', () => {
    const lab = new Lab(twoPlots());
    lab.core(5, 6, 0);
    lab.core(17, 6, 1);
    lab.put('bld_overclocker', 0, 1);
    lab.put('bld_overclocker', 12, 1);
    lab.put('bld_armory', 2, 1);
    const state = pick(lab.state, [ALCH, null]);
    const { ctx } = startArenaBattle(state, foe(), GAP, content, simConfig);
    const intervals = [...ctx.ramps.values()].map((r) => [
      r.owner,
      r.stepInterval,
    ]);
    // Overclocker 40 -> floor(4000 / 115) = 34; Armory 80 -> 69; player 1's 40.
    expect(intervals).toEqual(
      expect.arrayContaining([
        [0, 34],
        [0, 69],
        [1, 40],
      ]),
    );
    expect(intervals).toHaveLength(3);
  });

  test('a step is taken at the shorter interval and the cap is unchanged', () => {
    const lab = new Lab(twoPlots([[10, 0, 'res_c']]));
    lab.core(5, 6, 0);
    lab.core(17, 6, 1);
    const flux = lab.put('bld_extractor', 10, 0, 0, 3);
    const o = lab.put('bld_overclocker', 10, 1);
    lab.link(flux, 'north', o, 'south');
    const run = (picks: (string | null)[]) => {
      const { sim, ctx, events } = startArenaBattle(
        pick(lab.state, picks),
        foe(),
        GAP,
        content,
        simConfig,
      );
      runArena(sim, ctx, 400);
      return {
        steps: ofType(events, 'ramp_step').map((e) => e.tick),
        last: got(sim.ramps[0]).steps,
      };
    };
    const base = run([null, null]);
    const fast = run([ALCH, null]);
    // Each step needs 2 items and the cooldown since the last step: the gaps
    // are at least 40 ticks (34 for the Alchemist), and it stops at 5 steps.
    for (let i = 1; i < base.steps.length; i++) {
      expect(
        (base.steps[i] as number) - (base.steps[i - 1] as number),
      ).toBeGreaterThanOrEqual(40);
    }
    for (let i = 1; i < fast.steps.length; i++) {
      const gap = (fast.steps[i] as number) - (fast.steps[i - 1] as number);
      expect(gap).toBeGreaterThanOrEqual(34);
      expect(gap).toBeLessThan(40);
    }
    expect(fast.steps.length).toBe(5);
    expect(fast.last).toBe(5);
    expect(base.last).toBe(5);
    expect(got(fast.steps[4])).toBeLessThan(got(base.steps[4]));
  });

  test('a refinery batch cooldown is scaled for its owner (flow level)', () => {
    // The refinery chain of refinery.test.ts with a tier 1 refinery (interval
    // 60): two tier 3 collectors fill its counters in 30 ticks, so the
    // refinery's own interval is what limits it.
    const lab = new Lab(
      tinyMap([
        [3, 2, 'res_b'],
        [5, 2, 'res_a'],
      ]),
    );
    lab.core(8, 0);
    const refinery = lab.put('bld_refinery_ab', 5, 5, 0, 1);
    const south = lab.put('bld_extractor', 5, 2, 0, 3);
    lab.link(south, 'north', refinery, 'south', [
      [5, 3],
      [5, 4],
    ]);
    const west = lab.put('bld_extractor', 3, 2, 0, 3);
    lab.link(west, 'north', refinery, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
    const batches = (percent: number[] | undefined) => {
      const events: SimEvent[] = [];
      const sim = createBoardSim(lab.state, content, simConfig);
      const ctx = createFlowContext(lab.state, content, simConfig, {
        consumers: 'drain',
        events,
      });
      if (percent !== undefined) ctx.refinerySpeedPercent = percent;
      for (let t = 0; t < 400; t++) stepFlow(sim, ctx);
      const ticks = events
        .filter((e) => e.type === 'produced' && e.building === refinery)
        .map((e) => e.tick)
        .filter((_t, i) => i % 2 === 0);
      return ticks.slice(1).map((t, i) => t - (ticks[i] as number));
    };
    const base = batches(undefined);
    expect(new Set(base)).toEqual(new Set([60]));
    // Player 0 is the owner: 60 -> floor(6000 / 115) = 52; a bonus of player 1
    // changes nothing for this refinery.
    expect(new Set(batches([15, 0]))).toEqual(new Set([52]));
    expect(new Set(batches([0, 15]))).toEqual(new Set([60]));
  });

  test('the arena hands each owner their own refinery percent', () => {
    const lab = new Lab(twoPlots());
    lab.core(5, 6, 0);
    lab.core(17, 6, 1);
    const state = pick(lab.state, [ALCH, FLOW]);
    const { sim, ctx } = startArenaBattle(
      state,
      foe(),
      GAP,
      content,
      simConfig,
    );
    stepArena(sim, ctx);
    expect(ctx.flows[0]?.refinerySpeedPercent).toEqual([15, 0]);
    expect(ctx.flows[1]?.refinerySpeedPercent).toEqual([0, 0]);
    expect(ctx.flows[0]?.sourceSpeedPercent).toEqual([0, 10]);
  });
});

describe('compatibility', () => {
  test('a team with no specialists plays exactly as before', () => {
    const lab = new Lab(twoPlots([[0, 0, 'res_a']]));
    lab.core(5, 6, 0);
    lab.core(17, 6, 1);
    lab.put('bld_extractor', 0, 0);
    const run = (state: TeamState) => {
      const a = createArenaSim(state, foe(), GAP, content, simConfig);
      const ctx = createArenaContext(a, content, simConfig);
      for (let t = 0; t < 60; t++) stepArena(a, ctx);
      return JSON.stringify(a);
    };
    expect(run(lab.state)).toBe(run(pick(lab.state, [null, null])));
  });
});
