# 06 — Technical Architecture

Status: Draft v0.7

## Direction

- **TA-0 [DECIDED]** The game is built in **Godot** from the start. (This
  replaces the earlier web-first plan.)
- **TA-1 [DECIDED]** The target is a **Steam** release, and the game should
  use **Steam's own features for backend needs wherever possible**: lobby
  creation, multiplayer networking, and the asynchronous ghost PvP pool.
- **TA-2 [PROPOSED]** Consequence: **no custom backend** at launch — no game
  servers, no database, no account system of our own. Anything Steam cannot
  provide is either designed around or deferred (see "Trust model").

Specific Steamworks behaviours and limits below are from general knowledge of
the API and **must be confirmed against current Steamworks documentation in a
spike** (TA-30) before the dependent backlog items are written.

## Overview

```
              Steam
   +----------------------------+
   | Lobbies   Relay networking |
   | Leaderboards + shared files|  <- ghost pool
   | Cloud   Stats/Achievements |
   +-------------^--------------+
                 |  (through the Platform layer)
+----------------+-----------------------------------------------+
|  Game (Godot)                                                  |
|                                                                |
|  Presentation   scenes, UI, battle playback, audio             |
|  ------------------------------------------------------------  |
|  Session        host-authoritative run state, intents, sync    |
|  ------------------------------------------------------------  |
|  Platform       interface: lobby, transport, ghost store,      |
|                 cloud saves, leaderboards, identity            |
|                 implementations: Steam | Local (dev/tests)     |
|  ------------------------------------------------------------  |
|  Core           simulation, run rules, generators, content     |
|                 pure logic, no scenes, runs headless           |
+----------------------------------------------------------------+
```

## Steam feature mapping

| Need | Steam feature | Notes |
|------|---------------|-------|
| Identity | Steam ID / persona name | No accounts of our own. |
| Forming a party | Steam Lobbies | Friends-only/invite lobbies, lobby metadata (version, party size), join via overlay and invites. |
| Co-op networking | Steam Networking Sockets over Steam Datagram Relay | Peer-to-peer through Valve's relays; no port forwarding, no servers of ours. |
| Ghost pool | Steam Leaderboards with attached shared files | See "Ghost pool on Steam". |
| Depth leaderboards | Steam Leaderboards | One per party size (and per version or season). Friends/global views for free. |
| Saves, resumable runs | Steam Cloud | Run save and meta-progression. |
| Presence and invites | Rich Presence, friends list, overlay | "In a run — cycle 7, 3/4 players", join-game button. |
| Achievements, stats | Steam Stats & Achievements | Later milestone. |
| Controller / Steam Deck | Steam Input | Later milestone; keep UI controller-friendly from the start. |
| Playtesting | Steam Playtest, beta branches | Also how ghost pools get seeded before launch (MM-12). |

- **TA-3 [PROPOSED]** Steam integration uses the **GodotSteam** extension.

## Layers

- **TA-4 [PROPOSED]** **Core** is pure logic with no dependency on scenes,
  nodes, rendering, or Steam: the combat simulation
  (`simulate(teamA, teamB, seed) -> { result, eventLog }`), run rules (shop
  rolls, prices, combining, rewards), encounter and boss generators, and
  content loading. It runs under headless Godot for tests and the balance
  harness (SC-6).
- **TA-5 [PROPOSED]** **Platform** is an interface with two implementations:
  - **Steam** — the real thing.
  - **Local** — loopback/LAN transport, a file-based ghost store, local
    saves, and a fake identity. Used for development, automated tests, and
    CI, where Steam is not available. It is a development tool, not a
    shipped offline mode (TA-13).

  Nothing outside the Platform layer calls Steam directly. This is what lets
  coding agents and CI build and test every feature without a Steam client.
- **TA-6 [PROPOSED]** **Session** owns a run in progress and is
  **host-authoritative**: the lobby owner's game holds the run state, rolls
  shops, validates intents (buy, sell, place, give, ready, vote), selects
  opponents, and runs battles. Other players send intents and receive state
  updates and battle event logs. Solo is a session with one player and no
  networking.
- **TA-7 [PROPOSED]** **Presentation** renders state and plays back event
  logs. It contains no rules. Battle playback is driven entirely by the event
  log, for the host and guests alike.
