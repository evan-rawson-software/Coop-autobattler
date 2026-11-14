/**
 * Tetromino walls (issue #291): footprint cell masks and their rotation, the
 * loader's mask checks, the shop's two-shape limit and the kit's `pick` entry.
 */
import { describe, expect, test } from 'vitest';
import economyJson from '../../../content/economy.json';
import resourcesJson from '../../../content/resources.json';
import unitsJson from '../../../content/units.json';
import { defBox, defCells } from './board-cells.js';
import {
  loadBuildings,
  rotateBuilding,
  rotateFootprint,
  type BuildingDef,
  type Footprint,
  type Rotation,
} from './buildings.js';
import { loadEconomy, loadEconomyOrThrow, kitChoices } from './economy.js';
import { loadResourcesOrThrow } from './resources.js';
import { Rng } from './rng.js';
import { MAX_WALL_SHAPES_PER_SHOP, rollOffers } from './shop.js';
import { loadUnitsOrThrow } from './units.js';
import { board, content, Lab } from './testing/support.js';
import { addToStash, placeFromStash } from './team-state.js';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const SHAPES = ['i', 'o', 't', 's', 'z', 'l', 'j'] as const;

function def(id: string): BuildingDef {
  const d = content.buildings.get(id);
  if (d === undefined) throw new Error(`no ${id}`);
  return d;
}

/** Cells as an ASCII picture, north (highest y) on top. */
function picture(fp: Footprint): string {
  const cells = new Set(
    (fp.cells ?? []).map((c) => `${String(c.x)},${String(c.y)}`),
  );
  const full = fp.cells === undefined;
  const rows: string[] = [];
  for (let y = fp.height - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < fp.width; x++) {
      row += full || cells.has(`${String(x)},${String(y)}`) ? '#' : '.';
    }
    rows.push(row);
  }
  return rows.join('/');
}

describe('shape content', () => {
  test('seven wall shapes with four cells, one price and health table', () => {
    for (const s of SHAPES) {
      const d = def(`bld_wall_${s}`);
      expect(d.kind).toBe('defense');
      if (d.kind !== 'defense') continue;
      expect(d.defenseType).toBe('wall');
      expect(
        d.footprint.cells?.length ?? d.footprint.width * d.footprint.height,
      ).toBe(4);
      expect(d.tiers.map((t) => t.health)).toEqual([250, 400, 600]);
      expect(d.tiers.map((t) => t.price)).toEqual([8, 18, 36]);
    }
    expect(content.buildings.get('bld_wall')).toBeUndefined();
  });

  test('the shapes look like their letters (north on top)', () => {
    expect(picture(def('bld_wall_i').footprint)).toBe('####');
    expect(picture(def('bld_wall_o').footprint)).toBe('##/##');
    expect(picture(def('bld_wall_t').footprint)).toBe('###/.#.');
    expect(picture(def('bld_wall_s').footprint)).toBe('.##/##.');
    expect(picture(def('bld_wall_z').footprint)).toBe('##./.##');
    expect(picture(def('bld_wall_l').footprint)).toBe('#./#./##');
    expect(picture(def('bld_wall_j').footprint)).toBe('.#/.#/##');
  });
});

