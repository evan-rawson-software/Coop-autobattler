/**
 * Undo and redo for layout changes only (RS-5g). Undo works by dispatching
 * inverse intents, so the result is itself saved and logged; the action log
 * grows. Moving, rotating or returning a building detaches its conduits, so
 * the inverse also re-adds them.
 *
 * Undo restores the exact previous team state, ids and counters included.
 * Conduits are found by their ends and cells, and the recorded inverse names
 * each removed conduit's ID so it is re-added under it (`conduitId`); the
 * inverse of an add erases with `reclaim`, handing the newest ID back. Every
 * player has their own conduit ID space (issue #38), so what a teammate does
 * in between can never take an ID that this player's undo needs: an undo is
 * never refused over IDs.
 */

import {
  addConduit,
  eraseConduit,
  hashJson,
  moveBuilding,
  placeFromStash,
  returnToStash,
  type Cell,
  type ConduitEnd,
  type TeamContent,
  type TeamState,
  conduitTouches,
  isBorderEnd,
  type BorderEnd,
} from '@game/core';
import type { BoardIntent } from '@game/session';

export type LayoutAction =
  | {
      readonly t: 'place' | 'move';
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly rotation: number;
    }
  | { readonly t: 'return'; readonly id: number }
  | {
      readonly t: 'add' | 'erase';
      readonly from: ConduitEnd | BorderEnd;
      readonly to: ConduitEnd | BorderEnd;
      readonly cells: readonly Cell[];
      /** An add under this earlier ID (set on recorded inverses only). */
      readonly conduitId?: number;
      /** An erase that hands the newest ID back (inverse of an add). */
      readonly reclaim?: true;
    };

export interface ConduitSig {
  readonly from: ConduitEnd | BorderEnd;
  readonly to: ConduitEnd | BorderEnd;
  readonly cells: readonly Cell[];
}

const endSig = (e: ConduitEnd | BorderEnd): (number | string)[] =>
  isBorderEnd(e) ? [e.border, e.y] : [e.building, e.side];

const sigKey = (c: ConduitSig): string =>
  JSON.stringify([
    ...endSig(c.from),
    ...endSig(c.to),
    c.cells.map((p) => [p.x, p.y]),
  ]);

/** The state's conduit that has these ends and cells, if any. */
export function findConduit(state: TeamState, sig: ConduitSig) {
  const k = sigKey(sig);
  return state.conduits.find((c) => sigKey(c) === k);
}

/** The session intent for an action on the given state, or null if moot. */
export function toIntent(
  state: TeamState,
  a: LayoutAction,
): BoardIntent | null {
  switch (a.t) {
    case 'place':
      return {
        type: 'place_building',
        id: a.id,
        x: a.x,
        y: a.y,
        rotation: a.rotation,
      };
    case 'move':
      return {
        type: 'move_building',
        id: a.id,
        x: a.x,
        y: a.y,
        rotation: a.rotation,
      };
    case 'return':
      return { type: 'return_building', id: a.id };
    case 'add':
      return {
        type: 'add_conduit',
        from: a.from,
        to: a.to,
        cells: a.cells,
        ...(a.conduitId === undefined ? {} : { id: a.conduitId }),
      };
    case 'erase': {
      const c = findConduit(state, a);
      return c === undefined
        ? null
        : {
            type: 'erase_conduit',
            id: c.id,
            ...(a.reclaim === true ? { reclaimId: true } : {}),
          };
    }
  }
}

function attached(before: TeamState, id: number): LayoutAction[] {
  // Halves of border links (PP-4) are re-added like any conduit.
  const out: LayoutAction[] = [];
  for (const c of before.conduits) {
    if (!conduitTouches(c, id)) continue;
    out.push({ t: 'add', from: c.from, to: c.to, cells: c.cells });
  }
  return out;
}

/** Actions that undo `action`, given the state it was applied to. */
export function inverseOf(
  before: TeamState,
  action: LayoutAction,
): LayoutAction[] {
  switch (action.t) {
    case 'place':
      return [{ t: 'return', id: action.id }];
    case 'move': {
      const b = before.buildings.find((x) => x.id === action.id);
      if (b === undefined) return [];
      return [
        { t: 'move', id: b.id, x: b.x, y: b.y, rotation: b.rotation },
        ...attached(before, b.id),
      ];
    }
    case 'return': {
      const b = before.buildings.find((x) => x.id === action.id);
      if (b === undefined) return [];
      return [
        { t: 'place', id: b.id, x: b.x, y: b.y, rotation: b.rotation },
        ...attached(before, b.id),
      ];
    }
    case 'add':
      return [
        { t: 'erase', from: action.from, to: action.to, cells: action.cells },
      ];
    case 'erase':
      return [
        { t: 'add', from: action.from, to: action.to, cells: action.cells },
      ];
  }
}

/**
 * The inverse as recorded: every re-added conduit names the ID it had in
 * `before`, and the erase that undoes an add reclaims its ID.
 */
