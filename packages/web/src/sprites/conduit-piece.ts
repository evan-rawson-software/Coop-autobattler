/**
 * Which conduit sprite and rotation a cell needs, from the sides it connects
 * to (pure). Sides are numbered clockwise from north, as bits: N 1, E 2, S 4,
 * W 8. A quarter turn clockwise moves every open side one step on.
 *
 * Unrotated pieces: straight N+S, corner N+E, t E+S+W, cross all, end S only.
 */

export type ConduitKind = 'straight' | 'corner' | 't' | 'cross' | 'end';
export type QuarterTurns = 0 | 1 | 2 | 3;

export interface ConduitPiece {
  readonly kind: ConduitKind;
  readonly rot: QuarterTurns;
}

export const SIDE_N = 1;
export const SIDE_E = 2;
export const SIDE_S = 4;
export const SIDE_W = 8;

/** Side bit of a unit step (view space, y down); 0 when not a unit step. */
export function sideBit(dx: number, dy: number): number {
  if (dx === 0 && dy === -1) return SIDE_N;
  if (dx === 1 && dy === 0) return SIDE_E;
  if (dx === 0 && dy === 1) return SIDE_S;
  if (dx === -1 && dy === 0) return SIDE_W;
  return 0;
}

function rotateBits(bits: number, k: number): number {
  const r = k % 4;
  return ((bits << r) | (bits >> (4 - r))) & 15;
}

function count(bits: number): number {
  return (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1) + ((bits >> 3) & 1);
}

const BASES: readonly (readonly [ConduitKind, number])[] = [
  ['straight', SIDE_N | SIDE_S],
  ['corner', SIDE_N | SIDE_E],
  ['t', SIDE_E | SIDE_S | SIDE_W],
  ['cross', 15],
  ['end', SIDE_S],
];

/**
 * The piece for a set of open sides. With no sides the cell is drawn as a
 * lone end piece (it still occupies the cell).
 */
export function conduitPiece(sides: number): ConduitPiece {
  const s = sides & 15;
  if (s === 0) return { kind: 'end', rot: 0 };
  for (const [kind, base] of BASES) {
    if (count(base) !== count(s)) continue;
    for (const rot of [0, 1, 2, 3] as const) {
      if (rotateBits(base, rot) === s) return { kind, rot };
    }
  }
  return { kind: 'end', rot: 0 };
}
