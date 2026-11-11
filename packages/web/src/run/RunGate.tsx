/**
 * What the Shop and Build tabs share around the saved run: loading and error
 * states, the "this run changed in another tab" stop, the "not saved" note and
 * the confirmed restart. UI only; the run logic is in `shop-run.ts`.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import type { RunHandle } from './handle.js';
import {
  optionsFromUrl,
  reloadShopRun,
  restartShopRun,
  shopRunStore,
  type ShopRun,
} from './shop-run.js';

export const NOT_SAVED_TEXT = 'Not saved — progress is lost on reload';

/** A persistent note when the run is only kept in memory. */
export function NotSavedNote(props: { run: Pick<RunHandle, 'storage'> }) {
  if (props.run.storage !== 'memory') return null;
  return (
    <span class="not-saved" id="not-saved-note" role="note">
      {NOT_SAVED_TEXT}
    </span>
  );
}

function ConflictPanel() {
  return (
    <AppShell title="Shop + Build">
      <div class="run-blocked" id="run-conflict" role="alert">
        <Panel title="This run changed in another tab">
          <p>
            This run was saved from another tab or window, so this one is out of
            date. Nothing here can be changed until you reload it.
          </p>
          <button
            type="button"
            id="run-reload"
            onClick={() => {
              void reloadShopRun(optionsFromUrl(window.location.search));
            }}
          >
            Reload
          </button>
        </Panel>
      </div>
    </AppShell>
  );
}

function UnopenablePanel(props: { message: string }) {
  return (
    <AppShell title="Shop + Build">
      <div class="run-blocked" id="run-unopenable" role="alert">
        <Panel title="The saved run cannot be opened">
          <p data-field="reason">{props.message}</p>
          <p class="muted">
            It has not been deleted. Closing this tab or fixing the cause may
            let it open. Discarding it starts a new sample run and cannot be
            undone.
          </p>
          <button
            type="button"
            id="run-discard"
            class="danger"
            onClick={() => {
              void restartShopRun(optionsFromUrl(window.location.search));
            }}
          >
            Discard and start a new sample run
          </button>
        </Panel>
      </div>
    </AppShell>
  );
}

function ConflictGate(props: {
  run: ShopRun;
  children: (run: ShopRun) => ComponentChildren;
}) {
  const conflict = useStore(props.run.conflict);
  return conflict ? <ConflictPanel /> : <>{props.children(props.run)}</>;
}

/** Renders `children` for a ready, current run; otherwise the matching state. */
export function RunGate(props: {
  children: (run: ShopRun) => ComponentChildren;
}) {
  const state = useStore(shopRunStore);
  switch (state.status) {
    case 'loading':
      return (
        <AppShell title="Shop + Build">
          <p class="muted pad" id="shop-loading">
            Setting up a run in the shop.
          </p>
        </AppShell>
      );
    case 'error':
      return (
        <AppShell title="Shop + Build">
          <p class="error" id="shop-error">
            Could not set up the run: {state.message}
          </p>
        </AppShell>
      );
    case 'unopenable':
      return <UnopenablePanel message={state.message} />;
    case 'ready':
      return <ConflictGate run={state.run}>{props.children}</ConflictGate>;
  }
}

/** "Start a new sample run", with a confirm step: it deletes the save. */
export function RestartButton() {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        id="dev-new-run"
        onClick={() => {
          setAsking(true);
        }}
      >
        Start a new sample run
      </button>
    );
  }
  return (
    <div class="confirm-restart" id="restart-confirm" role="alertdialog">
      <p>
        This deletes the saved run and starts a new sample run. It cannot be
        undone.
      </p>
      <button
        type="button"
        id="dev-new-run-confirm"
        class="danger"
        onClick={() => {
          void restartShopRun(optionsFromUrl(window.location.search));
        }}
      >
        Delete it and start over
      </button>
      <button
        type="button"
        id="dev-new-run-cancel"
        onClick={() => {
          setAsking(false);
        }}
      >
        Keep it
      </button>
    </div>
  );
}
