# 02 — Co-op & Party

Status: Draft v0.1

## Party basics

- **CP-1 [DECIDED]** A party has 1–4 players.
- **CP-2 [PROPOSED]** Party size is fixed when the run starts. It is part of
  the matchmaking key (MM-2), so it cannot change mid-run.
- **CP-3 [PROPOSED]** Parties form through a lobby with an invite code/link.
  Public matchmaking of strangers into a party is out of scope initially.

## The central co-op question: who owns what?

The model below is the recommended starting point. Alternatives are recorded in
`07-open-questions.md` Q1 because this is the most consequential open decision.

### Recommended model: "one team, personal benches" [PROPOSED]

- **CP-4** The party fields **one shared team** on **one shared board**. There
  is a single combined fight per encounter, not one fight per player.
- **CP-5** Total team capacity is the **same for every party size** (e.g. 8
  unit slots), divided between players: solo controls all 8; duo 4 each; trio
  3/3/2 (rotating or chosen); quad 2 each. This keeps total power comparable
  across party sizes, simplifies PvE scaling, and means more players =
  more specialization rather than more stuff.
- **CP-6** Each player has their **own gold, own shop offers, and own bench**.
  They buy for and manage their own slots.
- **CP-7** Synergies (traits, adjacency effects, auras) are evaluated across
  the **whole team**, regardless of owner. This is the main source of
  interdependence: your tank makes my carry work.
- **CP-8** Players can **give** gold, units, and items to teammates during the
  build phase. Giving is free and instant; there is no trade negotiation UI.
- **CP-9** Board positioning is shared: any player may move any unit on the
  board. Conflicts resolve last-write-wins with visible cursors/indicators.
  (Alternative: only the owner moves their units.)

### Why not "each player has a full board"?

Four full boards quadruple fight complexity, playback readability, and
snapshot size, and make party sizes play like entirely different games. It
also weakens interdependence. Kept as an alternative in Q1.

## Shared stakes

- **CP-10 [PROPOSED]** Lives are shared (RS-4). The party wins and loses
  encounters together.
- **CP-11 [PROPOSED]** Rewards from encounters are split: a per-player gold
  payout plus one or more **party picks** (e.g. choose 1 of 3 items) that the
  party must allocate to one player — a deliberate discussion point.
- **CP-12 [PROPOSED]** Party-wide choices (which PvE encounter to take,
  party picks) use a quick vote; ties broken by the party leader or randomly.

## Build phase in co-op

- **CP-13 [PROPOSED]** The build phase is simultaneous and real-time for all
  players, with a shared timer. It ends early when all players ready up.
- **CP-14 [PROPOSED]** Players can see teammates' benches, gold, and shops
  (read-only) to enable coordination. Pings/markers ("I want this", "buy this
  for me") reduce dependence on voice chat.
- **CP-15 [PROPOSED]** Solo play removes the timer (or makes it generous);
  there is nobody to wait for.

## Disconnects and leavers

- **CP-16 [PROPOSED]** A disconnected player's slots stay on the board. They
  can rejoin the run at any time while it is live.
- **CP-17 [PROPOSED]** While a player is absent, remaining players may manage
  that player's slots and spend their gold (or a simple auto-pilot holds
  state unchanged). The run keeps its original party size for matchmaking.
- **CP-18 [PROPOSED]** Runs are resumable: if everyone leaves, the run is
  suspended at the start of the current build phase and can be continued
  later by the same party. Suspended runs on an old game version are closed
  out at their current depth (see TA-9).

## Balance across party sizes

- **CP-19 [PROPOSED]** Because team capacity is constant (CP-5), PvE opponents
  need little or no party-size scaling. Ghosts are only ever matched against
  the same party size (V-3), so cross-size balance only matters for PvE and
  for leaderboards, which are kept **per party size**.
- **CP-20 [OPEN]** Total economy per party size: N players each earning full
  income would give larger parties more total gold. Options are in
  `05-scaling-economy.md` EC-4.
