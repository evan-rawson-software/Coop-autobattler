/**
 * Sets up a run that is already in a shop step, by sending the same intents a
 * party would: Core placement, Ready, the PvE vote, the event vote (and its
 * follow-up). This stands in for the real run flow (main menu, Core
 * placement and event screens, issue #25), which will replace it.
 *
 * It only reads the run state and sends intents; it decides nothing about the
 * rules.
 */
import { listLegalCorePositions } from '@game/core';
import type { DispatchResult, Intent, Json, RunState } from '@game/session';
import { content } from '../content.js';

/** Which battle the shop leads into. */
export type NextBattle = 'pve' | 'pvp';

export interface DriveTarget {
  /**
   * `pvp`: stop in the first shop of the run (it follows the PvE leg).
   * `pve`: stop in the shop that ends round 1 (the next battle is PvE).
   */
  readonly next: NextBattle;
}

function isRecord(v: Json | undefined): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function firstId(list: Json | undefined): string | null {
  if (!Array.isArray(list)) return null;
  const first: Json | undefined = (list as Json[])[0];
  return isRecord(first) && typeof first['id'] === 'string'
    ? first['id']
    : null;
}

/** The next intent of the default path, or null when nothing applies. */
export function nextIntent(state: RunState): Intent | null {
  const pending = isRecord(state.pending) ? state.pending : {};
  switch (state.step) {
    case 'core_placement': {
      const pos = listLegalCorePositions(
        state.team.map,
        content,
        content.mapgen,
      )[0];
      return pos === undefined
        ? null
        : { type: 'propose_core', x: pos.x, y: pos.y };
    }
    case 'pve_choice':
      return { type: 'vote', choice: 'medium' };
    case 'event_choice': {
      const id = firstId(pending['options']);
      return id === null ? null : { type: 'vote', choice: id };
    }
    case 'event_resolve': {
      const fu = pending['followUp'];
      // A per-player follow-up (Workshop, issue #50): skip.
      const id = isRecord(fu)
        ? fu['perPlayer'] === true
          ? 'skip'
          : firstId(fu['options'])
        : null;
      return id === null ? null : { type: 'event_choose', choice: id };
    }
    case 'build':
    case 'shop':
    case 'pve_summary':
    case 'pvp_summary':
      return { type: 'ready' };
    default:
      return null;
  }
}

function atTarget(state: RunState, target: DriveTarget): boolean {
  if (state.step !== 'shop') return false;
  return target.next === 'pvp' ? state.leg === 'pve' : state.leg === 'pvp';
}

/**
 * Send intents (solo run, player 0) until the run is in the target shop.
 * Throws if an intent is refused or the run gets stuck.
 */
export async function driveToShop(
  getState: () => RunState,
  dispatch: (intent: Intent) => Promise<DispatchResult>,
  target: DriveTarget,
): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const state = getState();
    if (atTarget(state, target)) return;
    const intent = nextIntent(state);
    if (intent === null) {
      throw new Error(`setup: no move in step "${state.step}"`);
    }
    const r = await dispatch(intent);
    if (!r.ok) {
      throw new Error(
        `setup: ${intent.type} refused in "${state.step}": ${r.reason}`,
      );
    }
  }
  throw new Error('setup: did not reach the shop');
}
