/** State of the debug screen, kept in a plain store. */

import { createStore } from '../app-state.js';
import type { Selection } from '../board/render.js';
import type { Hit } from '../board/scene.js';

export interface DebugState {
  readonly seed: number;
  readonly partySize: number;
  readonly showEnemy: boolean;
  readonly dense: boolean;
  readonly hover: Hit | null;
  readonly selection: Selection | null;
}

export const debugStore = createStore<DebugState>({
  seed: 1,
  partySize: 1,
  showEnemy: false,
  dense: false,
  hover: null,
  selection: null,
});

export function patchDebug(patch: Partial<DebugState>): void {
  debugStore.set({ ...debugStore.get(), ...patch });
}
