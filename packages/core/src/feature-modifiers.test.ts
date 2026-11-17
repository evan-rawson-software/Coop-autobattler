/**
 * Feature-linked combat modifiers (issue #426): Stone skin (armor), Wide arcs
 * (splash) and Claimstakers (point capture speed).
 */
import { describe, expect, test } from 'vitest';
import {
  placeGuards,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  unitStats,
  type ArenaEvent,
  type GuardPost,
} from './arena-sim.js';
import { findModifier, loadEvents, loadEventsOrThrow } from './events.js';
import { MAX_ARMOR } from './limits.js';
import {
  captureSpeedPercent,
  MAX_ARMOR_FLAT,
  MAX_SPEED_MODIFIER_PERCENT,
  parseModifierEffect,
  unitArmorBonus,
  unitSplashPercent,
  withModifier,
  type TeamModifier,
} from './modifiers.js';
import { captureTicksFor } from './points.js';
import { buildReferenceBoard } from './reference-boards.js';
import { Lab, content, mapgen, simConfig } from './testing/support.js';
import eventsJson from '../../../content/events.json';

const events = loadEventsOrThrow(eventsJson, { units: content.units });

function modifier(id: string): TeamModifier {
  const def = findModifier(events, id);
  if (def === undefined) throw new Error(`no modifier ${id}`);
  return { id: def.id, effects: def.effects };
}

const stone = modifier('mod_stone_skin');
const wide = modifier('mod_wide_arcs');
const claim = modifier('mod_claimstakers');

const parse = (e: object) => {
  const errors: string[] = [];
  return { e: parseModifierEffect(e, 'e', errors), errors };
};

describe('content', () => {
  test('the shipped definitions', () => {
    expect(findModifier(events, 'mod_stone_skin')).toEqual({
      id: 'mod_stone_skin',
      stackable: false,
      fromRound: 3,
      effects: [{ kind: 'unit_armor_flat', amount: 1, units: ['unit_golem'] }],
    });
    expect(findModifier(events, 'mod_wide_arcs')).toEqual({
      id: 'mod_wide_arcs',
      stackable: false,
      fromRound: 3,
      effects: [
        { kind: 'unit_splash_percent', percent: 50, units: ['unit_caster'] },
      ],
    });
    expect(findModifier(events, 'mod_claimstakers')).toEqual({
      id: 'mod_claimstakers',
      stackable: false,
      effects: [{ kind: 'poi_capture_speed_percent', percent: 50 }],
    });
  });

  test('bounds: armor amount 1 to MAX_ARMOR_FLAT, percents 1 to 100', () => {
    expect(parse({ kind: 'unit_armor_flat', amount: 1 }).e).toBeDefined();
    expect(
      parse({ kind: 'unit_armor_flat', amount: MAX_ARMOR_FLAT }).e,
    ).toBeDefined();
    for (const amount of [0, -1, MAX_ARMOR_FLAT + 1, 1.5, '1']) {
      expect(parse({ kind: 'unit_armor_flat', amount }).e).toBeUndefined();
    }
    // Armor has an amount, not a percent.
    expect(
      parse({ kind: 'unit_armor_flat', percent: 1 }).errors.length,
    ).toBeGreaterThan(0);
    expect(
      parse({ kind: 'unit_armor_flat', amount: 1, units: [] }).e,
    ).toBeUndefined();
    for (const kind of ['unit_splash_percent', 'poi_capture_speed_percent']) {
      expect(parse({ kind, percent: 1 }).e).toBeDefined();
      expect(
        parse({ kind, percent: MAX_SPEED_MODIFIER_PERCENT }).e,
      ).toBeDefined();
      for (const percent of [0, -10, 101, 1.5, '10']) {
        expect(parse({ kind, percent }).e, `${kind} ${String(percent)}`).toBe(
          undefined,
        );
      }
    }
    // Capture speed is side-wide: no units.
    expect(
      parse({
        kind: 'poi_capture_speed_percent',
        percent: 5,
        units: ['unit_raider'],
      }).errors.join(),
    ).toMatch(/unknown field "units"/);
    expect(
      parse({ kind: 'unit_splash_percent', percent: 5, units: ['unit_caster'] })
        .e,
    ).toEqual({
      kind: 'unit_splash_percent',
      percent: 5,
      units: ['unit_caster'],
    });
  });

  test('loadEvents checks the units of an armor or splash effect', () => {
    const load = (effect: object) =>
      loadEvents(
        {
          offerCount: 1,
          events: [{ id: 'evt_a', type: 'x', weight: 1 }],
          modifiers: [{ id: 'mod_x', stackable: false, effects: [effect] }],
        },
        { units: content.units },
      );
    expect(
      load({ kind: 'unit_armor_flat', amount: 1, units: ['unit_golem'] }).ok,
    ).toBe(true);
    expect(
      load({ kind: 'unit_armor_flat', amount: 1, units: ['unit_nope'] }).ok,
    ).toBe(false);
    expect(
      load({
        kind: 'unit_splash_percent',
        percent: 5,
        units: ['unit_raider', 'unit_soldier'],
      }).ok,
    ).toBe(false);
  });
});

