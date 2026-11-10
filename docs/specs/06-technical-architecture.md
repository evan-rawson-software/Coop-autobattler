# 06 — Technical Architecture

Status: Draft v0.4

Technology choices here are recommendations, not decisions. The component
boundaries matter more than the specific stack.

## Components

```
+-----------+      realtime       +------------------+      +-------------+
|  Client   | <-----------------> |   Game server    | <--> |  Database   |
| (render,  |   intents / state   | (run state,      |      | (accounts,  |
|  input)   |   + combat logs     |  matchmaking,    |      |  runs,      |
+-----------+                     |  authoritative   |      |  snapshots) |
      |                           |  simulation)     |      +-------------+
      |                           +------------------+
      |                                    |
      +----------- shared packages --------+
                 - simulation core (deterministic, headless)
                 - content data + schemas
                 - protocol types
```

## Requirements

- **TA-1 [PROPOSED]** **Simulation core** is a standalone, dependency-light
  library: `simulate(teamA, teamB, seed) -> { result, eventLog }`. No I/O, no
  rendering, no clock. Used by the server, the client (for replays/preview),
  tests, and the balance harness (SC-6).
- **TA-2 [PROPOSED]** Determinism rules for the core: seeded PRNG passed in
  explicitly; integer or fixed-point math for anything outcome-affecting;
  stable ordering for all iteration; fixed tick rate. A **golden replay test
  suite** (stored inputs → expected result hash) guards against accidental
  behaviour changes.
- **TA-3 [PROPOSED]** **Server-authoritative runs.** The server owns run state
  (gold, shops, stashes, boards, lives, cycle, step). Clients send intents (buy,
  sell, move, give, ready, vote); the server validates and broadcasts state.
  The server rolls shops, selects opponents, picks seeds, and runs the fight.
- **TA-4 [PROPOSED]** **Realtime transport** (e.g. WebSocket) for the lobby
  events, and prep phases. A party's run lives in a "room" that survives individual
  disconnects (CP-20).
- **TA-5 [PROPOSED]** **Persistence**:
  - accounts / identities
  - runs (resumable state, history, final depth)
  - snapshots, indexed by `(sim version, party size, cycle)` for MM-2 lookups
  - leaderboards per party size
- **TA-6 [PROPOSED]** **Content is data** (CB-35): items, tags,
  encounter and boss templates, and scaling constants live in versioned data
  files with schema validation in CI.
- **TA-7 [PROPOSED]** **Solo uses the same path** as multiplayer (a party of
  one on the server). No separate offline mode initially; it would fork the
  authority model and allow forged snapshots.

## Versioning

- **TA-8 [PROPOSED]** Distinguish two versions:
  - **sim version** — changes whenever simulation code or combat-affecting
    content changes. This is the "game version" used for ghost matching
    (MM-2). It can be derived automatically (hash of sim core + content data)
    so it cannot be forgotten.
  - **app version** — client/server release number; may change without
    invalidating the snapshot pool.
- **TA-9 [PROPOSED]** On a sim version change: the old snapshot pool is
  retired (MM-13); in-progress runs on the old version are closed out at
  their current depth (simplest), or allowed to finish against bosses only.

## Recommended stack [PROPOSED]

- **Language:** TypeScript end to end, in a monorepo, so the simulation core
  is literally the same code on client and server.
- **Client:** web first (browser), 2D rendering via a lightweight engine
  (e.g. PixiJS or Phaser). Lowest friction for co-op with friends: share a
  link. Desktop packaging can come later.
- **Server:** Node.js with a room-based realtime framework (e.g. Colyseus) or
  plain WebSockets.
- **Database:** PostgreSQL (snapshots as JSONB with an index on the match key).
- **Testing:** unit tests on the sim core, golden replays, schema validation,
  and the balance harness as a CLI.

Alternative: a game engine client (Godot/Unity) with the sim core in a
language shared with the server (e.g. C#). Better tooling for art-heavy
presentation, heavier setup, harder to share one sim between client and
server unless the server also runs that runtime. See Q6.

## Suggested milestones

1. **M0 — Sim core:** deterministic headless fights between two hard-coded
   teams of 1–4 boards each (lanes from the start, so co-op is not a
   retrofit); CLI runner; golden tests.
2. **M1 — Solo loop, local:** PvE battle (3 difficulties) + shop event + exponential scaling +
   lives; minimal UI; placeholder content (CB-50).
3. **M2 — Server authority:** run state on the server; accounts; resumable
   runs.
4. **M3 — Ghosts:** snapshot save, matching, boss fallback, the full three-step cycle.
5. **M4 — Co-op:** lobby, 2–4 players, one board each, giving, votes,
   disconnect handling.
6. **M5 — Balance & content:** balance harness, content expansion,
   meta-progression, events.

M3 before M4 is deliberate: ghost PvP is the riskiest system-level feature and
can be proven with solo parties first.
