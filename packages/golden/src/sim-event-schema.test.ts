import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  loadSimConfigOrThrow,
  loadThreatsOrThrow,
} from '@game/core';
import {
  rawBuildings,
  rawMapgen,
  rawPoints,
  rawSpecialists,
  rawPresentationEn,
  rawResources,
  rawSim,
  rawTerrain,
  rawThreats,
  rawUnits,
} from '@game/content';
import { makeArenaSimKind } from './kinds/arena-sim.js';
import { makeBattleKind } from './kinds/battle.js';
import { makeFlowSimKind } from './kinds/flow-sim.js';
import { makePveBattleKind } from './kinds/threat.js';

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
      points: rawPoints,
      specialists: rawSpecialists,
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
      points: rawPoints,
      specialists: rawSpecialists,
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
      'point_capture_started',
      'point_captured',
      'produced',
      'ramp_step',
      'splash',
      'stalled',
      'turret_fired',
      'unit_attacked',
      'unit_died',
      'unit_retargeted',
      'unit_spawned',
      'ward_struck',
    ]);
  });

  test('every event of every battle vector validates', () => {
    const seen = new Set<string>();
    const content = loadAllContentOrThrow({
      resources: rawResources,
      terrain: rawTerrain,
      units: rawUnits,
      buildings: rawBuildings,
      points: rawPoints,
      specialists: rawSpecialists,
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
    // Neutral guards (CB-8e): placed at tick 0, and their deaths carry side 2.
    expect(seen.has('guard_spawned')).toBe(true);
    expect(
      validate({
        tick: 0,
        type: 'guard_spawned',
        unit: 1,
        point: 0,
        def: 'unit_soldier',
        px: 1500,
        py: 4680,
      }),
    ).toBe(true);
    expect(
      validate({
        tick: 0,
        type: 'guard_spawned',
        unit: 0,
        point: 0,
        def: 'unit_soldier',
        px: 1500,
        py: 4680,
      }),
    ).toBe(false);
    // Point capture (CB-8f).
    expect(seen.has('point_capture_started')).toBe(true);
    expect(seen.has('point_captured')).toBe(true);
    expect(
      validate({ tick: 4, type: 'point_capture_started', point: 0, side: 1 }),
    ).toBe(true);
    expect(
      validate({ tick: 4, type: 'point_capture_started', point: 0, side: 2 }),
    ).toBe(false);
    expect(
      validate({ tick: 9, type: 'point_captured', point: 1, side: 0, previous: -1 }),
    ).toBe(true);
    expect(
      validate({ tick: 9, type: 'point_captured', point: 1, side: 0 }),
    ).toBe(false);
    expect(validate({ tick: 9, type: 'unit_died', unit: 1, side: 2 })).toBe(
      true,
    );
    expect(validate({ tick: 9, type: 'unit_died', unit: 1 })).toBe(true);
    expect(validate({ tick: 9, type: 'unit_died', unit: 1, side: 1 })).toBe(
      false,
    );
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
  }, 60_000);

  test('every event of the Brood pve-battle vectors validates, burst_released included', () => {
    const content = loadAllContentOrThrow({
      resources: rawResources,
      terrain: rawTerrain,
      units: rawUnits,
      buildings: rawBuildings,
      points: rawPoints,
      specialists: rawSpecialists,
      presentation: rawPresentationEn,
    });
    const kind = makePveBattleKind(
      content,
      loadMapgenOrThrow(rawMapgen, { terrain: content.terrain }),
      loadSimConfigOrThrow(rawSim),
      loadThreatsOrThrow(rawThreats, {
        units: content.units,
        buildings: content.buildings,
      }),
    );
    const pve = JSON.parse(
      readFileSync(path.join(repoRoot, 'golden', 'pve-battle.json'), 'utf8'),
    ) as { id: string; input: never }[];
    const seen = new Set<string>();
    for (const v of pve.filter((x) => x.id.includes('-brood-'))) {
      for (const e of kind(v.input).eventLog ?? []) {
        expect(validate(e), JSON.stringify(e)).toBe(true);
        seen.add((e as { type: string }).type);
      }
    }
    expect(seen.has('burst_released')).toBe(true);
    expect(
      validate({
        tick: 5,
        type: 'burst_released',
        side: 1,
        core: 0,
        thresholdPercent: 75,
        units: [{ unit: 'unit_soldier', count: 0 }],
      }),
    ).toBe(false);
  }, 60_000);

  test('every event of the Linked Cores pve-battle vectors validates, the pool field included', () => {
    const content = loadAllContentOrThrow({
      resources: rawResources,
      terrain: rawTerrain,
      units: rawUnits,
      buildings: rawBuildings,
      points: rawPoints,
      specialists: rawSpecialists,
      presentation: rawPresentationEn,
    });
    const kind = makePveBattleKind(
      content,
      loadMapgenOrThrow(rawMapgen, { terrain: content.terrain }),
      loadSimConfigOrThrow(rawSim),
      loadThreatsOrThrow(rawThreats, {
        units: content.units,
        buildings: content.buildings,
      }),
    );
    const pve = JSON.parse(
      readFileSync(path.join(repoRoot, 'golden', 'pve-battle.json'), 'utf8'),
    ) as { id: string; input: never }[];
    let pools = 0;
    for (const v of pve.filter(
      (x) => x.id.includes('-linked-r5') || x.id.includes('time-limit-pool'),
    )) {
      for (const e of kind(v.input).eventLog ?? []) {
        expect(validate(e), JSON.stringify(e)).toBe(true);
        if ('pool' in (e as object)) pools += 1;
      }
    }
    expect(pools).toBeGreaterThan(0);
    expect(
      validate({
        tick: 5,
        type: 'unit_attacked',
        unit: 1,
        target: { kind: 'core', side: 1, core: 0 },
        damage: 6,
        pool: -1,
      }),
    ).toBe(false);
  }, 120_000);

  test('every event of the Pylons pve-battle vectors validates, the pylon events included', () => {
    const content = loadAllContentOrThrow({
      resources: rawResources,
      terrain: rawTerrain,
      units: rawUnits,
      buildings: rawBuildings,
      points: rawPoints,
      specialists: rawSpecialists,
      presentation: rawPresentationEn,
    });
    const kind = makePveBattleKind(
      content,
      loadMapgenOrThrow(rawMapgen, { terrain: content.terrain }),
      loadSimConfigOrThrow(rawSim),
      loadThreatsOrThrow(rawThreats, {
        units: content.units,
        buildings: content.buildings,
      }),
    );
    const pve = JSON.parse(
      readFileSync(path.join(repoRoot, 'golden', 'pve-battle.json'), 'utf8'),
    ) as { id: string; input: never }[];
    const seen = new Set<string>();
    for (const v of pve.filter((x) => x.id.includes('-pylons-'))) {
      for (const e of kind(v.input).eventLog ?? []) {
        expect(validate(e), JSON.stringify(e)).toBe(true);
        seen.add((e as { type: string }).type);
      }
    }
    expect(seen.has('pylon_destroyed')).toBe(true);
    expect(seen.has('core_shield_down')).toBe(true);
    expect(
      validate({
        tick: 5,
        type: 'core_hit_blocked',
        unit: 3,
        side: 1,
        core: 0,
        damage: 6,
      }),
    ).toBe(true);
    expect(
      validate({
        tick: 5,
        type: 'pylon_destroyed',
        side: 1,
        building: 4,
        core: 0,
      }),
    ).toBe(false);
  }, 120_000);

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
      validate({
        tick: 1,
        type: 'turret_fired',
        side: 0,
        building: 3,
        unit: 4,
        damage: 5,
        splash: [{ unit: 6, damage: 3 }],
      }),
    ).toBe(true);
    expect(
      validate({ tick: 1, type: 'turret_fired', side: 0, building: 3 }),
    ).toBe(false);
    expect(
      validate({
        tick: 30,
        type: 'ward_struck',
        side: 0,
        building: 6,
        wall: 7,
        unit: 1,
        damage: 2,
      }),
    ).toBe(true);
    expect(
      validate({
        tick: 30,
        type: 'ward_struck',
        side: 0,
        building: 6,
        unit: 1,
        damage: 2,
      }),
    ).toBe(false);
    expect(validate({ tick: 1, type: 'stalled', building: 2, extra: 1 })).toBe(
      false,
    );
  });
});
