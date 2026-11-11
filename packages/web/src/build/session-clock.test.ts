import type { RunController, RunState } from '@game/session';
import { describe, expect, test } from 'vitest';
import { BuildSession } from './session.js';

function fakeController(stamps: number[]): RunController {
  const state = { round: 1, leg: 'pve', step: 'build' } as unknown as RunState;
  return {
    state,
    runId: 'r',
    dispatch: (_p: number, _i: unknown, now: number) => {
      stamps.push(now);
      return Promise.resolve({ ok: false, reason: 'rejected' });
    },
  } as unknown as RunController;
}

describe('the time stamped on saved actions', () => {
  test('is the current time at each dispatch, not the time of page load', async () => {
    const stamps: number[] = [];
    let t = 5_000;
    const s = BuildSession.fromController(fakeController(stamps), () => t);
    await s.dispatch({ type: 'ready' });
    t = 90_000;
    await s.dispatch({ type: 'ready' });
    expect(stamps).toEqual([5_000, 90_000]);
  });

  test('stays increasing when two actions share a millisecond or time steps back', async () => {
    const stamps: number[] = [];
    const s = BuildSession.fromController(fakeController(stamps), () => 100);
    await s.dispatch({ type: 'ready' });
    await s.dispatch({ type: 'ready' });
    await s.dispatch({ type: 'ready' });
    expect(stamps).toEqual([100, 101, 102]);
  });
});
