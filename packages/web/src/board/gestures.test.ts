import { describe, expect, test } from 'vitest';
import {
  CLICK_THRESHOLD_PX,
  gestureReduce,
  initialGesture,
  type GestureEffect,
  type GestureEvent,
  type GestureState,
} from './gestures.js';

function run(events: GestureEvent[]): {
  state: GestureState;
  effects: GestureEffect[];
} {
  let state = initialGesture;
  const effects: GestureEffect[] = [];
  for (const ev of events) {
    const r = gestureReduce(state, ev);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

describe('click versus drag', () => {
  test('a press and release without moving is a click', () => {
    const { effects, state } = run([
      { type: 'down', id: 1, x: 10, y: 10 },
      { type: 'up', id: 1, x: 10, y: 10 },
    ]);
    expect(effects).toEqual([{ type: 'click', at: { x: 10, y: 10 } }]);
    expect(state).toEqual(initialGesture);
  });

  test('small jitter is still a click', () => {
    const { effects } = run([
      { type: 'down', id: 1, x: 10, y: 10 },
      { type: 'move', id: 1, x: 10 + CLICK_THRESHOLD_PX - 1, y: 10 },
      { type: 'up', id: 1, x: 12, y: 10 },
    ]);
    expect(effects.map((e) => e.type)).toEqual(['click']);
  });

  test('moving past the threshold pans and is not a click', () => {
    const { effects } = run([
      { type: 'down', id: 1, x: 10, y: 10 },
      { type: 'move', id: 1, x: 30, y: 10 },
      { type: 'move', id: 1, x: 35, y: 14 },
      { type: 'up', id: 1, x: 35, y: 14 },
    ]);
    expect(effects).toEqual([
      { type: 'pan', dx: 20, dy: 0 },
      { type: 'pan', dx: 5, dy: 4 },
    ]);
  });

  test('moving back to the start after a drag is still not a click', () => {
    const { effects } = run([
      { type: 'down', id: 1, x: 10, y: 10 },
      { type: 'move', id: 1, x: 40, y: 10 },
      { type: 'move', id: 1, x: 10, y: 10 },
      { type: 'up', id: 1, x: 10, y: 10 },
    ]);
    expect(effects.some((e) => e.type === 'click')).toBe(false);
  });
});

describe('pinch', () => {
  const start: GestureEvent[] = [
    { type: 'down', id: 1, x: 100, y: 100 },
    { type: 'down', id: 2, x: 200, y: 100 },
  ];

  test('spreading the fingers zooms in about their midpoint', () => {
    const { effects } = run([
      ...start,
      { type: 'move', id: 2, x: 300, y: 100 },
    ]);
    const zoom = effects.find((e) => e.type === 'zoom');
    expect(zoom).toBeDefined();
    if (zoom?.type === 'zoom') {
      expect(zoom.factor).toBeCloseTo(2);
      expect(zoom.at).toEqual({ x: 200, y: 100 });
    }
  });

  test('moving both fingers together pans and the zoom nets out to nothing', () => {
    const { effects } = run([
      ...start,
      { type: 'move', id: 1, x: 110, y: 120 },
      { type: 'move', id: 2, x: 210, y: 120 },
    ]);
    // Fingers move one event at a time, so the zoom steps cancel out.
    const factor = effects.reduce(
      (k, e) => (e.type === 'zoom' ? k * e.factor : k),
      1,
    );
    expect(factor).toBeCloseTo(1);
    const pans = effects.filter((e) => e.type === 'pan');
    expect(pans.length).toBeGreaterThan(0);
  });

  test('a pinch never ends in a click', () => {
    const { effects, state } = run([
      ...start,
      { type: 'up', id: 2, x: 200, y: 100 },
      { type: 'up', id: 1, x: 100, y: 100 },
    ]);
    expect(effects).toEqual([]);
    expect(state).toEqual(initialGesture);
  });

  test('lifting one finger leaves the other panning', () => {
    const { effects } = run([
      ...start,
      { type: 'up', id: 2, x: 200, y: 100 },
      { type: 'move', id: 1, x: 120, y: 100 },
    ]);
    expect(effects).toEqual([{ type: 'pan', dx: 20, dy: 0 }]);
  });
});

describe('robustness', () => {
  test('moves and releases from unknown pointers are ignored', () => {
    const { effects, state } = run([
      { type: 'move', id: 9, x: 1, y: 1 },
      { type: 'up', id: 9, x: 1, y: 1 },
    ]);
    expect(effects).toEqual([]);
    expect(state).toEqual(initialGesture);
  });

  test('cancel resets without a click', () => {
    const { effects, state } = run([
      { type: 'down', id: 1, x: 5, y: 5 },
      { type: 'cancel', id: 1 },
    ]);
    expect(effects).toEqual([]);
    expect(state).toEqual(initialGesture);
  });
});
