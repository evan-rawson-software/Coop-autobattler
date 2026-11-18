import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const audioDir = fileURLToPath(new URL('../../assets/audio', import.meta.url));

/**
 * The generated sound files (assets/audio, AU-43) are served and built as
 * `audio/...` next to the page: the engine loads them on first use.
 */
function audioFiles(): Plugin {
  const names = (): string[] => [
    'manifest.json',
    ...readdirSync(`${audioDir}/sfx`).map((f) => `sfx/${f}`),
  ];
  return {
    name: 'audio-files',
    configureServer(server) {
      server.middlewares.use('/audio', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        if (!names().includes(name)) {
          next();
          return;
        }
        res.setHeader(
          'Content-Type',
          name.endsWith('.wav') ? 'audio/wav' : 'application/json',
        );
        res.end(readFileSync(`${audioDir}/${name}`));
      });
    },
    generateBundle() {
      for (const name of names())
        this.emitFile({
          type: 'asset',
          fileName: `audio/${name}`,
          source: readFileSync(`${audioDir}/${name}`),
        });
    },
  };
}

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
  plugins: [audioFiles()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  // Never inline: the sprite sheets and the atlas load on demand as files.
  build: { outDir: 'dist', assetsInlineLimit: 0 },
  define: {
    __BUILD_COMMIT__: JSON.stringify(commitHash()),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
});
