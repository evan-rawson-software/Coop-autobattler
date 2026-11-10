/** `pnpm golden:update`: deliberately regenerate the `expected` parts. */
import { relative } from 'node:path';
import { repoRoot, updateAll } from './runner.js';

const changed = updateAll();
if (changed.length === 0) console.log('golden vectors already up to date');
for (const p of changed) console.log(`updated ${relative(repoRoot, p)}`);
