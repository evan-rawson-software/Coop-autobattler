import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  listLegalCorePositions,
  loadAllContentOrThrow,
  loadEconomyOrThrow,
  loadMapgenOrThrow,
} from '@game/core';
import {
  applyIntent,
  createEconomyDeps,
  createRun,
  fixedBattle,
  type Intent,
  type RunState,
} from '@game/session';
import {
  rawBuildings,
  rawEconomy,
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

describe('gold stays out of the battle simulation (CB-3i)', () => {
  test('no arena*.ts or flow-sim.ts file mentions gold', () => {
    const dir = path.join(repoRoot, 'packages', 'core', 'src');
    const files = readdirSync(dir).filter(
      (f) => /^arena.*\.ts$/.test(f) || f === 'flow-sim.ts',
    );
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) =>
      /\bgold\b/i.test(readFileSync(path.join(dir, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

describe('run-state.schema.json with shop data', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(readSchema('map.schema.json'));
  ajv.addSchema(readSchema('team-state.schema.json'));
  ajv.addSchema(readSchema('ghost-snapshot.schema.json'));
  const validate = ajv.compile(readSchema('run-state.schema.json'));
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
  const economy = loadEconomyOrThrow(rawEconomy, {
    buildings: content.buildings,
  });
  const deps = createEconomyDeps(content, mapgenConfig, economy, {
    battle: fixedBattle(true),
  });

  function shopState(): RunState {
    const created = createRun(
      { runId: 'r', runVersion: '0.1', seed: 3, players: ['A'], host: 0 },
      deps,
    );
    if (!created.ok) throw new Error(created.detail);
    const pos = listLegalCorePositions(
      created.state.team.map,
      content,
      mapgenConfig,
    )[0];
    if (pos === undefined) throw new Error('no position');
    const go = (s: RunState, intent: Intent): RunState => {
      const r = applyIntent(s, 0, intent, deps);
      if (!r.ok) throw new Error(r.reason);
      return r.state;
    };
    let s = go(created.state, { type: 'propose_core', ...pos });
    s = go(s, { type: 'ready' });
    s = go(s, { type: 'vote', choice: 'easy' });
    s = go(s, { type: 'ready' });
    s = go(s, { type: 'vote', choice: 'stub_event_a' });
    expect(s.step).toBe('shop');
    return s;
  }

  test('a state with offers (and a bought slot) validates', () => {
    let s = shopState();
    expect(validate(JSON.parse(JSON.stringify(s)))).toBe(true);
    const r = applyIntent(s, 0, { type: 'buy', slot: 0 }, deps);
    if (r.ok) s = r.state;
    const ok = validate(JSON.parse(JSON.stringify(s)));
    expect(validate.errors).toBeNull();
    expect(ok).toBe(true);
  });

  test('negative gold and malformed offers are rejected', () => {
    const s = JSON.parse(JSON.stringify(shopState())) as {
      perPlayer: { gold: number; shop: { offers: unknown[] } }[];
    };
    const p = s.perPlayer[0];
    if (p === undefined) throw new Error('no player');
    p.gold = -1;
    expect(validate(s)).toBe(false);
    p.gold = 3;
    p.shop.offers[0] = { slot: 0, def: 'x', tier: 4, price: 1 };
    expect(validate(s)).toBe(false);
  });
});
