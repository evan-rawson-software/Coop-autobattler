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
pnpm smoke          # browser smoke test of the web app (see below)
pnpm check          # the whole CI chain (see below)
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
directory you ran `pnpm sim` from. `pnpm sim` works from the repo root or a
non-package directory; from inside a workspace package use `pnpm -w sim`. Bad
input prints an error and exits non-zero (2 for usage errors, 1 otherwise).

```
pnpm sim map --seed 5 [--party 1]
pnpm sim battle --a rush --b fortify --seed 1 [--log events.json] [--ascii]
pnpm sim pve --team boards/rush.json --archetype rusher --type medium --round 3 --seed 1
pnpm sim batch --a rush --b fortify --count 300 --seed 1 [--time]
pnpm sim batch --a siege --archetype fortress --round 5 --count 100
pnpm sim bot --strategy all --count 3 --party 2 --verify
pnpm sim stage [--rounds 12] [--seeds 6]
pnpm sim ghosts [--check]          # same as: pnpm ghosts:update
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
- `bot` also prints, per strategy and from a tick-by-tick replay of every
  battle: how battles ended (PvE and boss/PvP, by end reason), the share that
  reached Overload (`overloadStartTick`), under-supply (the share of
  producer-ticks in which a party Barracks-type producer, or separately a
  turret, was ready to act but did not yet hold the resources it needs), units
  made as a share of top-speed output (one per production interval), and, for
  parties of 2 or more, how often the side that lost a Core first lost the
  battle. Counting needs only the tool: it wraps the run's battle resolver and
  replays each battle, so it adds the time of one more simulation per battle.
- `stage` builds five solo boards by hand on the map of seed 5 with the Core at
  (11, 5): `kit` (the starting kit), `half`, and `full1`, `full2`, `full3` (all
  six Ore and Power nodes used, 3 Barracks, 3 turrets, 7 walls, at tier 1, 2
  and 3). It prints each board's shop value, fights each against generated
  threats (rounds 1..`--rounds`; easy, medium and hard with every archetype, and
  the boss, each with `--seeds` seeds) and prints the last round in which the
  board still wins at least half of its battles, win percentages by round, and
  the soldiers made in 1000 ticks against a passive Core. It takes about half a
  minute with the defaults.

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
run, and screenshots into `packages/web/smoke-output/` (git-ignored). It uses
the pinned Playwright and Chromium from Playwright's browser path
(`PLAYWRIGHT_BROWSERS_PATH`, or `pnpm --filter @game/web exec playwright
install chromium`). CI installs it and runs it on every push.

`pnpm check` runs the whole CI chain in order and stops at the first failure:
typecheck, lint, format check, test, build, content validation, smoke, then
`golden:update`, failing if that leaves any changed file. Run it before
pushing. It ends with `CHECK PASSED` or `CHECK FAILED at step <name>` and its
exit status is non-zero on any failure. Do not pipe it through other commands
(`pnpm check | tail` reports `tail`'s status, so `&& git push` still runs); if
you must, use `set -o pipefail`. (`CHECK_STEPS`, a JSON array of argv arrays,
is a test-only hook that replaces the chain.) CI sets `CI_RELAXED_TIMING=1`, which multiplies wall-time limits
(smoke frame intervals, battles per second, ms bounds in tests) by 3; unset,
the strict limits apply.

The web build ships bundled ghosts (`packages/web/src/run/bundled-ghosts.json`),
made by the bot. `pnpm ghosts:update` regenerates the file (deterministic);
a test in `packages/tools` fails when the committed file differs, so after any
change to the sim, the bot, the content or the ghost rules run
`pnpm ghosts:update` and commit the result (it often does not change).

## Versions and saved formats

The game version is `major.minor.patch` (`packages/web/src/run/version.ts`;
the bundled ghosts use the same `major.minor`, `BUNDLED_GAME_VERSION`). The
run state, the ghost snapshot and the save record each carry a format number
(`RUN_STATE_FORMAT_VERSION`, `GHOST_SNAPSHOT_FORMAT_VERSION`,
`SAVE_FORMAT_VERSION`). The per-player design (issue #124) is major version 1
(run state format 9, ghost snapshot format 6; 8 / 5 had one shared id counter for conduits, issue #38; 7 / 4 had one Core per player, 6 / 3 added border links, issue #135); everything older is wiped at
start-up with a notice, with no migration (TA-8).

The rule for a change that makes saved data unreadable:

- Any PR that changes the shape or meaning of a saved format raises that
  format number in the same PR, with a test. A change to the saved team state
  raises BOTH the run-state format and the ghost snapshot format, because
  both contain the team state. A save or ghost with another number is then `unsupported_format`
  (or skipped), never "damaged": the version and format checks run before
  `validateRunState`. The one exception so far is the optional save field
  `startedAt` (the stale-write rule): it was added without a format bump
  because records without it stay readable.
- The major version is raised once for the whole design change (this is
  done). Further format changes inside #124 (multi-Core battles, border
  links, per-player placement) raise the format numbers only. Nobody holds a
  save of the new major yet, so no wipe is needed. If a build of the new major
  has been given to testers before the design is finished, the breaking PR
  raises the major as well (and regenerates the bundled ghosts), so that
  their saves are wiped and not left as unsupported.
- Regenerate the bundled ghosts (`pnpm ghosts:update`) whenever a PR changes
  rules or formats that they depend on.

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
