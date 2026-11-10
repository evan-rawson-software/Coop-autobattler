import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  listLegalCorePositions,
  loadAllContentOrThrow,
  loadMapgenOrThrow,
} from '@game/core';
import {
  applyIntent,
  createDeps,
  createRun,
  fixedBattle,
  validateRunState,
  type Intent,
  type RunState,
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

describe('run-state.schema.json', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(readSchema('map.schema.json'));
  ajv.addSchema(readSchema('team-state.schema.json'));
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
  // A kit with one building in each player's stash, so the board has content.
  const deps = createDeps(content, mapgenConfig, {
    battle: fixedBattle(false),
    hooks: {
      startingKit: (s) => ({
        perPlayer: s.perPlayer.map((p) => ({
          ...p,
          gold: 3,
          shop: { offers: ['bld_extractor'] },
        })),
        team: {
          ...s.team,
          stash: [
            { id: s.team.nextId, def: 'bld_extractor', tier: 1, owner: 0 },
          ],
          nextId: s.team.nextId + 1,
        },
      }),
    },
  });

  /** Play a two-player run to its defeat, collecting every state. */
  function playAll(): RunState[] {
    const created = createRun(
      { runId: 'r', runVersion: '0.1', seed: 11, players: ['A', 'B'], host: 0 },
      deps,
    );
    if (!created.ok) throw new Error(created.detail);
    let s = created.state;
    const states = [s];
    const send = (player: number, intent: Intent): void => {
      const r = applyIntent(s, player, intent, deps);
      if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
      s = r.state;
      states.push(s);
    };
    const pos = listLegalCorePositions(s.team.map, content, mapgenConfig)[0];
    if (pos === undefined) throw new Error('no core position');
    send(0, { type: 'propose_core', ...pos });
    send(1, { type: 'vote', choice: { x: pos.x, y: pos.y } });
    const node = s.team.map.nodes[0];
    const stashed = s.team.stash[0];
    if (node === undefined || stashed === undefined) throw new Error('setup');
    send(1, {
      type: 'place_building',
      id: stashed.id,
      x: node.x,
      y: node.y,
      rotation: 90,
    });
    let guard = 0;
    while (s.step !== 'run_over' && guard++ < 400) {
      switch (s.step) {
        case 'pve_choice':
        case 'event_choice': {
          const options = (s.pending as { options: { id: string }[] }).options;
          send(0, { type: 'vote', choice: options[0]?.id ?? '' });
          send(1, { type: 'vote', choice: options[1]?.id ?? '' });
          break;
        }
        default:
          send(0, { type: 'ready' });
          send(1, { type: 'ready' });
      }
    }
    return states;
  }

  test('every state of a run validates against the schema and the validator', () => {
    const states = playAll();
    expect(states.length).toBeGreaterThan(50);
    expect(states.at(-1)?.outcome?.reason).toBe('defeated');
    for (const s of states) {
      const json: unknown = JSON.parse(JSON.stringify(s));
      expect(json).toEqual(s);
      const ok = validate(json);
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
      expect(validateRunState(json, deps)).toMatchObject({ ok: true });
    }
    // Some states had content worth checking.
    expect(states.some((s) => s.team.buildings.length > 0)).toBe(true);
    expect(states.some((s) => s.votes !== null)).toBe(true);
  });

  test('the schema rejects broken states', () => {
    const good = JSON.parse(JSON.stringify(playAll()[5])) as Record<
      string,
      unknown
    >;
    const bad = (mutate: (o: Record<string, unknown>) => void): boolean => {
      const o = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
      mutate(o);
      return validate(o);
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((o) => delete o['seed'])).toBe(false);
    expect(bad((o) => (o['formatVersion'] = 2))).toBe(false);
    expect(bad((o) => (o['step'] = 'pve_battle'))).toBe(false);
    expect(bad((o) => (o['rng'] = [1, 2, 3]))).toBe(false);
    expect(bad((o) => (o['runVersion'] = 'v1'))).toBe(false);
    expect(bad((o) => (o['extra'] = 1))).toBe(false);
    expect(bad((o) => (o['players'] = []))).toBe(false);
  });
});