function withIds(
  before: TeamState,
  action: LayoutAction,
  inverse: readonly LayoutAction[],
): LayoutAction[] {
  return inverse.map((a): LayoutAction => {
    if (a.t === 'add') {
      const c = findConduit(before, a);
      return c === undefined ? a : { ...a, conduitId: c.id };
    }
    return a.t === 'erase' && action.t === 'add' ? { ...a, reclaim: true } : a;
  });
}

export type ApplyResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly detail?: string;
      /** The refusal changed nothing and the history is as it was. */
      readonly kept?: true;
    };

/**
 * Whether the actions would all be accepted, in order, on this team (pure,
 * through the core operations). Undo and redo check this first, so a refusal
 * (a half that the board no longer allows, PP-4) changes nothing.
 */
export function previewActions(
  team: TeamState,
  content: TeamContent,
  actions: readonly LayoutAction[],
  actor: number,
): ApplyResult {
  let state = team;
  for (const a of actions) {
    const r = applyAction(state, content, a, actor);
    if (!r.ok) {
      return r.detail === undefined
        ? { ok: false, reason: r.reason, kept: true }
        : { ok: false, reason: r.reason, detail: r.detail, kept: true };
    }
    state = r.state;
  }
  return { ok: true };
}

/** One action through the core operations (the same ones the intents use). */
export function applyAction(
  state: TeamState,
  content: TeamContent,
  a: LayoutAction,
  actor: number,
):
  | { ok: true; state: TeamState }
  | { ok: false; reason: string; detail?: string } {
  switch (a.t) {
    case 'place':
      return placeFromStash(state, content, { ...a, actor });
    case 'move':
      return moveBuilding(state, content, { ...a, actor });
    case 'return':
      return returnToStash(state, content, { id: a.id, actor });
    case 'add':
      return addConduit(state, content, {
        actor,
        from: a.from,
        to: a.to,
        cells: a.cells,
        ...(a.conduitId === undefined ? {} : { id: a.conduitId }),
      });
    case 'erase': {
      const c = findConduit(state, a);
      return c === undefined
        ? { ok: false, reason: 'unknown_conduit' }
        : eraseConduit(state, {
            actor,
            id: c.id,
            ...(a.reclaim === true ? { reclaimId: true } : {}),
          });
    }
  }
}

export interface UndoEntry {
  readonly redo: LayoutAction;
  readonly undo: readonly LayoutAction[];
}

export class UndoStack {
  private undoList: UndoEntry[] = [];
  private redoList: UndoEntry[] = [];

  get undoCount(): number {
    return this.undoList.length;
  }

  get redoCount(): number {
    return this.redoList.length;
  }

  /** Record an accepted action; `before` is the state it was applied to. */
  record(action: LayoutAction, before: TeamState): void {
    this.undoList.push({
      redo: action,
      undo: withIds(before, action, inverseOf(before, action)),
    });
    this.redoList = [];
  }

  /** Forget everything: a step ended, or buying/selling/re-rolling happened. */
  clear(): void {
    this.undoList = [];
    this.redoList = [];
  }

  /**
   * Undo the latest layout change by applying its inverse. If `check` refuses
   * it, nothing changes and the history is kept. If an inverse is
   * rejected anyway (should not happen) the stack is cleared, since the history can no
   * longer be trusted, and the rejection is returned.
   */
  async undo(
    apply: (actions: readonly LayoutAction[]) => Promise<ApplyResult>,
    check?: (actions: readonly LayoutAction[]) => ApplyResult,
  ): Promise<ApplyResult | null> {
    const entry = this.undoList.pop();
    if (entry === undefined) return null;
    const pre = check?.(entry.undo);
    if (pre !== undefined && !pre.ok) {
      this.undoList.push(entry);
      return pre;
    }
    const r = await apply(entry.undo);
    if (!r.ok) {
      this.clear();
      return r;
    }
    this.redoList.push(entry);
    return r;
  }

  async redo(
    apply: (actions: readonly LayoutAction[]) => Promise<ApplyResult>,
    check?: (actions: readonly LayoutAction[]) => ApplyResult,
  ): Promise<ApplyResult | null> {
    const entry = this.redoList.pop();
    if (entry === undefined) return null;
    const pre = check?.([entry.redo]);
    if (pre !== undefined && !pre.ok) {
      this.redoList.push(entry);
      return pre;
    }
    const r = await apply([entry.redo]);
    if (!r.ok) {
      this.clear();
      return r;
    }
    this.undoList.push(entry);
    return r;
  }
}

/**
 * A hash of the layout: Core, buildings, stash and conduits (by their ends and
 * cells). It leaves out conduit IDs and the ID counter, so equal hashes mean
 * the same factory; the full state hash is the exact check.
 */
export function layoutHash(team: TeamState): string {
  const conduits = team.conduits
    .map((c) => sigKey(c))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return hashJson({
    cores: team.cores,
    buildings: team.buildings,
    stash: team.stash,
    conduits,
  });
}
