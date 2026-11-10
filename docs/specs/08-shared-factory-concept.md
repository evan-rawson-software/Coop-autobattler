# 08 — Concept Under Evaluation: The Shared Factory

Status: Draft v0.1 — **exploratory**. Raised by the project owner as a "what
if". Not yet adopted. If adopted it supersedes large parts of
`02-coop-party.md` and `03-combat.md`; the "Impact" section lists exactly
what.

## The idea

Instead of one board per player, the party builds **one large shared board**.
The board is an automation factory in the spirit of *Factorio*: sources feed
routes, routes feed machines, machines produce what the party needs. Players
coordinate to build the best overall factory, and every reward is a choice
between:

- **growing the economy** — pays off in later cycles, or
- **damage and defense** — helps win the next battles.

It grows out of the Conduits candidate (`03-combat.md`): the same "charge
flows along routes to outputs" mechanic, but on one communal board, with the
economy living on the board alongside the weapons.

## How it could work [all PROPOSED]

### One board, sized by party

- **SF-1** The party shares a single board. Its area scales with party size:
  each player adds one **plot** of the same size (e.g. 6×4), joined into one
  continuous grid with no internal walls. Solo plays on one plot.
- **SF-2** This keeps the property that motivated one-board-per-player
  (V-9): everything scales linearly from 1 to 4 players. Ghosts already
  match on party size, so both sides always have the same area.
- **SF-3** The party has **one Core** (health scaled by party size). A
  battle is one factory against one opponent. There are no lanes.

### The factory is both the economy and the army

- **SF-4** There is one flow resource (charge) to start with. Outputs come in
  three families:
  - **Attack** — charge in, damage to the enemy Core out.
  - **Defense** — charge in, shield/repair for the party Core out.
  - **Economy** — charge in, gold (or another between-battle resource) out.
- **SF-5** **The factory runs during battles**, and what it makes in that
  time is what the party gets — damage, shield, and income from the same
  machine. Charge routed to a Mint is charge not routed to a Cannon. The
  greed-versus-safety decision is therefore visible on the board itself and
  can be re-routed before each battle (lean economic into an easy PvE
  battle, lean military into the PvP battle).
- **SF-6** This fits the stakes already decided: PvE losses cost nothing but
  the reward (RS-3a), so PvE battles are where a party can afford to run a
  greedy factory; PvP losses cost a life (RS-5), so that is where the board
  must actually fight.
- **SF-7** A second or third resource type (e.g. ammunition, plating) with
  simple recipes is a possible later layer for more "factory" depth. Start
  with one resource and add only if the prototype feels thin.

### Who owns what

- **SF-8** Each player keeps their **own gold and their own shop offers**.
  This preserves individual agency and makes it harder for one player to
  play the game for everyone.
- **SF-9** **Space is shared.** Any player can place their items anywhere on
  the board. Whether a player may move or sell a teammate's items is open;
  simplest is "anyone can do anything" (it is a co-op game among friends),
  with a visible owner mark on each item.
- **SF-10** Party-level rewards (expand the board, upgrade the Core, add a
  source) are voted on or bought from pooled contributions.
- **SF-11** Giving gold and items between players remains.

### Space is the limiter

- **SF-12** Board area is the scarce resource. Expansion (extra rows,
  columns, or cells) is a major reward/purchase whose cost rises steeply.
- **SF-13** This is also the answer to compounding growth (see Risks):
  an economy can only compound until it runs out of room.

### Battles

- **SF-14** Both factories run simultaneously for the battle. A side loses
  when its Core reaches 0. An escalation rule (Overload, CB-12) guarantees an
  end.
- **SF-15** Playback shows the party's own factory running, with the
  opponent summarized (Core health, incoming damage by type) and viewable in
  full on demand. Watching your own machine work is the spectacle.

### Opponents

- **SF-16** Ghosts are other parties' factories, same as before: snapshot of
  one board instead of N.
