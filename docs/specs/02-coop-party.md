# 02 — Co-op & Party

Status: Draft v0.4

## Party basics

- **CP-1 [DECIDED]** A party has 1–4 players.
- **CP-2 [PROPOSED]** Party size is fixed when the run starts. It is part of
  the matchmaking key (MM-2), so it cannot change mid-run.
- **CP-3 [PROPOSED]** Parties form through a lobby with an invite code/link.
  Public matchmaking of strangers into a party is out of scope initially.

## Ownership model: one full board per player

- **CP-4 [DECIDED]** Each player has **their own full board**. A party of N
  players fields N boards. The game scales from 1 to 4 players by adding or
  removing whole boards; a board is the same size and follows the same rules
  at every party size.
- **CP-5 [PROPOSED]** Each player also has their own gold, shop offers, and
  stash, and is the only one who can buy for, arrange, or sell from their
  board. A solo player's experience is exactly "one board".
- **CP-6 [PROPOSED]** The party's **team state** is the ordered list of its N
  board states. This is what combat consumes and what a snapshot stores
  (CB-32, MM-1).
- **CP-7 [PROPOSED]** Opponents always field the **same number of boards** as
  the party: ghosts because they match on party size (MM-2), PvE and bosses
  because the generator builds one enemy board per player (MM-9). Per-board
  difficulty is therefore independent of party size.

## How N boards fight together

The party wins or loses each battle **as a whole** (lives are shared). How the
boards interact inside a battle is the main open co-op question — see
`07-open-questions.md` Q1. Recommended starting point:

- **CP-8 [PROPOSED]** **Lanes on one battlefield.** Each board is a lane.
  Lane *i* of the party starts opposite lane *i* of the opponent. Each board
  attacks the opposing board in its lane first; when that board is defeated,
  the winner turns its attacks on an adjacent enemy lane that is still
  standing. The battle ends when one side has no boards left standing
  (CB-21 to CB-23).
- **CP-9 [PROPOSED]** With one player this reduces to an ordinary 1v1
  autobattle with no special cases.
- **CP-10 [PROPOSED]** Lane order is chosen by the party (and is part of team
  state). It matters: who stands next to whom decides who gets reinforced
  first and which cross-board effects apply (CP-12).

This gives a single shared outcome, lets a strong player carry a weak lane
(visible, satisfying co-op), and keeps each board self-contained for building.

## Interdependence between boards

Separate boards risk feeling like parallel solo runs (pillar 1). These
mechanics are the counterweight:

- **CP-11 [PROPOSED]** **Giving.** Players can give gold and items to
  teammates during events and prep phases. Giving is free and instant; there
  is no trade negotiation UI.
- **CP-12 [PROPOSED]** **Cross-board effects.** Some items and tag bonuses
  affect neighbouring lanes or the whole party (e.g. an aura that reaches the
  adjacent board, a tag bonus that counts matching items across all boards).
  Most synergies are evaluated per board so each board stands on its own;
  cross-board effects are the minority and are marked clearly.
- **CP-13 [PROPOSED]** **Reinforcement** via retargeting (CP-8), so
  specialization pays off: one player can build to clear fast and rotate,
  another to hold.
- **CP-14 [PROPOSED]** **Party picks.** Some rewards are a single choice the
  party must allocate to one player (e.g. choose 1 of 3 items, then decide
  who gets it).

## Shared stakes

- **CP-15 [PROPOSED]** Lives are a single shared pool (RS-7a). The party wins
  and loses battles together.
- **CP-16 [PROPOSED]** Party-wide choices (PvE difficulty, which event to
  take, party picks) use a quick vote; ties broken by the party leader or
  randomly.

## Events and prep phases in co-op

- **CP-17 [PROPOSED]** Events and prep phases are simultaneous and real-time
  for all players, with a shared timer. They end early when all players
  ready up.
- **CP-18 [PROPOSED]** Players can see teammates' boards, stashes, gold, and
  shops (read-only) to enable coordination. Pings/markers ("I want this",
  "buy this for me") reduce dependence on voice chat.
- **CP-19 [PROPOSED]** Solo play removes the timer (or makes it generous);
  there is nobody to wait for.

## Disconnects and leavers

- **CP-20 [PROPOSED]** A disconnected player's board stays in the party and
  keeps fighting as it was. They can rejoin the run at any time while it is
  live. The run keeps its original party size for matchmaking.
- **CP-21 [PROPOSED]** While a player is absent their board is frozen: gold
  accrues but nothing is bought or moved. (Alternative: teammates may manage
  the absent player's board.)
- **CP-22 [PROPOSED]** Runs are resumable: if everyone leaves, the run is
  suspended at the start of the current step and can be continued later by
  the same party. Suspended runs on an old game version are closed out at
  their current depth (see TA-9).

## Balance across party sizes

- **CP-23 [PROPOSED]** Everything scales linearly with party size — boards,
  income, and enemy boards — so per-player balance is the same at every size
  and no party-size discount curves are needed (EC-4).
- **CP-24 [PROPOSED]** What does differ by size is cross-board content
  (CP-12) and lane retargeting, which only exist with 2+ players. Ghosts only
  ever meet the same party size (V-3), so this matters only for PvE tuning
  and for leaderboards, which are kept **per party size**.
