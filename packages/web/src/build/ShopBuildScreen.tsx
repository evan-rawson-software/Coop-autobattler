/**
 * The Build tab of the Shop step: the Build screen on the shared run. Loads
 * the run if this page was opened directly on this tab (a reload).
 */
import { useEffect } from 'preact/hooks';
import { RunGate } from '../run/RunGate.js';
import { ensureShopRun, optionsFromUrl } from '../run/shop-run.js';
import { BuildView } from './BuildScreen.js';

export function ShopBuildScreen() {
  useEffect(() => {
    void ensureShopRun(optionsFromUrl(window.location.search));
  }, []);
  return <RunGate>{(run) => <BuildView shared={run} />}</RunGate>;
}
