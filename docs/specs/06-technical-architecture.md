# 06 — Technical Architecture

Status: Draft v0.6

- **TA-0 [DECIDED]** The first version is a **web application**. It must be
  architected so the client can later be **ported to Godot** without
  redesigning the game. See "Portability to Godot" below; those rules apply
  from the first commit.

Other technology choices here are recommendations. The component boundaries
matter more than the specific stack.

## Components

```
+----------------------+                      +--------------------+     +-----------+
|  Client (replaceable)|   language-neutral   |    Game server     |     | Database  |
|  web now, Godot later|  <---------------->  |  run state, shops, | <-> | accounts, |
|                      |  protocol: intents,  |  matchmaking,      |     | runs,     |
|  presentation only   |  state, event logs   |  simulation core   |     | snapshots |
+----------------------+                      +--------------------+     +-----------+
           |                                            |
           +------------- shared, engine-neutral -------+
                  - protocol schemas
                  - content data + schemas
                  - golden test vectors
```

The server owns all rules. A client only shows state, sends intents, and plays
back event logs. Replacing the client does not touch the rules.

## Requirements

- **TA-1 [PROPOSED]** **Simulation core** is a standalone, dependency-light
  library: `simulate(teamA, teamB, seed) -> { result, eventLog }`. No I/O, no
  rendering, no clock. Used by the server, tests, and the balance harness
  (SC-6). Clients do **not** run it; they receive the event log (TA-12).
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
- **TA-7 [DECIDED]** **There is no offline mode.** The game always requires
  a connection to the server. Solo uses the same path as multiplayer (a party
  of one on the server).

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

## Portability to Godot

The goal is that a Godot client is "a second client", not a rewrite of the
game. Everything below follows from keeping rules on the server and keeping
every shared artifact engine-neutral.

- **TA-10 [PROPOSED]** **No game rules in the client.** The client never
  computes prices, shop contents, combine results, legality of a placement,
  or battle outcomes. It may do cosmetic prediction (e.g. show an item where
  it was dropped while waiting for confirmation), but the server's answer
  always wins. Anything rule-like found in client code is a bug.
- **TA-11 [PROPOSED]** **Language-neutral protocol.** Messages are plain JSON
  over WebSocket (plus HTTPS for login and non-realtime calls), defined by
  schemas kept in the repo (e.g. JSON Schema), with a protocol version
  negotiated at connect. No framework-specific state-sync format and nothing
  that assumes a JavaScript client. TypeScript types are generated from the
  schemas, not the other way round; a Godot client can generate or hand-write
  its own from the same source.
- **TA-12 [PROPOSED]** **Battles are delivered as event logs.** The server
  runs the simulation and sends the result plus a self-describing event log
  (beat by beat: item fired, damage, shield, Core dark, …). Playback is pure
  presentation. This means the simulation never needs to be ported for a new
  client; replays are fetched from the server by battle ID.
- **TA-13 [PROPOSED]** **Rules data and presentation data are separate.**
  Content files hold rules (shape, tier, tags, effects) and a stable ID per
  item. Names, descriptions, and asset references live in separate
  presentation/localization files keyed by ID. Tooltip text is generated
  from rules data plus templates, so both clients describe items
  identically.
- **TA-14 [PROPOSED]** **Engine-neutral assets.** Art and audio are authored
  and stored in formats any engine imports (PNG/SVG sources, sprite sheets
  with JSON atlases, OGG/WAV). No look that exists only as CSS or
  web-specific shaders. Layout is described in logical units (board cells,
  lanes), not pixels or DOM structure.
- **TA-15 [PROPOSED]** **Client is layered** so the web version shows the
  seams a port will cut along:
  1. *Net layer* — connection, protocol messages, reconnect.
  2. *Client state* — a plain view-model of the run built from server
     messages; no rendering imports.
  3. *Presentation* — rendering, input, animation, audio.
  Only layer 3 is inherently web-specific. Layers 1–2 are small and are
  re-implemented in GDScript/C# from the protocol schemas.
- **TA-16 [PROPOSED]** **Platform-neutral identity.** Authentication uses
  tokens the client stores and sends explicitly, not browser-only mechanisms
  such as cookies, so a desktop client can log in the same way. Leave room
  for platform logins (e.g. Steam) to link to the same account.
- **TA-17 [PROPOSED]** **The simulation is server-only** and is not ported
  to Godot (TA-7). It is still written cleanly enough to survive a server
  rewrite: integer or
  fixed-point math only, explicit seeded PRNG with a documented algorithm, no
  reliance on language-specific behaviour (hash-map order, sort stability,
  float formatting). **Golden test vectors** are stored as language-neutral
  JSON files (inputs → expected result and event-log hash), so any port can
  be validated against the reference.
- **TA-18 [PROPOSED]** **A headless reference client** (a scripted bot that
  plays a run through the protocol alone) is kept in CI. It proves the
  protocol is sufficient to play the game without the web client, which is
  exactly what a Godot client will need, and doubles as the bot for seeding
  ghost pools (MM-12) and load testing.

What a Godot port then involves: reimplement the net and client-state layers
from the schemas, rebuild presentation with the same assets and logical
layout, and point it at the same server. Server, simulation, content,
matchmaking, and the snapshot pool are untouched, and web and Godot players
can share parties and ghost pools.

## Recommended stack [PROPOSED]

- **Language:** TypeScript for server, simulation, and the web client, in a
  monorepo.
- **Server:** Node.js with plain WebSockets and a thin room layer of our own,
  to keep the protocol framework-free (TA-11).
- **Web client:** a small 2D rendering layer (e.g. PixiJS) for boards and
  battle playback; ordinary web UI for menus and lobby. Kept deliberately
  thin (TA-15).
- **Database:** PostgreSQL (snapshots as JSONB with an index on the match key).
- **Testing:** tests on the sim core, golden vectors, schema validation, the
  reference client, and the balance harness as a CLI.

Note: Godot can also export to the web, so a future Godot client could
replace the web client outright rather than sit alongside it.

## Suggested milestones

0. **Foundations:** monorepo, protocol and content schemas, CI — in place
   before feature work so the portability rules are enforced from the start.
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
