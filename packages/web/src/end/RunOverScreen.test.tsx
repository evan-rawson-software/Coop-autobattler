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
      expect(out).toContain(NAMES.slice(0, n).join(' + '));
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
});
