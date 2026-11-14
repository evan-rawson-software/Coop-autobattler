import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('tutorial store', () => {
  const data = new Map<string, string>();
  beforeEach(() => {
    data.clear();
    vi.resetModules();
    vi.stubGlobal('window', {
      location: { hash: '' },
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => data.set(k, v),
      },
    });
  });

  it('remembers skips per run, across a reload', async () => {
    const a = await import('./tutorial-store.js');
    expect(a.progressOf(a.tutorialStore.get(), 'r1')).toEqual({});
    a.skipTurretStep('r1');
    a.skipTutorial('r2');
    expect(a.progressOf(a.tutorialStore.get(), 'r1').turretSkipped).toBe(true);
    expect(a.progressOf(a.tutorialStore.get(), 'r1').skipped).toBeUndefined();
    // A fresh page reads the same record.
    vi.resetModules();
    const b = await import('./tutorial-store.js');
    expect(b.progressOf(b.tutorialStore.get(), 'r1').turretSkipped).toBe(true);
    expect(b.progressOf(b.tutorialStore.get(), 'r2').skipped).toBe(true);
  });

  it('finishing records the completion for the menu', async () => {
    const a = await import('./tutorial-store.js');
    expect(a.hasCompletedTutorial()).toBe(false);
    a.finishTutorial('r1');
    expect(a.progressOf(a.tutorialStore.get(), 'r1').finished).toBe(true);
    expect(a.hasCompletedTutorial()).toBe(true);
    vi.resetModules();
    const b = await import('./tutorial-store.js');
    expect(b.hasCompletedTutorial()).toBe(true);
  });

  it('skipping does not count as completing', async () => {
    const a = await import('./tutorial-store.js');
    a.skipTutorial('r1');
    expect(a.hasCompletedTutorial()).toBe(false);
  });

  it('survives unreadable and unavailable storage', async () => {
    data.set('coop:tutorial-progress', '{oops');
    const a = await import('./tutorial-store.js');
    expect(a.progressOf(a.tutorialStore.get(), 'r1')).toEqual({});
    vi.stubGlobal('window', {
      location: { hash: '' },
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });
    a.skipTutorial('r1');
    expect(a.progressOf(a.tutorialStore.get(), 'r1').skipped).toBe(true);
  });
});
