/** Helpers for tests only. */
import {
  listLegalCorePositions,
  loadAllContentOrThrow,
  loadEconomyOrThrow,
  loadEventsOrThrow,
  loadMapgenOrThrow,
  loadSimConfigOrThrow,
  loadThreatsOrThrow,
} from '@game/core';
import buildingsJson from '../../../content/buildings.json';
import economyJson from '../../../content/economy.json';
import eventsJson from '../../../content/events.json';
import mapgenJson from '../../../content/mapgen.json';
import presentationJson from '../../../content/presentation.en.json';
import resourcesJson from '../../../content/resources.json';
import simJson from '../../../content/sim.json';
import terrainJson from '../../../content/terrain.json';
import threatsJson from '../../../content/threats.json';
import unitsJson from '../../../content/units.json';
import { createDeps } from './defaults.js';
import { createGameDeps, type GameConfigs } from './game-deps.js';
import { applyIntent, createRun } from './machine.js';
import type {
  CreateRunArgs,
  Effect,
  Intent,
  RunDeps,
  RunState,
} from './types.js';

export const content = loadAllContentOrThrow({
  resources: resourcesJson,
  terrain: terrainJson,
  units: unitsJson,
  buildings: buildingsJson,
  presentation: presentationJson,
});
export const mapgenConfig = loadMapgenOrThrow(mapgenJson, {
  terrain: content.terrain,
});
export const baseDeps: RunDeps = createDeps(content, mapgenConfig);

export const gameConfigs: GameConfigs = {
  mapgen: mapgenConfig,
  economy: loadEconomyOrThrow(economyJson, { buildings: content.buildings }),
  events: loadEventsOrThrow(eventsJson),
  threats: loadThreatsOrThrow(threatsJson, {
    units: content.units,
    buildings: content.buildings,
  }),
  sim: loadSimConfigOrThrow(simJson),
};

/** Fully wired deps: economy, PvE options, events, rewards, real battles. */
export function makeGameDeps(
  overrides: Parameters<typeof createGameDeps>[2] = {},
  configs: GameConfigs = gameConfigs,
): RunDeps {
  return createGameDeps(content, configs, overrides);
}

export function runArgs(
  players: readonly string[] = ['Ann'],
  seed = 7,
): CreateRunArgs {
  return { runId: 'run-1', runVersion: '0.1', seed, players, host: 0 };
}

export function newRun(deps: RunDeps = baseDeps, players?: readonly string[]) {
  const r = createRun(runArgs(players), deps);
  if (!r.ok) throw new Error(r.detail);
  return r.state;
}

/** Apply an intent that must be accepted; returns state and effects. */
export function ok(
  state: RunState,
  player: number,
  intent: Intent,
  deps: RunDeps = baseDeps,
): { state: RunState; effects: readonly Effect[] } {
  const r = applyIntent(state, player, intent, deps);
  if (!r.ok) throw new Error(`rejected: ${r.reason} ${r.detail ?? ''}`);
  return { state: r.state, effects: r.effects };
}

export function corePosition(
  state: RunState,
  player = 0,
): { x: number; y: number } {
  const pos = listLegalCorePositions(
    state.team.map,
    content,
    mapgenConfig,
    player,
  )[0];
  if (pos === undefined) throw new Error('no legal Core position');
  return pos;
}

/**
 * The next Core-placement move of `player`: place the first legal Core, then
 * ready once it is placed.
 */
export function coreMove(state: RunState, player = 0): Intent {
  const pending = state.pending as { positions?: unknown[] } | null;
  return pending?.positions?.[player] != null
    ? { type: 'ready' }
    : { type: 'place_core', ...corePosition(state, player) };
}

/** Everyone readies up, in order. */
export function readyAll(
  state: RunState,
  deps: RunDeps = baseDeps,
  effects: Effect[] = [],
): RunState {
  let s = state;
  for (let p = 0; p < s.players.length; p++) {
    const r = ok(s, p, { type: 'ready' }, deps);
    effects.push(...r.effects);
    s = r.state;
  }
  return s;
}

/** Everyone votes for the same option id. */
export function voteAll(
  state: RunState,
  choice: string,
  deps: RunDeps = baseDeps,
  effects: Effect[] = [],
): RunState {
  let s = state;
  for (let p = 0; p < s.players.length; p++) {
    const r = ok(s, p, { type: 'vote', choice }, deps);
    effects.push(...r.effects);
    s = r.state;
  }
  return s;
}

/** Every player places their own Core and readies, reaching `build`. */
export function placeCoreAll(
  state: RunState,
  deps: RunDeps = baseDeps,
  effects: Effect[] = [],
): RunState {
  let cur = state;
  for (let p = 0; p < cur.players.length; p++) {
    const r = ok(cur, p, { type: 'place_core', ...corePosition(cur, p) }, deps);
    effects.push(...r.effects);
    cur = r.state;
  }
  for (let p = 0; p < cur.players.length; p++) {
    const r = ok(cur, p, { type: 'ready' }, deps);
    effects.push(...r.effects);
    cur = r.state;
  }
  return cur;
}

/** Deep-freeze a value (and return it). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
