# 03 — Combat: The Factory

Status: Draft v1.0

## Direction

- **CB-1 [DECIDED]** Combat is fully automated. Players give no input once a
  battle starts.
- **CB-2 [DECIDED]** Combat is **item-based**, in the family of *The Bazaar*
  and *Backpack Battles*: no units that move and fight. The board is an
  arrangement of items, and the items do the fighting.
- **CB-3 [DECIDED]** The game must be **its own thing**. Its core mechanic is
  the **shared factory**: the party's one board (CP-4) is an automation
  factory, in the spirit of *Factorio*, that runs by itself during battle.
- **CB-3a [DECIDED]** "Economy" in this game means **in-battle ramp** —
  machines that make the factory stronger the longer a battle lasts. It does
  not mean producing gold or anything else spent outside combat.
- **CB-3b [DECIDED]** Defense exists to **buy time**: for example, walls that
  slow down the enemy's attack while the party's factory ramps up.
- **CB-3c [DECIDED]** Rewards are a choice between **economy** (pays off
  later in the battle and later in the run) and **attack or defense**
  (helps immediately in the upcoming battles).

Everything below this line is [PROPOSED] detail unless marked otherwise.

How this differs from the references:

| | The Bazaar | Backpack Battles | This game |
|---|---|---|---|
| Board | One row per player | One bag per player | One large factory shared by the party |
| When an item fires | Its own cooldown | Its own cooldown (+ stamina) | When **charge** reaches it |
| What placement decides | Left/right adjacency | Adjacency in 2D | The **routes** charge takes |
| Power over a battle | Mostly flat, some scaling | Mostly flat, some scaling | **Starts cold and ramps**; how fast is a build choice |
| Co-op | None | None | 1–4 players build the same machine |

## The factory

### Charge and routing

- **CB-4** Time advances in fixed **ticks** (starting proposal: 2 per
  second). **Charge** is the one flow resource. It moves one item per tick
  along the routes the players have laid out.
- **CB-5** A charge has a **strength** and may carry **properties** added
  along the way (e.g. Burn). What an item does with a charge scales with its
  strength and applies its properties.
- **CB-6** Charge with nowhere to go is lost. An item nothing feeds never
  fires.
- **CB-7** Within a tick, items resolve in a fixed order (e.g. row by row,
  left to right); both sides' effects are then applied simultaneously.
- **CB-8** How direction works is open (Q2): fixed arrows, rotatable items,
  or "pass to any adjacent item".

### Item kinds

- **CB-9** Items have a **shape**, a **tier**, **tags**, and a **kind**:

| Kind | Role | Examples |
|------|------|----------|
| **Source** | Makes charge on a timer | Generator: 1 charge every 2 s |
| **Route** | Moves charge unchanged | Wire; Splitter (alternates two outputs) |
| **Modifier** | Changes charge passing through | Flame coil (+Burn); Amplifier (+strength); Capacitor (stores 3, releases one triple) |
| **Attack** | Consumes charge → damage to the enemy | Cannon; Dagger |
| **Defense** | Consumes charge → protection | Wall builder; Shield emitter; Repair bay |
| **Economy** | Consumes charge → the factory gets stronger for the rest of this battle | Overclocker (all generators faster per N charges); Foundry (raises the tier of an adjacent item after N charges); Reactor (becomes a new source once fed enough) |

- **CB-10** The party's **Core** is its health. It does not occupy cells.

### Every battle starts cold

- **CB-11** All battle state resets at the start of each battle: stored
  charge, economy upgrades, walls built, damage taken. What persists between
  battles is the **layout** and the items' permanent tiers.
- **CB-12** **Overload**: late in a battle, all damage on both sides
  escalates. Ramp usually ends battles on its own; Overload is the backstop
  against two fortified sides stalling.

### The three strategies

- **CB-13** Routing charge to one family means not routing it to another.
  This produces three broad strategies that beat each other in a circle,
  and that a party will usually mix:
  - **Rush** — charge goes to attack from the first second. Beats a factory
    that is still ramping.
  - **Fortify and ramp** — defense first, economy behind it, overwhelming
    late. Beats a rush that cannot break through in time.
  - **Siege** — steady, efficient damage that grinds through defenses before
    the ramp pays off.
- **CB-14** The party can **re-route before each battle** (prep phase,
  RS-6): lean one way for a PvE threat whose style is shown in advance,
  another way for the unknown PvP opponent.
- **CB-15** Reward choices follow the same split (CB-3c). Economy items are
  weak in the next battle but grow in value as the run goes on and enemies
  take longer to kill.

### Walls and defense

- **CB-16** Starting proposal: a **wall** is a barrier with its own health.
  Enemy attacks must destroy walls before they can damage the Core. Walls
  can be **placed** (an item that provides wall health from the first tick)
  or **built during the battle** by a defense machine fed with charge.
  Shields are a regenerating variant; repair restores Core health.
- **CB-17 [OPEN]** Whether there is a **physical space between the two
  factories** that attacks travel across — so walls literally stand in the
  way, can slow as well as block, and attacks could be aimed at parts of the
  enemy factory — or defense is an abstract barrier in front of the Core.
  The abstract version is simpler and is the default for the proof of
  concept; the physical version is closer to tower defense. See Q2.

