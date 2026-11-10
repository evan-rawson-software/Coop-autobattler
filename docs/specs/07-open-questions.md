# 07 — Open Questions

Status: Draft v1.0

Each question lists options and a recommendation. Answering Q2 unblocks backlog work on the simulation.

## Q1. Co-op model — decided

One large shared factory board for the whole party (CP-4, V-9). This replaced
one-board-per-player and removed the question of how separate boards fight
together. Remaining details:

- **Ownership.** Proposed: personal gold, shops, and stashes; shared space;
  anyone can move any item, only the owner can sell (CP-10 to CP-13).
  Alternative: everything pooled.
- **Plot size and board shape** at 2, 3, and 4 players (CP-5).

## Q2. Factory rules

Decided: shared factory; charge flows along routes; economy means in-battle
ramp; defense buys time (CB-3 to CB-3c). The Pulse and Gearworks were
rejected earlier. Open:

- **Walls and attacks (CB-17).** Abstract barrier in front of the Core
  *(default for the proof of concept)*, or a physical space between the two
  factories that attacks cross and walls obstruct, closer to tower defense?
- **Direction.** Fixed arrows, rotatable items *(recommended)*, or pass to
  any adjacent item?
- **Loops.** Can routes feed back into themselves, and what bounds them?
- **Resources.** Charge only *(recommended to start)*, or several resources
  with recipes?
- **Interaction.** Can a side disrupt the enemy factory, or only attack its
  walls and Core?
- **Large items.** How a 2×2 item takes charge from several sides.
- **PvE as scripted threats** rather than factories (CB-26): confirm.

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

## Q5. Shop pools

Finite shared item pool within the party (teammates compete for copies,
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
