# 07 — Open Questions

Status: Draft v4.5

Each question lists options and a recommendation. Answering Q2 unblocks backlog work on the simulation.

## Q1. Co-op model — decided

One large shared factory board for the whole party (CP-4, V-9). This replaced
one-board-per-player and removed the question of how separate boards fight
together. Remaining details:

- **Ownership.** Proposed: personal gold, shops, and stashes; shared space;
  anyone can move any building, only the owner can sell (CP-10 to CP-13).
  Alternative: everything pooled.

## Q2. Factory and battlefield rules

Decided (CB-2 to CB-3e): shared factory; economy is in-battle ramp; defense
buys time; random resource nodes and natural features; buildings that
produce units which march on the enemy base; Core fixed for the run,
everything else movable. Open:

- Decided: units fight each other when they meet (CB-16); route buildings
  can be destroyed (CB-9a).
- Decided: a small neutral zone with its own natural features is generated
  between the boards each battle and hidden until the battle begins (CB-8).
- Decided: the neutral zone can hold points of interest that buff whoever
  controls them, guarded by neutral units (CB-8). Units go to a point only if they
  path near enough to aggro (CB-8c). Units capture a point and move on;
  nobody stays behind to hold it. Open: aggro range and what the buffs
  are.
- **Map and plot size**, and board shape at 2–4 players (CB-4).
- Decided: buildings can be rotated. Conduits are free and unlimited, take
  space, cannot cross without a route building, and cannot be targeted
  (CB-3f to CB-3h). Gold is only for buying buildings at shops (CB-3i).
- Decided: units walk over conduits; destroying a building destroys its
  attached conduits up to the next building (CB-9a).
- Decided: conduit networks cannot loop (CB-9c).
- Decided: three resources, named Ore, Power, and Flux for now, renameable
  in one configuration file (CB-5a, TA-27a). A conduit carries one
  resource type; some rarer buildings need more than one type (CB-5a,
  CB-5b). Refined resources exist and the
  rarer, stronger buildings need them (CB-5d). Common refineries take one resource;
  rarer ones take two to make a single refined resource. Open: the exact
  list of refined resources, and whether refining stays one step deep
  (proposed).
- Decided: PvE enemies are scripted waves plus a stronghold (CB-29).
- Decided: the board never expands; it starts fairly large and its size
  is an endgame constraint (CB-25).
- Decided: no long-range buildings; defenses only target enemy units on
  the party's own side (CB-3j).

## Q3. Screens

Decided: top/bottom orientation with the party at the bottom (CB-45).
Wireframes of the screens of a run are in `docs/wireframes/`.

- Decided: nothing is timed; every player readies up to move on (CP-17).
- Decided for now: players do not see each other's shops; revisit after
  playtesting (CP-19).
- Decided: the camera starts at the center of the map (CB-47a).

## Q3a. Saving and disconnects

Decided:

- Battles continue while at least one player remains (CP-21).
- A disconnected player must return before the run continues; the event
  waits for every player's vote, including theirs (CP-21a, CP-21h).
- During the shop, the others can shop and move buildings, including the
  absent player's, but cannot continue past it (CP-21f).
- Players can leave at any time; the host can save to resume later; only
  the host can fully abandon a run (CP-21d).
- The host carries the save; other players hold none (CP-23c).
- Any number of saved runs, each saved only once (CP-22a, CP-23d).
- Auto-save after each action, storing outcomes so nothing already rolled
  or fought changes, even across an update (CP-23, CP-23a).

Still open: whether a run should ever be transferable to a different host
(proposed: not for now).

## Q4. Details of the loop

Decided (RS-1): each round is PvE battle → event → shop → PvP battle →
event → shop. A shop always follows the event. 5 lives; a PvE loss costs no
life and gives no reward; a PvP loss costs a life. Remaining details:

- Decided: the party picks one of three offered events (RS-4b). The
  starting event types are those in RS-4a, to be refined later.
- **Boss fallback stakes.** Proposed: same as a PvP battle, costs a life on
  defeat (RS-5a).
- **Regaining lives.** Proposed: not possible initially (RS-7c).
- **Ghost-only endgame guard.** See SC-7.

## Q5. Shops

Decided: gold buys buildings and shop re-rolls, nothing else (EC-2).

Finite shared building pool within the party (teammates compete for copies,
encourages splitting archetypes) vs infinite independent pools (simpler)?
Recommended: infinite pools initially; there is no opposing live player to
contest, and teammates competing for copies may feel bad rather than
strategic.

## Q6. Platform and stack

Decided: an offline solo web proof of concept first, then a Godot port, then
multiplayer on Steam with Steam features as the backend (TA-0, TA-1).
Remaining:

- Decided: the proof of concept is written in TypeScript (TA-45).
- **Alternative to a separate web prototype:** build the prototype in Godot
  and use Godot's web export for browser playtests. No port and no throwaway
  code, but slower iteration while the design is still changing, and harder
  for coding agents to build and verify. Current plan keeps the separate web
  prototype; worth a conscious yes/no.
- **Godot language:** typed GDScript *(recommended)* or C# (TA-28).
- **Steamworks spike** (TA-30): confirm leaderboards with attached files work
  as the ghost pool, and learn the limits.
- Decided: full anti-cheat using a server will be completed before final
  release, as a later milestone (TA-24).

## Q8. Ghost selection fairness

Uniform random among eligible snapshots, or weighted toward parties with a
similar lives/record profile? Recommended: uniform first, measure, then
refine (MM-4).

## Q9. Versions

Decided: a run only meets ghosts played on its own version; a major release
deletes old saves and old ghost data (TA-8). Open:

- Decided: old rules and numbers are not kept; loading an older save
  shows a prompt that some things may have changed (CP-23e).
- What counts as major versus minor (proposed definitions in TA-8).
- If Steam does not allow old ghost data to be deleted in bulk, is leaving
  unreadable leaderboard entries behind acceptable (TA-37)?

## Q10. Theme and tone

Fantasy, sci-fi, something odd? Needed before content authoring, not before
systems work.

## Q11. Identity

Decided by the platform choice: Steam identity, no accounts of our own.

## Q12. Abuse considerations for ghosts

- Display names on ghosts are Steam persona names, subject to Steam's own
  filtering settings; optionally anonymize ghost names by default.
- Forged snapshots from modified clients → validation and reporting
  (TA-22, TA-23).
- Deliberately weak "throw" teams seeding the pool → limited by one snapshot
  per host per bucket (MM-1c).
- Parties farming their friends' ghosts → exclusion rule MM-3.
