/**
 * Undo and redo for layout changes only (RS-5g). Undo works by dispatching
 * inverse intents, so the result is itself saved and logged; the action log
 * grows. Moving, rotating or returning a building detaches its conduits, so
 * the inverse also re-adds them.
 *
 * Actions are described symbolically (building IDs are stable; conduits are
 * found by their ends and cells) because a re-added conduit gets a new ID.
 * Consequently conduit IDs and `nextId` are not restored by undo; the layout
 * (`layoutHash`) is.
 */

import {
  hashJson,
  type Cell,
  type ConduitEnd,
  type TeamState,
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
      readonly from: ConduitEnd;
      readonly to: ConduitEnd;
      readonly cells: readonly Cell[];
    };

export interface ConduitSig {
  readonly from: ConduitEnd;
  readonly to: ConduitEnd;
  readonly cells: readonly Cell[];
}

const sigKey = (c: ConduitSig): string =>
  JSON.stringify([
    c.from.building,
    c.from.side,
    c.to.building,
    c.to.side,
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
      return { type: 'add_conduit', from: a.from, to: a.to, cells: a.cells };
    case 'erase': {
      const c = findConduit(state, a);
      return c === undefined ? null : { type: 'erase_conduit', id: c.id };
    }
  }
}

function attached(before: TeamState, id: number): LayoutAction[] {
  return before.conduits
    .filter((c) => c.from.building === id || c.to.building === id)
    .map((c) => ({
      t: 'add' as const,
      from: c.from,
      to: c.to,
      cells: c.cells,
    }));
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

export type ApplyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };

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
    this.undoList.push({ redo: action, undo: inverseOf(before, action) });
    this.redoList = [];
  }

  /** Forget everything: a step ended, or buying/selling/re-rolling happened. */
  clear(): void {
    this.undoList = [];
    this.redoList = [];
  }

  /**
   * Undo the latest layout change by applying its inverse. If an inverse is
   * rejected (should not happen) the stack is cleared, since the history can no
   * longer be trusted, and the rejection is returned.
   */
  async undo(
    apply: (actions: readonly LayoutAction[]) => Promise<ApplyResult>,
  ): Promise<ApplyResult | null> {
    const entry = this.undoList.pop();
    if (entry === undefined) return null;
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
  ): Promise<ApplyResult | null> {
    const entry = this.redoList.pop();
    if (entry === undefined) return null;
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
 * cells). It leaves out conduit IDs and the ID counter, which undo cannot
 * restore, so equal hashes mean the same factory.
 */
export function layoutHash(team: TeamState): string {
  const conduits = team.conduits
    .map((c) => sigKey(c))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return hashJson({
    core: team.core,
    buildings: team.buildings,
    stash: team.stash,
    conduits,
  });
}
