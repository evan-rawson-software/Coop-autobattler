import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const css = readFileSync(
  fileURLToPath(new URL('./styles.css', import.meta.url)),
  'utf8',
);

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
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

/** The value of a custom property in the first (light) or last (dark) block. */
function token(name: string, which: 'first' | 'last'): string {
  const all = [
    ...css.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`, 'g')),
  ];
  const m = which === 'first' ? all[0] : all[all.length - 1];
  if (m?.[1] === undefined) throw new Error(`no ${name}`);
  return m[1];
}

describe('text on the accent colour', () => {
  test.each(['first', 'last'] as const)(
    'reaches 4.5:1 (%s theme block)',
    (which) => {
      expect(
        ratio(token('--accent', which), token('--accent-ink', which)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
