import type { BuiltinIntentType, Step } from './types.js';

const BOARD: readonly BuiltinIntentType[] = [
  'place_building',
  'move_building',
  'return_building',
  'add_conduit',
  'erase_conduit',
];

const BUILD_LIKE: readonly BuiltinIntentType[] = [
  'ready',
  'unready',
  ...BOARD,
  'abandon',
];

/**
 * Which built-in intents are legal in which step. Anything else is rejected
 * with `wrong_step`. (Whether the intent is useful to a given player right
 * now, such as `unready` before readying, is checked by the machine.)
 */
export const STEP_INTENTS: Readonly<
  Record<Step, readonly BuiltinIntentType[]>
> = {
  core_placement: ['propose_core', 'vote', 'abandon'],
  build: BUILD_LIKE,
  pve_choice: ['vote', 'abandon'],
  pve_battle: ['abandon'],
  pve_summary: ['ready', 'unready', 'abandon'],
  event_choice: ['vote', 'abandon'],
  event_resolve: ['abandon'],
  shop: BUILD_LIKE,
  pvp_battle: ['abandon'],
  pvp_summary: ['ready', 'unready', 'abandon'],
  run_over: [],
};

/** The steps in which a player's Ready flag locks their own editing (#58). */
export const READY_LOCK_STEPS: readonly Step[] = ['build', 'shop'];

/**
 * True if `type` is refused for a player who is Ready in `step`: in a build
 * or shop step a Ready player may only unready (or abandon, for the host).
 * Every other intent, built-in or from an extension handler, is locked.
 */
export function lockedWhileReady(step: Step, type: string): boolean {
  return (
    READY_LOCK_STEPS.includes(step) &&
    type !== 'unready' &&
    type !== 'ready' &&
    type !== 'abandon'
  );
}
