# 03 — Combat: The Factory and the Battlefield

Status: Draft v5.7

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
  (a Splitter, a Merger, or a Crossover, which lets two conduits pass at 90
  degrees). **A conduit never branches: the Splitter building is the only
  way to split one** (CB-9e). Organizing conduit paths well is meant to be
  one of the main limits on a factory and a skill the game rewards.
- **CB-3h [DECIDED]** **Conduits cannot be targeted by enemies** (otherwise
  players could spam them to delay enemy units).
- **CB-3i [DECIDED]** **Gold is not a building resource.** Gold is spent only
  between battles: on buildings and re-rolls at shops, and on Workshop tier
  raises at an event (EC-2). It never runs a building. A player can place only
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

- **CB-4 [DECIDED]** **One plot per player, side by side, the same size at
  any party size** (issue #392). At the start of a run the party's board is
  generated from a seed: a grid of terrain with resource nodes and natural
  features. The whole map is visible from the start, and each plot is
  buildable by its player from the start.
  - **Size.** The shape is decided. The size stays **24 × 16** (`plotWidth`
    × `plotDepth` in `content/mapgen.json`), so a four-player board is
    96 × 16 (CP-5). It is tuned only from playtest data on when space runs
    out.
  - **Why this size** (design pillar 6, `00-vision.md`): the factory grows in
    complexity until placement becomes a tough choice. A plot is **fairly
    large** [DECIDED], so early on a player has far more room than
    buildings; the size is tuned so that by the mid-run space runs out and
    the player must choose what goes where and what to leave out.
  - (The earlier text called 24 × 16 a placeholder for the prototype to tune
    freely. [SUPERSEDED by the decision above.])
- **CB-5** **Resource nodes** are cells where a source building can be
  built. Sources can only be placed on nodes, so node positions shape the
  whole factory. Each node yields one of the resources (CB-5a). A node
  belongs to the plot it is in (CP-14), and every plot starts with the same
  number of nodes (SC-11; `nodesPerPlot` in `content/mapgen.json`: 3 of each
  common resource and 1 of the rare one), so every player's supply starts
  with the same ceiling. The Rich vein event can later add a node to a
  player's plot, up to `maxAddedNodesPerPlot` (RS-4i4).
- **CB-5a [DECIDED for now]** **Three resources** (CB-3k): **Ore, Power,
  and Flux**. The names are working names and must be **renameable in one
  configuration file** (TA-27a). The roles:

  | Resource | Nodes | Used by (the `inputs` in `content/buildings.json`) |
  |----------|-------|-----------------|
  | **Ore** | Common | Most units (Barracks, Range, Foundry), the Armory, the Composite Refinery |
  | **Power** | Common | Turrets firing, drones (Hangar), the Foundry, both refineries |
  | **Flux** | Rare | The Overclocker and the Aether Refinery |

  (The earlier roles, "Ore for bodies: units, walls, repairs" and "Power for
  production speed", do not match the content: walls need nothing (CB-10c)
  and there is no repair building.)

  **Most buildings take a single resource type. Some rarer buildings
  require inputs of more than one type** [DECIDED] (e.g. a heavy-unit
  foundry needing Ore and Power). **Some rarer buildings require refined resources, and are stronger than
  buildings that run on base resources** [DECIDED] (CB-5d).
- **CB-5b [DECIDED]** **A conduit carries one resource type**, set by what
  feeds it. Mergers join conduits of the same type only. A multi-input
  building therefore needs a separate conduit for each resource to reach
  it, which — with no crossing (CB-3g) — is where layout skill is tested
  hardest, and part of what makes those rarer buildings a commitment.
- **CB-5d [DECIDED]** **Refined resources** (issue #378). Refined resources
  exist, and the rarer, stronger buildings need them. Owner decisions:
  1. **Only compounds for now.** The first version has two rare, two-input
     refineries. The one-input refineries (Alloy, Surge, Essence) and the
     Ore + Flux compound come later. A compound cannot be refined further.
  2. **The payoff is both a role and efficiency.** Each refined building has
     a role no base building has, and gives roughly +25-35% more per raw
     item than a base chain (SC-13a). Refining adds no supply, it only
     concentrates it; the premium pays for the refinery's space, gold,
     delay and weakness to a breach.
  3. **Shops offer refineries and refined buildings from round 3.**
  4. **One two-input base building: the Foundry**, needing Ore and Power,
     training a heavy unit (a bruiser: medium health, high damage). It
     shares the two-input rules (CB-5e) with the refineries.
  5. **Ore + Power makes Composite, which feeds the Golem forge.** The Golem
     is a big, tanky front-line unit: huge health, flat armor that cuts
     every hit, low damage, very slow (CB-5g). An anti-building role was
     considered and rejected.
  6. **Power + Flux makes Aether, which feeds the Spire.** The Spire trains
     a ranged caster with area damage, which is fragile (CB-5h). Flux has
     one node per plot and the Overclocker also wants it, so an Aether chain
     is a real choice, and a reason to share Flux over a border link (CB-5i).

  The long-term plan is the full table below, with working names, all
  defined in the same configuration file as the base resources and
  renameable there (TA-27a). **The first version has only the two compounds
  marked "first version".**

  | Refined | Made from | Refinery | When |
  |---------|-----------|----------|------|
  | Alloy | Ore | Common | Later |
  | Surge | Power | Common | Later |
  | Essence | Flux | Common | Later |
  | Composite (`res_ab_refined`) | Ore + Power | Rare | First version |
  | Aether (`res_bc_refined`) | Power + Flux | Rare | First version |
  | *(compound)* | Ore + Flux | Rare | Later |

  - A two-input refinery needs a conduit for each input (CB-5b), so it has
    to sit where two networks can reach it without crossing, the hardest
    placement problem in the game, by design.
  - Refining is **one step deep**: refined resources are not refined
    further. This keeps factories legible while still creating real chains.
  - A refined resource is its own conduit type and colour (CB-5b), so a
    refined building needs source, conduit, refinery, conduit, building, all
    without crossing anything else. Refined buildings are stronger partly
    because they are slower to come online in a battle and harder to fit.
  - A destroyed refinery cuts everything downstream of it (CB-9a), which is
    what makes a breach through a factory costly.
  - **Content** (built; numbers in `content/buildings.json` and
    `content/units.json`, to be tuned): the Composite Refinery
    `bld_refinery_ab` (2x2, Ore + Power, makes Composite); the Aether
    Refinery `bld_refinery_bc` (2x2, Power + Flux, makes Aether); the
    Foundry `bld_foundry` (2x2, Ore + Power, trains the Heavy); the Golem
    forge `bld_golem_forge` (2x2, takes Composite, trains the Golem); the
    Spire `bld_spire` (2x2, takes Aether, trains the Caster). The shop
    offers all five from round 3 (`fromRound` in `content/economy.json`).
    The roles counter each other: casters beat swarms, the Golem's armor
    shrugs off splash, and fast melee units catch fragile casters.
- **CB-5e [PROPOSED]** **Two-input consumers.** A building that takes two
  resources (the Foundry, both refineries) has a cost per input resource
  and produces only when it holds every cost. Each input has its own conduit
  (CB-5b) and its own part of the store (CB-10b). Its need is stated per
  resource (CB-10a). The rebalance principle (SC-13a) holds: for a
  two-input building, one collector of each input resource fully feeds it.
  Implemented (issue #380, and #381 for the refineries).
- **CB-5f [PROPOSED]** **The refinery's batch and output.** A refinery
  consumes one batch of each input, and after its minimum production time
  emits refined items into its output conduit. Its output buffer is small:
  when the buffer is full (the conduit has backed up, CB-9e) the refinery
  stalls and draws no more input. Refining makes fewer items than it takes
  in, set so that a refined chain beats a base chain per raw item (SC-13a).
  Implemented (issue #381; rules reference, "Refineries").
- **CB-5g [PROPOSED]** **The Golem and armor.** Armor is a flat amount taken
  off every hit the unit takes: damage dealt is `max(1, damage - armor)`.
  The Golem has huge health, high armor, low damage and a very low speed, so
  it leads a push and soaks up fire. Many weak hits do almost nothing to it;
  a few strong hits still hurt.
  Implemented (issue #382; the Golem's `armor` is in `content/units.json`).
- **CB-5h [PROPOSED]** **The caster and area damage.** A caster is a ranged
  unit (CB-16b) with area damage: when it hits a target, other units within
  a radius of the target take a percent of the hit as well. Area damage hits
  units only, never buildings, and never friendly units. A caster is
  fragile, so it needs a front line to stand behind. Order of damage
  modifiers: `unit_strength` at spawn (CB-24a), then Overload (CB-12), then
  the splash percent, then armor (CB-5g), applied to each unit hit.
  Implemented (issue #387; the Caster's `splash` is in `content/units.json`).
- **CB-5i [PROPOSED]** **The Flux trade-off.** A plot has one Flux node, and
  both the Overclocker and the Aether refinery want Flux. Running both means
  sharing Flux with a partner over a border link (CB-9d, PP-4).
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
  half of the plot: `coreFrontClearance` in `content/mapgen.json`). Deep and sheltered is safer; forward and central
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
    Built (issue #369): the zone's `pointsOfInterest` list holds them
    (TA-41a), and the rules are in CB-8c to CB-8g.
- **CB-8c [DECIDED]** Points of interest (owner decisions, built in issue
  #369; CB-8):
  - **Aggro** [DECIDED]: units are not sent to points of interest. A unit
    goes to one only if its path takes it **near enough to "aggro"** — within
    the point's aggro range — in which case it diverts to fight there.
    Otherwise it marches past.
  - **Guards** are neutral units that hold their position at the point and
    fight any unit of either side that aggros (CB-8e).
  - **Capture** [DECIDED]: once the guards are dead, a side takes a point
    by keeping units in capture range for a while. More units capture
    faster. If both sides have units in range, there is no progress
    (CB-8f). The side then holds the point. Another side can retake it
    later, so a point can change hands during the battle. The buff applies
    while the point is held and ends with the battle.
  - **The whole side benefits** [DECIDED]: a captured point buffs every
    player of the capturing side, not only the players whose units
    captured it. This is an exception to PP-8 (CB-24a).
  - **Two buff kinds** [DECIDED] (CB-8g):
    - **Stronger new units**: units the side spawns while it holds the
      point have more health and damage (a side-wide percent).
    - **Healing near the point**: the holder's units within a few cells of
      the point slowly regain health.
    - Faster collectors and a resource trickle are not in this version.
  - **Placement** [DECIDED] (CB-8d): 0 or 1 point per plot band (one band
    of `plotWidth` columns for each facing pair of plots, CB-8b). Each band
    rolls whether it gets a point and at which column. A point is always on
    the zone's middle row.
  - **Resume** [PROPOSED]: units stop at a point while it is being
    captured, then resume their march. A unit passing a point its own side
    already holds does not divert.
  - **Consequence for building**: which points a party's units reach
    depends on where they leave the front edge and how the hidden terrain
    routes them. A party can spread its unit producers along the front to
    brush more of the zone, or concentrate them and accept missing points —
    without ever knowing in advance what is out there. A point also pulls
    units off the direct route for a while, which can cost a rush its
    timing.
  - Like the rest of the zone, points and guards are generated from the
    battle seed, hidden until the battle begins, and placed fairly: each
    band lies between one facing pair of plots, so neither side is
    favoured.
  - Guard strength scales with the round so points stay worth fighting for
    at any depth (CB-8e).
- **CB-8d [PROPOSED]** **Placing points** (issue #371). Each point is
  `{id, band, x, y, buff}`, sorted by `id`; `id` counts from 0 in band
  order.
  - A band is the columns `band * plotWidth` to `(band + 1) * plotWidth - 1`,
    between side 0's plot `band` and side 1's plot `N - 1 - band` (CB-8b).
  - A point is one cell on the **middle row**, `y = (depth - 1) / 2`. This
    needs an odd `depth`; an even one is refused. With a `depth` of 7 that
    is row 3.
  - A point does not block movement. Units walk over it.
  - In band order, each band rolls a 60% chance (`chancePercent`) to get a
    point. If it does, it tries up to `placementTries` columns, at least 2
    cells (`bandMarginCells`) in from the band's edges. A try works if the
    point's cell and its 8 neighbours are all open, so there is room for
    guards. If every try fails, the band has no point; the zone is still
    valid.
  - The buff is one weighted pick from `content/points.json`, drawn only for
    a band that got a point. At first the two kinds weigh the same.
  - Draws come from their own stream after lakes and cliffs, so lakes and
    cliffs do not change. Points derive only from the battle seed, the
    width, the content and the configuration (CB-8a).
- **CB-8e [PROPOSED]** **Guards** (issue #372). Each point starts the
  battle with guards: units of neither side (side 2, neutral).
  - **Spawning**: placed at tick 0, on the point cell and then its 8
    neighbours. Soldiers and archers only, no flyers, at most 5 per point.
    A budget per point grows 25% per round like threats (SC-1) and buys
    guards; any budget left over makes that point's guards stronger. The
    base budget gives about three soldiers and one archer in round 1.
  - **Hold**: with no enemy to fight, a guard walks back to its post and
    stops there.
  - **Fight**: a guard fights any unit of either side that comes within
    aggro range. Guards never target buildings or Cores and do not breach.
  - **Leash**: a guard more than 3 cells from its post drops its target and
    walks back. It never leaves the neutral zone.
  - **Turrets do not shoot guards.** Points are a matter for units.
  - Guards do not count in a side's unit counts or the tiebreak (PP-10) and
    never decide when a battle ends. Overload does not affect them.
- **CB-8f [PROPOSED]** **Capture** (issues #373):
  - **Diverting**: a unit of side 0 or 1 diverts to a point when it is
    within 3 cells (`pointAggroRangeCells`) of it, with a clear line of
    sight, and its side does not hold the point. Flyers divert too. Units
    are never sent; only those passing near divert. Aggro on enemy units
    still comes first.
  - **Waiting**: a diverted unit within 2 cells (`captureRadiusCells`) of
    the point stops and waits. It still attacks anything in reach.
  - **Resuming**: when its own side takes the point, a unit drops the point
    and walks on from where it stands. Nobody stays behind. A unit passing
    a point its own side holds does not divert.
  - **Progress** each tick, per point: while any guard is alive, nothing
    changes. If both sides have units in capture range, nothing changes. If
    only one side has units in range and does not hold the point, its
    progress (restarted at 0 if the other side had it) grows by the number
    of its units in range, counting at most 3 (`maxCapturersCounted`). At
    50 (`captureTicks`) it takes the point. If nobody is in range, progress
    falls by 1 per tick.
  - One unit takes 5 seconds; three units take about 1.7.
  - Events: `point_capture_started`, `point_captured`. The battle summary
    shows the final holder of each point and how long each side held it.
    This is not part of the tiebreak (PP-10).
- **CB-8g [PROPOSED]** **Buffs** (issue #374). A held point gives its side
  its buff until the point is lost or the battle ends.
  - **Stronger new units** (`unit_strength`): each held point of this kind
    adds 20% health and damage (`strengthPercent`) to units the side
    spawns, capped at 40% in total (`maxPointStrengthPercent`). It applies
    to producer units and scheduled PvE wave units alike. It adds to the
    owner's other strength bonuses and is outside the Armory cap
    (CB-24a). It is read at the moment of spawning: units already on the
    field never change.
  - **Healing** (`heal`): once a second (`healIntervalTicks`, 10), each
    unit of the holding side within 3 cells (`healRadiusCells`) of the
    point regains 2 health (`healAmount`), never above its maximum health.
    A unit near several of its side's healing points heals once per beat.
    Guards, the other side, buildings and Cores are not healed.
  - The battle summary shows each side's point bonus at the end and the
    total health healed.
  - All numbers above are proposed and tuned later (issue #369, part 7).
- **CB-8a [PROPOSED]** Details of the neutral zone:
  - It is generated from the battle seed, so a battle remains reproducible
    (CB-30).
  - Nothing can be built in it. The only buildings that act in it are
    turrets, which can shoot enemy units there (CB-3j, CB-18a); otherwise
    only units fight there.
  - It is as wide as the front edges and only a few cells deep (`neutralZone`
    `depth` in `content/mapgen.json`, 7 today, enough to hold a point of
    interest and its guards). It has up to one lake and one cliff per plot
    of front width (same file).
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

| Kind | Role | In the game (`content/buildings.json`) | Not built yet |
|------|------|----------|----------|
| **Source** (collector) | Built on a resource node; produces that node's resource at a flow rate set by its tier | Extractor | Mana Well (1x1, any open cell, a weak collector; CB-52) |
| **Route** | Splits, joins, or crosses conduits | Splitter (one in, three out); Merger (three in, one out); Crossover (two conduits pass at 90°) | Tunnel (two 1x1 ends, carries a conduit under buildings; CB-9g) |
| **Refinery** | Turns one resource (common) or two (rare) into a refined resource | Composite Refinery (Ore + Power → Composite); Aether Refinery (Power + Flux → Aether) | One-input refineries such as a Smelter (Ore → Alloy), CB-5d; Transmuter (1x2, one base resource into another at a loss; CB-55) |
| **Modifier** | Changes the flow passing through | — | Booster (more per tick); Buffer (stores, then releases a burst) |
| **Unit producer** | Consumes resources → spawns units | Barracks (Soldier, cheap swarm); Range (Archer, ranged); Hangar (Drone, flying); Foundry (Ore + Power, Heavy, a bruiser); Golem forge (Composite, Golem, tanky front-liner); Spire (Aether, Caster, area damage) | Grand barracks (3x3, two soldiers at a time); Lancer hall (1x3, long-reach melee); CB-9f; Familiar Roost (1x2, fast fragile melee units; CB-54) |
| **Defense** | Blocks or kills enemy units | Walls (seven four-cell shapes, I, O, T, S, Z, L, J, and a one-cell wall that is not sold); Gate; Turret (needs Power to fire); Pylon (boss strongholds only, never in a shop, CB-29) | Mortar (2x2 turret, long range and splash, blind spot up close; CB-9f); Rune Ward (1x1, hits back at attackers of the walls beside it; CB-53); Repair station |
| **Economy** | Consumes resources → the factory gets stronger for the rest of this battle | Overclocker (Flux; collectors faster, up to a low cap, SC-12); Armory (Ore; later units spawn stronger) | Reactor (becomes a new source once fed enough) |
| **Core** | One per player: that player's health. Fixed position (CB-3e). Needs no resources. | Core | — |

Units in the content (`content/units.json`): the Soldier, Archer, Drone,
Heavy, Golem and Caster, each from the producer above, and the Raider, which
no building makes and only PvE waves field.

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
- **CB-9f [PROPOSED]** **Four new base buildings** (working names; theme
  issue #393 renames them; issue #437). **None of the four is built yet**: they
  are not in the content, and the rules below (CB-9g, CB-10f, CB-13a,
  CB-16e, CB-18b) are the plan for them. All four consume resources (V-15), help
  only their owner (PP-8) and are placed only in their owner's plot (CP-27,
  CP-28). Each is offered in the shop from a given round (EC-3a). Footprints
  are chosen so that where a building goes is a real decision.

  | Building | Kind | Footprint | From round | Input |
  |---|---|---|---|---|
  | Lancer hall | Unit producer | 1x3 | 2 | Ore |
  | Tunnel | Route | two 1x1 ends | 3 | none of its own (carries any one resource) |
  | Mortar | Defense (turret) | 2x2 | 3 | Ore |
  | Grand barracks | Unit producer | 3x3 | 5 | Ore |

  The Lancer hall trains the Lancer (CB-16e); it is long and thin, so it fits
  along walls and plot edges and is awkward elsewhere. The Mortar is a turret
  with long range and splash (CB-18b); it wants the back of the plot, behind
  other defences. The Grand barracks trains two soldiers at a time (CB-13a);
  it needs a 3x3 hole and a Merger feeding it (CB-10f). The Tunnel is
  described in CB-9g. Considered and left out: adjacency boosters, a repair
  station, a Bulwark turret.
- **CB-9g [PROPOSED]** **The Tunnel** (not built yet, CB-9f). A Tunnel is a route building made of
  two separate 1x1 pieces, an **entrance** and an **exit**, placed together
  as a pair.
  - It carries **one conduit** of **one resource** (CB-5b) from the entrance
    to the exit, at the same speed as any conduit, under up to **5 cells**
    [PROPOSED] (N = 5) in a **straight line**. Entrance and exit are in the
    same row or column, with at most N cells between them.
  - The cells in between may hold buildings, conduits or natural features;
    the Tunnel does not occupy them and nothing there is changed.
  - It **cannot cross a plot border**: both ends and every cell between them
    lie in the owner's plot. It is not a border link (CB-9d).
  - It is part of a conduit network (CB-9a): a conduit runs into the entrance
    and another leaves the exit, and the pair counts as one stretch of
    conduit. The no-loop rule (CB-9c) still holds: the editor refuses a
    Tunnel that would close a loop, and shows why.
  - Destroying either end destroys the pair and the conduits attached to
    them (CB-9a). A Tunnel needs no resources itself (CB-10c).
  - The build screen shows the exit's legal cells as soon as the entrance is
    placed, and marks the range.
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
  per second) that a higher tier raises [DECIDED] (`intervalTicks` per tier in
  `content/buildings.json`). Resources move one cell per
  tick along the conduits the players lay out, so longer conduits mean a
  longer delay. A resource sent out of a side that has no conduit is
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
  feeding it backs up (CB-9e). The number of items that can wait at each
  input is `inputBufferUnits` in `content/sim.json`. Nothing in a store
  carries over to the next battle (CB-11).
- **CB-10f [PROPOSED]** **The Grand barracks exception** (not built yet,
  CB-9f). The rebalance
  principle (SC-13a) is that a collector fully feeds exactly one consumer of
  its own tier. The Grand barracks is the stated exception: it is fed by
  exactly two collectors of its tier, joined by a Merger (CB-9) or by two
  conduits. One collector alone feeds it only half the time (CB-10d).
- **CB-10c [DECIDED]** **Which buildings need resources.** Only buildings
  that do something: unit producers, turrets, and economy buildings. Walls,
  gates, Splitters and other route buildings, pylons and the Core need
  nothing. There is no cap on the number of walls for now. Refineries also
  consume resources: each has a cost per input resource and a minimum time
  between batches like any consumer (CB-10a, CB-5e, CB-5f). Modifiers
  (CB-9), which are not in the content yet, will get the same when they are
  added.
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
- **CB-12** **Overload**: late in a battle, both sides' units deal more and
  more damage (turret damage does not grow) and every Core decays, so that
  two fortified sides cannot stall forever. Overload starts at 3 minutes
  [DECIDED]. The timing and step sizes are the `overload...` keys in
  `content/sim.json`.
  - **[DECIDED] Overload takes its full amount from every living Core.** At
    every beat (from tick 1800, 3 minutes, at every 100th tick) each Core
    still standing, on both sides, takes the same flat amount: 5, then 10,
    15, ... health. The amount is not shared out between a side's Cores. A
    Core of 500 health therefore dies from the decay alone at tick 3100
    (3 minutes 10 seconds; 14 beats take 525), whatever the party size, and
    a side whose Cores all have 500 health has lost all of them by then at
    the latest. (The Bonded boss shares one health pool and takes
    the amount once, from the pool, MM-9d.)
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
- **CB-13a [PROPOSED]** **Several units per production** (not built yet,
  CB-9f). A unit producer may
  spawn more than one unit each time it produces. The Grand barracks spawns
  two soldiers per production, for a cost of about 75% of two Barracks
  productions (about 25% more efficient per Ore). Its need is high enough
  that it takes two collectors' worth of Ore (CB-10f). The units appear as
  CB-16a says, one after the other; if only one fits, that one is spawned
  and the other is held.
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
  the way (CB-20). (Owner decision 18 on issue #124. Implemented, issue
  #133.)
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
- **CB-16d [PROPOSED]** **Armor and area damage are unit stats**, next to
  health, damage, reach and speed. Armor is flat damage reduction per hit
  (CB-5g); area damage is a radius and a percent of the hit passed to other
  units near the target (CB-5h). Implemented: `armor` and `splash` in
  `content/units.json`.
- **CB-16e [PROPOSED]** **The Lancer** (not built yet, CB-9f). A melee unit (CB-16) with a long
  reach (a few cells, edge to edge, more than other melee units), low health
  and moderate damage. It stands behind a front line of other units and hits
  over them. It still cannot hit flying units (CB-16b). Trained by the
  Lancer hall from Ore (CB-9f). Numbers [PROPOSED], set in content.
- **CB-16b [DECIDED]** **Ranged units.** A unit is melee or ranged. A ranged
  unit attacks from a distance (its reach is its range, edge to edge) and
  stops to fire while it has a target in range. In the content: the Archer
  (a placeholder, from the Range) and the Caster (from the Spire, CB-5h).
  Only ranged attackers can hit flying units: ranged
  ground units, flying units (always ranged) and turrets. A melee unit whose
  only remaining enemies are flyers ignores them and goes on to its goal.
- **CB-16c [DECIDED]** **Flying units.** A flying unit is always ranged, can
  attack air and ground targets, flies straight at its target Core over
  walls, lakes and cliffs, and collides only with other flying units (by a
  much smaller collision circle than its drawn size). Walls and gates do
  nothing against it; turrets and ranged units are the defense. Placeholder:
  the Drone, from the Hangar building. A flyer picks its next Core by
  straight-line distance, and a Hangar walled in on every side still sends
  its drones out (it is never "sealed"). PvE waves from a set round on spend
  part of the wave budget on archers and drones (placeholders; `rangedMix`
  in `content/threats.json`: from round 4, about 25% and 15%).
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
- **CB-18b [PROPOSED]** **Minimum range and splash (the Mortar)** (not built
  yet, CB-9f). A turret
  may have a **minimum range**: a blind spot around it, in which it cannot
  target a unit, and a **maximum range** beyond it. It may also have splash:
  when its shot hits a unit, other units within a radius of that unit take a
  percent of the hit, by the area-damage rule of CB-5h (units only, never
  buildings, never friendly units; same order of damage modifiers). The
  Mortar has a long maximum range, splash and a blind spot of a few cells
  (numbers [PROPOSED], set in content). The build screen draws both rings.
  CB-18a (where a turret can shoot) still applies.
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
  second.** A plot has a fixed number of resource nodes (only the Rich vein
  event adds one, RS-4i4), a collector's flow
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
  player's Overclocker, Armory and similar affect only that
  player's collectors and units, and the cap applies per player (SC-12). To
  help a partner, a player sends resources over a border link (CP-29,
  CP-30). (Owner decision 19 on issue #124. Implemented, issue #137; the
  caps are `maxSourceSpeedPercent` and `maxUnitStrengthPercent` in
  `content/sim.json`.) A specialist bonus is owner-scoped in the same way
  (CP-31a, EC-8a); the Flowmancer's collector bonus counts toward the same
  per-player collector cap (EC-8b, CB-51a).
  - **Exception**: a point of interest's buff applies to the **whole side**,
    every player of it (CB-8c, CB-8g).
- **CB-25 [DECIDED]** **The board never expands.** It starts fairly large and
  stays that size for the whole run. Running out of room is intended: by the
  mid-run space runs out and placement becomes a tough choice (design
  pillar 6, CB-4).
- **CB-26** Buildings are bought with gold in shops between battles and go into the owning player's stash. Placing, moving, and
  rotating them costs nothing; gold plays no part in building or in battle
  (CB-3i). Only the owner can place, move, rotate, return or sell a
  building, and only inside their own plot (CP-27, CP-28). 
- **CB-26b [DECIDED for now]** There are no building tags or tag bonuses; to
  be reconsidered once the game has been played.
- **CB-26a [DECIDED]** **Buildings have tiers, and there is no combining.**
  Owning several identical buildings never merges them. Higher-tier
  buildings come from shops (which offer higher tiers as the run goes on),
  from the Workshop event, which raises one building by a tier, and from
  the Drill event, which raises one collector by a tier. The factory layout therefore only changes when
  players change it.
- **CB-26c [DECIDED for now]** There are **three tiers**. Nothing can raise
  a building above tier 3. The cap may change later.
- **CB-26d [PROPOSED]** What a tier is: the same building with better
  numbers (for example health, rate, or output), set per tier in content
  data. Every building exists at all three tiers and keeps its footprint
  and inputs at each; the Core is the exception, with one tier. Tiers apply
  to buildings only.
- **CB-27** Moving and rotating buildings between battles is free; sources
  must stay on nodes, buildings stay in their owner's plot, and a Core
  never moves (CB-3e). The map's terrain never changes during a run; only
  the Rich vein event adds resource nodes (RS-4i4).

## Specialists

Each player picks one specialist at the start of the run (RS-13). It gives
its owner a small family bonus and a signature building that only that
specialist can buy (issue #468). Everything here helps only the owner
(PP-8, CP-31a), and nothing is given between players (CP-29). Names are
working names (theme issue #393 renames them). All numbers are [PROPOSED]
and set in content; the first values are placeholders and are tuned in issue
#477.

- **CB-51 [DECIDED roster / PROPOSED numbers]** **The roster** has four
  specialists. The family names the kind of building or unit the bonus
  touches.

  | Specialist | Family | Family bonus (owner's own) | Signature building | What it does |
  |---|---|---|---|---|
  | Flowmancer | Logistics | Collectors produce about 10% faster | Mana Well (1x1) | A weak collector that works on any open cell, no node needed. The owner chooses which base resource it makes. |
  | Wardsmith | Defense | Walls, gates and turrets get about 15% more health | Rune Ward (1x1) | Enemy units that hit a wall next to the Ward take damage back. |
  | Beastbinder | Units | Units from the owner's producers get about 10% more health | Familiar Roost (1x2) | Produces Familiars: fast, fragile melee units. |
  | Alchemist | Industry | Refineries and ramp buildings work about 15% faster | Transmuter (1x2) | Turns one base resource into another at a loss. The owner chooses the output. |

  Every signature building has a footprint, a tier from 1 to 3 (CB-26c, CB-26d:
  the same building with better numbers; footprint and inputs never change
  with the tier), a first round and an input, and consumes resources (V-15):

  | Building | Kind | Footprint | From round | Input |
  |---|---|---|---|---|
  | Mana Well | Source | 1x1 | 2 | none; it makes a resource |
  | Rune Ward | Defense (type ward) | 1x1 | 2 | Power |
  | Familiar Roost | Unit producer | 1x2 | 2 | Power |
  | Transmuter | Refinery | 1x2 | 2 | one base resource, 2 per batch |

  A signature building is offered only in its specialist's shop, from round
  2, at tiers 1 to 3 (EC-3b); round 1 is the starting kit. Like every
  building it is placed only in its owner's plot (CP-27, CP-28), is restored
  after a battle (CB-11), and can be sold, stashed, moved and rotated by its
  owner only (CB-26). Considered and left out: a specialist drawback, a
  fifth specialist, unlocking specialists over time (out of scope of issue
  #468).
- **CB-51a [PROPOSED]** **Family bonuses are owner-scoped effects** (EC-8a).
  Each reuses an existing effect kind where one fits and adds a new kind only
  where none does:

  | Specialist | Effect kind | Target | Percent |
  |---|---|---|---|
  | Flowmancer | `source_speed_percent` (new) | the owner's collectors, the Mana Well included | 10 |
  | Wardsmith | `building_health_percent` (existing), three effects | `wall`, `gate`, `turret` | 15 each |
  | Beastbinder | `unit_health_percent` (new) | units spawned by the owner's producers | 10 |
  | Alchemist | `production_speed_percent` (new) | the owner's refineries and the ramp step of the owner's Overclockers and Armories | 15 |

  - **Scope.** A specialist effect acts only on buildings and units the
    owner owns (CB-15a: a unit's owner is the owner of the building that made
    it). It never touches a partner's, a ghost's other players', a scheduled
    PvE wave's or a neutral guard's. Shrine modifiers, which act on the whole
    side, are added to it by EC-8a: summed, applied once.
  - **Wardsmith.** `wall` matches every wall shape and the one-cell wall;
    `turret` matches every turret, the Mortar included. The Rune Ward is a
    defense of its own type and is not boosted. The health is raised at the
    start of the battle, like any `building_health_percent` effect.
  - **Beastbinder.** `unit_health_percent` raises a unit's health only. At
    spawn the unit's health percent is the unit-strength total (CB-24a, run
    modifiers and the point bonus of CB-8g) plus the sum of health effects,
    **applied once** to the base health (integer, rounded down); its damage
    uses the strength total only. It applies to every unit from the owner's
    producers, the Familiar included. It is outside the Armory cap.
  - **Flowmancer.** The bonus is added to the owner's ramp total of
    `source_speed` and the sum is capped at `maxSourceSpeedPercent` (EC-8b),
    so with an Overclocker the owner never exceeds +25%. It acts from the
    first tick of a battle, before any ramp.
  - **Rounding, integer intervals.** Production intervals are whole ticks
    (CB-10a), so a speed bonus is lumpy, as with the speed modifiers of issue
    #424. A bonus `P` turns an interval `T` into
    `max(1, floor(T * 100 / (100 + P)))`: it rounds in favour of the owner,
    never below 1 tick, and a short interval can gain more than the stated
    percent. For the Flowmancer's 10 the Extractor's intervals 20, 14 and 10
    (tiers 1 to 3) become 18, 12 and 9. A countdown already running is not
    changed; only the next reset reads the new value. The exact order is in
    the rules reference.
- **CB-52 [PROPOSED]** **The Mana Well** (Flowmancer). A 1x1 collector
  (kind Source, CB-9) that needs **no resource node**: it can stand on any
  open cell of its owner's plot where a building fits, except a resource node
  and except a cell a conduit uses. It consumes nothing; it makes the base
  resource set on it (CB-56) at **half the rate of an Extractor of its tier**
  (placeholder, tuned in #477): its interval is twice the Extractor's, so 40,
  28 and 20 ticks at tiers 1 to 3 before bonuses. The Overclocker and the
  Flowmancer's bonus speed it like any collector (CB-51a).
  - **A stated exception to the rebalance principle** (SC-13a, issue #145):
    a collector fully feeds exactly one consumer of its own tier. The Mana
    Well is a **weaker collector**: it feeds only half of one, so a consumer
    needs two Wells, joined by a Merger or two conduits (CB-10d: with one it
    waits). This is the opposite of the Grand barracks exception (CB-10f).
    What it buys the Flowmancer is freedom (any cell, any resource), not
    supply, which stays limited by gold and space (CB-24).
  - It can make Flux, so a Flowmancer is not tied to the plot's one Flux node
    (CB-5i); the half rate bounds that, and the question is listed in
    `07-open-questions.md`.
- **CB-53 [PROPOSED]** **The Rune Ward** (Wardsmith). A 1x1 defense (type
  `ward`, kind Defense, CB-9) with health, that needs Power (CB-10a: a cost
  per strike). It does nothing alone.
  - **When it acts.** When an enemy unit hits a **wall or gate of the Ward's
    owner** (any wall shape; other buildings do not count) that **shares an
    edge** with the Ward (a diagonal does not count), and the Ward holds a
    full charge, the Ward spends it and returns damage to **the attacker**: a
    **fixed amount per tier** (placeholder 2 / 3 / 4), reduced by the attacker's
    **armor** (CB-5h, at least 1). It returns damage for melee, ranged and
    flying attackers alike, in the same tick as the hit, and the returned
    damage is never itself returned. (Issue #474 decided this in place of the
    first draft of this rule, which returned a percent of the wall's damage,
    ignored armor and looked at the eight cells around the Ward.)
  - **Without a charge** it does nothing (CB-10d: it waits for resources,
    never weaker). **Stacking:** each hit uses at most one Ward: if several
    Wards touch the wall, the one with the lowest building ID that has a
    charge acts. A Ward never acts for a partner's wall, a ghost's or an
    enemy's, and never damages a building.
  - **Not boosted** by the Wardsmith's bonus (CB-51a), and not counted as a
    wall by the shop's limit of wall shapes (EC-3). It has its own health and
    can be attacked like any building.
- **CB-54 [PROPOSED]** **The Familiar Roost and the Familiar** (Beastbinder).
  The Roost is a 1x2 unit producer (CB-9, CB-13) that needs Power and makes
  one Familiar per production, for a cost and shortest time of the same
  order as a Barracks soldier (placeholder), so one collector of its tier
  feeds one Roost: it follows the rebalance principle. The Familiar is a
  **fast, fragile melee unit**: its health is a fraction of a Soldier's
  (placeholder: about 40%), its reach and damage are of a Soldier's order,
  and "fast" means **only a shorter move cooldown** (placeholder: about
  two thirds of a Soldier's, rounded down by the integer rule of CB-51a).
  It uses the **normal target rules** (CB-15b, CB-15c, CB-16): no special
  targeting, it does not fly (CB-16c) and has no armor or area damage. It
  is a unit of its owner like any other (CB-15a), so the Beastbinder's
  health bonus applies to it. Numbers are set in `content/units.json`.
- **CB-55 [PROPOSED]** **The Transmuter** (Alchemist). A 1x2 building of
  kind Refinery (CB-9, CB-5f), so the Alchemist's bonus applies to it. It
  turns **one base resource into another at a loss**: it takes **2 items of
  the input resource and makes 1 item of the output resource** per batch
  (placeholder 2:1; the shortest time between batches is a refinery's).
  - The **output** is the resource set on the building (CB-56). The **input**
    is whichever base resource the conduit that feeds it carries (CB-5b).
    The input and the output must differ, and refined resources are never
    accepted; the editor refuses a feed that breaks either rule and shows why.
  - It is a **second stated exception** to SC-13a: refining pays a premium,
    and this conversion pays a penalty. A collector feeding it makes half
    as many items on the other side, so it never creates supply (V-15) and
    cannot beat the rebalance principle. Its worth is turning a plot's
    surplus into a resource the plot lacks.
- **CB-56 [PROPOSED]** **The building resource setting.** The Mana Well and
  the Transmuter each carry one **setting**: the base resource they output
  (Ore, Power or Flux).
  - It is a value **per building**, chosen by the owner when placing the
    building and **changeable at any time between battles** with the other
    free build actions (CB-27). It cannot be changed during a battle. A new
    building starts with Ore.
  - It is **stored in the team state** with the building, an optional field
    that other buildings do not have (CB-32), so snapshots and saves carry it.
  - It is **shown on the building**: its colour and the resource name on the
    cell, the card and the inspector.
  - A conduit carries one resource (CB-5b). When a setting changes, the
    editor checks every conduit leaving the building again: one that no
    longer matches what its far end accepts is marked as a problem in the
    problems list and carries nothing, and it does not stop the player from
    readying up. A Transmuter whose setting equals the resource arriving is
    refused (CB-55).
- **CB-57 [PROPOSED]** **What "ramp buildings work faster" means** (the
  Alchemist). The Overclocker and the Armory raise their owner's bonus one
  **step** every `stepIntervalTicks` (CB-3, the ramp). The Alchemist's
  `production_speed_percent` shortens that interval for the owner's own
  Overclockers and Armories by the rounding rule of CB-51a (for +15%: 40
  ticks becomes 34, 42 becomes 36). The step size, each building's
  `maxSteps` and the owner caps (`maxSourceSpeedPercent`,
  `maxUnitStrengthPercent`) are **unchanged**: the ramp reaches its cap
  sooner and never goes beyond it (SC-12, CB-24a). For a refinery
  (and the Transmuter) it shortens the shortest time between batches the same
  way. It changes nothing for other buildings. A running countdown is not
  changed.

## Opponents

- **CB-28** **Ghosts** are other parties' boards — their map, their
  factories, their Cores — and run in the same simulation, joined to the
  party's board (CB-8), their plots facing the party's one to one (CB-8b).
- **CB-29 [DECIDED]** **PvE enemies and bosses are scripted threats, not
  factories**:
  a **wave schedule** (which units arrive at the party's front edge, and
  when) plus a **stronghold** for the party's units to attack (Cores with
  health and pre-placed defenses on a board of the party's size with no
  terrain, laid out from the archetype's layout in `content/threats.json`).
  Both are scaled by the budget curve (SC-1) and party size.
  - **One Core per player, always** [DECIDED]: a stronghold has as many
    plots as the party has players and one Core in each, bosses included.
  - **Health split evenly** [DECIDED]: the stronghold's total Core health is
    divided evenly between its Cores (whole numbers; any remainder goes one
    point each to the lowest-numbered plots).
  - **Waves head for the Core of the plot they enter** [DECIDED]: a wave
    unit's first target is the Core of the party plot it enters, then the
    nearest remaining Core (CB-15a, CB-15b).
  - **A wave may enter through one plot only** [DECIDED] (the Focus threat,
    MM-18): the threat profile's spawn placement picks one party plot for each
    wave, and the choice changes from wave to wave. Its units still head
    first for the Core of the plot they enter (unchanged). With one player
    there is one plot, so Focus plays as ordinary waves.
  - **PvE and PvP follow the same rules** [DECIDED]: the party wins when all
    of the stronghold's Cores are destroyed and loses when all of its own
    are; Overload, ties and the time limit work as in any battle.
  - The stronghold's defenses are laid out plot by plot, around each plot's
    Core.
  - **Boss strongholds may differ in two ways** [DECIDED] (MM-9a–MM-9d):
    a boss stronghold may contain **boss-only buildings** (pylons) that are
    never in a shop, and its Cores may share one health pool (Bonded)
    instead of splitting it. Party units target the pylons of a shielded
    Core until they are down (Pylons); this is the only targeting change.
    Other bosses change their units instead: the Brood's Cores release
    bursts of units as their health drops, and the Warlord's waves are led
    by a champion Golem. Nothing a boss does changes the party's factory.

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
  (CP-6): the map (terrain, nodes, features; nodes added by Rich vein, RS-4i4, are part of it), one Core
  position per player, every building with owner, tier, position and
  orientation (and, for a Mana Well or a Transmuter, its resource setting,
  CB-56), every conduit with its owner (border links included), each
  player's specialist (CP-31), and run modifiers that affect combat. This is exactly what a snapshot stores
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
  the player's own plot and Core — and fit the whole battle). Interface zones sit
  against the view's edges and keep their places in every phase — a map rail on
  the left, an action tray below (with the primary button at its right end), an
  info rail on the right — rather than being laid out around a fixed-size
  board. Map size can then be
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

- **CB-50** Three base resources (refining, issue #378, and points of interest come
  after the first playable, TA-41a); ~15 buildings across the kinds; 3–4 unit types;
  lakes and cliffs; 3 PvE archetypes; 1 boss. Enough to validate the loop;
  no more. (Status: the content has grown past this budget. Refining is in,
  with the two compounds (CB-5d), and so are more unit types and buildings
  (`content/units.json`, `content/buildings.json`) and five bosses
  (`content/threats.json`). Points of interest are being added (issue #369,
  CB-8c to CB-8g); refining them is still to come.)
