# 04 — Encounters & Matchmaking

Status: Draft v1.1

## Encounter types

| Type | Opponent | When | Stakes |
|------|----------|------|--------|
| PvE battle (easy / medium / hard) | Scripted waves plus a stronghold, scaled to cycle, difficulty, and party size | Step 1 of each cycle | Reward on win; no reward and no life loss on defeat |
| PvP battle — ghost | Snapshot of another real party's factory | Step 3 of each cycle | Reward on win; lose 1 life on defeat |
| PvP battle — boss | Generated boss threat | Step 3 of each cycle, when no ghost matches | Same as ghost |

The loop is defined in `01-run-building.md` RS-1.

## Snapshots

- **MM-1 [DECIDED/PROPOSED detail]** At the start of **every PvP battle**, the
  host saves a **snapshot** of the party's team state to the ghost pool
  (stored on Steam; see TA-15 to TA-19). A snapshot
  contains:
  - game version (content + simulation version; see TA-8)
  - party size
  - cycle number
  - full team state: the party's map, Core position, and buildings
    (CB-32, CP-6)
  - party members' Steam IDs (display names are looked up from Steam)
  - metadata: lives remaining and PvP record at that point (for optional
    match-quality filtering)
- **MM-1a [PROPOSED]** Snapshots are taken *before* the fight and are saved
  regardless of whether the party then wins or loses. Saving only winners
  would make the pool progressively harder than the real population.
- **MM-1b [PROPOSED]** Snapshots contain no personal data beyond Steam IDs,
  and a player can opt to appear anonymously to opponents.
- **MM-1c [PROPOSED]** Each host has at most one snapshot per
  `(version, party size, cycle)` bucket; a newer run replaces it (TA-18).

## Ghost matching

- **MM-2 [DECIDED]** A snapshot is eligible as a ghost for a party only if all
  three match exactly:
  1. **game version**
  2. **party size**
  3. **progress** — the same cycle number (RS-2)
- **MM-3 [PROPOSED]** Additional exclusions:
  - snapshots from any party that includes a member of the requesting party
    (which also covers the party's own snapshots)
  - ghosts this party has already fought in this run
- **MM-4 [PROPOSED]** Selection among eligible snapshots is uniformly random
  initially. Later refinements, in priority order: prefer recent snapshots;
  prefer snapshots with a similar lives/record profile. What is practical
  depends on what the Steam storage mechanism can query (TA-17).
- **MM-5 [DECIDED]** If no eligible snapshot exists, a **PvE boss** is
  generated instead, based on the party's progress (see below).
- **MM-6 [PROPOSED]** The ghost's factory runs in the standard simulation
  against the party's, the two boards joined front to front (CB-8, CB-28).
  The original ghost party is not notified and is not affected by the result.
  (Optional later: "your ghost won N fights" stat.)
- **MM-7 [PROPOSED]** Opponent selection and the combat seed are chosen
  by the host's game, and the opponent is not revealed until the party's
  boards are locked. The ghost may be fetched earlier in the cycle to avoid a
  wait (TA-19).

## Boss fallback

- **MM-8 [DECIDED]** The generated boss is a function of how far the party has
  progressed.
- **MM-9 [PROPOSED]** Generation is a pure function of
  `(game version, party size, cycle number, seed)`:
  1. Compute a **power budget** from the cycle number using the PvE scaling
     curve (`05-scaling-economy.md` SC-1).
  2. Pick a **boss template** valid for that depth band: a threat profile
     (CB-29): a wave schedule and a stronghold with a signature mechanic.
  3. Spend the budget on wave size and composition over time and on the
     stronghold's health and defenses, multiplied by party size (CP-7).
  4. Emit a threat profile (CB-34). Bosses are scripted threats, not
     factories.
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
- **MM-13 [PROPOSED]** **Retention**: bounded by one snapshot per host per
  bucket (MM-1c). Pools for old versions are simply never read again; whether
  they need active cleanup is a spike question (TA-30).
- **MM-14 [PROPOSED]** **Thin buckets**: 3- and 4-player buckets and deep
  cycles will be sparse. This is acceptable by design (boss fallback), and
  bucket sizes can be read directly from the entry counts to inform tuning.
- **MM-15 [OPEN]** Whether a version bump that changes only non-combat things
  (UI, bug fixes outside the sim) should invalidate the pool. Recommended: no
  — see TA-8.

## Integrity

- **MM-16 [PROPOSED]** There is no trusted server, so snapshots are uploaded
  by players' games and could be forged by a modified client. This is an
  accepted risk with limited damage; see "Trust model" (TA-21 to TA-24).
- **MM-17 [PROPOSED]** Every downloaded snapshot is validated before use:
  schema, legal placement on its own map (sources on nodes, nothing on
  natural features, a valid Core position), a map that the generator could
  have produced, and a plausibility bound on total power for its cycle
  (TA-22). A snapshot that fails is skipped and another is drawn.
- **MM-17a [PROPOSED]** Players can report a ghost (TA-23).

## PvE encounters

- **MM-18 [PROPOSED]** PvE enemies are **threat profiles** (CB-29) — waves plus a stronghold — built
  from templates and scaled by the same budget function as bosses, with a
  multiplier per difficulty (easy < medium < hard; see SC-1) and by party
  size (CP-7).
- **MM-19 [DECIDED/PROPOSED detail]** The party is offered easy, medium, and
  hard each cycle (RS-3). Each option shows the enemy archetype (rusher,
  fortress, escalator, …) and the reward; the party votes (CP-16). The three options may be different
  templates, not just the same enemy at three strengths.
- **MM-20 [PROPOSED]** PvE battles are not snapshotted and do not affect the
  ghost pool.
