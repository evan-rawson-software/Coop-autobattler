/**
 * A small read-only window into the running page for the smoke script. It is
 * only installed in dev and in builds made with `--mode debug`; a normal
 * production build drops it.
 */

import type { Camera } from './board/camera.js';
import type { Hit } from './board/scene.js';
import type { Selection } from './board/render.js';

export interface DebugHook {
  camera?: () => Camera;
  viewport?: () => { w: number; h: number };
  hovered?: () => Hit | null;
  selection?: () => Selection | null;
  /** Mean and count of canvas draw times in milliseconds. */
  drawStats?: () => { count: number; meanMs: number; maxMs: number };
  resetDrawStats?: () => void;
  /** Switch the debug screen's sample to the dense one. */
  setDense?: (dense: boolean) => void;
  /** Number of buildings and conduit cells in the own board. */
  counts?: () => { buildings: number; conduits: number; conduitCells: number };
  build?: BuildDebug;
  shop?: ShopDebug;
}

/** Read-only view of the Build screen for the smoke script. */
export interface BuildDebug {
  step: () => string;
  /** Hash of the layout (see build/undo.ts `layoutHash`). */
  hash: () => string;
  team: () => unknown;
  status: () => { text: string; kind: string };
  ui: () => unknown;
  counts: () => { undo: number; redo: number; actions: number };
  /** Client pixel position of the centre of a board cell. */
  cellToScreen: (x: number, y: number) => { x: number; y: number } | null;
  problems: () => readonly { id: string; kind: string; text: string }[];
  legalCore: () => readonly { x: number; y: number }[];
  enemyPathCount: () => number;
  dry: () => unknown;
}

/** Read-only view of the Shop tab for the smoke script. */
export interface ShopDebug {
  /** Which mount of the Shop tab this is (1, 2, ...): changes on every remount. */
  mounts: () => number;
  /** Plain data: step, gold, offers, stash, ready flag, action count, undo depth. */
  state: () => unknown;
}

declare global {
  interface Window {
    __debug?: DebugHook;
  }
}

export const DEBUG_HOOK: boolean =
  import.meta.env.DEV || import.meta.env.MODE === 'debug';

export function registerDebug(patch: DebugHook): void {
  if (!DEBUG_HOOK) return;
  window.__debug = { ...window.__debug, ...patch };
}

/** Remove hooks that belong to a screen that has gone away. */
export function unregisterDebug(...keys: (keyof DebugHook)[]): void {
  if (!DEBUG_HOOK || window.__debug === undefined) return;
  window.__debug = Object.fromEntries(
    Object.entries(window.__debug).filter(
      ([k]) => !(keys as string[]).includes(k),
    ),
  );
}
