# 07 — Open Questions

Status: Draft v5.2

This file lists what is still waiting for a decision, and on what. Answered
questions are kept below "Still open", under a "Decided" line, so the
history stays readable; the rule IDs name the spec that now owns each
answer. The decisions of November 2026 come from issue #392.

## Still open

- **Leftover ghost data (TA-37, Q9).** If Steam does not let the developers
  delete old ghost data in bulk, is leaving unreadable leaderboard entries
  behind acceptable? Waits for the Steamworks spike (#366).
- **Ghost-only endgame guard (SC-7, Q4).** No guard for now. Whether one is
  needed is decided from online data. Waits for #368, which adds the
  metric.
- **Ghost selection refinements (MM-4, Q8).** Selection is uniform random.
  Whether to prefer recent snapshots or a similar record is decided from
  online data. Waits for #368.
- **Exact numbers.** The plot size (24 × 16, CB-4) and every [PROPOSED]
  number are tuned from playtests and the balance harness (SC-6). The plot
  size changes only on playtest data about when space runs out. The
  refining numbers are tuned in #386.
- **Points of interest: aggro range and buffs (CB-8c, Q2).** Still open in
  the specs. The owner's decisions are in #369, and #370 records them in
  `03-combat.md`. Points of interest are not built yet.
- **Later refined resources (CB-5d, Q2).** Alloy, Surge, Essence and the
  Ore + Flux compound come after the first version; when, and which
  buildings use them, is not decided.

## Q1. Co-op model — decided (issue #124)

Decided: each player has their own plot and their own Core on one
continuous battlefield (V-13, CP-25). This replaced the one large shared
board (V-9, CP-4, now superseded), which had itself replaced one separate
board per player. Decided with it:

- **Ownership.** Personal gold, shops, and stashes; a player places only
  buildings they own, only in their own plot; only the owner acts on a
  building (CP-10, CP-27, CP-28).
- **No giving** of gold or buildings (CP-29). Border links are the only way
  to help a partner directly (CP-30, CB-9d).
- **Losing a battle** takes all of a side's Cores; a destroyed Core switches
  nothing off (CB-17, CB-17a).
- **Unit targets:** the opposite Core first, then the nearest (CB-15b).
- **Resources:** collectors have a flow rate by tier, buildings have a need
  and a top speed, stores are small, only the Splitter splits (CB-9e,
  CB-10 to CB-10d).
- **Unit attacks** (CB-15c): a unit attacks whatever enemy is in range,
  including enemy Cores that are not its target. Where it walks is
  unchanged.
- **Economy buildings** (CB-24a): they help only their owner; the cap is
  per player.
- **A disconnected player's buildings** (issue #392): nobody can move or
  change them, also once online play exists. There is no exception for
  repairs (CP-21i).

Implementation status: the whole design (PP-1 to PP-18) is in the web proof
of concept; `docs/rules-reference.md`, "Appendix: the per-player design
(issue #124)", "Status of every rule", lists the issue for each part.
Several people playing together over a network comes with the multiplayer
phase (#367); until then one person can build every plot of a multi-plot
board (TA-43).

## Q2. Factory and battlefield rules

Decided (CB-2 to CB-3e): a factory of one plot per player; economy is
in-battle ramp; defense buys time; random resource nodes and natural
features; buildings that produce units which march on the enemy base; each
player's Core fixed for the run, everything else movable by its owner.

Decided:

- Units fight each other when they meet (CB-16); route buildings can be
  destroyed (CB-9a).
- A small neutral zone with its own natural features is generated between
  the boards each battle and hidden until the battle begins (CB-8).
- The neutral zone can hold points of interest that buff whoever controls
  them, guarded by neutral units (CB-8). Units go to a point only if they
  path near enough to aggro (CB-8c). Units capture a point and move on;
  nobody stays behind to hold it. Aggro range and the buffs: see "Still
  open".
- **Map and plot size, board shape** (issue #392): one plot per player,
  side by side, the same size at any party size. The size stays 24 × 16
  and is tuned only from playtest data (CB-4). The exact size: see "Still
  open".
- Buildings can be rotated. Conduits are free and unlimited, take space,
  cannot cross without a route building, and cannot be targeted (CB-3f to
  CB-3h). Gold is not a building resource (CB-3i).
- Units walk over conduits; destroying a building destroys its attached
  conduits up to the next building (CB-9a).
- Conduit networks cannot loop (CB-9c).
- Three resources, named Ore, Power, and Flux for now, renameable in one
  configuration file (CB-5a, TA-27a). A conduit carries one resource type;
  some rarer buildings need more than one type (CB-5a, CB-5b).
- **Refining** (issues #378, #379): refined resources exist and the rarer,
  stronger buildings need them (CB-5d). Refining is one step deep. The
  first version has two compounds: Composite (Ore + Power), which feeds the
  Golem forge, and Aether (Power + Flux), which feeds the Spire. Shops
  offer them from round 3. The later refined resources: see "Still open".
- PvE enemies are scripted waves plus a stronghold (CB-29).
- The board never expands; it starts fairly large and its size is an
  endgame constraint (CB-25).
- No long-range buildings; defenses target enemy units on the party's own
  side and in the neutral zone, never on the enemy's board (CB-3j, CB-18a).
- Resources are the main limiter, space the second (CB-24). The Overclocker
  stays with a much lower cap, set in the rebalance (SC-12).
- Every PvE opponent has one Core per player, its health split evenly;
  waves head for the Core of the plot they enter (CB-29).
- Ties and the time limit are judged by Cores standing, then share of total
  Core health, then overkill, building damage, kills, attacker (CB-33).

## Q3. Screens

Decided: top/bottom orientation with the party at the bottom (CB-45).
Wireframes of the screens of a run are in `docs/wireframes/`.

- Nothing is timed; every player readies up to move on (CP-17).
- **Players do not see each other's shops** (issue #392). This is final; it
  is not revisited after playtests (CP-19). It was "for now" before.
- The camera starts at the center of the map (CB-47a).

## Q3a. Saving and disconnects

Decided:

- Battles continue while at least one player remains (CP-21).
- A disconnected player must return before the run continues; the event
  waits for every player's vote, including theirs (CP-21a, CP-21h).
- During the shop, the others can shop and build in their own plots, but
  cannot continue past it, and nobody can move the absent player's
  buildings (CP-21i, which replaces CP-21f).
- Players can leave at any time; the host can save to resume later; only
  the host can fully abandon a run (CP-21d).
- The host carries the save; other players hold none (CP-23c).
- Any number of saved runs, each saved only once (CP-22a, CP-23d).
- Auto-save after each action, storing outcomes so nothing already rolled
  or fought changes, even across an update (CP-23, CP-23a).
- **Transferring a run to another host** (issue #392): not for now. A run
  stays with its host (CP-23b, CP-23c).

## Q4. Details of the loop

Decided (RS-1): each round is PvE battle → event → shop → PvP battle →
event → shop. A shop always follows the event. 5 lives; a PvE loss costs no
life and gives no reward; a PvP loss costs a life.

- The party picks one of up to three offered events, never two of the same
  type (RS-4b). The event types are in RS-4a, their numbers in RS-4i.
- **Boss fallback stakes** (issue #392): losing to the boss costs 1 life,
  the same as losing to a ghost (RS-5a). This holds for every boss; the
  boss roster and its rules are MM-9a–MM-9e.
- **Regaining lives** (issue #392): never, for now (RS-7c).
- **Ghost-only endgame guard** (issue #392): no guard for now (SC-7). Still
  open: see "Still open".

## Q5. Shops

Decided: gold buys buildings, shop re-rolls and a Workshop tier raise,
nothing else (EC-2).

- **Shop pools** (issue #392): unlimited, per player; teammates never
  compete for copies (EC-3). The other option was a finite building pool
  shared by the party, where teammates compete for copies.

## Q6. Platform and stack

Decided: an offline solo web proof of concept first, then a Godot port, then
multiplayer on Steam with Steam features as the backend (TA-0, TA-1).

- The proof of concept is written in TypeScript (TA-45).
- **Separate web prototype or Godot web export** (issue #392): closed. The
  web proof of concept was built and served its purpose.
- **Godot language:** typed GDScript (TA-28, issue #365).
- Full anti-cheat using a server will be completed before final release,
  as a later milestone (TA-24).
- Planned, not a question: the Steamworks spike (TA-30, #366) confirms
  that leaderboards with attached files work as the ghost pool, and learns
  the limits. Its result answers TA-37.

## Q8. Ghost selection fairness

Decided (issue #392): uniform random among eligible snapshots (MM-4). Any
weighting, toward recent snapshots or a similar record, is decided from
online data: see "Still open".

## Q9. Versions

Decided: a run only meets ghosts played on its own version; a major release
deletes old saves and old ghost data (TA-8).

- Old rules and numbers are not kept; loading an older save shows a prompt
  that some things may have changed (CP-23e).
- **Major versus minor** (issue #392): the patch / minor / major
  definitions in TA-8 are accepted as written. Minor versus major is judged
  at release against them as a written checklist (TA-34).
- Leftover ghost data if Steam cannot delete it in bulk (TA-37): see
  "Still open".

## Q10. Theme and tone

Decided (issue #392): **arcane industry, light and charming** —
magic-powered factories, bright colours, playful names and descriptions,
cute but readable units. The names are chosen in the theme issue (#393).
Recorded in `00-vision.md`, "Theme". The question was: fantasy, sci-fi, or
something odd?

## Q11. Identity

Decided by the platform choice: Steam identity, no accounts of our own.

## Q12. Abuse considerations for ghosts

- **Ghost names** (issue #392): Steam persona names are shown by default,
  subject to Steam's own filtering settings; a player can opt out and
  appear anonymously (MM-1b).
- Forged snapshots from modified clients → validation and reporting
  (TA-22, TA-23).
- Deliberately weak "throw" teams seeding the pool → limited by one snapshot
  per host per bucket (MM-1c).
- Parties farming their friends' ghosts → exclusion rule MM-3.
