# Coop Autobattler (working title)

A co-op roguelite autobattler for 1–4 players. A party drafts and builds a
shared team between fights, then watches automated combat against a mix of PvE
encounters and asynchronous PvP "ghost" parties. PvE difficulty grows
exponentially, so every run eventually ends in defeat — the question is how far
you get.

The project is in the **specification phase**. Nothing is implemented yet.

## Specifications

High-level specs live in [`docs/specs/`](docs/specs/). They are intended to be
refined and then broken down into backlog items for coding agents.

| # | Spec | Covers |
|---|------|--------|
| 00 | [Vision & pillars](docs/specs/00-vision.md) | What the game is, who it is for, design pillars, scope |
| 01 | [Run structure](docs/specs/01-run-structure.md) | Core loop, cycles, steps, lives, run end, meta-progression |
| 02 | [Co-op & party](docs/specs/02-coop-party.md) | 1–4 player model, ownership, shared resources, disconnects |
| 03 | [Combat](docs/specs/03-combat.md) | Autobattle model, determinism, units, items, synergies |
| 04 | [Encounters & matchmaking](docs/specs/04-encounters-matchmaking.md) | PvE encounters, ghost PvP, snapshot matching, boss fallback |
| 05 | [Scaling & economy](docs/specs/05-scaling-economy.md) | Exponential PvE scaling, player power curve, economy |
| 06 | [Technical architecture](docs/specs/06-technical-architecture.md) | Simulation core, server, persistence, versioning |
| 07 | [Open questions](docs/specs/07-open-questions.md) | Decisions still to be made, with recommendations |

## Conventions used in the specs

- **[DECIDED]** — stated by the project owner; treat as a requirement.
- **[PROPOSED]** — a recommended default from brainstorming; open to change.
- **[OPEN]** — undecided; tracked in `07-open-questions.md`.
- Requirements carry stable IDs (e.g. `MM-3`) so backlog items can reference
  them.
