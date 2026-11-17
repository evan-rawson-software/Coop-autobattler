import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STEP_ORDER,
  displayRound,
  phaseOfStepId,
  stepIdFor,
  nextPhaseAfterResult,
  phaseForStep,
  stepperItems,
  stepperPhases,
} from './phase.js';

describe('phase mapping', () => {
  it('maps every step to a phase', () => {
    expect(phaseForStep('specialist_pick')).toBe('setup');
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

  it('shows the Build after the rival battle as the next round', () => {
    expect(displayRound({ round: 1, step: 'shop', leg: 'pvp' })).toBe(2);
    expect(displayRound({ round: 1, step: 'shop', leg: 'pve' })).toBe(1);
    expect(displayRound({ round: 1, step: 'event_choice', leg: 'pvp' })).toBe(
      1,
    );
    expect(displayRound({ round: 2, step: 'build', leg: 'pve' })).toBe(2);
  });

  it('maps run places to the stepper steps', () => {
    expect(stepIdFor({ step: 'specialist_pick', leg: 'pve' })).toBe('setup');
    expect(stepIdFor({ step: 'core_placement', leg: 'pve' })).toBe('setup');
    expect(stepIdFor({ step: 'build', leg: 'pve' })).toBe('build1');
    expect(stepIdFor({ step: 'shop', leg: 'pvp' })).toBe('build1');
    expect(stepIdFor({ step: 'pve_summary', leg: 'pve' })).toBe('stronghold');
    expect(stepIdFor({ step: 'event_choice', leg: 'pve' })).toBe('reward1');
    expect(stepIdFor({ step: 'shop', leg: 'pve' })).toBe('build2');
    expect(stepIdFor({ step: 'pvp_battle', leg: 'pvp' })).toBe('rival');
    expect(stepIdFor({ step: 'event_resolve', leg: 'pvp' })).toBe('reward2');
    expect(stepIdFor({ step: 'run_over', leg: 'pvp' })).toBeNull();
    expect(phaseOfStepId('build2')).toBe('build');
    expect(phaseOfStepId('rival')).toBe('fight');
  });

  it('lists Set up only in round 1', () => {
    expect(stepperPhases(1)).toEqual([
      'setup',
      'build1',
      'stronghold',
      'reward1',
      'build2',
      'rival',
      'reward2',
    ]);
    expect(stepperPhases(2)).toEqual(STEP_ORDER.slice(1));
  });

  it('marks finished, current and upcoming steps', () => {
    expect(stepperItems(1, 'build1').map((i) => i.state)).toEqual([
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(stepperItems(3, 'rival').map((i) => i.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'current',
      'upcoming',
    ]);
  });

  it('names the phase after a result', () => {
    expect(nextPhaseAfterResult('pve_summary', false)).toBe('reward');
    expect(nextPhaseAfterResult('pvp_summary', false)).toBe('reward');
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
