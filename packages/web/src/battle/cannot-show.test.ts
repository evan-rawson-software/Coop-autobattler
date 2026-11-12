import { describe, expect, test } from 'vitest';
import {
  describeOutcome,
  FAIL_PLAYBACK_KEY,
  readFailPlayback,
} from './cannot-show.js';

describe('the outcome text of a battle that cannot be shown', () => {
  test('a win and a loss are worded from the recorded result', () => {
    const win = describeOutcome(
      { won: true, reason: 'core_destroyed' },
      'Core',
    );
    expect(win.word).toBe('Victory');
    expect(win.reason).toMatch(/last Core was destroyed/);
    const loss = describeOutcome({ won: false, reason: 'time_limit' }, 'Core');
    expect(loss.word).toBe('Defeat');
    expect(loss.reason).toMatch(/Time ran out/);
  });

  test('a missing or unknown reason leaves the reason out', () => {
    expect(describeOutcome({ won: true, reason: null }, 'Core').reason).toBe(
      null,
    );
    expect(describeOutcome({ won: true, reason: 'odd' }, 'Core').reason).toBe(
      null,
    );
  });
});

describe('the forced playback failure', () => {
  test('is off unless the debug option is set', () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(readFailPlayback(store(null))).toBe(false);
    expect(readFailPlayback(store('1'))).toBe(true);
    expect(FAIL_PLAYBACK_KEY).toMatch(/debug/);
    expect(
      readFailPlayback({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(false);
  });
});
