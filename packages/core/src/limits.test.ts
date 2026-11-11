import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import simJson from '../../../content/sim.json';
import terrainJson from '../../../content/terrain.json';
import unitsJson from '../../../content/units.json';
import { toArena } from './arena.js';
import { computeBreach } from './arena-paths.js';
import { createArenaSim, startArenaBattle, unitStats } from './arena-sim.js';
import { loadBuildings } from './buildings.js';
import { loadAllContentOrThrow } from './content.js';
import {
  MAX_ARENA_CELLS,
  MAX_BREACH_BASE_COST,
  MAX_DAMAGE,
  MAX_HEALTH,
} from './limits.js';
import { loadSimConfig } from './sim-config.js';
import { loadUnits, loadUnitsOrThrow } from './units.js';
import { loadResourcesOrThrow } from './resources.js';
import { Lab, board, content, got, simConfig } from './test-support.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface RawBuilding {
  id: string;
  tiers: Record<string, number>[];
}

/** The shipped content with every wall tier set to `health`. */
function rawWith(health: number[]): {
  resources: unknown;
  terrain: unknown;
  units: unknown;
  buildings: unknown;
  presentation: unknown;
} {
  const buildings = clone(buildingsJson) as { buildings: RawBuilding[] };
  const wall = got(buildings.buildings.find((b) => b.id === 'bld_wall'));
  wall.tiers.forEach((t, i) => {
    t['health'] = got(health[i]);
  });
  return {
    resources: resourcesJson,
    terrain: terrainJson,
    units: unitsJson,
    buildings,
    presentation: presentationJson,
  };
}

const GAP = 4;
const geom = { width: 24, height: 36, boardHeight: 16, gapRows: GAP };

/** Side 1's Core at board (11, 0) with a one-wall-thick ring of walls. */
function ringedLab(variant: typeof content): {
  lab: Lab;
  walls: number[];
} {
  const lab = new Lab(board([]), variant);
  lab.core(11, 0);
  const walls: number[] = [];
  // The Core is 2 x 2 at (11..12, 0..1); every cell next to it is a wall.
  for (const [x, y] of [
    [10, 0],
    [10, 1],
    [13, 0],
    [13, 1],
    [11, 2],
    [12, 2],
  ] as const) {
    walls.push(lab.put('bld_wall', x, y, 0, 3));
  }
  return { lab, walls };
}

describe('bounds: the constants', () => {
  test('heap keys, distances and Core cross products stay safe integers', () => {
    const cell = MAX_BREACH_BASE_COST + MAX_HEALTH;
    const dist = MAX_ARENA_CELLS * cell;
    const key = (dist + cell) * MAX_ARENA_CELLS + MAX_ARENA_CELLS;
    expect(key).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(MAX_HEALTH * MAX_HEALTH).toBeLessThan(Number.MAX_SAFE_INTEGER);
    // Four shipped plots plus a neutral zone fit with room to spare.
    expect(4 * 24 * (2 * 16 + 7)).toBeLessThan(MAX_ARENA_CELLS);
  });
});

describe('bounds: loaders reject content above the cap', () => {
  const resources = loadResourcesOrThrow(resourcesJson);
  const units = loadUnitsOrThrow(unitsJson);

  test('a building tier health above the cap', () => {
    const b = clone(buildingsJson) as { buildings: RawBuilding[] };
    got(got(b.buildings.find((x) => x.id === 'bld_wall')).tiers[2])['health'] =
      3_000_000_000;
    const r = loadBuildings(b, { resources, units });
    if (r.ok) throw new Error('expected failure');
    expect(r.errors.join('\n')).toMatch(
      /bld_wall.*tiers\[2\]: "health" must be at most 10000000 \(got 3000000000\)/,
    );
  });

  test('a building tier health exactly at the cap loads', () => {
    const raw = rawWith([MAX_HEALTH, MAX_HEALTH, MAX_HEALTH]);
    expect(() => loadAllContentOrThrow(raw)).not.toThrow();
  });

  test('a turret damage above the cap', () => {
    const b = clone(buildingsJson) as { buildings: RawBuilding[] };
    got(got(b.buildings.find((x) => x.id === 'bld_turret')).tiers[0])[
      'damage'
    ] = MAX_DAMAGE + 1;
    const r = loadBuildings(b, { resources, units });
    if (r.ok) throw new Error('expected failure');
    expect(r.errors.join('\n')).toMatch(/"damage" must be at most 10000000/);
  });

  test('a unit health or damage above the cap', () => {
    const u = clone(unitsJson) as { units: Record<string, unknown>[] };
    got(u.units[0])['health'] = 2 ** 31;
    got(u.units[1])['damage'] = MAX_DAMAGE + 1;
    const r = loadUnits(u);
    if (r.ok) throw new Error('expected failure');
    const text = r.errors.join('\n');
    expect(text).toMatch(/"health" must be at most 10000000/);
    expect(text).toMatch(/"damage" must be at most 10000000/);
  });

  test('sim.json breach constants above the cap', () => {
    const s = { ...simJson, breachBaseCost: MAX_BREACH_BASE_COST + 1 };
    const r = loadSimConfig({ ...s, breachHealthPerCost: 2 ** 40 });
    if (r.ok) throw new Error('expected failure');
    const text = r.errors.join('\n');
    expect(text).toMatch(/"breachBaseCost" must be at most 1000000/);
    expect(text).toMatch(/"breachHealthPerCost" must be at most 1000000/);
  });
});

