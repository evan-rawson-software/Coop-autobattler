# Contributing

## Layout

A pnpm workspace. The packages mirror the layer boundaries in
[`docs/specs/06-technical-architecture.md`](docs/specs/06-technical-architecture.md)
(TA-52).

| Path               | Package         | Role                                                                  |
| ------------------ | --------------- | --------------------------------------------------------------------- |
| `packages/core`    | `@game/core`    | Pure game logic: simulation, run rules, generators, content loading.  |
| `packages/session` | `@game/session` | Owns a run in progress; exposes intents and state. Solo only for now. |
| `packages/web`     | `@game/web`     | Presentation: a static site built with Vite.                          |
| `packages/content` | `@game/content` | Exports the parsed `content/*.json` files for `web` and tests.        |
| `packages/tools`   | `@game/tools`   | Node scripts: content validation, source scans. May use Node I/O.     |
| `content/`         |                 | Data files (see its README).                                          |
| `schemas/`         |                 | Schemas for those files (see its README).                             |
| `packages/golden`  | `@game/golden`  | Golden vector runner and update command. May use Node I/O.            |
| `golden/`          |                 | Golden vectors (JSON). See docs/rules-reference.md.                   |

`core` and `session` are consumed as TypeScript source (no build step).

## Commands

Requires Node 22+ and pnpm (the version is pinned in `package.json`).

```
pnpm install        # install dependencies
pnpm typecheck      # tsc in every package
pnpm lint           # eslint, including the layer rule
pnpm test           # vitest in every package
pnpm build          # static site into packages/web/dist
pnpm preview        # serve that build locally (run pnpm build first)
pnpm smoke          # browser smoke test of the web app (local only, see below)
pnpm golden:update   # regenerate golden/ expected values (deliberate)
pnpm format         # prettier --write
pnpm format:check   # prettier --check
pnpm validate:content  # check content/ against schemas/ and the core loaders
```

Resource names live only in `content/resources.json` (TA-27a). Refer to
resources by ID or through the `core` loader; a test in `packages/tools`
fails if a display name appears as a string literal in source. To register
another content file, add a row to `packages/tools/src/registry.ts`.

CI (`.github/workflows/ci.yml`) runs install with a frozen lockfile, then
typecheck, lint, format:check, test, and build.

## Web app

`packages/web` is a Preact app (TypeScript JSX, plain CSS with custom
properties for light and dark) that draws the board on a `<canvas>`. Panels,
the top bar and menus are ordinary DOM. State lives in plain modules (no
router or state library). The page you land on is the debug screen
(`#debug`); real screens register in `src/shell/screens.ts`. The pure camera
and gesture code (`src/board/camera.ts`, `gestures.ts`, `layout.ts`) has unit
tests that run with `pnpm test`.

`pnpm smoke` builds the site with `--mode debug` (which adds a read-only
`window.__debug` hook that production builds leave out), serves it, and drives
it with Playwright: page checks, camera and selection checks, a performance
run, and screenshots into `packages/web/smoke-output/` (git-ignored). It needs
Playwright with Chromium installed on your machine. CI has no browser
installed, so CI does not run it: run it locally before changing the board
view or the shell.

## Layer rule

- `core` must not import from `session` or `web`, from the DOM or other
  browser APIs, or from Node I/O modules (`fs`, `path`, `http`,
  `child_process`, ...). It must also not use the clock.
- `session` may import `core` only; it must not import from `web` or the DOM.
- `web` may import `core` and `session`.

This is enforced in two ways: `core` and `session` TypeScript configs do not
include the DOM lib or Node types, and ESLint (`eslint.config.js`) has
`no-restricted-imports` and `no-restricted-globals` rules per package.
Violations fail `pnpm typecheck` or `pnpm lint`.

## Playtest builds

Every change to `main` is built and published as a static site to GitHub Pages
by `.github/workflows/deploy.yml` (it can also be run by hand from the Actions
tab via "Run workflow"). Tests run first, so a failing build is never
published. The site is plain static files with relative asset URLs, so it works
from a sub-path and on any other static host.

- URL pattern: `https://<owner>.github.io/<repo>/`. For this repository:
  <https://evan-rawson-software.github.io/Coop-autobattler/>.
- The page footer shows the build identifier (short commit hash and UTC build
  time), so a tester can say which build they played. It is injected by Vite
  in `packages/web/vite.config.ts` (from `GITHUB_SHA`, else `git`, else `dev`).
- To try the production build locally: `pnpm build`, then `pnpm preview`.
- One-time setup for the repository owner: Settings -> Pages -> Build and
  deployment -> Source: "GitHub Actions".
