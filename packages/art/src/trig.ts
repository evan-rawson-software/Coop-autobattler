/**
 * Angle helpers built from constant tables, so generated pixels never depend
 * on how a JavaScript engine implements its sine, cosine or arctangent.
 * Angles are indices 0..63 (a full turn is 64 steps); table values are
 * round(1000 * sin) and were computed once, then written out as literals.
 */

const SIN64: readonly number[] = [
  0, 98, 195, 290, 383, 471, 556, 634, 707, 773, 831, 882, 924, 957, 981, 995,
  1000, 995, 981, 957, 924, 882, 831, 773, 707, 634, 556, 471, 383, 290, 195,
  98, 0, -98, -195, -290, -383, -471, -556, -634, -707, -773, -831, -882, -924,
  -957, -981, -995, -1000, -995, -981, -957, -924, -882, -831, -773, -707, -634,
  -556, -471, -383, -290, -195, -98,
];

/** sin of angle index `i`, as -1000..1000. Any integer is accepted. */
export function sin64(i: number): number {
  return SIN64[((i % 64) + 64) % 64] ?? 0;
}

/** cos of angle index `i`, as -1000..1000. */
export function cos64(i: number): number {
  return sin64(i + 16);
}

/**
 * A monotonic angle index 0..63 for the direction (dx, dy), measured the same
 * way as the arctangent of dy over dx. Uses only division and comparison, so it is exact
 * on every engine. It is a "diamond angle": evenly spaced in the index, not
 * in true angle, which is fine for wobble and ordering.
 */
export function angleIndex(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const sum = ax + ay;
  if (sum === 0) return 0;
  let d: number;
  if (dx >= 0 && dy >= 0) d = ay / sum;
  else if (dx < 0 && dy >= 0) d = 1 + ax / sum;
  else if (dx < 0 && dy < 0) d = 2 + ay / sum;
  else d = 3 + ax / sum;
  return Math.floor(d * 16) & 63;
}

/** floor(sqrt(v) / 2) for integer v >= 0, by integer steps. */
export function halfSqrtFloor(v: number): number {
  let k = 0;
  while (4 * (k + 1) * (k + 1) <= v) k++;
  return k;
}

/** ceil(sqrt(v) / 2) for integer v >= 0, by integer steps. */
export function halfSqrtCeil(v: number): number {
  let k = 0;
  while (4 * k * k < v) k++;
  return k;
}
