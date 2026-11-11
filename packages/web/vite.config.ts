import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Build identifier shown in the page footer. Reading git, the environment and
// the clock is build tooling, so it lives here and not in application code.
function commitHash(): string {
  const sha = process.env['GITHUB_SHA'];
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'dev';
  }
}

// UTC, ISO date and time to the minute, e.g. 2026-11-10T12:34Z.
const buildDate = new Date().toISOString().slice(0, 16) + 'Z';

export default defineConfig({
  base: './',
  // Preact's JSX runtime; no Vite preset needed.
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { outDir: 'dist' },
  define: {
    __BUILD_COMMIT__: JSON.stringify(commitHash()),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
});
