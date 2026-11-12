// `pnpm check`: the whole CI chain, in order, stopping at the first failure.
// The last step regenerates the golden files and fails only if that changed
// the working tree (the committed golden files are out of date). Uncommitted
// work that existed before the step is ignored.
import { spawnSync } from 'node:child_process';

// Test hook: CHECK_STEPS is a JSON array of argv arrays that replaces the
// real chain (and skips the golden step). Used only by the gate's own test.
// Do not pipe this script through other commands (e.g. `| tail`): the pipe
// reports the last command's status, not ours. Use `set -o pipefail` if you must.
function fail(name, code) {
  console.error(`\ncheck failed at: ${name}`);
  console.error(`CHECK FAILED at step ${name}`);
  process.exit(code);
}

function run(cmd, args) {
  const name = [cmd, ...args].join(' ');
  console.log(`\n==> ${name}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  // Only a clean exit with status 0 passes: a signal kill or a spawn error
  // leaves status null, which must also fail.
  if (r.error || r.signal || r.status !== 0) {
    if (r.error) console.error(String(r.error));
    if (r.signal) console.error(`killed by signal ${r.signal}`);
    fail(name, typeof r.status === 'number' && r.status !== 0 ? r.status : 1);
  }
}

function gitStatus() {
  const r = spawnSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    {
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

// Content hash of each changed or untracked file, so a golden file that was
// already dirty and is rewritten again is still noticed.
function treeSnapshot() {
  const status = gitStatus();
  const diff = spawnSync('git', ['diff', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (diff.status !== 0) {
    console.error(diff.stderr);
    process.exit(diff.status ?? 1);
  }
  return { status, diff: diff.stdout };
}

const override = process.env.CHECK_STEPS;
if (override !== undefined) {
  for (const argv of JSON.parse(override)) run(argv[0], argv.slice(1));
  console.log('\nCHECK PASSED');
  process.exit(0);
}

for (const step of [
  'typecheck',
  'lint',
  'format:check',
  'test',
  'build',
  'validate:content',
  'smoke',
]) {
  run('pnpm', [step]);
}

const before = treeSnapshot();
run('pnpm', ['golden:update']);
const after = treeSnapshot();
if (before.status !== after.status || before.diff !== after.diff) {
  console.error(
    `\ncheck failed: golden:update changed files (the committed golden files are stale; commit the regenerated ones).\nBefore:\n${before.status || '(clean)\n'}After:\n${after.status}`,
  );
  fail('golden:update (stale golden files)', 1);
}
console.log('\ncheck passed');
console.log('CHECK PASSED');
