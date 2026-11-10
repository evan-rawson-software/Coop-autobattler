# 07 — Open Questions

Status: Draft v0.9

Each question lists options and a recommendation. The biggest open decision is **Q0**; it changes Q1 and Q2.

## Q0. Shared factory board?

Should the party build one large shared factory board instead of one board
per player? See `08-shared-factory-concept.md` for the concept, its risks,
and the four decisions it needs. If adopted, Q1 disappears and Q2 is settled
as Conduits-plus-economy.

## Q1. How do a party's boards fight together? (highest impact)

Decided: each player has their own full board (CP-4). Open: what happens in a
battle with N boards per side.

- **(a) Lanes on one battlefield with crossing** *(recommended; specced in
  `02-coop-party.md` CP-8)*. Each board faces one enemy board; survivors of a
  cleared lane reinforce neighbours; last side standing wins. One shared
  outcome, strong players can carry, lane order matters.
- **(b) Parallel duels, majority wins.** N independent 1v1 battles; the party
  wins if it wins more duels (ties need a rule at 2 and 4 players). Simplest
  to build and watch, but boards never interact in combat.
- **(c) Parallel duels, pooled health.** N independent 1v1 battles, but damage
  dealt goes to a shared party health pool. Still simple; a blowout in one
  lane can offset a loss in another.
- **(d) One merged battlefield.** All boards are placed on a single large
  grid with no lanes. Maximum interaction, hardest to read and balance.

Related: how much cross-board content there should be (CP-12), and whether a
teammate may manage a disconnected player's board (CP-21).

## Q2. Core combat mechanic

Decided: item-based combat in the family of *The Bazaar* / *Backpack Battles*,
but distinct (CB-2, CB-3). The Pulse and Gearworks are rejected (CB-3a).

- **Conduits** is the leading candidate (`03-combat.md`): generators make
  charge, charge flows along routes between items, outputs fire when it
  arrives. Awaiting the project owner's reaction to the wireframe.
- If Conduits is not adopted, more candidates are needed.

Sub-questions if Conduits goes ahead: how direction works (fixed arrows,
rotation, or any-neighbour); whether loops are allowed; whether the enemy
circuit can be disrupted or only the Core attacked; how large items take
charge; board dimensions and growth; whether a dark board can be revived.

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

## Q7. Gold funnelling

With full per-player income and free giving, a party can pour everything into
one board. Is that a fun strategy or a degenerate one? Recommended: allow it,
measure, then cap or tax if needed (EC-4a).

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
