import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import simJson from '../../../content/sim.json';
import terrainJson from '../../../content/terrain.json';
import unitsJson from '../../../content/units.json';
import { toArena } from './arena.js';
import {
  breachCost,
  breachPassable,
  computeBreach,
  NEIGHBORS,
} from './arena-paths.js';
import { createArenaSim, startArenaBattle, unitStats } from './arena-sim.js';
import { loadBuildings } from './buildings.js';
import { loadAllContentOrThrow } from './content.js';
import {
  MAX_ARENA_CELLS,
  MAX_BREACH_BASE_COST,
  MAX_DAMAGE,
  MAX_HEALTH,
  MAX_HIT,
  MAX_TICK_DAMAGE,
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
  test('the huge caps and the breach distance stay safe integers', () => {
    expect(MAX_HEALTH).toBeGreaterThanOrEqual(1e12);
    expect(MAX_DAMAGE).toBeGreaterThanOrEqual(1e12);
    const cell = MAX_BREACH_BASE_COST + MAX_HEALTH;
    // A least-cost route enters each cell once; the heap forms no product.
    const dist = MAX_ARENA_CELLS * cell;
    expect(dist).toBeLessThan(Number.MAX_SAFE_INTEGER);
    // Damage sums: a saturated sum plus one more hit is exact.
    expect(MAX_TICK_DAMAGE + MAX_HIT).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(MAX_HIT).toBeGreaterThan(MAX_DAMAGE);
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
      3_000_000_000_000;
    const r = loadBuildings(b, { resources, units });
    if (r.ok) throw new Error('expected failure');
    expect(r.errors.join('\n')).toMatch(
      /bld_wall.*tiers\[2\]: "health" must be at most 1000000000000 \(got 3000000000000\)/,
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
    expect(r.errors.join('\n')).toMatch(
      /"damage" must be at most 1000000000000/,
    );
  });

  test('a unit health or damage above the cap', () => {
    const u = clone(unitsJson) as { units: Record<string, unknown>[] };
    got(u.units[0])['health'] = MAX_HEALTH + 1;
    got(u.units[1])['damage'] = MAX_DAMAGE + 1;
    const r = loadUnits(u);
    if (r.ok) throw new Error('expected failure');
    const text = r.errors.join('\n');
    expect(text).toMatch(/"health" must be at most 1000000000000/);
    expect(text).toMatch(/"damage" must be at most 1000000000000/);
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

  test('distances past 2^31 are exact (Float64, no wrap, no packed keys)', () => {
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

describe('bounds: the (distance, cell) heap', () => {
  /** A plain O(n^2) Dijkstra with the same cost rules, as the reference. */
  function reference(
    ctx: ReturnType<typeof startArenaBattle>['ctx'],
    hpOf: (ref: number) => number,
    base: number,
    per: number,
  ): number[] {
    const { width, height } = ctx.arena.geom;
    const n = width * height;
    const dist: number[] = new Array<number>(n).fill(-1);
    const done: boolean[] = new Array<boolean>(n).fill(false);
    const core = got(ctx.arena.buildings[ctx.arena.coreRef[1]?.[0] ?? -1]);
    for (const c of core.cells) {
      for (const [dx, dy] of NEIGHBORS) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const k = y * width + x;
        if (breachPassable(ctx.arena, 0, k)) dist[k] = 0;
      }
    }
    for (;;) {
      let best = -1;
      for (let k = 0; k < n; k++) {
        const d = dist[k] ?? -1;
        if (d < 0 || done[k] === true) continue;
        if (best < 0 || d < (dist[best] ?? 0)) best = k;
      }
      if (best < 0) break;
      done[best] = true;
      const through =
        (dist[best] ?? 0) + breachCost(ctx.arena, 0, best, hpOf, base, per);
      const x = best % width;
      const y = Math.floor(best / width);
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nk = ny * width + nx;
        if (!breachPassable(ctx.arena, 0, nk)) continue;
        const cur = dist[nk] ?? -1;
        if (cur === -1 || through < cur) dist[nk] = through;
      }
    }
    return dist;
  }

  test('matches a reference Dijkstra with many ties and costs near the cap', () => {
    let seed = 7;
    const next = (m: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed >>> 8) % m;
    };
    for (let round = 0; round < 12; round++) {
      const lab = new Lab(board([]));
      lab.core(11, 0);
      for (let i = 0; i < 40; i++) {
        const x = next(24);
        const y = 1 + next(15);
        try {
          lab.put('bld_wall', x, y, 0, 1);
        } catch {
          // The cell is taken or invalid: try another layout.
        }
      }
      const mine = new Lab(board([]));
      mine.core(11, 0);
      const { ctx } = startArenaBattle(
        mine.state,
        lab.state,
        GAP,
        content,
        simConfig,
      );
      // Costs: 0 and small values (ties everywhere) or up to MAX_HEALTH.
      const hp: number[] = ctx.arena.buildings.map(() => {
        const k = next(4);
        return k === 0 ? MAX_HEALTH : k === 1 ? 1 : k === 2 ? 2 : next(1000);
      });
      const hpOf = (r: number): number => hp[r] ?? 0;
      const per = round % 2 === 0 ? 1 : 3;
      const base = round % 3 === 0 ? 0 : 5;
      const f = computeBreach(ctx.arena, 0, hpOf, base, per);
      expect(Array.from(f)).toEqual(reference(ctx, hpOf, base, per));
    }
  });

  test('the longest possible route at the cap stays exact', () => {
    const lab = new Lab(board([]));
    lab.core(11, 0);
    const mine = new Lab(board([]));
    mine.core(11, 0);
    const { ctx } = startArenaBattle(
      mine.state,
      lab.state,
      GAP,
      content,
      simConfig,
    );
    // Every passable cell costs the maximum a cell can cost.
    const cell = MAX_BREACH_BASE_COST + MAX_HEALTH;
    const f = computeBreach(
      ctx.arena,
      0,
      () => MAX_HEALTH,
      MAX_BREACH_BASE_COST,
      1,
    );
    expect(Math.max(...f)).toBeLessThan(Number.MAX_SAFE_INTEGER);
    for (const v of f) expect(v === -1 || v % 1 === 0).toBe(true);
    expect(cell * MAX_ARENA_CELLS).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('bounds: run-time scaling is checked', () => {
  const soldier = got(content.units.get('unit_soldier'));

  test('unit strength that keeps health under the cap works', () => {
    const s = unitStats(0, soldier, 300);
    expect(s.health).toBe(Math.floor((soldier.health * 400) / 100));
  });

  test('unit strength past the cap throws a clear error', () => {
    expect(() => unitStats(0, soldier, 3_000_000_000_000)).toThrow(
      /unit_soldier: scaled health .* exceeds the maximum 1000000000000/,
    );
  });

  test('a Core health override above the cap or below 1 throws', () => {
    const a = new Lab(board([]));
    a.core(11, 0);
    const mk = (coreHealth: number): void => {
      createArenaSim(a.state, a.state, GAP, content, simConfig, {
        sideOptions: [null, { coreHealths: [coreHealth] }],
      });
    };
    expect(() => {
      mk(MAX_HEALTH + 1);
    }).toThrow(/coreHealths must be an integer from 1 to 1000000000000/);
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
        sideOptions: [{ unitStrengthPercent: 3_000_000_000_000 }, null],
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
