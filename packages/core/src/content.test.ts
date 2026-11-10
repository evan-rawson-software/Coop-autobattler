import { describe, expect, test } from 'vitest';
import buildingsJson from '../../../content/buildings.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import terrainJson from '../../../content/terrain.json';
import unitsJson from '../../../content/units.json';
import {
  loadBuildings,
  loadBuildingsOrThrow,
  oppositeSide,
  rotateBuilding,
  rotateSide,
  type BuildingConfig,
  type Rotation,
  type Side,
} from './buildings.js';
import { loadAllContent, loadAllContentOrThrow } from './content.js';
import { loadPresentation } from './presentation.js';
import { loadResourcesOrThrow } from './resources.js';
import { formatText } from './text.js';
import { loadTerrain, loadTerrainOrThrow } from './terrain.js';
import { loadUnits, loadUnitsOrThrow } from './units.js';

const raw = {
  resources: resourcesJson as unknown,
  terrain: terrainJson as unknown,
  units: unitsJson as unknown,
  buildings: buildingsJson as unknown,
  presentation: presentationJson as unknown,
};

const resources = loadResourcesOrThrow(raw.resources);
const units = loadUnitsOrThrow(raw.units);
const terrain = loadTerrainOrThrow(raw.terrain);
const ctx = { resources, units };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tiers3(extra: Record<string, number> = {}): unknown[] {
  return [1, 2, 3].map((n) => ({ health: 10 * n, price: n, ...extra }));
}

function building(overrides: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    id: 'bld_test',
    kind: 'route',
    routeType: 'splitter',
    footprint: { width: 1, height: 1 },
    inputs: [{ side: 'south' }],
    outputs: ['north', 'east'],
    tiers: tiers3(),
    ...overrides,
  };
  // An override of undefined means "leave this field out".
  return Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined),
  );
}

function errorsOf(...defs: Record<string, unknown>[]): string {
  const result = loadBuildings({ buildings: defs }, ctx);
  if (result.ok) throw new Error('expected failure');
  return result.errors.join('\n');
}

describe('real content', () => {
  test('loads everything through loadAllContent', () => {
    const content = loadAllContentOrThrow(raw);
    expect(content.buildings.list().length).toBe(10);
    expect(content.units.list().length).toBe(2);
    expect(content.terrain.list().length).toBe(2);
    const turret = content.buildings.get('bld_turret');
    expect(turret?.kind).toBe('defense');
    expect(content.presentation.get('bld_turret')?.name).toBe('Turret');
  });

  test('presentation placeholders resolve through the resource config', () => {
    const content = loadAllContentOrThrow(raw);
    const text = content.presentation.get('bld_barracks')?.description ?? '';
    expect(text).toContain('{res_a}');
    expect(formatText(text, content.resources)).toContain(
      content.resources.displayName('res_a'),
    );
  });

  test('every building has the right number of tiers', () => {
    const content = loadAllContentOrThrow(raw);
    for (const def of content.buildings.list()) {
      expect(def.tiers.length).toBe(def.kind === 'core' ? 1 : 3);
    }
  });

  test('loadAllContent reports errors with their file, in dependency order', () => {
    const bad = { ...raw, units: { units: [] }, terrain: { nope: 1 } };
    const result = loadAllContent(bad);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.startsWith('units: '))).toBe(true);
    expect(result.errors.some((e) => e.startsWith('terrain: '))).toBe(true);
    expect(result.errors.some((e) => e.startsWith('buildings: '))).toBe(false);

    const dangling = clone(raw);
    const list = (dangling.buildings as { buildings: { unit?: string }[] })
      .buildings;
    const producer = list.find((b) => b.unit !== undefined);
    if (producer) producer.unit = 'unit_nope';
    const result2 = loadAllContent(dangling);
    if (result2.ok) throw new Error('expected failure');
    expect(result2.errors.join('\n')).toMatch(/buildings: .*unit_nope/);
    expect(() => loadAllContentOrThrow(dangling)).toThrow(/Invalid content/);
  });
});

