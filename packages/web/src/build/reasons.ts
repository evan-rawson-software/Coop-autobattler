/**
 * Rejection reasons mapped to short human-readable messages: the ONLY place
 * reason strings are turned into text. This is UI wording, not rules. The
 * table is typed over every reason `core` placement, Core placement, stash and
 * conduit operations can return, and every built-in `session` rejection, so
 * adding a reason there breaks the build here until it has a message.
 */

import type { BuiltinReason } from '@game/session';
import { screenText, screenTexts } from './texts.js';

export type KnownReason =
  | BuiltinReason
  | 'save_failed'
  | 'invalid_state'
  | 'ghost_selection_pending'
  | 'already_selected'
  | 'replay_mismatch'
  | 'core_not_placed';

/** The message of a reason code, from the presentation file. */
const reason = (code: KnownReason): string =>
  screenText(screenTexts, `reason_${code}`);

export const REASON_MESSAGES: Readonly<Record<KnownReason, string>> = {
  // Placement
  unknown_building: reason('unknown_building'),
  invalid_rotation: reason('invalid_rotation'),
  not_owner: reason('not_owner'),
  outside_own_plot: reason('outside_own_plot'),
  out_of_bounds: reason('out_of_bounds'),
  blocked_by_feature: reason('blocked_by_feature'),
  overlaps_core: reason('overlaps_core'),
  overlaps_building: reason('overlaps_building'),
  overlaps_conduit: reason('overlaps_conduit'),
  invalid_border: reason('invalid_border'),
  border_spot_in_use: reason('border_spot_in_use'),
  source_needs_node: reason('source_needs_node'),
  node_reserved: reason('node_reserved'),
  // Core placement
  core_already_placed: reason('core_already_placed'),
  core_not_placed: reason('core_not_placed'),
  blocked: reason('blocked'),
  on_node: reason('on_node'),
  too_far_forward: reason('too_far_forward'),
  // Stash
  unknown_definition: reason('unknown_definition'),
  core_not_allowed: reason('core_not_allowed'),
  invalid_tier: reason('invalid_tier'),
  invalid_owner: reason('invalid_owner'),
  // Conduits
  not_an_output: reason('not_an_output'),
  not_an_input: reason('not_an_input'),
  side_in_use: reason('side_in_use'),
  invalid_path: reason('invalid_path'),
  crosses_conduit: reason('crosses_conduit'),
  resource_mismatch: reason('resource_mismatch'),
  would_loop: reason('would_loop'),
  unknown_conduit: reason('unknown_conduit'),
  // Session
  wrong_step: reason('wrong_step'),
  not_a_player: reason('not_a_player'),
  not_host: reason('not_host'),
  already_ready: reason('already_ready'),
  not_ready: reason('not_ready'),
  locked_ready: reason('locked_ready'),
  sealed_producer: reason('sealed_producer'),
  invalid_intent: reason('invalid_intent'),
  invalid_choice: reason('invalid_choice'),
  unknown_intent: reason('unknown_intent'),
  save_failed: reason('save_failed'),
  // Run controller and opponent selection
  invalid_state: reason('invalid_state'),
  ghost_selection_pending: reason('ghost_selection_pending'),
  already_selected: reason('already_selected'),
  replay_mismatch: reason('replay_mismatch'),
};

export const KNOWN_REASONS = Object.keys(REASON_MESSAGES) as KnownReason[];

/** Parse the `(x, y)` that core puts in a failure's `detail`, if present. */
export function parseCell(detail: string): { x: number; y: number } | null {
  const m = /^\((-?\d+), (-?\d+)\)$/.exec(detail);
  if (m === null) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Why the opponent could not be chosen (a `SelectionFailure`). */
export interface SelectionCause {
  readonly reason: string;
  readonly detail?: string;
}

/**
 * Message for a reason, with the offending cell when `core` gave one. For
 * `ghost_selection_pending` a known `cause` (why choosing the opponent
 * failed) is added.
 */
export function reasonMessage(
  code: string,
  detail?: string,
  cause?: SelectionCause,
): string {
  const base: string | undefined = (
    REASON_MESSAGES as Readonly<Record<string, string>>
  )[code];
  const text =
    base ?? screenText(screenTexts, 'reasonUnknown', { reason: code });
  if (code === 'ghost_selection_pending' && cause !== undefined) {
    return screenText(screenTexts, 'reasonWithCause', {
      text,
      cause: reasonMessage(cause.reason, cause.detail),
    });
  }
  // A refused Ready names the player who has to act (`detail` "player N").
  const who = detail === undefined ? null : /^player (\d+)$/.exec(detail);
  if (who !== null) {
    return screenText(screenTexts, 'reasonPlayerToAct', {
      text,
      number: String(Number(who[1]) + 1),
    });
  }
  const cell = detail === undefined ? null : parseCell(detail);
  return cell === null
    ? text
    : screenText(screenTexts, 'reasonAtCell', {
        text,
        x: String(cell.x),
        y: String(cell.y),
      });
}

/** A note for a dispatch that succeeded but left the opponent unchosen. */
export function selectionNote(cause: SelectionCause): string {
  return screenText(screenTexts, 'selectionNote', {
    cause: reasonMessage(cause.reason, cause.detail),
  });
}
