# 01 — Run Structure

Status: Draft v0.4

## Core loop

```
Lobby -> [ 1. PvE battle -> 2. Event -> 3. PvP battle ] x N -> Defeat -> Run summary
```

- **RS-1 [DECIDED]** A run is an unbounded sequence of **cycles**. Each cycle
  has three steps, always in this order:
  1. **PvE battle** — the party chooses easy, medium, or hard.
  2. **Event** — a shop or another non-combat event.
  3. **PvP battle** — against a ghost, or a generated boss if no ghost
     matches (see `04-encounters-matchmaking.md`).
- **RS-2 [PROPOSED]** The **cycle number** is the single "progress" value used
  for PvE scaling and ghost matching. Every party at cycle *c* has had exactly
  the same number of PvE battles and events.

## Step 1 — PvE battle

- **RS-3 [DECIDED]** Before the battle, the party chooses a difficulty: easy,
  medium, or hard.
- **RS-3a [DECIDED]** Losing a PvE battle costs **no life**, but the party
  receives **no reward**.
- **RS-3b [PROPOSED]** Harder difficulties face a stronger enemy team and give
  a better reward (see SC-1, EC-7). The choice shows the enemy archetype and
  the reward for each option, and is made by party vote (CP-16).
- **RS-3c [PROPOSED]** Because a PvE loss is otherwise free, the reward gap
  between difficulties must make the choice a real risk decision: picking
  hard and losing should leave the party clearly behind a party that picked
  easy and won.

## Step 2 — Event

- **RS-4 [DECIDED]** The event step is a non-combat step. The shop is one
  event type; others exist.
- **RS-4a [PROPOSED]** Event types (first playable needs only the shop):
  - **Shop** — buy/sell items, re-roll.
  - **Trainer** — upgrade or modify an existing item.
  - **Shrine** — choose one of several run modifiers.
  - **Gamble** — risk gold or an item for a chance at something better.
- **RS-4b [OPEN]** How the event is selected, and whether a shop is always
  available. See `07-open-questions.md` Q4. Recommended: the party chooses
  between 2–3 offered events and a shop is always one of the options, so a
  party can never be locked out of spending for several cycles.

## Step 3 — PvP battle

- **RS-5 [DECIDED]** Losing a PvP battle costs **one life**.
- **RS-5a [PROPOSED]** A boss that replaces a ghost (V-4) is the PvP battle
  for that cycle and has the same stakes: losing costs one life.
- **RS-5b [PROPOSED]** There is one PvP battle per cycle. (Multiple PvP
  battles per cycle is recorded as an option in Q4.)
- **RS-5c [PROPOSED]** Winning a PvP battle grants a reward (EC-7).

## Team management

- **RS-6 [PROPOSED]** Acquiring things happens at events and through rewards.
  **Arranging** boards — placing and moving items, combining
  duplicates, swapping stash and board, giving to teammates — is available in
  a short **prep phase** before every battle (steps 1 and 3) as well as
  during the event. Without this, a reward from the PvE battle could not be
  used until after the PvP battle.

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

Note the interaction with V-5: lives are only lost in step 3, so the
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
  items, starting loadouts, and cosmetic records. Power unlocks would
  break ghost fairness, since a snapshot would encode account-level advantages.
- **RS-11 [OPEN]** Whether there are selectable heroes/classes per player at
  run start. See `07-open-questions.md` Q3.

## Session length targets

- **RS-12 [PROPOSED]** Prep phase: up to 30 s. Event: 45–90 s. Battle
  playback: 20–45 s (hard combat time limit; fast-forward when all players
  agree). A cycle is about 3–5 minutes; a median run is 30–45 minutes.
