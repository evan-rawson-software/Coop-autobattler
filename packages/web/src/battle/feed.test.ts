import { describe, expect, test } from 'vitest';
import type { Moment } from './derive.js';
import { feedLines, timelineSpan } from './panels.js';

const m = (tick: number, kind: Moment['kind'] = 'turret'): Moment => ({
  tick,
  kind,
  side: 0,
  text: `at ${String(tick)}`,
  focus: null,
});

describe('feedLines', () => {
  const moments = [m(0, 'zone'), m(10), m(20), m(30), m(40), m(50)];
  test('the newest four that have happened, newest first', () => {
    expect(feedLines(moments, 45, true).map((x) => x.tick)).toEqual([
      40, 30, 20, 10,
    ]);
  });
  test('nothing from the future', () => {
    expect(feedLines(moments, 15, true).map((x) => x.tick)).toEqual([10, 0]);
  });
  test('the start line waits for the zone to be revealed', () => {
    expect(feedLines(moments, 15, false).map((x) => x.tick)).toEqual([10]);
    expect(feedLines(moments, 0, false)).toEqual([]);
  });
  test('the count can be changed', () => {
    expect(feedLines(moments, 100, true, 2).map((x) => x.tick)).toEqual([
      50, 40,
    ]);
  });
});

describe('timelineSpan', () => {
  test('puts Overload at three quarters of the bar', () => {
    expect(timelineSpan(1800, 0)).toBe(2400);
  });
  test('a battle that runs past the end fills the bar', () => {
    expect(timelineSpan(1800, 3000)).toBe(3000);
  });
  test('never zero', () => {
    expect(timelineSpan(0, 0)).toBe(1);
  });
});
