/**
 * The frame every screen shares: a top bar (title, optional tabs, status),
 * a main area for the board view, docks on the left, right and bottom that
 * screens fill with panels, and the build-identifier footer.
 */

import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';

export interface TabDef {
  readonly id: string;
  readonly label: string;
  /** A tab that exists but cannot be opened yet; `hint` says why. */
  readonly disabled?: boolean;
  readonly hint?: string;
}

export interface AppShellProps {
  readonly title: string;
  readonly tabs?: readonly TabDef[];
  readonly activeTab?: string;
  readonly onTab?: (id: string) => void;
  /** Right side of the top bar, e.g. round, lives, ready count. */
  readonly status?: ComponentChildren;
  /** Taller bottom dock for screens with several panel rows. */
  readonly tallBottom?: boolean;
  readonly left?: ComponentChildren;
  readonly right?: ComponentChildren;
  readonly bottom?: ComponentChildren;
  /** The main area, normally a board view. */
  readonly children?: ComponentChildren;
}

/** Set by the app root: a screen switcher, or nothing with a single screen. */
export const SwitcherContext = createContext<ComponentChildren>(null);

/**
 * Set by the run screen: the run's bar (round, lives, gold, step, Menu). It
 * replaces the screen switcher and sits at the right of every top bar.
 */
export const RunBarContext = createContext<ComponentChildren>(null);

export function AppShell(props: AppShellProps) {
  const { tabs = [], left, right, bottom } = props;
  const switcher = useContext(SwitcherContext);
  const runBar = useContext(RunBarContext);
  return (
    <div class="app">
      <header class={runBar ? 'topbar has-run-bar' : 'topbar'}>
        <div class="topbar-left">
          {runBar ? null : switcher}
          <h1 class="topbar-title">{props.title}</h1>
        </div>
        <nav class="topbar-tabs" aria-label="Sections">
          {tabs.map((t) => (
            <button
              type="button"
              key={t.id}
              class={t.id === props.activeTab ? 'tab active' : 'tab'}
              aria-pressed={t.id === props.activeTab}
              disabled={t.disabled === true}
              title={t.hint}
              onClick={() => props.onTab?.(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div class="topbar-status">
          {props.status}
          {runBar}
        </div>
      </header>
      <div class="main">
        <main class="main-view">{props.children}</main>
        {left ? <Dock region="left">{left}</Dock> : null}
        {right ? <Dock region="right">{right}</Dock> : null}
        {bottom ? (
          <Dock region="bottom" tall={props.tallBottom}>
            {bottom}
          </Dock>
        ) : null}
      </div>
      <footer class="build-id" id="build-id">
        Build {__BUILD_COMMIT__} · {__BUILD_DATE__}
      </footer>
    </div>
  );
}

export type DockRegion = 'left' | 'right' | 'bottom';

/** A named dock region; screens put `Panel`s in it. */
export function Dock(props: {
  region: DockRegion;
  tall?: boolean | undefined;
  children?: ComponentChildren;
}) {
  return (
    <aside
      class={`dock dock-${props.region}${props.tall === true ? ' tall' : ''}`}
      data-dock={props.region}
    >
      {props.children}
    </aside>
  );
}

export function Panel(props: {
  title: string;
  children?: ComponentChildren;
  class?: string;
  id?: string;
}) {
  return (
    <section class={`panel ${props.class ?? ''}`} id={props.id}>
      <h2 class="panel-title">{props.title}</h2>
      <div class="panel-body">{props.children}</div>
    </section>
  );
}
