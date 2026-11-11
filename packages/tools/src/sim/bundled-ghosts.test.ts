import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  BUNDLED_GHOST_PATH,
  buildBundledGhostFile,
  bundledGhostText,
} from './bundled-ghosts.js';
import { loadSimContext } from './context.js';
import { repoRoot } from './cli.js';

describe('the bundled ghost file', () => {
  test('is what `pnpm sim ghosts` writes now (regenerate and commit it after a sim or content change)', () => {
    const ctx = loadSimContext();
    const fresh = bundledGhostText(buildBundledGhostFile(ctx));
    const onDisk = readFileSync(
      path.join(repoRoot, BUNDLED_GHOST_PATH),
      'utf8',
    );
    expect(
      onDisk === fresh,
      'packages/web/src/run/bundled-ghosts.json is out of date: run `pnpm ghosts:update` and commit it',
    ).toBe(true);
  }, 180_000);
});
