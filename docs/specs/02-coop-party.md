# 02 — Co-op & Party

Status: Draft v5.0

## Party basics

- **CP-1 [DECIDED]** A party has 1–4 players.
- **CP-2 [PROPOSED]** Party size is fixed when the run starts. It is part of
  the matchmaking key (MM-2), so it cannot change mid-run.
- **CP-3 [PROPOSED]** Parties form through **Steam lobbies**: invite friends
  or join through the Steam overlay. Public matchmaking of strangers into a
  party is out of scope initially.
- **CP-3a [PROPOSED]** The lobby owner is the **host**; their game is the
  authority for the run (TA-6).

## One battlefield, one plot per player

- **CP-4 [SUPERSEDED by CP-25, issue #124]** Earlier decision: the whole
  party builds one large shared board. No longer in force.
- **CP-25 [DECIDED]** **Each player has their own plot.** A plot is one
  player's own area of the board. The plots are joined side by side into one
  continuous map, the party's **board** (see `03-combat.md`). Each player
  builds a factory in their own plot, with their own Core. Units, and enemy
  units, walk freely across all plots. (Replaces CP-4.)
- **CP-5 [PROPOSED]** Board area scales with party size: each player adds one
  **plot** of the same size (starting proposal: about 24×16 cells, CB-4),
  so the front edge gets wider with each player. Player `p` (counted from 0)
  owns plot `p`, counted from the left. Solo plays on one plot.
  Everything therefore scales linearly from 1 to 4 players.
- **CP-6 [PROPOSED]** The party's **team state** is that one board: its map
  (terrain, resource nodes, natural features), one Core position per player,
  buildings with owner, tier, position and orientation, every conduit with
  its owner (border links included), and run modifiers. It is what combat
  consumes and what a snapshot stores (CB-32, MM-1).
- **CP-7 [PROPOSED]** Opponents are scaled to party size: ghosts match on
  party size and so have the same number of plots (MM-2); PvE threats are
  scaled by the number of plots (SC-1) and have one Core per plot (CB-29).
  An opponent's plots face the party's plots one to one (CB-8b).
- **CP-8 [DECIDED]** The party has **one Core per player** and fights **one
  battle** against one opponent. Each Core has the same health (500 for
  now) at every party size. A side loses the battle when **all** of its
  Cores are destroyed (CB-17). There are no lanes and no per-player
  results: the party wins or loses as one. (Replaces the earlier "one Core
  for the party".)
- **CP-8a [DECIDED]** **A destroyed Core switches nothing off.** The Core is
  only health. A player whose Core is destroyed keeps everything running
  for the rest of the battle: their buildings keep producing and shooting
  and their collectors keep feeding their partners (CB-17a). The fallback
  to try if battles drag in playtests is to stop that player's collectors.
- **CP-9 [PROPOSED]** Solo is the same game on one plot, with no special
  rules: one Core, no borders, no links.
- **CP-9a [SUPERSEDED by CP-26, issue #124]** Earlier decision: the team
  chooses one Core position by vote. No longer in force.
- **CP-26 [DECIDED]** **Each player places their own Core**, anywhere legal
  in their own plot (CB-7), at the start of the run. There is no party vote.
  The Core's footprint must lie wholly inside the player's plot. During the
  Core placement step a player can change their choice (while not ready, or
  after un-readying; Ready locks it, CP-17a); when the step ends
  (every player has placed a Core and readied up, RS-12b) every Core is
  fixed for the run. (Replaces CP-9a.)

## Who owns what

- **CP-10 [PROPOSED]** Each player has their **own gold, own shop offers, and
  own stash**. Buying is an individual decision.
- **CP-11 [SUPERSEDED by CP-29, issue #124]** Earlier proposal: players can
  give gold and buildings to teammates. No longer in force.
- **CP-12 [SUPERSEDED by CP-27, issue #124]** Earlier proposal: space is
  shared and a player can place their buildings anywhere on the board. No
  longer in force.
- **CP-13 [SUPERSEDED by CP-28, issue #124]** Earlier proposal: anyone can
  move or rotate any building. No longer in force.
- **CP-27 [DECIDED]** **A player builds only in their own plot.** Every cell
  of a building's footprint, and every cell of a conduit, must be inside
  the plot of the player who owns it. The only thing that reaches a plot's
  edge on purpose is a conduit drawn up to the border to form a border link
  (CP-30). (Replaces CP-12.)
- **CP-28 [DECIDED]** **Only the owner acts on a building.** A building's
  owner is the player who bought it (or received it in their starting kit),
  and ownership never changes. Only the owner can place it, move it, rotate
  it, return it to the stash, sell it, or raise its tier. A conduit's owner
  is the player who drew it; only that player can erase it, and a conduit
  can connect only that player's own buildings. Nobody can act on another
  player's buildings or conduits, including a disconnected player's
  (CP-21i). Each building shows who owns it. (Replaces CP-13.)
- **CP-29 [DECIDED]** **No giving.** Players cannot give each other gold or
  buildings. Border links (CP-30) are the only way to help a partner
  directly. (Replaces CP-11 and EC-4a.)
- **CP-14 [DECIDED]** Resource nodes belong to the plot they are in: only
  that plot's player can build a source on them. (Replaces the earlier
  "nodes belong to the party as a whole".)
- **CP-30 [DECIDED]** **Border links.** Two neighbouring players can connect
  their factories. Each draws a conduit in their own plot up to the border
  between the two plots; where the two conduits meet at the same border
  spot they join into one link. Resources can be sent in either direction:
  a link carries resources from the player whose conduit starts at an
  output to the player whose conduit ends at an input. Either player can
  remove their own half at any time, which ends the link. Links exist only
  between plots that share a border. The exact rules are CB-9d.

## Shared stakes

- **CP-15 [PROPOSED]** Lives are a single shared pool (RS-7a). The party wins
  and loses battles together. A lost PvP battle costs one life, however many
  of the party's Cores fell (RS-5).
- **CP-16 [DECIDED]** Party-wide choices (PvE difficulty, which event to
  take, an event's follow-up choice) use a vote. The vote resolves once
  every player has voted. If all chose the same option it wins; otherwise
  one player's vote is picked at random, each player's vote being one
  equally likely ticket (an option with 3 of 4 votes wins 75% of the time).
  The host has no tie-break. Where a Core goes is no longer a party choice
  (CP-26).

## Building together

- **CP-17 [DECIDED]** **There are no timers.** Events, shops, and building
  are never timed; players are not rushed and play at their own pace.
  **Every player must ready up before the party moves on to the next
  step.**
- **CP-17a [DECIDED]** All players act at the same time within a step
  (everyone shops and builds simultaneously). **Ready locks a player's own
  editing:** in a build or shop step, once a player is Ready, their buy,
  sell, re-roll and board-editing actions are refused (reason
  `locked_ready`) until they Unready. A player can Unready for as long as at
  least one other player is not ready; the moment the last player readies the
  step ends, so with one player Ready advances at once. Other players keep
  editing while someone is Ready. A player cannot ready up while a placed
  unit producer **of their own** is sealed in (its units could not reach the
  front row of the board; a gate counts as a way out), reason
  `sealed_producer`. Another player's sealed producer does not block them.
  The check reads the whole board, because units walk across all plots.
  Every plot's open ground reaches that plot's own front row without leaving
  the plot (a map rule, SC-11), so a producer can be sealed only when its
  owner's own buildings are part of what closes it in: the owner can always
  fix it, and a neighbour can never seal a player in.
- **CP-17b [DECIDED]** **A vote counts as soon as it is cast and can be
  changed until the last player has voted.** There is no separate confirm
  step. The choice resolves once everyone has voted.
- **CP-18 [PROPOSED]** **Simultaneous editing.** All players edit at once,
  each in their own plot, and see each other's changes live, with each
  player's cursor and held building visible. Other players' plots are shown
  but cannot be edited. Two players can affect each other only at a border
  spot (CP-30): the first action the host receives is applied first, and a
  player whose action is refused is shown why.
- **CP-19 [DECIDED for now]** **Players do not see each other's shop
  screens.** Each player sees only their own offers. This may change after
  playtesting.
- **CP-19a [PROPOSED]** Coordination aids that remain: teammates' gold and
  stashes are visible; pings and markers on board cells, including border
  spots ("link here, I can send Ore"); a shared view of what the factories
  will do, with each building's need and each collector's rate (CB-43). A player who
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
- **CP-21f [SUPERSEDED by CP-21i, issue #124]** Earlier decision: while
  waiting, the remaining players can move buildings, including the
  disconnected player's. No longer in force.
- **CP-21i [DECIDED]** **While waiting, the remaining players can shop and
  can build in their own plots, but cannot continue past the shop. Nobody
  can move, rotate, return or sell a disconnected player's buildings or
  erase their conduits.** A remaining player can still erase their own half
  of a border link with the absent player. (Replaces CP-21f. To be revisited
  when online play exists: an absent player's plot cannot be repaired by
  anyone else, which may need an exception.)
- **CP-21g [PROPOSED]** Details of waiting:
  - CP-21i applies during the shop step: if a player drops there, or has
    dropped by then, the others can go on shopping and building but cannot
    ready the party past it. It does not let the party skip an event
    (CP-21h).
  - The disconnected player's buildings stay on the board and keep working.
    Their border links keep working too. Their gold, stash, and shop offers
    are untouched while they are away.
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
    placing a Core, placing, moving, rotating, drawing or erasing conduits,
    voting, readying, and un-readying.
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
  disconnected (CP-21a, CP-21i, CP-21h) until they join.
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

- **CP-24 [PROPOSED]** Area, income, the number of Cores, and PvE threat all
  scale linearly with party size; each Core's health is the same at every
  party size. A party of four therefore has four times the Core health of a
  solo player, faces four enemy Cores, and can send resources between
  plots, so larger parties may be somewhat stronger per player. Battles at
  four players may also snowball once the first Core falls (the units that
  were attacking it move on to the next), or run to the Overload deadline.
  Ghosts only ever meet the same party size (V-3), so this matters only for
  PvE tuning and for leaderboards, which are kept **per party size**. The
  balance harness charts battle length by party size.

## Co-op under the per-player design

This section states what a player can and cannot do for a partner, and the
rule that answers each way one player could hurt or lean on another. All of
it follows from CP-25 to CP-30.

**What a player can do for a partner**

| Action | Allowed | Rule |
|--------|---------|------|
| Send resources to a neighbour over a border link | Yes | CP-30, CB-9d |
| Receive resources from a neighbour over a border link | Yes, if the neighbour draws their half | CP-30, CB-9d |
| Pass resources on to a player two plots away | Only through the plot in between, using that player's own conduits and a route building of theirs | CB-9d |
| Defend a neighbour's plot | Yes: turrets shoot any enemy unit in range, in any plot; units fight any enemy unit they meet | CB-18, CB-16 |
| Let a neighbour's units through | Yes: a gate lets every unit of the party through | CB-18 |
| Agree who builds what, ping a cell or a border spot | Yes | CP-19a |
| Give gold or a building | No | CP-29 |
| Place, move, rotate, return or sell a partner's building | No, not even while they are disconnected | CP-28, CP-21i |
| Build in a partner's plot, or on a partner's resource node | No | CP-27, CP-14 |
| Draw or erase a conduit in a partner's plot | No | CP-28 |
| See a partner's shop offers | No | CP-19 |

**Griefing and starvation**

| Concern | What could happen | Rule that prevents or limits it |
|---------|-------------------|---------------------------------|
| Draining a neighbour | A player taps a neighbour's supply without being asked. | A link needs a half from each side, and resources leave a plot only through a conduit its owner drew from one of their own outputs (CP-30, CB-9d). Nobody can connect to a building they do not own (CP-28). |
| A link that is no longer wanted | A neighbour keeps taking what a player now needs. | Either player can erase their own half at any time during building, which ends the link (CP-30). |
| Starving yourself by sharing | A player who shares ends up with nothing for their own buildings. | The only way to split a conduit is a Splitter, which divides evenly: with a Splitter in front of the link the giver's own branch keeps its even share, and the neighbour gets more only when the giver's branch is full (CB-9e). A player who draws a collector straight into a link, with no Splitter, has chosen to send all of it. |
| Leaning on a partner | A player builds only consumers and waits to be fed. | Nothing forces a neighbour to draw their half. Each plot has its own resource nodes (SC-11), so every player can supply themselves. |
| A partner with nothing to do | A player's own supply is used up and nothing they could buy would run. | A neighbour with a surplus can feed them over a link. Otherwise their choices are collector tier, a Splitter, or buildings with a lower need; shop offers show the need of each building (CB-43). To be checked in the first party playtest. |
| Blocking a neighbour's layout | A conduit at a border spot blocks the neighbour's own conduit there. | A border spot is on the border line, not in either plot. Each player's half occupies only cells of their own plot, so no half can block a cell the neighbour could build on (CB-9d). |
| Breaking a neighbour's link by mistake | Moving a building ends a link the neighbour relied on. | Allowed, because a player always controls their own plot. The neighbour's half stays in place, unjoined; nothing sent towards it is lost (the items back up, and a Splitter sends them down its other paths, CB-9d), and the dry run shows it as carrying nothing (CB-43). The link joins again when the other half is redrawn. |
| A link that makes a neighbour's change illegal | One player's new conduit would mix two resources, or close a loop, further along in the neighbour's plot. | The change that would cause it is refused and the reason shown (CB-9d). The player can always undo by erasing their own half. |
| Sealing in a neighbour's unit producer | A wall line across a neighbour's exits. | A player's walls stand only in their own plot (CP-27), and every plot's open ground reaches its own front row inside the plot (SC-11). A producer can therefore be sealed only by its owner's own buildings, and the sealed-producer check blocks only that owner (CP-17a). |
| Holding the party at a step | One player never readies up. | Unchanged: every player must ready up (CP-17). This is a game among friends; there is no timer and no kick. |
| A disconnected player's plot | Their plot cannot be repaired or re-planned by anyone else. | Accepted for now (CP-21i). Their buildings and links keep working. To be revisited when online play exists. |
| Four solo games | Players build side by side and never interact. | The risk to pillar 1. Border links must be worth using (a plot rich in collectors feeding a plot rich in consumers). Checked in the first party playtest; if links are not enough, the design is revisited. |

## Risks specific to the per-player design

- **Four solo games.** See the table above. Shared building was the main
  source of "together"; what remains is border links, shared lives, and one
  battlefield. Cannot be tested until co-op exists.
- **Snowballing at larger party sizes** (CP-24).
- **A weak player.** One player's poor plot no longer loses the battle
  (CP-8a), but the enemy units that destroyed their Core move on to the
  next. Whether that feels fair to the others is a playtest question.
