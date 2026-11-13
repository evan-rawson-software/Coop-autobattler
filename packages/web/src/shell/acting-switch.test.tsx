import type { RunState } from '@game/session';
import type { VNode } from 'preact';
import { describe, expect, test } from 'vitest';
import type { BuildController } from '../build/build-controller.js';
import { PartyPanel } from '../build/panels.js';
import {
  ActingAnnouncer,
  ActingSwitch,
  actingAnnouncement,
  announcementOnChange,
} from './ActingSwitch.js';

/** Every element of a vnode tree (function components are not run). */
function walk(n: unknown, out: VNode[] = []): VNode[] {
  if (Array.isArray(n)) n.forEach((x) => walk(x, out));
  else if (typeof n === 'object' && n !== null && 'props' in n) {
    out.push(n as VNode);
    walk((n as VNode<{ children?: unknown }>).props.children, out);
  }
  return out;
}

const run = {
  step: 'build',
  leg: 'pve',
  votes: null,
  players: [{ name: 'Ann' }, { name: 'Bo' }],
  perPlayer: [{ ready: true }, { ready: false }],
} as unknown as RunState;

const attr = (n: VNode, name: string): unknown =>
  (n.props as Record<string, unknown>)[name];

describe('the acting player switch', () => {
  test('announces the new acting player by name', () => {
    expect(actingAnnouncement('Bo')).toBe('Now playing as Bo');
  });

  test('has a live region and names each button by its visible text', () => {
    const nodes = walk(ActingSwitch({ run, acting: 1, onActing: () => {} }));
    const live = nodes.find((n) => n.type === ActingAnnouncer);
    expect(live?.props).toMatchObject({ acting: 1, name: 'Bo' });
    const buttons = nodes.filter((n) => attr(n, 'data-action') === 'act-as');
    // An aria-label that differs from the visible text breaks speech input.
    expect(buttons.map((n) => attr(n, 'aria-label'))).toEqual([
      undefined,
      undefined,
    ]);
    expect(
      buttons.map((n) => (n.props.children as unknown[]).join('')),
    ).toEqual(['Ann (done)', 'Bo (to act)']);
  });

  test('announces nothing on the first render, then each change', () => {
    expect(announcementOnChange(null, 0, 'Ann')).toBeNull();
    expect(announcementOnChange(0, 0, 'Ann')).toBeNull();
    expect(announcementOnChange(0, 1, 'Bo')).toBe('Now playing as Bo');
  });
});

describe('PartyPanel', () => {
  test('renders no acting player switch', () => {
    const ctl = {} as unknown as BuildController;
    const nodes = walk(PartyPanel({ run, ctl, acting: 0 }));
    expect(nodes.some((n) => n.type === ActingSwitch)).toBe(false);
    expect(nodes.some((n) => attr(n, 'id') === 'acting-switch')).toBe(false);
  });
});
