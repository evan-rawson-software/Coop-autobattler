import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  THREAT_TYPES,
  generateThreat,
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  loadThreatsOrThrow,
} from '@game/core';
import {
  rawBuildings,
  rawMapgen,
  rawPresentationEn,
  rawResources,
  rawTerrain,
  rawThreats,
  rawUnits,
} from '@game/content';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

describe('threat-profile.schema.json', () => {
  const schema = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'schemas', 'threat-profile.schema.json'),
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
  const mapgen = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });
  const threats = loadThreatsOrThrow(rawThreats, {
    units: content.units,
    buildings: content.buildings,
  });

  test('generated profiles validate', () => {
    for (const arch of threats.archetypes) {
      for (const type of THREAT_TYPES) {
        for (const partySize of [1, 4]) {
          for (const round of [1, 7, 15, 40]) {
            const profile = generateThreat(
              { seed: round, round, type, partySize, archetype: arch.id },
              content,
              { threats, mapgen },
            );
            expect(validate(JSON.parse(JSON.stringify(profile)))).toBe(true);
          }
        }
      }
    }
  });

  test('malformed profiles are rejected', () => {
    expect(validate({ archetype: 'arch_rusher' })).toBe(false);
    const good = generateThreat(
      {
        seed: 1,
        round: 1,
        type: 'easy',
        partySize: 1,
        archetype: 'arch_rusher',
      },
      content,
      { threats, mapgen },
    );
    const copy = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    expect(validate({ ...copy, type: 'nightmare' })).toBe(false);
    expect(validate({ ...copy, extra: 1 })).toBe(false);
    expect(validate({ ...copy, unitStrengthPercent: 1.5 })).toBe(false);
  });
});
