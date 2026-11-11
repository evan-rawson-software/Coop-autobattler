import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  generateNeutralZone,
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

describe('neutral-zone.schema.json', () => {
  const schema = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'schemas', 'neutral-zone.schema.json'),
      'utf8',
    ),
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

  test('generated zones validate', () => {
    for (let plots = 1; plots <= 4; plots++) {
      for (let seed = 1; seed <= 20; seed++) {
        const zone = generateNeutralZone(
          seed,
          plots * config.plotWidth,
          content,
          config,
        );
        expect(validate(JSON.parse(JSON.stringify(zone)))).toBe(true);
      }
    }
  });

  test('malformed zones are rejected', () => {
    expect(validate({ width: 1 })).toBe(false);
    expect(
      validate({ width: 24, depth: 7, features: [], pointsOfInterest: 3 }),
    ).toBe(false);
    expect(
      validate({
        width: 24,
        depth: 7,
        features: [{ x: 1.5, y: 2, feature: 'ter_lake' }],
        pointsOfInterest: [],
      }),
    ).toBe(false);
    expect(
      validate({
        width: 24,
        depth: 7,
        features: [],
        pointsOfInterest: [],
        x: 1,
      }),
    ).toBe(false);
  });
});
