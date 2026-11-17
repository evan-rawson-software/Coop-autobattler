import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// The neutral guards (issue #375) are grey: distinct from both sides in both
// themes, and readable on the board, checked the way the accent colour is.
const css = readFileSync(
  fileURLToPath(new URL('../styles.css', import.meta.url)),
  'utf8',
);

function token(name: string, which: 'first' | 'last'): string {
  const all = [
    ...css.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`, 'g')),
  ];
  const m = which === 'first' ? all[0] : all[all.length - 1];
  if (m?.[1] === undefined) throw new Error(`no ${name}`);
  return m[1];
}

const rgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

const distance = (a: string, b: string): number => {
  const [p, q] = [rgb(a), rgb(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

describe.each(['first', 'last'] as const)(
  'the guard colour (%s theme block)',
  (which) => {
    const guard = token('--guard', which);

    test('stands out from the board', () => {
      expect(ratio(guard, token('--board-bg', which))).toBeGreaterThanOrEqual(
        3,
      );
    });

    test('is a grey, far from both sides colours', () => {
      const [r, g, b] = rgb(guard);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(40);
      for (const side of ['--owner-0', '--owner-1']) {
        expect(distance(guard, token(side, which))).toBeGreaterThanOrEqual(90);
      }
    });
  },
);
