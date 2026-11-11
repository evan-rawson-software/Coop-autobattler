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
pnpm sim <command>     # command-line battle runner (see below)
pnpm boards:export     # rewrite boards/*.json from the reference board scripts
```

Resource names live only in `content/resources.json` (TA-27a). Refer to
resources by ID or through the `core` loader; a test in `packages/tools`
fails if a display name appears as a string literal in source. To register
another content file, add a row to `packages/tools/src/registry.ts`.

CI (`.github/workflows/ci.yml`) runs install with a frozen lockfile, then
typecheck, lint, format:check, test, and build.

## Battle runner (`pnpm sim`)

`packages/tools/src/sim/` is a command-line runner over the core simulation.
Output is deterministic for the same input; wall time is printed only with
`--time`. A `BOARD` is a path to a board JSON file or a reference board name
(`rush`, `fortify`, `siege`, `poor`), which means `boards/<name>.json`; a bare word that is not one of those names is
treated as a path. Relative paths (boards and `--log`) resolve against the
directory you ran `pnpm sim` from. Bad
input prints an error and exits non-zero (2 for usage errors, 1 otherwise).

```
pnpm sim map --seed 5 [--party 1]
pnpm sim battle --a rush --b fortify --seed 1 [--log events.json] [--ascii]
pnpm sim pve --team boards/rush.json --archetype rusher --type medium --round 3 --seed 1
pnpm sim batch --a rush --b fortify --count 300 --seed 1 [--time]
pnpm sim batch --a siege --archetype fortress --round 5 --count 100
pnpm sim --help
```

- `map` generates the map for a seed and prints it with its resource nodes.
- `battle` fights board A (side 0, the party) against board B (side 1, the
  defender) and prints the result, the neutral zone depth, per-side totals, a
  timeline sample, and the event log hash. `--log FILE` writes the full event
  log as JSON; `--ascii` also prints the final arena.
- `pve` fights a board against a generated threat (`--archetype` with or without
  the `arch_` prefix; `--type` easy, medium, hard or boss; `--round`, at most the highest round with its own budget, 63 with the
  current content). The
  threat is generated with the battle seed unless `--threat-seed` is given.
- `batch` runs `--count` battles with seeds `seed .. seed + count - 1` against a
  board (`--b`) or a threat (`--archetype`) and reports win rate and the length
  distribution. The seeds must stay within 0 to 4294967295, and `--type`,
  `--round` and `--threat-seed` need `--archetype`.

Board files hold a team state plus a name, description, map seed and party size
(see the rules reference, "Reference boards"); `mapSeed` and `partySize` are
required and the team's map is checked against them. A bare team state without
that wrapper is accepted, with a note on stderr that its map cannot be verified. The four reference boards are built by
scripts in `packages/core/src/reference-boards*.ts`; after changing one, run
`pnpm boards:export` and commit the result (a test fails while they differ).
Every board file must pass the whole-state validator. The performance budget
and its benchmark are in [`docs/performance-budget.md`](docs/performance-budget.md).

## Web app

`packages/web` is a Preact app (TypeScript JSX, plain CSS with custom
properties for light and dark) that draws the board on a `<canvas>`. Panels,
the top bar and menus are ordinary DOM. State lives in plain modules (no
router or state library). The page you land on is the debug screen
(`#debug`); real screens register in `src/shell/screens.ts`. The pure camera
and gesture code (`src/board/camera.ts`, `gestures.ts`, `layout.ts`) has unit
tests that run with `pnpm test`.

The battle screen (`src/battle/`, route `#battle`) plays a battle back from
its event log. `BattleView` takes a battle description (team against team, or
PvE) and callbacks; `#battle?p=<board>&o=<opponent>&s=<seed>&t=<tick>` is a
sample route whose URL keeps the selection and the playback tick, so a reload
resumes the same battle. The result shown is always the one of an up-front
simulation; playback only re-steps a second copy to draw it.

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

The Build screen (`#build`, `packages/web/src/build/`) is where the layout is edited. It starts a solo run in memory with a fixed seed (change it in the dev strip), asks for a Core position, then offers the stash, tools, inspector, overlays and problems list. Everything it knows about legality comes from `core` (pure operations called on the current state) and every change is an intent through the run controller; `reasons.ts` is the only place reason codes become text.
