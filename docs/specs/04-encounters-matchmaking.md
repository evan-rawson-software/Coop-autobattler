# 04 — Encounters & Matchmaking

Status: Draft v0.1

## Encounter types

| Type | Opponent | When | Stakes |
|------|----------|------|--------|
| PvE minor | Authored/generated enemy team scaled to round | Most rounds | Reward on win; no life loss |
| PvE elite | Tougher scaled team with a modifier | Once per cycle | Better reward; costs a life on loss |
| Showdown — ghost | Snapshot of another real party | End of each cycle | Lives |
| Showdown — boss | Generated boss | End of each cycle, when no ghost matches | Lives |

Exact cadence is defined in `01-run-structure.md` RS-1.

## Snapshots

- **MM-1 [DECIDED/PROPOSED detail]** At the start of **every Showdown**, the
  server saves an immutable **snapshot** of the party's team state. A snapshot
  contains:
  - game version (content + simulation version; see TA-8)
  - party size
  - round number
  - full team state (CB-4)
  - party display info (player display names, optional cosmetic info)
  - metadata: creation time, run ID, the party's lives remaining and
    Showdown record at that point (for optional match-quality filtering)
- **MM-1a [PROPOSED]** Snapshots are taken *before* the fight and are saved
  regardless of whether the party then wins or loses. Saving only winners
  would make the pool progressively harder than the real population.
- **MM-1b [PROPOSED]** Snapshots never contain private data beyond display
  names, and a player can opt to appear anonymously.

## Ghost matching

- **MM-2 [DECIDED]** A snapshot is eligible as a ghost for a party only if all
  three match exactly:
  1. **game version**
  2. **party size**
  3. **progress** — the same round number (RS-2)
- **MM-3 [PROPOSED]** Additional exclusions:
  - snapshots from the requesting party's own current run
  - snapshots from any run that includes a member of the requesting party
    (configurable; may be relaxed when the pool is small)
  - ghosts this party has already fought in this run
- **MM-4 [PROPOSED]** Selection among eligible snapshots is uniformly random
  initially. Later refinements, in priority order: prefer recent snapshots;
  prefer snapshots with a similar lives/record profile; cap how often one
  snapshot can be served so no single party dominates the pool.
- **MM-5 [DECIDED]** If no eligible snapshot exists, a **PvE boss** is
  generated instead, based on the party's progress (see below).
- **MM-6 [PROPOSED]** The ghost is fought with the standard simulation (CB-6).
  The original ghost party is not notified and is not affected by the result.
  (Optional later: "your ghost won N fights" stat.)
- **MM-7 [PROPOSED]** Opponent selection and the combat seed are chosen
  **server-side** when the build phase ends, after the party's team is locked.
  The party cannot see or re-roll the opponent before locking in.

## Boss fallback

- **MM-8 [DECIDED]** The generated boss is a function of how far the party has
  progressed.
- **MM-9 [PROPOSED]** Generation is a pure function of
  `(game version, party size, round number, seed)`:
  1. Compute a **power budget** from the round number using the PvE scaling
     curve (`05-scaling-economy.md` SC-1).
  2. Pick a **boss template** (a themed core unit/ability set) valid for that
     depth band.
  3. Spend the remaining budget on stat scaling, minions, and modifiers.
  4. Emit a normal team state (CB-6).
- **MM-10 [PROPOSED]** A boss should be tuned to be roughly as dangerous as
  the *median* ghost at that round while ghosts exist at that depth, and to
  follow the exponential curve beyond it. In practice the snapshot pool thins
  out at high rounds, so deep runs naturally transition from ghosts to
  ever-harder bosses — this is the mechanism that ends every run (V-5).
- **MM-11 [PROPOSED]** Players are told whether a Showdown is a ghost or a
  boss, before or at fight start. Bosses are presented as bosses, never
  disguised as players.

## Pool health

- **MM-12 [PROPOSED]** **Cold start**: a new game version starts with an empty
  pool, so early parties fight bosses. Mitigations, in order of preference:
  (a) accept it — bosses are a designed fallback; (b) seed the pool for early
  rounds with snapshots from internal playtests or bot-driven runs on the new
  version.
- **MM-13 [PROPOSED]** **Retention**: keep at most K snapshots per
  `(version, party size, round)` bucket (e.g. newest 1,000), and delete all
  snapshots for versions that are no longer live.
- **MM-14 [PROPOSED]** **Thin buckets**: 3- and 4-player buckets and deep
  rounds will be sparse. This is acceptable by design (boss fallback), but the
  service should expose per-bucket pool sizes as a metric so tuning decisions
  are informed.
- **MM-15 [OPEN]** Whether a version bump that changes only non-combat things
  (UI, bug fixes outside the sim) should invalidate the pool. Recommended: no
  — see TA-8.

## Integrity

- **MM-16 [PROPOSED]** Snapshots are created by the server from
  server-authoritative run state, never uploaded by clients. This prevents
  forged or impossible teams from entering the pool.
- **MM-17 [PROPOSED]** A snapshot that fails validation against the current
  content schema is quarantined and never served.

## PvE encounters

- **MM-18 [PROPOSED]** Minor and elite PvE teams come from **encounter
  templates** scaled by the same budget function as bosses, at a lower
  multiplier (minor < elite < boss).
- **MM-19 [PROPOSED]** The party is offered 2–3 PvE options per round showing
  the enemy archetype and the reward, and votes (CP-12).
