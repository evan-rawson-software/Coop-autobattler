# 07 — Open Questions

Status: Draft v1.6

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
- **How the two boards meet.** Proposed: joined front edge to front edge
  (CB-8). Alternative: a neutral strip of ground between them.
- **Map and plot size**, and board shape at 2–4 players (CB-4).
- Decided: buildings can be rotated. Conduits are free and unlimited, take
  space, cannot cross without a route building, and cannot be targeted
  (CB-3f to CB-3h). Gold is only for buying buildings at shops (CB-3i).
- Decided: units walk over conduits; destroying a building destroys its
  attached conduits up to the next building (CB-9a).
- **Loops.** May a conduit network feed back into itself?
- **Resources.** Charge only *(recommended to start)*, or several node types
  with recipes?
- **PvE as waves plus a stronghold** rather than a factory (CB-29): confirm.
- **Does expansion reveal new land** (CB-25), or is the whole map visible
  and buildable from the start?
- Decided: no long-range buildings; defenses only target enemy units on
  the party's own side (CB-3j).

## Q3. Player identity

Do players pick a hero/class at run start that shapes their shop or grants a
passive? Recommended: yes, but after the first playable. It gives each party
member a distinct role and adds run variety. Must be encoded in team state if
it affects combat.

## Q4. Details of the loop

The loop itself is decided (RS-1: PvE battle → event → PvP battle; 5 lives;
PvE loss costs no life and gives no reward; PvP loss costs a life). Remaining
details:

- **Event selection.** Is the event each cycle random, fixed, or chosen by
  the party from 2–3 options? Is a shop always available? Recommended: party
  chooses from 2–3 options and a shop is always one of them (RS-4b).
- **PvP battles per cycle.** One *(proposed, RS-5b)*, or several in a row
  against different ghosts?
- **Arranging the team outside events.** Proposed: a short prep phase before
  every battle (RS-6). Alternative: the team can only be changed during the
  event step.
- **Boss fallback stakes.** Proposed: same as a PvP battle, costs a life on
  defeat (RS-5a).
- **Regaining lives.** Proposed: not possible initially (RS-7c).
- **Ghost-only endgame guard.** See SC-7.

## Q5. Shops

May gold also buy shop services — re-rolls, a better shop tier, board
expansion — or strictly buildings only (EC-2)?


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
- **Trust:** is the accepted-risk position on forged ghosts and scores
  (TA-21) acceptable for launch?

## Q7. Session length

Factory building and ramping battles may not fit the earlier targets (short
phases, 30–45 minute runs; RS-12). Decide after the first playtests whether
to lengthen the targets or constrain the building.

## Q8. Ghost selection fairness

Uniform random among eligible snapshots, or weighted toward parties with a
similar lives/record profile? Recommended: uniform first, measure, then
refine (MM-4).

## Q9. What happens to runs on a version bump?

Close out at current depth *(recommended, simplest; TA-9)* vs let them
continue against bosses only.

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
