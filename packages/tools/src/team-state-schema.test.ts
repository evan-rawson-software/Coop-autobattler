import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  addConduit,
  addToStash,
  createTeamState,
  generateMap,
  listLegalCorePositions,
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  placeCore,
  placeFromStash,
  validateTeamState,
  type TeamState,
} from '@game/core';
import {
  rawBuildings,
  rawMapgen,
  rawPoints,
  rawSpecialists,
  rawPresentationEn,
  rawResources,
  rawTerrain,
  rawUnits,
} from '@game/content';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function readSchema(name: string): object {
  return JSON.parse(
    readFileSync(path.join(repoRoot, 'schemas', name), 'utf8'),
  ) as object;
}

function got<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing value');
  return v;
}

describe('team-state.schema.json', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(readSchema('map.schema.json'));
  const validate = ajv.compile(readSchema('team-state.schema.json'));
  const content = loadAllContentOrThrow({
    resources: rawResources,
    terrain: rawTerrain,
    units: rawUnits,
    buildings: rawBuildings,
    points: rawPoints,
    specialists: rawSpecialists,
    presentation: rawPresentationEn,
  });
  const config = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });

  function sampleState(): TeamState {
    const map = generateMap(5, 2, content, config);
    let s = createTeamState(map);
    const core = listLegalCorePositions(map, content, config, 0)[0];
    if (core === undefined) throw new Error('no core position');
    const placedCore = placeCore(s, content, config, 0, core);
    if (!placedCore.ok) throw new Error(placedCore.reason);
    s = placedCore.state;
    const node = map.nodes[0];
    if (node === undefined) throw new Error('no node');
    for (const owner of [0, 1]) {
      const added = addToStash(s, content, {
        def: 'bld_extractor',
        tier: 2,
        owner,
      });
      if (!added.ok) throw new Error(added.reason);
      s = added.state;
      if (owner === 0) {
        const placed = placeFromStash(s, content, {
          actor: 0,
          id: added.id,
          x: node.x,
          y: node.y,
          rotation: 90,
        });
        if (!placed.ok) throw new Error(placed.reason);
        s = placed.state;
      }
    }
    return s;
  }

  test('a state round-trips through JSON, validates, and passes the validator', () => {
    const state = sampleState();
    expect(state.buildings).toHaveLength(1);
    expect(state.stash).toHaveLength(1);
    const round = JSON.parse(JSON.stringify(state)) as unknown;
    expect(round).toEqual(state);
    expect(validate(round)).toBe(true);
    const result = validateTeamState(round, content, config);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toEqual(state);
  });

  test('specialists (issue #470): optional, a list of IDs or null, in the schema and the validator', () => {
    const base = sampleState();
    // A state without the field (an old save) is valid, and has no such key.
    expect(Object.keys(base)).not.toContain('specialists');
    expect(validate(JSON.parse(JSON.stringify(base)))).toBe(true);
    const withPicks = (list: unknown): unknown => ({
      ...(JSON.parse(JSON.stringify(base)) as object),
      specialists: list,
    });
    for (const good of [
      ['spec_flowmancer', 'spec_flowmancer'],
      ['spec_alchemist', null],
      [null, 'spec_wardsmith'],
    ]) {
      const v = withPicks(good);
      expect(validate(v), JSON.stringify(good)).toBe(true);
      expect(validateTeamState(v, content, config).ok).toBe(true);
    }
    for (const bad of [
      [],
      ['Spec_X', null],
      [1, null],
      'spec_flowmancer',
      ['spec_a', 'spec_a', 'spec_a', 'spec_a', 'spec_a'],
    ]) {
      expect(validate(withPicks(bad)), JSON.stringify(bad)).toBe(false);
      expect(validateTeamState(withPicks(bad), content, config).ok).toBe(false);
    }
    // The schema cannot know the roster or the party size; the validator does.
    expect(validate(withPicks(['spec_nobody', null]))).toBe(true);
    expect(
      validateTeamState(withPicks(['spec_nobody', null]), content, config).ok,
    ).toBe(false);
    expect(validate(withPicks(['spec_flowmancer']))).toBe(true);
    expect(
      validateTeamState(withPicks(['spec_flowmancer']), content, config).ok,
    ).toBe(false);
  });

  test('a state with a conduit round-trips and validates', () => {
    const map = generateMap(5, 1, content, config);
    let found: TeamState | undefined;
    for (const n of map.nodes) {
      let s = createTeamState(map);
      const src = addToStash(s, content, {
        def: 'bld_extractor',
        tier: 1,
        owner: 0,
      });
      if (!src.ok) throw new Error(src.reason);
      const spl = addToStash(src.state, content, {
        def: 'bld_splitter',
        tier: 1,
        owner: 0,
      });
      if (!spl.ok) throw new Error(spl.reason);
      s = spl.state;
      const a = placeFromStash(s, content, {
        actor: 0,
        id: src.id,
        x: n.x,
        y: n.y,
        rotation: 0,
      });
      if (!a.ok) continue;
      const b = placeFromStash(a.state, content, {
        actor: 0,
        id: spl.id,
        x: n.x,
        y: n.y + 1,
        rotation: 0,
      });
      if (!b.ok) continue;
      const c = addConduit(b.state, content, {
        actor: 0,
        from: { building: src.id, side: 'north' },
        to: { building: spl.id, side: 'south' },
        cells: [],
      });
      if (c.ok) {
        found = c.state;
        break;
      }
    }
    if (found === undefined)
      throw new Error('no node with room for a splitter');
    expect(found.conduits).toHaveLength(1);
    const round = JSON.parse(JSON.stringify(found)) as unknown;
    expect(validate(round)).toBe(true);
    const result = validateTeamState(round, content, config);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toEqual(found);
    const bad = JSON.parse(JSON.stringify(found)) as {
      conduits: { from: { side: string }; cells: unknown[] }[];
    };
    got(bad.conduits[0]).from.side = 'up';
    expect(validate(bad)).toBe(false);
    got(bad.conduits[0]).from.side = 'north';
    got(bad.conduits[0]).cells = [{ x: 1 }];
    expect(validate(bad)).toBe(false);
  });

  test('an empty state validates', () => {
    const map = generateMap(5, 1, content, config);
    expect(validate(JSON.parse(JSON.stringify(createTeamState(map))))).toBe(
      true,
    );
  });

  test('malformed states are rejected', () => {
    const good = JSON.parse(JSON.stringify(sampleState())) as Record<
      string,
      unknown
    >;
    expect(validate({})).toBe(false);
    expect(validate({ ...good, nextId: 0 })).toBe(false);
    expect(validate({ ...good, nextConduitId: [0] })).toBe(false);
    expect(validate({ ...good, conduits: [1] })).toBe(false);
    expect(validate({ ...good, conduits: {} })).toBe(false);
    expect(validate({ ...good, extra: true })).toBe(false);
    expect(
      validate({
        ...good,
        stash: [{ id: 1, def: 'bld_wall_block', tier: 4, owner: 0 }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...good,
        buildings: [
          {
            id: 1,
            def: 'bld_wall_block',
            tier: 1,
            x: 0,
            y: 0,
            rotation: 45,
            owner: 0,
          },
        ],
      }),
    ).toBe(false);
  });
});
