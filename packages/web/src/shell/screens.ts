/** The registry of screens. Real screens are added here by later issues. */

import type { ComponentType } from 'preact';
import { BuildScreen } from '../build/BuildScreen.js';
import { DebugScreen } from '../screens/DebugScreen.js';
import type { ScreenId } from '../app-state.js';

export interface ScreenDef {
  readonly id: ScreenId;
  readonly name: string;
  readonly component: ComponentType;
}

export const screens: readonly ScreenDef[] = [
  { id: 'debug', name: 'Debug', component: DebugScreen },
  { id: 'build', name: 'Build', component: BuildScreen },
];
