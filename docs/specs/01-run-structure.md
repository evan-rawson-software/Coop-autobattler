# 01 — Run Structure

Status: Draft v0.1

## Core loop

```
Lobby -> [ Build phase -> Encounter -> Resolution ] x N -> Defeat -> Run summary
```

A run is an unbounded sequence of **rounds**. Each round has one build phase
and one encounter. The run ends only when the party runs out of lives.

## Round cadence

- **RS-1 [PROPOSED]** Rounds are grouped into **cycles** of fixed length
  (starting proposal: 4 rounds). Each cycle is:
  1. PvE encounter (minor)
  2. PvE encounter (minor, or a non-combat event — see RS-6)
  3. PvE encounter (elite)
  4. **Showdown**: a ghost PvP encounter, or a generated boss if no ghost
     matches (see `04-encounters-matchmaking.md`).
- **RS-2 [PROPOSED]** The round number is the single "progress" value used for
  both PvE scaling and ghost matching. Every party at round *r* has seen
  exactly the same number of build phases.
- **RS-3 [PROPOSED]** PvE rounds are the main source of income and offer a
  choice between 2–3 encounters with different risk/reward, voted on by the
  party. Showdowns are the main threat to lives.

## Phases within a round

1. **Build phase** (timed; see `02-coop-party.md` for co-op rules)
   - Shop refresh, buying/selling, combining, equipping, positioning.
   - Ends when all players ready up or the timer expires.
2. **Encounter**
   - Opponent is selected and locked in.
   - The party's team is snapshotted (see MM-1).
   - Combat is simulated and played back to all players simultaneously.
3. **Resolution**
   - Rewards granted, lives adjusted, round counter incremented.

## Lives and run end

- **RS-4 [PROPOSED]** The party shares one pool of **lives** (starting
  proposal: 5, independent of party size). Shared lives reinforce pillar 1.
- **RS-5 [PROPOSED]** Losing a Showdown costs lives; losing a minor PvE
  encounter costs no life but forfeits its reward; losing an elite costs
  1 life. Loss cost in Showdowns may grow with depth to tighten the endgame.
- **RS-5a [DECIDED]** There is no victory condition. PvE scaling guarantees
  eventual defeat (V-5). The run ends when lives reach 0.
- **RS-5b [PROPOSED]** A party may also abandon a run at any time; it is
  recorded at its current depth.

## Non-combat events

- **RS-6 [PROPOSED]** Some PvE slots may be replaced by events (merchant,
  shrine, gamble, unit trainer). Events are a later-milestone feature; the
  first playable only needs combat rounds.

## Score and run summary

- **RS-7 [PROPOSED]** Primary score: **depth** (highest round reached).
  Secondary: Showdown win count and win rate against ghosts.
- **RS-8 [PROPOSED]** The run summary shows depth, the final team, a per-round
  history, and which ghosts were fought (party display names only).

## Meta-progression

- **RS-9 [PROPOSED]** Meta-progression unlocks **options, not power**: new
  units, items, starting loadouts, and cosmetic records. Power unlocks would
  break ghost fairness, since a snapshot would encode account-level advantages.
- **RS-10 [OPEN]** Whether there are selectable heroes/classes per player at
  run start. See `07-open-questions.md` Q3.

## Session length targets

- **RS-11 [PROPOSED]** Build phase: 45–90 s. Encounter playback: 20–45 s
  (with a hard combat time limit and a fast-forward option when all players
  agree). Median run: 30–45 minutes.
