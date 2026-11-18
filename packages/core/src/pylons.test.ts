import { describe, expect, test } from 'vitest';
import economyJson from '../../../content/economy.json';
import threatsJson from '../../../content/threats.json';
import { computeField, goalBuildings, standingPylons } from './arena-paths.js';
import {
  createArenaContext,
  createArenaSim,
  spawnUnitForTest,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import {
  loadEconomy,
  loadEconomyOrThrow,
  type EconomyConfig,
} from './economy.js';
import { buyOffer, rollOffers, type PlayerShop } from './shop.js';
import { coreFootprint } from './map.js';
import { Rng } from './rng.js';
import { threatSideOptions } from './pve-battle.js';
import {
  buildStronghold,
  generateThreat,
  threatSummary,
} from './threat-gen.js';
import { placePylons, pylonSector, type Occupier } from './threat-pylons.js';
import { loadThreats } from './threats.js';
import {
  Lab,
  board,
  content,
  got,
  mapgen,
  simConfig,
  threats,
} from './testing/support.js';
import { createTeamState, type TeamState } from './team-state.js';

const GAP = 7;
const ctxOf = { units: content.units, buildings: content.buildings };
const pylonsArch = got(
  threats.archetypes.find((a) => a.id === 'arch_boss_pylons'),
);

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(threatsJson)) as Record<string, unknown>;
}

function errorsOf(edit: (a: Record<string, unknown>) => void): string {
  const data = clone();
  const list = data['archetypes'] as Record<string, unknown>[];
  edit(got(list.find((a) => a['id'] === 'arch_boss_pylons')));
  const r = loadThreats(data, ctxOf);
  return r.ok ? '' : r.errors.join('\n');
}

const make = (partySize: number, round = 9, seed = 7) =>
  generateThreat(
    {
      seed,
      round,
      type: 'boss',
      partySize,
      archetype: 'arch_boss_pylons',
    },
    content,
    { threats, mapgen },
  );

describe('the pylon building and the shop (MM-9d)', () => {
  const pylon = got(content.buildings.get('bld_pylon'));

  test('bld_pylon is a 1x1 defense of type pylon', () => {
    expect(pylon.kind).toBe('defense');
    expect(pylon.kind === 'defense' && pylon.defenseType).toBe('pylon');
    expect(pylon.footprint).toMatchObject({ width: 1, height: 1 });
  });

  test('no offerWeights entry and the economy loader refuses one', () => {
    for (const w of economyJson.offerWeights)
      expect(w.def).not.toBe('bld_pylon');
    const bad = JSON.parse(JSON.stringify(economyJson)) as typeof economyJson;
    bad.offerWeights.push({ def: 'bld_pylon', weight: 1, fromRound: 1 });
    const r = loadEconomy(bad, { buildings: content.buildings });
    expect(r.ok ? '' : r.errors.join()).toMatch(/boss-only pylon/);
    const kit = JSON.parse(JSON.stringify(economyJson)) as typeof economyJson;
    kit.startingKit.push({ def: 'bld_pylon', tier: 1, count: 1 });
    const r2 = loadEconomy(kit, { buildings: content.buildings });
    expect(r2.ok ? '' : r2.errors.join()).toMatch(/boss-only pylon/);
  });

  test('the shop refuses to roll or sell a pylon', () => {
    const economy: EconomyConfig = {
      ...loadEconomyOrThrow(economyJson, { buildings: content.buildings }),
      offerWeights: [{ def: 'bld_pylon', weight: 1, fromRound: 1 }],
    };
    expect(() => rollOffers(Rng.fromSeed(1), 1, content, economy)).toThrow(
      /boss-only/,
    );
    const shop: PlayerShop = {
      gold: 100,
      offers: [{ slot: 0, def: 'bld_pylon', tier: 1, price: 0 }],
    };
    const team = createTeamState(board([], 24, 1));
    const bought = buyOffer(shop, team, content, { slot: 0, owner: 0 });
    expect(bought).toMatchObject({ ok: false, reason: 'no_such_offer' });
  });
});

