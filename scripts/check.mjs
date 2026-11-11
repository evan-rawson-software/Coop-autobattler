// `pnpm check`: the whole CI chain, in order, stopping at the first failure.
// The last step regenerates the golden files and fails only if that changed
// the working tree (the committed golden files are out of date). Uncommitted
// work that existed before the step is ignored.
import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  console.log(`\n==> ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\ncheck failed at: ${[cmd, ...args].join(' ')}`);
    process.exit(r.status ?? 1);
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
  process.exit(1);
}
console.log('\ncheck passed');
