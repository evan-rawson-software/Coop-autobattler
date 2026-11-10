import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import mapgenJson from '../../../content/mapgen.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import terrainJson from '../../../content/terrain.json';
import unitsJson from '../../../content/units.json';
import { loadAllContentOrThrow } from './content.js';
import { generateMap, generateMapWithStats } from './generate-map.js';
import {
  coreFootprint,
  listLegalCorePositions,
  loadMap,
  loadMapOrThrow,
  queryMap,
  renderMapAscii,
  validateCorePosition,
  type GameMap,
} from './map.js';
import { loadMapgen, loadMapgenOrThrow } from './mapgen.js';

const content = loadAllContentOrThrow({
  resources: resourcesJson,
  terrain: terrainJson,
  units: unitsJson,
  buildings: buildingsJson,
  presentation: presentationJson,
});
const config = loadMapgenOrThrow(mapgenJson, {
  terrain: content.terrain,
});

/** Seeds checked per party size by the property test. */
const PROPERTY_SEEDS = 300;

function nodesFor(rarity: 'common' | 'rare'): number {
  return rarity === 'rare'
    ? config.nodesPerPlot.rare
    : config.nodesPerPlot.common;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('generateMap properties', () => {
  test(`${String(PROPERTY_SEEDS)} seeds x every party size`, () => {
    const fpWidth = coreFootprint(content.buildings).width;
    const failures: string[] = [];
    let maxAttempts = 0;
    let totalAttempts = 0;
    let runs = 0;
    const nodesPerPlot = content.resources
      .listBase()
      .reduce((sum, r) => sum + nodesFor(r.rarity), 0);

    for (let partySize = 1; partySize <= config.maxPartySize; partySize++) {
      for (let seed = 1; seed <= PROPERTY_SEEDS; seed++) {
        const { map, attempts } = generateMapWithStats(
          seed,
          partySize,
          content,
          config,
        );
        maxAttempts = Math.max(maxAttempts, attempts);
        totalAttempts += attempts;
        runs++;
        const q = queryMap(map, content.terrain);
        const where = `seed ${String(seed)} party ${String(partySize)}`;
        const check = (ok: boolean, what: string): void => {
          if (!ok) failures.push(`${where}: ${what}`);
        };

        check(map.width === partySize * config.plotWidth, 'width');
        check(map.height === config.plotDepth, 'height');
        check(map.nodes.length === partySize * nodesPerPlot, 'node total');

        // Node counts per plot and per resource are exact.
        for (let p = 0; p < partySize; p++) {
          for (const res of content.resources.listBase()) {
            const got = map.nodes.filter(
              (n) => n.resource === res.id && q.plotOf(n.x) === p,
            ).length;
            check(got === nodesFor(res.rarity), `plot ${String(p)} ${res.id}`);
          }
        }
        // No adjacency, nodes never on features.
        for (const n of map.nodes) {
          check(q.featureAt(n.x, n.y) === undefined, 'node on feature');
          check(q.nodeAt(n.x + 1, n.y) === undefined, 'node adjacent (x)');
          check(q.nodeAt(n.x, n.y + 1) === undefined, 'node adjacent (y)');
        }
        // Buildable fraction per plot.
        for (let p = 0; p < partySize; p++) {
          let buildable = 0;
          for (let y = 0; y < map.height; y++) {
            for (let x = p * map.plotWidth; x < (p + 1) * map.plotWidth; x++) {
              if (q.isBuildable(x, y)) buildable++;
            }
          }
          check(
            buildable * 100 >=
              config.minBuildablePercent * map.plotWidth * map.height,
            `plot ${String(p)} buildable fraction`,
          );
        }
        // Front row walkable; features keep their margins (so none on the
        // side edges or the front row).
        for (let x = 0; x < map.width; x++) {
          check(q.isWalkable(x, map.height - 1), 'front row blocked');
        }
        for (const f of map.features) {
          check(
            f.x >= config.sideMargin &&
              f.x < map.width - config.sideMargin &&
              f.x > 0 &&
              f.x < map.width - 1 &&
              f.y >= config.backMargin &&
              f.y < map.height - config.frontMargin,
            'feature outside margins',
          );
        }
        // Everything walkable is reachable from the front row.
        const seen = new Set<number>();
        const stack: number[] = [];
        for (let x = 0; x < map.width; x++) {
          seen.add((map.height - 1) * map.width + x);
          stack.push((map.height - 1) * map.width + x);
        }
        for (let k = stack.pop(); k !== undefined; k = stack.pop()) {
          const x = k % map.width;
          const y = Math.floor(k / map.width);
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const nk = (y + dy) * map.width + x + dx;
            if (q.isWalkable(x + dx, y + dy) && !seen.has(nk)) {
              seen.add(nk);
              stack.push(nk);
            }
          }
        }
        let walkable = 0;
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            if (q.isWalkable(x, y)) walkable++;
          }
        }
        check(seen.size === walkable, 'walkable cell cut off');
        // Core positions.
        const legal = listLegalCorePositions(map, content, config);
        for (const pos of legal) {
          const r = validateCorePosition(map, content, config, pos);
          check(r.ok, 'listed core position fails validation');
        }
        for (let p = 0; p < partySize; p++) {
          check(
            legal.some(
              (pos) =>
                q.plotOf(pos.x) === p && q.plotOf(pos.x + fpWidth - 1) === p,
            ),
            `plot ${String(p)} has no core position`,
          );
        }
        // Round trip through the loader.
        check(
          JSON.stringify(loadMapOrThrow(clone(map), content)) ===
            JSON.stringify(map),
          'loader round trip',
        );
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    // Guards against runaway retries.
    expect(maxAttempts).toBeLessThan(config.maxAttempts);
    expect(totalAttempts / runs).toBeLessThan(2);
  });

  test('same seed and party size give the identical map', () => {
    expect(generateMap(5, 2, content, config)).toEqual(
      generateMap(5, 2, content, config),
    );
    expect(generateMap(5, 2, content, config)).not.toEqual(
      generateMap(6, 2, content, config),
    );
  });

  test('party sizes differ in width only', () => {
    for (let n = 1; n <= config.maxPartySize; n++) {
      const map = generateMap(9, n, content, config);
      expect(map.width).toBe(n * 24);
      expect(map.height).toBe(16);
      expect(map.partySize).toBe(n);
    }
  });

  test('rejects an invalid party size', () => {
    expect(() => generateMap(1, 0, content, config)).toThrow(RangeError);
    expect(() => generateMap(1, 5, content, config)).toThrow(RangeError);
  });
});

