# 02 — Co-op & Party

Status: Draft v4.4

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
  with tiers, positions and orientation, every conduit, and run modifiers.
  It is what combat consumes and what a snapshot stores (CB-32, MM-1).
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
- **CP-14 [PROPOSED]** Resource nodes belong to the party as a whole: who
  builds the source on a node is something to agree on. (There are no
  party-pick rewards; battle rewards are gold, RS-6.)

## Shared stakes

- **CP-15 [PROPOSED]** Lives are a single shared pool (RS-7a). The party wins
  and loses battles together.
- **CP-16 [PROPOSED]** Party-wide choices (PvE difficulty, which event to
  take, where the Core goes) use a vote; a tie is settled by the host (CP-3a).

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
- **CP-19 [DECIDED for now]** **Players do not see each other's shop
  screens.** Each player sees only their own offers. This may change after
  playtesting.
- **CP-19a [PROPOSED]** Coordination aids that remain: teammates' gold and
  stashes are visible; pings and markers on board cells ("put a generator
  here"); a shared view of what the factory will do (CB-43). A player who
  wants a teammate to know about an offer has to tell them.
- **CP-20 [PROPOSED]** Solo follows the same rule with one player: the step
  ends when they say so.

## Disconnects, saving, and resuming

### Disconnects

- **CP-21 [DECIDED]** **During a battle**, a player disconnecting does not
  stop the battle: it continues as long as **at least one player remains**
  in the game.
- **CP-21a [DECIDED]** **After the battle, the disconnected player must
  return**; otherwise the run cannot continue.
- **CP-21h [DECIDED]** **The event decision waits for every player's vote,
  including an absent player's.** A party whose member dropped during a
  battle therefore waits at the event that follows it.
- **CP-21b [DECIDED]** **Reconnecting is supported.** A player who drops can
  rejoin the run in progress and carries on from the current state.
- **CP-21c [DECIDED]** **The host can leave**, and the host can **re-host
  the run from the save** later. Only the host can, because only the host
  holds the save (CP-23c).
- **CP-21d [DECIDED]** **Players can leave a run at any time. The host can
  then save the run to resume at a later date. Only the host can fully
  abandon a run.** If a player never returns, those are the choices: the
  run stays saved, or the host abandons it.
- **CP-21f [DECIDED]** **While waiting, the remaining players can shop and
  can move buildings, including the disconnected player's buildings, but
  cannot continue past the shop.**
- **CP-21g [PROPOSED]** Details of waiting:
  - CP-21f applies during the shop step: if a player drops there, or has
    dropped by then, the others can go on shopping and building but cannot
    ready the party past it. It does not let the party skip an event
    (CP-21h).
  - The disconnected player's buildings stay on the board and keep working.
    Their gold, stash, and shop offers are untouched and cannot be given to
    or taken from while they are away.
  - If it is the host who is away, the others can do nothing until the host
    returns, because the host's game runs the session and holds the save
    (TA-11, CP-23c).
  - A guest who leaves for good can remove the run from their own list
    (CP-23f). That does not abandon it.
  - In battle, speed changes need agreement only from connected players.
- **CP-21e [PROPOSED]** Battles and reconnecting:
  - A player who reconnects during a battle joins the playback at the point
    the others have reached.
  - If every player leaves during a battle, or the host leaves and later
    re-hosts, the battle is not fought again. The run resumes at that
    battle's summary, showing the saved result, and the saved recording can
    be watched again from there (CP-23a).

### Saving and resuming

- **CP-22 [DECIDED]** A run can be **saved to continue later with the same
  players**.
- **CP-22a [DECIDED]** A player can have **many saved runs**, and **a single
  run cannot be saved more than once**: each run appears exactly once in its
  host's list of saves and cannot be duplicated or branched.
- **CP-23 [DECIDED]** The game **auto-saves after each action**, so that
  saving and loading cannot be abused to undo a bad purchase, re-roll a
  shop, or replay a lost battle. There is no manual save point to go back
  to: loading a save always resumes the run at its latest state.
- **CP-23a [PROPOSED]** What auto-save has to cover for that to hold:
  - Every accepted action that changes the run is saved before its result
    is shown. That means every kind of action: buying, selling, re-rolling,
    placing, moving, rotating, drawing or erasing conduits, giving, voting,
    readying, and un-readying.
  - Random outcomes are fixed in the save before they are revealed, **as
    the outcomes themselves, not as the inputs that would produce them**:
    the actual shop offers, re-roll results, and event offers, and for a
    battle its opponent, its seed, and — once it has been simulated — its
    result and event log.
  - Leaving and coming back therefore never produces a different roll or a
    different battle result, **even if the game was updated in between**
    [DECIDED]. An update changes what happens next, never what has already
    been rolled or fought.
- **CP-23c [DECIDED]** **The host carries the save for the run; the other
  players do not.** The party already trusts the host (TA-14), so there is
  one save, in one place.
- **CP-23b [PROPOSED]** A saved run can only be played by the **host and the
  same players** (checked by Steam ID). It cannot be continued with fewer
  players, different players, or solo, which also keeps party size fixed
  for ghost matching (CP-2). The host can open the run's lobby before
  everyone has arrived; the run then behaves as it does when a player is
  disconnected (CP-21a, CP-21f, CP-21h) until they join.
- **CP-23g [PROPOSED]** Consequences of the host carrying the save:
  - The host of a run is fixed for that run. Nobody else can re-host it,
    and the run cannot continue without the host.
  - Guests see the run in their list of runs they are part of, as a
    pointer to the host, but hold no save of their own. To resume, they join
    the host's lobby.
  - If the host loses the save (for example by deleting it), the run is
    over for everyone. Steam Cloud keeps it safe across the host's own
    computers.
  - Handing a run over to a different host is not supported for now.
- **CP-23d [DECIDED]** **The number of saved runs is not limited.** (This
  replaces the earlier five-slot limit.)
- **CP-23f [PROPOSED]** The host abandons a run by ending it from the menu or
  deleting its save; it is then over for the whole party. A guest can
  remove a run from their own list, which only hides it for them; they can
  still rejoin if the host resumes it. Each player's own record of depth
  reached comes from the last state of the run their game saw, since there
  is no server to tell an offline guest that the host abandoned.
- **CP-23i [PROPOSED]** A save keeps the recording of only the most recent
  battle, not of every battle in the run, so saves stay small. If the
  host's Steam Cloud quota is ever reached, saves remain on the host's
  machine and the game says they are not being backed up.
- **CP-23e [DECIDED]** Saves survive minor updates (as defined in TA-8) and keep playing against
  ghosts from the version they were played on. The game does **not** keep
  old rules or numbers: an older save plays under the current ones. **When
  players load a save from an older version, they are shown a prompt
  telling them some things may have changed.** A major version release
  deletes old saves (TA-8, TA-9).

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
  machine. CP-18 and CP-19a are the mitigations.
