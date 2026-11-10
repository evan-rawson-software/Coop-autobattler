/** Small helpers shared by the content loaders. Not part of the public API. */

import { sortedKeys } from './hash.js';

export type LoadResult<C> =
  | { readonly ok: true; readonly config: C }
  | { readonly ok: false; readonly errors: readonly string[] };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Unwrap a load result or throw one Error listing every problem. */
export function unwrapOrThrow<C>(what: string, result: LoadResult<C>): C {
  if (!result.ok) {
    throw new Error(`Invalid ${what}:\n- ${result.errors.join('\n- ')}`);
  }
  return result.config;
}

/** Report fields that are not in `allowed`. */
export function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
  errors: string[],
): void {
  for (const key of sortedKeys(record)) {
    if (!allowed.has(key)) errors.push(`${label}: unknown field "${key}".`);
  }
}

/**
 * Read an integer field with a minimum. Pushes an error and returns
 * undefined when it is missing or invalid.
 */
export function readInt(
  record: Record<string, unknown>,
  key: string,
  min: number,
  label: string,
  errors: string[],
): number | undefined {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    errors.push(
      `${label}: "${key}" must be an integer >= ${String(min)} (got ${show(value)}).`,
    );
    return undefined;
  }
  return value;
}

export function readBool(
  record: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
): boolean | undefined {
  const value = record[key];
  if (typeof value !== 'boolean') {
    errors.push(`${label}: "${key}" must be true or false.`);
    return undefined;
  }
  return value;
}

/** Read an ID field and check it against a pattern; returns it if usable. */
export function readId(
  record: Record<string, unknown>,
  pattern: RegExp,
  at: string,
  errors: string[],
): string | undefined {
  const id = record['id'];
  if (typeof id !== 'string' || id === '') {
    errors.push(`${at}: missing or empty "id".`);
    return undefined;
  }
  if (!pattern.test(id)) {
    errors.push(`${at} ("${id}"): id must match ${String(pattern)}.`);
  }
  return id;
}

/** Read `data[key]` as an array of objects; reports a top-level shape error. */
export function readList(
  data: unknown,
  key: string,
  what: string,
): { entries: unknown[] } | { error: string } {
  if (!isRecord(data) || !Array.isArray(data[key])) {
    return { error: `${what} file must be an object with a "${key}" array.` };
  }
  return { entries: data[key] as unknown[] };
}

/** A value for an error message; "nothing" when absent. */
export function show(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}
