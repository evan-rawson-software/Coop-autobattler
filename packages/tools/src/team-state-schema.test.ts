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
        id: src.id,
        x: n.x,
        y: n.y,
        rotation: 0,
      });
      if (!a.ok) continue;
      const b = placeFromStash(a.state, content, {
        id: spl.id,
        x: n.x,
        y: n.y + 1,
        rotation: 0,
      });
      if (!b.ok) continue;
      const c = addConduit(b.state, content, {
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
    expect(validate({ ...good, conduits: [1] })).toBe(false);
    expect(validate({ ...good, conduits: {} })).toBe(false);
    expect(validate({ ...good, extra: true })).toBe(false);
    expect(
      validate({
        ...good,
        stash: [{ id: 1, def: 'bld_wall', tier: 4, owner: 0 }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...good,
        buildings: [
          {
            id: 1,
            def: 'bld_wall',
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