describe('loadTerrain', () => {
  test('rejects bad shapes and duplicates', () => {
    expect(loadTerrain(null).ok).toBe(false);
    const result = loadTerrain({
      features: [
        { id: 'ter_a', blocksBuilding: true, blocksMovement: true },
        { id: 'ter_a', blocksBuilding: true, blocksMovement: 'yes', extra: 1 },
        { id: 'lake', blocksBuilding: true, blocksMovement: true },
      ],
    });
    if (result.ok) throw new Error('expected failure');
    const text = result.errors.join('\n');
    expect(text).toMatch(/duplicate id "ter_a"/);
    expect(text).toMatch(/"blocksMovement" must be true or false/);
    expect(text).toMatch(/unknown field "extra"/);
    expect(text).toMatch(/id must match/);
  });

  test('exposes lookups', () => {
    expect(terrain.get('ter_lake')?.blocksMovement).toBe(true);
    expect(terrain.get('ter_x')).toBeUndefined();
  });
});

describe('loadUnits', () => {
  test('rejects bad numbers and targeting', () => {
    const base = clone((unitsJson as { units: object[] }).units[0]);
    const result = loadUnits({
      units: [
        { ...base, health: 0, damage: 1.5, targeting: 'everything' },
        { ...base, id: 'soldier' },
        base,
        base,
      ],
    });
    if (result.ok) throw new Error('expected failure');
    const text = result.errors.join('\n');
    expect(text).toMatch(/"health" must be an integer >= 1/);
    expect(text).toMatch(/"damage" must be an integer >= 0/);
    expect(text).toMatch(/unknown targeting "everything"/);
    expect(text).toMatch(/id must match/);
    expect(text).toMatch(/duplicate id/);
  });
});

