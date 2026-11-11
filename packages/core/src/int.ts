/**
 * Integer math helpers for outcome-affecting code.
 *
 * Safe range: every input and every intermediate value must be a safe integer
 * (|x| <= 2^53 - 1). Helpers THROW (RangeError) on non-integers and on
 * results that would leave the safe range, instead of silently losing
 * precision. A port can use 64-bit integers and must reproduce the same
 * results for all inputs that do not throw here.
 * Rounding: division always rounds toward negative infinity (floor).
 */

export function assertInt(value: number, name = 'value'): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${name} must be a safe integer, got ${String(value)}`,
    );
  }
}

/** a + b, throwing if either input or the sum is not a safe integer. */
export function addInt(a: number, b: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(
      `a + b overflows the safe range: ${String(a)} + ${String(b)}`,
    );
  }
  return sum;
}

/** a * b, throwing if either input or the product is not a safe integer. */
export function mulInt(a: number, b: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  const p = a * b;
  if (!Number.isSafeInteger(p)) {
    throw new RangeError(
      `a * b overflows the safe range: ${String(a)} * ${String(b)}`,
    );
  }
  return p === 0 ? 0 : p;
}

/** Normalises -0 to 0. */
function noNegZero(n: number): number {
  return n === 0 ? 0 : n;
}

/** Floored remainder: result has the sign of `d` (0 <= r < d for d > 0). */
export function modFloor(n: number, d: number): number {
  assertInt(n, 'n');
  assertInt(d, 'd');
  if (d === 0) throw new RangeError('division by zero');
  let r = n % d;
  if (r !== 0 && r < 0 !== d < 0) r += d;
  return noNegZero(r);
}

/** floor(n / d), exact for all safe integers. */
export function divFloor(n: number, d: number): number {
  const r = modFloor(n, d);
  return noNegZero((n - r) / d);
}

/**
 * floor(a * b / c). Requires |a * b| <= 2^53 - 1 (throws otherwise) and
 * c != 0. Negative operands floor toward negative infinity.
 */
export function mulDiv(a: number, b: number, c: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  assertInt(c, 'c');
  const p = a * b;
  if (!Number.isSafeInteger(p)) {
    throw new RangeError(
      `a * b overflows the safe range: ${String(a)} * ${String(b)}`,
    );
  }
  return divFloor(p, c);
}

/** Basis points: 10000 bps = 100%. */
export const BPS_SCALE = 10000;

/** floor(value * bps / 10000). */
export function mulBps(value: number, bps: number): number {
  return mulDiv(value, bps, BPS_SCALE);
}

/** floor(value * pct / 100). */
export function mulPct(value: number, pct: number): number {
  return mulDiv(value, pct, 100);
}

/** Clamp to [lo, hi]; throws if lo > hi or any input is not an integer. */
export function clamp(value: number, lo: number, hi: number): number {
  assertInt(value, 'value');
  assertInt(lo, 'lo');
  assertInt(hi, 'hi');
  if (lo > hi)
    throw new RangeError(`clamp: lo ${String(lo)} > hi ${String(hi)}`);
  return value < lo ? lo : value > hi ? hi : value;
}

export function minInt(a: number, b: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  return a < b ? a : b;
}

export function maxInt(a: number, b: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  return a > b ? a : b;
}
