# @game/session

Owns a run in progress. It is a pure, deterministic step machine over a plain
JSON `RunState`. It imports `core` only, has no clock, no `Math.random` and no
I/O, and is written for N players (1 to 4) although the prototype plays solo.

```ts
const created = createRun({ runId, runVersion, seed, players: ['Ann'], host: 0 }, deps);
const r = applyIntent(state, playerIndex, { type: 'ready' }, deps);
// r: { ok: true, state, effects } | { ok: false, reason, detail? }
```

Every change is one intent from one player. An accepted intent bumps
`actionCounter` and is appended to `actionLog`; a rejected one changes
nothing. `replayRun(args, actionLog, deps)` rebuilds a state from the seed.
`validateRunState(data, deps)` checks untrusted data (also see
`schemas/run-state.schema.json`). `allowedIntents`, `openVote` and
`whoIsReady` are for the UI.

## Steps

A round is: PvE battle, event, shop, PvP battle, event, shop. The run starts
with `core_placement` and a first `build`. Ready flags and votes reset when a
step is entered. Voting: a vote counts at once and can be changed until the
last player has voted; the most votes wins, a tie goes to the host's vote.

| Step             | Intents allowed (besides `abandon` by the host)   | How it ends                                                                                               |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `core_placement` | `propose_core`, `vote` (for a proposal)           | All players voted for the same legal position (a proposal counts as its proposer's vote): Core placed, `startingKit` hook, then `build`. |
| `build`          | board edits, `ready`, `unready`, extension intents | All players ready: `pve_choice`.                                                                          |
| `pve_choice`     | `vote` (an option id from `pending.options`)      | All voted: winner chosen, then `pve_battle`.                                                              |
| `pve_battle`     | none (never saved)                                | Resolved at once through `deps.battle`; goes to `pve_summary`.                                            |
| `pve_summary`    | `ready`, `unready`                                | All ready: `rewards` hook, then `event_choice`. A PvE loss costs no life.                                 |
| `event_choice`   | `vote` (one of three offers)                      | All voted: `resolveEvent` hook; `event_resolve` if it returns a follow-up, else `shop`.                   |
| `event_resolve`  | extension intents only                            | A handler returns `advance: true`: `shop`.                                                                |
| `shop`           | board edits, `ready`, `unready`, extension intents | All ready: after the PvE leg `pvp_battle`; after the PvP leg the round counter goes up and `pve_choice`. |
| `pvp_battle`     | none (never saved)                                | Resolved at once; goes to `pvp_summary`.                                                                  |
| `pvp_summary`    | `ready`, `unready`                                | All ready: `rewards` hook; a loss costs `pvpLossLifeCost` lives; 0 lives gives `run_over`, else `event_choice`. |
| `run_over`       | none                                              | Final. `outcome` is `defeated` or `abandoned`.                                                            |

Any intent not in a step's row is rejected with `wrong_step`. `abandon` (host
only, else `not_host`) ends the run from any step except `run_over`. The
legal built-in intents per step are in `src/step-table.ts`.

`leg` (`pve` or `pvp`) says which half of the round the event and shop belong
to. `thisRound` holds the battles of the round in progress and moves into
`history` when the round ends (or when the run ends mid-round).

## Seams (what later issues plug in)

All are fields of `RunDeps`; `createDeps` fills the defaults.

| Seam                         | Default                                 | Filled by                      |
| ---------------------------- | --------------------------------------- | ------------------------------ |
| `battle.resolve`             | `stubBattle` (seeded roll vs buildings) | the battle simulation          |
| `hooks.startingKit`          | no-op                                   | W2-2: `economyHooks` / `createEconomyDeps` |
| `hooks.onShopEnter`          | no-op                                   | W2-2: `economyHooks` (offers, income; `shop:r<r>:<leg>` child `p<i>`) |
| `hooks.pveOptions`           | easy, medium, hard                      | W2-3                           |
| `hooks.eventOffers`          | three placeholder offers                | W2-3                           |
| `hooks.resolveEvent`         | no effect, no follow-up                 | W2-3                           |
| `hooks.rewards`              | no-op                                   | W2-3 (gold, consolation gold)  |
| `rules` (`RunRules`)         | 5 lives, PvP loss costs 1               | difficulty options (W2-3)      |
| `handlers` (intent registry) | empty                                   | W2-2 `buy`, `sell` (shop, build), `reroll` via `economyHandlers`, W2-3 (event follow-ups) |
| `perPlayer[i].shop`, `pending` | `null`, per step                      | opaque JSON owned by W2-2 / W2-3 |

State hooks return a `StatePatch` (`team` and/or `perPlayer`); the machine
applies it. An extension handler is `{ steps, handle(ctx) }`: it is only
called in the listed steps (otherwise `wrong_step`), returns the new state,
optional effects, and `advance: true` to end `build`, `shop`, `event_resolve`
or a summary step. The machine does the log bookkeeping.

## RNG streams

The run's `Rng` is saved in `state.rng` (root: `Rng.fromSeed(seed).child('run')`).
For each purpose the machine calls `drawStream(state, label)`: it derives
`rng.child(label)` and advances the run generator by one output, storing the
new state back. Hooks and the battle resolver get the child stream only. `r` is
the round number, `leg` is `pve` or `pvp`.

| Label                   | Used for                                   |
| ----------------------- | ------------------------------------------ |
| `kit`                   | `startingKit` hook                         |
| `pve_options:r<r>`      | `pveOptions` hook                          |
| `battle:pve:r<r>`       | the PvE battle                             |
| `battle:pvp:r<r>`       | the PvP battle                             |
| `event_offers:r<r>:<leg>`  | `eventOffers` hook                      |
| `event_resolve:r<r>:<leg>` | `resolveEvent` hook                     |
| `shop:r<r>:<leg>`       | `onShopEnter` hook                         |

Handlers that need randomness should call `drawStream` with their own label,
for example `reroll:r<r>:p<player>:<action number>`.
