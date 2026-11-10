# 02 — Co-op & Party

Status: Draft v3.3

## Party basics

- **CP-1 [DECIDED]** A party has 1–4 players.
- **CP-2 [PROPOSED]** Party size is fixed when the run starts. It is part of
  the matchmaking key (MM-2), so it cannot change mid-run.
- **CP-3 [PROPOSED]** Parties form through **Steam lobbies**: invite friends
  or join through the Steam overlay. Public matchmaking of strangers into a
  party is out of scope initially.
- **CP-3a [PROPOSED]** The lobby owner is the **host**; their game is the
  authority for the run (TA-6).

## One shared factory

- **CP-4 [DECIDED]** The whole party builds **one large shared board** — a
  factory (see `03-combat.md`). Players coordinate to build the best overall
  factory. (This replaces the earlier one-board-per-player model.)
- **CP-5 [PROPOSED]** Board area scales with party size: each player adds one
  **plot** of the same size (starting proposal: about 24×16 cells, CB-4),
  joined side by side into a single continuous map, so the front edge gets
  wider with each player. Solo plays on one plot.
  Everything therefore scales linearly from 1 to 4 players.
- **CP-6 [PROPOSED]** The party's **team state** is that one board: its map
  (terrain, resource nodes, natural features), the Core position, buildings
  with tiers, positions and orientation, and run modifiers. It is what combat consumes and what a snapshot stores
  (CB-32, MM-1).
- **CP-7 [PROPOSED]** Opponents are scaled to party size: ghosts match on
  party size and so have the same area (MM-2); PvE threats are scaled by the
  number of plots (SC-1).
- **CP-8 [PROPOSED]** The party has **one Core** (health scaled by party
  size) and fights **one battle** against one opponent. There are no lanes
  and no per-player results.
- **CP-9 [PROPOSED]** Solo is the same game on one plot, with no special
  rules.
- **CP-9a [DECIDED/PROPOSED detail]** The team chooses the Core's position
  together at the start of the run (CB-3e): any player can propose a spot on
  the map, and the party confirms by vote (CP-16).

## Who owns what

- **CP-10 [PROPOSED]** Each player has their **own gold, own shop offers, and
  own stash**. Buying is an individual decision. This keeps personal agency
  inside a shared build and makes it harder for one player to play the game
  for everyone.
- **CP-11 [PROPOSED]** **Giving.** Players can give gold and buildings to
  teammates during events and shops, freely and instantly.
- **CP-12 [PROPOSED]** **Space is shared.** A player can place their buildings
  anywhere on the board, not only on "their" plot. Plots determine the
  board's size, not territory.
- **CP-13 [PROPOSED]** Each building shows who placed it. Starting rule: anyone
  can move or rotate any building (it is a co-op game among friends, and
  re-routing the factory often means moving several players' pieces); only
  the owner can sell it. To be revisited after co-op playtests.
- **CP-14 [PROPOSED]** **Party picks.** Some rewards belong to the party as a
  whole — a choice of one building among several, a Core
  upgrade — and are decided together (CP-16). Resource nodes are party
  property too: who builds the source on a node is something to agree on.

## Shared stakes

- **CP-15 [PROPOSED]** Lives are a single shared pool (RS-7a). The party wins
  and loses battles together.
- **CP-16 [PROPOSED]** Party-wide choices (PvE difficulty, which event to
  take, party picks) use a quick vote; ties broken by the party leader or
  randomly.

## Building together

- **CP-17 [DECIDED]** **There are no timers.** Events, shops, and building
  are never timed; players are not rushed and play at their own pace.
  **Every player must ready up before the party moves on to the next
  step.**
- **CP-17a [PROPOSED]** All players act at the same time within a step
  (everyone shops and builds simultaneously), and any player can un-ready
  until the last player readies. Event votes work the same way: the event
  resolves once everyone has voted.
- **CP-18 [PROPOSED]** **Simultaneous editing.** All players edit the same
  board at once and see each other's changes live, with each player's cursor
  and held building visible. If two players act on the same cell or building, the
  first action the host receives wins and the other player is shown why
  theirs did not apply.
- **CP-19 [PROPOSED]** Coordination aids: see teammates' gold, stashes, and
  shops (read-only); pings and markers on board cells and shop buildings
  ("put a generator here", "buy this"); a shared view of what the factory
  will do (CB-43).
- **CP-20 [PROPOSED]** Solo follows the same rule with one player: the step
  ends when they say so.

## Disconnects and leavers

- **CP-21 [PROPOSED]** A disconnected player's buildings stay on the board and
  keep working. They can rejoin at any time while the run is live. The run
  keeps its original party size (and board size) for matchmaking. If the
  host disconnects, the run pauses until a remaining player re-hosts (TA-11).
- **CP-22 [PROPOSED]** While a player is absent, their gold and shop are
  frozen; teammates can still move their buildings (CP-13).
- **CP-22a [PROPOSED]** A disconnected player is not waited for: only
  connected players need to ready up, so one dropped connection cannot stall
  the party. A connected but idle player does hold the party; that is
  accepted among friends, and the others can see who has not readied.
- **CP-23 [PROPOSED]** Runs are resumable: if everyone leaves, the run is
  suspended at the start of the current step and can be continued later by
  the same party from the save in Steam Cloud (TA-12). Suspended runs on an
  old game version are closed out at their current depth (TA-9).

## Balance across party sizes

- **CP-24 [PROPOSED]** Area, income, Core health, and PvE threat all scale
  linearly with party size. A larger continuous board allows longer routes
  and bigger combined engines than a small one, so larger parties may be
  somewhat stronger per player; ghosts only ever meet the same party size
  (V-3), so this matters only for PvE tuning and for leaderboards, which are
  kept **per party size**.

## Risks specific to the shared board

- **One player running the show.** Shared space invites it. Personal gold
  and shops (CP-10) are the main counterweight. Cannot be tested until co-op
  exists.
- **Editing conflicts and clutter** with four people rearranging one
  machine. CP-18 and CP-19 are the mitigations.
