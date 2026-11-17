import { renderNeutralZoneAscii } from './ascii-render.js';
import { describe, expect, test } from 'vitest';
import { hashJson } from './hash.js';
import {
  NEUTRAL_ZONE_STREAM,
  generateNeutralZone,
  generateNeutralZoneWithStats,
  neutralZoneProblem,
  zoneBlockedCells,
  type NeutralZone,
} from './neutral-zone.js';
import { loadMapgen } from './mapgen.js';
import mapgenJson from '../../../content/mapgen.json';
import { loadPoints, loadPointsOrThrow } from './points.js';
import { Rng } from './rng.js';
import { content, mapgen } from './testing/support.js';

const W = mapgen.plotWidth;

describe('neutral zone generation', () => {
  test('has the documented format', () => {
    const z = generateNeutralZone(7, W, content, mapgen);
    expect(Object.keys(z).sort()).toEqual([
      'depth',
      'features',
      'pointsOfInterest',
      'width',
    ]);
    expect(z.width).toBe(W);
    expect(z.depth).toBe(mapgen.neutralZone.depth);
    expect(JSON.parse(JSON.stringify(z))).toEqual(z);
    for (const f of z.features) {
      expect([mapgen.lakes.feature, mapgen.cliffs.feature]).toContain(
        f.feature,
      );
    }
  });

  test('derives only from the battle seed and the width', () => {
    for (const plots of [1, 2, 3, 4]) {
      const a = generateNeutralZone(99, plots * W, content, mapgen);
      const b = generateNeutralZone(99, plots * W, content, mapgen);
      expect(hashJson(a as never)).toBe(hashJson(b as never));
    }
    // Different seeds give different zones (not all equal over 30 seeds).
    const hashes = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      hashes.add(hashJson(generateNeutralZone(seed, W, content, mapgen)));
    }
    expect(hashes.size).toBeGreaterThan(10);
  });

  test('uses the documented stream and draw order', () => {
    // The first attempt: counts come from the first draws of the attempt's
    // "lakes" and "cliffs" children.
    const attempt = Rng.fromSeed(5).child(NEUTRAL_ZONE_STREAM).child(0);
    const lakes = 0 + attempt.child('lakes').nextInt(2);
    const cliffs = 0 + attempt.child('cliffs').nextInt(2);
    const z = generateNeutralZoneWithStats(5, W, content, mapgen);
    expect(z.attempts).toBe(1);
    const lakeCells = z.zone.features.filter(
      (f) => f.feature === mapgen.lakes.feature,
    ).length;
    const cliffCells = z.zone.features.filter(
      (f) => f.feature === mapgen.cliffs.feature,
    ).length;
    expect(lakeCells > 0).toBe(lakes > 0);
    expect(cliffCells > 0).toBe(cliffs > 0);
  });

  test('every zone of 500 seeds and widths 1 to 4 meets the constraints', () => {
    const attempts: number[] = [];
    let withLakes = 0;
    let withCliffs = 0;
    for (let seed = 1; seed <= 500; seed++) {
      for (let plots = 1; plots <= 4; plots++) {
        const { zone, attempts: n } = generateNeutralZoneWithStats(
          seed,
          plots * W,
          content,
          mapgen,
        );
        attempts.push(n);
        expect(neutralZoneProblem(zone, content), `seed ${String(seed)}`).toBe(
          undefined,
        );
        for (const f of zone.features) {
          expect(f.y).toBeGreaterThan(0);
          expect(f.y).toBeLessThan(zone.depth - 1);
          expect(f.x).toBeGreaterThan(0);
          expect(f.x).toBeLessThan(zone.width - 1);
        }
        const ys = zone.features.map((f) => f.y * zone.width + f.x);
        expect([...ys].sort((p, q) => p - q)).toEqual(ys);
        expect(new Set(ys).size).toBe(ys.length);
        if (zone.features.some((f) => f.feature === mapgen.lakes.feature)) {
          withLakes++;
        }
        if (zone.features.some((f) => f.feature === mapgen.cliffs.feature)) {
          withCliffs++;
        }
        // At most `plots` lakes of at most sizeMax cells and `plots` cliffs
        // of at most lengthMax cells (adjacent features may merge visually).
        const lake = zone.features.filter(
          (f) => f.feature === mapgen.lakes.feature,
        ).length;
        const cliff = zone.features.filter(
          (f) => f.feature === mapgen.cliffs.feature,
        ).length;
        expect(lake).toBeLessThanOrEqual(
          plots * mapgen.neutralZone.lakes.sizeMax,
        );
        expect(cliff).toBeLessThanOrEqual(
          plots * mapgen.neutralZone.cliffs.lengthMax,
        );
      }
    }
    const total = attempts.length;
    const mean = attempts.reduce((a, b) => a + b, 0) / total;
    expect(Math.max(...attempts)).toBeLessThan(mapgen.neutralZone.maxAttempts);
    // Reported in the rules reference: typical seeds need one attempt.
    expect(mean).toBeLessThan(1.5);
    expect(withLakes).toBeGreaterThan(total / 4);
    expect(withCliffs).toBeGreaterThan(total / 4);
  });

  test('wider fronts get proportionally more features', () => {
    const cells = (plots: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 200; seed++) {
        sum += generateNeutralZone(seed, plots * W, content, mapgen).features
          .length;
      }
      return sum;
    };
    const one = cells(1);
    const four = cells(4);
    expect(four).toBeGreaterThan(3 * one);
    expect(four).toBeLessThan(5 * one);
  });

  test('a width below a plot counts as one plot; bad widths throw', () => {
    expect(() => generateNeutralZone(1, 12, content, mapgen)).not.toThrow();
    expect(() => generateNeutralZone(1, 0, content, mapgen)).toThrow(
      RangeError,
    );
    expect(() => generateNeutralZone(1, 2.5, content, mapgen)).toThrow(
      RangeError,
    );
  });

  test('a zone with no room for features is empty', () => {
    const flat = loadMapgen(
      {
        ...(mapgenJson as Record<string, unknown>),
        neutralZone: {
          ...mapgenJson.neutralZone,
          depth: 1,
        },
      },
      { terrain: content.terrain },
    );
    if (!flat.ok) throw new Error(flat.errors.join());
    const z = generateNeutralZone(3, 48, content, flat.config);
    expect(z.features).toEqual([]);
    expect(z.depth).toBe(1);
    expect(z.pointsOfInterest).toEqual([]);
  });

  test('retries and gives up with a clear error', () => {
    // Lakes that always fill the whole usable region disconnect nothing, but
    // an impossible placement (huge lake) makes every attempt fail.
    const cfg = loadMapgen(
      {
        ...(mapgenJson as Record<string, unknown>),
        neutralZone: {
          ...mapgenJson.neutralZone,
          lakes: {
            countMinPerPlot: 1,
            countMaxPerPlot: 1,
            sizeMin: 500,
            sizeMax: 500,
          },
          maxAttempts: 3,
        },
      },
      { terrain: content.terrain },
    );
    if (!cfg.ok) throw new Error(cfg.errors.join());
    expect(() => generateNeutralZone(1, W, content, cfg.config)).toThrow(
      /no valid zone.*after 3 attempts/,
    );
  });

  test('blocked cells are arena cells of the gap rows', () => {
    const z: NeutralZone = {
      width: 6,
      depth: 4,
      features: [
        { x: 2, y: 1, feature: 'ter_lake' },
        { x: 3, y: 2, feature: 'ter_cliff' },
      ],
      pointsOfInterest: [],
    };
    expect(zoneBlockedCells(z, 16, content)).toEqual([
      { x: 2, y: 17 },
      { x: 3, y: 18 },
    ]);
  });

  test('neutralZoneProblem finds each violation', () => {
    const base: NeutralZone = {
      width: 6,
      depth: 5,
      features: [],
      pointsOfInterest: [],
    };
    const lake = (x: number, y: number) => ({ x, y, feature: 'ter_lake' });
    const problem = (features: NeutralZone['features']): string | undefined =>
      neutralZoneProblem({ ...base, features }, content);
    expect(problem([])).toBeUndefined();
    expect(problem([lake(2, 0)])).toMatch(/front-edge row/);
    expect(problem([lake(2, 4)])).toMatch(/front-edge row/);
    expect(problem([lake(0, 2)])).toMatch(/edge column/);
    expect(problem([lake(5, 2)])).toMatch(/edge column/);
    expect(problem([lake(9, 2)])).toMatch(/outside/);
    expect(problem([{ x: 2, y: 2, feature: 'ter_nope' }])).toMatch(/unknown/);
    expect(problem([lake(3, 2), lake(2, 2)])).toMatch(/sorted/);
    // A full wall across the middle rows seals it.
    expect(
      problem([lake(1, 2), lake(2, 2), lake(3, 2), lake(4, 2)]),
    ).toBeUndefined(); // rows 0 and 1 and 3, 4 are still connected through x=0
    const sealed: NeutralZone = {
      width: 3,
      depth: 5,
      features: [lake(1, 1), lake(1, 2), lake(1, 3)],
      pointsOfInterest: [],
    };
    expect(neutralZoneProblem(sealed, content)).toBeUndefined();
    // A pocket: (2,2) enclosed by lakes at (1,2)... needs width 5.
    const pocket: NeutralZone = {
      width: 5,
      depth: 5,
      features: [lake(2, 1), lake(1, 2), lake(3, 2), lake(2, 3)],
      pointsOfInterest: [],
    };
    expect(neutralZoneProblem(pocket, content)).toMatch(/not connected/);
  });

  test('ASCII rendering puts side 0 first', () => {
    const z: NeutralZone = {
      width: 5,
      depth: 3,
      features: [
        { x: 1, y: 1, feature: 'ter_lake' },
        { x: 2, y: 1, feature: 'ter_cliff' },
      ],
      pointsOfInterest: [{ id: 0, band: 0, x: 4, y: 1, buff: 'poi_heal' }],
    };
    expect(renderNeutralZoneAscii(z, 'ter_lake', 'ter_cliff')).toBe(
      '.....\n.~#.*\n.....',
    );
  });

  test('depth must be odd', () => {
    const even = loadMapgen(
      {
        ...(mapgenJson as Record<string, unknown>),
        neutralZone: { ...mapgenJson.neutralZone, depth: 6 },
      },
      { terrain: content.terrain },
    );
    expect(even.ok).toBe(false);
    if (!even.ok) expect(even.errors.join()).toMatch(/depth.*odd/);
  });
});

