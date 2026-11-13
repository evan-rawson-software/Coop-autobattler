/**
 * Canonical JSON and the 32-bit FNV-1a hash. See docs/rules-reference.md.
 */
import { hasLoneSurrogate, utf8Bytes } from './utf8.js';

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

/** FNV-1a, 32 bit, over bytes. */
export function fnv1a32(bytes: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h = Math.imul(h ^ (b & 0xff), 0x01000193) >>> 0;
  }
  return h;
}

export function toHex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

const ESCAPES: Record<number, string> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
};

function quote(s: string): string | JsonFault {
  if (hasLoneSurrogate(s)) {
    return { range: true, message: 'string contains a lone surrogate' };
  }
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const esc = ESCAPES[c];
    if (esc !== undefined) out += esc;
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

/** Compare strings by Unicode code point (equals UTF-8 byte order). */
function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done === true) return y.done === true ? 0 : -1;
    if (y.done === true) return 1;
    const cx = x.value.codePointAt(0) ?? 0;
    const cy = y.value.codePointAt(0) ?? 0;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/**
 * The keys of a plain object in code-point order. The one sanctioned way to
 * enumerate object keys in core, so that iteration order never depends on
 * insertion order.
 */
export function sortedKeys(obj: Record<string, unknown>): string[] {
  // eslint-disable-next-line no-restricted-properties -- keys are sorted here
  return Object.keys(obj).sort(compareCodePoints);
}

/** Why a value has no canonical JSON: a RangeError or a TypeError message. */
interface JsonFault {
  readonly range: boolean;
  readonly message: string;
}

/** The canonical JSON of `value`, or why it has none. Never throws. */
function encode(value: unknown): string | JsonFault {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        return {
          range: true,
          message: `canonicalJson: not a safe integer: ${String(value)}`,
        };
      }
      return String(value);
    case 'string':
      return quote(value);
    case 'object': {
      if (Array.isArray(value)) {
        let out = '[';
        const list = value as unknown[];
        for (let i = 0; i < list.length; i++) {
          const item = encode(list[i]);
          if (typeof item !== 'string') return item;
          out += (i === 0 ? '' : ',') + item;
        }
        return out + ']';
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        return { range: false, message: 'canonicalJson: not a plain object' };
      }
      const obj = value as Record<string, unknown>;
      let out = '{';
      const keys = sortedKeys(obj);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i] as string;
        const key = quote(k);
        if (typeof key !== 'string') return key;
        const item = encode(obj[k]);
        if (typeof item !== 'string') return item;
        out += (i === 0 ? '' : ',') + key + ':' + item;
      }
      return out + '}';
    }
    default:
      return {
        range: false,
        message: `canonicalJson: unsupported type ${typeof value}`,
      };
  }
}

/**
 * Canonical JSON: object keys sorted by code point, no whitespace, integers
 * only. Throws on non-integers, NaN, Infinity, -0, undefined, functions,
 * bigint, symbols, non-plain objects and strings with a lone surrogate.
 */
export function canonicalJson(value: unknown): string {
  const out = encode(value);
  if (typeof out === 'string') return out;
  throw out.range ? new RangeError(out.message) : new TypeError(out.message);
}

/** Canonical JSON, or null for a value it refuses. Never throws. */
export function canonicalJsonOrNull(value: unknown): string | null {
  const out = encode(value);
  return typeof out === 'string' ? out : null;
}

/** 8-character lowercase hex FNV-1a hash of the canonical JSON (UTF-8). */
export function hashJson(value: unknown): string {
  return toHex8(fnv1a32(utf8Bytes(canonicalJson(value))));
}
