# 00 — Vision & Pillars

Status: Draft v6.2

This file says what the game is and what every other spec serves: the
owner's top-level requirements, the design pillars, the scope, the theme and
the shared vocabulary. The detailed rules live in specs 01–06, and the exact
rules of the code in `docs/rules-reference.md`. Requirement IDs (`V-…`) are
stable; other specs refer to them.

## Elevator pitch

A co-op roguelite autobattler for 1–4 players, set in a bright world of
magic-powered factories. Each player has their own **plot** of one
continuous battlefield, with their own Core and their own factory on it.
Between battles, each player buys buildings, places them, and wires them
together with conduits; neighbours join their factories with **border
links** that carry resources across the plot border. Battles resolve
automatically: the factories run, produce units, and send them at the enemy.

Each round has two battles. First a **PvE threat** at a difficulty the
party picks; then **ghost PvP** against a saved snapshot of another real
party at the same point in its run, or a **boss** when no ghost matches.
Events and shops sit between battles. PvE power grows exponentially, so no
run lasts forever; the score is how deep the party got.

## A run at a glance

```
Map + Core placement ->
  [ PvE battle -> Event -> Shop -> PvP battle -> Event -> Shop ] x N
-> Defeat -> Run summary
```

The party shares five lives; losing a PvP battle costs one, and the run
ends at zero. Details: `01-run-structure.md`.

## Owner requirements

### The game

- **V-1 [DECIDED]** Supports 1–4 players in a party.
- **V-10 [DECIDED]** The game is its own thing. It began from the
  item-board style of *The Bazaar* and *Backpack Battles* and became a
  factory-and-battlefield design: the factory produces units that march on
  the enemy base, on a map with randomized resources and natural features
  (lakes, cliffs) that shape both building and enemy movement.
- **V-6 [DECIDED]** The structure of encounters (a run of automated
  battles with choices and shops between them) is in the spirit of *The
  Bazaar*.

### The run

- **V-7 [DECIDED]** A run is a repeating loop of: (1) a PvE battle at a
  chosen difficulty — easy, medium, or hard; (2) a PvP battle. After each
  battle there is an event, and after the event there is always a shop
  (RS-1).
- **V-8 [DECIDED]** The party has 5 lives. Losing a PvP battle costs a
  life, whether the opponent was a ghost or the boss that replaced one
  (RS-5, RS-5a). Losing a PvE battle costs no life but grants no reward
  (RS-3a).
- **V-16 [DECIDED]** **A side loses a battle when all of its Cores are
  destroyed.** A lost PvP battle costs one life from the party's shared
  five, however many Cores fell (CB-17, RS-5).
- **V-5 [DECIDED]** PvE enemies scale exponentially so that every run is
  eventually forced to end in defeat (SC-1).
- **V-9a [DECIDED]** What a player buys is a choice between **economy**
  and **attack or defense** for the coming battles. Economy here means
  in-battle ramp — buildings that make the factory stronger as a battle
  goes on — not more gold. Defense, such as walls, buys time for the
  factory to ramp up. Battle rewards themselves are gold (RS-6).

### Opponents

- **V-2 [DECIDED]** Runs combine PvE encounters and PvP encounters.
- **V-3 [DECIDED]** PvP is asynchronous: the opponent is a saved state of
  another party at the same point in the game, with the same party size, on
  the same game version (MM-1 to MM-17).
- **V-4 [DECIDED]** If no saved state matches, a PvE boss is generated
  instead, based on how far the party has progressed. There are several
  bosses, each with a signature rule; later rounds unlock more of them
  (MM-9 to MM-9e).
- **V-17 [DECIDED]** **No opponent changes how the party's factory
  works.** A boss's or a threat's special rules act only on its own side:
  its own buildings, Cores and units. The party's buildings, conduits and
  units always behave as they did in the shop, because nobody can react
  during a battle (pillar 4). Anything that weakens the party's own side is
  opt-in and known before the party builds, for example an event option the
  party chooses (MM-9a).

### The party and the factory

- **V-13 [DECIDED]** **Each player has their own plot and their own Core.**
  The plots sit side by side and form one continuous battlefield: an
  automation factory in the spirit of *Factorio*, built in parts. A player
  can place only buildings they own, and only in their own plot. Players
  help each other in one way: conduits that meet at a plot border join into
  a **border link** and carry resources from one plot to the next (CP-30,
  CB-9d). Gold and buildings are never given between players (CP-29).
  (Replaces V-9.)
- **V-14 [DECIDED]** **Each player places their own Core**, anywhere legal
  in their own plot, at the start of the run. There is no party vote on it.
  A Core never moves; every other building can be moved freely between
  battles by its owner. (Replaces V-10a.)
- **V-15 [DECIDED]** **Resource scarcity is a main limit on a factory.**
  Collectors produce at a flow rate set by their tier. Every building that
  does something consumes resources at a rate of its own, and stronger
  buildings may need more, including refined resources. A factory can
  therefore run only as many buildings as its collectors can feed (CB-10a
  to CB-10d).

