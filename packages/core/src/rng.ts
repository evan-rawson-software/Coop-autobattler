/**
 * Seeded PRNG: xoshiro128** seeded by splitmix32. 32-bit unsigned integer
 * operations only. The exact algorithm is in docs/rules-reference.md.
 * The generator is explicitly stateful; `getState`/`fromState` round-trip it.
 */
import { fnv1a32 } from './hash.js';
import { utf8Bytes } from './utf8.js';

const TWO32 = 0x100000000;

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

function assertU32(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 0 || n >= TWO32) {
    throw new RangeError(`${name} must be a u32 integer, got ${String(n)}`);
  }
}

function le32(n: number): number[] {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
}

/** splitmix32 step: returns [new counter, output]. */
function splitmix32(counter: number): [number, number] {
  const next = (counter + 0x9e3779b9) >>> 0;
  let t = (next ^ (next >>> 16)) >>> 0;
  t = Math.imul(t, 0x21f0aaad) >>> 0;
  t = (t ^ (t >>> 15)) >>> 0;
  t = Math.imul(t, 0x735a2d97) >>> 0;
  t = (t ^ (t >>> 15)) >>> 0;
  return [next, t];
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  private constructor(a: number, b: number, c: number, d: number) {
    this.s0 = a;
    this.s1 = b;
    this.s2 = c;
    this.s3 = d;
  }

  /** Seed from a 32-bit unsigned integer through splitmix32. */
  static fromSeed(seed: number): Rng {
    assertU32(seed, 'seed');
    let counter = seed;
    const words: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [next, out] = splitmix32(counter);
      counter = next;
      words.push(out);
    }
    const [a = 0, b = 0, c = 0, d = 0] = words;
    // The all-zero state is a fixed point; replace it (never happens in practice).
    if ((a | b | c | d) === 0) return new Rng(1, 0, 0, 0);
    return new Rng(a, b, c, d);
  }

  /** Restore from the four plain integers produced by `getState`. */
  static fromState(state: readonly number[]): Rng {
    if (state.length !== 4) throw new RangeError('state must have 4 words');
    const [a = 0, b = 0, c = 0, d = 0] = state;
    assertU32(a, 'state[0]');
    assertU32(b, 'state[1]');
    assertU32(c, 'state[2]');
    assertU32(d, 'state[3]');
    if ((a | b | c | d) === 0) throw new RangeError('state must not be zero');
    return new Rng(a, b, c, d);
  }

  getState(): [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  /** Next unsigned 32-bit output (xoshiro128**). */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /**
   * Unbiased integer in [0, maxExclusive), 1 <= maxExclusive < 2^32.
   * Rejection sampling: draw x until x >= (2^32 - n) mod n; return x mod n.
   * Always consumes at least one output, even when maxExclusive is 1.
   */
  nextInt(maxExclusive: number): number {
    if (
      !Number.isInteger(maxExclusive) ||
      maxExclusive < 1 ||
      maxExclusive >= TWO32
    ) {
      throw new RangeError(
        `maxExclusive out of range: ${String(maxExclusive)}`,
      );
    }
    const threshold = (TWO32 - maxExclusive) % maxExclusive;
    for (;;) {
      const x = this.nextU32();
      if (x >= threshold) return x % maxExclusive;
    }
  }

  /** Uniform element; consumes one `nextInt(length)`. Throws if empty. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick from empty array');
    return items[this.nextInt(items.length)] as T;
  }

  /**
   * Fisher-Yates, returns a new array. For i from n-1 down to 1:
   * j = nextInt(i + 1); swap elements i and j.
   */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i >= 1; i--) {
      const j = this.nextInt(i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /**
   * Independent child stream. Does NOT advance this generator. The seed is
   * FNV-1a over [4 state words, 4 little-endian bytes each][label bytes],
   * where label bytes are 0x73 + UTF-8 for a string, or 0x69 + 4 LE bytes for
   * a u32 integer. The 32-bit hash then seeds a new generator.
   */
  child(label: string | number): Rng {
    const bytes: number[] = [];
    for (const w of this.getState()) bytes.push(...le32(w));
    if (typeof label === 'string') {
      bytes.push(0x73, ...utf8Bytes(label));
    } else {
      assertU32(label, 'label');
      bytes.push(0x69, ...le32(label));
    }
    return Rng.fromSeed(fnv1a32(bytes));
  }
}
