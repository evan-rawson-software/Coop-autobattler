/**
 * The sample route `#shop`: the Build screen on the shared run, with the shop
 * of the shop step. Loads the run if this page was opened directly (a reload).
 */
import { useEffect } from 'preact/hooks';
import { RunGate } from '../run/RunGate.js';
import { ensureShopRun, optionsFromUrl } from '../run/shop-run.js';
import { BuildView } from './BuildScreen.js';

export function ShopBuildScreen() {
  useEffect(() => {
    void ensureShopRun(optionsFromUrl(window.location.search));
  }, []);
  return <RunGate>{(run) => <BuildView shared={run} standalone />}</RunGate>;
}
