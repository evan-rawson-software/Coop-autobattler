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
    expect(z.pointsOfInterest).toEqual([]);
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
          depth: 2,
        },
      },
      { terrain: content.terrain },
    );
    if (!flat.ok) throw new Error(flat.errors.join());
    const z = generateNeutralZone(3, 48, content, flat.config);
    expect(z.features).toEqual([]);
    expect(z.depth).toBe(2);
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
      width: 4,
      depth: 3,
      features: [
        { x: 1, y: 1, feature: 'ter_lake' },
        { x: 2, y: 1, feature: 'ter_cliff' },
      ],
      pointsOfInterest: [],
    };
    expect(renderNeutralZoneAscii(z, 'ter_lake', 'ter_cliff')).toBe(
      '....\n.~#.\n....',
    );
  });
});