describe('sums', () => {
  test('armor and splash sum the effects that apply; capture sums all', () => {
    const team = { modifiers: [stone, stone, wide, claim, claim] };
    expect(unitArmorBonus(team, 'unit_golem')).toBe(2);
    expect(unitArmorBonus(team, 'unit_soldier')).toBe(0);
    expect(unitSplashPercent(team, 'unit_caster')).toBe(50);
    expect(unitSplashPercent(team, 'unit_golem')).toBe(0);
    expect(captureSpeedPercent(team)).toBe(100);
    expect(captureSpeedPercent({})).toBe(0);
  });

  test('captureTicksFor: max(1, ceil(captureTicks * 100 / (100 + s)))', () => {
    expect(captureTicksFor(50, 0)).toBe(50);
    expect(captureTicksFor(50, 50)).toBe(34);
    expect(captureTicksFor(50, 100)).toBe(25);
    expect(captureTicksFor(1, 100)).toBe(1);
    expect(captureTicksFor(51, 100)).toBe(26);
  });

  test('unitStats: armor is capped at MAX_ARMOR, splash scales once, rounded down', () => {
    const golem = content.units.get('unit_golem');
    const caster = content.units.get('unit_caster');
    if (golem === undefined || caster === undefined) throw new Error('units');
    expect(unitStats(0, golem, 0, 100, 0, 0, 1, 0).armor).toBe(golem.armor + 1);
    expect(unitStats(0, golem, 0, 100, 0, 0, MAX_ARMOR, 0).armor).toBe(
      MAX_ARMOR,
    );
    expect(unitStats(0, caster, 0, 100, 0, 0, 0, 50).splash?.percent).toBe(
      Math.floor(((caster.splash?.percent ?? 0) * 150) / 100),
    );
    expect(unitStats(0, golem, 0, 100, 0, 0, 0, 50).splash).toBeUndefined();
    expect(unitStats(0, caster, 0, 100, 0, 0, 0, 50).splash?.radiusSub).toBe(
      caster.splash?.radiusSub,
    );
  });
});

describe('in battle', () => {
  const board = buildReferenceBoard('poor', content, mapgen);

  function start(a: readonly TeamModifier[], b: readonly TeamModifier[] = []) {
    let ta = board;
    for (const m of a) ta = withModifier(ta, m);
    let tb = board;
    for (const m of b) tb = withModifier(tb, m);
    return startArenaBattle(ta, tb, 4, content, simConfig);
  }

  test('a golem spawns with the extra armor, kept for its lifetime; others have no field', () => {
    const s = start([stone]);
    const golem = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_golem',
      x: 2,
      y: 20,
    });
    expect(golem.armor).toBe((content.units.get('unit_golem')?.armor ?? 0) + 1);
    const soldier = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 4,
      y: 20,
    });
    expect('armor' in soldier).toBe(false);
    const theirs = spawnUnitForTest(s.sim, s.ctx, {
      side: 1,
      def: 'unit_golem',
      x: 8,
      y: 20,
    });
    expect('armor' in theirs).toBe(false);
    s.sim.teams[0] = withModifier(s.sim.teams[0], stone);
    expect(golem.armor).toBe((content.units.get('unit_golem')?.armor ?? 0) + 1);
  });

  test('Stone skin: a soldier hit on the golem drops by one more', () => {
    const hurt = (mods: readonly TeamModifier[]) => {
      const s = start(mods);
      const golem = spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_golem',
        x: 2,
        y: 20,
      });
      spawnUnitForTest(s.sim, s.ctx, {
        side: 1,
        def: 'unit_soldier',
        x: 2,
        y: 19,
      });
      for (let t = 0; t < 60 && golem.hp === golem.maxHp; t++) {
        stepArena(s.sim, s.ctx);
      }
      return golem.maxHp - golem.hp;
    };
    // A soldier hits for 6: 6 less 3 armor, and 6 less 4 with Stone skin.
    expect(hurt([])).toBe(3);
    expect(hurt([stone])).toBe(2);
  });

  test('Wide arcs: a caster spawns with the raised splash percent', () => {
    const s = start([wide]);
    const caster = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_caster',
      x: 2,
      y: 20,
    });
    const base = content.units.get('unit_caster')?.splash?.percent ?? 0;
    expect(caster.splashPercent).toBe(Math.floor((base * 150) / 100));
    const other = spawnUnitForTest(s.sim, s.ctx, {
      side: 0,
      def: 'unit_soldier',
      x: 4,
      y: 20,
    });
    expect('splashPercent' in other).toBe(false);
  });

  test('Wide arcs: the secondary targets take the raised percent', () => {
    const second = (mods: readonly TeamModifier[]) => {
      const s = start(mods);
      spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_caster',
        x: 2,
        y: 17,
      });
      spawnUnitForTest(s.sim, s.ctx, {
        side: 1,
        def: 'unit_golem',
        x: 2,
        y: 20,
      });
      spawnUnitForTest(s.sim, s.ctx, {
        side: 1,
        def: 'unit_soldier',
        x: 3,
        y: 20,
      });
      for (let t = 0; t < 60; t++) stepArena(s.sim, s.ctx);
      const sp = s.events.find((e) => e.type === 'splash');
      return sp?.type === 'splash' ? sp.targets[0]?.damage : undefined;
    };
    const base = second([]);
    const raised = second([wide]);
    expect(base).toBeDefined();
    expect(raised).toBeGreaterThan(base ?? 0);
  });
});