### Space is the limiter

- **CB-18** Board area is the scarce resource. Wires, modifiers, and economy
  machines all take cells that could hold a source or a weapon.
- **CB-19** Expansion (extra rows, columns, or cells) is a major party reward
  or purchase whose cost rises steeply (CP-14).
- **CB-20** Space and steep costs are also what keeps ramp from outrunning
  PvE scaling forever (SC-8).

### Building

- **CB-21** Items are bought in shops and won as rewards. Combining
  duplicates raises an item's tier.
- **CB-22** Moving and rotating items already on the board is free, so the
  factory can be re-planned as it grows.
- **CB-23** Tag counts on the board unlock board-wide bonuses (e.g. enough
  Flame items makes all Burn stronger).

### Effect vocabulary (first playable)

- **CB-24** Keep it small: damage, wall, shield, repair, burn, charge
  strength up/down, split, store-and-release, generator rate up, tier up.
  A second resource type with simple recipes (e.g. ammunition, wall
  material) is a possible later layer; start with charge only.

## Opponents

- **CB-25** **Ghosts** are other parties' factories and run in the same
  simulation.
- **CB-26** **PvE enemies and bosses are scripted threats, not factories**:
  a health pool, optional defenses, and an attack pattern over time, scaled
  by the budget curve (SC-1). Generating a sensible factory procedurally is
  hard; a threat profile is easy to author, scale, and communicate.
  Archetypes map onto the three strategies so each tests something:
  - **Rusher** — heavy early damage; tests defense.
  - **Fortress** — huge health and walls, slow attack; tests ramp.
  - **Escalator** — ramps up itself; tests sustained damage and speed.
- **CB-27** PvE options show their archetype before the party commits
  (RS-3b), so preparing for it is a decision.

## Risks to test in the prototype

1. **Ramp versus the exponential wall.** In-battle economy can itself be
   exponential (machines speeding up machines). V-5 needs PvE to outgrow the
   party eventually. Limits: space (CB-18), caps or diminishing returns on
   in-battle upgrades, and PvE pressure that leaves less time to ramp at
   depth. The most important thing to model in the balance harness (SC-8).
2. **Balance of the three strategies.** If one is always best, the reward
   choice is not a choice.
3. **Build time.** Factory building is slow and thoughtful; phases are meant
   to be short (RS-12). Few new pieces per cycle, free rearrangement, and
   placement aids help; targets may need to grow.
4. **Readability.** A four-player board is ~100 cells of routed machinery.
   It must be legible to its builders and at least summarizable as an
   opponent (CB-41, CB-43).
5. **Battle length.** Ramp needs time, which pulls against short playback.
6. **Routing rules.** Loops, direction, and how large items take charge
   (Q2).

## Structural requirements

- **CB-30 [PROPOSED → effectively required]** Combat is **deterministic**:
  the outcome is a pure function of `(team, opponent, seed, game version)`.
  No wall-clock time, no floating-point nondeterminism, no unordered
  iteration, no platform-dependent behaviour.
- **CB-31** Combat runs in a **headless simulation** that produces an
  **event log**. Presentation renders playback from the log and never
  decides outcomes. The same simulation runs in the host's game
  (authoritative, TA-6), in tests, and in balance tools.
- **CB-32** A party is fully described by a serializable **team state**
  (CP-6): the one board, its items, Core stats, and run modifiers that
  affect combat. This is exactly what a snapshot stores (MM-1). Anything
  that affects combat must live in team state.
- **CB-33** If both Cores reach 0 on the same tick, a deterministic tiebreak
  applies (e.g. most overkill damage, then the defender/ghost wins).
- **CB-34** An **opponent** is either a team state (ghost) or a threat
  profile (PvE, CB-26). Both are data, and both run through the same
  simulation entry point.
- **CB-35** All content (items, tags, threat profiles) is **data-driven**:
  versioned data files, validated against schemas.
- **CB-36** The simulation must be fast enough for the balance harness to
  run thousands of four-plot battles; set a performance budget in the first
  simulation milestone.

## Playback and understanding the factory

- **CB-40** All party members watch the same battle in sync, each free to
  pan and zoom around the factory. Speed controls (1×/2×/skip) apply when
  all players agree, or automatically in solo.
- **CB-41** The opponent is shown as a summary by default — Core health,
  walls, damage by type over time — and can be opened in full if it is a
  ghost factory.
- **CB-42** A post-battle summary shows a timeline (damage, defense, and
  ramp over the battle for both sides) and per-item totals, so the party can
  see where the factory was wasteful or slow.
- **CB-43** **Preview while building:** the factory can be dry-run during
  events and prep phases to show charge flow and projected output over time,
  without an opponent.
- **CB-44** Any past battle can be replayed from
  `(team, opponent, seed, version)`.

## First playable content budget

- **CB-50** ~25 items across the six kinds, 3 PvE threat archetypes, 1 boss
  template. Enough to validate the loop; no more.
