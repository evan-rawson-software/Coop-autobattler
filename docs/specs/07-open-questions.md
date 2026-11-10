# 07 — Open Questions

Status: Draft v0.1

Each question lists options and a recommendation. Answering Q1, Q2, and Q6
unblocks most backlog work.

## Q1. Co-op ownership model (highest impact)

How do multiple players share a team?

- **(a) One shared team, constant capacity split between players**
  *(recommended; specced in `02-coop-party.md`)*. One readable fight; real
  interdependence; party sizes stay balanced.
- **(b) Each player has a full board; boards fight side by side** against a
  proportionally larger enemy. More personal agency, much heavier fights,
  party sizes become different games.
- **(c) One shared team, fully communal** — shared gold, shared shop, anyone
  does anything. Simplest rules, but prone to one player "quarterbacking".
- **(d) Role-based** — players have asymmetric jobs (e.g. one drafts units,
  one manages items). Novel, but awkward at 1 and 3 players.

## Q2. Combat style

- **(a) Units on a small grid with positioning** *(recommended; specced in
  `03-combat.md`)*. Classic autobattler; ownership of units maps cleanly onto
  players.
- **(b) Bazaar-style item boards** — no units; each side has a row of items
  on cooldowns attacking a shared health pool. Cheaper to build and render;
  co-op would be "each player owns a segment of the item row".
- **(c) Hero + items hybrid** — each player is one hero unit on the board
  that they gear up. Strongest player identity; solo would need to field
  multiple heroes or AI companions.

## Q3. Player identity

Do players pick a hero/class at run start that shapes their shop or grants a
passive? Recommended: yes, but after the first playable. It gives each party
member a distinct role and adds run variety. Must be encoded in team state if
it affects combat.

## Q4. Showdown cadence and loss cost

- How many PvE rounds between Showdowns (proposal: 3)?
- Starting lives (proposal: 5) and whether Showdown loss cost grows with
  depth.
- Should every round snapshot (larger pool, finer matching) or only
  Showdowns (proposal)?

## Q5. Shop pools

Finite shared unit pool within the party (teammates compete for copies,
encourages splitting archetypes) vs infinite independent pools (simpler)?
Recommended: infinite pools initially; there is no opposing live player to
contest, and teammates competing for copies may feel bad rather than
strategic.

## Q6. Platform and stack

Web/TypeScript *(recommended; `06-technical-architecture.md`)* vs a game
engine. Depends on target platforms (browser, Steam, mobile) and on the art
ambition.

## Q7. Party-size economy

See EC-4. Recommended: fixed party income split evenly.

## Q8. Ghost selection fairness

Uniform random among eligible snapshots, or weighted toward parties with a
similar lives/record profile? Recommended: uniform first, measure, then
refine (MM-4).

## Q9. What happens to runs on a version bump?

Close out at current depth *(recommended, simplest)* vs let them continue
against bosses only (TA-9).

## Q10. Theme and tone

Fantasy, sci-fi, something odd? Needed before content authoring, not before
systems work.

## Q11. Accounts and identity

Guest play with an optional account, or account required? Affects snapshot
attribution, resumable runs, and leaderboards. Recommended: guest identity
(device token) from day one, upgradeable to an account later.

## Q12. Abuse considerations for ghosts

- Offensive display names appearing on ghosts → name filtering or
  anonymized ghost names by default.
- Deliberately weak "throw" teams seeding the pool → mitigated by
  record-aware selection (MM-4) and serving caps.
- Parties farming their friends' ghosts → exclusion rule MM-3.
