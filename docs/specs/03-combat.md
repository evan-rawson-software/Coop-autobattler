# 03 — Combat: The Factory and the Battlefield

Status: Draft v4.0

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
- **CB-3g [DECIDED]** **Conduits** — the connections that carry resources
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
- **CB-3k [DECIDED]** There are **a few different resources — about
  three** — not one.
- **CB-3e [DECIDED]** The **Core's position is chosen by the team at the
  start of the run and cannot be moved**. All other buildings can be moved
  freely between battles.

Everything below is [PROPOSED] detail unless marked otherwise.

## The map

- **CB-4** At the start of a run the party's board is generated from a seed:
  a grid of terrain with resource nodes and natural features. The whole
  map is visible and buildable from the start, and it is **fairly large**
  [DECIDED] — early on the party has far more room than buildings. Starting
  proposal for size: one plot is about 24 cells wide × 16 deep, and plots
  join side by side, so a four-player board is 96 × 16 (CP-5). Sizes are
  placeholders for the prototype to tune.
- **CB-5** **Resource nodes** are cells where a source building can be
  built. Sources can only be placed on nodes, so node positions shape the
  whole factory. Each node yields one of the resources (CB-5a).
- **CB-5a [DECIDED for now]** **Three resources** (CB-3k): **Ore, Power,
  and Flux**. The names are working names and must be **renameable in one
  configuration file** (TA-27a). The roles:

  | Resource | Nodes | Mainly used for |
  |----------|-------|-----------------|
  | **Ore** | Common | Bodies: units, walls, repairs |
  | **Power** | Common | Running things: turrets firing, production speed |
  | **Flux** | Rare | Economy buildings, advanced units, upgrades |

  **Most buildings take a single resource type. Some rarer buildings
  require inputs of more than one type** [DECIDED] (e.g. a heavy-unit
  foundry needing Ore and Power). **Some rarer buildings require refined resources, and are stronger than
  buildings that run on base resources** [DECIDED] (CB-5d).
- **CB-5b [DECIDED]** **A conduit carries one resource type**, set by what
  feeds it. Mergers join conduits of the same type only. A multi-input
  building therefore needs a separate conduit for each resource to reach
  it, which — with no crossing (CB-3g) — is where layout skill is tested
  hardest, and part of what makes those rarer buildings a commitment.
- **CB-5d [DECIDED/PROPOSED detail]** **Refined resources.** Decided:
  refined resources exist, and the rarer, stronger buildings need them.
  Proposed detail:
  - A **refinery** is a building (bought like any other) that takes
    resources in and puts a refined resource out, at a loss (e.g. 3 in, 1
    out) and after a delay.
  - **Common refineries take one resource. Rarer refineries take two
    different resources to make a single refined resource** [DECIDED].
  - Proposed set of refined resources, with working names, all defined in
    the same configuration file as the base resources and renameable there
    (TA-27a):

    | Refined | Made from | Refinery |
    |---------|-----------|----------|
    | Alloy | Ore | Common |
    | Surge | Power | Common |
    | Essence | Flux | Common |
    | *(compound A)* | Ore + Power | Rare |
    | *(compound B)* | Ore + Flux | Rare |
    | *(compound C)* | Power + Flux | Rare |

    The compounds feed the strongest buildings in the game. Not all six
    need to exist in the first playable.
  - A two-input refinery needs a conduit for each input (CB-5b), so it has
    to sit where two networks can reach it without crossing — the hardest
    placement problem in the game, by design.
  - Refining is **one step deep**: refined resources are not refined
    further. This keeps factories legible while still creating real chains.
  - A refined resource is its own conduit type (CB-5b), so a refined
    building needs source → conduit → refinery → conduit → building, all
    without crossing anything else. Refined buildings are stronger partly
    because they are slower to come online in a battle and harder to fit.
  - A destroyed refinery cuts everything downstream of it (CB-9a), making
    refineries prime targets for raiders.
- **CB-5c** Where the rare nodes are, and how far they sit from good
  defensive ground and from the Core, is the main way maps differ in
  character.
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
- **CB-8 [DECIDED]** **The battlefield** is the two sides' boards with a
  **small neutral zone generated between them for each battle**. Units
  leave their own board over its front edge, cross the neutral zone, and
  enter the enemy board over its front edge.
  - The neutral zone **can contain natural features** such as cliffs and
    lakes.
  - Its features are **different every battle** and are **hidden from the
    players until the battle begins**, so there is nothing to plan around
    and no reason to rearrange the whole factory for each battle.
  - It can also contain **points of interest** that **give buffs to the
    side that controls them**, and that are **guarded by neutral units**.
