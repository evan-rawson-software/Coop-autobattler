# 03 — Combat

Status: Draft v0.3

Combat details are deliberately light here. The structural requirements
(determinism, serializable teams, no player input) are firm because ghost PvP
depends on them. The specific combat *style* is an open question (Q2).

## Structural requirements

- **CB-1 [DECIDED]** Combat is fully automated. Players give no input once an
  encounter starts.
- **CB-2 [PROPOSED → effectively required]** Combat is **deterministic**: the
  outcome is a pure function of `(team A, team B, seed, game version)`. No
  wall-clock time, no floating-point nondeterminism, no unordered iteration,
  no platform-dependent behaviour.
- **CB-3 [PROPOSED]** Combat runs in a **headless simulation** that produces
  an **event log**. Clients render playback from the log; they never decide
  outcomes. The same simulation runs on the server (authoritative) and can run
  in tests and balance tools without any rendering.
- **CB-4 [PROPOSED]** A team is fully described by a serializable **team
  state**: an ordered list of **board states**, one per player (CP-6). Each
  board state holds its units, their stats/levels, equipped items, positions,
  and any persistent run modifiers that affect combat. This is exactly what a snapshot
  stores (MM-1). Anything that affects combat must live in team state.
- **CB-5 [PROPOSED]** Combat has a hard duration limit. When reached, an
  escalating sudden-death effect (e.g. growing damage to all units) forces a
  result. Draws are resolved by a deterministic tiebreak (e.g. remaining total
  health percentage, then the defender/ghost wins).
- **CB-6 [PROPOSED]** PvE opponents and ghosts use the **same team state
  format and the same simulation** as player teams. A boss is just a team
  state built by a generator. No special-case combat code paths for PvE beyond
  boss-only abilities defined as normal content.

## Combat style [OPEN — see Q2]

Recommended starting point:

- **CB-7 [PROPOSED]** Each board is a small grid (e.g. 4 columns × 2 rows —
  front row and back row). Each board is a lane on a shared battlefield,
  facing one enemy board (CP-8). Units act on timers (attack speed /
  ability cooldowns) in fixed simulation ticks.
- **CB-8 [PROPOSED]** Targeting is rule-based and predictable (e.g. nearest
  enemy in the same lane, front row first; other lanes only once the unit's
  own lane is clear), so positioning is a real decision.
- **CB-9 [PROPOSED]** Units have a small stat set (health, attack, attack
  speed, armor/resist) plus one ability. Complexity comes from combinations,
  not from individual units.

The Bazaar-style alternative (no units; a row of items with cooldowns hitting
the opposing hero's health pool) is simpler to simulate and render, and is
recorded in Q2.

## Build content

- **CB-10 [PROPOSED]** **Units** have a tier/cost and one or more **traits**.
  Fielding enough units sharing a trait activates bonuses for that board. A minority of traits count across all
  boards (CP-12).
- **CB-11 [PROPOSED]** **Upgrading**: combining duplicates upgrades a unit
  (e.g. 3 copies → next star level). Duplicates can be pooled across players
  via giving (CP-11).
- **CB-12 [PROPOSED]** **Items** are equipped to units and grant stats or
  triggered effects. Items are a primary target for party picks (CP-14).
- **CB-13 [PROPOSED]** **Cross-board content**: some effects reach other
  boards, e.g. "units in adjacent lanes gain…", "when a unit on another board
  dies…". Every such effect must define what it does with one board (usually
  nothing, or a weaker self-only version) so solo never has dead content.
  Later-milestone feature.
- **CB-14 [PROPOSED]** All content (units, items, traits, encounters) is
  **data-driven**: defined in versioned data files, validated against schemas,
  and loadable by the headless simulation.

## Playback

- **CB-15 [PROPOSED]** All party members watch the same playback in sync.
  With up to 4 lanes per side the view must stay readable: show the whole
  battlefield with the viewer's own lane emphasized, and allow focusing any
  lane.
  Speed controls (1×/2×/skip) apply when all players agree, or automatically
  in solo.
- **CB-16 [PROPOSED]** A post-fight summary shows damage dealt/taken/healed
  per unit and per board, to support build discussion.
- **CB-17 [PROPOSED]** Any past encounter can be replayed from
  `(snapshot A, snapshot B, seed, version)`.

## First playable content budget

- **CB-18 [PROPOSED]** Per-battle cost grows with party size (up to 8 boards
  in a 4v4). The simulation must stay fast enough for the balance harness to
  run thousands of 4v4 battles; set a performance budget in M0.
- **CB-19 [PROPOSED]** ~15 units, ~5 traits, ~12 items, 1 boss template.
  Enough to validate the loop; no more.
