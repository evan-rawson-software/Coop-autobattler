import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  loadSimConfigOrThrow,
  makeArenaSimKind,
  makeBattleKind,
  makeFlowSimKind,
} from '@game/core';
import {
  rawBuildings,
  rawMapgen,
  rawPresentationEn,
  rawResources,
  rawSim,
  rawTerrain,
  rawUnits,
} from '@game/content';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

describe('sim-event.schema.json', () => {
  const schema = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'schemas', 'sim-event.schema.json'),
      'utf8',
    ),
  ) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    schema,
  );
  const vectors = JSON.parse(
    readFileSync(path.join(repoRoot, 'golden', 'flow-sim.json'), 'utf8'),
  ) as { id: string; input: never }[];

  test('every event of every flow-sim vector validates', () => {
    const seen = new Set<string>();
    const content = loadAllContentOrThrow({
      resources: rawResources,
      terrain: rawTerrain,
      units: rawUnits,
      buildings: rawBuildings,
      presentation: rawPresentationEn,
    });
    const kind = makeFlowSimKind(
      content,
      loadMapgenOrThrow(rawMapgen, { terrain: content.terrain }),
      loadSimConfigOrThrow(rawSim),
    );
    for (const v of vectors) {
      for (const e of kind(v.input).eventLog ?? []) {
        expect(validate(e), JSON.stringify(e)).toBe(true);
        seen.add((e as { type: string }).type);
      }
    }
    expect([...seen].sort()).toEqual([
      'delivered',
      'lost',
      'produced',
      'stalled',
    ]);
  });

  test('every event of every arena-sim vector validates', () => {
    const seen = new Set<string>();
    const content = loadAllContentOrThrow({
      resources: rawResources,
      terrain: rawTerrain,
      units: rawUnits,
      buildings: rawBuildings,
      presentation: rawPresentationEn,
    });
    const kind = makeArenaSimKind(
      content,
      loadMapgenOrThrow(rawMapgen, { terrain: content.terrain }),
      loadSimConfigOrThrow(rawSim),
    );
    const arenaVectors = JSON.parse(
      readFileSync(path.join(repoRoot, 'golden', 'arena-sim.json'), 'utf8'),
    ) as { id: string; input: never }[];
    for (const v of arenaVectors) {
      for (const e of kind(v.input).eventLog ?? []) {
        expect(validate(e), JSON.stringify(e)).toBe(true);
        seen.add((e as { type: string }).type);
      }
    }
    expect([...seen].sort()).toEqual([
      'building_destroyed',
      'conduit_destroyed',
      'core_destroyed',
      'delivered',
      'lost',
      'overload_core_damage',
      'overload_level',
      'overload_started',
      'produced',
      'ramp_step',
      'stalled',
      'turret_fired',
      'unit_attacked',
      'unit_died',
      'unit_spawned',
    ]);
  });

  test('every event of every battle vector validates', () => {
    const seen = new Set<string>();
    const content = loadAllContentOrThrow({
      resources: rawResources,
      terrain: rawTerrain,
      units: rawUnits,
      buildings: rawBuildings,
      presentation: rawPresentationEn,
    });
    const kind = makeBattleKind(
      content,
      loadMapgenOrThrow(rawMapgen, { terrain: content.terrain }),
      loadSimConfigOrThrow(rawSim),
    );
    const battleVectors = JSON.parse(
      readFileSync(path.join(repoRoot, 'golden', 'battle.json'), 'utf8'),
    ) as { id: string; input: never }[];
    for (const v of battleVectors) {
      for (const e of kind(v.input).eventLog ?? []) {
        expect(validate(e), JSON.stringify(e)).toBe(true);
        seen.add((e as { type: string }).type);
      }
    }
    expect(seen.has('zone_revealed')).toBe(true);
    expect(seen.has('battle_ended')).toBe(true);
    expect(
      validate({ tick: 3, type: 'battle_ended', winner: 2, reason: 'x' }),
    ).toBe(false);
    expect(
      validate({
        tick: 0,
        type: 'zone_revealed',
        zone: { width: 1, depth: 1, features: [] },
      }),
    ).toBe(false);
  });

  test('malformed events are rejected', () => {
    expect(validate({ tick: 1, type: 'produced', building: 2 })).toBe(false);
    expect(validate({ tick: -1, type: 'stalled', building: 2 })).toBe(false);
    expect(
      validate({
        tick: 1,
        type: 'delivered',
        building: 2,
        side: 'up',
        resource: 'r',
      }),
    ).toBe(false);
    expect(validate({ tick: 1, type: 'moved', building: 2 })).toBe(false);
    expect(validate({ tick: 1, type: 'unit_moved', unit: 1, x: 2 })).toBe(
      false,
    );
    expect(
      validate({
        tick: 1,
        type: 'unit_attacked',
        unit: 1,
        damage: 3,
        target: { kind: 'conduit', conduit: 4 },
      }),
    ).toBe(false);
    expect(validate({ tick: 1, type: 'core_destroyed', side: 2 })).toBe(false);
    expect(
      validate({
        tick: 1,
        type: 'turret_fired',
        side: 0,
        building: 3,
        unit: 4,
        damage: 5,
      }),
    ).toBe(true);
    expect(
      validate({ tick: 1, type: 'turret_fired', side: 0, building: 3 }),
    ).toBe(false);
    expect(validate({ tick: 1, type: 'stalled', building: 2, extra: 1 })).toBe(
      false,
    );
  });
});