- **CB-8c [PROPOSED]** Points of interest:
  - **Aggro** [DECIDED]: units are not sent to points of interest. A unit
    goes to one only if its path takes it **near enough to "aggro"** — within
    the point's aggro range — in which case it diverts to fight there.
    Otherwise it marches past.
  - **Guards** are neutral units that hold their position at the point and
    fight any unit of either side that aggros.
  - **Control** [DECIDED: capture and move on]: when a side's units kill the guards (or the other side's
    units holding the point), that side takes control and its units resume
    their march. Control lasts until enemy units aggro on the point and
    retake it, so a point can change hands during the battle. The buff
    applies while the point is held and ends with the battle.
  - **Buffs** are battle-wide for the controlling side, e.g. sources
    produce faster, units spawn stronger, units heal near the point, a
    trickle of a rare resource.
  - **Consequence for building**: which points a party's units reach
    depends on where they leave the front edge and how the hidden terrain
    routes them. A party can spread its unit producers along the front to
    brush more of the zone, or concentrate them and accept missing points —
    without ever knowing in advance what is out there. A point also pulls
    units off the direct route for a while, which can cost a rush its
    timing.
  - Like the rest of the zone, points and guards are generated from the
    battle seed, hidden until the battle begins, and placed fairly: mirrored
    or equidistant so neither side is favoured.
  - Guard strength scales with the cycle so points stay worth fighting for
    at any depth.
- **CB-8a [PROPOSED]** Details of the neutral zone:
  - It is generated from the battle seed, so a battle remains reproducible
    (CB-30).
  - Nothing can be built in it and neither side's buildings act in it
    (CB-3j); only units fight there.
  - It is as wide as the front edges and only a few cells deep (starting
    proposal: 6–8, enough to hold a point of interest and its guards).
  - Generation guarantees open paths across it, and that its features can
    shift where units arrive along a front edge but cannot seal part of an
    edge off entirely.
  - PvE battles have one too, between the party's board and the stronghold.
- **CB-8b [PROPOSED]** Both parties in a ghost battle have the same party
  size and therefore the same front width. The opponent's board is rotated
  to face the party's.

## The factory

- **CB-9** Buildings have a **footprint**, a **tier**, **health**,
  and a **kind**:

| Kind | Role | Examples |
|------|------|----------|
| **Source** | Built on a resource node; produces that node's resource on a timer | Extractor |
| **Route** | Splits, joins, or crosses conduits | Splitter (one in, several out); Merger (several in, one out); Crossover (two conduits pass at 90°) |
| **Refinery** | Turns one resource (common) or two (rare) into a refined resource | Smelter (Ore → Alloy) |
| **Modifier** | Changes the flow passing through | Booster (more per tick); Buffer (stores, then releases a burst) |
| **Unit producer** | Consumes resources → spawns units | Barracks (cheap swarm); Foundry (slow, heavy unit); Siege works (anti-building) |
| **Defense** | Blocks or kills enemy units | Wall; Gate; Turret (needs Power to fire); Repair station |
| **Economy** | Consumes resources (often Flux) → the factory gets stronger for the rest of this battle | Overclocker (sources faster); Refit bay (later units spawn stronger); Reactor (becomes a new source once fed enough) |
| **Core** | The party's health. Fixed position (CB-3e). | — |

- **CB-9a** **Conduits** (CB-3g, CB-3h) are not buildings: players draw
  them between buildings at no cost and in any quantity.
  - A conduit **occupies the cells it runs through**. No building can stand
    on a conduit cell, and conduits must go around natural features.
  - Two conduits **cannot share or cross a cell**. To cross, split, or join
    them the party needs a route building (see table), which must be owned
    like any other building.
  - Conduits **cannot be targeted** by enemies, and **units walk over
    them** [DECIDED]. A conduit never works as a wall.
  - **When a building connected to a conduit is destroyed, the conduit is
    destroyed with it, up to the next building along it** [DECIDED]. Each
    stretch of conduit therefore lives and dies with the buildings at its
    ends: enemies cut a network by killing buildings, never by attacking
    conduit directly. Junctions (splitters, mergers, crossovers) take every
    stretch attached to them when they fall, which makes them worth
    protecting.
  - **Route buildings can be destroyed** like any other building [DECIDED].
  - Like all battle damage, destroyed conduits and buildings are restored
    for the next battle (CB-11).
- **CB-9c [DECIDED]** **Conduit networks cannot loop.** Resources flow one
  way, from sources toward consumers, and can never return to a building
  they have already passed through. The editor refuses a connection that
  would close a loop and shows why.
- **CB-9b** A building's **rotation** sets which sides take resources in and
  send it out, and for defenses which way they face.
- **CB-10** Time advances in fixed **ticks**. Resources move one cell per
  tick along the conduits the players lay out, so longer conduits mean a
  longer delay. A resource with nowhere to go is
  lost; a building nothing feeds does nothing. Routes must go around
  natural features, which is half of the layout puzzle.
- **CB-11** **Every battle starts cold.** All battle state resets at the
  start of each battle: stored resources, economy upgrades, units, damage. What
  persists is the layout and the buildings' permanent tiers. Buildings
  destroyed in a battle are back for the next one.
- **CB-12** **Overload**: late in a battle, both sides' units and damage
  escalate, so that two fortified sides cannot stall forever.

## Units

- **CB-13** Unit producers spawn units when they have received enough
  resources. More input means more or stronger units, so unit output follows
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
- **CB-16 [DECIDED]** **Units fight units.** Opposing units that meet engage
  each other, so a front line forms between the bases and moves with the
  balance of production.
