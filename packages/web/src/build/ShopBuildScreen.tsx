/**
 * The Build tab of the Shop step: the Build screen on the shared run. Loads
 * the run if this page was opened directly on this tab (a reload).
 */
import { useEffect } from 'preact/hooks';
import { useStore } from '../app-state.js';
import {
  ensureShopRun,
  optionsFromUrl,
  shopRunStore,
} from '../run/shop-run.js';
import { AppShell } from '../shell/AppShell.js';
import { BuildView } from './BuildScreen.js';

export function ShopBuildScreen() {
  const state = useStore(shopRunStore);
  useEffect(() => {
    void ensureShopRun(optionsFromUrl(window.location.search));
  }, []);
  if (state.status === 'error') {
    return (
      <AppShell title="Shop + Build">
        <p class="error">Could not set up the run: {state.message}</p>
      </AppShell>
    );
  }
  if (state.status === 'loading') {
    return (
      <AppShell title="Shop + Build">
        <p class="muted pad">Setting up a run in the shop.</p>
      </AppShell>
    );
  }
  return <BuildView shared={state.run} />;
}
