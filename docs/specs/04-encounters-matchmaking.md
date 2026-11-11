# 04 — Encounters & Matchmaking

Status: Draft v4.5

## Encounter types

| Type | Opponent | When | Stakes |
|------|----------|------|--------|
| PvE battle (easy / medium / hard) | Scripted waves plus a stronghold, scaled to round, difficulty, and party size | First battle of each round | Reward on win; no reward and no life loss on defeat |
| PvP battle — ghost | Snapshot of another real party's factory | Second battle of each round | Gold on win; on defeat, lose 1 life and receive a small consolation payout |
| PvP battle — boss | Generated boss threat | Second battle of each round, when no ghost matches | Same as ghost |

The loop is defined in `01-run-structure.md` RS-1.

## Snapshots

- **MM-1 [DECIDED/PROPOSED detail]** At the start of **every PvP battle**, the
  host saves a **snapshot** of the party's team state to the ghost pool
  (stored on Steam; see TA-15 to TA-19). A snapshot
  contains:
  - the run version (`major.minor`; see TA-8) and a snapshot format version
  - party size
  - round number
  - full team state: the party's map, Core position, buildings, conduits,
    and run modifiers (CB-32, CP-6)
  - the run's ID and seed, and a signature (TA-22a)
  - party members' Steam IDs (display names are looked up from Steam)
  - metadata: lives remaining and PvP record at that point (for optional
    match-quality filtering)
- **MM-1d [PROPOSED]** The run's action log, needed only for verification by
  replay (TA-22b), is stored alongside the snapshot as a separate file and
  is not downloaded for an ordinary battle (TA-19).
- **MM-1a [PROPOSED]** Snapshots are taken *before* the fight and are saved
  regardless of whether the party then wins or loses. Saving only winners
  would make the pool progressively harder than the real population.
- **MM-1b [PROPOSED]** Snapshots contain no personal data beyond Steam IDs,
  and a player can opt to appear anonymously to opponents.
- **MM-1c [PROPOSED]** Each host has at most one snapshot per
  `(version, party size, round)` bucket; a newer run replaces it (TA-18).

## Ghost matching

- **MM-2 [DECIDED]** A snapshot is eligible as a ghost for a party only if all
  three match exactly:
  1. **game version**
  2. **party size**
  3. **progress** — the same round number (RS-2)
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
  against the party's, the two boards facing each other across a freshly generated neutral zone
  (CB-8, CB-28).
  The original ghost party is not notified and is not affected by the result.
  (Optional later: "your ghost won N fights" stat.)
- **MM-7 [PROPOSED]** Opponent selection and the combat seed are chosen
  by the host's game, and the opponent is not revealed until the party's
  board is locked. The ghost may be fetched earlier in the round to avoid a
  wait (TA-19).

*Implementation note (W3-1; spec statuses unchanged).* The local ghost pool
decides these [PROPOSED] details: the opponent is selected on entering the shop
before the PvP battle (MM-7, MM-11); MM-3's member exclusion is "the same run"
only, because a local pool has a single owner; ghosts already fought are
excluded by owner and run, so one ghost is met at most once per run (MM-3);
the local pool keeps the player's last five runs per owner and bucket, and a
selection validates a bounded number of rows (`docs/rules-reference.md`,
"Local pool limits");
invalid snapshots are filtered out before one uniform draw (MM-4, MM-17); the
power bound is the building-value formula in `docs/rules-reference.md`,
"Ghosts"; signatures (MM-17, TA-22a) and the run seed and action log (MM-1d)
are not implemented, the latter two are reserved fields.