- **TA-8 [PROPOSED]** Versioning. Distinguish two versions:
  - **sim version** — changes whenever simulation code or combat-affecting
    content changes. This is the "game version" used for ghost matching
    (MM-2) and is checked when joining a lobby. It can be derived
    automatically (hash of Core + content data) so it cannot be forgotten.
  - **app version** — the build number; may change without invalidating the
    ghost pool.
- **TA-9 [PROPOSED]** On a sim version change: the old ghost pool is simply
  no longer read (new version, new bucket names); in-progress runs on the old
  version are closed out at their current depth.

## Co-op session details

- **TA-10 [PROPOSED]** All party members must be on the same sim version; the
  lobby advertises it and mismatched players cannot join.
- **TA-11 [PROPOSED]** **Host loss.** The host sends every player a full run
  save at the start of each step. If the host disconnects, the run pauses;
  any remaining player can re-host from their copy and the others rejoin.
  Seamless automatic host migration is a later improvement.
- **TA-12 [PROPOSED]** **Resuming later.** The run save lives in each
  member's Steam Cloud. A run can be resumed when the same party re-forms a
  lobby (membership checked by Steam ID), hosted by anyone holding the save.
- **TA-13 [DECIDED]** No offline mode. The shipped game requires Steam.
- **TA-14 [PROPOSED]** Within a party there is no adversary, so the host is
  trusted by its guests. Guests still never apply rule outcomes themselves;
  one source of truth keeps everyone in sync.

## Ghost pool on Steam

The async PvP pool needs: store a snapshot, look up snapshots by
`(sim version, party size, cycle)`, pick one at random, download it.

- **TA-15 [PROPOSED]** **One leaderboard per bucket**, named from the match
  key, e.g. `ghost_<simversion>_p<partysize>_c<cycle>`, created on demand by
  the client. The leaderboard is used as an index, not as a ranking.
- **TA-16 [PROPOSED]** **Upload** (by the host, at the start of each PvP
  battle): write the snapshot as a file, share it through Steam to obtain a
  handle, submit a leaderboard entry in the bucket, and attach the handle to
  the entry. The entry's small "details" payload carries metadata that should
  be readable without downloading the file: the other party members' Steam
  account IDs (for exclusion rules and display), lives remaining, and a
  snapshot format version.
- **TA-17 [PROPOSED]** **Selection**: read the bucket's entry count, choose a
  random rank, download a small window of entries around it, drop excluded
  ones (MM-3), pick one, and download its attached file. Entry scores are
  random numbers so that rank order is a shuffle. Empty bucket or no eligible
  entry → boss fallback (MM-5).
- **TA-18 [PROPOSED]** Steam keeps one entry per user per leaderboard, so
  each host has **at most one snapshot per bucket** — their most recent run
  to reach that cycle replaces the previous one. This bounds the pool
  naturally and stops one prolific player from flooding a bucket.
- **TA-19 [PROPOSED]** Snapshots are compact (a few kilobytes at most): item
  IDs, tiers, positions, Core stats, modifiers. Ghost lookup and download
  happen during the event step so the PvP battle starts without a wait; a
  timeout falls back to the boss.
- **TA-20 [PROPOSED]** The ghost store is one of the Platform interfaces
  (TA-5), so the leaderboard mechanism can be swapped — for a different Steam
  mechanism or, if ever needed, a small web service — without touching game
  code.

## Trust model

With no server of our own, the host's game is the authority, and anything a
client can upload can in principle be forged by a modified client. This is
the main cost of the Steam-only approach, and it is stated here so the choice
is deliberate.

- **TA-21 [PROPOSED]** **Accepted risk:** forged ghost snapshots and forged
  depth-leaderboard scores are possible. The damage is limited: a forged
  ghost costs another party one life in one battle; forged scores affect
  bragging rights only. There is no economy, ranking reward, or trade to
  exploit.
- **TA-22 [PROPOSED]** **Mitigation — validate every downloaded snapshot**
  before use: schema check, legal item placement, and a **plausibility
  bound** (total item value and tiers cannot exceed what is achievable by
  that cycle). Invalid snapshots are skipped and another is drawn.