describe('rotating a mask', () => {
  test('T turns clockwise through its four orientations', () => {
    const fp = def('bld_wall_t').footprint;
    const at = (r: Rotation): string => picture(rotateFootprint(fp, r));
    expect(at(0)).toBe('###/.#.');
    expect(at(90)).toBe('.#/##/.#');
    expect(at(180)).toBe('.#./###');
    expect(at(270)).toBe('#./##/#.');
  });

  test('S and L turn clockwise and stay normalised to the box corner', () => {
    const s = def('bld_wall_s').footprint;
    expect(picture(rotateFootprint(s, 90))).toBe('#./##/.#');
    expect(picture(rotateFootprint(s, 180))).toBe('.##/##.');
    expect(picture(rotateFootprint(s, 270))).toBe('#./##/.#');
    const l = def('bld_wall_l').footprint;
    expect(picture(rotateFootprint(l, 90))).toBe('###/#..');
    expect(picture(rotateFootprint(l, 180))).toBe('##/.#/.#');
    expect(picture(rotateFootprint(l, 270))).toBe('..#/###');
    for (const fp of [s, l]) {
      for (const r of ROTATIONS) {
        const rot = rotateFootprint(fp, r);
        const cells = rot.cells ?? [];
        expect(Math.min(...cells.map((c) => c.x))).toBe(0);
        expect(Math.min(...cells.map((c) => c.y))).toBe(0);
        expect(Math.max(...cells.map((c) => c.x))).toBe(rot.width - 1);
        expect(Math.max(...cells.map((c) => c.y))).toBe(rot.height - 1);
        expect(cells).toHaveLength(4);
      }
    }
  });

  test('four quarter turns are the identity', () => {
    for (const s of SHAPES) {
      const fp = def(`bld_wall_${s}`).footprint;
      let cur = fp;
      for (let i = 0; i < 4; i++) cur = rotateFootprint(cur, 90);
      expect(picture(cur)).toBe(picture(fp));
    }
  });

  test('O keeps its footprint at every rotation and has no mask', () => {
    const o = def('bld_wall_o');
    for (const r of ROTATIONS) {
      expect(rotateBuilding(o, r).footprint).toEqual({ width: 2, height: 2 });
    }
  });

  test('a footprint without a mask rotates as before', () => {
    const wide = {
      footprint: { width: 3, height: 1 },
      inputs: [],
      outputs: [],
    };
    expect(rotateBuilding(wide, 90).footprint).toEqual({ width: 1, height: 3 });
    expect(rotateBuilding(wide, 180).footprint).toEqual({
      width: 3,
      height: 1,
    });
  });
});

describe('defCells (footCells) and the bounding box', () => {
  test('lists the mask cells at the position, in (y, x) order', () => {
    const t = def('bld_wall_t');
    expect(defCells(t, 5, 7, 0)).toEqual([
      { x: 6, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 8 },
      { x: 7, y: 8 },
    ]);
    expect(defCells(t, 5, 7, 90)).toEqual([
      { x: 6, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 8 },
      { x: 6, y: 9 },
    ]);
    expect(defBox(t, 5, 7, 90)).toEqual({ x: 5, y: 7, w: 2, h: 3 });
  });

  test('I covers its whole box; O covers 2 x 2', () => {
    expect(defCells(def('bld_wall_i'), 0, 0, 90)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
    ]);
    expect(defCells(def('bld_wall_o'), 3, 3, 0)).toHaveLength(4);
  });
});