describe('loadBuildings', () => {
  test('allows a building with two inputs of different resources', () => {
    const forge = building({
      id: 'bld_forge',
      kind: 'unit_producer',
      routeType: undefined,
      unit: 'unit_soldier',
      inputs: [
        { resource: 'res_a', side: 'south' },
        { resource: 'res_b', side: 'west' },
      ],
      outputs: [],
      tiers: tiers3({ costPerUnit: 3 }),
    });
    const config = loadBuildingsOrThrow({ buildings: [forge] }, ctx);
    expect(config.get('bld_forge')?.inputs.map((i) => i.resource)).toEqual([
      'res_a',
      'res_b',
    ]);
  });

  test('rejects unknown resource and unit IDs', () => {
    const text = errorsOf(
      building({
        id: 'bld_t',
        kind: 'defense',
        routeType: undefined,
        defenseType: 'turret',
        inputs: [{ resource: 'res_zzz', side: 'south' }],
        outputs: [],
        tiers: tiers3({
          damage: 1,
          rangeCells: 1,
          cooldownTicks: 1,
          costPerShot: 1,
        }),
      }),
      building({
        id: 'bld_p',
        kind: 'unit_producer',
        routeType: undefined,
        unit: 'unit_ghost',
        inputs: [{ resource: 'res_a', side: 'south' }],
        outputs: [],
        tiers: tiers3({ costPerUnit: 1 }),
      }),
    );
    expect(text).toMatch(/unknown resource ID "res_zzz"/);
    expect(text).toMatch(/unknown unit ID "unit_ghost"/);
    expect(text).not.toMatch(/must name a "resource"/);
  });

  test('rejects duplicate IDs and bad kinds', () => {
    const text = errorsOf(
      building({}),
      building({}),
      building({ id: 'bld_r', kind: 'refinery' }),
    );
    expect(text).toMatch(/duplicate id "bld_test"/);
    expect(text).toMatch(/unknown kind "refinery"/);
  });

  test('requires exactly three tiers, or one for the core', () => {
    expect(errorsOf(building({ tiers: tiers3().slice(0, 2) }))).toMatch(
      /exactly 3 tiers; found 2/,
    );
    expect(errorsOf(building({ tiers: [...tiers3(), tiers3()[0]] }))).toMatch(
      /exactly 3 tiers; found 4/,
    );
    const core = {
      id: 'bld_c',
      kind: 'core',
      footprint: { width: 2, height: 2 },
      inputs: [],
      outputs: [],
    };
    expect(
      errorsOf({ ...core, tiers: [{ health: 5 }, { health: 6 }] }),
    ).toMatch(/exactly 1 tier entry; found 2/);
    expect(errorsOf({ ...core, tiers: [{ health: 5, price: 3 }] })).toMatch(
      /field "price" is not valid/,
    );
    expect(
      loadBuildings({ buildings: [{ ...core, tiers: [{ health: 5 }] }] }, ctx)
        .ok,
    ).toBe(true);
  });

  test('rejects kind-specific fields missing or on the wrong kind', () => {
    expect(errorsOf(building({ routeType: undefined }))).toMatch(
      /needs "routeType"/,
    );
    expect(errorsOf(building({ unit: 'unit_soldier' }))).toMatch(
      /"unit" is only valid on kind "unit_producer", not "route"/,
    );
    expect(
      errorsOf(
        building({
          kind: 'source',
          inputs: [],
          outputs: ['north'],
          tiers: tiers3(),
        }),
      ),
    ).toMatch(/field "routeType" is only valid on kind "route"/);
    expect(errorsOf(building({ tiers: tiers3({ intervalTicks: 4 }) }))).toMatch(
      /field "intervalTicks" is not valid/,
    );
    expect(
      errorsOf(building({ tiers: tiers3().map(() => ({ health: 1 })) })),
    ).toMatch(/"price" must be an integer/);
  });

  test('rejects an input and an output on the same side', () => {
    expect(errorsOf(building({ outputs: ['south', 'east'] }))).toMatch(
      /south side is both an input and an output/,
    );
  });

  test('rejects duplicate sides and wrong resource naming', () => {
    expect(
      errorsOf(
        building({ inputs: [{ side: 'south' }], outputs: ['east', 'east'] }),
      ),
    ).toMatch(/more than one output on the east side/);
    expect(
      errorsOf(building({ inputs: [{ side: 'south', resource: 'res_a' }] })),
    ).toMatch(/must not name a "resource"/);
  });

  test('checks route buildings against their routeType', () => {
    expect(errorsOf(building({ outputs: ['north'] }))).toMatch(
      /splitter needs 2 to 3 outputs; found 1/,
    );
    expect(
      errorsOf(
        building({
          routeType: 'merger',
          inputs: [{ side: 'east' }],
          outputs: ['north'],
        }),
      ),
    ).toMatch(/merger needs 2 to 3 inputs; found 1/);
    const crossover = building({
      routeType: 'crossover',
      inputs: [{ side: 'south' }, { side: 'west' }],
      outputs: ['north', 'east'],
    });
    expect(loadBuildings({ buildings: [crossover] }, ctx).ok).toBe(true);
    expect(
      errorsOf(
        building({
          routeType: 'crossover',
          inputs: [{ side: 'south' }, { side: 'west' }],
          outputs: ['north', 'south'],
        }),
      ),
    ).toMatch(/south side is both an input and an output/);
  });

  test('walls, gates, and the core take no inputs or outputs', () => {
    const wall = building({
      kind: 'defense',
      routeType: undefined,
      defenseType: 'wall',
      inputs: [{ side: 'south' }],
      outputs: [],
    });
    expect(errorsOf(wall)).toMatch(/wall needs exactly 0 inputs; found 1/);
  });

  test('economy effects must be known and capped', () => {
    const econ = (effect: unknown, tiers: unknown[]): Record<string, unknown> =>
      building({
        kind: 'economy',
        routeType: undefined,
        effect,
        inputs: [{ resource: 'res_c', side: 'south' }],
        outputs: [],
        tiers,
      });
    const good = tiers3({ costPerStep: 1, stepPercent: 5, maxSteps: 3 });
    expect(
      loadBuildings({ buildings: [econ({ type: 'unit_strength' }, good)] }, ctx)
        .ok,
    ).toBe(true);
    expect(errorsOf(econ({ type: 'sparkle' }, good))).toMatch(/effect.type/);
    expect(
      errorsOf(
        econ(
          { type: 'source_speed' },
          tiers3({ costPerStep: 1, stepPercent: 5 }),
        ),
      ),
    ).toMatch(/"maxSteps" must be an integer/);
  });

  test('rejects non-integer footprints', () => {
    expect(
      errorsOf(building({ footprint: { width: 0, height: 1.5 } })),
    ).toMatch(/"width" must be an integer >= 1/);
  });
});