- **TA-23 [PROPOSED]** **Mitigation — reporting and cleanup:** players can
  flag a ghost; flagged entries can be removed by the developers through
  Steamworks tools.
- **TA-24 [PROPOSED]** **Escape hatch:** if abuse becomes a real problem
  after launch, add a small trusted service that re-simulates or validates
  submissions and writes to leaderboards configured to accept trusted writes
  only. TA-20 keeps this possible without redesign. Not built unless needed.

## Persistence

- **TA-25 [PROPOSED]** Local save files synchronized by Steam Cloud:
  - meta-progression (unlocks, records)
  - the current run save (one per party the player is in)
  - settings
- **TA-26 [PROPOSED]** Save files are versioned and carry the sim version.

## Content

- **TA-27 [PROPOSED]** **Content is data** (CB-35): items, tags, encounter
  and boss templates, and scaling constants live in versioned data files
  (JSON or Godot resources — prefer a text format that diffs well and can be
  validated in CI). Rules data is kept separate from names, descriptions, and
  art references, keyed by a stable item ID.

## Language

- **TA-28 [OPEN]** GDScript or C#. Recommended: **typed GDScript**
  throughout — simplest path with GodotSteam, one language for coding agents,
  no .NET export requirements. The simulation is discrete and small (beats,
  columns, a handful of effects), so performance should be adequate; confirm
  with the M0 performance budget (CB-36) and revisit only if the balance
  harness is too slow. See Q6.
- **TA-29 [PROPOSED]** Core uses integer math and an explicit seeded PRNG so
  battles are reproducible from `(teams, seed, sim version)` for tests,
  replays, and bug reports. Golden test vectors (stored inputs → expected
  result hash) guard against accidental behaviour changes.

## Spikes needed before committing to details

- **TA-30 [PROPOSED]** A short Steamworks spike, using a real app ID, to
  confirm:
  1. Leaderboards with attached shared files work as the ghost pool: create
     on demand, attach a file, random-rank download, download speed.
  2. Limits: number of leaderboards per app, details payload size, shared
     file size and per-user Cloud quota, rate limits.
  3. Whether stale buckets from old versions need cleaning up and how.
  4. Lobbies + relay networking through GodotSteam with Godot's multiplayer
     API, including reconnect.
  5. What can be tested with Valve's public test app ID versus what needs
     our own (leaderboards and Cloud need our own app).

  Fallback candidates if (1) disappoints: Steam Workshop items as hidden
  snapshot containers, or the small service in TA-24.

## Testing and CI

- **TA-31 [PROPOSED]** CI runs headless Godot: Core unit tests, golden
  vectors, content validation, and a **scripted bot** that plays full runs
  through the Session layer on the Local platform (including multi-player
  sessions over loopback). The same bot produces snapshots for seeding and
  drives the balance harness.
- **TA-32 [PROPOSED]** Steam-specific code is thin and tested manually
  against the Steam client; everything above the Platform interface is
  covered by automated tests on the Local implementation.

## Suggested milestones

0. **Foundations:** Godot project layout, layer boundaries, headless test
   runner and CI, Platform interface with the Local implementation, content
   schema.
1. **M0 — Sim core:** deterministic headless battles between hard-coded
   teams of 1–4 boards each; CLI runner; golden tests; performance budget.
2. **M1 — Solo loop:** PvE battle (3 difficulties) + shop event + prep
   phases + exponential scaling + lives; minimal UI; placeholder content
   (CB-50).
3. **M2 — Ghosts (local):** snapshot save, matching, validation, boss
   fallback, the full three-step cycle, against the file-based ghost store.
4. **M3 — Co-op (local):** host-authoritative session, 2–4 players over
   loopback/LAN, giving, votes, disconnect and re-host.
5. **M4 — Steam:** Steamworks spike (TA-30, can start any time), then
   lobbies, relay networking, leaderboard ghost store, Cloud saves, rich
   presence.
6. **M5 — Balance & content:** balance harness, content expansion,
   meta-progression, more event types, achievements.

Everything through M3 can be built and tested without Steam. The Steamworks
spike should run early in parallel because its findings can change TA-15 to
TA-19.
