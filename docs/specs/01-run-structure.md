# 01 — Run Structure

Status: Draft v5.1

## Core loop

Before the first round, the party's map is generated and revealed and each
player places their own Core in their own plot; the Cores then stay put for
the whole run (CB-3e, CB-7, CP-26).

```
Lobby -> Map + Core placement ->
  [ PvE battle -> Event -> Shop -> PvP battle -> Event -> Shop ] x N
-> Defeat -> Run summary
```

- **RS-1 [DECIDED]** A run is an unbounded sequence of **rounds**. A round
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
- **RS-2 [PROPOSED]** The **round number** is the single "progress" value used
  for PvE scaling and ghost matching. Every party at round *r* has had exactly
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
- **RS-4a [DECIDED]** An event is a short non-combat moment that changes the
  run in some way other than buying. The set is nine types (the numbers in
  RS-4i are PROPOSED, and the names are working names):
  - **Workshop** — every player may raise one building they own by one
    tier (never above tier 3), paying 80% of that tier's shop price from
    their own gold, or skip. The party votes on the event; each player then
    chooses for themselves, and it is offered only if some player can afford
    an upgrade.
  - **Shrine** — choose one of several run modifiers.
  - **Windfall** — every player gets some gold at once. No follow-up.
  - **Market day** — each player's next shop has one extra offer and a free
    first re-roll (RS-4i1).
  - **Drill** — each player may raise one of their own collectors by one tier
    for free (RS-4i2).
  - **Caravan** — a draft of rewards: each player takes one in turn
    (RS-4h, RS-4i3).
  - **Rich vein** — each player may add one resource node of a named type to
    their own plot (RS-4i4).
  - **Blueprint** — each player picks one of three rare buildings and finds it
    in their next shop (RS-4i5).
  - **Pact** — one strong run modifier paired with a drawback; take both or
    skip (RS-4i6).

  Considered, not planned: Gamble (stake gold for a chance at more), Salvage
  (trade a building in for gold), Survey (extra information about the coming
  PvE battles), Clear ground and Mercenaries.
- **RS-4b [DECIDED]** At each event step the **party picks one of up to
  three offered events** (never two of the same type). The choice is made by party vote (CP-16).
- **RS-4d [DECIDED]** Up to three events are offered, drawn at random from
  the event types available at that depth (RS-4g), and never two of the same type.
  When fewer types are available the party is offered fewer (two, or one).
  Each offer shows what it does before the party chooses.
- **RS-4e [DECIDED]** Stackable run modifiers have no cap. Bonuses of the same
  kind are summed and applied once (never compounded), so each extra stack is
  worth relatively less.
- **RS-4f [DECIDED]** Drawbacks are opt-in. An event may pair a benefit with
  a cost, but the cost is shown before the vote, and skipping never harms the
  party. There are no forced costs and no curses.
- **RS-4g [DECIDED]** An event definition may have a first round
  (`fromRound`). It is offered only from that round on. This is what "available
  at that depth" means in RS-4d.
- **RS-4h [DECIDED]** **Caravan** is a draft, not a vote on rewards. It lists
  `players + 1` rewards (solo: 2). Players choose one each in turn, each reward
  can be taken once, and the last one is left. The order players choose in
  rotates from one Caravan to the next. At most one reward is party-wide; the
  rest go to the player who took them, from the event and not from a teammate
  (CP-29).
- **RS-4i [PROPOSED]** The new events, with their numbers. Each is offered only
  from its first round (RS-4g), and the numbers are configuration.
  - **RS-4i1 [PROPOSED] Market day** (from round 2). Each player's next shop,
    the one right after this event, has one extra offer and a free first
    re-roll. No follow-up.
  - **RS-4i2 [PROPOSED] Drill** (from round 2). Each player may raise one of
    their own collectors by one tier for free, or skip. Offered only when some
    player has a collector below tier 3. Follow-up per player, like the
    Workshop.
  - **RS-4i3 [PROPOSED] Caravan** (from round 2). Rewards: gold, a free tier-1
    building for the stash, a free tier raise of one of your buildings, a new
    resource node (only once Rich vein exists), and at most one party-wide run
    modifier. The draft follows RS-4h.
  - **RS-4i4 [PROPOSED] Rich vein** (from round 3). The offer names a resource
    type before the vote. The type is random, weighted like map nodes (CB-5a:
    Ore and Power common, Flux rare). Each player may add one node of that type
    on an empty cell of their own plot, or skip. At most 3 added nodes per plot
    per run.
  - **RS-4i5 [PROPOSED] Blueprint** (from round 3). Each player chooses one of
    3 rare buildings eligible at this round. It is held in a fixed slot of
    their next shop that re-rolls do not replace, and it is still paid for. It
    helps finish a refining chain.
  - **RS-4i6 [PROPOSED] Pact** (from round 4). One strong run modifier paired
    with a drawback, for example +20% unit strength and -15% Core health. Take
    both or skip; the party vote on the event is the choice. Each pact can be
    taken once per run.
