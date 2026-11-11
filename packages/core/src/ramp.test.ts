import { describe, expect, test } from 'vitest';
import {
  createArenaContext,
  createArenaSim,
  rampBonus,
  runArena,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  unitStats,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import {
  createBoardSim,
  createFlowContext,
  flowTotals,
  scaledInterval,
  stepFlow,
  type SimEvent,
} from './flow-sim.js';
import { hashJson } from './hash.js';
import {
  isOverloadBeat,
  overloadDeadline,
  overloadLevel,
  overloadOutcome,
} from './ramp.js';
import {
  coreOnlyTeam,
  crossoverTeam,
  overclockerOnOre,
  overclockerSpeedTeam,
  tinyMap,
} from './ramp-scenarios.js';
import { content, got, Lab, simConfig } from './test-support.js';
import type { TeamState } from './team-state.js';

const GAP = 4;

function ofType<T extends ArenaEvent['type']>(
  events: readonly ArenaEvent[],
  type: T,
): Extract<ArenaEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<ArenaEvent, { type: T }> => e.type === type,
  );
}

function hpOf(sim: ArenaSim, side: number, building: number): number {
  return got(sim.health.find((h) => h.side === side && h.building === building))
    .hp;
}

function kill(sim: ArenaSim, side: number, building: number): void {
  const h = got(
    sim.health.find((x) => x.side === side && x.building === building),
  );
  h.hp = 0;
}

// ---------------------------------------------------------------------------

describe('overloadDeadline (#43)', () => {
  const cfg = {
    ...simConfig,
    overloadStartTick: 1800,
    overloadIntervalTicks: 100,
    overloadCoreDamageStep: 5,
  };

  test('hand-computed deadlines for start 1800, interval 100, step 5', () => {
    // After n beats the decay is 5 * n * (n + 1) / 2: 5, 15, 30, ..., 455
    // (13 beats), 525 (14 beats). Beat n is at tick 1800 + 100 * (n - 1).
    expect(overloadDeadline(cfg, 500)).toEqual({
      startTick: 1800,
      decayDestroysTick: 3100,
      decayDestroysLevel: 14,
    });
    expect(overloadDeadline(cfg, 455)).toMatchObject({
      decayDestroysTick: 3000, // 13 beats: exactly 455
      decayDestroysLevel: 13,
    });
    expect(overloadDeadline(cfg, 456)).toMatchObject({
      decayDestroysTick: 3100,
    });
    expect(overloadDeadline(cfg, 1)).toMatchObject({
      decayDestroysTick: 1800,
      decayDestroysLevel: 1,
    });
    expect(overloadDeadline(cfg, 5)).toMatchObject({ decayDestroysTick: 1800 });
    expect(overloadDeadline(cfg, 6)).toMatchObject({ decayDestroysTick: 1900 });
  });

  test('agrees with a brute-force sum of the decay for every health to 3000', () => {
    for (let h = 1; h <= 3000; h++) {
      let total = 0;
      let level = 0;
      while (total < h) {
        level += 1;
        total += level * cfg.overloadCoreDamageStep;
      }
      const d = overloadDeadline(cfg, h);
      expect(d.decayDestroysLevel).toBe(level);
      expect(d.decayDestroysTick).toBe(
        cfg.overloadStartTick + (level - 1) * cfg.overloadIntervalTicks,
      );
    }
  });

  test('matches the tick a walled Core really falls in a battle with no units', () => {
    const team = coreOnlyTeam();
    for (const hp of [500, 120, 7]) {
      const { sim, ctx, events } = startArenaBattle(
        team,
        team,
        GAP,
        content,
        simConfig,
        { sideOptions: [{ coreHealth: hp }, { coreHealth: hp }] },
      );
      const d = overloadDeadline(simConfig, hp);
      expect(d.startTick).toBe(simConfig.overloadStartTick);
      const tick = d.decayDestroysTick ?? -1;
      runArena(sim, ctx, tick);
      expect(ofType(events, 'core_destroyed')).toHaveLength(0);
      runArena(sim, ctx, 1);
      expect(ofType(events, 'core_destroyed').map((e) => e.tick)).toEqual([
        tick,
        tick,
      ]);
    }
  });

  test('a zero decay step never destroys; bad health throws', () => {
    expect(
      overloadDeadline({ ...cfg, overloadCoreDamageStep: 0 }, 500),
    ).toEqual({
      startTick: 1800,
      decayDestroysTick: null,
      decayDestroysLevel: null,
    });
    expect(() => overloadDeadline(cfg, 0)).toThrow(RangeError);
    expect(() => overloadDeadline(cfg, 1.5)).toThrow(RangeError);
    // The largest Core health stays exact (with a time limit far enough out).
    const far = { ...cfg, maxBattleTicks: 100_000_000 };
    const big = overloadDeadline(far, 1_000_000_000_000);
    expect(big.decayDestroysLevel).toBe(632456);
    expect(big.decayDestroysTick).toBe(1800 + 632455 * 100);
    // Without the time limit far out the same health is not within the battle.
    expect(overloadDeadline(cfg, 1_000_000_000_000)).toEqual({
      startTick: 1800,
      decayDestroysTick: null,
      decayDestroysLevel: null,
    });
  });
});