describe('pylons content (MM-9d)', () => {
  test('the shipped archetype', () => {
    expect(pylonsArch).toMatchObject({
      bossOnly: true,
      fromRound: 7,
      minPartySize: 1,
      pylons: { perPlot: 3, sharePercent: 10, minDistance: 2, maxDistance: 4 },
    });
    for (const a of threats.archetypes) {
      if (a !== pylonsArch) expect('pylons' in a).toBe(false);
    }
  });

  test('the loader checks the bounds and the combinations', () => {
    expect(errorsOf(() => undefined)).toBe('');
    const set = (k: string, v: unknown) => (a: Record<string, unknown>) => {
      (a['pylons'] as Record<string, unknown>)[k] = v;
    };
    expect(errorsOf(set('perPlot', 9))).toMatch(/"perPlot" must be at most 8/);
    expect(errorsOf(set('perPlot', 0))).toMatch(/perPlot/);
    expect(errorsOf(set('sharePercent', 61))).toMatch(
      /"sharePercent" must be at most 60/,
    );
    expect(errorsOf(set('maxDistance', 9))).toMatch(
      /"maxDistance" must be at most 8/,
    );
    expect(errorsOf(set('minDistance', 5))).toMatch(
      /"minDistance" must be at most "maxDistance"/,
    );
    expect(errorsOf(set('extra', 1))).toMatch(/extra/);
    expect(
      errorsOf((a) => {
        a['brood'] = { thresholdsPercent: [50], sharePercent: 10 };
      }),
    ).toMatch(/cannot be combined with "brood"/);
    expect(
      errorsOf((a) => {
        a['linkedCores'] = true;
        a['minPartySize'] = 2;
      }),
    ).toMatch(/cannot be combined with "linkedCores"/);
    const data = clone();
    const first = (data['archetypes'] as Record<string, unknown>[])[0] ?? {};
    (data['archetypes'] as Record<string, unknown>[])[0] = {
      ...first,
      pylons: { perPlot: 1, sharePercent: 1, minDistance: 1, maxDistance: 1 },
    };
    const r = loadThreats(data, ctxOf);
    expect(r.ok ? '' : r.errors.join()).toMatch(
      /"pylons" is only allowed when "bossOnly" is true/,
    );
  });
});

