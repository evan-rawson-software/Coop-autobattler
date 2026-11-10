# 03 — Combat

Status: Draft v0.1

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
  state**: units, their stats/levels, equipped items, positions, and any
  persistent run modifiers that affect combat. This is exactly what a snapshot
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

Recommended starting point, chosen for readability with a shared team and for
positioning depth:

- **CB-7 [PROPOSED]** Units fight on a small grid (e.g. each side 4 columns ×
  2 rows — front row and back row). Units act on timers (attack speed /
  ability cooldowns) in fixed simulation ticks.
- **CB-8 [PROPOSED]** Targeting is rule-based and predictable (e.g. nearest
  enemy in front row first), so positioning is a real decision.
- **CB-9 [PROPOSED]** Units have a small stat set (health, attack, attack
  speed, armor/resist) plus one ability. Complexity comes from combinations,
  not from individual units.

The Bazaar-style alternative (no units; a row of items with cooldowns hitting
the opposing hero's health pool) is simpler to simulate and render, and is
recorded in Q2.

## Build content

- **CB-10 [PROPOSED]** **Units** have a tier/cost and one or more **traits**.
  Fielding enough units sharing a trait activates team-wide bonuses, counted
  across all players' units (CP-7).
- **CB-11 [PROPOSED]** **Upgrading**: combining duplicates upgrades a unit
  (e.g. 3 copies → next star level). Duplicates can be pooled across players
  via giving (CP-8).
- **CB-12 [PROPOSED]** **Items** are equipped to units and grant stats or
  triggered effects. Items are a primary target for party picks (CP-11).
- **CB-13 [PROPOSED]** **Co-op-specific content**: some effects explicitly
  reference ownership, e.g. "adjacent units owned by *other* players gain…",
  "when a teammate's unit dies…". In solo, these treat alternating slots as
  different owners or have defined solo fallbacks. Later-milestone feature.
- **CB-14 [PROPOSED]** All content (units, items, traits, encounters) is
  **data-driven**: defined in versioned data files, validated against schemas,
  and loadable by the headless simulation.

## Playback

- **CB-15 [PROPOSED]** All party members watch the same playback in sync.
  Speed controls (1×/2×/skip) apply when all players agree, or automatically
  in solo.
- **CB-16 [PROPOSED]** A post-fight summary shows damage dealt/taken/healed
  per unit and per owner, to support build discussion.
- **CB-17 [PROPOSED]** Any past encounter can be replayed from
  `(snapshot A, snapshot B, seed, version)`.

## First playable content budget

- **CB-18 [PROPOSED]** ~15 units, ~5 traits, ~12 items, 1 boss template.
  Enough to validate the loop; no more.
