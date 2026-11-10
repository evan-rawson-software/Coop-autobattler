import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  loadSimConfigOrThrow,
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
    expect(validate({ tick: 1, type: 'stalled', building: 2, extra: 1 })).toBe(
      false,
    );
  });
});
