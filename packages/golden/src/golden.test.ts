import { describe, expect, test } from 'vitest';
import type { SimulationFn } from './kinds/prng.js';
import { goldenKinds } from './kinds.js';
import {
  compareVector,
  diffJson,
  formatJson,
  loadVectorFiles,
  validateVectorFile,
  type GoldenVector,
} from './runner.js';

const files = loadVectorFiles();

describe('golden vector files', () => {
  test('there are vector files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.map((f) => [f.path, f] as const))(
    'schema: %s',
    (_path, file) => {
      expect(validateVectorFile(file.vectors)).toEqual([]);
    },
  );

  test('ids are unique and every kind is registered', () => {
    const ids = files.flatMap((f) => f.vectors.map((v) => v.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of files) {
      for (const v of f.vectors) expect(goldenKinds).toHaveProperty(v.kind);
    }
  });

  test('every registered kind has at least one vector', () => {
    const kinds = new Set(files.flatMap((f) => f.vectors.map((v) => v.kind)));
    expect([...kinds].sort()).toEqual(Object.keys(goldenKinds).sort());
  });
});

describe('golden vectors reproduce', () => {
  const all = files.flatMap((f) => f.vectors);
  // A long battle (the 12000-tick wave-queue vector) takes a few seconds.
  test.each(all.map((v) => [v.id, v] as const))(
    '%s',
    (_id, v) => {
      const problems = compareVector(v);
      if (problems.length > 0) {
        throw new Error(
          `golden vector "${v.id}" (${v.kind}) differs:\n  ${problems.join('\n  ')}\n` +
            'If the change is intended, run: pnpm golden:update',
        );
      }
    },
    60_000,
  );
});

describe('runner itself', () => {
  const vector: GoldenVector = {
    id: 't',
    kind: 'fake',
    input: { n: 1 },
    expected: { result: { n: 2, list: [1, 2] } },
  };
  const good: SimulationFn = () => ({ result: { n: 2, list: [1, 2] } });
  const bad: SimulationFn = () => ({ result: { n: 3, list: [1, 5] } });

  test('passes when output matches', () => {
    expect(compareVector(vector, { fake: good })).toEqual([]);
  });

  test('reports a readable diff when output changes', () => {
    expect(compareVector(vector, { fake: bad })).toEqual([
      'result.list[1]: expected 2, got 5',
      'result.n: expected 2, got 3',
    ]);
  });

  test('detects event log hash changes', () => {
    const v: GoldenVector = { ...vector, expected: { eventLogHash: '00000000' } };
    const fn: SimulationFn = () => ({ result: {}, eventLog: [1] });
    expect(compareVector(v, { fake: fn })[0]).toMatch(/^eventLogHash: expected 00000000, got [0-9a-f]{8}$/);
  });

  test('schema rejects bad vectors', () => {
    expect(validateVectorFile([{ id: 'x', kind: 'k', input: 1, expected: {} }])).not.toEqual([]);
    expect(validateVectorFile([{ id: 'x', kind: 'k', input: 1.5, expected: { result: 1 } }])).not.toEqual([]);
    expect(validateVectorFile({})).not.toEqual([]);
  });

  test('diffJson and formatJson', () => {
    expect(diffJson({ a: [1] }, { a: [1] })).toEqual([]);
    expect(formatJson([{ a: [1, 2], b: 'x' }])).toBe(
      '[\n  {\n    "a": [1, 2],\n    "b": "x"\n  }\n]',
    );
  });
});
