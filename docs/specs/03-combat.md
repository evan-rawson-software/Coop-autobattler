# 03 — Combat

Status: Draft v0.9

## Direction

- **CB-1 [DECIDED]** Combat is fully automated. Players give no input once a
  battle starts.
- **CB-2 [DECIDED]** Combat is **item-based**, in the family of *The Bazaar*
  and *Backpack Battles*: there are no units that move and fight. A player's
  board is an arrangement of items, and the items do the fighting.
- **CB-3 [DECIDED]** The system must be **distinct enough to be its own
  thing**, not a re-skin of either reference. It needs a core mechanic neither
  of them has.

## Status of the core mechanic

- **CB-3a [DECIDED]** Two earlier candidates are **rejected**: the Pulse (a
  sweep that fires items in column order) and Gearworks (rotating wheels of
  items).
- **CB-3b [OPEN]** **Conduits** is the leading candidate — "the best idea so
  far", not yet confirmed. It is described below so it can be evaluated and
  prototyped. A wireframe exists (shared with the project owner outside the
  repo). If it is not adopted, this section is replaced; the structural
  requirements further down hold either way.

What the references do, so the difference is explicit:

| | The Bazaar | Backpack Battles | Conduits (candidate) |
|---|---|---|---|
| Layout | One row; items have widths | 2D bag; items have shapes | 2D board; items have shapes |
| When an item fires | Its own cooldown timer | Its own cooldown timer (+ stamina) | When **charge** reaches it |
| What placement decides | Left/right adjacency | Adjacency in 2D | The **route** charge takes: what feeds what, in what order, how far |
| Speed | Haste/slow per item | Per-item speed, stamina | Generator rate and route length |
| Players per side | 1 | 1 | 1–4 boards; charge can cross between teammates |

## Candidate concept: Conduits [PROPOSED]

Nothing on the board has its own timer except generators. Generators make
**charge**; charge travels from item to item along the route the player lays
out; outputs fire when charge reaches them. Building a board is building a
circuit.

### Board and items

- **CB-4** A board is a grid (starting proposal: 6 columns × 4 rows).
- **CB-5** Items have a **shape**, a **tier**, **tags**, and a **kind**:
  - **Source** — makes charge on a timer (e.g. Generator: 1 charge every 2 s).
  - **Route** — moves charge without changing it (Wire; Splitter, which
    alternates between two outputs).
  - **Modifier** — changes charge passing through (Flame coil adds Burn;
    Amplifier increases strength; Capacitor holds charges until it has 3,
    then releases one triple-strength charge).
  - **Output** — fires when charge arrives, consuming it (Cannon: damage per
    charge; Shield emitter: shield per charge).
- **CB-6** Each board has a **Core** with health. The Core is what enemy
  outputs attack. It is not an item and does not occupy grid cells.

### Charge

- **CB-7** Time advances in fixed **ticks**. Charge moves one item per tick
  (starting proposal: 2 ticks per second).
- **CB-8** A charge has a **strength** and may carry **properties** added by
  modifiers (e.g. Burn). An output's effect scales with the strength and
  applies the properties.
- **CB-9** Items send charge out of defined sides. How direction works is
  open (Q2): fixed arrows, rotatable items, or "pass to any adjacent item".
- **CB-10** Within a tick, items resolve in a fixed order (e.g. row by row,
  left to right), and both sides' effects are applied simultaneously.
- **CB-11** Charge that has nowhere to go is lost. An output nothing feeds
  never fires.
- **CB-12** **Overload**: as a battle goes on, generators speed up (or all
  damage increases) on both sides, so battles cannot stall and there is no
  separate timeout rule.

### Placement depth

- **CB-13** **Route length**: each modifier on a route makes the hit stronger
  and later; a short circuit fires early and often but weakly.
- **CB-14** **Sharing**: a splitter lets one source feed several outputs,
  each less often; several sources can feed one output.
- **CB-15** **Order on the route**: a capacitor after a flame coil stores
  burning charges; before it, the coil sees one large charge.
- **CB-16** **Space**: wires and modifiers use cells that could hold another
  source or output. Tag counts on a board unlock board bonuses.

### Effect vocabulary (first playable)