describe('bounds: breach costs with health near the cap', () => {
  test('ctx.maxHealth holds the exact tier health', () => {
    const variant = loadAllContentOrThrow(
      rawWith([MAX_HEALTH - 2, MAX_HEALTH - 1, MAX_HEALTH]),
    );
    const { lab, walls } = ringedLab(variant);
    const core = new Lab(board([]), variant);
    core.core(11, 0);
    const { ctx } = startArenaBattle(
      core.state,
      lab.state,
      GAP,
      variant,
      simConfig,
    );
    for (const id of walls) {
      const ref = got(ctx.arena.byId[1]?.get(id));
      expect(ctx.maxHealth[ref]).toBe(MAX_HEALTH);
    }
  });

  test('the breach cost of a wall at the cap is exact', () => {
    const variant = loadAllContentOrThrow(
      rawWith([MAX_HEALTH, MAX_HEALTH, MAX_HEALTH]),
    );
    const { lab } = ringedLab(variant);
    const core = new Lab(board([]), variant);
    core.core(11, 0);
    const { ctx } = startArenaBattle(
      core.state,
      lab.state,
      GAP,
      variant,
      simConfig,
    );
    const per = simConfig.breachHealthPerCost;
    const wall = simConfig.breachBaseCost + Math.ceil(MAX_HEALTH / per);
    const f = computeBreach(
      ctx.arena,
      0,
      (r) => ctx.maxHealth[r] ?? 0,
      simConfig.breachBaseCost,
      per,
    );
    const outside = toArena(geom, 1, { x: 11, y: 3 });
    expect(f[outside.y * 24 + outside.x]).toBe(wall);
    expect(wall).toBeGreaterThan(0);
  });

  test('distances past 2^31 are exact (Float64, no wrap, no overflow in keys)', () => {
    const { lab } = ringedLab(content);
    const core = new Lab(board([]));
    core.core(11, 0);
    const { ctx } = startArenaBattle(
      core.state,
      lab.state,
      GAP,
      content,
      simConfig,
    );
    const huge = 3_000_000_000; // above the content cap: only reachable here
    const f = computeBreach(ctx.arena, 0, () => huge, 10, 1);
    const outside = toArena(geom, 1, { x: 11, y: 3 });
    expect(f[outside.y * 24 + outside.x]).toBe(10 + huge);
    expect(f.every((v) => v >= -1)).toBe(true);
  });

  test('a cost sum beyond the safe range throws instead of wrapping', () => {
    const { lab } = ringedLab(content);
    const core = new Lab(board([]));
    core.core(11, 0);
    const { ctx } = startArenaBattle(
      core.state,
      lab.state,
      GAP,
      content,
      simConfig,
    );
    expect(() =>
      computeBreach(ctx.arena, 0, () => Number.MAX_SAFE_INTEGER, 10, 1),
    ).toThrow(RangeError);
  });
});

describe('bounds: run-time scaling is checked', () => {
  const soldier = got(content.units.get('unit_soldier'));

  test('unit strength that keeps health under the cap works', () => {
    const s = unitStats(0, soldier, 300);
    expect(s.health).toBe(Math.floor((soldier.health * 400) / 100));
  });

  test('unit strength past the cap throws a clear error', () => {
    expect(() => unitStats(0, soldier, 100_000_000)).toThrow(
      /unit_soldier: scaled health .* exceeds the maximum 10000000/,
    );
  });

  test('a Core health override above the cap or below 1 throws', () => {
    const a = new Lab(board([]));
    a.core(11, 0);
    const mk = (coreHealth: number): void => {
      createArenaSim(a.state, a.state, GAP, content, simConfig, {
        sideOptions: [null, { coreHealth }],
      });
    };
    expect(() => {
      mk(MAX_HEALTH + 1);
    }).toThrow(/coreHealth must be an integer from 1 to 10000000/);
    expect(() => {
      mk(0);
    }).toThrow(RangeError);
    expect(() => {
      mk(MAX_HEALTH);
    }).not.toThrow();
  });

  test('a huge unitStrengthPercent option fails when the battle is set up', () => {
    const a = new Lab(board([]));
    a.core(11, 0);
    expect(() =>
      startArenaBattle(a.state, a.state, GAP, content, simConfig, {
        sideOptions: [{ unitStrengthPercent: 1_000_000_000 }, null],
      }),
    ).toThrow(/exceeds the maximum/);
    // A strength that fits every unit type works.
    expect(() =>
      startArenaBattle(a.state, a.state, GAP, content, simConfig, {
        sideOptions: [{ unitStrengthPercent: 1000 }, null],
      }),
    ).not.toThrow();
  });
});
