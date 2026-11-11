import { useEffect } from 'preact/hooks';
import { bindScreenToHash, screenStore, useStore } from '../app-state.js';
import { SwitcherContext } from './AppShell.js';
import { screens } from './screens.js';

/** The root: picks the screen named by the single `screen` value. */
export function App() {
  const screen = useStore(screenStore);
  useEffect(() => {
    bindScreenToHash(screens.map((s) => s.id));
  }, []);
  const def = screens.find((s) => s.id === screen) ?? screens[0];
  if (!def) return null;
  const Screen = def.component;
  // The switcher is for the developer screens; the menu and the run have
  // their own way around.
  const isDev = screen !== 'menu' && screen !== 'run';
  const switcher =
    screens.length < 2 || !isDev ? null : (
      <select
        class="screen-switcher"
        aria-label="Screen"
        value={screen}
        onChange={(e) => {
          screenStore.set(e.currentTarget.value);
        }}
      >
        {screens
          .filter((s) => s.id !== 'run')
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
    );
  return (
    <SwitcherContext.Provider value={switcher}>
      <Screen />
    </SwitcherContext.Provider>
  );
}