- **CB-17** Keep it small: damage, shield, heal, burn, charge strength
  up/down, split, store-and-release, generator rate up/down.

### Building

- **CB-18** Items are bought in shops and won as rewards. Combining
  duplicates raises an item's tier.
- **CB-19** Players have a small **stash** for items not on the board.
- **CB-20** Board size may grow during a run as a major upgrade.

### With 1–4 boards

- **CB-21** Each board's outputs attack the Core of the board in the opposite
  lane (CP-8).
- **CB-22** When a Core reaches 0 health, that board **goes dark**: its
  sources stop. Boards that were attacking it retarget to the nearest enemy
  lane with a live Core.
- **CB-23** A side loses when all of its Cores are dark.
- **CB-24** **Links**: a Link item on a board edge passes charge into the
  adjacent teammate's board. One player can build the power plant and
  another the weapons. This is the signature co-op mechanic of the concept.
  In solo, Link items do not appear or have a simpler effect, so there is no
  dead content.

### Why this one

- Distinct: neither reference has charge routing; the board is an engine the
  player wires up, not a set of independent timers.
- Co-op falls out of the mechanic (Links) instead of being bolted on.
- Deterministic by construction: discrete ticks, fixed resolution order.

### Risks to test in the prototype

- **Readability**: can a player see at a glance what a board does,
  especially an opponent's, and with up to 8 boards in a battle?
- **Build time**: is wiring a circuit feasible under an event/prep timer, or
  does it need generous timers and good placement aids?
- **Loops**: are routes allowed to loop back, and what bounds them?
- **Interaction**: can a side disrupt the enemy circuit (cut a wire, drain a
  capacitor), or only attack the Core?
- **Large items**: how a 2×2 item takes charge from several sides.

## Rejected concepts

- **The Pulse** — a sweep crosses the board and fires items in column order.
  Rejected by the project owner.
- **Gearworks** — each board is a wheel of items turning past a striker,
  with teammates' wheels meshing. Rejected by the project owner.

## Structural requirements (independent of concept)

- **CB-30 [PROPOSED → effectively required]** Combat is **deterministic**:
  the outcome is a pure function of `(team A, team B, seed, game version)`.
  No wall-clock time, no floating-point nondeterminism, no unordered
  iteration, no platform-dependent behaviour.
- **CB-31 [PROPOSED]** Combat runs in a **headless simulation** that produces
  an **event log**. Clients render playback from the log; they never decide
  outcomes. The same simulation runs in the host's game (authoritative, TA-6), in tests,
  and in balance tools.
- **CB-32 [PROPOSED]** A team is fully described by a serializable **team
  state**: an ordered list of **board states**, one per player (CP-6). Each
  board state holds its grid size, items with tiers and positions, Core
  stats, and any run modifiers that affect combat. This is exactly what a
  snapshot stores (MM-1). Anything that affects combat must live in team
  state.
- **CB-33 [PROPOSED]** If both sides' last Cores go dark on the same beat,
  a deterministic tiebreak applies (e.g. most overkill damage dealt, then the
  defender/ghost wins).
- **CB-34 [PROPOSED]** PvE opponents and ghosts use the **same team state
  format and the same simulation** as player teams. A boss is a team state
  built by a generator; boss-only items are normal content.
- **CB-35 [PROPOSED]** All content (items, tags, encounters) is
  **data-driven**: defined in versioned data files, validated against
  schemas, and loadable by the headless simulation.
- **CB-36 [PROPOSED]** The simulation must be fast enough for the balance
  harness to run thousands of 4v4 battles; set a performance budget in M0.

## Playback

- **CB-40 [PROPOSED]** All party members watch the same playback in sync,
  showing every lane with the viewer's own emphasized and any lane
  focusable. Speed controls (1×/2×/skip) apply when all players agree, or
  automatically in solo.
- **CB-41 [PROPOSED]** A post-battle summary shows damage dealt, blocked, and
  healed per item and per board, to support build discussion.
- **CB-42 [PROPOSED]** Any past battle can be replayed from
  `(snapshot A, snapshot B, seed, version)`.

## First playable content budget

- **CB-50 [PROPOSED]** ~25 items across the four kinds (source, route, modifier, output),
  1 boss template. Enough to validate the loop; no more.
