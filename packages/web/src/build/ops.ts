/**
 * Previews: call the pure `core` operations on the current team state to learn
 * whether an action would be accepted and why not. Nothing here changes
 * anything and nothing here decides legality; `core` answers.
 */

import {
  addConduit,
  moveBuilding,
  placeFromStash,
  type Cell,
  type ConduitEnd,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';

export type Verdict =
  | { readonly ok: true; readonly state: TeamState }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };

function fail(r: { reason: string; detail?: string }): Verdict {
  return r.detail === undefined
    ? { ok: false, reason: r.reason }
    : { ok: false, reason: r.reason, detail: r.detail };
}

export interface PlaceArgs {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/** Would placing a stashed building here be accepted? */
export function previewPlace(
  state: TeamState,
  content: WebContent,
  args: PlaceArgs,
): Verdict {
  const r = placeFromStash(state, content, args);
  return r.ok ? { ok: true, state: r.state } : fail(r);
}

/** Would moving and/or rotating a placed building be accepted? */
export function previewMove(
  state: TeamState,
  content: WebContent,
  args: PlaceArgs,
): Verdict {
  const r = moveBuilding(state, content, args);
  return r.ok ? { ok: true, state: r.state } : fail(r);
}

/** Would this conduit be accepted? The exact reason and cell come from core. */
export function previewConduit(
  state: TeamState,
  content: WebContent,
  from: ConduitEnd,
  to: ConduitEnd,
  cells: readonly Cell[],
): Verdict {
  const r = addConduit(state, content, { from, to, cells });
  return r.ok ? { ok: true, state: r.state } : fail(r);
}
