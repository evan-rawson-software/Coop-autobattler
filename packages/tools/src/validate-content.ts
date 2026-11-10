import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentRegistry } from './registry.js';
import { validateContent } from './validate.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const problems = validateContent(repoRoot, contentRegistry);
if (problems.length > 0) {
  console.error('Content validation failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `Content OK (${String(contentRegistry.length)} file(s) checked).`,
  );
}
