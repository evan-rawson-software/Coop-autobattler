// `pnpm check`: the whole CI chain, in order, stopping at the first failure.
// The last step regenerates the golden files and fails if that changed
// anything in the working tree (the committed golden files are out of date).
import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  console.log(`\n==> ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\ncheck failed at: ${[cmd, ...args].join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

for (const step of [
  'typecheck',
  'lint',
  'format:check',
  'test',
  'build',
  'validate:content',
  'smoke',
  'golden:update',
]) {
  run('pnpm', [step]);
}

const status = spawnSync('git', ['status', '--porcelain'], {
  encoding: 'utf8',
});
if (status.status !== 0) {
  console.error(status.stderr);
  process.exit(status.status ?? 1);
}
if (status.stdout.trim() !== '') {
  console.error(
    `\ncheck failed: the working tree has changes after golden:update (stale golden files, or uncommitted work):\n${status.stdout}`,
  );
  process.exit(1);
}
console.log('\ncheck passed');
