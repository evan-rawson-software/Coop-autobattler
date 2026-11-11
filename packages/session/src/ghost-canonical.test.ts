/**
 * Review round 4 of #78: whatever the snapshot validator accepts, canonical
 * JSON can write (`-0` and lone surrogates are refused by both), so hashing a
 * candidate never throws; and if hashing the candidate list ever did, the
 * selection fails cleanly instead of throwing.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  Rng,
  canonicalJson,
  hashJson,
  validateGhostSnapshot,
  type GhostSnapshot,
} from '@game/core';
import { fixedBattle } from './defaults.js';
import { botRun } from './ghost-test-support.js';
import { ghostContext, selectGhostHandler } from './ghosts.js';
import { makeGameDeps, newRun } from './test-support.js';

// Hashing an array (the candidate list) can be made to throw by a test.
const hostile = vi.hoisted(() => ({ arrays: false }));
vi.mock('@game/core', async (orig) => {
  const actual = await orig<typeof import('@game/core')>();
  return {
    ...actual,
    hashJson: (v: unknown): string => {
      if (hostile.arrays && Array.isArray(v) && v.length > 0) {
        throw new Error('hash failed');
      }
      return actual.hashJson(v);
    },
  };
});

const RULES = { startingLives: 99, pvpLossLifeCost: 1 };
const deps = makeGameDeps({
  ghosts: { ownerId: 'canon' },
  battle: fixedBattle(true),
  rules: RULES,
});
const ctx = (() => {
  const c = ghostContext(deps);
  if (c === null) throw new Error('ghosts are on');
  return c;
})();

function base(): GhostSnapshot {
  const run = botRun(
    deps,
    {
      runId: 'canon-4',
      runVersion: '0.1',
      seed: 5,
      players: ['A', 'B', 'C', 'D'],
      host: 0,
    },
    3,
    (s) => s.round >= 3 && s.step === 'pvp_summary',
  );
  const found = run.snapshots[run.snapshots.length - 1];
  if (found === undefined) throw new Error('no snapshot');
  return found;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Path = (string | number)[];

/** Every string value, key and number of a JSON value, as paths. */
function collect(
  v: unknown,
  path: Path,
  out: { strings: Path[]; keys: Path[]; numbers: Path[] },
): void {
  if (typeof v === 'string') out.strings.push(path);
  else if (typeof v === 'number') out.numbers.push(path);
  else if (Array.isArray(v)) {
    v.forEach((x, i) => collect(x, [...path, i], out));
  } else if (typeof v === 'object' && v !== null) {
    for (const k of Object.keys(v)) {
      out.keys.push([...path, k]);
      collect((v as Record<string, unknown>)[k], [...path, k], out);
    }
  }
}

function setAt(root: unknown, path: Path, value: unknown): void {
  let o = root as Record<string | number, unknown>;
  for (const p of path.slice(0, -1))
    o = o[p] as Record<string | number, unknown>;
  o[path[path.length - 1] as string | number] = value;
}

function renameKey(root: unknown, path: Path, name: string): void {
  let o = root as Record<string, unknown>;
  for (const p of path.slice(0, -1)) o = o[p] as Record<string, unknown>;
  const last = path[path.length - 1] as string;
  const val = o[last];
  const entries = Object.entries(o);
  for (const [k] of entries) Reflect.deleteProperty(o, k);
  for (const [k, v] of entries) o[k === last ? name : k] = k === last ? val : v;
}

function hashes(v: unknown): boolean {
  try {
    hashJson(v);
    canonicalJson(v);
    return true;
  } catch {
    return false;
  }
}

const SURROGATES = ['\ud800', '\udc00', 'a\ud800', '\udc00b', 'x\ud83dy'];
const NUMBERS = [
  -0,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  1.5,
  2 ** 53,
  -(2 ** 53),
  1e300,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
];

