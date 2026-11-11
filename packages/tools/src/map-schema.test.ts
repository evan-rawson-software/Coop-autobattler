import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  generateMap,
  loadAllContentOrThrow,
  loadMapgenOrThrow,
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

describe('map.schema.json', () => {
  const schema = JSON.parse(
    readFileSync(path.join(repoRoot, 'schemas', 'map.schema.json'), 'utf8'),
  ) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    schema,
  );
  const content = loadAllContentOrThrow({
    resources: rawResources,
    terrain: rawTerrain,
    units: rawUnits,
    buildings: rawBuildings,
    presentation: rawPresentationEn,
  });
  const config = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });

  test('generated maps validate', () => {
    for (let partySize = 1; partySize <= 4; partySize++) {
      const map = generateMap(11, partySize, content, config);
      expect(validate(JSON.parse(JSON.stringify(map)))).toBe(true);
    }
  });

  test('malformed maps are rejected', () => {
    expect(validate({ width: 1 })).toBe(false);
    expect(
      validate({
        width: 24,
        height: 16,
        partySize: 1,
        plotWidth: 24,
        features: [{ x: 1.5, y: 0, feature: 'ter_lake' }],
        nodes: [],
      }),
    ).toBe(false);
  });
});
