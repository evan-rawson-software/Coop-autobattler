import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  listLegalCorePositions,
  loadAllContentOrThrow,
  loadMapgenOrThrow,
  placeCore,
  type GhostSnapshot,
} from '@game/core';
import { createDeps, createRun, snapshotOf } from '@game/session';
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

describe('ghost-snapshot.schema.json', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(readSchema('map.schema.json'));
  ajv.addSchema(readSchema('team-state.schema.json'));
  const validate = ajv.compile(readSchema('ghost-snapshot.schema.json'));
  const content = loadAllContentOrThrow({
    resources: rawResources,
    terrain: rawTerrain,
    units: rawUnits,
    buildings: rawBuildings,
    presentation: rawPresentationEn,
  });
  const mapgen = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });
  const deps = createDeps(content, mapgen);
  const created = createRun(
    { runId: 'r1', runVersion: '0.1', seed: 7, players: ['Ann'], host: 0 },
    deps,
  );
  if (!created.ok) throw new Error(created.detail);
  const pos = listLegalCorePositions(
    created.state.team.map,
    content,
    mapgen,
    0,
  )[0];
  if (pos === undefined) throw new Error('no Core position');
  const placed = placeCore(created.state.team, content, mapgen, 0, pos);
  if (!placed.ok) throw new Error(placed.reason);
  const snapshot: GhostSnapshot = snapshotOf(
    { ...created.state, team: placed.state },
    { id: 'dev-1', label: 'Ann' },
  );

  function bad(change: (o: Record<string, unknown>) => void): boolean {
    const o = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
    change(o);
    return validate(o);
  }

  test('a snapshot validates and round-trips through JSON', () => {
    expect(validate(snapshot)).toBe(true);
    const again = JSON.parse(JSON.stringify(snapshot)) as unknown;
    expect(validate(again)).toBe(true);
    expect(canonicalJson(again)).toBe(canonicalJson(snapshot));
  });

  test('the reserved fields are not accepted (TA-22b)', () => {
    expect(bad((o) => (o['runSeed'] = 5))).toBe(false);
    expect(bad((o) => (o['actionLog'] = []))).toBe(false);
  });

  test('missing, unknown and malformed fields are rejected', () => {
    for (const key of [
      'formatVersion',
      'gameVersion',
      'partySize',
      'round',
      'mapSeed',
      'team',
      'owner',
      'runId',
      'lives',
      'pvpRecord',
    ]) {
      expect(
        bad((o) => Reflect.deleteProperty(o, key)),
        key,
      ).toBe(false);
    }
    expect(bad((o) => (o['extra'] = 1))).toBe(false);
    expect(bad((o) => (o['formatVersion'] = 1))).toBe(false);
    expect(bad((o) => (o['formatVersion'] = 2))).toBe(false);
    expect(bad((o) => (o['formatVersion'] = 3))).toBe(false);
    expect(bad((o) => (o['formatVersion'] = 4))).toBe(false);
    expect(bad((o) => (o['formatVersion'] = 5))).toBe(false);
    expect(bad((o) => (o['formatVersion'] = 6))).toBe(false);
    expect(bad((o) => (o['gameVersion'] = '0.1.0'))).toBe(false);
    expect(bad((o) => (o['gameVersion'] = '01.1'))).toBe(false);
    expect(bad((o) => (o['partySize'] = 5))).toBe(false);
    expect(bad((o) => (o['round'] = 0))).toBe(false);
    expect(bad((o) => (o['mapSeed'] = 2 ** 32))).toBe(false);
    expect(bad((o) => (o['owner'] = { id: 'a' }))).toBe(false);
    expect(bad((o) => (o['owner'] = { id: '', label: 'x' }))).toBe(false);
    expect(bad((o) => (o['pvpRecord'] = { wins: -1, losses: 0 }))).toBe(false);
    expect(bad((o) => (o['lives'] = 0))).toBe(false);
    expect(bad((o) => (o['team'] = {}))).toBe(false);
  });
});
