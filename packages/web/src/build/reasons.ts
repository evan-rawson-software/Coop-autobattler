/**
 * Rejection reasons mapped to short human-readable messages: the ONLY place
 * reason strings are turned into text. This is UI wording, not rules. The
 * table is typed over every reason `core` placement, Core placement, stash and
 * conduit operations can return, and every built-in `session` rejection, so
 * adding a reason there breaks the build here until it has a message.
 */

import type { BuiltinReason } from '@game/session';

export type KnownReason = BuiltinReason | 'save_failed';

export const REASON_MESSAGES: Readonly<Record<KnownReason, string>> = {
  // Placement
  unknown_building: 'That building does not exist.',
  invalid_rotation: 'That rotation is not allowed.',
  out_of_bounds: 'Outside the board.',
  blocked_by_feature: 'Water and cliffs cannot be built on.',
  overlaps_core: 'The Core is in the way.',
  overlaps_building: 'Another building is in the way.',
  overlaps_conduit: 'A conduit is in the way.',
  source_needs_node: 'Extractors only go on a resource node.',
  node_reserved: 'Resource nodes are kept for extractors.',
  // Core placement
  core_already_placed: 'The Core is already placed.',
  blocked: 'The Core cannot sit on water or cliffs.',
  on_node: 'The Core cannot sit on a resource node.',
  too_far_forward: 'Too close to the front edge for the Core.',
  // Stash
  unknown_definition: 'Unknown building type.',
  core_not_allowed: 'The Core cannot be bought or stashed.',
  invalid_tier: 'That tier does not exist.',
  invalid_owner: 'That owner does not exist.',
  // Conduits
  not_an_output: 'That side does not send anything out.',
  not_an_input: 'That side does not take anything in.',
  side_in_use: 'That side already has a conduit.',
  invalid_path: 'The path is not a valid line of free cells.',
  crosses_conduit: 'Conduits cannot cross another conduit.',
  resource_mismatch: 'Mixed resources: this input needs a different one.',
  would_loop: 'That would make the flow loop back on itself.',
  unknown_conduit: 'That conduit does not exist.',
  // Session
  wrong_step: 'Not possible in this step.',
  not_a_player: 'Not a player of this run.',
  not_host: 'Only the host can do that.',
  already_ready: 'Already ready.',
  not_ready: 'Not ready yet.',
  locked_ready: 'You are Ready. Unready to change anything.',
  sealed_producer: 'A unit producer is walled in. Open a way out first.',
  invalid_intent: 'That action is not valid.',
  invalid_choice: 'That choice is not valid.',
  unknown_intent: 'Unknown action.',
  save_failed: 'The run could not be saved. Try again.',
};

export const KNOWN_REASONS = Object.keys(REASON_MESSAGES) as KnownReason[];

/** Parse the `(x, y)` that core puts in a failure's `detail`, if present. */
export function parseCell(detail: string): { x: number; y: number } | null {
  const m = /^\((-?\d+), (-?\d+)\)$/.exec(detail);
  if (m === null) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Message for a reason, with the offending cell when `core` gave one. */
export function reasonMessage(reason: string, detail?: string): string {
  const base: string | undefined = (
    REASON_MESSAGES as Readonly<Record<string, string>>
  )[reason];
  const text = base ?? `Not allowed (${reason}).`;
  const cell = detail === undefined ? null : parseCell(detail);
  return cell === null
    ? text
    : `${text} At (${String(cell.x)}, ${String(cell.y)}).`;
}
