# 03 — Combat: The Factory and the Battlefield

Status: Draft v1.4

## Direction

- **CB-1 [DECIDED]** Combat is fully automated. Players give no input once a
  battle starts.
- **CB-2 [DECIDED]** The party's one shared board (CP-4) is an **automation
  factory** in the spirit of *Factorio*, built from **buildings** the
  players buy and place. (This supersedes the earlier "items only, no
  units" direction; the game has moved away from the *Bazaar* /
  *Backpack Battles* model toward its own factory-and-battlefield design.)
- **CB-3 [DECIDED]** **Economy means in-battle ramp** — buildings that make
  the factory stronger the longer a battle lasts. It does not mean producing
  gold or anything else spent outside combat.
- **CB-3a [DECIDED]** **Defense buys time**: walls and similar buildings
  slow down the enemy's attack while the factory ramps up.
- **CB-3b [DECIDED]** Rewards are a choice between **economy** (pays off
  later) and **attack or defense** (helps in the upcoming battles).
- **CB-3c [DECIDED]** Boards start with **randomized resource placement**
  and randomized **natural features** such as lakes and cliffs. Players must
  build around them, and can use them to **funnel enemy units**.
- **CB-3d [DECIDED]** Some buildings **produce units** that move toward the
  enemy base, attack its infrastructure, and eventually kill its Core.
- **CB-3f [DECIDED]** The things players place are called **buildings**.
  Buildings can be **rotated**.
- **CB-3g [DECIDED]** **Conduits** — the connections that carry charge
  between buildings — are **free and unlimited**. They **take up space**
  and **cannot cross each other**, except through a building made for it
  (a splitter, a merger, or a building that lets two conduits pass at 90
  degrees). Organizing conduit paths well is meant to be one of the main
  limits on a factory and a skill the game rewards.
- **CB-3h [DECIDED]** **Conduits cannot be targeted by enemies** (otherwise
  players could spam them to delay enemy units).
- **CB-3i [DECIDED]** **Gold is not a building resource.** Gold is spent only
  at shops between battles, to purchase buildings. Only buildings the party
  has purchased (or won) can be placed, and placing costs nothing. Conduits
  are the one exception: unlimited, never purchased.
- **CB-3j [DECIDED]** **No long-range buildings.** Buildings never attack
  the enemy's side of the battlefield; all offence is carried by units.
  **Defensive buildings only target enemy units that have crossed onto the
  party's own side.**
- **CB-3e [DECIDED]** The **Core's position is chosen by the team at the
  start of the run and cannot be moved**. All other buildings can be moved
  freely between battles.

Everything below is [PROPOSED] detail unless marked otherwise.

## The map

- **CB-4** At the start of a run the party's board is generated from a seed:
  a grid of terrain with resource nodes and natural features. Starting
  proposal for size: one plot is about 16 cells wide × 12 deep, and plots
  join side by side, so a four-player board is 64 × 12 (CP-5). Sizes are
  placeholders for the prototype to tune.
- **CB-5** **Resource nodes** are cells where a source building can be
  built. Sources can only be placed on nodes, so node positions shape the
  whole factory. Start with one resource (charge); a second node type with
  simple recipes is a possible later layer.
- **CB-6** **Natural features** are cells that cannot be built on and that
  block ground movement:
  - **Lakes** — impassable; routes and units go around.
  - **Cliffs** — impassable lines; create chokepoints.
  - Possible later: rough ground (slows units), high ground (range bonus),
    features that block building but not movement or the reverse.
- **CB-7** Every board has a **front edge** (facing the enemy) and a back
  edge. The team places the Core once, before the first battle, with the
  whole map visible (CB-3e). Deep and sheltered is safer; forward and
  central shortens the party's own supply lines. Generation guarantees at
  least one walkable path from the front edge to every legal Core position.
- **CB-8** **The battlefield** is the two sides' boards joined front edge to
  front edge (the opponent's board is rotated to face the party's). Units
  cross from one board to the other over that edge. Both parties in a ghost
  battle have the same party size and therefore the same front width.

## The factory

- **CB-9** Buildings have a **footprint**, a **tier**, **health**, **tags**,
  and a **kind**:

| Kind | Role | Examples |
|------|------|----------|
| **Source** | Built on a resource node; makes charge on a timer | Extractor |
| **Route** | Splits, joins, or crosses conduits | Splitter (one in, several out); Merger (several in, one out); Crossover (two conduits pass at 90°) |
| **Modifier** | Changes charge passing through | Amplifier; Capacitor (stores, then releases a large charge) |
| **Unit producer** | Consumes charge → spawns units | Barracks (cheap swarm); Foundry (slow, heavy unit); Siege works (anti-building) |
| **Defense** | Blocks or kills enemy units | Wall; Gate; Turret (needs charge to fire); Repair station |
| **Economy** | Consumes charge → the factory gets stronger for the rest of this battle | Overclocker (sources faster); Refit bay (later units spawn stronger); Reactor (becomes a new source once fed enough) |
| **Core** | The party's health. Fixed position (CB-3e). | — |

