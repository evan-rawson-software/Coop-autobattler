/**
 * Writes `boards/<name>.json` for every reference board from the scripts in
 * `core`. Run with `pnpm boards:export` after changing a script; a test fails
 * while the files and the scripts disagree.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ALL_REFERENCE_BOARDS,
  REFERENCE_SEED,
  buildAnyReferenceBoard,
} from '@game/core';
import { boardFileOf, boardFileText } from './boards.js';
import { repoRoot } from './cli.js';
import { loadSimContext } from './context.js';

const ctx = loadSimContext();
const dir = path.join(repoRoot, 'boards');
mkdirSync(dir, { recursive: true });
for (const name of ALL_REFERENCE_BOARDS) {
  const team = buildAnyReferenceBoard(name, ctx.content, ctx.mapgen);
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, boardFileText(boardFileOf(name, REFERENCE_SEED, team)));
  console.log(`wrote ${file}`);
}