*Implementation note (W3-2; spec statuses unchanged).* MM-12 (b) is
implemented for the prototype: a bundled file of bot-made snapshots (party
sizes 1 to 4, rounds 1 to 6, four per bucket, owner labels "Bundled <strategy>
bot") is a read-only second source beside the local pool, ignored when its game
version differs from the build's; "Clear ghost pool" clears only the local
rows. See `docs/rules-reference.md`, "Bundled ghosts".

## Boss fallback

- **MM-8 [DECIDED]** The generated boss is a function of how far the party has
  progressed.
- **MM-9 [PROPOSED]** Generation is a pure function of
  `(game version, party size, round number, seed)`:
  1. Compute a **power budget** from the round number using the PvE scaling
     curve (`05-scaling-economy.md` SC-1).
  2. Pick a **boss template** valid for that depth band: a threat profile
     (CB-29): a wave schedule and a stronghold with a signature mechanic.
  3. Spend the budget on wave size and composition over time and on the
     stronghold's health and defenses, multiplied by party size (CP-7).
  4. Emit a threat profile (CB-34). Bosses are scripted threats, not
     factories.
- **MM-10 [PROPOSED]** A boss should be tuned to be roughly as dangerous as
  the *median* ghost at that round while ghosts exist at that depth, and to
  follow the exponential curve beyond it. In practice the snapshot pool thins
  out at high rounds, so deep runs naturally transition from ghosts to
  ever-harder bosses — this is the mechanism that ends every run (V-5).
- **MM-11 [PROPOSED]** Players are told whether a PvP battle is a ghost or a
  boss, before or at fight start. Bosses are presented as bosses, never
  disguised as players.

## Pool health

- **MM-12 [PROPOSED]** **Cold start**: a new minor or major version starts with an empty
  pool, so early parties fight bosses. Mitigations, in order of preference:
  (a) accept it — bosses are a designed fallback; (b) seed the pool for early
  rounds with snapshots from internal playtests or bot-driven runs on the new
  version.
- **MM-13 [DECIDED]** **Retention**: all ghost data for old versions is
  deleted on a major version release (TA-8, TA-9).
- **MM-13a [PROPOSED]** Between major releases the pool is bounded by one
  snapshot per host per bucket (MM-1c), which assumes Steam keeps one entry
  per player per leaderboard (unconfirmed, TA-18).
- **MM-14 [PROPOSED]** **Thin buckets**: 3- and 4-player buckets and deep
  rounds will be sparse. This is acceptable by design (boss fallback), and
  bucket sizes can be read directly from the entry counts to inform tuning.
- **MM-15 [DECIDED]** A run only meets ghosts played on the same version as
  the run itself, including after the game has been updated (TA-8).
- **MM-15a [PROPOSED]** Patch releases that do not touch combat do not split
  the pool (TA-8).

## Integrity

- **MM-16 [PROPOSED]** There is no trusted server, so snapshots are uploaded
  by players' games and could be forged by a modified client. This is an
  accepted risk with limited damage; see "Trust model" (TA-21 to TA-24).
- **MM-17 [PROPOSED]** Every downloaded snapshot is validated before use: its signature (TA-22a),
  schema, legal placement on its own map (sources on nodes, nothing on
  natural features, a valid Core position), a map that the generator could
  have produced, and a plausibility bound on total power for its round
  (TA-22). The generator and the numbers used for these checks are the
  installed version's; a snapshot from a run that spanned an update is
  given more tolerance on the power bound. A snapshot that fails is skipped and another is drawn.
- **MM-17a [PROPOSED]** Players can report a ghost (TA-23).

## PvE encounters

- **MM-18 [PROPOSED]** PvE enemies are **threat profiles** (CB-29) — waves plus a stronghold — built
  from templates and scaled by the same budget function as bosses, with a
  multiplier per difficulty (easy < medium < hard; see SC-1) and by party
  size (CP-7).
- **MM-19 [DECIDED/PROPOSED detail]** The party is offered easy, medium, and
  hard each round (RS-3). Each option shows the enemy archetype (rusher,
  fortress, escalator, …) and the reward; the party votes (CP-16). The three options may be different
  templates, not just the same enemy at three strengths.
- **MM-20 [PROPOSED]** PvE battles are not snapshotted and do not affect the
  ghost pool.
