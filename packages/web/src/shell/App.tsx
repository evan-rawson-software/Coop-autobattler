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
  const switcher =
    screens.length < 2 ? null : (
      <select
        class="screen-switcher"
        aria-label="Screen"
        value={screen}
        onChange={(e) => {
          screenStore.set(e.currentTarget.value);
        }}
      >
        {screens.map((s) => (
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
