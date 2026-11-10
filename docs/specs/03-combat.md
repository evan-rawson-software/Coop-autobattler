# 03 — Combat

Status: Draft v0.4

## Direction

- **CB-1 [DECIDED]** Combat is fully automated. Players give no input once a
  battle starts.
- **CB-2 [DECIDED]** Combat is **item-based**, in the family of *The Bazaar*
  and *Backpack Battles*: there are no units that move and fight. A player's
  board is an arrangement of items, and the items do the fighting.
- **CB-3 [DECIDED]** The system must be **distinct enough to be its own
  thing**, not a re-skin of either reference. It needs a core mechanic neither
  of them has.

What the references do, so the difference is explicit:

| | The Bazaar | Backpack Battles | This game (proposed) |
|---|---|---|---|
| Layout | One row; items have widths | 2D bag; items have shapes | 2D board; items have shapes |
| When an item fires | Its own cooldown timer | Its own cooldown timer (+ stamina) | When the **pulse** sweeps over it |
| What placement decides | Left/right adjacency | Adjacency in 2D | Adjacency **and timing/order** |
| Speed effects | Haste/slow per item | Per-item speed, stamina | **Tempo** of the whole board; effects that bend the pulse |
| Players per side | 1 | 1 | 1–4 boards in lanes |

## Recommended concept: the Pulse [PROPOSED]

Each board is a grid with a **pulse** that sweeps across it, column by column,
and loops. Items fire when the pulse reaches them. There are no per-item
cooldowns: **where** an item sits decides **when** it fires and what has
already happened by then. The board is read like a step sequencer.

### Board and items

- **CB-4** A board is a grid (starting proposal: 8 columns × 3 rows).
- **CB-5** Items have a **shape** (1×1, 2×1, 1×2, 2×2, L, …), a **tier**,
  **tags** (e.g. Blade, Flame, Ward, Tool), and one or more **effects**.
- **CB-6** Each board has a **Core** with health. The Core is what enemy
  items attack. It is not an item and does not occupy grid cells.

### The pulse

- **CB-7** Time is divided into **beats**. Each beat, the pulse advances one
  column. After the last column it wraps to the first; one full sweep is a
  **bar**.
- **CB-8** An item **fires** when the pulse enters its leftmost column. Wide
  items therefore fire once per bar like any other item but occupy more of
  the timeline — size is paid for in board space, not in a longer cooldown.
- **CB-9** Items in the same column resolve top row to bottom row. Both
  sides' effects within the same beat are computed, then applied
  simultaneously.
- **CB-10** **Tempo** is a board-level stat: how many beats the board plays
  per unit of time. Haste raises a board's tempo and slow lowers it. Two
  opposing boards can run at different tempos.
- **CB-11** A small set of effects **bend the pulse**, and these are the
  signature of the game:
  - *Echo* — re-fire the previous column.
  - *Skip* — jump the pulse forward N columns (reach your finisher sooner,
    at the cost of what was skipped).
  - *Split* — spawn a second pulse for one bar.
  - *Hold* — the pulse stays on this column an extra beat, firing it twice.
  - *Jam* (enemy-targeted) — the enemy pulse skips its next column, or one
    enemy item is silenced for a bar.
- **CB-12** **Crescendo**: each completed bar increases all damage on both
  sides by a fixed percentage. This is the built-in sudden death — battles
  cannot stall, and there is no separate timeout rule.

### Placement depth

- **CB-13** **Order**: effects that set something up (apply burn, add charge,
  mark the enemy) want to sit left of the items that cash it in.
- **CB-14** **Adjacency**: many effects refer to orthogonally adjacent items
  ("adjacent Blades gain +X", "when the item to my left fires, …").
- **CB-15** **Column stacking**: items sharing a column fire on the same
  beat, enabling burst turns and "all items in this column" effects.
- **CB-16** **Tag counts**: having enough items with a tag on a board unlocks
  a board bonus.

### Effect vocabulary (first playable)

- **CB-17** Keep it small: damage, shield, heal, burn (damage over time),
  charge (stored bonus consumed by the next eligible item), tempo up/down,
  and the pulse effects in CB-11. Complexity should come from combinations
  and placement, not from a long keyword list.

### Building

- **CB-18** Items are bought in shops and won as rewards. Combining
  duplicates raises an item's tier.
- **CB-19** Players have a small **stash** for items not on the board.
- **CB-20** Board size may grow during a run (e.g. unlock extra columns), as
  a major upgrade. More columns means more room but a longer bar.

### With 1–4 boards

Fits the lane model in `02-coop-party.md` (CP-8) without units:

- **CB-21** Each board attacks the Core of the board in the opposite lane.
- **CB-22** When a Core reaches 0 health, that board **goes dark**: its pulse
  stops. Boards that were attacking it retarget to the nearest enemy lane
  with a live Core. This is the "reinforcement" behaviour.
- **CB-23** A side loses when all of its Cores are dark.
- **CB-24** **Cross-board effects** (CP-12) have natural hooks here: shield or
  heal an adjacent lane's Core; "when the pulse on the board to my left
  completes a bar, …"; a *Relay* that hands charge to the next lane. Every
  such effect must define what it does with one board, so solo has no dead
  content.

### Why this one

- Distinct: timing from position is a mechanic neither reference has, and
  pulse-bending effects give the game its own vocabulary.
- Readable: a moving line across each board shows exactly what is about to
  happen, which matters with up to 8 boards on screen.
- Deterministic by construction: discrete beats, fixed resolution order.
- Cheap to build and render compared with units, pathing, and targeting.

## Alternative concepts considered

- **Gearworks.** Each board is a wheel of item slots turning past a striker;
  an item fires when it reaches the top. In co-op, neighbouring players'
  wheels mesh like gears, so the items at the contact point interact and one
  player's speed drives the next. Very strong co-op identity and theme, but
  only one dimension of placement and a harder UI.
- **Conduits.** Items do not fire on their own; generator items produce
  charge that flows through adjacent items along paths the player lays out,
  and weapon items fire when charge reaches them. A routing/engine-building
  puzzle. Deep, but harder to read at a glance and slower to build under a
  timer.

Elements can be borrowed: a "conduit" tag family or gear-like cross-lane
links could live inside the Pulse system as content.

## Structural requirements (independent of concept)

- **CB-30 [PROPOSED → effectively required]** Combat is **deterministic**:
  the outcome is a pure function of `(team A, team B, seed, game version)`.
  No wall-clock time, no floating-point nondeterminism, no unordered
  iteration, no platform-dependent behaviour.
- **CB-31 [PROPOSED]** Combat runs in a **headless simulation** that produces
  an **event log**. Clients render playback from the log; they never decide
  outcomes. The same simulation runs on the server (authoritative), in tests,
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

- **CB-50 [PROPOSED]** ~25 items across 4 tags, 3 pulse-bending effects,
  1 boss template. Enough to validate the loop; no more.
