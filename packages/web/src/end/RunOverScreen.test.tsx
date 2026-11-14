import type { RunState } from '@game/session';
import type { VNode } from 'preact';
import { describe, expect, test, vi } from 'vitest';

// No DOM here: the hooks are stubbed so the component can be called as a
// plain function and its vnode tree read. The history starts as "loaded, empty".
vi.mock('preact/hooks', () => ({
  useState: (init: unknown) => [init === null ? [] : init, () => undefined],
  useEffect: () => undefined,
  useMemo: (fn: () => unknown) => fn(),
}));

const { RunOverScreen } = await import('./RunOverScreen.js');
const { newRun } = await import('../run/test-run.js');

function text(n: unknown): string {
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(text).join('');
  const v = n as VNode<{ children?: unknown; status?: unknown }>;
  if (typeof v.type === 'function' && v.type.name === 'Tally') {
    const p = v.props as unknown as { won: number; lost: number };
    return `${String(p.won)} won · ${String(p.lost)} lost`;
  }
  return text(v.props.status) + text(v.props.children);
}

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

function finished(
  n: number,
  reason: 'defeated' | 'abandoned',
  won: boolean,
): RunState {
  const base = newRun();
  return {
    ...base,
    players: NAMES.slice(0, n).map((name, index) => ({ name, index })),
    step: 'run_over',
    round: 4,
    lives: reason === 'defeated' ? 0 : 2,
    history: [
      {
        round: 1,
        pve: {
          difficulty: 'easy',
          won: true,
          opponent: { kind: 'pve', label: 'arch_rusher' },
        },
        pvp: { won, opponent: { kind: 'ghost', label: 'Kai, Lin, Mo, Pat' } },
      },
    ],
    outcome: { reason, round: 4 },
  };
}

describe('RunOverScreen for parties', () => {
  for (const n of [1, 2, 4]) {
    test(`${String(n)} player(s), defeated`, () => {
      const out = text(
        RunOverScreen({
          state: finished(n, 'defeated', false),
          startingLives: 5,
        }),
      );
      const label = n === 1 ? '1 player' : `${String(n)} players`;
      expect(out).toContain('Reached round 4');
      expect(out).toContain(`First recorded run for ${label}`);
      // A solo run shows no bare player name in the header.
      if (n > 1) expect(out).toContain(NAMES.slice(0, n).join(' + '));
      else expect(out).not.toContain(NAMES[0]);
      expect(out).toContain('Lives lost5');
      expect(out).toContain('Rival party battles0 won · 1 lost');
      expect(out).toContain(
        n === 1 ? 'Your last life was lost' : "Your party's last life was lost",
      );
      expect(out).not.toContain('undefined');
      expect(out).not.toContain('NaN');
    });

    test(`${String(n)} player(s), abandoned after a win`, () => {
      const out = text(
        RunOverScreen({
          state: finished(n, 'abandoned', true),
          startingLives: 5,
        }),
      );
      expect(out).toContain('You abandoned this run.');
      expect(out).toContain('Rival party battles1 won · 0 lost');
      expect(out).toContain('Lives lost3');
      expect(out).toContain('Rival party');
    });
  }

  test('a reopened finished run offers only Back to menu', () => {
    const state = finished(1, 'defeated', false);
    const full = text(RunOverScreen({ state, startingLives: 5 }));
    expect(full).toContain('New run');
    const out = text(
      RunOverScreen({ state, startingLives: 5, readOnly: true }),
    );
    expect(out).toContain('Back to menu');
    expect(out).not.toContain('New run');
  });

  test('sub-rows show only when they add to the total', () => {
    const out = text(
      RunOverScreen({
        state: finished(1, 'defeated', false),
        startingLives: 5,
      }),
    );
    expect(out).toContain('Rival party battles');
    expect(out).not.toContain('vs. rival parties');
    expect(out).not.toContain('vs. the boss');
  });

  test('a reopened summary is titled with its date', () => {
    const state = finished(1, 'defeated', false);
    const at = new Date(2026, 2, 4, 12).getTime();
    const titleOf = (v: unknown): unknown =>
      (v as VNode<{ title?: unknown }>).props.title;
    expect(
      titleOf(
        RunOverScreen({
          state,
          startingLives: 5,
          readOnly: true,
          finishedAt: at,
        }),
      ),
    ).toBe('Run summary · 2026-03-04');
    expect(titleOf(RunOverScreen({ state, startingLives: 5 }))).toBe(
      'Run over',
    );
  });
});