describe('pylon layout and budget (MM-9d)', () => {
  const fp = coreFootprint(content.buildings);

  test('perPlot pylons per Core at distance 2 to 4, never on the front row or on a building, in their own plot', () => {
    for (const size of [1, 2, 3, 4]) {
      for (const round of [7, 12, 30]) {
        for (const seed of [1, 7, 99]) {
          const p = make(size, round, seed);
          const pylons = got(p.stronghold.pylons);
          expect(pylons).toHaveLength(3 * size);
          const taken = new Set(
            p.stronghold.buildings.map((b) => `${String(b.x)},${String(b.y)}`),
          );
          const seen = new Set<string>();
          for (const q of pylons) {
            const plot = Math.floor(q.x / mapgen.plotWidth);
            expect(q.core).toBe(plot);
            const core = got(p.stronghold.cores[q.core]);
            const dx = Math.max(core.x - q.x, 0, q.x - (core.x + fp.width - 1));
            const dy = Math.max(
              core.y - q.y,
              0,
              q.y - (core.y + fp.height - 1),
            );
            const d = Math.max(dx, dy);
            expect(d).toBeGreaterThanOrEqual(2);
            expect(d).toBeLessThanOrEqual(4);
            expect(q.y).toBeLessThanOrEqual(mapgen.plotDepth - 2);
            const key = `${String(q.x)},${String(q.y)}`;
            expect(taken.has(key)).toBe(false);
            expect(seen.has(key)).toBe(false);
            seen.add(key);
            expect(q.health).toBeGreaterThanOrEqual(1);
          }
          // Sorted by (y, x); three per Core.
          const sorted = [...pylons].sort((a, b) => a.y - b.y || a.x - b.x);
          expect(pylons).toEqual(sorted);
          for (let c = 0; c < size; c++) {
            expect(pylons.filter((q) => q.core === c)).toHaveLength(3);
          }
        }
      }
    }
  });

  test('the pylons of one Core stand in different sectors', () => {
    const p = make(1, 9);
    const core = got(p.stronghold.cores[0]);
    const cx2 = 2 * core.x + fp.width - 1;
    const cy2 = 2 * core.y + fp.height - 1;
    const sectors = got(p.stronghold.pylons).map((q) =>
      pylonSector(2 * q.x - cx2, 2 * q.y - cy2, 3),
    );
    expect(new Set(sectors).size).toBe(3);
  });

  test('pylonSector walks clockwise round the Core from its back-left corner', () => {
    // Half-side 2 (m = 2): 16 positions, 4 sectors of 4.
    expect(pylonSector(-2, -2, 4)).toBe(0);
    expect(pylonSector(0, -2, 4)).toBe(0);
    expect(pylonSector(2, -2, 4)).toBe(1);
    expect(pylonSector(2, 0, 4)).toBe(1);
    expect(pylonSector(2, 2, 4)).toBe(2);
    expect(pylonSector(-2, 2, 4)).toBe(3);
    expect(pylonSector(-2, 0, 4)).toBe(3);
  });

  test('the budget: sharePercent of S is split over the pylons, the rest goes on as before', () => {
    for (const [size, round] of [
      [1, 9],
      [2, 20],
      [4, 40],
    ] as const) {
      const p = make(size, round);
      const full =
        p.budget - Math.floor((p.budget * pylonsArch.waveSharePercent) / 100);
      const share = Math.floor((full * 10) / 100);
      const pylons = got(p.stronghold.pylons);
      const total = pylons.reduce((a, q) => a + q.health, 0);
      const n = pylons.length;
      expect(total).toBe(Math.max(share, n));
      // Evenly: within one of each other, the larger first (share rounding).
      const min = Math.min(...pylons.map((q) => q.health));
      const max = Math.max(...pylons.map((q) => q.health));
      expect(max - min).toBeLessThanOrEqual(1);
      pylons.forEach((q, i) => {
        expect(q.health).toBe(
          Math.max(
            1,
            Math.floor(share / n) +
              (i < share - Math.floor(share / n) * n ? 1 : 0),
          ),
        );
      });
      // Walls and turrets and Core health come from the remaining budget.
      const rest = full - share;
      const walls = p.stronghold.buildings.filter(
        (b) => content.buildings.get(b.def)?.kind === 'defense',
      );
      const spent = walls.reduce(
        (a, b) =>
          a +
          (got(content.buildings.get(b.def)).tiers[0] as { price: number })
            .price,
        0,
      );
      expect(threatSummary(p, content).coreHealth).toBe(
        Math.max(
          threats.minCoreHealth * size,
          Math.floor(
            ((rest - spent) * pylonsArch.stronghold.coreHealthPerBudget) / 100,
          ),
        ),
      );
    }
  });

  test('every other archetype has no pylons, and the waves match the Boss', () => {
    for (const a of threats.archetypes) {
      if (a === pylonsArch) continue;
      const p = generateThreat(
        {
          seed: 7,
          round: 9,
          type: 'boss',
          partySize: Math.max(2, a.minPartySize ?? 1),
          archetype: a.id,
        },
        content,
        { threats, mapgen },
      );
      expect('pylons' in p.stronghold).toBe(false);
    }
    const boss = generateThreat(
      { seed: 7, round: 9, type: 'boss', partySize: 2, archetype: 'arch_boss' },
      content,
      { threats, mapgen },
    );
    expect(make(2).waves).toEqual(boss.waves);
  });

  test('the stronghold builds with the pylons after the buildings, owned by their plot', () => {
    const p = make(3, 12);
    const state = buildStronghold(p, content, mapgen);
    const n = p.stronghold.buildings.length;
    got(p.stronghold.pylons).forEach((q, i) => {
      const b = got(state.buildings.find((x) => x.id === n + 1 + i));
      expect(b).toMatchObject({
        def: 'bld_pylon',
        x: q.x,
        y: q.y,
        owner: q.core,
      });
    });
    expect(threatSideOptions(p).pylons).toEqual(
      got(p.stronghold.pylons).map((q, i) => ({
        building: n + 1 + i,
        core: q.core,
        health: q.health,
      })),
    );
  });

  test('a candidate that would seal the Core is refused (the movement field decides)', () => {
    // A 3x3 Core at (4, 3) in a 12 x 10 plot, walled in at distance 1 except
    // for one gap cell south of it: the gap is the only cell at distance 1.
    const wall = (x: number, y: number): Occupier => ({
      cells: [{ x, y }],
      core: -1,
      defenseType: 'wall',
    });
    const fixed: Occupier[] = [
      {
        cells: Array.from({ length: 9 }, (_, i) => ({
          x: 4 + (i % 3),
          y: 3 + Math.floor(i / 3),
        })),
        core: 0,
        defenseType: null,
      },
    ];
    for (let x = 3; x <= 7; x++) {
      for (let y = 2; y <= 6; y++) {
        const ring = x === 3 || x === 7 || y === 2 || y === 6;
        if (ring && !(x === 5 && y === 6)) fixed.push(wall(x, y));
      }
    }
    const board = {
      plotWidth: 12,
      partySize: 1,
      depth: 10,
      coreWidth: 3,
      coreHeight: 3,
    };
    const rng = (): Rng => Rng.fromSeed(1);
    const cfg = {
      perPlot: 1,
      sharePercent: 25,
      minDistance: 1,
      maxDistance: 1,
    };
    expect(placePylons(board, cfg, [{ x: 4, y: 3 }], fixed, rng)).toEqual([]);
    // With distance up to 2 there is room outside the ring.
    const wider = { ...cfg, maxDistance: 2 };
    expect(
      placePylons(board, wider, [{ x: 4, y: 3 }], fixed, rng),
    ).toHaveLength(1);
  });

  test('a pylon never seals the Core: a front-row cell still reaches it', () => {
    /** Whether some front-row cell has a route to the Core of plot `core`. */
    const reaches = (state: TeamState, core: number): boolean => {
      const sim = createArenaSim(
        state,
        createTeamState({ ...state.map, features: [], nodes: [] }),
        0,
        content,
        simConfig,
      );
      const arena = createArenaContext(sim, content, simConfig).arena;
      const field = computeField(arena, 1, core);
      const w = arena.geom.width;
      const y = mapgen.plotDepth - 1;
      return Array.from({ length: w }, (_, x) => x).some(
        (x) => (field.dist[y * w + x] ?? -1) >= 0,
      );
    };
    for (const size of [1, 2, 4]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const p = make(size, 14, seed);
        const without = {
          ...p,
          stronghold: { ...p.stronghold, pylons: [] },
        };
        const state = buildStronghold(p, content, mapgen);
        const open = buildStronghold(without, content, mapgen);
        for (let q = 0; q < size; q++) {
          if (reaches(open, q)) expect(reaches(state, q)).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The arena

/** Side 1: one Core and `pylons` (cells), side 0: an empty board of its size. */
function start(pylonCells: [number, number][], healths: number[] = [60]) {
  const lab = new Lab(board([], 24, 1));
  lab.core(11, 0, 0);
  const ids = pylonCells.map(([x, y]) => lab.put('bld_pylon', x, y));
  const party = new Lab(board([], 24, 1));
  party.core(11, 0, 0);
  const sim = createArenaSim(party.state, lab.state, GAP, content, simConfig, {
    sideOptions: [
      null,
      {
        coreHealths: [500],
        pylons: ids.map((building, i) => ({
          building,
          core: 0,
          health: healths[i] ?? 60,
        })),
      },
    ],
  });
  const events: ArenaEvent[] = [];
  const ctx = createArenaContext(sim, content, simConfig, { events });
  return { sim, ctx, events, ids };
}

const hpOf = (sim: ArenaSim, side: number, building: number): number =>
  got(
    sim.health.find(
      (h) => 'building' in h && h.side === side && h.building === building,
    ),
  ).hp;
const coreHp = (sim: ArenaSim, side: number): number =>
  got(sim.health.find((h) => 'core' in h && h.side === side)).hp;

describe('pylons in the arena (MM-9d)', () => {
  test('a pylon starts at the health of the side options, not its tier', () => {
    const { sim, ids } = start([[5, 3]], [37]);
    expect(hpOf(sim, 1, got(ids[0]))).toBe(37);
  });

  test('the goal set is the standing pylons while any stands, the Core after', () => {
    const { ctx, ids } = start([
      [5, 3],
      [18, 5],
    ]);
    // Side 0 units head for side 1's Core 0.
    const goals = goalBuildings(ctx.arena, 0, 0);
    expect(goals.map((g) => g.id)).toEqual(ids);
    expect(standingPylons(ctx.arena, 1, 0)).toHaveLength(2);
    for (const g of goals) g.alive = false;
    expect(goalBuildings(ctx.arena, 0, 0).map((g) => g.kind)).toEqual(['core']);
  });

  test('the party shoots the nearest pylon first, the Core takes nothing until the last one falls', () => {
    const { sim, ctx, events, ids } = start(
      [
        [4, 4],
        [19, 4],
      ],
      [40, 40],
    );
    for (const x of [3, 4, 5]) {
      spawnUnitForTest(sim, ctx, {
        side: 0,
        def: 'unit_soldier',
        x,
        y: 7,
        owner: 0,
        target: 0,
      });
    }
    let down = -1;
    let sawCoreHit = false;
    for (let t = 0; t < 1500 && down < 0; t++) {
      stepArena(sim, ctx);
      const shield = events.find((e) => e.type === 'core_shield_down');
      if (shield) down = shield.tick;
      else if (coreHp(sim, 1) < 500) sawCoreHit = true;
      // Nothing even aimed at the Core while a pylon stood.
      if (down < 0) {
        expect(
          events.some(
            (e) => e.type === 'unit_attacked' && e.target.kind === 'core',
          ),
        ).toBe(false);
      }
    }
    expect(down).toBeGreaterThan(0);
    expect(sawCoreHit).toBe(false);
    expect(coreHp(sim, 1)).toBe(500);
    const kinds = events
      .filter((e) =>
        ['pylon_destroyed', 'core_shield_down', 'building_destroyed'].includes(
          e.type,
        ),
      )
      .map((e) => e.type);
    expect(kinds).toEqual([
      'building_destroyed',
      'pylon_destroyed',
      'building_destroyed',
      'pylon_destroyed',
      'core_shield_down',
    ]);
    const destroyed = events.filter((e) => e.type === 'pylon_destroyed');
    expect(destroyed.map((e) => 'standing' in e && e.standing)).toEqual([1, 0]);
    // The party stands nearer to the second pylon (side 1's board is turned).
    expect(destroyed.map((e) => 'building' in e && e.building)).toEqual([
      ids[1],
      ids[0],
    ]);
    // Afterwards the Core is the goal and takes the hits.
    for (let t = 0; t < 400 && coreHp(sim, 1) === 500; t++) stepArena(sim, ctx);
    expect(coreHp(sim, 1)).toBeLessThan(500);
  });

  test('the Overload decay is not blocked by the shield', () => {
    const { sim, ctx, events } = start([[5, 3]], [100000]);
    for (let t = 0; t <= simConfig.overloadStartTick; t++) stepArena(sim, ctx);
    expect(
      events.some((e) => e.type === 'overload_core_damage' && e.side === 1),
    ).toBe(true);
    expect(coreHp(sim, 1)).toBe(500 - simConfig.overloadCoreDamageStep);
    expect(events.some((e) => e.type === 'core_hit_blocked')).toBe(false);
  });

  test('an ordinary battle has no pylons', () => {
    const lab = new Lab(board([], 24, 1));
    lab.core(11, 0, 0);
    const sim = createArenaSim(lab.state, lab.state, GAP, content, simConfig);
    const ctx: ArenaContext = createArenaContext(sim, content, simConfig);
    expect(ctx.arena.pylons).toEqual([]);
  });
});
