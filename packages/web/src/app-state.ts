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

export const DEFAULT_SCREEN: ScreenId = 'debug';

export const screenStore: Store<ScreenId> =
  createStore<ScreenId>(DEFAULT_SCREEN);

/** Read the hash, if it names one of `known`, into the store; then follow it. */
export function bindScreenToHash(known: readonly ScreenId[]): void {
  const fromHash = (): void => {
    const name = window.location.hash.replace(/^#/, '');
    if (known.includes(name)) screenStore.set(name);
  };
  fromHash();
  window.addEventListener('hashchange', fromHash);
  screenStore.subscribe((id) => {
    if (window.location.hash !== `#${id}`) {
      history.replaceState(null, '', `#${id}`);
    }
  });
}
