/**
 * Golden vector loading, running, diffing and rewriting. Node file access is
 * allowed here (not in core).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { hashJson, type Json, type SimulationFn } from '@game/core';
import { goldenKinds } from './kinds.js';

export interface GoldenExpected {
  result?: Json;
  eventLogHash?: string;
}

export interface GoldenVector {
  id: string;
  kind: string;
  description?: string;
  input: Json;
  expected: GoldenExpected;
}

export interface VectorFile {
  path: string;
  vectors: GoldenVector[];
}

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..', '..');
export const goldenDir = join(repoRoot, 'golden');
export const schemaPath = join(repoRoot, 'schemas', 'golden-vector.schema.json');

export function loadSchema(): object {
  return JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
}

/** Returns a list of schema violations (empty when valid). */
export function validateVectorFile(data: unknown): string[] {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(loadSchema());
  if (validate(data)) return [];
  return (validate.errors ?? []).map(
    (e) => `${e.instancePath === '' ? '(root)' : e.instancePath} ${String(e.message)}`,
  );
}

export function loadVectorFiles(dir = goldenDir): VectorFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = join(dir, f);
      return { path, vectors: JSON.parse(readFileSync(path, 'utf8')) as GoldenVector[] };
    });
}

export interface RunOutput {
  result: Json;
  eventLogHash?: string;
}

export function runVector(
  v: GoldenVector,
  kinds: Readonly<Record<string, SimulationFn>> = goldenKinds,
): RunOutput {
  const fn = kinds[v.kind];
  if (fn === undefined) throw new Error(`vector ${v.id}: unknown kind "${v.kind}"`);
  const out = fn(v.input);
  return out.eventLog === undefined
    ? { result: out.result }
    : { result: out.result, eventLogHash: hashJson(out.eventLog) };
}

/** Paths and values that differ, e.g. `$.values[3]: expected 5, got 6`. */
export function diffJson(expected: unknown, actual: unknown, path = '$'): string[] {
  const show = (x: unknown): string => x === undefined ? "undefined" : JSON.stringify(x);
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const out: string[] = [];
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      out.push(...diffJson(expected[i], actual[i], `${path}[${String(i)}]`));
    }
    return out;
  }
  if (
    typeof expected === 'object' && typeof actual === 'object' &&
    expected !== null && actual !== null &&
    !Array.isArray(expected) && !Array.isArray(actual)
  ) {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(e), ...Object.keys(a)])].sort();
    return keys.flatMap((k) => diffJson(e[k], a[k], `${path}.${k}`));
  }
  return JSON.stringify(expected) === JSON.stringify(actual)
    ? []
    : [`${path}: expected ${show(expected)}, got ${show(actual)}`];
}

/** Empty when the vector's recorded expectations match the run. */
export function compareVector(
  v: GoldenVector,
  kinds: Readonly<Record<string, SimulationFn>> = goldenKinds,
): string[] {
  const actual = runVector(v, kinds);
  const problems: string[] = [];
  if (v.expected.result !== undefined) {
    problems.push(...diffJson(v.expected.result, actual.result, 'result'));
  }
  if (v.expected.eventLogHash !== undefined) {
    if (v.expected.eventLogHash !== actual.eventLogHash) {
      problems.push(
        `eventLogHash: expected ${v.expected.eventLogHash}, got ${actual.eventLogHash ?? '(no event log)'}`,
      );
    }
  }
  return problems;
}

/** Compact JSON: arrays of scalars stay on one line, everything else indents. */
export function formatJson(value: unknown, indent = ''): string {
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((x) => typeof x !== 'object' || x === null)) {
      return `[${value.map((x) => JSON.stringify(x)).join(', ')}]`;
    }
    return `[\n${value.map((x) => inner + formatJson(x, inner)).join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([k, x]) => `${inner}${JSON.stringify(k)}: ${formatJson(x, inner)}`)
      .join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** Regenerate `expected` for every vector. Keeps which parts each vector pins. */
export function updateAll(dir = goldenDir): string[] {
  const changed: string[] = [];
  for (const file of loadVectorFiles(dir)) {
    const before = readFileSync(file.path, 'utf8');
    const updated = file.vectors.map((v): GoldenVector => {
      const actual = runVector(v);
      const expected: GoldenExpected = {};
      const hadAny = v.expected.result !== undefined || v.expected.eventLogHash !== undefined;
      if (v.expected.result !== undefined || !hadAny) expected.result = actual.result;
      if (actual.eventLogHash !== undefined && (v.expected.eventLogHash !== undefined || !hadAny)) {
        expected.eventLogHash = actual.eventLogHash;
      }
      return { ...v, expected };
    });
    const after = formatJson(updated) + '\n';
    if (after !== before) {
      writeFileSync(file.path, after);
      changed.push(file.path);
    }
  }
  return changed;
}
