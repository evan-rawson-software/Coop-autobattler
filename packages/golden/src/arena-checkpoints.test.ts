import { describe, expect, test } from 'vitest';
import { compareVector, loadVectorFiles, runVector, type GoldenVector } from './runner.js';

const arena = loadVectorFiles()
  .flatMap((f) => f.vectors)
  .filter((v) => v.kind === 'arena-sim');
const withCheckpoints = arena.filter((v) => v.expected.checkpoints !== undefined);

interface Checkpoint {
  tick: number;
  alive: number[];
  coreHealth: number[][];
  stateHash: string;
}
interface Side {
  alive: number;
  coreHealth: number[];
}

describe('arena-sim checkpoints', () => {
  test('exactly the vectors with checkpointEvery carry them', () => {
    expect(withCheckpoints.length).toBe(5);
    for (const v of arena) {
      const every = (v.input as { checkpointEvery?: number }).checkpointEvery;
      expect(v.expected.checkpoints !== undefined).toBe(every !== undefined);
    }
  });

  test.each(withCheckpoints.map((v) => [v.id, v] as const))('%s is consistent', (_id, v) => {
    const every = (v.input as { checkpointEvery: number }).checkpointEvery;
    const cps = v.expected.checkpoints as unknown as Checkpoint[];
    const final = v.expected.result as unknown as { tick: number; sides: Side[] };
    expect(cps.map((c) => c.tick)).toEqual(
      Array.from({ length: Math.floor(final.tick / every) }, (_, i) => (i + 1) * every),
    );
    expect(cps[cps.length - 1]?.tick).toBeLessThan(final.tick);
    for (const c of cps) {
      expect(c.stateHash).toMatch(/^[0-9a-f]{8}$/);
      c.coreHealth.forEach((cores, s) => {
        expect(cores.length).toBe(final.sides[s]?.coreHealth.length);
        for (const hp of cores) expect(hp).toBeGreaterThanOrEqual(0);
      });
    }
    // Core health only falls, so the last checkpoint is at or above the final value.
    const last = cps[cps.length - 1] as Checkpoint;
    last.coreHealth.forEach((cores, s) => { cores.forEach((hp, i) => { expect(hp).toBeGreaterThanOrEqual(final.sides[s]?.coreHealth[i] ?? 0); },
      ); },
    );
    expect(compareVector(v)).toEqual([]);
  });

  test('a tampered checkpoint fails and names the vector, tick and field', () => {
    const v = withCheckpoints[0] as GoldenVector;
    const cps = structuredClone(v.expected.checkpoints) as unknown as Checkpoint[];
    const target = cps[2] as Checkpoint;
    const real = target.alive[0] as number;
    target.alive[0] = real + 1;
    const problems = compareVector({ ...v, expected: { ...v.expected, checkpoints: cps as never } });
    expect(problems).toEqual([
      `vector ${v.id}: tick ${String(target.tick)}: checkpoint.alive[0]: expected ${String(real + 1)}, got ${String(real)}`,
    ]);
  });

  test('vectors without checkpointEvery produce none', () => {
    const v = arena.find((x) => x.expected.checkpoints === undefined) as GoldenVector;
    expect(runVector(v).checkpoints).toBeUndefined();
  });
});
