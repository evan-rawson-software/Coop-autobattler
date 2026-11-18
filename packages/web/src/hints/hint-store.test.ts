import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('the first-time hint store', () => {
  const store = new Map<string, string>();
  const stub = (): void => {
    vi.stubGlobal('window', {
      location: { hash: '' },
      addEventListener: () => undefined,
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    });
  };
  beforeEach(() => {
    store.clear();
    vi.resetModules();
    stub();
  });

  it('shows each hint once per player: seen survives a reload', async () => {
    let m = await import('./hint-store.js');
    expect(m.hasSeenHint('boss')).toBe(false);
    m.markHintSeen('boss');
    m.markHintSeen('boss');
    expect(m.hasSeenHint('boss')).toBe(true);
    expect(store.get(m.HINTS_SEEN_KEY)).toBe('["boss"]');
    vi.resetModules();
    m = await import('./hint-store.js');
    expect(m.hasSeenHint('boss')).toBe(true);
    expect(m.hasSeenHint('pact')).toBe(false);
  });

  it('"show tips again" makes every hint new, in the phase tips store too', async () => {
    const h = await import('./hint-store.js');
    const tips = await import('../shell/phase-tips.js');
    h.markHintSeen('plotFull');
    h.markHintSeen('vein');
    tips.resetTips();
    expect(h.hasSeenHint('plotFull')).toBe(false);
    expect(h.hasSeenHint('vein')).toBe(false);
  });

  it('keeps the tips-off setting across loads', async () => {
    let m = await import('./hint-store.js');
    expect(m.tipsOffStore.get()).toBe(false);
    m.setTipsOff(true);
    vi.resetModules();
    m = await import('./hint-store.js');
    expect(m.tipsOffStore.get()).toBe(true);
    m.setTipsOff(false);
    expect(store.has(m.TIPS_OFF_KEY)).toBe(false);
  });

  it('survives damaged or blocked storage', async () => {
    store.set('coop:hints-seen', '{oops');
    const m = await import('./hint-store.js');
    expect(m.hasSeenHint('boss')).toBe(false);
    vi.stubGlobal('window', {
      location: { hash: '' },
      addEventListener: () => undefined,
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    });
    m.markHintSeen('boss');
    m.setTipsOff(true);
    expect(m.hasSeenHint('boss')).toBe(true);
    expect(m.tipsOffStore.get()).toBe(true);
  });
});