describe('overloadOutcome (#75)', () => {
  const cfg = {
    ...simConfig,
    overloadStartTick: 1800,
    overloadIntervalTicks: 100,
    overloadCoreDamageStep: 5,
  };
  test('the smaller Core falls first, equal ticks fall together', () => {
    expect(overloadOutcome(cfg, 500, 315)).toEqual({ first: 'b', tick: 2800 });
    expect(overloadOutcome(cfg, 42, 500)).toEqual({ first: 'a', tick: 2100 });
    expect(overloadOutcome(cfg, 500, 456)).toEqual({
      first: 'both',
      tick: 3100,
    });
    expect(overloadOutcome(cfg, 500, 455)).toEqual({ first: 'b', tick: 3000 });
  });
  test('a Core the decay does not destroy within the battle never falls first', () => {
    const short = { ...cfg, maxBattleTicks: 3000 };
    // 455 falls at tick 3000 (not before the limit 3000), 315 at 2800.
    expect(overloadOutcome(short, 500, 315)).toEqual({
      first: 'b',
      tick: 2800,
    });
    expect(overloadOutcome(short, 315, 500)).toEqual({
      first: 'a',
      tick: 2800,
    });
    expect(overloadOutcome(short, 500, 455)).toEqual({
      first: null,
      tick: null,
    });
  });
  test('no decay: nothing falls', () => {
    expect(
      overloadOutcome({ ...cfg, overloadCoreDamageStep: 0 }, 500, 315),
    ).toEqual({ first: null, tick: null });
  });
});