describe('the validator accepts only what canonical JSON can write', () => {
  const snap = base();
  const paths = {
    strings: [] as Path[],
    keys: [] as Path[],
    numbers: [] as Path[],
  };
  collect(snap, [], paths);

  test('the base snapshot is valid and hashes', () => {
    expect(validateGhostSnapshot(clone(snap), ctx).ok).toBe(true);
    expect(hashes(snap)).toBe(true);
  });

  test('the four reviewed cases are rejected', () => {
    const cases: ((s: any) => void)[] = [
      (s) => (s.owner.label = 'Ann\ud800x'),
      (s) => (s.runId = 'r\udc00'),
      (s) => (s.pvpRecord.losses = -0),
      (s) => (s.team.core.x = -0),
    ];
    for (const f of cases) {
      const s = clone(snap);
      f(s);
      expect(hashes(s)).toBe(false);
      expect(validateGhostSnapshot(s, ctx).ok).toBe(false);
    }
  });

  test('fuzz: hostile values in every string, key and number', () => {
    const rng = Rng.fromSeed(4242);
    let rejected = 0;
    let accepted = 0;
    const check = (s: unknown): void => {
      const r = validateGhostSnapshot(s, ctx);
      if (r.ok) {
        accepted++;
        expect(hashes(r.snapshot), 'accepted but not canonical').toBe(true);
        expect(hashes(s), 'accepted but not canonical').toBe(true);
      } else rejected++;
    };
    // Every position once with a random hostile value ...
    for (const p of paths.strings) {
      const s = clone(snap);
      setAt(s, p, SURROGATES[rng.nextInt(SURROGATES.length)]);
      check(s);
    }
    for (const p of paths.numbers) {
      const s = clone(snap);
      setAt(s, p, NUMBERS[rng.nextInt(NUMBERS.length)]);
      check(s);
    }
    for (const p of paths.keys) {
      const s = clone(snap);
      renameKey(s, p, SURROGATES[rng.nextInt(SURROGATES.length)] ?? 'x');
      check(s);
    }
    // ... and several at once.
    for (let i = 0; i < 300; i++) {
      const s = clone(snap);
      for (let k = 0; k < 1 + rng.nextInt(4); k++) {
        const kind = rng.nextInt(2);
        if (kind === 0) {
          const p = paths.strings[rng.nextInt(paths.strings.length)];
          if (p !== undefined)
            setAt(s, p, SURROGATES[rng.nextInt(SURROGATES.length)]);
        } else {
          const p = paths.numbers[rng.nextInt(paths.numbers.length)];
          if (p !== undefined)
            setAt(s, p, NUMBERS[rng.nextInt(NUMBERS.length)]);
        }
      }
      check(s);
    }
    expect(rejected).toBeGreaterThan(100);
    expect(accepted + rejected).toBeGreaterThan(300);
  });
});

describe('a hashing failure is a clean selection failure', () => {
  const snap = base();
  const state = {
    ...newRun(deps, ['A', 'B', 'C', 'D']),
    round: snap.round,
    step: 'shop',
    leg: 'pve',
    runVersion: snap.gameVersion,
  } as unknown as Parameters<typeof selectGhostHandler.handle>[0]['state'];
  const other = { ...clone(snap), runId: 'someone-else' };
  const intent = { type: 'select_ghost', candidates: [other] } as never;

  test('control: the candidate is chosen when hashing works', () => {
    const r = selectGhostHandler.handle({
      state,
      player: state.host,
      deps,
      intent,
    });
    expect(r.ok).toBe(true);
  });

  test('a throwing hash gives a refusal, not an exception', () => {
    hostile.arrays = true;
    try {
      const r = selectGhostHandler.handle({
        state,
        player: state.host,
        deps,
        intent,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.detail).toContain('hash failed');
    } finally {
      hostile.arrays = false;
    }
  });

  test('a -0 candidate is simply not a candidate (boss fallback)', () => {
    const bad = clone(other);
    bad.pvpRecord = { ...bad.pvpRecord, losses: -0 };
    const r = selectGhostHandler.handle({
      state,
      player: state.host,
      deps,
      intent: { type: 'select_ghost', candidates: [bad] } as never,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.pvpOpponent?.kind).toBe('boss');
  });

  test('a lone-surrogate candidate is simply not a candidate', () => {
    const bad = { ...clone(other), runId: 'r\udc00' };
    const r = selectGhostHandler.handle({
      state,
      player: state.host,
      deps,
      intent: { type: 'select_ghost', candidates: [bad] } as never,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.pvpOpponent?.kind).toBe('boss');
  });
});
