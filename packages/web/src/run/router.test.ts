import { describe, expect, test } from 'vitest';
import { STEPS } from '@game/session';
import { screenOfHash } from '../app-state.js';
import {
  runHash,
  runIdFromHash,
  screenForStep,
  seedFromHash,
  stepLabel,
} from './router.js';

describe('the step decides the screen', () => {
  test('every step has a screen and a name', () => {
    for (const step of STEPS) {
      expect(screenForStep(step)).toBeTruthy();
      expect(stepLabel(step)).toBeTruthy();
    }
  });

  test('each step goes to its own screen', () => {
    expect(screenForStep('core_placement')).toBe('core');
    expect(screenForStep('build')).toBe('build');
    expect(screenForStep('pve_choice')).toBe('pve_choice');
    expect(screenForStep('pve_summary')).toBe('battle');
    expect(screenForStep('pvp_summary')).toBe('battle');
    expect(screenForStep('event_choice')).toBe('event_choice');
    expect(screenForStep('event_resolve')).toBe('event_resolve');
    expect(screenForStep('run_over')).toBe('run_over');
  });

  test('the shop step has two tabs, the other steps ignore the tab', () => {
    expect(screenForStep('shop')).toBe('shop');
    expect(screenForStep('shop', 'shop_build')).toBe('shop_build');
    expect(screenForStep('pve_choice', 'shop_build')).toBe('pve_choice');
    expect(screenForStep('build', 'shop_build')).toBe('build');
  });

  test('battles are never a screen: they are resolved inside one intent', () => {
    expect(screenForStep('pve_battle')).toBe('transient');
    expect(screenForStep('pvp_battle')).toBe('transient');
  });
});

describe('routes', () => {
  test('an empty hash and #/ are the menu; #run/<id> is the run', () => {
    expect(screenOfHash('')).toBe('menu');
    expect(screenOfHash('#')).toBe('menu');
    expect(screenOfHash('#/')).toBe('menu');
    expect(screenOfHash('#/?seed=5')).toBe('menu');
    expect(screenOfHash('#run/abc')).toBe('run');
    expect(screenOfHash('#debug')).toBe('debug');
    expect(screenOfHash('#battle?p=rush')).toBe('battle');
  });

  test('a run id survives the round trip through the hash', () => {
    for (const id of ['run-abc-1', 'with space', 'a/b?c', 'ünï']) {
      expect(runIdFromHash(runHash(id))).toBe(id);
    }
    expect(runIdFromHash('#/')).toBeNull();
    expect(runIdFromHash('#run/')).toBeNull();
    expect(runIdFromHash('#debug')).toBeNull();
  });

  test('a seed for the next run comes from the menu hash, and only a u32', () => {
    expect(seedFromHash('#/?seed=5')).toBe(5);
    expect(seedFromHash('#/?seed=4294967295')).toBe(4294967295);
    expect(seedFromHash('#/?seed=4294967296')).toBeNull();
    expect(seedFromHash('#/?seed=-1')).toBeNull();
    expect(seedFromHash('#/?seed=abc')).toBeNull();
    expect(seedFromHash('#/')).toBeNull();
  });
});