describe('Overload level (CB-12)', () => {
  test('level 0 before the start tick, then one more every interval', () => {
    expect(simConfig.overloadStartTick).toBe(1800);
    expect(overloadLevel(0, simConfig)).toBe(0);
    expect(overloadLevel(1799, simConfig)).toBe(0);
    expect(overloadLevel(1800, simConfig)).toBe(1);
    expect(overloadLevel(1899, simConfig)).toBe(1);
    expect(overloadLevel(1900, simConfig)).toBe(2);
    expect(overloadLevel(3100, simConfig)).toBe(14);
    expect(isOverloadBeat(1799, simConfig)).toBe(false);
    expect(isOverloadBeat(1800, simConfig)).toBe(true);
    expect(isOverloadBeat(2401, simConfig)).toBe(false);
    expect(isOverloadBeat(1900, simConfig)).toBe(true);
  });

  test('events fire once per level, at the tick the level rises', () => {
    const { sim, ctx, events } = startArenaBattle(
      coreOnlyTeam(),
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    sim.tick = 1795; // the state is plain JSON: a later tick is a valid state
    runArena(sim, ctx, 220);
    expect(ofType(events, 'overload_started').map((e) => e.tick)).toEqual([
      1800,
    ]);
    expect(
      ofType(events, 'overload_level').map((e) => [e.tick, e.level]),
    ).toEqual([
      [1800, 1],
      [1900, 2],
      [2000, 3],
    ]);
    // Core decay: level * 5 to both Cores, on the beats only.
    expect(
      ofType(events, 'overload_core_damage').map((e) => [
        e.tick,
        e.side,
        e.damage,
      ]),
    ).toEqual([
      [1800, 0, 5],
      [1800, 1, 5],
      [1900, 0, 10],
      [1900, 1, 10],
      [2000, 0, 15],
      [2000, 1, 15],
    ]);
    expect(hpOf(sim, 0, 0)).toBe(500 - 30);
  });
});

// ---------------------------------------------------------------------------

describe('source interval modifier (flow)', () => {
  function straightSource(): TeamState {
    const lab = new Lab(tinyMap([[2, 2, 'res_a']]));
    const s = lab.put('bld_extractor', 2, 2);
    const b = lab.put('bld_barracks', 2, 3);
    lab.link(s, 'north', b, 'south');
    return lab.state;
  }
  function producedTicks(
    percentAt: (tick: number) => number,
    ticks: number,
  ): number[] {
    const state = straightSource();
    const events: SimEvent[] = [];
    const sim = createBoardSim(state, content, simConfig);
    const ctx = createFlowContext(state, content, simConfig, {
      consumers: 'drain',
      events,
    });
    for (let t = 0; t < ticks; t++) {
      ctx.sourceSpeedPercent = percentAt(t);
      stepFlow(sim, ctx);
    }
    return events.filter((e) => e.type === 'produced').map((e) => e.tick);
  }

  test('interval = max(1, floor(interval * 100 / (100 + percent)))', () => {
    expect(scaledInterval(20, 0)).toBe(20);
    expect(scaledInterval(20, 5)).toBe(19); // 19.04
    expect(scaledInterval(14, 6)).toBe(13); // 13.2
    expect(scaledInterval(20, 100)).toBe(10);
    expect(scaledInterval(20, 300)).toBe(5);
    expect(scaledInterval(10, 300)).toBe(2); // 2.5 rounds down
    expect(scaledInterval(3, 300)).toBe(1); // 0.75 -> floor 0 -> at least 1
    expect(scaledInterval(1, 300)).toBe(1);
  });

  test('without a modifier a source behaves as before; with 100 percent it doubles', () => {
    // Countdown starts at 20: items at ticks 19, 39, ..., 199 (10 items).
    const base = producedTicks(() => 0, 200);
    expect(base).toEqual([19, 39, 59, 79, 99, 119, 139, 159, 179, 199]);
    // The first item is still at tick 19 (the first countdown is not
    // rewritten); then every 10 ticks: 19, 29, ..., 199 (19 items).
    const fast = producedTicks(() => 100, 200);
    expect(fast).toHaveLength(19);
    expect(fast.slice(0, 4)).toEqual([19, 29, 39, 49]);
  });

  test('a change applies at the next reset only, never to a running countdown', () => {
    // 0 percent until tick 29, then 100. The item at 39 is on the old
    // countdown (reset at 19 with 0 percent); only the reset at 39 uses 10.
    const t = producedTicks((tick) => (tick < 30 ? 0 : 100), 80);
    expect(t.slice(0, 5)).toEqual([19, 39, 49, 59, 69]);
  });

  test('the dry run is unchanged (modifier 0)', () => {
    const state = straightSource();
    const ctx = createFlowContext(state, content, simConfig, {
      consumers: 'drain',
    });
    expect(ctx.sourceSpeedPercent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('economy buildings: charging and steps (CB-11)', () => {
  /** A tier 3 res_c source (interval 10) feeding an overclocker of `tier`. */
  function overclockerBoard(tier: number): TeamState {
    const lab = new Lab(tinyMap([[10, 0, 'res_c']]));
    lab.core(5, 6);
    const s = lab.put('bld_extractor', 10, 0, 0, 3);
    const o = lab.put('bld_overclocker', 10, 1, 0, tier);
    lab.link(s, 'north', o, 'south');
    return lab.state;
  }

  test('state starts at zero; a step takes costPerStep items and resets the charge', () => {
    const { sim, ctx, events } = startArenaBattle(
      overclockerBoard(1),
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    expect(sim.ramps).toEqual([{ side: 0, building: 2, charge: 0, steps: 0 }]);
    // Tier 1: costPerStep 4. The source (interval 10) delivers at ticks 9,
    // 19, 29, 39; the fourth item completes the step in the same tick.
    runArena(sim, ctx, 39);
    expect(got(sim.ramps[0])).toMatchObject({ charge: 3, steps: 0 });
    stepArena(sim, ctx);
    expect(got(sim.ramps[0])).toMatchObject({ charge: 0, steps: 1 });
    expect(ofType(events, 'ramp_step')).toEqual([
      {
        tick: 39,
        type: 'ramp_step',
        side: 0,
        building: 2,
        effect: 'source_speed',
        steps: 1,
      },
    ]);
  });

  test('a building at maxSteps stops growing and stops consuming; its conduit backs up', () => {
    const { sim, ctx, events } = startArenaBattle(
      overclockerBoard(1),
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    // Tier 1: maxSteps 6, costPerStep 4, stepPercent 5. Without the speed-up
    // 6 steps would need 24 items = tick 239; the bonus only shortens that.
    runArena(sim, ctx, 600);
    const r = got(sim.ramps[0]);
    expect(r).toMatchObject({ steps: 6, charge: 0 });
    const consumedAt600 = got(sim.boards[0].consumers[0]).inputs[0]?.consumed;
    expect(consumedAt600).toBe(24); // exactly 6 steps * 4 items
    expect(ofType(events, 'ramp_step').map((e) => e.steps)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(rampBonus(sim, ctx, 0, 'source_speed')).toBe(30);
    // 300 more ticks: nothing changes, the buffer is full, the source stalls.
    runArena(sim, ctx, 300);
    expect(got(sim.ramps[0])).toMatchObject({ steps: 6, charge: 0 });
    const input = got(sim.boards[0].consumers[0]?.inputs[0]);
    expect(input.consumed).toBe(24);
    expect(input.count).toBe(sim.boards[0].bufferCapacity);
    expect(got(sim.boards[0].sources[0]).stalled).toBe(1);
    expect(ofType(events, 'ramp_step')).toHaveLength(6);
    expect(rampBonus(sim, ctx, 0, 'source_speed')).toBe(30);
  });

  test('the global maximum clamps the total (source_speed)', () => {
    // Four tier 3 overclockers: 4 * (10 steps * 8 percent) = 320, capped at 300.
    const lab = new Lab(tinyMap());
    lab.core(5, 6);
    for (const x of [0, 2, 4, 6]) lab.put('bld_overclocker', x, 0, 0, 3);
    const { sim, ctx } = startArenaBattle(
      lab.state,
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    expect(sim.ramps).toHaveLength(4);
    for (const r of sim.ramps) r.steps = 10;
    expect(rampBonus(sim, ctx, 0, 'source_speed')).toBe(300);
    got(sim.ramps[3]).steps = 0;
    expect(rampBonus(sim, ctx, 0, 'source_speed')).toBe(240); // below the cap
    expect(rampBonus(sim, ctx, 1, 'source_speed')).toBe(0);
    expect(rampBonus(sim, ctx, 0, 'unit_strength')).toBe(0);
  });

  test('the global maximum clamps the total (unit_strength)', () => {
    // Six tier 3 armories: 6 * (10 * 6) = 360, capped at 300; a soldier
    // spawned then has health mulPct(40, 400) and damage mulPct(6, 400).
    const lab = new Lab(tinyMap());
    lab.core(5, 6);
    for (const x of [0, 2, 4, 6, 8, 10]) lab.put('bld_armory', x, 0, 0, 3);
    const { sim, ctx } = startArenaBattle(
      lab.state,
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    for (const r of sim.ramps) r.steps = 10;
    expect(rampBonus(sim, ctx, 0, 'unit_strength')).toBe(300);
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 11,
      y: 12,
    });
    expect(u.hp).toBe(160);
    expect(u.damage).toBe(24);
  });

  test('a capped speed total is applied to the source intervals (floor, at least 1)', () => {
    // Four tier 3 overclockers at max (320 -> 300): a base source of interval
    // 20 resets to floor(2000 / 400) = 5. Item ticks: 19, then 24, 29, ...
    const lab = new Lab(tinyMap([[11, 0, 'res_a']]));
    lab.core(5, 6);
    for (const x of [0, 2, 4, 6]) lab.put('bld_overclocker', x, 0, 0, 3);
    const s = lab.put('bld_extractor', 11, 0);
    const b = lab.put('bld_barracks', 10, 1);
    lab.link(s, 'north', b, 'south');
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    for (const r of sim.ramps) r.steps = 10;
    runArena(sim, ctx, 40);
    expect(
      ofType(events, 'produced')
        .filter((e) => e.building === s)
        .map((e) => e.tick),
    ).toEqual([19, 24, 29, 34, 39]);
  });
});

// ---------------------------------------------------------------------------

describe('an overclocker speeds up a source', () => {
  const oreTicks = (withOverclocker: boolean) => {
    const { sim, ctx, events } = startArenaBattle(
      overclockerSpeedTeam(withOverclocker),
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 600);
    const ore = got(sim.boards[0].sources.find((s) => s.resource === 'res_a'));
    return ofType(events, 'produced')
      .filter((e) => e.side === 0 && e.building === ore.building)
      .map((e) => e.tick);
  };

  test('with and without the overclocker', () => {
    // Without: an item every 20 ticks from tick 19: 19, 39, ..., 599 = 30.
    const without = oreTicks(false);
    expect(without).toHaveLength(30);
    expect(without[1]).toBe(39);
    // With: the flux extractor (tier 3, interval 10) delivers 4 items by tick
    // 39, so step 1 is taken at tick 39 (+5 percent) and step 2 at 76 (+10).
    // The ore extractor resets at 19 and 39 with 0 percent (20 ticks), at 59
    // with 5 percent (floor(2000 / 105) = 19, next item 78), at 78 with 10
    // percent (floor(2000 / 110) = 18, next item 96), at 96 still with 10
    // percent (step 3 comes at 112): next item 114, and so on.
    const withIt = oreTicks(true);
    expect(withIt.slice(0, 6)).toEqual([19, 39, 59, 78, 96, 114]);
    expect(withIt.length).toBeGreaterThan(without.length);
  });
});

describe('crossover: ramp versus the same resources elsewhere (criterion 1)', () => {
  // Three barracks (tier 1, costPerUnit 6) are each fed directly by a tier 1
  // extractor (interval 20) on ore. A fourth extractor feeds either
  //   Y: a fourth barracks, or
  //   X: a tier 3 overclocker (costPerStep 3, +8 percent per step, 10 steps).
  // The test content lets the overclocker take ore, so the resources are the
  // same either way.
  //
  // Y (no ramp): an item every 20 ticks, produced at ticks 19, 39, ..., the
  // sixth at tick 119; a direct link delivers it in the same tick and the
  // barracks takes it in the same tick, so every barracks spawns at ticks
  // 119, 239, ... and Y has 4 * floor((t + 1) / 120) units after tick t.
  //
  // X: the extra source makes items at 19, 39, 59: three items, so step 1 is
  // taken at tick 59. The bonus 8 percent applies at a source's next reset: the
  // extra source reset at 59 used 0 percent (item at 79), its reset at 79
  // uses floor(2000 / 108) = 18 (items 97, 115 -> step 2 at tick 115), and
  // so on. After step 10 the bonus is 80 percent: floor(2000 / 180) = 11
  // ticks per item for every source. Three barracks then make a unit every 66
  // ticks each: 3 / 66 per tick against Y's 4 / 120 per tick (1.36 times).
  // Until the ramp has paid for the missing fourth barracks X is behind.
  const run = (variant: 'barracks' | 'overclocker', ticks: number[]) => {
    const { sim, ctx, events } = startArenaBattle(
      crossoverTeam(variant),
      coreOnlyTeam(),
      GAP,
      overclockerOnOre,
      simConfig,
    );
    const counts: Record<number, number> = {};
    for (let t = 0; t < Math.max(...ticks); t++) {
      stepArena(sim, ctx);
      if (ticks.includes(t + 1)) counts[t + 1] = sim.spawned[0];
    }
    return { counts, events };
  };
  const marks = [120, 240, 360, 480, 600, 720, 960, 1200, 1440];

  test('X trails Y before the crossover and leads it afterwards', () => {
    const y = run('barracks', marks).counts;
    const x = run('overclocker', marks);
    // Y is exactly 4 units per 120 ticks.
    expect(marks.map((m) => y[m])).toEqual(marks.map((m) => (m / 120) * 4));
    expect(marks.map((m) => x.counts[m])).toEqual([
      3, 6, 9, 15, 21, 27, 36, 48, 57,
    ]);
    // Behind at 120, 240, 360, 480; ahead from 600 on.
    for (const m of [120, 240, 360, 480]) {
      expect(x.counts[m]).toBeLessThan(y[m] ?? 0);
    }
    for (const m of [600, 720, 960, 1200, 1440]) {
      expect(x.counts[m]).toBeGreaterThan(y[m] ?? 0);
    }
    const steps = ofType(x.events, 'ramp_step');
    expect(steps.map((e) => e.tick).slice(0, 2)).toEqual([59, 115]);
    expect(steps).toHaveLength(10);
  });

  test('an economy building takes nothing from the board without it', () => {
    // Same boards without the overclocker's effect: Y never has ramp steps.
    const y = run('barracks', [120]);
    expect(ofType(y.events, 'ramp_step')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('unit_strength (armory)', () => {
  /** Ore source (tier 1) -> barracks (tier 1); ore source (tier 1) -> armory (tier 1). */
  function armoryBoard(): { team: TeamState; armory: number } {
    const lab = new Lab(
      tinyMap([
        [0, 0, 'res_a'],
        [4, 0, 'res_a'],
      ]),
    );
    lab.core(5, 6);
    const s1 = lab.put('bld_extractor', 0, 0);
    const b = lab.put('bld_barracks', 0, 1);
    lab.link(s1, 'north', b, 'south');
    const s2 = lab.put('bld_extractor', 4, 0);
    const a = lab.put('bld_armory', 4, 1);
    lab.link(s2, 'north', a, 'south');
    return { team: lab.state, armory: a };
  }

  test('units spawned later are stronger; units already on the field keep their stats', () => {
    const { team, armory } = armoryBoard();
    const { sim, ctx, events } = startArenaBattle(
      team,
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    // Tier 1 armory: costPerStep 6, +4 percent, max 6. The ore source makes an
    // item every 20 ticks (19, 39, ...): a step needs 6 items, so steps are
    // taken at ticks 119, 239, 359, ... The barracks needs 6 ore per soldier
    // and spawns at the same ticks, but the barracks acts BEFORE the armory
    // in the same tick, so the unit spawned at 119 sees 0 steps, the unit
    // of 239 sees 1 step (+4 percent) and the unit of 359 sees 2 (+8 percent).
    runArena(sim, ctx, 360);
    const spawned = ofType(events, 'unit_spawned');
    expect(spawned.map((e) => e.tick)).toEqual([119, 239, 359]);
    const hp = spawned.map((e) => sim.units.find((u) => u.id === e.unit)?.hp);
    // mulPct(40, 100) = 40, mulPct(40, 104) = 41 (41.6), mulPct(40, 108) = 43.
    expect(hp).toEqual([40, 41, 43]);
    expect(sim.units.map((u) => u.damage)).toEqual([6, 6, 6]); // 6.24, 6.48 -> 6
    expect(ofType(events, 'ramp_step').map((e) => e.tick)).toEqual([
      119, 239, 359,
    ]);
    expect(ofType(events, 'ramp_step').map((e) => e.effect)).toEqual([
      'unit_strength',
      'unit_strength',
      'unit_strength',
    ]);
    // The earlier units were not changed by the later steps.
    const first = got(sim.units[0]);
    expect(first.hp).toBe(40);
    expect(rampBonus(sim, ctx, 0, 'unit_strength')).toBe(12);
    expect(rampBonus(sim, ctx, 0, 'source_speed')).toBe(0);
    expect(rampBonus(sim, ctx, 1, 'unit_strength')).toBe(0);
    // Damage rounding: 5 steps = +20 percent -> mulPct(6, 120) = 7.
    got(sim.ramps.find((r) => r.building === armory)).steps = 5;
    const u = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 11,
      y: 12,
    });
    expect([u.hp, u.damage]).toEqual([48, 7]);
  });

  test('unitStats applies mulPct to health and damage only', () => {
    const soldier = got(content.units.get('unit_soldier'));
    const s = unitStats(0, soldier, 50);
    expect(s.health).toBe(60);
    expect(s.damage).toBe(9);
    expect(s.moveCooldownTicks).toBe(soldier.moveCooldownTicks);
    expect(s.attackCooldownTicks).toBe(soldier.attackCooldownTicks);
    expect(unitStats(0, soldier)).toBe(soldier);
    expect(unitStats(1, soldier, 0)).toBe(soldier);
  });

  test('a unit attacks with the damage it was spawned with', () => {
    const { team } = armoryBoard();
    const { sim, ctx, events } = startArenaBattle(
      team,
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    got(sim.ramps[0]).steps = 5; // +20 percent
    const strong = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 5,
      y: 18,
    });
    const foe = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 5,
      y: 19,
    });
    got(sim.ramps[0]).steps = 0; // bonus gone: the strong unit stays strong
    stepArena(sim, ctx);
    const hits = ofType(events, 'unit_attacked');
    expect(hits.find((e) => e.unit === strong.id)?.damage).toBe(7);
    expect(hits.find((e) => e.unit === foe.id)?.damage).toBe(6);
    expect(strong.hp).toBe(48 - 6);
    expect(foe.hp).toBe(40 - 7);
  });
});

// ---------------------------------------------------------------------------

describe('destroying an economy building removes its bonus (criterion 4)', () => {
  test('source speed returns to base on the next reset', () => {
    const { sim, ctx, events } = startArenaBattle(
      crossoverTeam('overclocker'),
      coreOnlyTeam(),
      GAP,
      overclockerOnOre,
      simConfig,
    );
    const oc = got(sim.ramps[0]).building;
    runArena(sim, ctx, 200);
    expect(got(sim.ramps[0]).steps).toBeGreaterThanOrEqual(2);
    expect(rampBonus(sim, ctx, 0, 'source_speed')).toBeGreaterThan(0);
    const mark = events.length;
    kill(sim, 0, oc);
    stepArena(sim, ctx);
    // Gone from the state at once, and the total with it.
    expect(sim.ramps).toHaveLength(0);
    expect(rampBonus(sim, ctx, 0, 'source_speed')).toBe(0);
    expect(
      ofType(events.slice(mark), 'building_destroyed').map((e) => e.building),
    ).toEqual([oc]);
    runArena(sim, ctx, 100);
    // A barracks source (the first extractor): the first item after the
    // destruction is on a running countdown (shorter than 20 allowed); from
    // the second one on the spacing is the base 20.
    const src = got(sim.boards[0].sources[0]).building;
    const ticks = ofType(events, 'produced')
      .filter((e) => e.side === 0 && e.building === src && e.tick > 201)
      .map((e) => e.tick);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[2]).toBe(got(ticks[1]) + 20);
    expect(got(ticks[1]) - got(ticks[0])).toBe(20);
    // And before the destruction the spacing was shorter than the base.
    const before = ofType(events, 'produced')
      .filter((e) => e.side === 0 && e.building === src && e.tick < 200)
      .map((e) => e.tick);
    expect(
      got(before[before.length - 1]) - got(before[before.length - 2]),
    ).toBeLessThan(20);
  });

  test('units spawned after the destruction have base stats; earlier ones keep theirs', () => {
    const lab = new Lab(
      tinyMap([
        [0, 0, 'res_a'],
        [4, 0, 'res_a'],
      ]),
    );
    lab.core(5, 6);
    const s1 = lab.put('bld_extractor', 0, 0, 0, 3); // interval 10
    const b = lab.put('bld_barracks', 0, 1, 0, 3); // costPerUnit 4
    lab.link(s1, 'north', b, 'south');
    const s2 = lab.put('bld_extractor', 4, 0, 0, 3);
    const a = lab.put('bld_armory', 4, 1, 0, 3); // costPerStep 5, +6, max 10
    lab.link(s2, 'north', a, 'south');
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 300);
    const early = sim.units.filter((u) => u.hp > 40);
    expect(early.length).toBeGreaterThan(0);
    const earlyHp = early.map((u) => [u.id, u.hp, u.damage]);
    const bonus = rampBonus(sim, ctx, 0, 'unit_strength');
    expect(bonus).toBeGreaterThan(0);
    kill(sim, 0, a);
    runArena(sim, ctx, 200);
    expect(sim.ramps).toHaveLength(0);
    expect(rampBonus(sim, ctx, 0, 'unit_strength')).toBe(0);
    const lastEarly = Math.max(...early.map((u) => u.id));
    const later = ofType(events, 'unit_spawned').filter(
      (e) => e.unit > lastEarly && e.tick > 301,
    );
    expect(later.length).toBeGreaterThan(3);
    for (const e of later) {
      const u = sim.units.find((x) => x.id === e.unit);
      if (u !== undefined) expect([u.hp, u.damage]).toEqual([40, 6]);
    }
    for (const [id, hp, damage] of earlyHp) {
      const u = sim.units.find((x) => x.id === id);
      if (u !== undefined) expect([u.hp, u.damage]).toEqual([hp, damage]);
    }
  });
});

// ---------------------------------------------------------------------------

describe('no upgrade state survives into a second battle (criterion 3)', () => {
  test('two sims from one team state both start cold', () => {
    const team = crossoverTeam('overclocker');
    const other = coreOnlyTeam();
    const before = hashJson(team);
    const first = startArenaBattle(
      team,
      other,
      GAP,
      overclockerOnOre,
      simConfig,
    );
    runArena(first.sim, first.ctx, 300);
    expect(first.sim.ramps.some((r) => r.steps > 0)).toBe(true);
    // The team state was not touched by the first battle.
    expect(hashJson(team)).toBe(before);
    const second = createArenaSim(
      team,
      other,
      GAP,
      overclockerOnOre,
      simConfig,
    );
    expect(second.ramps.every((r) => r.steps === 0 && r.charge === 0)).toBe(
      true,
    );
    expect(second.tick).toBe(0);
    const fresh = createArenaSim(
      crossoverTeam('overclocker'),
      other,
      GAP,
      overclockerOnOre,
      simConfig,
    );
    expect(hashJson(second)).toBe(hashJson(fresh));
    expect(rampBonus(second, first.ctx, 0, 'source_speed')).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('Overload damage (criterion 6)', () => {
  const levelTick = (level: number): number =>
    simConfig.overloadStartTick + (level - 1) * simConfig.overloadIntervalTicks;

  function duel(level: number) {
    const b = startArenaBattle(
      coreOnlyTeam(),
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    b.sim.tick = levelTick(level);
    const a0 = spawnUnitForTest(b.sim, b.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 2,
      y: 17,
    });
    const a1 = spawnUnitForTest(b.sim, b.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 2,
      y: 18,
    });
    stepArena(b.sim, b.ctx);
    return { ...b, a0, a1 };
  }

  test('unit damage is mulPct(damage, 100 + level * 20) against units', () => {
    // Soldier damage 6: level 0 -> 6; level 1 -> 120% = 7.2 -> 7; level 2 ->
    // 140% = 8.4 -> 8; level 5 -> 200% = 12; level 10 -> 300% = 18.
    for (const [level, damage] of [
      [1, 7],
      [2, 8],
      [5, 12],
      [10, 18],
    ] as const) {
      const d = duel(level);
      const hits = ofType(d.events, 'unit_attacked');
      expect(hits.map((e) => e.damage)).toEqual([damage, damage]);
      expect(d.a0.hp).toBe(40 - damage);
      expect(d.a1.hp).toBe(40 - damage);
    }
    // Before Overload nothing changes.
    const before = startArenaBattle(
      coreOnlyTeam(),
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    before.sim.tick = 1799;
    spawnUnitForTest(before.sim, before.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 2,
      y: 17,
    });
    spawnUnitForTest(before.sim, before.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 2,
      y: 18,
    });
    stepArena(before.sim, before.ctx);
    expect(ofType(before.events, 'unit_attacked').map((e) => e.damage)).toEqual(
      [6, 6],
    );
  });

  test('it also applies to attacks on buildings and on Cores', () => {
    // Level 5 (200 percent): a soldier beside side 0's Core (cells 5..6 x 6..7)
    // hits it for 12; a soldier beside a wall hits the wall for 12.
    const lab = new Lab(tinyMap());
    lab.core(5, 6);
    const wall = lab.put('bld_wall', 1, 6);
    const b = startArenaBattle(
      lab.state,
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    b.sim.tick = levelTick(5);
    spawnUnitForTest(b.sim, b.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 5,
      y: 8,
    });
    stepArena(b.sim, b.ctx);
    const hit = ofType(b.events, 'unit_attacked').filter(
      (e) => e.target.kind === 'core',
    );
    expect(hit.map((e) => e.damage)).toEqual([12]);
    // The Core also took the level 5 decay (25) at tick 2800 (a beat).
    expect(hpOf(b.sim, 0, 0)).toBe(500 - 12 - 25);
    expect(hpOf(b.sim, 0, wall)).toBe(100);
  });

  test('turret damage is not escalated', () => {
    const lab = new Lab(tinyMap());
    lab.core(5, 6);
    lab.put('bld_turret', 5, 3); // tier 1: damage 5, range 4, costPerShot 1
    const b = startArenaBattle(
      lab.state,
      coreOnlyTeam(),
      GAP,
      content,
      simConfig,
    );
    b.sim.tick = levelTick(5);
    got(b.sim.turrets[0]).charge = 1;
    const foe = spawnUnitForTest(b.sim, b.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 3,
      y: 5,
    });
    stepArena(b.sim, b.ctx);
    const shots = ofType(b.events, 'turret_fired');
    expect(shots.map((e) => e.damage)).toEqual([5]);
    expect(foe.hp).toBe(40 - 5);
  });
});

// ---------------------------------------------------------------------------

describe('Overload ends walled stand-offs (criterion 5)', () => {
  /** A Core ringed by walls, nothing else: no producers, no units. */
  function walledCore(): TeamState {
    const lab = new Lab(tinyMap());
    lab.core(5, 3);
    for (let x = 4; x <= 7; x++) {
      lab.put('bld_wall', x, 2);
      lab.put('bld_wall', x, 5);
    }
    for (const y of [3, 4]) {
      lab.put('bld_wall', 4, y);
      lab.put('bld_wall', 7, y);
    }
    return lab.state;
  }

  test('both Cores are destroyed at tick 3100', () => {
    // The Core has 500 health. On the beats 1800, 1900, ... (j = 0, 1, ...)
    // each Core takes 5 * (j + 1). After n beats the total is 5 * n(n+1)/2:
    //   13 beats (last at 3000): 5 * 91 = 455 -> 45 health left;
    //   14 beats (last at 3100): 5 * 105 = 525 >= 500 -> destroyed.
    const team = walledCore();
    const { sim, ctx, events } = startArenaBattle(
      team,
      team,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 3100); // ticks 0..3099
    expect(hpOf(sim, 0, 0)).toBe(45);
    expect(hpOf(sim, 1, 0)).toBe(45);
    expect(ofType(events, 'core_destroyed')).toHaveLength(0);
    runArena(sim, ctx, 1); // tick 3100: level 14, damage 70
    expect(
      ofType(events, 'core_destroyed').map((e) => [e.tick, e.side]),
    ).toEqual([
      [3100, 0],
      [3100, 1],
    ]);
    expect(hpOf(sim, 0, 0)).toBe(0);
    expect(hpOf(sim, 1, 0)).toBe(0);
    expect(ofType(events, 'overload_level').at(-1)?.level).toBe(14);
    // Nothing else happened: no unit ever existed.
    expect(sim.spawned).toEqual([0, 0]);
  });

  test('stepping on after both Cores fell is safe and silent', () => {
    const team = walledCore();
    const { sim, ctx, events } = startArenaBattle(
      team,
      team,
      GAP,
      content,
      simConfig,
    );
    runArena(sim, ctx, 3101);
    const mark = events.length;
    runArena(sim, ctx, 500);
    const later = events.slice(mark);
    expect(later.filter((e) => e.type === 'core_destroyed')).toHaveLength(0);
    expect(later.filter((e) => e.type === 'overload_core_damage')).toHaveLength(
      0,
    );
    expect(ofType(later, 'overload_level').length).toBe(5);
    expect(sim.tick).toBe(3601);
  });
});

// ---------------------------------------------------------------------------

describe('symmetry with economy buildings on both sides', () => {
  function team(): TeamState {
    const lab = new Lab(
      tinyMap([
        [2, 0, 'res_a'],
        [6, 0, 'res_a'],
        [10, 0, 'res_c'],
      ]),
    );
    lab.core(5, 6);
    const s1 = lab.put('bld_extractor', 2, 0, 0, 3);
    const b1 = lab.put('bld_barracks', 2, 1, 0, 3);
    lab.link(s1, 'north', b1, 'south');
    const s2 = lab.put('bld_extractor', 6, 0, 0, 3);
    const ar = lab.put('bld_armory', 6, 1, 0, 2);
    lab.link(s2, 'north', ar, 'south');
    const s3 = lab.put('bld_extractor', 10, 0, 0, 3);
    const oc = lab.put('bld_overclocker', 10, 1, 0, 2);
    lab.link(s3, 'north', oc, 'south');
    return lab.state;
  }

  test('a mirror match stays exactly symmetric, ramp state included', () => {
    const t = team();
    const { sim, ctx } = startArenaBattle(t, t, GAP, content, simConfig);
    let steps = 0;
    for (let tick = 0; tick < 900; tick++) {
      stepArena(sim, ctx);
      const r0 = sim.ramps.filter((r) => r.side === 0);
      const r1 = sim.ramps.filter((r) => r.side === 1);
      expect(r1.map((r) => [r.building, r.charge, r.steps])).toEqual(
        r0.map((r) => [r.building, r.charge, r.steps]),
      );
      expect(hashJson(sim.boards[0])).toBe(hashJson(sim.boards[1]));
      expect(
        sim.units
          .filter((u) => u.side === 0)
          .map((u) => [u.hp, u.damage])
          .sort(),
      ).toEqual(
        sim.units
          .filter((u) => u.side === 1)
          .map((u) => [u.hp, u.damage])
          .sort(),
      );
      for (const b of sim.boards) {
        const f = flowTotals(b);
        expect(f.produced).toBe(
          f.inConduits + f.held + f.inBuffers + f.consumed + f.lost,
        );
      }
      steps = sim.ramps.reduce((n, r) => n + r.steps, 0);
    }
    expect(steps).toBeGreaterThan(10);
    expect(sim.spawned[0]).toBe(sim.spawned[1]);
    expect(sim.spawned[0]).toBeGreaterThan(10);
  });

  test('a restored state continues exactly like the original, ramp included', () => {
    const t = team();
    const a = startArenaBattle(t, t, GAP, content, simConfig);
    runArena(a.sim, a.ctx, 250);
    const copy = JSON.parse(JSON.stringify(a.sim)) as ArenaSim;
    const events: ArenaEvent[] = [];
    const ctx = createArenaContext(copy, content, simConfig, { events });
    const mark = a.events.length;
    runArena(a.sim, a.ctx, 400);
    runArena(copy, ctx, 400);
    expect(hashJson(copy)).toBe(hashJson(a.sim));
    expect(hashJson(events)).toBe(hashJson(a.events.slice(mark)));
  });
});
