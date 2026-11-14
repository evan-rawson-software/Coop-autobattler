/**
 * Checks for untrusted plain JSON, shared by the session rules, validation
 * and the save record. (`isInteger` accepts any integer-valued number; core's
 * `isSafeInt` is the stricter check used where a value must fit an int64.)
 */

/** A JSON object: not null, not an array. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `v` as a JSON object, or null when it is not one. */
export function recordOrNull(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null;
}

/** An integer-valued number. */
export function isInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}
