# 03 — Combat: The Factory and the Battlefield

Status: Draft v5.0

## Direction

- **CB-1 [DECIDED]** Combat is fully automated. Players give no input once a
  battle starts.
- **CB-2 [DECIDED]** The party's board is an **automation factory** in the
  spirit of *Factorio*, built from **buildings** the players buy and place.
  It is made of one plot per player: each player builds their own part, in
  their own plot, around their own Core (CP-25, CP-27). (This supersedes the earlier "items only, no
  units" direction; the game has moved away from the *Bazaar* /
  *Backpack Battles* model toward its own factory-and-battlefield design.)
- **CB-3 [DECIDED]** **Economy means in-battle ramp** — buildings that make
  the factory stronger the longer a battle lasts. It does not mean producing
  gold or anything else spent outside combat.
- **CB-3a [DECIDED]** **Defense buys time**: walls and similar buildings
  slow down the enemy's attack while the factory ramps up.
- **CB-3b [DECIDED]** What the party buys is a choice between **economy**
  (pays off later) and **attack or defense** (helps in the upcoming
  battles). The choice is made in the shop; battle rewards are gold (RS-6).
- **CB-3c [DECIDED]** Boards start with **randomized resource placement**
  and randomized **natural features** such as lakes and cliffs. Players must
  build around them, and can use them to **funnel enemy units**.
- **CB-3d [DECIDED]** Some buildings **produce units** that move toward the
  enemy base, fight the units they meet, break what stands in their way and
  eventually kill its Cores.
- **CB-3f [DECIDED]** The things players place are called **buildings**.
  Buildings can be **rotated**.
- **CB-3g [DECIDED]** **Conduits** — the connections that carry resources
  between buildings — are **free and unlimited**. They **take up space**
  and **cannot cross each other**, except through a building made for it
  (a splitter, a merger, or a building that lets two conduits pass at 90
  degrees). **A conduit never branches: the Splitter building is the only
  way to split one** (CB-9e). Organizing conduit paths well is meant to be
  one of the main limits on a factory and a skill the game rewards.
- **CB-3h [DECIDED]** **Conduits cannot be targeted by enemies** (otherwise
  players could spam them to delay enemy units).
- **CB-3i [DECIDED]** **Gold is not a building resource.** Gold is spent only
  at shops between battles, to purchase buildings. A player can place only
  buildings they have purchased themselves, plus their own starting kit, and placing costs nothing. Conduits
  are the one exception: unlimited, never purchased.
- **CB-3j [DECIDED]** **No long-range buildings.** Buildings never attack
  the enemy's side of the battlefield; all offence is carried by units.
  **Defensive buildings target enemy units on the party's own side and in
  the neutral zone, never on the enemy's board** (CB-18a). (The earlier
  wording, "only enemy units that have crossed onto the party's own side",
  is replaced by the owner's decision that turrets can engage units in the
  neutral zone.)
- **CB-3k [DECIDED]** There are **a few different resources — about
  three** — not one.
- **CB-3e [DECIDED]** **Each player's Core is placed by that player at the
  start of the run, in their own plot, and cannot be moved** (CP-26). All
  other buildings can be moved freely between battles by their owner.
  (Replaces "the Core's position is chosen by the team".)

Everything below is [PROPOSED] detail unless marked otherwise.

## The map

- **CB-4** At the start of a run the party's board is generated from a seed:
  a grid of terrain with resource nodes and natural features. The whole
  map is visible from the start, each plot is buildable by its player from
  the start, and it is **fairly large**
  [DECIDED] — early on a player has far more room than buildings. Starting
  proposal for size: one plot is about 24 cells wide × 16 deep, and plots
  join side by side, so a four-player board is 96 × 16 (CP-5). Sizes are
  placeholders for the prototype to tune.
- **CB-5** **Resource nodes** are cells where a source building can be
  built. Sources can only be placed on nodes, so node positions shape the
  whole factory. Each node yields one of the resources (CB-5a). A node
  belongs to the plot it is in (CP-14), and every plot has the same number
  of nodes (SC-11), so every player's supply has the same ceiling.
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
  - A destroyed refinery cuts everything downstream of it (CB-9a), which is
    what makes a breach through a factory costly.
- **CB-5c** Where the rare nodes are, and how far they sit from good
  defensive ground and from the player's Core, is the main way plots differ
  in character.
