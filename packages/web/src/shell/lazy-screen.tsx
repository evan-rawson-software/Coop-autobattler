/**
 * A screen loaded on first use with a dynamic `import()`, so its code (and any
 * data it pulls in) stays out of the main bundle. Until it arrives the screen
 * shows the shell with a loading note.
 */

import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { AppShell } from './AppShell.js';

export function lazyScreen(
  title: string,
  load: () => Promise<ComponentType>,
): ComponentType {
  let loaded: ComponentType | undefined;
  return function LazyScreen() {
    const [Screen, setScreen] = useState<ComponentType | undefined>(
      () => loaded,
    );
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (loaded) return;
      let live = true;
      load().then(
        (c) => {
          loaded = c;
          if (live) setScreen(() => c);
        },
        () => {
          if (live) setFailed(true);
        },
      );
      return () => {
        live = false;
      };
    }, []);
    if (Screen) return <Screen />;
    return (
      <AppShell title={title}>
        <p class="note">
          {failed ? `Could not load the ${title} screen.` : 'Loading…'}
        </p>
      </AppShell>
    );
  };
}
