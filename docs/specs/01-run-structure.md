# 01 — Run Structure

Status: Draft v3.3

## Core loop

Before the first cycle, the party's map is generated and revealed and the
team places its Core, which then stays put for the whole run (CB-3e, CB-7).

```
Lobby -> Map + Core placement ->
  [ PvE battle -> Event -> Shop -> PvP battle -> Event -> Shop ] x N
-> Defeat -> Run summary
```

- **RS-1 [DECIDED]** A run is an unbounded sequence of **cycles**. A cycle
  has two battles — a **PvE battle** and then a **PvP battle** — and
  **after each battle there is an event, and after the event there is
  always a shop**:
  1. **PvE battle** — the party chooses easy, medium, or hard.
  2. **Event**
  3. **Shop**
  4. **PvP battle** — against a ghost, or a generated boss if no ghost
     matches (see `04-encounters-matchmaking.md`).
  5. **Event**
  6. **Shop**
- **RS-2 [PROPOSED]** The **cycle number** is the single "progress" value used
  for PvE scaling and ghost matching. Every party at cycle *c* has had exactly
  the same number of battles, events, and shops.
- **RS-2a [PROPOSED]** A new run opens with a starting set of buildings and a
  first build phase before the first PvE battle, so the party never enters
  a battle with an empty board.

## PvE battle

- **RS-3 [DECIDED]** Before the battle, the party chooses a difficulty: easy,
  medium, or hard.
- **RS-3a [DECIDED]** Losing a PvE battle costs **no life**, but the party
  receives **no reward**.
- **RS-3b [PROPOSED]** Harder difficulties face a stronger threat and give
  a better reward (see SC-1, EC-7). The choice shows the enemy archetype and
  the reward for each option, and is made by party vote (CP-16).
- **RS-3c [PROPOSED]** Because a PvE loss is otherwise free, the reward gap
  between difficulties must make the choice a real risk decision: picking
  hard and losing should leave the party clearly behind a party that picked
  easy and won.

## Event

- **RS-4 [DECIDED]** An event follows every battle. Events are separate from
  the shop: the shop is its own guaranteed step, not an event type.
- **RS-4a [DECIDED as a starting set; to be refined later]** An event is a
  short non-combat moment that changes the run in some way other than
  buying. Starting types:
  - **Workshop** — upgrade or modify a building the party owns.
  - **Shrine** — choose one of several run modifiers.
  - **Gamble** — risk gold or a building for a chance at something better.
  - **Salvage** — trade buildings in for something of a different kind.
  - **Survey** — information about what is coming (the next PvE options, or
    a hint about the next opponent).
- **RS-4b [DECIDED]** At each event step the **party picks one of three
  offered events**. The choice is made by party vote (CP-16).
- **RS-4d [PROPOSED]** The three offers are drawn at random from the event
  types available at that depth, without duplicates. Each offer shows what
  it does before the party chooses.
- **RS-4c [PROPOSED]** The first playable can ship with one or two event
  types; the step exists from the start so the loop has its final shape.

## Shop

- **RS-5d [DECIDED]** A shop **always** follows the event. Every battle is
  therefore followed by a chance to buy.
- **RS-5e [PROPOSED]** In the shop each player sees their own offers and
  spends their own gold on buildings and re-rolls (EC-2, CP-10), and can
  sell buildings back.
- **RS-5f [PROPOSED]** The shop step is also the **build phase**: the whole
  board is open for placing, moving, rotating, and re-routing, and it is the
  last stop before the next battle.

## PvP battle

- **RS-5 [DECIDED]** Losing a PvP battle costs **one life**.
- **RS-5a [PROPOSED]** A boss that replaces a ghost (V-4) is the PvP battle
  for that cycle and has the same stakes: losing costs one life.
- **RS-5b [PROPOSED]** There is one PvP battle per cycle.
- **RS-5c [PROPOSED]** Winning a PvP battle grants a reward (EC-7).

## Building the factory

- **RS-6 [PROPOSED]** New buildings come from shops, battle rewards, and
  some events. **Arranging** the factory — placing, moving, rotating, and
  re-routing buildings, drawing conduits, combining duplicates, giving to
  teammates — happens during the shop step (RS-5f), which always comes
  immediately before a battle. No separate prep phase is needed.
- **RS-6a [PROPOSED]** The next PvE options (archetype and reward) are
  visible during the shop before the PvE battle, so the party can build for
  the threat it intends to pick. The next PvP opponent is never visible in
  advance.

## Lives and run end

- **RS-7 [DECIDED]** The party starts with **5 lives**.
- **RS-7a [PROPOSED]** Lives are a single pool shared by the party, and the
  count is 5 regardless of party size.
- **RS-7b [DECIDED]** There is no victory condition. PvE scaling guarantees
  eventual defeat (V-5). The run ends when lives reach 0.
- **RS-7c [PROPOSED]** No way to regain lives in the first playable. (A rare,
  expensive event option could be added later.)
- **RS-7d [PROPOSED]** A party may abandon a run at any time; it is recorded
  at its current depth.

Note the interaction with V-5: lives are only lost in PvP battles, so the
exponential wall must reach the party there. It does so in two ways — bosses
replace ghosts as the pool thins at depth (MM-10), and lost PvE battles stop
the party's income so it falls behind the ghosts it meets. See
`05-scaling-economy.md` "How runs end".

## Score and run summary

- **RS-8 [PROPOSED]** Primary score: **depth** (highest cycle reached).
  Secondary: PvP win count and win rate against ghosts.
- **RS-9 [PROPOSED]** The run summary shows depth, the final team, a per-cycle
  history, and which ghosts were fought (party display names only).

## Meta-progression

- **RS-10 [PROPOSED]** Meta-progression unlocks **options, not power**: new
  buildings, starting loadouts, and cosmetic records. Power unlocks would
  break ghost fairness, since a snapshot would encode player-level advantages.

## Pace

- **RS-12 [DECIDED]** No step is timed. A step ends when every player has
  readied up (CP-17). There are no session-length targets to hit; a run
  takes as long as the party wants to spend thinking.
- **RS-12a [PROPOSED]** Because runs can be long, they must be easy to stop
  and resume (CP-22, CP-23). Battle playback keeps its speed controls.
