# 05 — Scaling & Economy

Status: Draft v1.0

All numbers here are placeholders for tuning. The *shapes* of the curves are
the specification.

## PvE scaling

- **SC-1 [DECIDED shape / PROPOSED formula]** PvE power grows exponentially
  with cycle number:

  ```
  budget(c) = B0 * g^(c - 1) * m(type)
  ```

  - `c` — cycle number
  - `B0` — base budget at cycle 1
  - `g` — per-cycle growth factor (starting proposal: 1.3–1.5)
  - `m(type)` — encounter multiplier (easy < medium < hard; boss tuned
    separately, see SC-5)

  The budget is **per plot**: it is multiplied by party size (CP-7), so PvE
  threat scales linearly with the size of the party's board.

- **SC-2 [PROPOSED]** "Budget" is an abstract power currency spent by the
  encounter generator on a threat's health, defenses, attack strength over time, and
  modifiers. A reference conversion from budget to stats must exist so that
  budget can be compared with player team power.
- **SC-3 [PROPOSED]** Player power must grow **sub-exponentially** in the long
  run (roughly polynomial once the team is full and upgraded), so that the
  curves are guaranteed to cross. Any mechanic that could give unbounded
  multiplicative player scaling must be capped or have diminishing returns.
- **SC-4 [PROPOSED]** Tuning targets (to be validated by simulation):
  - Early cycles: a competent party can beat hard; easy is close to free.
  - The difficulty a strong party can reliably beat steps down over the run:
    hard becomes a gamble around cycles 6–8, medium a few cycles later.
  - Even easy is unwinnable, and bosses unbeatable, past a hard horizon
    (e.g. cycle ~18–20).
- **SC-5 [PROPOSED]** Bosses that replace a ghost early in a run (pool
  cold-start) must not be harsher than a typical ghost at that depth (MM-10),
  so early boss fallbacks do not punish players for an empty pool.
- **SC-6 [PROPOSED]** A headless **balance harness** runs many simulated
  fights of reference teams against generated PvE at each cycle and difficulty to chart win
  rate by depth. This is the tool that sets `B0` and `g`, and it should exist
  before content volume grows.

## How runs end (interaction of systems)

Lives are only lost in PvP battles (RS-5), and PvE losses are free apart from
the missed reward (RS-3a). The exponential curve still ends every run:

1. Early/mid run: PvP battles are mostly ghosts; lives are lost to better
   human builds.
2. PvE outgrows the party: first hard, then medium, then easy become
   unwinnable. Rewards dry up and the party's power plateaus.
3. Deep run: fewer parties have reached this cycle, so buckets are sparse and
   PvP battles become bosses on the exponential curve (MM-10). A plateaued
   party loses a life per cycle.
4. Lives reach 0. Depth is recorded.

- **SC-7 [PROPOSED]** Guard against a stable ghost-only endgame: if deep
  buckets ever stay well populated, parties with stalled income would mostly
  meet other stalled parties and runs could drag on. Options if this shows up
  in data: force a boss every Nth cycle, or serve a boss whenever the
  party's cycle exceeds a threshold. Not needed for the first playable.

## In-battle ramp

"Economy" has two unrelated meanings in this game; this section is about the
first. Gold (next section) is never produced by the factory.

- **SC-8 [PROPOSED]** In-battle ramp (CB-3a) must not let the party outgrow
  PvE indefinitely. Limits, in order of importance: board space and steep
  expansion costs (CB-18, CB-19); caps or diminishing returns on each
  economy item's in-battle effect; PvE threats whose early pressure grows
  with depth, leaving less time to ramp. The balance harness must chart
  party power **over battle time** as well as over cycles.
- **SC-9 [PROPOSED]** The three strategies (CB-13) should each have PvE
  archetypes they are good and bad against, so no single routing is correct
  for a whole run.
- **SC-10 [PROPOSED]** Economy items should be clearly worse than attack or
  defense items of the same price in a short battle and clearly better in a
  long one, with the crossover point moving earlier as the run deepens.

## Economy (gold)

- **EC-1 [PROPOSED]** One primary currency: **gold**, earned per cycle (base
  income), from winning PvE encounters, and from selling.
- **EC-2 [PROPOSED]** Gold is spent on items, shop
  re-rolls, and team/shop upgrades (e.g. raising shop tier to see stronger
  items), and board expansion.
- **EC-3 [PROPOSED]** Shop offers are per player and drawn from tiered pools
  whose odds improve with shop tier / cycle. Whether item pools are finite and
  shared within the party (contested draws) or infinite is **[OPEN]** (Q5).
- **EC-4 [PROPOSED]** **Party-size economy**: every player earns full income
  at every party size. PvE threats scale by the same
  factor, so no discount curve is needed. Battle
  rewards are paid per player; party picks (CP-14) are per party.
- **EC-4a [PROPOSED]** Giving (CP-11) lets a party pool gold for one
  player's purchase. With a shared board this is normal play, not a problem.
- **EC-5 [PROPOSED]** No interest/banking mechanic in the first playable; add
  only if the economy needs a saving-vs-spending tension.
- **EC-6 [PROPOSED]** Loss compensation: a small consolation payout after a
  lost PvP battle to soften snowballing, since the party is already paying in
  lives.

## Rewards

- **EC-7 [PROPOSED]** PvE win rewards by difficulty — easy: gold; medium:
  more gold plus a party pick (CP-14); hard: more gold plus a better party
  pick. PvE loss: nothing (RS-3a). PvP win: a party pick and/or a permanent
  run modifier.
- **EC-9 [PROPOSED]** Base income per cycle is deliberately small relative to
  PvE rewards, so that PvE results are what drive a party's growth.
- **EC-8 [PROPOSED]** Run modifiers that affect combat are part of team state
  (CB-32) and therefore travel with snapshots.
