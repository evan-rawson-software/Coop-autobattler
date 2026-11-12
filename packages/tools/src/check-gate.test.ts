import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function gate(steps: string[][]) {
  const r = spawnSync('node', ['scripts/check.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CHECK_STEPS: JSON.stringify(steps) },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

const ok = ['node', '-e', 'process.exit(0)'];
const later = ['node', '-e', 'console.log("LATER_STEP_RAN")'];

test('all steps passing exits 0', () => {
  const r = gate([ok, later]);
  expect(r.code).toBe(0);
  expect(r.out).toContain('CHECK PASSED');
});

test('a failing step exits non-zero and later steps do not run', () => {
  const r = gate([ok, ['node', '-e', 'process.exit(3)'], later]);
  expect(r.code).toBe(3);
  expect(r.out).toContain('CHECK FAILED at step node -e process.exit(3)');
  expect(r.out).not.toContain('LATER_STEP_RAN');
  expect(r.out).not.toContain('CHECK PASSED');
});

test('a step killed by a signal fails the gate', () => {
  const r = gate([
    ['node', '-e', 'process.kill(process.pid, "SIGKILL")'],
    later,
  ]);
  expect(r.code).toBe(1);
  expect(r.out).not.toContain('LATER_STEP_RAN');
});

test('a step that cannot be spawned fails the gate', () => {
  const r = gate([['definitely-not-a-command-xyz'], later]);
  expect(r.code).toBe(1);
  expect(r.out).not.toContain('LATER_STEP_RAN');
});