- **CB-9a** **Conduits** (CB-3g, CB-3h) are not buildings: players draw
  them between buildings at no cost and in any quantity.
  - A conduit **occupies the cells it runs through**. No building can stand
    on a conduit cell, and conduits must go around natural features.
  - Two conduits **cannot share or cross a cell**. To cross, split, or join
    them the party needs a route building (see table), which must be owned
    like any other building.
  - Conduits **cannot be targeted or damaged**, and they **do not block
    movement**: units of both sides walk over them. A conduit therefore
    never works as a wall. (Proposed consequence of CB-3h.)
  - A network can still be cut by destroying a **building** on it — a
    source, splitter, merger, or crossover — which makes those junctions
    worth protecting.
- **CB-9b** A building's **rotation** sets which sides take charge in and
  send it out, and for defenses which way they face.
- **CB-10** Time advances in fixed **ticks**. Charge moves one cell per
  tick along the conduits the players lay out, so longer conduits mean a
  longer delay. Charge with nowhere to go is
  lost; a building nothing feeds does nothing. Routes must go around
  natural features, which is half of the layout puzzle.
- **CB-11** **Every battle starts cold.** All battle state resets at the
  start of each battle: stored charge, economy upgrades, units, damage. What
  persists is the layout and the buildings' permanent tiers. Buildings
  destroyed in a battle are back for the next one.
- **CB-12** **Overload**: late in a battle, both sides' units and damage
  escalate, so that two fortified sides cannot stall forever.

## Units

- **CB-13** Unit producers spawn units when they have received enough
  charge. More charge means more or stronger units, so unit output follows
  the factory's ramp.
- **CB-14** **Movement.** Units walk over open ground: around natural
  features, around buildings, across the front edge into the enemy board.
  Pathfinding is grid-based and deterministic (CB-30).
- **CB-15** **Targeting.** By default a unit heads for the enemy Core by the
  shortest open path and attacks whatever blocks it. Unit types vary this:
  raiders go for sources and route buildings, siege units for walls and
  turrets, and so on. Killing infrastructure matters — destroying a source
  or a junction cripples the enemy's ramp for the rest of the battle.
  Conduits themselves are never targets (CB-3h).
- **CB-16** **Units fight units.** Opposing units that meet engage each
  other, so a front line forms between the bases and moves with the balance
  of production. (Alternative: units ignore each other and only defenses
  kill units — simpler, more like pure tower defense. See Q2.)
- **CB-17** A side loses when its Core is destroyed.

## Defense and terrain

- **CB-18** **Walls** block movement and have health. **Turrets** kill enemy
  units in range once those units are on the party's side of the front edge
  (CB-3j), and need charge. A turret's range never reaches across the front
  edge, however close to it the turret stands. **Gates** block enemies but let the party's own
  units through.
- **CB-19** **Funnelling.** Lakes, cliffs, and walls together determine the
  paths enemy units can take. A party that leaves one long, turret-lined
  approach to its Core gets far more value from each defense than one with
  an open field. Reading the map and shaping the approach is a core skill.
- **CB-20** **No sealed bases.** If no open path to the Core exists, units
  attack the weakest barrier on the shortest route. Walls delay; they never
  make a base unreachable.

## Strategies and choices

- **CB-21** Charge sent to one family is charge not sent to another. Three
  broad strategies beat each other in a circle, and parties will mix them:
  - **Rush** — unit production from the first second; beats a factory that
    is still ramping.
  - **Fortify and ramp** — defenses first, economy behind them, an
    overwhelming army late; beats a rush that cannot break through.
  - **Siege** — steady pressure with units that dismantle defenses and
    infrastructure before the ramp pays off.
- **CB-22** The party can **re-plan before each battle** (prep phase, RS-6):
  everything but the Core can move, so the factory can be re-routed for a
  PvE threat whose style is shown in advance, or hedged for the unknown PvP
  opponent.
- **CB-23** Reward choices follow the same split (CB-3b). Economy buildings
  are weak in the next battle and grow in value as the run goes on.

## Space and building

- **CB-24** **Space is the limiter.** Buildable cells — and especially
  resource nodes — are scarce. Conduits, defenses, and economy buildings
  compete for ground, and because conduits cannot cross (CB-3g) a tidy
  layout fits far more factory into the same area than a tangled one; and buildings also shape where units can walk.
