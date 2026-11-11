/**
 * App state in plain modules: one `screen` value, no router or state library.
 * `#name` in the URL hash is read at start-up and kept in sync for
 * convenience.
 */

import { useEffect, useState } from 'preact/hooks';

export type ScreenId = string;

export interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(fn: (value: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      for (const fn of listeners) fn(value);
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => {
    setValue(store.get());
    return store.subscribe(setValue);
  }, [store]);
  return value;
}

export const DEFAULT_SCREEN: ScreenId = 'menu';

export const screenStore: Store<ScreenId> =
  createStore<ScreenId>(DEFAULT_SCREEN);

/**
 * The screen name of a hash: `#battle?p=1` names `battle`, an empty hash or
 * `#/` is the main menu, and `#run/<id>` is the run screen.
 */
export function screenOfHash(hash: string): string {
  const name = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  if (name === '') return 'menu';
  if (name.startsWith('run/')) return 'run';
  return name;
}

/** The hash as a store, so a screen can follow `#run/<id>` changes. */
export const hashStore: Store<string> = createStore<string>(
  typeof window === 'undefined' ? '' : window.location.hash,
);

/** Go to a hash (a normal navigation: the back button returns). */
export function navigate(hash: string): void {
  window.location.hash = hash;
}

/** Read the hash, if it names one of `known`, into the store; then follow it. */
export function bindScreenToHash(known: readonly ScreenId[]): void {
  const fromHash = (): void => {
    hashStore.set(window.location.hash);
    const name = screenOfHash(window.location.hash);
    if (known.includes(name)) screenStore.set(name);
  };
  fromHash();
  window.addEventListener('hashchange', fromHash);
  screenStore.subscribe((id) => {
    // A screen may keep its own parameters after `?`; keep them while the
    // screen does not change.
    if (screenOfHash(window.location.hash) !== id) {
      history.replaceState(null, '', id === 'menu' ? '#/' : `#${id}`);
      hashStore.set(window.location.hash);
    }
  });
}
