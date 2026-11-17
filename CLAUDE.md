# CLAUDE.md

A co-op roguelite autobattler for 1–4 players. The playable build today is
an offline web proof of concept (TypeScript, pnpm workspace, Preact); a
Godot port for Steam comes next. Read these instead of guessing:

- `docs/specs/00-vision.md`: what the game is, the owner requirements
  (`V-…`), the six design pillars, the glossary.
- `docs/specs/01`–`07`: the design, by area, with stable rule IDs.
- `docs/rules-reference.md`: the exact rules of the code on `main`, written
  so the simulation can be ported. The golden vectors in `golden/` prove it.
- `CONTRIBUTING.md`: the layout, commands, layer rule, and the rules for
  saved formats and versions.

## Before you call a change done

- Run `pnpm check`. It runs the whole CI chain and fails if the committed
  golden files are out of date. Do not pipe it through `tail` or similar,
  because the pipe hides its exit status.
- When a rule changes, update `docs/rules-reference.md` in the same PR, and
  regenerate the expected values on purpose with `pnpm golden:update`.
- When rules or saved formats that the bundled ghosts depend on change, run
  `pnpm ghosts:update`.
- When the shape or meaning of a saved format changes, raise its format
  number in the same PR, with a test. A change to the team state raises both
  the run-state and the ghost-snapshot formats. See "Versions and saved
  formats" in `CONTRIBUTING.md`.
- When content changes, run `pnpm validate:content`. Display names live only
  in `content/presentation.en.json`, and resource names only in
  `content/resources.json`. Never hard-code either in source.
- Update the specs and other docs that describe what you changed in the
  same PR, so they don't drift.

## Code rules

- **Determinism.** Anything that can affect an outcome uses integer math
  only (see "Integer math conventions" in the rules reference). It uses no
  floats, no `Math.random`, and no clock.
- **Random draws.** All randomness comes from the seeded PRNG. To add new
  randomness without moving existing results, draw from a new
  `.child(label)` stream: a child stream takes nothing from its parent. An
  extra draw on an existing stream changes every result after it.
- **Layer rule.** `core` imports nothing from `session` or `web`, and uses
  no DOM, Node I/O or clock. `session` imports only `core`. `web` may import
  both. Lint and typecheck enforce this.
- **Data, not code.** Numbers and content belong in `content/*.json`, with a
  schema in `schemas/`, not in source.

## Design rules every change must respect

- **No opponent changes how the party's factory works (V-17).** A boss's or
  a threat's special rules act only on its own side. Drawbacks to the
  party's own side are opt-in only, for example an event option the party
  chooses.
- **Players never give each other gold or buildings (CP-29).** Border links
  are the only direct help between players.
- **Economy effects help only their owner (PP-8).**
- **Nothing is timed (pillar 5),** and players have no input during a
  battle (pillar 4).
- **Space should run out by the mid-run (pillar 6).** Judge new buildings
  and tuning against this pillar.

## Docs conventions

- **Tags:** [DECIDED] means the owner decided it; [PROPOSED] is a default
  open to change; [OPEN] is undecided and tracked in
  `07-open-questions.md`. Only the owner makes something [DECIDED].
- **Stable IDs:** rule IDs (`RS-4a`, `CB-9e`, ...) never change or get
  reused. A replaced rule stays, marked [SUPERSEDED by X].
- **Status line:** raise the "Status: Draft vX.Y" line of each spec you
  edit.
- **Style:** write plain, short sentences.

## GitHub issues

- **Issue types:** a planned feature gets an umbrella issue of type
  Feature, with sub-issues that have no type. A chore is a Task.
- **Numbers shift:** other sessions create issues and PRs at the same time,
  so check the real numbers after creating a batch and fix any
  cross-references.
