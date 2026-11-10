# 05 — Scaling & Economy

Status: Draft v0.1

All numbers here are placeholders for tuning. The *shapes* of the curves are
the specification.

## PvE scaling

- **SC-1 [DECIDED shape / PROPOSED formula]** PvE power grows exponentially
  with round number:

  ```
  budget(r) = B0 * g^(r - 1) * m(type)
  ```

  - `r` — round number
  - `B0` — base budget at round 1
  - `g` — per-round growth factor (starting proposal: 1.12–1.18)
  - `m(type)` — encounter multiplier (minor < elite < boss)

- **SC-2 [PROPOSED]** "Budget" is an abstract power currency spent by the
  encounter generator on unit count, unit tier, stat multipliers, and
  modifiers. A reference conversion from budget to stats must exist so that
  budget can be compared with player team power.
- **SC-3 [PROPOSED]** Player power must grow **sub-exponentially** in the long
  run (roughly polynomial once the team is full and upgraded), so that the
  curves are guaranteed to cross. Any mechanic that could give unbounded
  multiplicative player scaling must be capped or have diminishing returns.
- **SC-4 [PROPOSED]** Tuning targets (to be validated by simulation):
  - A competent party wins nearly all PvE through the first ~3 cycles.
  - PvE becomes a coin flip somewhere around rounds 25–35.
  - Essentially no build survives past a hard horizon (e.g. round ~50).
- **SC-5 [PROPOSED]** Bosses that replace a ghost early in a run (pool
  cold-start) must not be harsher than a typical ghost at that depth (MM-10),
  so early boss fallbacks do not punish players for an empty pool.
- **SC-6 [PROPOSED]** A headless **balance harness** runs many simulated
  fights of reference teams against generated PvE at each round to chart win
  rate by depth. This is the tool that sets `B0` and `g`, and it should exist
  before content volume grows.

## How runs end (interaction of systems)

1. Early/mid run: Showdowns are mostly ghosts; lives are lost to better human
   builds.
2. Deep run: fewer parties have reached this round, so buckets are sparse and
   Showdowns become bosses on the exponential curve (MM-10).
3. Meanwhile minor/elite PvE on the same curve starts beating the party,
   cutting off income and (for elites) lives.
4. Lives reach 0. Depth is recorded.

## Economy

- **EC-1 [PROPOSED]** One primary currency: **gold**, earned per round (base
  income), from winning PvE encounters, and from selling.
- **EC-2 [PROPOSED]** Gold is spent on units, items (if sold in shops), shop
  re-rolls, and team/shop upgrades (e.g. raising shop tier to see stronger
  units).
- **EC-3 [PROPOSED]** Shop offers are per player and drawn from tiered pools
  whose odds improve with shop tier / round. Whether unit pools are finite and
  shared within the party (contested draws) or infinite is **[OPEN]** (Q5).
- **EC-4 [OPEN]** **Party-size economy**: with constant total team capacity
  (CP-5), total party income should be roughly constant too, otherwise bigger
  parties out-scale smaller ones. Options:
  - (a) Fixed party income split evenly between players *(recommended; solo
    gets all of it)*.
  - (b) Per-player income with a party-size discount curve.
  - (c) Full per-player income, and compensate by scaling PvE with party size.
    Ghosts already match on party size, so only PvE needs compensating.
- **EC-5 [PROPOSED]** No interest/banking mechanic in the first playable; add
  only if the economy needs a saving-vs-spending tension.
- **EC-6 [PROPOSED]** Loss compensation: a small consolation payout after a
  lost Showdown to soften snowballing, since the party is already paying in
  lives.

## Rewards

- **EC-7 [PROPOSED]** Minor PvE: gold. Elite PvE: gold plus a party pick
  (CP-11). Showdown win: larger party pick and/or a permanent run modifier.
- **EC-8 [PROPOSED]** Run modifiers that affect combat are part of team state
  (CB-4) and therefore travel with snapshots.