describe('rotation', () => {
  const config: BuildingConfig = loadBuildingsOrThrow(raw.buildings, ctx);
  const barracks = config.get('bld_barracks');
  const splitter = config.get('bld_splitter');
  if (!barracks || !splitter) throw new Error('missing test content');

  const sides: Side[] = ['north', 'east', 'south', 'west'];
  const rotations: Rotation[] = [0, 90, 180, 270];

  test('rotates sides clockwise', () => {
    expect(rotateSide('north', 90)).toBe('east');
    expect(rotateSide('east', 90)).toBe('south');
    expect(rotateSide('south', 90)).toBe('west');
    expect(rotateSide('west', 90)).toBe('north');
    expect(rotateSide('north', 180)).toBe('south');
    expect(rotateSide('north', 270)).toBe('west');
    expect(rotateSide('west', 270)).toBe('south');
    for (const side of sides) {
      expect(rotateSide(side, 0)).toBe(side);
      expect(oppositeSide(oppositeSide(side))).toBe(side);
    }
  });

  test('rejects an invalid rotation at runtime', () => {
    expect(() => rotateSide('north', 45 as Rotation)).toThrow(
      /Invalid rotation/,
    );
  });

  test('footprint swaps at 90 and 270 only', () => {
    const wide = {
      footprint: { width: 3, height: 1 },
      inputs: [],
      outputs: [],
    };
    expect(rotateBuilding(wide, 0).footprint).toEqual({ width: 3, height: 1 });
    expect(rotateBuilding(wide, 90).footprint).toEqual({ width: 1, height: 3 });
    expect(rotateBuilding(wide, 180).footprint).toEqual({
      width: 3,
      height: 1,
    });
    expect(rotateBuilding(wide, 270).footprint).toEqual({
      width: 1,
      height: 3,
    });
  });

  test('rotation 0 is the identity', () => {
    const r = rotateBuilding(splitter, 0);
    expect(r.inputs).toEqual(splitter.inputs);
    expect(r.outputs).toEqual(splitter.outputs);
  });

  test('inputs and outputs rotate together and keep their resources', () => {
    // Splitter: input south, outputs north/east/west.
    expect(rotateBuilding(splitter, 90)).toEqual({
      footprint: { width: 1, height: 1 },
      inputs: [{ side: 'west' }],
      outputs: ['east', 'south', 'north'],
    });
    expect(rotateBuilding(splitter, 180).inputs).toEqual([{ side: 'north' }]);
    expect(rotateBuilding(splitter, 180).outputs).toEqual([
      'south',
      'west',
      'east',
    ]);
    expect(rotateBuilding(splitter, 270).inputs).toEqual([{ side: 'east' }]);
    expect(rotateBuilding(barracks, 90).inputs).toEqual([
      { resource: 'res_a', side: 'west' },
    ]);
  });

  test('four quarter turns return to the start; opposite sides stay opposite', () => {
    for (const def of config.list()) {
      let current = {
        footprint: def.footprint,
        inputs: def.inputs,
        outputs: def.outputs,
      };
      for (let i = 0; i < 4; i++) current = rotateBuilding(current, 90);
      expect(current).toEqual({
        footprint: def.footprint,
        inputs: def.inputs,
        outputs: def.outputs,
      });
      for (const rotation of rotations) {
        const r = rotateBuilding(def, rotation);
        expect(r.inputs.length).toBe(def.inputs.length);
        expect(r.outputs.length).toBe(def.outputs.length);
        const area = r.footprint.width * r.footprint.height;
        expect(area).toBe(def.footprint.width * def.footprint.height);
        // Composition: rotating by r then by 90 equals rotating by r + 90.
        const next = ((rotation + 90) % 360) as Rotation;
        expect(rotateBuilding(r, 90)).toEqual(rotateBuilding(def, next));
      }
    }
  });

  test('a 2x2 building stays 2x2 and a 2x3 swaps', () => {
    expect(rotateBuilding(barracks, 90).footprint).toEqual({
      width: 2,
      height: 2,
    });
    const tall = {
      footprint: { width: 2, height: 3 },
      inputs: [],
      outputs: [],
    };
    expect(rotateBuilding(tall, 90).footprint).toEqual({ width: 3, height: 2 });
  });
});

