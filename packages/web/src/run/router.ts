/**
 * Which screen shows for a run: the current step of the run decides. Pure; no
 * screen keeps a copy of the run state. Also the run's route (`#run/<id>`) and
 * the words for each step.
 */
import type { Step } from '@game/session';

export type RunScreenId =
  | 'core'
  | 'build'
  | 'shop'
  | 'shop_build'
  | 'pve_choice'
  | 'battle'
  | 'event_choice'
  | 'event_resolve'
  | 'run_over'
  /** `pve_battle` and `pvp_battle` are never saved; no screen of their own. */
  | 'transient';

/** The two tabs of the shop step. */
export type ShopTab = 'shop' | 'shop_build';

/** The screen for a step. In the shop step `tab` picks Shop or Build. */
export function screenForStep(step: Step, tab: ShopTab = 'shop'): RunScreenId {
  switch (step) {
    case 'core_placement':
      return 'core';
    case 'build':
      return 'build';
    case 'shop':
      return tab;
    case 'pve_choice':
      return 'pve_choice';
    case 'pve_summary':
    case 'pvp_summary':
      return 'battle';
    case 'event_choice':
      return 'event_choice';
    case 'event_resolve':
      return 'event_resolve';
    case 'run_over':
      return 'run_over';
    case 'pve_battle':
    case 'pvp_battle':
      return 'transient';
  }
}

/** The name of a step for the top bar. */
export function stepLabel(step: Step): string {
  switch (step) {
    case 'core_placement':
      return 'Place the Core';
    case 'build':
      return 'Build';
    case 'pve_choice':
      return 'Choose a PvE battle';
    case 'pve_battle':
    case 'pve_summary':
      return 'PvE battle';
    case 'event_choice':
      return 'Event';
    case 'event_resolve':
      return 'Event';
    case 'shop':
      return 'Shop and build';
    case 'pvp_battle':
    case 'pvp_summary':
      return 'PvP battle';
    case 'run_over':
      return 'Run over';
  }
}

// ---------------------------------------------------------------------------
// Routes

const RUN_PREFIX = 'run/';

/** `#run/<id>` for a run. */
export function runHash(runId: string): string {
  return `#${RUN_PREFIX}${encodeURIComponent(runId)}`;
}

/** The run a hash names, or null. */
export function runIdFromHash(hash: string): string | null {
  const body = (hash.replace(/^#\/?/, '').split('?')[0] ?? '').trim();
  if (!body.startsWith(RUN_PREFIX)) return null;
  const id = body.slice(RUN_PREFIX.length);
  if (id === '') return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return null;
  }
}

/**
 * The seed asked for in the hash of the menu (`#/?seed=5`), for a run that
 * must be the same every time (tests, sharing a seed). Null when absent or
 * not a u32.
 */
export function seedFromHash(hash: string): number | null {
  const q = hash.indexOf('?');
  if (q < 0) return null;
  const text = new URLSearchParams(hash.slice(q + 1)).get('seed');
  if (text === null || !/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 0 && n < 2 ** 32 ? n : null;
}
