import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  listLegalCorePositionsAnyPlot,
  loadAllContentOrThrow,
  loadEconomyOrThrow,
  loadEventsOrThrow,
  loadMapgenOrThrow,
  loadSimConfigOrThrow,
  loadThreatsOrThrow,
} from '@game/core';
import {
  applyIntent,
  createGameDeps,
  createRun,
  validateRunState,
  type Intent,
  type RunState,
} from '@game/session';
import {
  rawBuildings,
  rawEconomy,
  rawEvents,
  rawMapgen,
  rawPresentationEn,
  rawResources,
  rawSim,
  rawTerrain,
  rawThreats,
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

/**
 * States of a run with real battles and the event step (W2-3) validate
 * against the schemas, including `upcomingPve` and `team.modifiers`.
 */
describe('run-state.schema.json with options, events and modifiers', () => {
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
  const mapgen = loadMapgenOrThrow(rawMapgen, { terrain: content.terrain });
  const deps = createGameDeps(content, {
    mapgen,
    economy: loadEconomyOrThrow(rawEconomy, { buildings: content.buildings }),
    events: loadEventsOrThrow(rawEvents),
    threats: loadThreatsOrThrow(rawThreats, {
      units: content.units,
      buildings: content.buildings,
    }),
    sim: loadSimConfigOrThrow(rawSim),
  });

  test('every state of a run that takes a Shrine modifier validates', () => {
    const created = createRun(
      { runId: 'r', runVersion: '0.1', seed: 7, players: ['A'], host: 0 },
      deps,
    );
    if (!created.ok) throw new Error(created.detail);
    let s: RunState = created.state;
    const states: RunState[] = [s];
    const send = (intent: Intent): void => {
      const r = applyIntent(s, 0, intent, deps);
      if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
      s = r.state;
      states.push(s);
    };
    const pos = listLegalCorePositionsAnyPlot(s.team.map, content, mapgen)[0];
    if (pos === undefined) throw new Error('no Core position');
    send({ type: 'propose_core', ...pos });
    send({ type: 'ready' });
    send({ type: 'vote', choice: 'medium' });
    send({ type: 'ready' });
    const offers = (s.pending as { options: { id: string }[] }).options;
    expect(offers.some((o) => o.id === 'evt_shrine')).toBe(true);
    send({ type: 'vote', choice: 'evt_shrine' });
    expect(s.step).toBe('event_resolve');
    const fu = (s.pending as { followUp: { options: { id: string }[] } })
      .followUp;
    send({ type: 'event_choose', choice: fu.options[0]?.id ?? '' });
    expect(s.team.modifiers).toHaveLength(1);
    send({ type: 'ready' });
    expect(s.step).toBe('pvp_summary');
    for (const state of states) {
      const ok = validate(state);
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
      expect(validateRunState(JSON.parse(JSON.stringify(state)), deps).ok).toBe(
        true,
      );
    }
    expect(states.some((x) => x.upcomingPve !== null)).toBe(true);
    expect(states.some((x) => x.step === 'event_resolve')).toBe(true);
  });
});