### Platform

- **V-11 [DECIDED]** Built in Godot, for release on Steam, using Steam
  features for backend needs (lobbies, multiplayer, async PvP) wherever
  possible.
- **V-12 [DECIDED]** Development starts with a simple offline web proof of
  concept for playtesting; multiplayer is built after the port to Godot.
  The web proof of concept is built and playable; the Godot port is next
  (`06-technical-architecture.md`).

### Superseded

Kept so that old references still resolve.

| ID | Was | Replaced by |
|----|-----|-------------|
| V-9 | The party builds one large shared board. | V-13 (issue #124) |
| V-10a | The party chooses one Core position together. | V-14 (issue #124) |

## Design pillars

1. **Together, not just alongside.** Co-op must create real
   interdependence: shared stakes, factories that feed each other, and
   decisions worth talking about. Each player builds their own plot
   (V-13), so the interdependence comes from three things: the party wins
   or loses every battle together and shares one pool of lives; resources
   can be sent across plot borders, so one player's surplus runs another
   player's buildings; and all plots are one battlefield, so one player's
   turrets and units defend a neighbour's ground. A 4-player run should not
   feel like four solo runs in a trench coat; whether border links are
   enough to prevent that is the first thing to check in a party playtest
   (`02-coop-party.md`, "Co-op under the per-player design").
2. **Every run ends; depth is the score.** There is no "win screen". The
   exponential wall is the antagonist, and beating your previous depth is
   the hook.
3. **Fights are fair because they are identical.** Combat is fully
   deterministic from its inputs. The same two teams and seed always
   produce the same result. This is what makes ghost PvP, replays, and
   testing possible.
4. **Decisions in the build, spectacle in the fight.** Players have zero
   input during combat. All skill expression is in drafting, economy, and
   how buildings are arranged on the board. Because of this, no opponent
   may change how the party's factory works (V-17).
5. **Unhurried, and easy to put down.** Nothing is timed; a party thinks
   for as long as it likes. A run can be long, so it can be saved and
   resumed at any point, and a party can drop a run without hurting anyone
   else, because all PvP is asynchronous.
6. **The factory grows until placement is a tough choice.** Early on,
   space is plentiful and any layout works. Over a run, more buildings,
   wider footprints, more conduits (a two-input building needs one per
   input), and walls and turrets that want the same ground make space run
   out, so that by the mid-run a player must choose what goes where and
   what to leave out. Content and tuning are judged against this: a plot
   that never fills, or a layout that is obviously right, misses the
   pillar. The plot size is tuned so this happens (CB-4).

## Target experience

- **Solo:** a complete game on its own, comparable to a single-player
  autobattler run.
- **2–4 players:** friends on voice chat arguing about what to buy, who
  feeds whom across which border, and cheering or groaning at the same
  fight.

## Out of scope (for now)

- Live, synchronous PvP between two human parties.
- Offline play in the released game, which requires Steam. (The web proof
  of concept is offline, but it is a playtest build, not a product.)
- A custom backend. Steam provides lobbies, networking, and ghost storage
  (`06-technical-architecture.md`).
- Ranked ladders, seasons, monetization, cosmetics.
- Mid-run drop-in of new players (party size is fixed for a run; see
  `02-coop-party.md`).
- Trading or interaction between different parties.

## Theme

**[DECIDED] Arcane industry, light and charming** (issue #392): magic-powered
factories, bright colours, playful names and descriptions, and cute but
readable units. Art and sound follow the same tone: soft, friendly, and
always readable at a glance.

The voice, naming rules, name table and art direction are in
[`docs/theme.md`](../theme.md). The names from that table are applied in the
game (issue #393). Older specs and issues still use the working names (Power,
Composite; Extractor; Range; Hangar; Rusher; and so on); the glossary gives
the working name in brackets where it helps. Display names live in one file, `content/presentation.en.json`, so a
rename never touches the rules (TA-27a).

## Glossary

Specs use these terms. Where the game shows a different word, it is given in
brackets.

| Term | Meaning |
|------|---------|
| Archetype | A template for a PvE threat (for example Stampede [Rusher], Fortress, Crescendo [Escalator]), setting its wave timing, unit mix and stronghold layout. Bosses have archetypes of their own. |
| Area damage | A unit stat: when the unit hits a target, other units near the target take a percent of the hit too. Units only, no friendly fire. |
| Armor | A unit stat: a flat amount taken off every hit the unit takes, never below 1 damage. |
| Board | A side's whole map in a battle: every plot of the party side by side, and everything built on it. |
| Border link | Two conduits, one drawn by each of two neighbouring players up to the same spot on their shared plot border, joined into one connection that carries resources from one plot to the other. |
| Boss | A generated PvE opponent used for the PvP battle when no ghost matches. There are several, each with a signature rule that acts only on its own side; later rounds unlock more (MM-9a to MM-9e). |
| Building | Anything a player places in their plot: collectors, route buildings, unit producers, refineries, defenses, economy buildings. Bought in shops, apart from the starting kit. Each building has one owner, the player who bought it, and a tier from 1 to 3. |
| Collector (Siphon) [Extractor] | A building on a resource node that produces that node's resource at a flow rate set by its tier. Also called a source. |
| Conduit | A free, unlimited connection that carries one resource between buildings. Takes space, cannot be attacked, and cannot cross another conduit except through a Crossover. It belongs to the player who drew it and stays inside that player's plot, except at a border link. |
| Core | A player's health in battle and the target of enemy units. Each player has one, placed once per run in their own plot; it never moves. A side loses a battle when all of its Cores are destroyed. |
| Crossover | A route building that lets two conduits cross. |
| Depth | The highest round a party reached; the primary score. |
| Economy building | A building that makes its owner's factory stronger as a battle goes on (ramp), such as the Surge coil [Overclocker] and the Armory. It helps only its owner. |
| Encounter | A single automated battle (PvE or PvP). |
| Event | A short non-combat step after every battle, before the shop. The party votes on one of the offered events (CP-16). |
| Front edge | The side of a board that faces the enemy; units cross it. |
| Ghost | A snapshot being used as another party's opponent. |
| Guard | A neutral unit that holds a point of interest and fights units of both sides (CB-8e). |
| Lives | The party's shared pool, five at the start of a run. Losing a PvP battle costs one; the run ends at zero. |
| Merger | A route building that joins conduits of the same resource into one. |
| Modifier | A lasting bonus for the rest of the run, mostly from the Shrine event. It belongs to the party's team state and travels with its snapshots (EC-8). |
| Natural feature | Terrain such as a lake or cliff that blocks building and movement. |
| Need | The most a building can consume per second: the cost of one production divided by the shortest time between two productions. |
| Neutral zone | A small strip generated between the two boards for each battle, with its own lakes and cliffs, hidden until the battle begins. |
| Overload | The rule that makes every battle end: late in a battle, units deal more damage and every Core takes growing damage, step by step (CB-12). |
| Party | The 1–4 players in a run together. |
| Party vote | How the party makes a shared choice, such as the PvE difficulty or the event (CP-16). |
| Plot [your area] | One player's own area of the board. A player builds only in their own plot. Plots are the same size and sit side by side. |
| Point of interest | A spot in the neutral zone, guarded by neutral units, that buffs the whole side controlling it. A side takes it by keeping units in range for a while (capture progress); more units capture faster, and both sides in range means no progress. |
| PvE battle | The first battle of a round: a threat at the difficulty the party chose. |
| PvP battle | The second battle of a round: a ghost, or a boss if no ghost matches. |
| Ramp | The factory getting stronger over the course of one battle; what economy buildings provide. |
| Refinery | A building that turns one or two resources into a refined resource, needed by rarer, stronger buildings. |
| Resource | What collectors extract from nodes and other buildings consume. Three base kinds (Ore, Spark [Power], Flux). Refining is one step deep; the first version has two refined compounds, Sparksteel [Composite] (Ore + Spark) and Aether (Spark + Flux). |
| Resource node | A map cell where a collector can be built. |
| Round | One pass through the loop: PvE battle, event, shop, PvP battle, event, shop. |
| Run | One playthrough, from round 1 until the party is eliminated. |
| Shop | The guaranteed step after every event. Each player gets their own offers and gold, buys buildings, re-rolls, and rearranges their plot before the next battle. |
| Signature building | A building that only one specialist can buy, offered in that player's own shop only (EC-3b). The roster has four (CB-51). It consumes resources like any other building (V-15) and helps only its owner. |
| Snapshot | A saved copy of a party's board (every plot), run modifiers and each player's specialist, taken at the start of a PvP battle. |
| Specialist | A choice each player makes once, at the start of the run: a small bonus for one family of the player's own buildings or units, plus a signature building only that specialist can buy (RS-13, CB-51). Duplicates are allowed; nothing is given between players. |
| Splitter | The building that divides one conduit's flow between two or three conduits. The only way to split a conduit. |
| Store | The small amount of resources a building can hold: enough for one production, plus a few items waiting at its inputs. Empty at the start of every battle. |
| Stronghold | The base a PvE threat defends: one Core per player of the party, with walls and turrets laid out by its archetype. |
| Threat | A PvE opponent: scripted waves of units plus a stronghold to attack, not a factory. |
| Tier | A building's level, 1 to 3. Higher tiers are stronger and appear more often in later shops. |
| Unit | A fighter produced by a building during battle; walks toward an enemy Core and attacks what it meets. |
| Wave | A group of threat units that enters the battle at a set time. |