- **CB-6** **Natural features** are cells that cannot be built on and that
  block ground movement:
  - **Lakes** — impassable; routes and units go around.
  - **Cliffs** — impassable lines; create chokepoints.
  - Possible later: rough ground (slows units), high ground (range bonus),
    features that block building but not movement or the reverse.
- **CB-7** Every board has a **front edge** (facing the enemy) and a back
  edge. Each player places their own Core once, before the first battle,
  with the whole map visible (CB-3e, CP-26). A Core's footprint must lie
  wholly inside its player's plot; apart from that the legal positions are
  the same as before (buildable ground, not on a resource node, in the back
  half of the plot). Deep and sheltered is safer; forward and central
  shortens the player's own supply lines. Generation guarantees that every
  plot has at least one legal Core position and at least one walkable path
  from the front edge to every legal Core position.
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
  - Guard strength scales with the round so points stay worth fighting for
    at any depth.
- **CB-8a [PROPOSED]** Details of the neutral zone:
  - It is generated from the battle seed, so a battle remains reproducible
    (CB-30).
  - Nothing can be built in it. The only buildings that act in it are
    turrets, which can shoot enemy units there (CB-3j, CB-18a); otherwise
    only units fight there.
  - It is as wide as the front edges and only a few cells deep (starting
    proposal: 6–8, enough to hold a point of interest and its guards).
  - Generation guarantees open paths across it, and that its features can
    shift where units arrive along a front edge but cannot seal part of an
    edge off entirely.
  - PvE battles have one too, between the party's board and the stronghold.
- **CB-8b [DECIDED]** Both sides of a battle have the same party size and
  therefore the same front width and the same number of plots. The
  opponent's board is rotated to face the party's, so **the plots face each
  other one to one**: each plot has exactly one enemy plot directly
  opposite. With the plots of each side counted from that side's own left,
  plot `p` faces the enemy's plot `N - 1 - p`, where `N` is the party size.
  The player of the plot opposite is a player's **opposing player**. This
  holds for ghosts and for PvE strongholds alike.

## The factory

- **CB-9** Buildings have a **footprint**, a **tier**, **health**,
  and a **kind**:

| Kind | Role | Examples |
|------|------|----------|
| **Source** (collector) | Built on a resource node; produces that node's resource at a flow rate set by its tier | Extractor |
| **Route** | Splits, joins, or crosses conduits | Splitter (one in, several out); Merger (several in, one out); Crossover (two conduits pass at 90°) |
| **Refinery** | Turns one resource (common) or two (rare) into a refined resource | Smelter (Ore → Alloy) |
| **Modifier** | Changes the flow passing through | Booster (more per tick); Buffer (stores, then releases a burst) |
| **Unit producer** | Consumes resources → spawns units | Barracks (cheap swarm); Foundry (slow, heavy unit); Siege works (anti-building) |
| **Defense** | Blocks or kills enemy units | Wall; Gate; Turret (needs Power to fire); Repair station |
| **Economy** | Consumes resources (often Flux) → the factory gets stronger for the rest of this battle | Overclocker (sources faster, up to a low cap, SC-12); Refit bay (later units spawn stronger); Reactor (becomes a new source once fed enough) |
| **Core** | One per player: that player's health. Fixed position (CB-3e). Needs no resources. | — |

