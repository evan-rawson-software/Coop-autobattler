# Coop Autobattler (working title)

A co-op roguelite autobattler for 1–4 players. The party builds one large
shared factory on a randomly generated map between fights, then watches it
produce units and defend itself in automated combat
against a mix of PvE encounters and asynchronous PvP "ghost" parties. PvE difficulty grows
exponentially, so every run eventually ends in defeat — the question is how far
you get.

The project is in the **specification phase**. Only the repository scaffolding
for the web proof of concept exists; no game logic is implemented yet.

Plan: (1) an offline, single-player **web proof of concept** for early
playtesting, (2) a port to **Godot**, (3) co-op and online ghost PvP on
**Steam**.

## Development

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the repository layout, the
commands, and the layer rule.

## Watch a battle

After `pnpm install`, one command runs a battle between two reference boards
and prints the result, a short timeline and the event log hash:

```
pnpm sim battle --a rush --b fortify --seed 1
```

The other commands (`map`, `pve`, `batch`) and the board files are described in
[`CONTRIBUTING.md`](CONTRIBUTING.md#battle-runner-pnpm-sim).

## Specifications

High-level specs live in [`docs/specs/`](docs/specs/). They are intended to be
refined and then broken down into backlog items for coding agents.

| # | Spec | Covers |
|---|------|--------|
| 00 | [Vision & pillars](docs/specs/00-vision.md) | What the game is, who it is for, design pillars, scope |
| 01 | [Run structure](docs/specs/01-run-structure.md) | Core loop, rounds, steps, lives, run end |
| 02 | [Co-op & party](docs/specs/02-coop-party.md) | 1–4 player model, the shared board, ownership, building together, disconnects |
| 03 | [Combat](docs/specs/03-combat.md) | The shared factory and battlefield: terrain, resources and conduits, units, in-battle ramp, defenses, opponents |
| 04 | [Encounters & matchmaking](docs/specs/04-encounters-matchmaking.md) | PvE encounters, ghost PvP, snapshot matching, boss fallback |
| 05 | [Scaling & economy](docs/specs/05-scaling-economy.md) | Exponential PvE scaling, player power curve, economy |
| 06 | [Technical architecture](docs/specs/06-technical-architecture.md) | Phases (web proof of concept → Godot → Steam multiplayer), Steam as the backend, trust model |
| 07 | [Open questions](docs/specs/07-open-questions.md) | Decisions still to be made, with recommendations |

## Wireframes

Layout sketches of the screens of a run (menu, Core placement, PvE choice,
battle, summary, event, shop, build, and run over) are in
[`docs/wireframes/`](docs/wireframes/).
The shop and build screens show your own plot, border links to a
neighbour's plot, and the need per second of each building.

## Conventions used in the specs

- **[DECIDED]** — stated by the project owner; treat as a requirement.
- **[PROPOSED]** — a recommended default from brainstorming; open to change.
- **[OPEN]** — undecided; tracked in `07-open-questions.md`.
- **[DECIDED for now]** — an owner decision that is expected to be
  revisited after playtesting.
- **[DECIDED/PROPOSED detail]** — the headline rule is the owner's decision;
  the rest is a suggested default. Where the requirement has a "Proposed
  detail" list, that list is the proposed part.
- Other bracketed variants (for example "[DECIDED shape / PROPOSED
  formula]") name which part is decided in the tag itself.
- Requirements carry stable IDs (e.g. `MM-3`) so backlog items can reference
  them.