- **RS-4j [DECIDED]** Held run modifiers are always visible. Once taken, a
  modifier is shown on every run screen (the run bar), with the effects
  totalled and drawbacks marked (issue #418).

## Shop

- **RS-5d [DECIDED]** A shop **always** follows the event. Every battle is
  therefore followed by a chance to buy.
- **RS-5e [PROPOSED]** In the shop each player sees their own offers and
  spends their own gold on buildings and re-rolls (EC-2, CP-10), and can
  sell buildings back.
- **RS-5f [PROPOSED]** The shop step is also the **build phase**: each
  player's own plot is open to that player for placing, moving, rotating,
  and re-routing (CP-27, CP-28), border links can be drawn and removed
  (CP-30), and it is the last stop before the next battle.
- **RS-5g [DECIDED]** **Undo covers layout changes only**: placing, moving,
  rotating, and drawing or erasing conduits can be undone and redone within
  the current shop step, since they are free anyway. Buying, selling, and
  re-rolling can never be undone.

## PvP battle

- **RS-5 [DECIDED]** Losing a PvP battle costs **one life** from the party's
  shared pool, however many of the party's Cores fell. A battle is lost when
  all of the party's Cores are destroyed (CB-17). Cores destroyed in a
  battle the party went on to win cost nothing; like all battle damage they
  are restored for the next battle (CB-11).
- **RS-5a [PROPOSED]** A boss that replaces a ghost (V-4) is the PvP battle
  for that round and has the same stakes: losing costs one life.
- **RS-5b [PROPOSED]** There is one PvP battle per round.
- **RS-5c [PROPOSED]** Winning a PvP battle grants a reward (EC-7).

## Building the factory

- **RS-6 [DECIDED]** **Battle rewards are gold. Buildings are acquired in
  the shop.** The only buildings that do not come from a shop are the
  starting kit (RS-2a). **Arranging** the factory — placing, moving, rotating, and
  re-routing buildings, drawing conduits and border links — happens
  during the shop step (RS-5f), which always comes
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
- **RS-7d [DECIDED]** Players can leave a run at any time. Only the host can
  fully abandon a run; an abandoned run is recorded at its current depth
  (CP-21d) and counts toward depth records and ghosts like a defeat. A save
  the game cannot open can be removed from the saves list ("Remove save"; it
  is deleted, with no summary and no record). Saves from an older major
  version are deleted at start-up even if they cannot be read.

Note the interaction with V-5: lives are only lost in PvP battles, so the
exponential wall must reach the party there. It does so in two ways — bosses
replace ghosts as the pool thins at depth (MM-10), and lost PvE battles cut
the party's income to a trickle, so it falls behind the ghosts it meets. See
`05-scaling-economy.md` "How runs end".

## Score and run summary

- **RS-8 [PROPOSED]** Primary score: **depth** (highest round reached).
  Secondary: PvP win count and win rate against ghosts.
- **RS-9 [PROPOSED]** The run summary shows depth, the final team, a per-round
  history that names each ghost party fought (display names only).

## Meta-progression

- **RS-10 [DECIDED for now]** There is **no meta-progression**. Nothing
  carries over from one run to the next except records such as depth
  reached. To be reconsidered once the game has been played.

## Pace

- **RS-12 [DECIDED]** No step is timed, and the party only moves on when
  every player is ready (CP-17). There are no session-length targets to
  hit; a run takes as long as the party wants to spend thinking.
- **RS-12b [PROPOSED]** How each step ends:
  - **Core placement** (start of run) — every player places their own Core
    in their own plot (CP-26) and readies up. A player can change their
    choice until the step ends: freely while they are not ready, and after
    un-readying otherwise (Ready locks it like any edit, CP-17a). The step
    ends when every player has placed a Core and is ready. There is no vote.
  - **PvE difficulty choice** — every player votes; the battle starts when
    all have voted.
  - **Battle** — playback ends at a summary; the party moves on when every
    connected player has readied up there.
  - **Event** — every player votes, **including any player who is
    disconnected**: the event waits for them (CP-21h). It resolves when all
    have voted and any follow-up choice has been made.
  - **Shop and build** — every player readies up.
- **RS-12a [PROPOSED]** Because runs can be long, they must be easy to stop
  and resume (CP-22, CP-23). Battle playback keeps its speed controls.
