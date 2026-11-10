# 00 — Vision & Pillars

Status: Draft v0.1

## Elevator pitch

A co-op roguelite autobattler for 1–4 players. Between fights, the party
drafts units and items, combines them, and positions a shared team. Fights
resolve automatically. Opponents alternate between hand-authored-style PvE
encounters and **ghost PvP** — saved snapshots of other real parties at the
same point in their run. PvE power grows exponentially, so no run lasts
forever; the score is how deep you went.

## Requirements from the project owner

- **V-1 [DECIDED]** Supports 1–4 players in a party.
- **V-2 [DECIDED]** Runs combine PvE encounters and PvP encounters.
- **V-3 [DECIDED]** PvP is asynchronous: the opponent is a saved state of
  another party at the same point in the game, with the same party size, on
  the same game version.
- **V-4 [DECIDED]** If no saved state matches, a PvE boss is generated instead,
  based on how far the party has progressed.
- **V-5 [DECIDED]** PvE enemies scale exponentially so that every run is
  eventually forced to end in defeat.
- **V-6 [DECIDED]** Combat-encounter structure is in the spirit of *The
  Bazaar*: a run is a sequence of days mixing PvE fights with a ghost PvP
  fight.

## Design pillars

1. **Together, not just alongside.** Co-op must create real interdependence:
   builds that combine across players, shared stakes, and decisions worth
   talking about. A 4-player run should not feel like four solo runs in a
   trench coat.
2. **Every run ends; depth is the score.** There is no "win screen". The
   exponential wall is the antagonist, and beating your previous depth is the
   hook.
3. **Fights are fair because they are identical.** Combat is fully
   deterministic from its inputs. The same two teams and seed always produce
   the same result, on any machine. This is what makes ghost PvP, replays, and
   server validation possible.
4. **Decisions in the shop, spectacle in the fight.** Players have zero input
   during combat. All skill expression is in drafting, economy, composition,
   and positioning.
5. **Short sessions, legible rounds.** A round is a few minutes; a run fits in
   an evening; a party can drop a run and it does not hurt anyone else,
   because all PvP is asynchronous.

## Target experience

- **Solo:** a complete game on its own, comparable to a single-player
  autobattler run.
- **2–4 players:** friends on voice chat arguing about who gets the item,
  pooling gold for a key purchase, and cheering or groaning at the same fight.

## Non-goals (for now)

- Live, synchronous PvP between two human parties.
- Ranked ladders, seasons, monetization, cosmetics.
- Mid-run drop-in of new players (party size is fixed for a run; see
  `02-coop-party.md`).
- Trading or interaction between different parties.

## Theme

**[OPEN]** No setting chosen yet. Specs use neutral terms: *unit*, *item*,
*party*, *round*, *boss*. Theme should be chosen before content authoring but
does not block systems work.

## Glossary

| Term | Meaning |
|------|---------|
| Party | The 1–4 players in a run together. |
| Run | One playthrough, from round 1 until the party is eliminated. |
| Round | One build phase followed by one encounter. |
| Build phase | The between-fights phase: shop, draft, combine, position. |
| Encounter | A single automated fight (PvE or ghost PvP). |
| Team | The full set of units/items the party fields in an encounter. |
| Snapshot | A saved, immutable copy of a party's team at the start of an encounter. |
| Ghost | A snapshot being used as another party's opponent. |
| Boss | A generated PvE opponent used when no ghost is available. |
| Depth | The highest round a party reached; the primary score. |
