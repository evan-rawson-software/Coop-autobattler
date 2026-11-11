/** The two tabs of the Shop + Build step, shared by both screens. */
import { createStore, screenStore } from '../app-state.js';
import type { TabDef } from '../shell/AppShell.js';

export const SHOP_SCREEN = 'shop';
export const BUILD_TAB_SCREEN = 'shop-build';

/**
 * The tab shown in the real run (the run screen holds both tabs of the shop
 * step). On the sample routes each tab is a screen of its own instead.
 */
export const stepTabStore = createStore<string>(SHOP_SCREEN);

export function stepTabs(): TabDef[] {
  return [
    { id: SHOP_SCREEN, label: 'Shop' },
    { id: BUILD_TAB_SCREEN, label: 'Build' },
  ];
}

export function onStepTab(id: string): void {
  if (screenStore.get() === 'run') stepTabStore.set(id);
  else screenStore.set(id);
}