describe('configuration drives generation', () => {
  test('an alternate config changes the map with no code change', () => {
    const alt = loadMapgenOrThrow(
      {
        ...clone(mapgenJson as Record<string, unknown>),
        plotWidth: 30,
        plotDepth: 20,
        nodesPerPlot: { common: 2, rare: 2 },
        coreFrontClearance: 10,
      },
      { terrain: content.terrain },
    );
    const base = generateMap(1, 1, content, config);
    const changed = generateMap(1, 1, content, alt);
    expect(changed.width).toBe(30);
    expect(changed.height).toBe(20);
    expect(changed.nodes.length).toBe(2 * 2 + 2);
    expect(changed).not.toEqual(base);
  });

  test('an impossible config throws a clear error', () => {
    const impossible = loadMapgenOrThrow(
      {
        ...clone(mapgenJson as Record<string, unknown>),
        minBuildablePercent: 100,
        maxAttempts: 3,
      },
      { terrain: content.terrain },
    );
    expect(() => generateMap(1, 1, content, impossible)).toThrow(
      /after 3 attempts/,
    );
  });

  test('the loader rejects bad configuration', () => {
    const bad = loadMapgen(
      {
        ...clone(mapgenJson as Record<string, unknown>),
        lakes: {
          feature: 'ter_nope',
          countMin: 3,
          countMax: 1,
          sizeMin: 1,
          sizeMax: 2,
        },
        frontMargin: 0,
        extra: 1,
      },
      { terrain: content.terrain },
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const text = bad.errors.join('\n');
      expect(text).toMatch(/ter_nope/);
      expect(text).toMatch(/countMax/);
      expect(text).toMatch(/frontMargin/);
      expect(text).toMatch(/extra/);
    }
  });
});

