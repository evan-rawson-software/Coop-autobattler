/**
 * The shared palette. One character per colour so sprite grids stay readable.
 * Ramps are dark to light. Everything drawn by this package uses only these
 * colours (plus per-resource ramps derived from content/resources.json, the
 * team ramps for units, and the black shadow alpha).
 */

export type Rgba = readonly [number, number, number, number];

export interface PaletteEntry {
  readonly key: string;
  readonly name: string;
  readonly hex: string;
}

export const PALETTE: readonly PaletteEntry[] = [
  // Ink and neutral greys (outline, metal, stone)
  { key: 'K', name: 'ink', hex: '#0a0d11' },
  { key: '0', name: 'grey0', hex: '#222a32' },
  { key: '1', name: 'grey1', hex: '#35404b' },
  { key: '2', name: 'grey2', hex: '#4e5b68' },
  { key: '3', name: 'grey3', hex: '#6f7d8b' },
  { key: '4', name: 'grey4', hex: '#98a5b1' },
  { key: '5', name: 'grey5', hex: '#c5cfd7' },
  { key: '6', name: 'white', hex: '#f0f4f6' },
  // Buildable ground (cool green-slate)
  { key: 'a', name: 'ground0', hex: '#1b2622' },
  { key: 'b', name: 'ground1', hex: '#222f29' },
  { key: 'c', name: 'ground2', hex: '#2b3b33' },
  { key: 'd', name: 'ground3', hex: '#364a3e' },
  // Neutral zone ground (dusty violet-brown)
  { key: 'f', name: 'neutral0', hex: '#2a2730' },
  { key: 'g', name: 'neutral1', hex: '#363240' },
  // Water
  { key: 'W', name: 'water0', hex: '#0f2d47' },
  { key: 'w', name: 'water1', hex: '#19446a' },
  { key: 'v', name: 'water2', hex: '#2a6b95' },
  { key: 'u', name: 'water3', hex: '#6fb0d2' },
  // Rock and cliff (warm grey-brown)
  { key: 'R', name: 'rock0', hex: '#34302c' },
  { key: 'r', name: 'rock1', hex: '#4f4a44' },
  { key: 'q', name: 'rock2', hex: '#716a62' },
  { key: 'p', name: 'rock3', hex: '#9d9487' },
  // Accents
  { key: 'o', name: 'copper', hex: '#a8501c' },
  { key: 'O', name: 'orange', hex: '#e08a2e' },
  { key: 'y', name: 'gold', hex: '#eac435' },
  { key: 'm', name: 'red0', hex: '#8c2a30' },
  { key: 'M', name: 'red1', hex: '#e2574c' },
  { key: 't', name: 'teal0', hex: '#0e5f6b' },
  { key: 'T', name: 'teal1', hex: '#33b8c6' },
  { key: 's', name: 'violet0', hex: '#55389c' },
  { key: 'S', name: 'violet1', hex: '#9a6cf8' },
  { key: 'N', name: 'green', hex: '#6fcf7a' },
];

/**
 * The tint ramp: three pure greys (dark, mid, light) that sprites use for
 * every part that takes a runtime colour (team colour on units, resource
 * colour on conduits and items). They are the only pure greys in any sprite,
 * so a draw-time palette swap of exactly these three colours is unambiguous.
 */
export const TINT_KEYS = ['X', 'x', 'Z'] as const;
export const TINT_NEUTRAL = ['#6e6e6e', '#a6a6a6', '#dcdcdc'] as const;

export function hexToRgba(hex: string, alpha = 255): Rgba {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export const COLORS: Readonly<Record<string, Rgba>> = {
  ...Object.fromEntries(PALETTE.map((p) => [p.key, hexToRgba(p.hex)] as const)),
  ...Object.fromEntries(
    TINT_KEYS.map((k, i) => [k, hexToRgba(TINT_NEUTRAL[i] ?? '#fff')] as const),
  ),
};

export const TEAM_A = ['#1f4f9e', '#3f86e0', '#9cc8ff'] as const;
export const TEAM_B = ['#9e3a14', '#e0742a', '#ffc48a'] as const;

/** Colour map with the tint keys X, x, Z bound to the given ramp. */
export function colorsWithRamp(
  ramp: readonly [string, string, string],
): Readonly<Record<string, Rgba>> {
  return {
    ...COLORS,
    X: hexToRgba(ramp[0]),
    x: hexToRgba(ramp[1]),
    Z: hexToRgba(ramp[2]),
  };
}

/** A [dark, mid, light] ramp derived from one colour (a resource colour). */
export function rampFromColor(hex: string): [string, string, string] {
  const [r, g, b] = hexToRgba(hex);
  const mix = (t: readonly [number, number, number], k: number): string =>
    '#' +
    t
      .map((v, i) => {
        const base = [r, g, b][i] ?? 0;
        return Math.round(base + (v - base) * k)
          .toString(16)
          .padStart(2, '0');
      })
      .join('');
  return [mix([8, 10, 14], 0.5), hex, mix([255, 255, 255], 0.45)];
}
