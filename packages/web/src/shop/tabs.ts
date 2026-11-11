/** The two tabs of the Shop + Build step, shared by both screens. */
import { screenStore } from '../app-state.js';
import type { TabDef } from '../shell/AppShell.js';

export const SHOP_SCREEN = 'shop';
export const BUILD_TAB_SCREEN = 'shop-build';

export function stepTabs(): TabDef[] {
  return [
    { id: SHOP_SCREEN, label: 'Shop' },
    { id: BUILD_TAB_SCREEN, label: 'Build' },
  ];
}

export function onStepTab(id: string): void {
  screenStore.set(id);
}
