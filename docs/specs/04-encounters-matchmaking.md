# 04 — Encounters & Matchmaking

Status: Draft v0.4

## Encounter types

| Type | Opponent | When | Stakes |
|------|----------|------|--------|
| PvE battle (easy / medium / hard) | Generated enemy team scaled to cycle and chosen difficulty | Step 1 of each cycle | Reward on win; no reward and no life loss on defeat |
| PvP battle — ghost | Snapshot of another real party | Step 3 of each cycle | Reward on win; lose 1 life on defeat |
| PvP battle — boss | Generated boss | Step 3 of each cycle, when no ghost matches | Same as ghost |

The loop is defined in `01-run-structure.md` RS-1.

## Snapshots

- **MM-1 [DECIDED/PROPOSED detail]** At the start of **every PvP battle**, the
  server saves an immutable **snapshot** of the party's team state. A snapshot
  contains:
  - game version (content + simulation version; see TA-8)
  - party size
  - cycle number
  - full team state: all N boards in lane order (CB-32, CP-6)
  - party display info (player display names, optional cosmetic info)
  - metadata: creation time, run ID, the party's lives remaining and
    PvP record at that point (for optional match-quality filtering)
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
  3. **progress** — the same cycle number (RS-2)
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
- **MM-6 [PROPOSED]** The ghost is fought with the standard simulation (CB-34).
  The original ghost party is not notified and is not affected by the result.
  (Optional later: "your ghost won N fights" stat.)
- **MM-7 [PROPOSED]** Opponent selection and the combat seed are chosen
  **server-side** when the prep phase ends, after the party's team is locked.
  The party cannot see or re-roll the opponent before locking in.

## Boss fallback

- **MM-8 [DECIDED]** The generated boss is a function of how far the party has
  progressed.
- **MM-9 [PROPOSED]** Generation is a pure function of
  `(game version, party size, cycle number, seed)`:
  1. Compute a **power budget** from the cycle number using the PvE scaling
     curve (`05-scaling-economy.md` SC-1).
  2. Pick a **boss template** (a themed set of signature items) valid for that
     depth band.
  3. Spend the remaining budget on item tiers, Core health, extra items, and modifiers.
  4. Emit a normal team state (CB-34) with **one board per player in the
     party** (CP-7). The budget is per board, so difficulty per player is the
     same at every party size. The boss itself may occupy one lane with
     support boards in the others, or be a set of N themed boards.
- **MM-9a [PROPOSED]** A ghost's boards face the party's boards lane for lane
  in their saved order (CP-10).
- **MM-10 [PROPOSED]** A boss should be tuned to be roughly as dangerous as
  the *median* ghost at that cycle while ghosts exist at that depth, and to
  follow the exponential curve beyond it. In practice the snapshot pool thins
  out at high cycles, so deep runs naturally transition from ghosts to
  ever-harder bosses — this is the mechanism that ends every run (V-5).
- **MM-11 [PROPOSED]** Players are told whether a PvP battle is a ghost or a
  boss, before or at fight start. Bosses are presented as bosses, never
  disguised as players.

## Pool health

- **MM-12 [PROPOSED]** **Cold start**: a new game version starts with an empty
  pool, so early parties fight bosses. Mitigations, in order of preference:
  (a) accept it — bosses are a designed fallback; (b) seed the pool for early
  cycles with snapshots from internal playtests or bot-driven runs on the new
  version.
- **MM-13 [PROPOSED]** **Retention**: keep at most K snapshots per
  `(version, party size, cycle)` bucket (e.g. newest 1,000), and delete all
  snapshots for versions that are no longer live.
- **MM-14 [PROPOSED]** **Thin buckets**: 3- and 4-player buckets and deep
  cycles will be sparse. This is acceptable by design (boss fallback), but the
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

- **MM-18 [PROPOSED]** PvE enemy teams come from **encounter templates**
  scaled by the same budget function as bosses, with a multiplier per
  difficulty (easy < medium < hard; see SC-1), generating one enemy board per
  player (CP-7).
- **MM-19 [DECIDED/PROPOSED detail]** The party is offered easy, medium, and
  hard each cycle (RS-3). Each option shows the enemy archetype and the
  reward; the party votes (CP-16). The three options may be different
  templates, not just the same enemy at three strengths.
- **MM-20 [PROPOSED]** PvE battles are not snapshotted and do not affect the
  ghost pool.