- **CB-25** **Expansion** — new land with its own nodes and features — is a
  major party reward, or a rare, expensive shop offer.
- **CB-26** Buildings are bought with gold in shops between battles, or won
  as rewards, and go into the owning player's stash. Placing, moving, and
  rotating them costs nothing; gold plays no part in building or in battle
  (CB-3i). Combining duplicates raises a building's tier. Tag counts unlock board-wide
  bonuses.
- **CB-27** Moving and rotating buildings between battles is free; sources
  must stay on nodes, and the Core never moves (CB-3e). The map itself never
  changes during a run except by expansion.

## Opponents

- **CB-28** **Ghosts** are other parties' boards — their map, their factory,
  their Core position — and run in the same simulation, joined to the
  party's board (CB-8).
- **CB-29** **PvE enemies and bosses are scripted threats, not factories**:
  a **wave schedule** (which units arrive at the party's front edge, and
  when) plus a **stronghold** for the party's units to attack (a Core with
  health and pre-placed defenses on a small authored map). Both are scaled
  by the budget curve (SC-1) and party size. Archetypes test the three
  strategies:
  - **Rusher** — heavy early waves; tests defense.
  - **Fortress** — a heavily defended stronghold, light waves; tests ramp
    and siege.
  - **Escalator** — waves that grow quickly; tests speed.

## Risks to test in the prototype

1. **Scope.** This is now a factory builder, a tower defense, and a unit
   autobattler in one. The proof of concept must cut hard: one resource, a
   handful of buildings and unit types, small maps (TA-41).
2. **Ramp versus the exponential wall** (SC-8). In-battle economy can be
   exponential; space, caps, and rising PvE pressure must contain it.
3. **Balance of the three strategies**, and of terrain luck: some maps will
   be much easier to defend than others. Generation needs fairness
   constraints, and ghosts carry their terrain with them.
4. **Build time.** Laying out a factory around terrain is slow and
   thoughtful. Session targets (RS-12) will need to grow, or per-cycle
   changes must stay small.
5. **Readability** of a four-player battlefield (two 64 × 12 boards, many
   units).
6. **Simulation cost.** Pathfinding and many units are far heavier than
   item timers; the balance harness needs thousands of battles (CB-36).

## Structural requirements

- **CB-30 [PROPOSED → effectively required]** Combat is **deterministic**:
  the outcome is a pure function of `(team, opponent, seed, game version)`.
  Integer math, fixed tick order, deterministic pathfinding and
  tie-breaking, no wall-clock time, no unordered iteration.
- **CB-31** Combat runs in a **headless simulation** that produces an
  **event log**. Presentation renders playback from the log and never
  decides outcomes. The same simulation runs in the host's game
  (authoritative, TA-6), in tests, and in balance tools.
- **CB-32** A party is fully described by a serializable **team state**
  (CP-6): the map (terrain, nodes, features, revealed area), the Core
  position, every building with tier, position and orientation, and run
  modifiers that affect combat. This is exactly what a snapshot stores
  (MM-1).
- **CB-33** If both Cores are destroyed on the same tick, a deterministic
  tiebreak applies (then the defender/ghost wins).
- **CB-34** An **opponent** is either a team state (ghost) or a threat
  profile (PvE, CB-29). Both are data and run through the same simulation
  entry point.
- **CB-35** All content (buildings, units, tags, terrain rules, threat
  profiles, strongholds) is **data-driven**: versioned data files validated
  against schemas.
- **CB-36** Performance budget, set in the first simulation milestone:
  maximum units alive per side, maximum battle length in ticks, and a
  battles-per-second target for the balance harness at four-plot size.

## Playback and understanding the factory

- **CB-40** All party members watch the same battle in sync, each free to
  pan and zoom across both boards. Speed controls (1×/2×/skip) apply when
  all players agree, or automatically in solo.
- **CB-41** A ghost's board is fully visible during the battle. A PvE
  threat's archetype and stronghold are shown before the party commits
  (RS-3b).
- **CB-42** A post-battle summary shows a timeline (production, army size,
  and damage for both sides) and where the party's defenses were breached.
- **CB-43** **Preview while building:** a dry run shows charge flow,
  projected production over time, and the **paths enemy units would take**
  to the Core with the current layout.
- **CB-44** Any past battle can be replayed from
  `(team, opponent, seed, version)`.

## First playable content budget

- **CB-50** One resource; ~15 buildings across the kinds; 3–4 unit types;
  lakes and cliffs; 3 PvE archetypes; 1 boss. Enough to validate the loop;
  no more.
