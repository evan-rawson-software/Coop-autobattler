import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import { loadAllContentOrThrow, loadMapgenOrThrow } from '@game/core';
import {
  createDeps,
  createMemorySaveStore,
  parseSaveRecord,
  startRun,
} from '@game/session';
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

describe('save.schema.json', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(readSchema('map.schema.json'));
  ajv.addSchema(readSchema('team-state.schema.json'));
  ajv.addSchema(readSchema('run-state.schema.json'));
  const validate = ajv.compile(readSchema('save.schema.json'));
  const content = loadAllContentOrThrow({
    resources: rawResources,
    terrain: rawTerrain,
    units: rawUnits,
    buildings: rawBuildings,
    presentation: rawPresentationEn,
  });
  const mapgenConfig = loadMapgenOrThrow(rawMapgen, {
    terrain: content.terrain,
  });
  const deps = createDeps(content, mapgenConfig);

  test('a saved record validates, and holds the seed and the action log', async () => {
    const store = createMemorySaveStore();
    const started = await startRun(
      { runId: 'r2', runVersion: '0.1', seed: 10, players: ['A'], host: 0 },
      deps,
      store,
      3,
      '0.1.0',
    );
    if (!started.ok) throw new Error(started.reason);
    const raw: unknown = await store.get('r2');
    expect(validate(raw)).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
    expect(parseSaveRecord(raw, deps).ok).toBe(true);
    const rec = raw as { state: { seed: number; actionLog: unknown[] } };
    expect(rec.state.seed).toBe(10);
    expect(Array.isArray(rec.state.actionLog)).toBe(true);
    // A signature field is accepted.
    expect(validate({ ...(raw as object), signature: 'x' })).toBe(true);
    // Malformed ones are rejected.
    expect(validate({ ...(raw as object), state: undefined })).toBe(false);
    expect(validate(null)).toBe(false);
    expect(validate({ ...(raw as object), extra: 1 })).toBe(false);
  });
});