const BAND_SEEDS = 500;

const GUARDS = {
  baseBudget: 44,
  growthPercent: 125,
  maxGuardsPerPoint: 5,
  leashCells: 3,
  units: [{ unit: 'unit_soldier', cost: 10, weight: 1 }],
};

const CAPTURE = {
  captureTicks: 50,
  maxCapturersCounted: 3,
  captureRadiusCells: 2,
  pointAggroRangeCells: 3,
};

function withPoints(chancePercent: number, bandMarginCells = 2) {
  return {
    ...content,
    points: loadPointsOrThrow({
      chancePercent,
      bandMarginCells,
      buffs: [
        { id: 'poi_strength', kind: 'unit_strength', weight: 1 },
        { id: 'poi_heal', kind: 'heal', weight: 1 },
      ],
      guards: GUARDS,
      capture: CAPTURE,
    }),
  };
}

describe('points of interest (CB-8d)', () => {
  const middle = (mapgen.neutralZone.depth - 1) / 2;

  test('are on the middle row, in their band, on open cells with open neighbours', () => {
    let total = 0;
    for (let plots = 1; plots <= 4; plots++) {
      for (let seed = 1; seed <= BAND_SEEDS; seed++) {
        const z = generateNeutralZone(seed, plots * W, content, mapgen);
        const blocked = new Set(z.features.map((f) => f.y * z.width + f.x));
        const bands = new Set<number>();
        z.pointsOfInterest.forEach((p, i) => {
          const at = `seed ${String(seed)}, ${String(plots)} plots, point ${String(i)}`;
          total++;
          expect(p.id, at).toBe(i);
          expect(p.y, at).toBe(middle);
          expect(p.band, at).toBeGreaterThanOrEqual(0);
          expect(p.band, at).toBeLessThan(plots);
          expect(bands.has(p.band), `${at}: two in a band`).toBe(false);
          bands.add(p.band);
          if (i > 0) {
            expect(p.band, at).toBeGreaterThan(
              (z.pointsOfInterest[i - 1] as { band: number }).band,
            );
          }
          expect(p.x, at).toBeGreaterThanOrEqual(p.band * W + 2);
          expect(p.x, at).toBeLessThanOrEqual((p.band + 1) * W - 1 - 2);
          expect(['poi_strength', 'poi_heal'], at).toContain(p.buff);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              expect(
                blocked.has((p.y + dy) * z.width + p.x + dx),
                `${at}: neighbour (${String(dx)}, ${String(dy)}) blocked`,
              ).toBe(false);
            }
          }
        });
        expect(
          neutralZoneProblem(z, content),
          `seed ${String(seed)}, ${String(plots)} plots`,
        ).toBeUndefined();
      }
    }
    // 60% of 10 bands per seed over 500 seeds, less failed placements.
    expect(total).toBeGreaterThan(BAND_SEEDS * 4);
  });

  test('lakes, cliffs and attempts do not depend on the points', () => {
    for (const plots of [1, 2, 3, 4]) {
      for (let seed = 1; seed <= BAND_SEEDS; seed++) {
        const base = generateNeutralZoneWithStats(
          seed,
          plots * W,
          withPoints(0),
          mapgen,
        );
        for (const chance of [60, 100]) {
          const other = generateNeutralZoneWithStats(
            seed,
            plots * W,
            withPoints(chance, 3),
            mapgen,
          );
          expect(other.zone.features).toEqual(base.zone.features);
          expect(other.attempts).toBe(base.attempts);
        }
      }
    }
  });

  test('chance 0 gives none; chance 100 gives one per band unless placement fails', () => {
    let full = 0;
    let zones = 0;
    for (let plots = 1; plots <= 4; plots++) {
      for (let seed = 1; seed <= 200; seed++) {
        const none = generateNeutralZone(
          seed,
          plots * W,
          withPoints(0),
          mapgen,
        );
        expect(none.pointsOfInterest).toEqual([]);
        const all = generateNeutralZone(
          seed,
          plots * W,
          withPoints(100),
          mapgen,
        );
        expect(all.pointsOfInterest.length).toBeLessThanOrEqual(plots);
        zones++;
        if (all.pointsOfInterest.length === plots) full++;
      }
    }
    // Placement almost always works: 30 tries in a band of 20 columns.
    expect(full).toBeGreaterThan(zones * 0.9);
  });

  test('a margin that leaves two columns still gives at most one point', () => {
    // Columns 11 and 12 only; a failed placement never fails the zone.
    const tight = withPoints(100, 11);
    const z = generateNeutralZone(5, W, tight, mapgen);
    expect(z.pointsOfInterest.length).toBeLessThanOrEqual(1);
  });

  test('a point on a blocked cell or an unknown buff is a problem', () => {
    const z: NeutralZone = {
      width: 8,
      depth: 3,
      features: [{ x: 3, y: 1, feature: 'ter_lake' }],
      pointsOfInterest: [{ id: 0, band: 0, x: 3, y: 1, buff: 'poi_heal' }],
    };
    expect(neutralZoneProblem(z, content)).toMatch(/blocked cell/);
    const bad = {
      ...z,
      features: [],
      pointsOfInterest: [{ id: 0, band: 0, x: 3, y: 1, buff: 'poi_nope' }],
    };
    expect(neutralZoneProblem(bad, content)).toMatch(/unknown buff/);
  });
});

