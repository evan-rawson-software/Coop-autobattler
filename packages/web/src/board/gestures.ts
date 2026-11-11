/**
 * Pointer gesture reducer (pure): one pointer drags, two pointers pinch, a
 * press that never moves past a threshold is a click. The component feeds it
 * pointer events and applies the returned effects to the camera.
 */

import type { Point } from './camera.js';

/** Movement in pixels before a press counts as a drag and not a click. */
export const CLICK_THRESHOLD_PX = 5;

export interface GestureState {
  readonly pointers: Readonly<Record<number, Point>>;
  /** Where the first pointer of this gesture went down. */
  readonly origin: Point | null;
  /** True once the gesture moved past the threshold or had two pointers. */
  readonly dragged: boolean;
}

export type GestureEvent =
  | { type: 'down'; id: number; x: number; y: number }
  | { type: 'move'; id: number; x: number; y: number }
  | { type: 'up'; id: number; x: number; y: number }
  | { type: 'cancel'; id: number };

export type GestureEffect =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; factor: number; at: Point }
  | { type: 'click'; at: Point };

export interface GestureResult {
  readonly state: GestureState;
  readonly effects: readonly GestureEffect[];
}

export const initialGesture: GestureState = {
  pointers: {},
  origin: null,
  dragged: false,
};

function ids(s: GestureState): number[] {
  return Object.keys(s.pointers).map(Number);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function without(
  p: Readonly<Record<number, Point>>,
  id: number,
): Record<number, Point> {
  const out: Record<number, Point> = {};
  for (const k of Object.keys(p).map(Number)) {
    const v = p[k];
    if (k !== id && v) out[k] = v;
  }
  return out;
}

export function gestureReduce(
  state: GestureState,
  ev: GestureEvent,
): GestureResult {
  switch (ev.type) {
    case 'down': {
      const pointers = { ...state.pointers, [ev.id]: { x: ev.x, y: ev.y } };
      const first = ids(state).length === 0;
      return {
        state: {
          pointers,
          origin: first ? { x: ev.x, y: ev.y } : state.origin,
          // A second finger makes it a pinch, never a click.
          dragged: first ? false : true,
        },
        effects: [],
      };
    }
    case 'move': {
      const prev = state.pointers[ev.id];
      if (!prev) return { state, effects: [] };
      const next: Point = { x: ev.x, y: ev.y };
      const pointers = { ...state.pointers, [ev.id]: next };
      const active = ids(state);
      if (active.length >= 2) {
        const a = active[0] ?? -1;
        const b = active[1] ?? -1;
        const pa = state.pointers[a];
        const pb = state.pointers[b];
        if (!pa || !pb) return { state: { ...state, pointers }, effects: [] };
        const na = a === ev.id ? next : pa;
        const nb = b === ev.id ? next : pb;
        const oldMid = mid(pa, pb);
        const newMid = mid(na, nb);
        const oldD = dist(pa, pb);
        const newD = dist(na, nb);
        const effects: GestureEffect[] = [];
        const dx = newMid.x - oldMid.x;
        const dy = newMid.y - oldMid.y;
        if (dx !== 0 || dy !== 0) effects.push({ type: 'pan', dx, dy });
        if (oldD > 0 && newD > 0 && oldD !== newD) {
          effects.push({ type: 'zoom', factor: newD / oldD, at: newMid });
        }
        return { state: { ...state, pointers, dragged: true }, effects };
      }
      const origin = state.origin ?? prev;
      if (!state.dragged) {
        if (dist(origin, next) < CLICK_THRESHOLD_PX) {
          return { state: { ...state, pointers }, effects: [] };
        }
        // Crossed the threshold: pan by the full distance from the origin.
        return {
          state: { ...state, pointers, dragged: true },
          effects: [
            { type: 'pan', dx: next.x - origin.x, dy: next.y - origin.y },
          ],
        };
      }
      return {
        state: { ...state, pointers },
        effects: [{ type: 'pan', dx: next.x - prev.x, dy: next.y - prev.y }],
      };
    }
    case 'up': {
      if (!state.pointers[ev.id]) return { state, effects: [] };
      const pointers = without(state.pointers, ev.id);
      if (Object.keys(pointers).length === 0) {
        const effects: GestureEffect[] = state.dragged
          ? []
          : [{ type: 'click', at: { x: ev.x, y: ev.y } }];
        return { state: initialGesture, effects };
      }
      return { state: { ...state, pointers }, effects: [] };
    }
    case 'cancel': {
      const pointers = without(state.pointers, ev.id);
      if (Object.keys(pointers).length === 0) {
        return { state: initialGesture, effects: [] };
      }
      return { state: { ...state, pointers }, effects: [] };
    }
  }
}
