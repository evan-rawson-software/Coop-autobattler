/** The registry of screens. Real screens are added here by later issues. */

import type { ComponentType } from 'preact';
import { BattleSampleScreen } from '../battle/BattleScreen.js';
import { BuildScreen } from '../build/BuildScreen.js';
import { ShopBuildScreen } from '../build/ShopBuildScreen.js';
import { MainMenuScreen } from '../menu/MainMenu.js';
import { RunScreen } from '../run/RunScreen.js';
import { DebugScreen } from '../screens/DebugScreen.js';
import { ShopScreen } from '../shop/ShopScreen.js';
import type { ScreenId } from '../app-state.js';
import { lazyScreen } from './lazy-screen.js';

export interface ScreenDef {
  readonly id: ScreenId;
  readonly name: string;
  readonly component: ComponentType;
}

export const screens: readonly ScreenDef[] = [
  { id: 'menu', name: 'Main menu', component: MainMenuScreen },
  { id: 'run', name: 'Run', component: RunScreen },
  { id: 'debug', name: 'Debug', component: DebugScreen },
  { id: 'build', name: 'Build', component: BuildScreen },
  { id: 'shop', name: 'Shop', component: ShopScreen },
  { id: 'shop-build', name: 'Shop · Build tab', component: ShopBuildScreen },
  { id: 'battle', name: 'Battle', component: BattleSampleScreen },
  {
    id: 'sprites',
    name: 'Sprites',
    component: lazyScreen('Sprites', () =>
      import('../sprites/SpritesScreen.js').then((m) => m.SpritesScreen),
    ),
  },
];
