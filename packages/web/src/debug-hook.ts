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