- **SF-17** PvE enemies and bosses do **not** have to be factories.
  Generating a sensible factory procedurally is hard; a PvE enemy can be a
  scripted threat (a health pool and an attack pattern scaled by the budget
  curve, SC-1), or a hand-authored factory template with scaled tiers. This
  relaxes CB-34 ("PvE uses the same format as players") for PvE only.

## What it improves

- **Co-op becomes the core of the game** rather than a layer on top. Shared
  planning, specialization ("you run power, I'll run weapons"), and joint
  long-term bets are exactly pillar 1.
- **Removes the hardest open co-op question** (Q1, how N separate boards
  fight together). One board, one Core, one fight.
- **The economy-versus-power choice is physical**, not just a shop decision.
- **Distinct identity.** A co-op factory-building autobattler is clearly its
  own thing relative to *The Bazaar* and *Backpack Battles*.
- **Solo still works**: one plot is a complete single-player factory builder.

## Risks and open problems

1. **Compounding economy vs. the exponential wall.** Factory economies grow
   by reinvesting, which is itself exponential. V-5 needs player power to
   grow slower than PvE in the long run. Space limits (SF-12), per-battle
   caps on income, and steeply rising costs must enforce that. This is the
   most important thing to model in the balance harness.
2. **Stalling for income.** If the factory earns during battles, a party is
   tempted to turtle and farm. Needs a cap: fixed battle length, a
   per-battle limit on each economy output, or escalation that makes long
   battles lethal.
3. **Build time and session length.** Factory building is slow and
   thoughtful; the run targets are short phases and 30–45 minute runs
   (RS-12). Mitigations: only a few new pieces per cycle, free
   rearrangement, generous timers, good placement aids. Session targets may
   need to grow.
4. **Complexity and readability.** A 4-player board could be ~100 cells of
   routed machinery. It must stay legible to the people who built it and at
   least summarizable when it is an opponent.
5. **One player running the show.** Shared space invites it. Personal gold
   and shops (SF-8) help; the prototype cannot test this until co-op exists.
6. **Simultaneous editing.** Several players placing on one board in real
   time needs conflict rules (first placement wins) and clear feedback. More
   networking work than separate boards, though well understood.
7. **PvE content.** If PvE enemies are scripted threats (SF-17), they need
   their own small content format and tuning.

## Impact on existing specs if adopted

| Spec | Change |
|------|--------|
| 00 Vision | V-9 (one full board per player) is replaced by "one shared board, one plot per player". Glossary: Board, Lane. |
| 01 Run structure | Loop, lives, and stakes unchanged. Rewards gain the economy/attack/defense framing. Session-length targets revisited. |
| 02 Co-op & party | Largely rewritten: shared board, ownership rules, no lanes. Q1 disappears. |
| 03 Combat | Conduits becomes the adopted mechanic, extended with economy outputs; lane rules (CB-21 to CB-24) removed; Links are unnecessary because there are no board edges between teammates. |
| 04 Encounters | Snapshot is one board. PvE format may diverge from the player format (SF-17). |
| 05 Scaling & economy | Economy moves onto the board; new rules for compounding and caps. Income is no longer simply per player. |
| 06 Architecture | Shared-board editing in the Session layer. Proof of concept is unaffected in shape: solo, one plot. |

## What the proof of concept can answer

The solo web prototype tests most of this with a single plot: whether
routing charge is fun, whether the economy-versus-power split produces real
decisions, how long building takes per cycle, and whether the scaling curve
still ends runs. Shared editing and the one-player-dominates risk wait for
co-op.

## Decisions needed

1. Adopt the shared factory as the direction to prototype?
2. Does the factory earn **during battles** (SF-5), or is economy output a
   flat per-cycle payout from economy items on the board?
3. One resource to start (charge), or multiple resources with recipes from
   the beginning?
4. Ownership: personal gold and shops with shared space (SF-8, SF-9), or
   fully pooled?
