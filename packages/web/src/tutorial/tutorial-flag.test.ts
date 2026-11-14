import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasFinishedFirstRun,
  isTutorialRun,
  markTutorialRun,
} from './tutorial-flag.js';

describe('tutorial flag', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
    });
  });
  it('remembers marked runs only', () => {
    expect(isTutorialRun('a')).toBe(false);
    markTutorialRun('a');
    expect(isTutorialRun('a')).toBe(true);
    expect(isTutorialRun('b')).toBe(false);
  });
  it('survives unreadable storage', () => {
    store.set('coop:tutorial-runs', '{oops');
    expect(isTutorialRun('a')).toBe(false);
  });
  it('a first run is done once history has an entry', () => {
    expect(hasFinishedFirstRun(0)).toBe(false);
    expect(hasFinishedFirstRun(1)).toBe(true);
  });
});
