# 04 — Encounters & Matchmaking

Status: Draft v5.4

## Encounter types

| Type | Opponent | When | Stakes |
|------|----------|------|--------|
| PvE battle (easy / medium / hard) | Scripted waves plus a stronghold with one Core per player, scaled to round, difficulty, and party size | First battle of each round | Reward on win; no reward and no life loss on defeat |
| PvP battle — ghost | Snapshot of another real party's board | Second battle of each round | Gold on win; on defeat, lose 1 life and receive a small consolation payout |
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
  - full team state: the party's map, every player's Core position,
    buildings (placed and stashed) and conduits with their owners (border
    links included), run modifiers, and each player's specialist (CB-32,
    CP-6, MM-1e)
  - the run's ID and seed, and a signature (TA-22a)
  - party members' Steam IDs (display names are looked up from Steam)
  - metadata: lives remaining and PvP record at that point (for optional
    match-quality filtering)
- **MM-1e [PROPOSED]** **A snapshot carries each player's specialist**
  (CP-31). When the snapshot is a ghost, its players' specialist bonuses act
  for their own buildings and units in the fight exactly as in the original
  run (CB-51a), and the signature buildings on the board work as built. The
  field is optional: a snapshot without it (written before specialists) has
  no specialists and plays as before, so it stays eligible (see "Versions and
  saved formats" in `CONTRIBUTING.md`). PvE threats and bosses have none.
- **MM-1d [PROPOSED]** The run's action log, needed only for verification by
  replay (TA-22b), is stored alongside the snapshot as a separate file and
  is not downloaded for an ordinary battle (TA-19).
- **MM-1a [PROPOSED]** Snapshots are taken *before* the fight and are saved
  regardless of whether the party then wins or loses. Saving only winners
  would make the pool progressively harder than the real population.
- **MM-1b [DECIDED]** Snapshots contain no personal data beyond Steam IDs.
  **Steam persona names are shown on ghosts by default; a player can opt out
  and appear anonymously** (issue #392).
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
- **MM-2a [DECIDED]** **Specialists play no part in matching.** They are not
  in the eligibility key (MM-2), the selection (MM-4) or any weighting;
  neither the party's specialists nor a ghost's are read to choose an
  opponent.
- **MM-4 [DECIDED]** **Ghost selection is uniform random among eligible
  snapshots** (issue #392).
  - **MM-4a [OPEN]** Any weighting (prefer recent snapshots; prefer
    snapshots with a similar lives/record profile) is decided later from
    online data (issue #368). What is practical depends on what the Steam
    storage mechanism can query (TA-17).
- **MM-5 [DECIDED]** If no eligible snapshot exists, a **PvE boss** is
  generated instead, based on the party's progress (see below).
- **MM-6 [PROPOSED]** The ghost's board runs in the standard simulation
  against the party's, the two boards facing each other across a freshly generated neutral zone
  (CB-8, CB-28). **The ghost party's plots face the party's plots one to
  one** [DECIDED]: each player's plot has exactly one enemy plot directly
  opposite, and that plot's Core is the first target of the player's units
  (CB-15b).
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
the local pool keeps the player's last five runs per owner and bucket
(`GHOST_KEEP_PER_OWNER_BUCKET`), and a selection validates a bounded number
of rows (`docs/rules-reference.md`, "Local pool limits");
invalid snapshots are filtered out before one uniform draw (MM-4, MM-17); the
power bound is the building-value formula in `docs/rules-reference.md`,
"Ghosts", applied per owner, with no extra tolerance for runs that spanned an
update; signatures (MM-17, TA-22a) and the action log (MM-1d) are not
implemented. The run's seed is stored as `mapSeed`; the separate `runSeed`
and `actionLog` fields are reserved and rejected for now. The owner label is
the party's player names.

*Implementation note (W3-2; spec statuses unchanged).* MM-12 (b) is
implemented for the prototype: a bundled file of bot-made snapshots (party
sizes 1 to 4, rounds 1 to 6, four per bucket, owner labels "Bundled <strategy>
bot") is a read-only second source beside the local pool, ignored when its game
version differs from the build's; "Clear saved opponents" (Developer menu)
clears only the local rows. See `docs/rules-reference.md`, "Bundled ghosts".

## Boss fallback

- **MM-8 [DECIDED]** The generated boss is a function of how far the party has
  progressed.
- **MM-9 [PROPOSED]** Generation is a pure function of
  `(game version, party size, round number, seed)`:
  1. Compute a **power budget** from the round number using the PvE scaling
     curve (`05-scaling-economy.md` SC-1).
  2. Pick a **boss template** from the bosses **unlocked** at that round
     (MM-9b): a threat profile (CB-29): a wave schedule and a stronghold
     with a signature mechanic. Unlocks are cumulative: a boss stays in the
     draw once it is unlocked.
  3. Spend the budget on wave size and composition over time and on the
     stronghold's health and defenses, multiplied by party size (CP-7). The
     stronghold has one Core per player, and its total Core health is split
     evenly between them (CB-29).
  4. Emit a threat profile (CB-34). Bosses are scripted threats, not
     factories.
- **MM-9a [DECIDED]** **A boss mechanic changes only the boss's own side**:
  its stronghold and its units. It never changes how the party's factory
  works: no effect on party buildings, production, flow, ramp or turrets.
  **This applies to every PvE opponent, bosses and PvE threats alike**
  (V-17): no mechanic may change how a player's factory functions, because
  the player has no way of dealing with it at the time.
  Reason: the party gives no orders during a battle (pillar 4), so a
  mechanic that breaks their factory mid-fight cannot be answered. Rejected
  for this reason: jammers that stop party buildings, siege units that
  target the factory, and waves that switch lanes. Party units may change
  what they walk to because of a building on the boss's side (MM-9d,
  Pylons); that is not a change to the factory.
- **MM-9b [DECIDED]** **Roster and unlocks.** Each boss has a first round
  and a minimum party size. The boss is a uniform draw (from the seed)
  among the bosses that are unlocked at the round and fit the party size.
  Bonded needs 2 or more players, so it is skipped in solo and the
  draw picks another unlocked boss. The first round and minimum party size
  are `fromRound` and `minPartySize` in `content/threats.json`. A boss with only a data signature (a
  different wave mix and nothing new in the arena) was rejected as too close
  to ordinary PvE.
- **MM-9c [DECIDED]** **No back-to-back repeats.** The boss met in the run's
  previous boss battle is left out of the draw when another boss is
  eligible. If it is the only eligible one, it is drawn again.
- **MM-9d [PROPOSED]** **The bosses.** Each has one new arena rule, boss side
  only (MM-9a). Names are the display names in `content/presentation.en.json`
  (`archetypes`); they are working names until the theme issue (#393). All five are implemented; their numbers are configuration
  in `content/threats.json` (`archetypes`) and stay [PROPOSED]. Every boss
  has the Boss's waves, including every third wave being all raiders; the
  others add one mechanic each.

  | Boss | ID | From round | Party size | Mechanic (boss side only) | Counter |
  |------|----|-----------|------------|---------------------------|---------|
  | Boss | `arch_boss` | 1 | any | Every third wave is all raiders. The early, cold-start boss (MM-12). | Defence against swarms |
  | Brood | `arch_boss_brood` | 3 | any | Each boss Core releases a burst of units when its health falls to each of the thresholds in `brood.thresholdsPercent` (75%, 50% and 25% of its starting health now). A hit that crosses several thresholds releases each of them; destroying a Core releases any left. | Keep defence at home; do not go all-in on attack |
  | Bonded | `arch_boss_linked` | 5 | 2–4 | The boss Cores share one health pool: damage to any of them comes off the pool, and they all fall together when it is empty. | Co-op: a strong lane carries a weak one; total pressure matters |
  | Pylons | `arch_boss_pylons` | 7 | any | Each boss plot has `pylons.perPlot` shield pylons (3 now) around its Core. That Core takes no damage from units while any of its pylons stands. Party units treat a shielded Core's pylons as their targets until they are down. | Enough units to break through; ranged units to reach pylons |
  | Warlord | `arch_boss_warlord` | 9 | any | Every wave is led by one champion per boss plot: a Golem with up to `champion.healthPercent` of a Golem's health (600% now), paid for out of the wave budget. | Focused damage and walls that delay it; Golem armor shrugs off splash |

  - Of refining's units, only the Golem appears in a boss, as the Warlord's
    champion. No threat's wave mix uses the Golem, caster or heavy unit.
  - Pylons: the party's units change what they walk to only because of a
    building on the boss's side. The party's factory works as always, so
    this fits MM-9a. Pylons are boss-only buildings (CB-29), never in a shop.
  - Out of scope: boss-only units the party can never get; boss rewards
    different from a ghost's; an endgame guard that forces bosses (SC-7);
    PvE threats that use these mechanics.
- **MM-9e [DECIDED]** **Every mechanic is paid from the boss's existing
  budget** (SC-1, boss multiplier). A mechanic does not raise the curve:
  the pylons, the burst units or the champion come out of the same total
  the boss would have had. Stakes are unchanged: losing to any boss costs 1
  life (RS-5a).
- **MM-10 [PROPOSED]** **Each boss** (every entry in MM-9d, not just "the
  boss") should be tuned to be roughly as dangerous as
  the *median* ghost at that round while ghosts exist at that depth, and to
  follow the exponential curve beyond it. In practice the snapshot pool thins
  out at high rounds, so deep runs naturally transition from ghosts to
  ever-harder bosses — this is the mechanism that ends every run (V-5).
- **MM-11 [PROPOSED]** Players are told whether a PvP battle is a ghost or a
  boss, before or at fight start. Bosses are presented as bosses, never
  disguised as players. When the opponent is a boss, the shop before the PvP
  battle names the boss and explains its mechanic and a counter, so the party
  can build against it. A ghost is still described only as a "rival party"
  (MM-7 is unchanged for ghosts). Implemented: the shop's next-battle panel
  shows the boss's name, mechanic and counter (`bossMechanic*` and
  `bossCounter*` in `content/presentation.en.json`).

- **MM-11a [PROPOSED]** **The PvP panel shows the ghost's specialists.** Once
  the board is locked and the ghost is revealed (MM-7), the opponent panel of
  the battle screen lists each ghost player next to their specialist, so the
  party can read what it is facing. Before that, a ghost is still only a
  "rival party" (MM-11), and the shop's next-battle panel says nothing about
  specialists. Bosses have no specialists.

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
  natural features, every building and conduit inside its owner's plot, one
  valid Core position per player inside that player's plot, legal border
  links), the generated map plus at most `maxAddedNodesPerPlot`
  added nodes per plot (`content/mapgen.json`; Rich vein, RS-4i4), each on a buildable cell of that
  plot, and a plausibility bound on total power for its round
  (TA-22). The generator and the numbers used for these checks are the
  installed version's; a snapshot from a run that spanned an update is
  given more tolerance on the power bound (not implemented: the bound has no
  such tolerance yet). A snapshot that fails is skipped and another is drawn.
- **MM-17a [PROPOSED]** Players can report a ghost (TA-23).

## PvE encounters

- **MM-18 [PROPOSED]** PvE enemies are **threat profiles** (CB-29) — waves plus a stronghold — built
  from templates and scaled by the same budget function as bosses, with a
  multiplier per difficulty (easy < medium < hard; see SC-1) and by party
  size (CP-7). There are nine **threat types**: the three that exist and six
  new ones (W4, #428). None of the six is built yet. Names are working names
  until the theme issue (#393); that issue keeps no name table yet, so the
  names are recorded here. All numbers below are [PROPOSED] and live in
  configuration; tuning is #435.

  | Threat | From round | Waves | Stronghold | Counter in the build |
  |--------|-----------|-------|------------|----------------------|
  | Rusher | 1 | Heavy early waves (existing) | Existing | Defence (existing) |
  | Fortress | 1 | Light waves (existing) | Heavily defended (existing) | Ramp and siege (existing) |
  | Escalator | 1 | Waves that grow quickly (existing) | Existing | Speed (existing) |
  | Skirmishers | 2 | Mostly archers, with a soldier screen | Open, many turrets | Fast melee to catch archers; turrets. Walls do not stop ranged attacks. |
  | Swarm | 1 | Raiders only, small and very frequent waves | Open, small Core | Area damage (casters); turrets |
  | Maze | 2 | Light waves | New `maze` layout: a winding walled path to the Core, lined with turrets | A strong army that pushes through, or breaching |
  | Focus | 3 | Normal mix, but each wave enters through one plot, which changes from wave to wave (CB-29) | Ring | Neighbours defend across borders; shared turrets near plot edges. In solo it plays as ordinary waves. |
  | Juggernaut | 3 | Few, slow, very tough waves of heavies and Golems | Line | Focused damage; walls to buy time |
  | Coven | 3 | Casters behind a soldier screen | Ring | Spread-out units; armored Golems shrug off splash |

  Threats that need refining's units start from round 3.
- **MM-18b [DECIDED]** **PvE threats use existing battle rules only.** A new
  threat differs in which units it sends, wave timing and stronghold layout.
  Special mechanics stay with bosses (MM-9a, MM-9d). Generator-side choices
  are allowed: stronghold layouts (the `maze` layout) and which plot a wave
  enters through (Focus, CB-29).
- **MM-18c [DECIDED]** **A threat changes only its own side**: its units, its
  waves and its stronghold. It never changes how the party's factory works.
  This is the design rule of MM-9a, which covers bosses and PvE threats
  alike.
- **MM-18a [DECIDED]** **PvE and PvP follow the same rules.** Every PvE
  opponent, bosses included, has one Core per player. The opponent's total
  Core health is split evenly between its Cores, and each wave unit heads
  first for the Core of the plot it enters (CB-29). The party wins when all
  of the opponent's Cores are destroyed.
- **MM-19 [DECIDED/PROPOSED detail]** The party is offered easy, medium, and
  hard each round (RS-3). Each option shows the threat type (MM-18) and the
  reward; the party votes (CP-16). **The three options use three different
  threat types**, not the same enemy at three strengths:
  - **Unlocked by round**: each type has a first round (MM-18), like bosses
    (MM-9b).
  - **Varied offers**: each round's three types leave out the types offered
    the round before, when enough other types are unlocked.
- **MM-20 [PROPOSED]** PvE battles are not snapshotted and do not affect the
  ghost pool.
- **Considered, not planned:** **Air raid** (a threat of drones only). Left out
  of the nine threat types (MM-18) by the owner (#428).