- **CB-9a** **Conduits** (CB-3g, CB-3h) are not buildings: players draw
  them between buildings at no cost and in any quantity.
  - A conduit **belongs to the player who drew it** [DECIDED]. It connects
    two of that player's own buildings and every cell of it lies in that
    player's plot (CP-27, CP-28). The one exception is a conduit drawn to
    the plot border to form a border link (CB-9d).
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
- **CB-9d [DECIDED]** **Border links.** Two players whose plots share a
  border can join their factories there.
  - A **border spot** is one row of the border line between two neighbouring
    plots. It lies on the line itself, not in either plot.
  - Each player draws a **half**: a conduit of their own, in their own plot,
    from one of their own buildings to a border spot. A half that starts at
    an output of the building is a **sending half**; one that ends at an
    input of the building is a **receiving half**.
  - **Joining.** When the two neighbours each have a half at the same border
    spot, one sending and one receiving, the two halves are one **link**. A
    link behaves exactly like a single conduit from the sending building to
    the receiving building: same speed, same one-resource rule (CB-5b), same
    no-loop rule (CB-9c), same back-up behaviour.
  - A half with no partner, or two halves of the same kind at one spot, is
    **open**: it carries nothing and loses nothing. An open sending half is
    a connected output that never accepts an item, like a conduit that is
    already full. A Splitter treats it like any backed-up path, so its share
    goes to the Splitter's other paths (CB-9e); if nothing else accepts, the
    items are held and the line backs up to the collector, which pauses. An
    open half is never a dead end: nothing sent towards it is lost.
  - **Either direction.** Which way a link carries is set by which player
    drew the sending half. Either neighbour can be the sender, and two
    neighbours can have links in both directions at different spots.
  - **Removing.** Either player can erase their own half at any time during
    building, and moving or returning the building it is attached to removes
    it as for any conduit. The other player's half stays where it is,
    unjoined.
  - **Only neighbours.** A half can only reach a border of its owner's own
    plot, so a link always joins two plots that share a border. Resources
    reach a plot further away only if the player in between passes them on
    through a route building of their own.
  - **Refusals.** A change that would make a link carry two different
    resources, feed a building the wrong resource, or close a loop — in
    either plot — is refused and the reason shown, as for any conduit.
  - **In battle.** A link is one stretch of conduit: when the building at
    either end is destroyed, the whole link is destroyed with it (CB-9a). A
    destroyed Core does not affect links (CB-17a).
  - One border spot holds at most one link. The number of links is
    otherwise unlimited.
- **CB-9e [DECIDED]** **Splitting.** The Splitter is the only way to divide
  a conduit's flow; conduits do not branch, and a collector has a single
  output.
  - **Even split.** A Splitter passes items on one at a time, to its outputs
    in turn, clockwise. While every output accepts, each gets the same
    number of items, give or take one.
  - **Back-up.** An output **backs up** when what it leads to cannot take
    another item: the building at the end has a full store (CB-10b) and the
    conduit to it is full. A backed-up output is skipped, and the item goes
    to the next output in turn that accepts. So a path that does not need
    its full share gets what it needs and the remainder goes to the other
    paths.
  - **Everything full.** When no output accepts, the Splitter holds the item
    and the conduit behind it backs up, up to the collector, which pauses.
    Nothing is lost.
  - There is no division and no fraction anywhere: resources are whole
    items, and "the remainder" is simply the next item in turn. The exact
    order is in the rules reference ("One tick: `stepFlow`", step 2). A
    Splitter needs no resources itself.
- **CB-9c [DECIDED]** **Conduit networks cannot loop.** Resources flow one
  way, from sources toward consumers, and can never return to a building
  they have already passed through. The editor refuses a connection that
  would close a loop and shows why.
- **CB-9b** A building's **rotation** sets which sides take resources in and
  send it out, and for defenses which way they face.
- **CB-10** Time advances in fixed **ticks**. A **collector** (source)
  produces one item of its node's resource every so many ticks; the number
  is set by its **tier**, so a collector has a fixed **flow rate** (items
  per second) that a higher tier raises [DECIDED]. Resources move one cell per
  tick along the conduits the players lay out, so longer conduits mean a
  longer delay. A resource sent down a conduit that leads nowhere is
  lost; a building nothing feeds does nothing. Routes must go around
  natural features, which is half of the layout puzzle.
- **CB-10a [DECIDED]** **Need and top speed.** Every building that consumes
  resources has, for each tier, a **cost per production** (resources for
  one unit, one turret shot, or one upgrade step) and a **minimum time
  between productions**. A fully fed building therefore has a top speed
  (one production per minimum time) and a stated **need**: cost divided by
  minimum time, shown to players as items per second ("needs 0.75/s"). More
  supply than its need does not make a building faster. Stronger buildings
  may have a higher need. A turret's need applies only while it is firing.
- **CB-10b [DECIDED]** **Store.** A building holds a small store: the
  resources for one production, plus a few items waiting at its inputs.
  When the store is full the building accepts nothing more, and the conduit
  feeding it backs up (CB-9e). Store sizes are tuning numbers, to be set in
  the rebalance. Nothing in a store carries over to the next battle
  (CB-11).
- **CB-10c [DECIDED]** **Which buildings need resources.** Only buildings
  that do something: unit producers, turrets, and economy buildings. Walls,
  gates, Splitters and other route buildings, and the Core need nothing.
  There is no cap on the number of walls for now. Refineries and modifiers
  (CB-9), which are not in the content yet, consume resources by their
  nature: when they are added they get a cost and a minimum time between
  productions like any consumer (CB-10a).
