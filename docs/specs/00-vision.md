# 00 — Vision & Pillars

Status: Draft v0.9

## Elevator pitch

A co-op roguelite autobattler for 1–4 players. Between fights, the party
each player
drafts items and arranges them to build their own board; the party's boards fight
together. Fights
resolve automatically. Opponents alternate between hand-authored-style PvE
encounters and **ghost PvP** — saved snapshots of other real parties at the
same point in their run. PvE power grows exponentially, so no run lasts
forever; the score is how deep you went.

## Requirements from the project owner

- **V-1 [DECIDED]** Supports 1–4 players in a party.
- **V-2 [DECIDED]** Runs combine PvE encounters and PvP encounters.
- **V-3 [DECIDED]** PvP is asynchronous: the opponent is a saved state of
  another party at the same point in the game, with the same party size, on
  the same game version.
- **V-4 [DECIDED]** If no saved state matches, a PvE boss is generated instead,
  based on how far the party has progressed.
- **V-5 [DECIDED]** PvE enemies scale exponentially so that every run is
  eventually forced to end in defeat.
- **V-6 [DECIDED]** Combat-encounter structure is in the spirit of *The
  Bazaar*.
- **V-7 [DECIDED]** A run is a repeating loop of: (1) a PvE battle at a chosen
  difficulty — easy, medium, or hard; (2) an event, such as a shop; (3) a PvP
  battle.
- **V-8 [DECIDED]** The party has 5 lives. Losing a PvP battle costs a life.
  Losing a PvE battle costs no life but grants no reward.
- **V-9 [DECIDED]** Each player has their own full board, so the game scales
  from 1 to 4 players by adding boards.
- **V-10 [DECIDED]** Combat is item-based in the style of *The Bazaar* and
  *Backpack Battles*, but with its own distinct core mechanic.
- **V-11 [DECIDED]** Built in Godot, for release on Steam, using Steam
  features for backend needs (lobbies, multiplayer, async PvP) wherever
  possible.
- **V-12 [DECIDED]** Development starts with a simple offline web proof of
  concept for playtesting; multiplayer is built after the port to Godot.

## Design pillars

1. **Together, not just alongside.** Co-op must create real interdependence:
   builds that combine across players, shared stakes, and decisions worth
   talking about. A 4-player run should not feel like four solo runs in a
   trench coat.
2. **Every run ends; depth is the score.** There is no "win screen". The
   exponential wall is the antagonist, and beating your previous depth is the
   hook.
3. **Fights are fair because they are identical.** Combat is fully
   deterministic from its inputs. The same two teams and seed always produce
   the same result. This is what makes ghost PvP, replays, and testing
   possible.
4. **Decisions in the shop, spectacle in the fight.** Players have zero input
   during combat. All skill expression is in drafting, economy, and how items
   are arranged on the board.
5. **Short sessions, legible cycles.** A cycle is a few minutes; a run fits in
   an evening; a party can drop a run and it does not hurt anyone else,
   because all PvP is asynchronous.

## Target experience

- **Solo:** a complete game on its own, comparable to a single-player
  autobattler run.
- **2–4 players:** friends on voice chat arguing about who gets the item,
  pooling gold for a key purchase, and cheering or groaning at the same fight.

## Non-goals (for now)

- Live, synchronous PvP between two human parties.
- Offline play. The game requires Steam.
- A custom backend. Steam provides lobbies, networking, and ghost storage
  (`06-technical-architecture.md`).
- Ranked ladders, seasons, monetization, cosmetics.
- Mid-run drop-in of new players (party size is fixed for a run; see
  `02-coop-party.md`).
- Trading or interaction between different parties.

## Theme

**[OPEN]** No setting chosen yet. Specs use neutral terms: *item*, *board*,
*party*, *cycle*, *boss*. Theme should be chosen before content authoring but
does not block systems work.

## Glossary

| Term | Meaning |
|------|---------|
| Party | The 1–4 players in a run together. |
| Run | One playthrough, from cycle 1 until the party is eliminated. |
| Cycle | One pass through the loop: PvE battle, event, PvP battle. |
| Event | The non-combat step of a cycle, e.g. a shop. |
| Prep phase | A short window before each battle to arrange the team. |
| PvP battle | The third step of a cycle: a ghost, or a boss if no ghost matches. |
| Encounter | A single automated fight (PvE or ghost PvP). |
| Board | One player's grid of items. Each player has one. |
| Core | A board's health pool; what enemy items attack. |
| Charge | What generators produce and outputs consume; items fire when it reaches them (candidate mechanic). |
| Team | All of the party's boards together; what fights in a battle. |
| Lane | A board's place on the battlefield, opposite one enemy board. |
| Snapshot | A saved, immutable copy of a party's team at the start of an encounter. |
| Ghost | A snapshot being used as another party's opponent. |
| Boss | A generated PvE opponent used when no ghost is available. |
| Depth | The highest cycle a party reached; the primary score. |