describe('Claimstakers: capture', () => {
  const W = 12;
  const BOARD = 16;
  const GAP = 7;
  const MID = BOARD + 3;
  const CAP = content.points.capture;

  function team(x: number, mods: readonly TeamModifier[]) {
    const lab = new Lab({
      width: W,
      height: BOARD,
      partySize: 1,
      plotWidth: W,
      features: [],
      nodes: [],
    });
    lab.core(x, 0);
    let t = lab.state;
    for (const m of mods) t = withModifier(t, m);
    return t;
  }

  function scene(mods: readonly TeamModifier[]) {
    const s = startArenaBattle(
      team(1, mods),
      team(10, []),
      GAP,
      content,
      simConfig,
    );
    const posts: GuardPost[] = [{ id: 0, x: 3, y: MID }];
    placeGuards(s.sim, s.ctx, {
      capture: CAP,
      leashCells: 3,
      posts,
      plans: [],
    });
    return s;
  }

  const captured = (evs: readonly ArenaEvent[]) =>
    evs.filter((e) => e.type === 'point_captured');

  test('a unit takes the point in captureTicksFor ticks; the progress per tick is unchanged', () => {
    for (const [mods, need] of [
      [[], CAP.captureTicks],
      [[claim], captureTicksFor(CAP.captureTicks, 50)],
      [[claim, claim], captureTicksFor(CAP.captureTicks, 100)],
    ] as const) {
      const s = scene(mods);
      spawnUnitForTest(s.sim, s.ctx, {
        side: 0,
        def: 'unit_soldier',
        x: 3,
        y: MID,
      });
      let first = -1;
      for (let t = 0; t < 80 && first < 0; t++) {
        stepArena(s.sim, s.ctx);
        first = captured(s.events)[0]?.tick ?? -1;
      }
      const started = s.events.find((e) => e.type === 'point_capture_started');
      expect(first - (started?.tick ?? 0)).toBe(need - 1);
    }
    expect(captureTicksFor(CAP.captureTicks, 50)).toBeLessThan(
      CAP.captureTicks,
    );
  });

  test('it speeds the holder only: the other side keeps captureTicks', () => {
    const s = scene([claim]);
    spawnUnitForTest(s.sim, s.ctx, {
      side: 1,
      def: 'unit_soldier',
      x: 3,
      y: MID,
    });
    for (let t = 0; t < CAP.captureTicks + 5; t++) stepArena(s.sim, s.ctx);
    const e = captured(s.events)[0];
    const started = s.events.find((x) => x.type === 'point_capture_started');
    expect(e?.type === 'point_captured' ? e.side : -1).toBe(1);
    expect((e?.tick ?? 0) - (started?.tick ?? 0)).toBe(CAP.captureTicks - 1);
  });

  test('the tie rules are unchanged: contested points do not progress', () => {
    const s = scene([claim]);
    for (const side of [0, 1]) {
      spawnUnitForTest(s.sim, s.ctx, {
        side,
        def: 'unit_soldier',
        x: 3 + side,
        y: MID,
      });
    }
    for (let t = 0; t < 120; t++) stepArena(s.sim, s.ctx);
    expect(captured(s.events).length).toBe(0);
    expect(s.sim.points?.[0]?.progress).toBe(0);
  });
});