describe('points content', () => {
  test('is validated', () => {
    const ok = {
      chancePercent: 60,
      bandMarginCells: 2,
      buffs: [{ id: 'poi_a', kind: 'heal', weight: 1 }],
      guards: GUARDS,
      capture: CAPTURE,
    };
    expect(loadPoints(ok).ok).toBe(true);
    for (const bad of [
      { ...ok, chancePercent: 101 },
      { ...ok, bandMarginCells: -1 },
      { ...ok, buffs: [] },
      { ...ok, buffs: [{ id: 'poi_a', kind: 'fly', weight: 1 }] },
      { ...ok, buffs: [{ id: 'a', kind: 'heal', weight: 1 }] },
      { ...ok, buffs: [{ id: 'poi_a', kind: 'heal', weight: 0 }] },
      {
        ...ok,
        buffs: [
          { id: 'poi_a', kind: 'heal', weight: 1 },
          { id: 'poi_a', kind: 'heal', weight: 1 },
        ],
      },
      { ...ok, extra: 1 },
      { ...ok, capture: { ...CAPTURE, captureTicks: 0 } },
      { ...ok, capture: { ...CAPTURE, maxCapturersCounted: 0 } },
      { ...ok, capture: { ...CAPTURE, captureRadiusCells: 9 } },
      { ...ok, capture: { ...CAPTURE, pointAggroRangeCells: 0 } },
      { ...ok, capture: { ...CAPTURE, extra: 1 } },
      { ...ok, capture: undefined },
    ]) {
      expect(loadPoints(bad).ok).toBe(false);
    }
    expect(loadPoints(ok, { plotWidth: 4 }).ok).toBe(false);
    expect(loadPoints(ok, { plotWidth: 5 }).ok).toBe(true);
  });
});