describe('core positions', () => {
  const empty: GameMap = {
    width: 24,
    height: 16,
    partySize: 1,
    plotWidth: 24,
    features: [{ x: 5, y: 5, feature: 'ter_lake' }],
    nodes: [{ x: 8, y: 2, resource: 'res_a' }],
  };
  const reason = (x: number, y: number): unknown =>
    validateCorePosition(empty, content, config, { x, y });

  test('typed reasons', () => {
    expect(reason(0, 0)).toEqual({ ok: true });
    expect(reason(-1, 0)).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(reason(23, 0)).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(reason(4, 4)).toEqual({ ok: false, reason: 'blocked' });
    expect(reason(8, 1)).toEqual({ ok: false, reason: 'on_node' });
    expect(reason(0, 6)).toEqual({ ok: true });
    expect(reason(0, 7)).toEqual({ ok: false, reason: 'too_far_forward' });
  });

  test('back half only', () => {
    for (const pos of listLegalCorePositions(empty, content, config)) {
      expect(pos.y + 2).toBeLessThanOrEqual(8);
    }
  });
});

describe('queries and loader', () => {
  const map = generateMap(1, 1, content, config);
  const q = queryMap(map, content.terrain);

  test('query helpers', () => {
    const f = map.features[0];
    const n = map.nodes[0];
    if (f === undefined || n === undefined) throw new Error('empty map');
    expect(q.featureAt(f.x, f.y)).toBe(f.feature);
    expect(q.isBuildable(f.x, f.y)).toBe(false);
    expect(q.isWalkable(f.x, f.y)).toBe(false);
    expect(q.nodeAt(n.x, n.y)).toBe(n.resource);
    expect(q.isBuildable(n.x, n.y)).toBe(true);
    expect(q.isWalkable(n.x, n.y)).toBe(true);
    expect(q.isInBounds(-1, 0)).toBe(false);
    expect(q.isInBounds(24, 0)).toBe(false);
    expect(q.isInBounds(0, 15)).toBe(true);
    expect(q.isWalkable(-1, 0)).toBe(false);
    expect(q.plotOf(23)).toBe(0);
    expect(q.plotOf(24)).toBe(1);
  });

  test('loadMap re-checks structure', () => {
    const errorsOf = (data: unknown): string =>
      (() => {
        const r = loadMap(data, content);
        return r.ok ? '' : r.errors.join('\n');
      })();
    const base = clone(map) as unknown as Record<string, unknown>;
    const withFeatures = (features: unknown): unknown => ({
      ...base,
      features,
    });
    expect(loadMap(clone(map), content).ok).toBe(true);
    expect(
      errorsOf(withFeatures([{ x: 99, y: 0, feature: 'ter_lake' }])),
    ).toMatch(/outside the board/);
    expect(
      errorsOf(
        withFeatures([
          { x: 1, y: 1, feature: 'ter_lake' },
          { x: 1, y: 1, feature: 'ter_cliff' },
        ]),
      ),
    ).toMatch(/duplicate/);
    expect(
      errorsOf(withFeatures([{ x: 1, y: 1, feature: 'ter_nope' }])),
    ).toMatch(/unknown feature/);
    expect(
      errorsOf({ ...base, nodes: [{ x: 1, y: 1, resource: 'res_nope' }] }),
    ).toMatch(/unknown resource/);
    expect(
      errorsOf({
        ...base,
        features: [{ x: 1, y: 1, feature: 'ter_lake' }],
        nodes: [{ x: 1, y: 1, resource: 'res_a' }],
      }),
    ).toMatch(/on a feature cell/);
    expect(errorsOf({ ...base, width: 25 })).toMatch(/partySize/);
    expect(errorsOf([])).toMatch(/object/);
  });

  test('ASCII renderer prints the front row on top', () => {
    const text = renderMapAscii(map, content);
    const lines = text.split('\n');
    expect(lines.length).toBe(map.height + 1);
    expect(lines[0]).toBe('.'.repeat(map.width));
    expect(lines[0]?.length).toBe(map.width);
    expect(lines[map.height]).toMatch(/^legend: .*a=res_a b=res_b c=res_c/);
    const body = lines.slice(0, map.height).join('');
    expect(body.replace(/[^~#]/g, '').length).toBe(map.features.length);
    expect(body.replace(/[^abc]/g, '').length).toBe(map.nodes.length);
    // Back row is the last map line.
    const first = map.nodes[0];
    if (first === undefined) throw new Error('no nodes');
    const row = lines[map.height - 1 - first.y];
    expect(row?.[first.x]).toBe(
      'abc'[content.resources.list().findIndex((r) => r.id === first.resource)],
    );
  });
});