- **CB-10d [DECIDED]** **Under-supplied buildings wait.** A building that
  gets less than its need collects what arrives until it has the full cost
  of one production, then produces at full strength. It is slower, never
  weaker, and never switched off.
- **CB-10e [PROPOSED]** The build screen shows, for every collector, its
  flow rate, and for every consumer, its need and what the dry run says it
  receives ("needs 0.75/s, gets 0.50/s"); shop offers show the need of the
  building on offer (CB-43).
- **CB-11** **Every battle starts cold.** All battle state resets at the
  start of each battle: stored resources, economy upgrades, units, damage. What
  persists is the layout and the buildings' permanent tiers. Buildings
  destroyed in a battle are back for the next one.
- **CB-12** **Overload**: late in a battle, both sides' units and damage
  escalate, so that two fortified sides cannot stall forever. Overload
  starts at 3 minutes [DECIDED].
  - **[DECIDED] Overload takes its full amount from every living Core.** At
    every beat (from tick 1800, 3 minutes, at every 100th tick) each Core
    still standing, on both sides, takes the same flat amount: 5, then 10,
    15, ... health. The amount is not shared out between a side's Cores. A
    Core of 500 health therefore dies from the decay alone at tick 3100
    (3 minutes 10 seconds; 14 beats take 525), whatever the party size, and
    a side whose Cores all have 500 health has lost all of them by then at
    the latest.
  - **[DECIDED] In PvE the Overload decay is a deadline** (CB-29, #43; decided
    in #75: turtling is a justified strategy). The decay applies equally to
    every Core, so a Core with less health falls sooner. A stronghold Core
    with less than 500 health falls to the decay before the party's Cores
    do; if all of the stronghold's Cores are smaller, the party wins by
    outlasting it, which is a legitimate way to win. Against a stronghold
    with larger Cores the party must destroy them before tick 3100, before
    its own Cores fall. Screens should compute the deadline for every Core
    and show which side loses its last Core first. (The sample of
    stronghold Core health measured before this design, median 313.5 for one
    player, no longer applies: the stronghold's health is now split between
    its Cores and all numbers are reset in the rebalance.)

## Units

- **CB-13** Unit producers spawn a unit when they have collected its cost
  and their minimum time between productions has passed (CB-10a). More
  input means more units only up to the building's top speed; beyond that,
  more output takes more or better buildings, and the supply to run them.
  Stronger units come from economy buildings (the factory's ramp).
- **CB-14** **Movement.** Units are **circles** with a position finer than a
  cell and a radius that depends on their type (stronger units can be
  larger). Units collide **softly**: two units, friend or foe, that overlap
  are pushed apart over the next ticks and may overlap a little for a while
  (a crowd squeezes through a choke instead of jamming), whereas a unit never
  overlaps terrain, a building or a Core, so a unit cannot pass a gap narrower than
  its collision diameter (about 65 percent of its drawn size). Fighting units
  hold their place against enemies, and waiting allies give way to units that
  are moving. Units walk over open ground: around natural features,
  around buildings, across the front edge into the enemy board, and over
  conduits. Routing is grid-based and deterministic (CB-30): the cheapest
  path of cells towards the unit's target Core (CB-15b; eight directions, a diagonal step costing
  1.4 times a straight one, and no cutting corners through solid cells) says
  in which direction a unit heads, and where paths tie the unit goes
  **forward**, not sideways, so an army advances on a wide front instead of
  sliding along its row to its target Core's column and marching in single file. A
  unit steers by the direction of its step and keeps its sideways position
  within the cell and the corridor; it does not aim at cell centres. A mover
  whose way is blocked by an ally that holds its place (one that is fighting)
  steps around it, to the side away from the ally; walls correct any drift.
  The circles decide how far a unit gets (it slides along walls and other
  units and waits when it is boxed in). The field is static: it does not
  know where the crowds are (routing around crowds is a later change,
  issue #86). The exact rules are in the rules reference ("Unit geometry",
  the battle tick and "Goals and movement fields").
- **CB-15** **Targeting.** Every unit heads for one enemy Core, its **target
  Core** (CB-15b), by the shortest open path and attacks what blocks it. No
  unit type prefers buildings: destroying a source or a junction cripples
  the enemy's ramp for the rest of the battle, but an enemy building that
  is not a Core is only attacked when it blocks the way (a breach), never
  because a unit chose it. An enemy Core within reach is always attacked
  (CB-15c). Conduits themselves are never
  targets (CB-3h). (Issue #66 removed the earlier per-type preferences.)
- **CB-15a [DECIDED]** **A unit's owner** is the owner of the building that
  produced it. A PvE wave unit, which no building produced, counts as owned
  by the stronghold player whose plot it enters the battlefield from.
- **CB-15b [DECIDED]** **Which Core a unit heads for.**
  1. **The opposite Core first.** A unit's target is the Core of its
     owner's opposing player: the player whose plot is directly opposite
     its owner's plot (CB-8b). For a PvE wave unit this is the Core of the
     party plot it enters.
  2. **Then the nearest.** Once that Core is destroyed, the unit's target is
     the nearest enemy Core still standing, measured by walking distance
     from where the unit is at that moment. If no open path leads to a
     Core, its distance is the cost of the cheapest route through enemy
     buildings (CB-20), and any Core with an open path counts as nearer
     than one without; the exact order is in the rules reference (PP-11). A unit produced after its
     opposite Core has fallen picks the nearest from where it appears.
  3. **It keeps its target.** A unit changes target only when its target
     Core is destroyed. It then picks again by rule 2.
  4. **Ties.** If two Cores are equally near, the unit takes the one whose
     plot is closer to the plot directly opposite its owner's; if that is
     still a tie, the one further to the unit's own left (the lower column
     as that side counts columns). Because every part of the rule is
     stated from the unit's own side, a mirrored battle stays exactly
     symmetric.
  5. With no enemy Core standing the battle is over (CB-17).
  Units still fight any enemy unit they meet, whoever owns it (CB-16).
- **CB-15c [DECIDED]** **A unit attacks whatever enemy is in range,
  including enemy Cores that are not its target.** Where a unit walks does
  not change: it heads for its target Core (CB-15b). What it attacks
  follows the order it has today (CB-16): an enemy unit in reach first;
  otherwise an enemy Core within reach, and a non-target Core stands exactly
  where the target Core stands in that order. While an enemy Core is within
  reach the unit stands and attacks it, as it does its target Core, and it
  does not walk towards a Core it has not yet reached. When that Core is
  destroyed the unit resumes its walk to its own target, which has not
  changed. A unit may therefore stay at a non-target Core on its way until
  it falls. Other enemy buildings are still attacked only when they block
  the way (CB-20). (Owner decision 18 on issue #124. Not yet implemented,
  issue #133.)
- **CB-16 [DECIDED]** **Units fight units.** Opposing units that meet engage
  each other, so a front line forms between the bases and moves with the
  balance of production. A melee unit attacks when the gap between its circle
  and its target (a unit's circle, or the nearest point of a building) is
  within its reach; a unit with an enemy unit in sight within three cells
  walks towards it instead of along its route (stepping around an ally that
  already fights the same target, so followers reach the enemy too). Because
  units occupy space, only so many can reach a target at once: bodies form
  the front line. Two enemies that both fight share the push that separates
  them (issue #103).
- **CB-16b [DECIDED]** **Ranged units.** A unit is melee or ranged. A ranged
  unit attacks from a distance (its reach is its range, edge to edge) and
  stops to fire while it has a target in range. Placeholder: the Archer, from
  the Range building. Only ranged attackers can hit flying units: ranged
  ground units, flying units (always ranged) and turrets. A melee unit whose
  only remaining enemies are flyers ignores them and goes on to its goal.
- **CB-16c [DECIDED]** **Flying units.** A flying unit is always ranged, can
  attack air and ground targets, flies straight at its target Core over
  walls, lakes and cliffs, and collides only with other flying units (by a
  much smaller collision circle than its drawn size). Walls and gates do
  nothing against it; turrets and ranged units are the defense. Placeholder:
  the Drone, from the Hangar building. A flyer picks its next Core by
  straight-line distance, and a Hangar walled in on every side still sends
  its drones out (it is never "sealed"). (Flyers in PvE waves are not done
  yet.)
- **CB-16a** **Production and room.** A unit appears next to the building that
  made it, at the nearest free spot. When there is none the finished unit is
  held, production stops drawing resources and the factory backs up like any
  other full consumer. Scheduled PvE waves that do not fit enter on later
  ticks.
- **CB-17 [DECIDED]** **A side loses a battle when all of its Cores are
  destroyed.** Losing one Core, or all but one, does not end the battle.
  (Replaces "a side loses when its Core is destroyed".)
- **CB-17a [DECIDED]** **The Core is only health.** When a player's Core is
  destroyed, nothing else of theirs changes for the rest of the battle:
  their buildings keep producing and shooting, their collectors keep
  running, and their border links keep carrying resources to and from
  their partners. Units already on the field carry on. The ground the Core
  stood on becomes open. (Fallback to try if battles drag in playtests:
  that player's collectors stop.)

## Defense and terrain

- **CB-18** **Walls** block movement and have health. **Turrets** kill enemy
  units in range (CB-18a) and need Power. A turret shoots any enemy unit in
  range, in its owner's plot or a teammate's. **Gates** block enemies but
  let all of the party's units through, whoever owns the gate or the unit.
- **CB-18a [DECIDED]** **Where a turret can shoot.** A turret can target an
  enemy unit, flying or not, that is on the party's own board or in the
  neutral zone, and is in range. It can never target a unit on the enemy's
  board, however close to the far edge of the zone the turret's range
  reaches. (Owner decision; replaces "a turret's range never reaches across the front
  edge". Implemented with PP-13: turrets engage units in the neutral zone.
  See the rules reference.)
- **CB-19** **Funnelling.** Lakes, cliffs, and walls together determine the
  paths enemy units can take. A player who leaves one long, turret-lined
  approach to their Core gets far more value from each defense than one with
  an open field. Reading the map and shaping the approach is a core skill.
- **CB-20** **No sealed bases.** If no open path to a unit's target Core
  exists, units attack the weakest barrier on the shortest route. Walls delay; they never
  make a base unreachable.

## Strategies and choices

- **CB-21** Resources sent to one family are resources not sent to another. Three
  broad strategies beat each other in a circle, and parties will mix them:
  - **Rush** — unit production from the first second; beats a factory that
    is still ramping.
  - **Fortify and ramp** — defenses first, economy behind them, an
    overwhelming army late; beats a rush that cannot break through.
  - **Siege** — steady pressure with strong units that dismantle the
    defenses in their way before the ramp pays off.
- **CB-22** The party can **re-plan before each battle** (the shop step, RS-5f):
  each player can move everything of theirs but their Core, inside their own
  plot, and border links can be redrawn, so the factories can be re-routed
  for a PvE threat whose style is shown in advance, or hedged for the
  unknown PvP opponent.
- **CB-23** Shop purchases follow the same split (CB-3b). Economy buildings
  are weak in the next battle and grow in value as the run goes on.

## Space and building

- **CB-24 [DECIDED]** **Resources are the main limiter; space is the
  second.** A plot has a fixed number of resource nodes, a collector's flow
  rate is fixed by its tier, and every building that does something has a
  need (CB-10a). A player can therefore keep running only as many buildings
  as their collectors, plus what partners send over border links, can
  supply; buying more than that leaves buildings waiting (CB-10d). This is
  what stops a player from winning by placing a great number of buildings.
  Space still matters: conduits, defenses, and economy buildings compete
  for ground, and because conduits cannot cross (CB-3g) a tidy layout fits
  far more factory into the same plot than a tangled one; buildings also
  shape where units can walk. (Replaces "space is the limiter".)
- **CB-24a [DECIDED]** **Economy buildings help only their owner.** A
  player's Overclocker, unit-strength building and similar affect only that
  player's collectors and units, and the cap applies per player (SC-12). To
  help a partner, a player sends resources over a border link (CP-29,
  CP-30). (Owner decision 19 on issue #124. Not yet implemented, issue
  #137.)
- **CB-25 [DECIDED]** **The board never expands.** It starts fairly large and
  stays that size for the whole run. Running out of room is intended to be
  one of the constraints on long endgame play.
- **CB-26** Buildings are bought with gold in shops between battles and go into the owning player's stash. Placing, moving, and
  rotating them costs nothing; gold plays no part in building or in battle
  (CB-3i). Only the owner can place, move, rotate, return or sell a
  building, and only inside their own plot (CP-27, CP-28). 
- **CB-26b [DECIDED for now]** There are no building tags or tag bonuses; to
  be reconsidered once the game has been played.
- **CB-26a [DECIDED]** **Buildings have tiers, and there is no combining.**
  Owning several identical buildings never merges them. Higher-tier
  buildings come from shops (which offer higher tiers as the run goes on),
  and from the Workshop event, which raises one
  building by a tier. The factory layout therefore only changes when
  players change it.
- **CB-26c [DECIDED for now]** There are **three tiers**. Nothing can raise
  a building above tier 3. The cap may change later.
- **CB-26d [PROPOSED]** What a tier is: the same building with better
  numbers (for example health, rate, or output), set per tier in content
  data. Every building exists at all three tiers and keeps its footprint
  and inputs at each. Tiers apply to buildings only.
- **CB-27** Moving and rotating buildings between battles is free; sources
  must stay on nodes, buildings stay in their owner's plot, and a Core
  never moves (CB-3e). The map itself never
  changes during a run.

## Opponents

- **CB-28** **Ghosts** are other parties' boards — their map, their
  factories, their Cores — and run in the same simulation, joined to the
  party's board (CB-8), their plots facing the party's one to one (CB-8b).
- **CB-29 [DECIDED]** **PvE enemies and bosses are scripted threats, not
  factories**:
  a **wave schedule** (which units arrive at the party's front edge, and
  when) plus a **stronghold** for the party's units to attack (Cores with
  health and pre-placed defenses on a small authored map). Both are scaled
  by the budget curve (SC-1) and party size.
  - **One Core per player, always** [DECIDED]: a stronghold has as many
    plots as the party has players and one Core in each, bosses included.
  - **Health split evenly** [DECIDED]: the stronghold's total Core health is
    divided evenly between its Cores (whole numbers; any remainder goes one
    point each to the lowest-numbered plots).
  - **Waves head for the Core of the plot they enter** [DECIDED]: a wave
    unit's first target is the Core of the party plot it enters, then the
    nearest remaining Core (CB-15a, CB-15b).
  - **PvE and PvP follow the same rules** [DECIDED]: the party wins when all
    of the stronghold's Cores are destroyed and loses when all of its own
    are; Overload, ties and the time limit work as in any battle.
  - The stronghold's defenses are laid out plot by plot, around each plot's
    Core.

  Archetypes test the three strategies:
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
   exponential; scarce supply, caps, and rising PvE pressure must contain it.

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
   With several Cores a side needs one set of routes per enemy Core.
7. **Scarcity that is not fun.** If supply binds too hard, players own
   buildings they cannot run and shops feel pointless; too loosely, and
   scarcity limits nothing. The need of each building has to be easy to
   read (CB-10e), and the numbers come from the rebalance (SC-13).
8. **Battle length with several Cores** (CP-24): snowballing after the first
   Core falls, or every battle running to the Overload deadline.

## Structural requirements

- **CB-30 [PROPOSED → effectively required]** Combat is **deterministic**:
  the outcome is a pure function of `(team, opponent, seed, installed
  version)` (TA-8).
  Integer math, fixed tick order, deterministic pathfinding and
  tie-breaking, no wall-clock time, no unordered iteration.
- **CB-31** Combat runs in a **headless simulation** that produces an
  **event log**. Presentation renders playback from the log and never
  decides outcomes. The same simulation runs in the host's game
  (authoritative, TA-6), in tests, and in balance tools.
- **CB-32** A party is fully described by a serializable **team state**
  (CP-6): the map (terrain, nodes, features), one Core
  position per player, every building with owner, tier, position and
  orientation, every conduit with its owner (border links included), and run
  modifiers that affect combat. This is exactly what a snapshot stores
  (MM-1).
- **CB-33 [DECIDED]** **Ties and the time limit.** A battle that is not
  decided by one side losing all of its Cores first is decided by this
  ladder; the first step that differs wins:
  1. **More Cores still standing.**
  2. **The larger share of total Core health remaining**: the health left
     on all of a side's Cores together, as a fraction of the maximum health
     of all of its Cores together (a destroyed Core counts as zero left).
  3. **Less overkill**: the damage beyond zero taken by the side's Cores
     that fell on the final tick, added up over those Cores.
  4. **More damage dealt to the enemy's buildings**, Cores included.
  5. **More enemy units killed.**
  6. **The attacker** (the party) wins.

  The ladder applies in two situations. **Both sides lose their last Core
  on the same tick**: steps 1 and 2 are then equal (no Cores, no health),
  so the overkill of step 3 is the first that can differ. **The time
  limit**: both sides still have a Core; steps 1 and 2 usually decide.
  "The attacker" is unchanged: it is always the party, never the ghost or
  the PvE opponent, so the defender wins no tie (#33). Overload starts at
  3 minutes (CB-12). (Replaces the single-Core wording; steps 1 and 2 are
  new, steps 3 to 6 are the earlier ladder.)
- **CB-34** An **opponent** is either a team state (ghost) or a threat
  profile (PvE, CB-29). Both are data and run through the same simulation
  entry point.
- **CB-35** All content (buildings, units, terrain rules, threat
  profiles, strongholds) is **data-driven**: versioned data files validated
  against schemas.
- **CB-36** Performance budget, set in the first simulation milestone:
  maximum units alive per side, maximum battle length in ticks, a
  battles-per-second target for the balance harness at four-plot size, and
  the **time to simulate one full battle before playback starts** (target:
  not noticeable for a solo battle, and about a second at most for a
  four-player battle on modest hardware).
- **CB-37** **What players watch is the recorded battle, not a second run of
  it.** Playback draws the event log and applies no rules, so what is shown
  cannot diverge from the result. Movement between logged events may be
  smoothed for display only.
- **CB-38** If the pre-playback wait or the size of the event log sent to
  other players proves too large, two fallbacks exist, to be chosen on
  measurements: start playback while the simulation is still running ahead
  of it; or send each player the battle's inputs and have every game
  simulate it, comparing a hash of the result with the host's and falling
  back to the host's log on any mismatch. Neither is part of the design
  unless adopted: the first would weaken the guarantee that players can
  finish watching if the host leaves (TA-11), and the second would mean
  guests run the simulation, which CB-37, TA-7, and TA-14 currently rule
  out. Adopting either means revising those.

## Playback and understanding the factory

- **CB-40** All party members watch the same battle in sync, each free to
  pan and zoom across both boards. Speed controls (1×, 2×, 4×, skip) apply when
  all connected players agree, or automatically in solo.
- **CB-41** A ghost's board is fully visible during the battle. A PvE
  threat's archetype and threat level are shown before the party commits
  (RS-3b); its stronghold is seen in the battle.
- **CB-42** A post-battle summary shows army strength over time for both
  sides with notable moments marked, what each building did, where the
  party's defenses were breached, and when each Core fell.
- **CB-43** **Preview while building:** a dry run shows resource flow
  (every collector's rate, every consumer's need and what it receives,
  CB-10e, and which border links are joined and what they carry),
  projected production over time, and the **paths enemy units would take**
  with the current layout, from every point along the front edge to the
  Core of the plot they enter (CB-15b) — where they actually arrive depends
  on the hidden neutral zone (CB-8).
- **CB-44** Any past battle can be replayed from
  `(team, opponent, seed)` on the same installed version. After a game
  update, an already-fought battle is shown from its saved result and event
  log, not re-simulated (CP-23a).

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
  zooms**, from the first playable version, with presets (center, own base —
  the player's own plot and Core — and fit the whole battle). Interface panels are docked around the
  view — along the bottom when building; at the sides during battle
  where there is room, and over the view otherwise —
  rather than laid out around a fixed-size board. Map size can then be
  increased later as a tuning change, not a redesign.
- **CB-47a [DECIDED]** The camera **starts at the center of the map**.
  Proposed reading: when building, the center of the player's own plot; in
  a battle, the center of the whole battlefield. (The building half of this
  reading changed with the per-player design, issue #124: it was "the
  center of the party's board". A player now builds only in their own plot
  (CP-27), so that is where their camera starts. Solo is unchanged, since
  the one plot is the whole board. The decision itself, "starts at the
  center", is not changed; this reading stays [PROPOSED] and is for the
  owner to accept or reverse.)
- **CB-48 [PROPOSED]** Shop and Build are two tabs of the same step
  (RS-5f), so players can buy, place, and return to the shop.

## First playable content budget

- **CB-50** Three base resources (refining and points of interest come
  after the first playable, TA-41a); ~15 buildings across the kinds; 3–4 unit types;
  lakes and cliffs; 3 PvE archetypes; 1 boss. Enough to validate the loop;
  no more.