describe('loadPresentation', () => {
  const buildings = loadBuildingsOrThrow(raw.buildings, ctx);
  const context = { buildings, units, terrain, resources };

  function presentationErrors(data: unknown): string {
    const result = loadPresentation(data, context);
    if (result.ok) throw new Error('expected failure');
    return result.errors.join('\n');
  }

  test('rejects missing and extra entries', () => {
    const data = clone(raw.presentation) as {
      buildings: Record<string, unknown>;
      units: Record<string, unknown>;
      terrain: Record<string, unknown>;
    };
    delete data.buildings['bld_wall'];
    data.units['unit_extra'] = { name: 'X', description: 'Y' };
    const text = presentationErrors(data);
    expect(text).toMatch(/buildings: missing entry for "bld_wall"/);
    expect(text).toMatch(/"unit_extra"\]: not a defined unit ID/);
  });

  test('rejects empty text, unknown fields, and unknown placeholders', () => {
    const data = clone(raw.presentation) as {
      buildings: Record<string, Record<string, unknown>>;
    };
    data.buildings['bld_wall'] = {
      name: ' ',
      description: 'Uses {res_nope}.',
      rules: 1,
    };
    data.buildings['bld_gate'] = {
      name: 'Gate',
      description: 'Uses {res_nope}.',
    };
    const text = presentationErrors(data);
    expect(text).toMatch(/missing or empty "name"/);
    expect(text).toMatch(/unknown field "rules"/);
    expect(text).toMatch(/placeholder \{res_nope\} is not a known resource/);
  });

  test('rejects a missing group', () => {
    expect(presentationErrors({ buildings: {}, units: {} })).toMatch(
      /"terrain" must be an object/,
    );
  });
});

describe('content files separate rules from text', () => {
  const textKeys = ['name', 'description', 'label', 'title'];
  function keysOf(value: unknown, out: Set<string>): Set<string> {
    if (Array.isArray(value)) {
      for (const v of value as unknown[]) keysOf(v, out);
    } else if (typeof value === 'object' && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        out.add(k);
        keysOf(v, out);
      }
    }
    return out;
  }

  test('rules files have no display text', () => {
    for (const file of [raw.buildings, raw.units, raw.terrain]) {
      const keys = keysOf(file, new Set());
      for (const key of textKeys) expect(keys.has(key)).toBe(false);
    }
  });

  test('presentation file has no rules', () => {
    const entryKeys = keysOf(
      [
        ...Object.values(
          (raw.presentation as Record<string, Record<string, unknown>>)[
            'buildings'
          ] ?? {},
        ),
      ],
      new Set(),
    );
    expect([...entryKeys].sort()).toEqual(['description', 'name']);
  });
});
