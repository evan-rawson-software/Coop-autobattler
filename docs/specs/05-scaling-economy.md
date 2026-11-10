# 05 — Scaling & Economy

Status: Draft v4.4

All numbers here are placeholders for tuning. The *shapes* of the curves are
the specification.

## PvE scaling

- **SC-1 [DECIDED shape / PROPOSED formula]** PvE power grows exponentially
  with round number:

  ```
  budget(c) = B0 * g^(c - 1) * m(type)
  ```

  - `c` — round number
  - `B0` — base budget at round 1
  - `g` — per-round growth factor (starting proposal: 1.3–1.5)
  - `m(type)` — encounter multiplier (easy < medium < hard; boss tuned
    separately, see SC-5)

  The budget is **per plot**: it is multiplied by party size (CP-7), so PvE
  threat scales linearly with the size of the party's board.

- **SC-2 [PROPOSED]** "Budget" is an abstract power currency spent by the
  encounter generator on a threat's wave size and composition over time, its stronghold's
  health and defenses, and
  modifiers. A reference conversion from budget to stats must exist so that
  budget can be compared with player team power.
- **SC-3 [PROPOSED]** Player power must grow **sub-exponentially** in the long
  run (roughly polynomial once the team is full and upgraded), so that the
  curves are guaranteed to cross. Any mechanic that could give unbounded
  multiplicative player scaling must be capped or have diminishing returns.
- **SC-4 [PROPOSED]** Tuning targets (to be validated by simulation):
  - Early rounds: a competent party can beat hard; easy is close to free.
  - The difficulty a strong party can reliably beat steps down over the run:
    hard becomes a gamble around rounds 6–8, medium a few rounds later.
  - Even easy is unwinnable, and bosses unbeatable, past a hard horizon
    (e.g. round ~18–20).
- **SC-5 [PROPOSED]** Bosses that replace a ghost early in a run (pool
  cold-start) must not be harsher than a typical ghost at that depth (MM-10),
  so early boss fallbacks do not punish players for an empty pool.
- **SC-6 [PROPOSED]** A headless **balance harness** runs many simulated
  fights of reference teams against generated PvE at each round and difficulty to chart win
  rate by depth. This is the tool that sets `B0` and `g`, and it should exist
  before content volume grows.

## How runs end (interaction of systems)

Lives are only lost in PvP battles (RS-5), and PvE losses are free apart from
the missed reward (RS-3a). The exponential curve still ends every run:

1. Early/mid run: PvP battles are mostly ghosts; lives are lost to better
   human builds.
2. PvE outgrows the party: first hard, then medium, then easy become
   unwinnable. Rewards dry up and the party's power plateaus.
3. Deep run: fewer parties have reached this round, so buckets are sparse and
   PvP battles become bosses on the exponential curve (MM-10). A plateaued
   party loses a life per round.
4. Lives reach 0. Depth is recorded.

- **SC-7 [PROPOSED]** Guard against a stable ghost-only endgame: if deep
  buckets ever stay well populated, parties with stalled income would mostly
  meet other stalled parties and runs could drag on. Options if this shows up
  in data: force a boss every Nth round, or serve a boss whenever the
  party's round exceeds a threshold. Not needed for the first playable.

## In-battle ramp

"Economy" has two unrelated meanings in this game; this section is about the
first. Gold (next section) is never produced by the factory.

- **SC-8 [PROPOSED]** In-battle ramp (CB-3) must not let the party outgrow
  PvE indefinitely. Limits, in order of importance: a fixed board size that
  the factory eventually fills (CB-24, CB-25); caps or diminishing returns on each
  economy building's in-battle effect; PvE threats whose early pressure grows
  with depth, leaving less time to ramp. The balance harness must chart
  party power **over battle time** as well as over rounds.
- **SC-9 [PROPOSED]** The three strategies (CB-21) should each have PvE
  archetypes they are good and bad against, so no single routing is correct
  for a whole run.
- **SC-11 [PROPOSED]** **Terrain fairness.** Map generation is constrained
  so that every map has a comparable number of resource nodes per plot,
  comparable buildable area, and at least one defensible approach, while
  still differing enough to matter. The balance harness should measure how
  much win rate varies by map seed.
- **SC-10 [PROPOSED]** Economy buildings should be clearly worse than attack or
  defense buildings of the same price in a short battle and clearly better in a
  long one, with the crossover point moving earlier as the run deepens.

## Economy (gold)

- **EC-0 [DECIDED]** Gold is spent **only at shops between battles**, to
  purchase buildings. It is never a resource for placing buildings or for
  anything during a battle. Only purchased buildings can be placed;
  conduits are free and unlimited (CB-3g, CB-3i).
- **EC-1 [PROPOSED]** One currency: **gold**, earned per round (base
  income), from winning PvE battles, and from selling buildings back.
- **EC-2 [DECIDED]** Gold buys two things: **buildings** and **shop
  re-rolls**. It does not buy board expansion (there is none, CB-25).
- **EC-3 [PROPOSED]** Shop offers are per player and drawn from tiered pools
  whose odds of higher-tier buildings improve with the round number (CB-26a). Whether building pools are finite and
  shared within the party (contested draws) or infinite is **[OPEN]** (Q5).
- **EC-4 [PROPOSED]** **Party-size economy**: every player earns full income
  at every party size. PvE threats scale by the same
  factor, so no discount curve is needed. Battle
  rewards are paid per player.
- **EC-4a [PROPOSED]** Giving (CP-11) lets a party pool gold for one
  player's purchase. With a shared board this is normal play, not a problem.
- **EC-5 [PROPOSED]** No interest/banking mechanic in the first playable; add
  only if the economy needs a saving-vs-spending tension.
- **EC-6 [DECIDED]** A party that loses a PvP battle receives a small
  consolation payout of gold. The amount is configuration.

## Rewards

- **EC-7 [DECIDED/PROPOSED detail]** **Battle rewards are gold only**;
  buildings are acquired in the shop (RS-6). Proposed detail: a PvE win pays
  gold by difficulty (easy < medium < hard); a PvE loss pays nothing
  (RS-3a); a PvP win pays gold. Amounts are configuration.
- **EC-9 [PROPOSED]** Base income per round is deliberately small relative to
  PvE rewards, so that PvE results are what drive a party's growth.
- **EC-8 [PROPOSED]** Run modifiers that affect combat are part of team state
  (CB-32) and therefore travel with snapshots.
