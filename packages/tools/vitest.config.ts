import { defineConfig } from 'vitest/config';

// Several tests here replay whole battles. The default 5 s timeout is a
// wall-clock bound that a loaded machine can exceed, so a failure would not
// mean a real difference. Wall-time performance limits live in
// packages/tools/src/sim/performance.test.ts (and the core tests that use
// TIMING); they are not asserted here.
export default defineConfig({
  test: { testTimeout: 120_000, hookTimeout: 120_000 },
});
