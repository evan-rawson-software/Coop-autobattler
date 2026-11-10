# 00 — Vision & Pillars

Status: Draft v4.5

## Elevator pitch

A co-op roguelite autobattler for 1–4 players. Between fights, each
player buys buildings and adds them to one large shared factory board that
the whole party builds together. Fights
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
  difficulty — easy, medium, or hard; (2) a PvP battle. After each battle
  there is an event, and after the event there is always a shop.
- **V-8 [DECIDED]** The party has 5 lives. Losing a PvP battle costs a life.
  Losing a PvE battle costs no life but grants no reward.
- **V-9 [DECIDED]** The party builds **one large shared board**: an
  automation factory in the spirit of *Factorio*. Players coordinate to
  build the best overall factory. (Replaces the earlier one-board-per-player
  decision.)
- **V-9a [DECIDED]** What the party buys is a choice between economy —
  in-battle ramp, not gold — and attack or defense for the upcoming battles.
  The choice is made in the shop; battle rewards themselves are gold (RS-6).
  Defense, such as walls, buys time for the factory to ramp up.
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
5. **Unhurried, and easy to put down.** Nothing is timed; a party thinks
   for as long as it likes. A run can be long, so it can be saved and
   resumed at any point, and a party can drop a run without hurting anyone
   else, because all PvP is asynchronous.

## Target experience

- **Solo:** a complete game on its own, comparable to a single-player
  autobattler run.
- **2–4 players:** friends on voice chat arguing about what to buy and where it goes,
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
*party*, *round*, *boss*. Theme should be chosen before content authoring but
does not block systems work.

## Glossary

| Term | Meaning |
|------|---------|
| Party | The 1–4 players in a run together. |
| Run | One playthrough, from round 1 until the party is eliminated. |
| Round | One pass through the loop: PvE battle, event, shop, PvP battle, event, shop. (Called a "cycle" in earlier drafts.) |
| Event | A short non-combat step after every battle, before the shop. |
| Shop | The guaranteed step after every event: buy buildings, re-roll, and rearrange the factory before the next battle. |
| PvP battle | The second battle of a round, after the first shop: a ghost, or a boss if no ghost matches. |
| Encounter | A single automated fight (PvE or ghost PvP). |
| Board | The party's single shared map and everything built on it: the factory. |
| Building | Anything the party places on the board: sources, unit producers, defenses, economy buildings. Bought in shops, apart from the starting kit. |
| Conduit | A free, unlimited connection that carries one resource between buildings. Takes space, cannot cross another conduit, cannot be attacked. |
| Unit | A fighter produced by a building during battle; walks to the enemy base and attacks. |
| Resource node | A map cell where a source can be built. |
| Natural feature | Terrain such as a lake or cliff that blocks building and movement. |
| Front edge | The side of a board that faces the enemy; units cross it. |
| Neutral zone | A small strip generated between the two boards for each battle, with its own lakes and cliffs, hidden until the battle begins. |
| Point of interest | A spot in the neutral zone, guarded by neutral units, that buffs the side controlling it. |
| Core | The party's health and the enemy's final target. Placed once per run; never moves. |
| Resource | What sources extract from nodes and other buildings consume. Three base kinds (Ore, Power, Flux for now), each with a refined form made by a refinery and needed by rarer, stronger buildings. |
| Plot | The area one player adds to the shared board. |
| Ramp | The factory getting stronger over the course of one battle; what "economy" buildings provide. |
| Threat | A PvE opponent: scripted waves of units plus a stronghold to attack, not a factory. |
| Snapshot | A saved copy of a party's board, taken at the start of a PvP battle. |
| Ghost | A snapshot being used as another party's opponent. |
| Boss | A generated PvE opponent used when no ghost is available. |
| Depth | The highest round a party reached; the primary score. |