- **CB-17** A side loses when its Core is destroyed.

## Defense and terrain

- **CB-18** **Walls** block movement and have health. **Turrets** kill enemy
  units in range once those units are on the party's side of the front edge
  (CB-3j), and need Power. A turret's range never reaches across the front
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

- **CB-21** Resources sent to one family are resources not sent to another. Three
  broad strategies beat each other in a circle, and parties will mix them:
  - **Rush** — unit production from the first second; beats a factory that
    is still ramping.
  - **Fortify and ramp** — defenses first, economy behind them, an
    overwhelming army late; beats a rush that cannot break through.
  - **Siege** — steady pressure with units that dismantle defenses and
    infrastructure before the ramp pays off.
- **CB-22** The party can **re-plan before each battle** (the shop step, RS-5f):
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
- **CB-25 [DECIDED]** **The board never expands.** It starts fairly large and
  stays that size for the whole run. Running out of room is intended to be
  one of the constraints on long endgame play.
- **CB-26** Buildings are bought with gold in shops between battles, or won
  as rewards, and go into the owning player's stash. Placing, moving, and
  rotating them costs nothing; gold plays no part in building or in battle
  (CB-3i). There are **no building tags or tag bonuses for now** [DECIDED]; to be
  reconsidered once the game has been played.
- **CB-26a [DECIDED]** **Buildings have tiers, and there is no combining.**
  Owning several identical buildings never merges them. Higher-tier
  buildings come only from shops (which offer higher tiers as the run goes
  on), from rewards, and from the Workshop event, which raises one building
  by a tier. The factory layout therefore only changes when players change
  it.
- **CB-27** Moving and rotating buildings between battles is free; sources
  must stay on nodes, and the Core never moves (CB-3e). The map itself never
  changes during a run.

## Opponents

- **CB-28** **Ghosts** are other parties' boards — their map, their factory,
  their Core position — and run in the same simulation, joined to the
  party's board (CB-8).
- **CB-29 [DECIDED]** **PvE enemies and bosses are scripted threats, not
  factories**:
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
   autobattler in one. The proof of concept must cut hard: three resources,
   one level of refining, a
   handful of buildings and unit types, small maps (TA-41).
2. **Ramp versus the exponential wall** (SC-8). In-battle economy can be
   exponential; space, caps, and rising PvE pressure must contain it.
3. **Balance of the three strategies**, and of terrain luck: some maps will
   be much easier to defend than others. Generation needs fairness
   constraints, and ghosts carry their terrain with them.
4. **Run length.** Laying out a factory around terrain is slow and
   thoughtful, and nothing is timed (RS-12), so runs may be long. Resuming
   a run later has to work well.
5. **Readability** of a four-player battlefield (two 96 × 16 boards, many
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
  (CP-6): the map (terrain, nodes, features), the Core
  position, every building with tier, position and orientation, and run
  modifiers that affect combat. This is exactly what a snapshot stores
  (MM-1).
- **CB-33** If both Cores are destroyed on the same tick, a deterministic
  tiebreak applies (then the defender/ghost wins).
- **CB-34** An **opponent** is either a team state (ghost) or a threat
  profile (PvE, CB-29). Both are data and run through the same simulation
  entry point.
- **CB-35** All content (buildings, units, terrain rules, threat
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
- **CB-43** **Preview while building:** a dry run shows resource flow,
  projected production over time, and the **paths enemy units would take**
  to the Core with the current layout, from every point along the front
  edge — where they actually arrive depends on the hidden neutral zone
  (CB-8).
- **CB-44** Any past battle can be replayed from
  `(team, opponent, seed, version)`.

## Screen layout

- **CB-45 [DECIDED]** **Top/bottom orientation.** The party's board is drawn
  at the bottom of the screen with its front edge along the top; the enemy
  is above, across the neutral zone. The front edge therefore runs
  horizontally, so each extra player makes the board wider, which is the
  direction a 1080p screen has room in.
- **CB-46 [PROPOSED]** The design target is **1920×1080**. At the current
  sizes a whole solo battle fits at about 25 pixels per cell and a whole
  four-player battle at about 20.
- **CB-47 [PROPOSED]** The board is viewed through a **camera that pans and
  zooms**, from the first playable version, with presets (fit the whole
  battle, own base, front line). Interface panels are docked around the
  view — along the bottom when building, at the sides during battle —
  rather than laid out around a fixed-size board. Map size can then be
  increased later as a tuning change, not a redesign.
- **CB-47a [DECIDED]** The camera **starts at the center of the map**.
- **CB-48 [PROPOSED]** Shop and Build are two tabs of the same step
  (RS-5f), so players can buy, place, and return to the shop.

## First playable content budget

- **CB-50** Three base resources (refining and points of interest come
  after the first playable, TA-41a); ~15 buildings across the kinds; 3–4 unit types;
  lakes and cliffs; 3 PvE archetypes; 1 boss. Enough to validate the loop;
  no more.
