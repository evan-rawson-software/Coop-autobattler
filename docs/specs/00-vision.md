# 00 — Vision & Pillars

Status: Draft v1.2

## Elevator pitch

A co-op roguelite autobattler for 1–4 players. Between fights, the party
each player
drafts buildings and adds them to one large shared factory board that the whole
party builds together. Fights
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
- **V-9 [DECIDED]** The party builds **one large shared board**: an
  automation factory in the spirit of *Factorio*. Players coordinate to
  build the best overall factory. (Replaces the earlier one-board-per-player
  decision.)
- **V-9a [DECIDED]** Rewards are a choice between economy — in-battle ramp,
  not gold — and attack or defense for the upcoming battles. Defense, such
  as walls, buys time for the factory to ramp up.
- **V-10 [DECIDED]** The game is its own thing. It began from the
  item-board style of *The Bazaar* and *Backpack Battles* and has moved to a
  factory-and-battlefield design: the factory produces units that march on
  the enemy base, on a map with randomized resources and natural features
  (lakes, cliffs) that shape both building and enemy movement.
- **V-10a [DECIDED]** The Core's position is chosen by the team at the start
  of the run and never moves; every other building can be moved freely
  between battles.
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
4. **Decisions in the build, spectacle in the fight.** Players have zero input
   during combat. All skill expression is in drafting, economy, and how buildings
   are arranged on the board.
5. **Short sessions, legible cycles.** A cycle is a few minutes; a run fits in
   an evening; a party can drop a run and it does not hurt anyone else,
   because all PvP is asynchronous.

## Target experience

- **Solo:** a complete game on its own, comparable to a single-player
  autobattler run.
- **2–4 players:** friends on voice chat arguing about who gets the reward,
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

**[OPEN]** No setting chosen yet. Specs use neutral terms: *building*, *board*,
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
| Board | The party's single shared map and everything built on it: the factory. |
| Building | Anything the party places on the board: sources, unit producers, defenses, economy buildings. Bought in shops or won as rewards. |
| Conduit | A free connection that carries charge between buildings. |
| Unit | A fighter produced by a building during battle; walks to the enemy base and attacks. |
| Resource node | A map cell where a source can be built. |
| Natural feature | Terrain such as a lake or cliff that blocks building and movement. |
| Front edge | The side of a board that faces the enemy; units cross it. |
| Core | The party's health and the enemy's final target. Placed once per run; never moves. |
| Charge | What sources produce and other buildings consume; a building fires when charge reaches it. |
| Plot | The area one player adds to the shared board. |
| Ramp | The factory getting stronger over the course of one battle; what "economy" buildings provide. |
| Threat | A PvE opponent: scripted waves of units plus a stronghold to attack, not a factory. |
| Snapshot | A saved, immutable copy of a party's team at the start of an encounter. |
| Ghost | A snapshot being used as another party's opponent. |
| Boss | A generated PvE opponent used when no ghost is available. |
| Depth | The highest cycle a party reached; the primary score. |
