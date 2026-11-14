import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  battleNumber,
  nextPhaseAfterResult,
  phaseForStep,
  stepperItems,
  stepperPhases,
} from './phase.js';

describe('phase mapping', () => {
  it('maps every step to a phase', () => {
    expect(phaseForStep('core_placement')).toBe('setup');
    expect(phaseForStep('build')).toBe('build');
    expect(phaseForStep('shop')).toBe('build');
    for (const s of [
      'pve_choice',
      'pve_battle',
      'pve_summary',
      'pvp_battle',
      'pvp_summary',
    ] as const) {
      expect(phaseForStep(s)).toBe('fight');
    }
    expect(phaseForStep('event_choice')).toBe('reward');
    expect(phaseForStep('event_resolve')).toBe('reward');
    expect(phaseForStep('run_over')).toBeNull();
  });

  it('lists Set up only in round 1', () => {
    expect(stepperPhases(1)).toEqual(['setup', 'build', 'fight', 'reward']);
    expect(stepperPhases(2)).toEqual(['build', 'fight', 'reward']);
  });

  it('marks finished, current and upcoming steps', () => {
    expect(stepperItems(1, 'build').map((i) => i.state)).toEqual([
      'done',
      'current',
      'upcoming',
      'upcoming',
    ]);
    expect(stepperItems(3, 'reward').map((i) => i.state)).toEqual([
      'done',
      'done',
      'current',
    ]);
  });

  it('numbers the battles', () => {
    expect(battleNumber('pve')).toBe(1);
    expect(battleNumber('pvp')).toBe(2);
  });

  it('names the phase after a result', () => {
    expect(nextPhaseAfterResult('pve_summary', false)).toBe('reward');
    expect(nextPhaseAfterResult('pvp_summary', false)).toBe('build');
    expect(nextPhaseAfterResult('pvp_summary', true)).toBeNull();
    expect(nextPhaseAfterResult('build', false)).toBeNull();
  });
});

describe('phase tips store', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.resetModules();
    vi.stubGlobal('window', {
      location: { hash: '' },
      addEventListener: () => undefined,
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
    });
  });

  it('remembers a seen tip across loads, and resets', async () => {
    let m = await import('./phase-tips.js');
    expect(m.hasSeenTip('build')).toBe(false);
    m.markTipSeen('build');
    m.markTipSeen('build');
    expect(m.hasSeenTip('build')).toBe(true);
    expect(store.get(m.PHASE_TIPS_KEY)).toBe('["build"]');
    vi.resetModules();
    m = await import('./phase-tips.js');
    expect(m.hasSeenTip('build')).toBe(true);
    expect(m.hasSeenTip('fight')).toBe(false);
    m.resetTips();
    expect(m.hasSeenTip('build')).toBe(false);
    expect(store.get(m.PHASE_TIPS_KEY)).toBe('[]');
  });

  it('survives damaged or blocked storage', async () => {
    store.set('coop:phase-tips-seen', '{oops');
    const m = await import('./phase-tips.js');
    expect(m.hasSeenTip('build')).toBe(false);
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
      },
    });
    m.markTipSeen('fight');
    expect(m.hasSeenTip('fight')).toBe(true);
  });
});
