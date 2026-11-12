/**
 * Helpers for tests that need a run in a given step, played with the real
 * rules (`createGameDeps`, real battles) and the same intents the screens
 * send. Not part of the app.
 */
import { listLegalCorePositionsAnyPlot } from '@game/core';
import {
  applyIntent,
  createRun,
  type Intent,
  type RunDeps,
  type RunState,
  type Step,
} from '@game/session';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import { createGameDeps } from '@game/session';
import { nextIntent } from './drive.js';

let deps: RunDeps | null = null;

export function realDeps(): RunDeps {
  deps ??= createGameDeps(content, gameConfigs);
  return deps;
}

export function newRun(seed = 5, runId = 'test-run'): RunState {
  const r = createRun(
    { runId, runVersion: '1.0', seed, players: ['You'], host: 0 },
    realDeps(),
  );
  if (!r.ok) throw new Error(r.detail);
  return r.state;
}

export function send(state: RunState, intent: Intent): RunState {
  const r = applyIntent(state, 0, intent, realDeps());
  if (!r.ok) {
    throw new Error(
      `${intent.type} refused in ${state.step}: ${r.reason} ${r.detail ?? ''}`,
    );
  }
  return r.state;
}

/** The legal Core positions of a run in `core_placement`. */
export function legalCore(state: RunState): { x: number; y: number }[] {
  return listLegalCorePositionsAnyPlot(state.team.map, content, content.mapgen);
}

/**
 * Play the default path (first legal Core, "ready", the medium PvE option,
 * the first event) until `until` is true.
 */
export function playUntil(
  state: RunState,
  until: (s: RunState) => boolean,
  limit = 200,
): RunState {
  let s = state;
  for (let i = 0; i < limit; i++) {
    if (until(s)) return s;
    const intent = nextIntent(s);
    if (intent === null) break;
    s = send(s, intent);
  }
  if (!until(s)) throw new Error(`did not reach the target (at ${s.step})`);
  return s;
}

export function reachStep(step: Step, seed = 5): RunState {
  return playUntil(newRun(seed), (s) => s.step === step);
}
