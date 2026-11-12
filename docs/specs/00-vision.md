# 00 — Vision & Pillars

Status: Draft v5.0

## Elevator pitch

A co-op roguelite autobattler for 1–4 players. Each player has their own
**plot** of one continuous battlefield, with their own Core and their own
factory on it. Between fights, each player buys buildings and builds in
their own plot; players link their factories with conduits across the plot
borders. Fights resolve automatically. Opponents alternate between hand-authored-style PvE
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
- **V-9 [SUPERSEDED by V-13, issue #124]** Earlier decision: the party
  builds one large shared board. No longer in force.
- **V-9a [DECIDED]** What the party buys is a choice between economy —
  in-battle ramp, not gold — and attack or defense for the upcoming battles.
  The choice is made in the shop; battle rewards themselves are gold (RS-6).
  Defense, such as walls, buys time for the factory to ramp up.
- **V-10 [DECIDED]** The game is its own thing. It began from the
  item-board style of *The Bazaar* and *Backpack Battles* and has moved to a
  factory-and-battlefield design: the factory produces units that march on
  the enemy base, on a map with randomized resources and natural features
  (lakes, cliffs) that shape both building and enemy movement.
- **V-10a [SUPERSEDED by V-14, issue #124]** Earlier decision: the team
  chooses one Core position together. No longer in force.
- **V-11 [DECIDED]** Built in Godot, for release on Steam, using Steam
  features for backend needs (lobbies, multiplayer, async PvP) wherever
  possible.
- **V-12 [DECIDED]** Development starts with a simple offline web proof of
  concept for playtesting; multiplayer is built after the port to Godot.
- **V-13 [DECIDED]** **Each player has their own plot and their own Core.**
  The plots sit side by side and form one continuous battlefield: an
  automation factory in the spirit of *Factorio*, built in parts. A player
  can place only buildings they own, and only in their own plot. Players
  help each other in one way: conduits that meet at a plot border join into
  a **border link** and carry resources from one plot to the next (CP-30,
  CB-9d). (Replaces V-9.)
- **V-14 [DECIDED]** **Each player places their own Core**, anywhere legal in
  their own plot, at the start of the run. There is no party vote on it. A
  Core never moves; every other building can be moved freely between
  battles by its owner. (Replaces V-10a.)
- **V-15 [DECIDED]** **Resource scarcity is a main limit on a factory.**
  Collectors (sources) produce at a flow rate set by their tier. Every
  building that does something consumes resources at a rate of its own, and
  stronger buildings may need more. A factory can therefore run only as many
  buildings as its collectors can feed (CB-10a to CB-10d).
- **V-16 [DECIDED]** **A side loses a battle when all of its Cores are
  destroyed.** A lost PvP battle costs one life from the party's shared
  five, however many Cores fell (CB-17, RS-5).

## Design pillars

1. **Together, not just alongside.** Co-op must create real interdependence:
   shared stakes, factories that feed each other, and decisions worth
   talking about. Each player builds their own plot (V-13), so the
   interdependence comes from three things: the party wins or loses every
   battle together and shares one pool of lives; resources can be sent
   across plot borders, so one player's surplus runs another player's
   buildings; and all plots are one battlefield, so one player's turrets and
   units defend a neighbour's ground. A 4-player run should not feel like
   four solo runs in a trench coat; whether border links are enough to
   prevent that is the first thing to check in a party playtest
   (`02-coop-party.md`, "Co-op under the per-player design").
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
- **2–4 players:** friends on voice chat arguing about what to buy, who
  feeds whom across which border, and cheering or groaning at the same
  fight.

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
| Board | The party's whole map: every player's plot side by side, and everything built on it. |
| Building | Anything a player places in their plot: sources, unit producers, defenses, economy buildings. Bought in shops, apart from the starting kit. Each building has one owner, the player who bought it. |
| Conduit | A free, unlimited connection that carries one resource between buildings. Takes space, cannot cross another conduit, cannot be attacked. It belongs to the player who drew it and stays inside that player's plot, except at a border link. |
| Border link | Two conduits, one drawn by each of two neighbouring players up to the same spot on their shared plot border, joined into one connection that carries resources from one plot to the other. |
| Splitter | The building that divides one conduit's flow between two or three conduits. The only way to split a conduit. |
| Unit | A fighter produced by a building during battle; walks to the enemy base and attacks. |
| Resource node | A map cell where a source can be built. |
| Natural feature | Terrain such as a lake or cliff that blocks building and movement. |
| Front edge | The side of a board that faces the enemy; units cross it. |
| Neutral zone | A small strip generated between the two boards for each battle, with its own lakes and cliffs, hidden until the battle begins. |
| Point of interest | A spot in the neutral zone, guarded by neutral units, that buffs the side controlling it. |
| Core | A player's health in battle and the target of enemy units. Each player has one, placed once per run in their own plot; it never moves. A side loses a battle when all of its Cores are destroyed. |
| Source (collector) | A building on a resource node that produces that node's resource at a flow rate set by its tier. |
| Need | The most a building can consume per second: the cost of one production divided by the shortest time between two productions. |
| Store | The small amount of resources a building can hold: enough for one production, plus a few items waiting at its inputs. Empty at the start of every battle. |
| Resource | What sources extract from nodes and other buildings consume. Three base kinds (Ore, Power, Flux for now), each with a refined form made by a refinery and needed by rarer, stronger buildings. |
| Plot | One player's own area of the board (shown to players as "your area"). A player builds only in their own plot. Plots are the same size and sit side by side. |
| Ramp | The factory getting stronger over the course of one battle; what "economy" buildings provide. |
| Threat | A PvE opponent: scripted waves of units plus a stronghold to attack, not a factory. |
| Snapshot | A saved copy of a party's board (every plot), taken at the start of a PvP battle. |
| Ghost | A snapshot being used as another party's opponent. |
| Boss | A generated PvE opponent used when no ghost is available. |
| Depth | The highest round a party reached; the primary score. |
