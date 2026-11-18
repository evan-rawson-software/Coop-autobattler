# Theme guide, name table and art direction

Status: proposal for the owner (issue #393, parts 1 and 3). The setting and
tone are decided (issue #392, recorded in `docs/specs/00-vision.md`, Theme).
The Recommended names are applied in
`content/` and the web build (issue #393, part 2). The candidates stay in the
table so the owner can swap any name later.

## The setting

The world is a bright valley of magic-powered factories. Each player runs a
small workshop-estate on a plot of land. **Collectors** draw glowing stuff out
of the ground (ore, sparks, flux). **Conduits** carry it along humming
channels. **Workshops** turn it into little clockwork-and-charm fighters.
**Refineries** blend two raw materials into something rarer. Between the rival
factories lie guarded **ruins** worth capturing. Each factory has a **Core**,
the heart that keeps the lights on; lose all your Cores and the factory goes
dark. It is a game played with friends: bright, busy and cosy, never grim.

## Tone

Playful and warm, but every sentence still has to teach something. A
description says what the thing needs, what it makes and what it is good
against, and may add one light touch of colour.

| Do | Don't |
|---|---|
| "Feeds on Ore to train soldiers. Cheap, sturdy and always first to the party." | "Barracks. Consumes Ore. Produces soldier units." (dry, a spec line) |
| "Spins Flux into shimmering Aether. Needs both inputs at once, or it waits politely." | "A conduit of malevolent energies bends to your will." (grim, vague) |
| "A big golem. Slow, stompy, and weak hits just bounce off its armor 3." | "Golem go smash." (cute but hides the numbers) |
| "Whirligigs fly over walls and lakes. Only ranged units and turrets can reach them." | "The skies belong to you now." (mood, no information) |

Rules of thumb: one joke at most per description; no violence beyond
"hits" and "falls"; no sarcasm aimed at the player; numbers and rules stay
exact (armor 3, 10 percent, 2 cells), because the rules text is the contract.

## Naming rules

1. One or two words, three at most. Readable at a glance at battle zoom.
2. The name says what the thing does, or what family it belongs to. No pun
   that hides the function. Where a themed name is less clear, the
   description carries the meaning (and the shop kind label helps).
3. Plain words first, a charming twist second ("Surge coil", not "Zorptron").
4. Family words repeat: all unit factories are workshops or halls/yards,
   all refineries end in "Refinery", all pacts start with "Pact of".
5. Use real-world generic words only. Do not copy a trademarked term or a
   well-known game's unit or building names. This is why the boss pylon
   becomes a "Ward pillar".
6. Names are content, not code. They live in `content/resources.json` and
   `content/presentation.en.json`. IDs never change, so saves, ghosts and
   goldens are unaffected.
7. British or American spelling follows the existing text (American,
   "armor"); sentence case for names except proper nouns for specialists.

## How each kind of thing is named

| Kind | Rule | Examples |
|---|---|---|
| Resources | A short, single, glowing noun. Base resources read as raw stuff; refined ones sound like a made material. | Ore, Spark, Flux; Sparksteel, Aether |
| Collectors | A verb-noun for drawing things up. The player's own signature collector may be a place. | Siphon, Wellspring |
| Routes (conduits and route buildings) | Plain plumbing words: what it does to the flow. | Splitter, Merger, Crossover, Tunnel |
| Workshops (unit producers) | Named for the unit they make: a place word plus the unit, or the unit kind. | Barracks, Archery yard, Whirligig loft, Lancer hall, Golem forge, Caster spire |
| Defenses | Plain, sturdy words for blockers; a light elemental word for shooters. | Wall (L), Gate, Arc turret, Mortar, Ward pillar |
| Economy buildings | A gadget that boosts the factory over a battle. | Surge coil, Armory |
| Units | Short, cute, readable. Real-job words for the basic ones, creature or toy words for the quirky ones. | Soldier, Archer, Scamp, Brute, Whirligig, Golem |
| The Core | Always "Core". The one word the whole game relies on. | Core |
| PvE threats | A crowd-and-behaviour noun that tells the player what to prepare for. | Stampede, Fortress, Crescendo, Spotlight |
| Bosses | The mechanic as a single word; the boss itself is just "Boss". | Brood, Bonded, Pillars, Warlord |
| Ghosts | A recorded party. Always "Ghost". | Ghost |
| Events | A familiar market or workshop moment, one or two words. | Market day, Tinkerer's sale, Tune-up, Caravan |
| Points of interest | A ruin with a named blessing. Two buffs now, more later. | Ruin, Strength point, Healing point |
| Guards | "Neutral guard" in the UI; they use the soldier and archer bodies. | Neutral guard |
| Refined resources | Named after what the two inputs make together. | Sparksteel (Ore + Spark), Aether (Spark + Flux) |
| Specialists | A "-mancer", "-smith" or "-binder" title for the craft. | Flowmancer, Wardsmith, Beastbinder, Alchemist |
| Shrine modifiers | Two words: what it boosts, in plain terms. Pacts start with "Pact of". | Stout walls, Quick march, Pact of fury |

## Name table

**The owner picks the names.** The Recommended column is applied (status:
applied). Names live only in content (`content/resources.json` and
`content/presentation.en.json`), so any name can be swapped later without
touching IDs, saves, ghosts or goldens. A row that says "(keep)" has a current
name that already fits.

Planned items in issue #393 (Foundry, refineries, Golem forge, Spire, heavy
unit, Golem, caster, guards, points of interest and their two buffs, the six
new event types, Lancer, Tunnel, Mortar, Grand barracks) already exist in
`content/` now, so they are in the table with their IDs. Wall shapes keep
their letter names; they are tetromino shapes, which is what players call
them. "Tunnel entrance" and "Tunnel exit" fit as they are.

| Kind | ID | Current name | Candidates | **Recommended** |
|---|---|---|---|---|
| Resource | `res_a` | Ore | Cogstone, Rune ore | Ore (keep) |
| Resource | `res_b` | Power | Spark, Zap | **Spark** |
| Resource | `res_c` | Flux | Wisp | Flux (keep) |
| Resource | `res_ab_refined` | Composite | Alloy, Glimmersteel | **Sparksteel** |
| Resource | `res_bc_refined` | Aether | Starlight | Aether (keep) |
| Building: Collector | `bld_extractor` | Extractor | Tap, Drawer | **Siphon** |
| Building: Conduit | `bld_splitter` | Splitter | (current fits) | Splitter (keep) |
| Building: Conduit | `bld_merger` | Merger | (current fits) | Merger (keep) |
| Building: Conduit | `bld_crossover` | Crossover | (current fits) | Crossover (keep) |
| Building: Conduit | `bld_tunnel_in` | Tunnel entrance | (current fits) | Tunnel entrance (keep) |
| Building: Conduit | `bld_tunnel_out` | Tunnel exit | (current fits) | Tunnel exit (keep) |
| Building: Workshop | `bld_barracks` | Barracks | (current fits) | Barracks (keep) |
| Building: Workshop | `bld_range` | Range | Archery yard, Bow works | **Archery yard** |
| Building: Workshop | `bld_hangar` | Hangar | Drone loft, Whirligig nest | **Whirligig loft** |
| Building: Workshop | `bld_foundry` | Foundry | (current fits) | Foundry (keep) |
| Building: Workshop | `bld_grand_barracks` | Grand barracks | (current fits) | Grand barracks (keep) |
| Building: Collector (signature) | `bld_mana_well` | Mana Well | Spring, Fountain | **Wellspring** |
| Building: Defense (signature) | `bld_rune_ward` | Rune Ward | (current fits) | Rune Ward (keep) |
| Building: Workshop (signature) | `bld_familiar_roost` | Familiar Roost | (current fits) | Familiar Roost (keep) |
| Building: Refinery (signature) | `bld_transmuter` | Transmuter | (current fits) | Transmuter (keep) |
| Building: Workshop | `bld_lancer_hall` | Lancer hall | (current fits) | Lancer hall (keep) |
| Building: Refinery | `bld_refinery_ab` | Composite Refinery | Alloy Refinery | **Sparksteel Refinery** |
| Building: Refinery | `bld_refinery_bc` | Aether Refinery | (current fits) | Aether Refinery (keep) |
| Building: Workshop | `bld_golem_forge` | Golem forge | (current fits) | Golem forge (keep) |
| Building: Workshop | `bld_spire` | Spire | Caster tower, Spellspire | **Caster spire** |
| Building: Defense | `bld_wall_i` | Wall (I) | (current fits) | Wall (I) (keep) |
| Building: Defense | `bld_wall_o` | Wall (O) | (current fits) | Wall (O) (keep) |
| Building: Defense | `bld_wall_t` | Wall (T) | (current fits) | Wall (T) (keep) |
| Building: Defense | `bld_wall_s` | Wall (S) | (current fits) | Wall (S) (keep) |
| Building: Defense | `bld_wall_z` | Wall (Z) | (current fits) | Wall (Z) (keep) |
| Building: Defense | `bld_wall_l` | Wall (L) | (current fits) | Wall (L) (keep) |
| Building: Defense | `bld_wall_j` | Wall (J) | (current fits) | Wall (J) (keep) |
| Building: Defense | `bld_wall_block` | Wall (single) | (current fits) | Wall (single) (keep) |
| Building: Defense | `bld_gate` | Gate | (current fits) | Gate (keep) |
| Building: Defense | `bld_turret` | Turret | Bolt tower, Spark turret | **Arc turret** |
| Building: Defense | `bld_mortar` | Mortar | (current fits) | Mortar (keep) |
| Building: Economy | `bld_overclocker` | Overclocker | Surge coil, Pulse regulator | **Surge coil** |
| Building: Economy | `bld_armory` | Armory | (current fits) | Armory (keep) |
| Building: Defense | `bld_pylon` | Pylon | Ward pillar, Shield obelisk | **Ward pillar** |
| Building: Core | `bld_core` | Core | (current fits) | Core (keep) |
| Unit | `unit_soldier` | Soldier | (current fits) | Soldier (keep) |
| Unit | `unit_raider` | Raider | Dasher, Imp | **Scamp** |
| Unit | `unit_familiar` | Familiar | (current fits) | Familiar (keep) |
| Unit | `unit_heavy` | Heavy | Bulwark, Ironclad | **Brute** |
| Unit | `unit_golem` | Golem | (current fits) | Golem (keep) |
| Unit | `unit_caster` | Caster | (current fits) | Caster (keep) |
| Unit | `unit_lancer` | Lancer | (current fits) | Lancer (keep) |
| Unit | `unit_archer` | Archer | (current fits) | Archer (keep) |
| Unit | `unit_drone` | Drone | Wisp drone, Flutterbot | **Whirligig** |
| Neutral guard | `guard_soldier` | Neutral guard (soldier) | (current fits) | Neutral guard (soldier) (keep) |
| Neutral guard | `guard_archer` | Neutral guard (archer) | (current fits) | Neutral guard (archer) (keep) |
| Terrain | `ter_lake` | Lake | (current fits) | Lake (keep) |
| Terrain | `ter_cliff` | Cliff | (current fits) | Cliff (keep) |
| PvE threat | `arch_rusher` | Rusher | Stampede, Dash crew | **Stampede** |
| PvE threat | `arch_fortress` | Fortress | (current fits) | Fortress (keep) |
| PvE threat | `arch_escalator` | Escalator | Crescendo, Snowball | **Crescendo** |
| PvE threat | `arch_skirmishers` | Skirmishers | (current fits) | Skirmishers (keep) |
| PvE threat | `arch_swarm` | Swarm | (current fits) | Swarm (keep) |
| PvE threat | `arch_maze` | Maze | (current fits) | Maze (keep) |
| PvE threat | `arch_focus` | Focus | Spotlight, Pincer | **Spotlight** |
| PvE threat | `arch_juggernaut` | Juggernaut | (current fits) | Juggernaut (keep) |
| PvE threat | `arch_coven` | Coven | (current fits) | Coven (keep) |
| Boss | `arch_boss` | Boss | (current fits) | Boss (keep) |
| Boss | `arch_boss_brood` | Brood | (current fits) | Brood (keep) |
| Boss | `arch_boss_linked` | Bonded | (current fits) | Bonded (keep) |
| Boss | `arch_boss_pylons` | Pylons | Pillars, Wardens | **Pillars** |
| Boss | `arch_boss_warlord` | Warlord | (current fits) | Warlord (keep) |
| Event | `evt_workshop` | Workshop | Tinkerer's sale, Bench sale | **Tinkerer's sale** |
| Event | `evt_shrine` | Shrine | (current fits) | Shrine (keep) |
| Event | `evt_windfall` | Windfall | (current fits) | Windfall (keep) |
| Event | `evt_drill` | Drill | Tune-up, Upgrade day | **Tune-up** |
| Event | `evt_market_day` | Market day | (current fits) | Market day (keep) |
| Event | `evt_pact` | Pact | (current fits) | Pact (keep) |
| Event | `evt_rich_vein` | Rich vein | (current fits) | Rich vein (keep) |
| Event | `evt_blueprint` | Blueprint | (current fits) | Blueprint (keep) |
| Event | `evt_caravan` | Caravan | (current fits) | Caravan (keep) |
| Run modifier | `mod_stout_walls` | Stout walls | (current fits) | Stout walls (keep) |
| Run modifier | `mod_sharp_turrets` | Sharp turrets | (current fits) | Sharp turrets (keep) |
| Run modifier | `mod_fortified_core` | Fortified Core | (current fits) | Fortified Core (keep) |
| Run modifier | `mod_drilled_troops` | Drilled troops | (current fits) | Drilled troops (keep) |
| Run modifier | `mod_reinforced_frames` | Reinforced frames | (current fits) | Reinforced frames (keep) |
| Run modifier | `mod_sharpshooters` | Sharpshooters | (current fits) | Sharpshooters (keep) |
| Run modifier | `mod_hornet_swarm` | Hornet swarm | Whirligig swarm, Buzz swarm | **Whirligig swarm** |
| Run modifier | `mod_vanguard` | Vanguard | (current fits) | Vanguard (keep) |
| Run modifier | `mod_quick_march` | Quick march | (current fits) | Quick march (keep) |
| Run modifier | `mod_rapid_fire` | Rapid fire | (current fits) | Rapid fire (keep) |
| Run modifier | `mod_stone_skin` | Stone skin | (current fits) | Stone skin (keep) |
| Run modifier | `mod_wide_arcs` | Wide arcs | (current fits) | Wide arcs (keep) |
| Run modifier | `mod_claimstakers` | Claimstakers | (current fits) | Claimstakers (keep) |
| Run modifier | `mod_tithe` | Tithe | Steady coin, Pocket change | **Steady coin** |
| Run modifier | `mod_scrap_dealer` | Scrap dealer | (current fits) | Scrap dealer (keep) |
| Pact modifier | `mod_pact_fury` | Pact of fury | (current fits) | Pact of fury (keep) |
| Pact modifier | `mod_pact_bastion` | Pact of the bastion | (current fits) | Pact of the bastion (keep) |
| Pact modifier | `mod_pact_overcharge` | Pact of overcharge | (current fits) | Pact of overcharge (keep) |
| Specialist | `spec_flowmancer` | Flowmancer | (current fits) | Flowmancer (keep) |
| Specialist | `spec_wardsmith` | Wardsmith | (current fits) | Wardsmith (keep) |
| Specialist | `spec_beastbinder` | Beastbinder | (current fits) | Beastbinder (keep) |
| Specialist | `spec_alchemist` | Alchemist | (current fits) | Alchemist (keep) |
| Point of interest | `poi` | Point of interest | (current fits) | Point of interest (keep) |
| Point of interest | `poi_strength` | Strength point | (current fits) | Strength point (keep) |
| Point of interest | `poi_heal` | Healing point | (current fits) | Healing point (keep) |
| Other | `ghost` | Ghost | (current fits) | Ghost (keep) |
| Other | `node` | Resource node | (current fits) | Resource node (keep) |
| Other | `plot` | Plot | (current fits) | Plot (keep) |
| Other | `core_label` | Core | (current fits) | Core (keep) |

## Art direction

A brief for whoever draws the sprites in `packages/art`. The current sprites
are placeholders; this note says what real art should aim for.

### Palette

- Bright and saturated, with soft dark outlines (never pure black) and
  warm highlights. Shadows lean violet-blue, not grey.
- The five resource colours are the anchors and must stay distinct from each
  other and from the sides, in the light and dark themes: Ore copper
  `#b0713b`, Power (Spark) yellow `#e5c230`, Flux violet `#8a5cf6`, Composite
  (Sparksteel) pink `#e8548a`, Aether teal `#3fc7c0`. Everything else in a
  scene stays calmer so resource colours pop.
- Ground is a cool green-slate in plots and a dusty violet-brown in the
  neutral zone, so the neutral zone reads as "someone else's land".
- Resource-coloured parts use the three runtime tint greys already in
  `palette.ts`, so a palette swap recolours them.

### Shapes

- Chunky, rounded, a little toy-like: thick silhouettes, round corners,
  few thin parts.
- Readable at battle zoom: every unit identifiable by silhouette alone
  (tall and thin Lancer, round Golem, winged Whirligig, hooded Caster).
- Buildings fill their footprint; big things look big, long things look long.
- Faces and little details on units are fine, but never at the cost of a
  clear outline.

### Telling sides and guards apart

- The two sides keep their team ramps: blue (side A) and orange (side B),
  on the parts that take the tint (cloaks, banners, base rims). The shape of
  a unit never depends on its side.
- Neutral guards are grey-stone with a violet glint: no team colour, a
  mossy ruin base under their feet, and a small ring on the ground where
  they hold position. They look like part of the ruin, not like a third army.
- Points of interest show their state by glow: dull grey while guarded,
  side-coloured while held.

### How tiers show on a building

- Tier 1 is the plain version. Tier 2 adds a brass trim and one extra
  detail (a gauge, a chimney, a second lamp). Tier 3 adds a glowing crown or
  banner and a brighter resource-coloured core.
- The footprint and the position of inputs and outputs never change with
  tier, so a player never misreads a conduit connection.
- The UI also states the tier in text ("Tier 2"), so art does not have to
  carry it alone.