describe('loading a cell mask', () => {
  const ctx = {
    resources: loadResourcesOrThrow(resourcesJson),
    units: loadUnitsOrThrow(unitsJson),
  };
  const wall = (footprint: unknown): Record<string, unknown> => ({
    id: 'bld_w',
    kind: 'defense',
    defenseType: 'wall',
    footprint,
    inputs: [],
    outputs: [],
    tiers: [
      { health: 1, price: 1 },
      { health: 2, price: 2 },
      { health: 3, price: 3 },
    ],
  });
  const errors = (footprint: unknown): string => {
    const r = loadBuildings({ buildings: [wall(footprint)] }, ctx);
    return r.ok ? '' : r.errors.join('\n');
  };

  test('a good mask loads, sorted by (y, x)', () => {
    const r = loadBuildings(
      {
        buildings: [
          wall({
            width: 2,
            height: 2,
            cells: [
              [1, 1],
              [0, 0],
              [1, 0],
            ],
          }),
        ],
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.get('bld_w')?.footprint.cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  test('rejects cells outside the box', () => {
    expect(
      errors({
        width: 2,
        height: 1,
        cells: [
          [0, 0],
          [2, 0],
        ],
      }),
    ).toContain('outside');
    expect(
      errors({
        width: 2,
        height: 1,
        cells: [
          [0, 0],
          [1, -1],
        ],
      }),
    ).toContain('outside');
  });

  test('rejects duplicates, an empty or malformed list', () => {
    expect(
      errors({
        width: 2,
        height: 1,
        cells: [
          [0, 0],
          [0, 0],
          [1, 0],
        ],
      }),
    ).toContain('duplicate');
    expect(errors({ width: 1, height: 1, cells: [] })).toContain('non-empty');
    expect(errors({ width: 1, height: 1, cells: [[0]] })).toContain(
      '[x, y] pair',
    );
    expect(errors({ width: 1, height: 1, cells: 'x' })).toContain('non-empty');
  });

  test('rejects a mask that is not connected', () => {
    expect(
      errors({
        width: 3,
        height: 2,
        cells: [
          [0, 0],
          [1, 0],
          [2, 1],
        ],
      }),
    ).toContain('4-connected');
    // Two cells touching only at a corner.
    expect(
      errors({
        width: 2,
        height: 2,
        cells: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toContain('4-connected');
  });

  test('rejects a box with an unused row or column', () => {
    expect(
      errors({
        width: 3,
        height: 1,
        cells: [
          [0, 0],
          [1, 0],
        ],
      }),
    ).toContain('every row and column');
    expect(errors({ width: 1, height: 2, cells: [[0, 0]] })).toContain(
      'every row and column',
    );
  });

  test('rejects an unknown footprint field', () => {
    expect(errors({ width: 1, height: 1, mask: [] })).toContain(
      'unknown field',
    );
  });
});

describe('the shop shows at most two different wall shapes', () => {
  const economy = loadEconomyOrThrow(economyJson, {
    buildings: content.buildings,
  });
  const isWall = (id: string): boolean => /^bld_wall_[a-z]$/.test(id);

  test('across many rolls no set holds a third shape (gate is not a wall shape)', () => {
    expect(MAX_WALL_SHAPES_PER_SHOP).toBe(2);
    // A wall-heavy economy makes the limit bind often.
    const heavy = {
      ...economy,
      offerWeights: economy.offerWeights.map((w) => ({
        ...w,
        weight: isWall(w.def) ? 40 : 1,
      })),
    };
    let redraws = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const offers = rollOffers(Rng.fromSeed(seed), 3, content, heavy);
      const shapes = new Set(offers.map((o) => o.def).filter(isWall));
      expect(shapes.size).toBeLessThanOrEqual(2);
      if (shapes.size === 2) redraws++;
    }
    expect(redraws).toBeGreaterThan(50);
    for (let seed = 1; seed <= 300; seed++) {
      const shapes = new Set(
        rollOffers(Rng.fromSeed(seed), 3, content, economy)
          .map((o) => o.def)
          .filter(isWall),
      );
      expect(shapes.size).toBeLessThanOrEqual(2);
    }
  });

  test('the redraw is one extra draw over the weights without the new shapes', () => {
    // Replay the documented algorithm by hand against the same stream.
    const heavy = {
      ...economy,
      offerWeights: economy.offerWeights.map((w) => ({
        ...w,
        weight: isWall(w.def) ? 40 : 1,
      })),
    };
    for (let seed = 1; seed <= 40; seed++) {
      const mirror = Rng.fromSeed(seed);
      const expected: string[] = [];
      const seen = new Set<string>();
      for (let slot = 0; slot < heavy.shopOfferCount; slot++) {
        const all = heavy.offerWeights;
        // Pick by cumulative weight, as pickWeightedIndex does.
        let pick: (typeof all)[number] | undefined;
        const total = all.reduce((a, w) => a + w.weight, 0);
        const r = mirror.nextInt(total);
        let acc = 0;
        pick = all.find((w) => (acc += w.weight) > r);
        if (pick === undefined) throw new Error('no pick');
        if (isWall(pick.def) && !seen.has(pick.def) && seen.size >= 2) {
          const allowed = all.filter((w) => !isWall(w.def) || seen.has(w.def));
          const t2 = allowed.reduce((a, w) => a + w.weight, 0);
          const r2 = mirror.nextInt(t2);
          let acc2 = 0;
          pick = allowed.find((w) => (acc2 += w.weight) > r2);
          if (pick === undefined) throw new Error('no pick');
        }
        if (isWall(pick.def)) seen.add(pick.def);
        expected.push(pick.def);
        mirror.nextInt(100); // the tier draw (round 1 odds: weights sum to 100)
      }
      const got = rollOffers(Rng.fromSeed(seed), 1, content, heavy).map(
        (o) => o.def,
      );
      expect(got).toEqual(expected);
    }
  });

  test('every shape is offered with the shipped weights; I is rarest', () => {
    const counts = new Map<string, number>();
    const rng = Rng.fromSeed(77);
    for (let n = 0; n < 3000; n++) {
      for (const o of rollOffers(rng, 1, content, economy)) {
        counts.set(o.def, (counts.get(o.def) ?? 0) + 1);
      }
    }
    for (const s of SHAPES)
      expect(counts.get(`bld_wall_${s}`) ?? 0).toBeGreaterThan(0);
    const i = counts.get('bld_wall_i') ?? 0;
    for (const s of ['o', 't', 's', 'z', 'l', 'j']) {
      expect(counts.get(`bld_wall_${s}`) ?? 0).toBeGreaterThan(i);
    }
  });
});

describe('kit entries with pick', () => {
  const ctx = { buildings: content.buildings };
  const kitErrors = (entry: unknown): string => {
    const d = JSON.parse(JSON.stringify(economyJson)) as {
      startingKit: unknown[];
    };
    d.startingKit = [entry];
    const r = loadEconomy(d, ctx);
    return r.ok ? '' : r.errors.join('\n');
  };

  test('the shipped kit has a pick of the six non-I shapes', () => {
    const economy = loadEconomyOrThrow(economyJson, ctx);
    const wallEntry = economy.startingKit.find((k) => k.pick !== undefined);
    expect(wallEntry?.count).toBe(3);
    expect(wallEntry?.tier).toBe(1);
    expect(kitChoices(wallEntry ?? { tier: 1, count: 1 })).toEqual([
      'bld_wall_o',
      'bld_wall_t',
      'bld_wall_s',
      'bld_wall_z',
      'bld_wall_l',
      'bld_wall_j',
    ]);
  });

  test('rejects both def and pick, an empty pick, unknown or repeated ids', () => {
    expect(
      kitErrors({ def: 'bld_wall_o', pick: ['bld_wall_t'], tier: 1, count: 1 }),
    ).toContain('not both');
    expect(kitErrors({ pick: [], tier: 1, count: 1 })).toContain('non-empty');
    expect(kitErrors({ pick: ['bld_nope'], tier: 1, count: 1 })).toContain(
      'unknown building',
    );
    expect(
      kitErrors({ pick: ['bld_wall_o', 'bld_wall_o'], tier: 1, count: 1 }),
    ).toContain('twice');
    expect(kitErrors({ tier: 1, count: 1 })).toContain('def');
    expect(kitErrors({ pick: ['bld_wall_o'], tier: 1, count: 1 })).toBe('');
  });
});

describe('placing masked walls', () => {
  const place = (lab: Lab, id: string, x: number, y: number, r: Rotation) => {
    const s = addToStash(lab.state, content, { def: id, tier: 1, owner: 0 });
    if (!s.ok) throw new Error(s.reason);
    return placeFromStash(s.state, content, {
      actor: 0,
      id: s.id,
      x,
      y,
      rotation: r,
    });
  };

  test('a cell inside the bounding box but outside the mask is free', () => {
    const lab = new Lab(board([]));
    lab.put('bld_wall_l', 5, 2);
    // L covers (5,2) (5,3) (5,4) (6,2); (6,3) is in its box, not in its mask.
    lab.put('bld_wall_block', 6, 3);
    const clash = place(lab, 'bld_wall_block', 6, 2, 0);
    expect(clash.ok ? 'ok' : clash.reason).toBe('overlaps_building');
  });

  test('two shapes can sit close, and a clash on one mask cell is refused', () => {
    const lab = new Lab(board([]));
    lab.put('bld_wall_t', 2, 2, 0);
    // A T turned 180 degrees nests its stem under the bar of the first one.
    lab.put('bld_wall_t', 3, 4, 180);
    const fits = place(lab, 'bld_wall_t', 3, 3, 0);
    expect(fits.ok ? 'ok' : fits.reason).toBe('overlaps_building');
  });

  test('the rotated bounding box must stay on the board', () => {
    const lab = new Lab(board([]));
    const r = place(lab, 'bld_wall_i', 3, 14, 90);
    expect(r.ok ? 'ok' : r.reason).toBe('out_of_bounds');
    expect(place(lab, 'bld_wall_i', 3, 12, 90).ok).toBe(true);
    const side = place(lab, 'bld_wall_i', 21, 5, 0);
    expect(side.ok ? 'ok' : side.reason).toBe('out_of_bounds');
  });
});
