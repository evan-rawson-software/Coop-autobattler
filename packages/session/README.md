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
`RunState.formatVersion` is `RUN_STATE_FORMAT_VERSION` (2: `upcomingPve` and the
new battle detail); `validateRunState` rejects any other version with an
"unsupported format version" error before anything else. The save record's
own `saveFormatVersion` is separate and still 1.
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
| `pve_choice`     | `vote` (an option id from `pending.options`)      | All voted: winner chosen, then `pve_battle`. The options were stored earlier in `upcomingPve` (see "Game deps"). |
| `pve_battle`     | none (never saved)                                | Resolved at once through `deps.battle`; goes to `pve_summary`.                                            |
| `pve_summary`    | `ready`, `unready`                                | All ready: `rewards` hook, then `event_choice`. A PvE loss costs no life.                                 |
| `event_choice`   | `vote` (one of the 1 to 3 offers)                 | All voted: `resolveEvent` hook; `event_resolve` if it returns a follow-up with options, else `shop`.     |
| `event_resolve`  | `event_choose` (extension intent)                 | All players chose (most votes, ties to the host): the handler applies it and advances to `shop`.          |
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
| `hooks.pveOptions(state, rng, round)` | easy, medium, hard (bare ids)  | W2-3: `pveOptionsHook` (via `createGameDeps`) |
| `hooks.eventOffers`          | three placeholder offers                | W2-3: `eventHooks`             |
| `hooks.resolveEvent`         | no effect, no follow-up                 | W2-3: `eventHooks`             |
| `hooks.rewards`              | no-op                                   | W2-3: `rewardHooks` (gold, consolation gold) |
| `rules` (`RunRules`)         | 5 lives, PvP loss costs 1               |                                |
| `rewards` (optional)         | absent                                  | W2-3: set by `createGameDeps`; read by `nextBattleInfo` |
| `handlers` (intent registry) | empty                                   | W2-2 `buy`, `sell` (shop, build), `reroll` via `economyHandlers`; W2-3 `event_choose` (event follow-ups) via `eventChooseHandlers` |
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
| `pve_options:r<r>`      | `pveOptions` hook; `r` is the round of the battle the options are for (drawn on entering the first `build`, and on entering the shop that ends round `r - 1`) |
| `battle:pve:r<r>`       | the PvE battle                             |
| `battle:pvp:r<r>`       | the PvP battle                             |
| `event_offers:r<r>:<leg>`  | `eventOffers` hook                      |
| `event_resolve:r<r>:<leg>` | `resolveEvent` hook                     |
| `shop:r<r>:<leg>`       | `onShopEnter` hook                         |

Handlers that need randomness should call `drawStream` with their own label,
for example `reroll:r<r>:p<player>:<action number>`.

## Game deps (W2-3)

`createGameDeps(content, { mapgen, economy, events, threats, sim }, overrides?)`
returns the fully wired `RunDeps`: the economy (W2-2), PvE options, events,
rewards and real battles. Overrides: `rules`, `battle` (for tests, such as
`fixedBattle`), `hooks`, `handlers`, `eventHandlers` (event types, see below)
and `findPvpOpponent` (the ghost seam). `createEconomyDeps` still works and
keeps the stub battle and placeholder event hooks; `stubBattle` and
`fixedBattle` are still exported.

**PvE options (RS-6a).** `RunState.upcomingPve = { round, options } | null`
holds the three options (easy, medium, hard) for the coming PvE battle. They
are drawn and stored on entering the first `build` step and on entering the
shop that ends a round, not when `pve_choice` opens; `pve_choice` moves them
into `pending.options` and clears `upcomingPve`. It is set only in the first
`build` (round 1) and in the shop of the PvP leg, null everywhere else
(`validateRunState` checks this), and entering `run_over` clears it. Each option is `{ id,
difficulty, archetype, reward: { gold }, budget, summary, threat }` (see
`readPveOption`, `PveOption`). `nextBattleInfo(state, deps)` is the selector
for the build and shop screens: `{ kind: 'pve', round, options }` (options
without the full `threat`) in the first `build`, in `pve_choice`, and in the
shop that ends a round; `{ kind: 'pvp', round, opponent: 'unknown', stakes:
{ winGold, lossGold, lifeCost } }` in the event and shop steps of the PvE leg;
null elsewhere.

**Rewards.** Gold per player when a summary step ends: PvE win by the chosen
option, PvE loss nothing (and no life), PvP win and PvP loss (consolation) from
`economy.rewards`.

**Events.** `content/events.json` lists event definitions and modifiers. Each
definition's `type` selects an `EventHandler` (`available`, `instantiate`,
`resolve`, optional `choose`); A handler that can return a follow-up sets
`canAskFollowUp` and must have `choose`; a handler that is always available
(the Windfall) sets `alwaysAvailable`. `defaultEventHandlers` has `workshop`,
`shrine` and `windfall`. A new type is data plus one handler passed as
`eventHandlers: { ...defaultEventHandlers, mine }`; the machine is unchanged.
`createGameDeps` throws when a definition names a type without a handler,
when a follow-up handler has no `choose`, or when no definition has an
always-available handler. Offers are 1 to 3, never two of one type: up to
`offerCount` distinct event definitions are drawn by weight without
replacement from the available ones (one weighted pick per offer made), so
fewer types available means fewer offers (issue #48). Offers are `{ id, event, type, ...data }` in `pending.options` (vote with
`{ type: 'vote', choice: <offer id> }`). A pick with a follow-up (Workshop:
which building; Shrine: which modifier) enters `event_resolve` with `pending =
{ offer, followUp: { prompt, options, votes } }`; every player sends `{ type:
'event_choose', choice: <option id> }`. This is a party vote like the others:
changeable until the last player has voted, most votes wins, a tie goes to the
host. The Shrine's modifier is added to `team.modifiers` (applied by the
simulation, see `docs/rules-reference.md`); Workshop raises one owned building
by one tier (never above 3). Events never add a building.

**Battles and playback.** `BattleResult.detail` has no event log: it holds the
seed, the opponent source, a hash of the team and a small summary with the
event-log hash (`BattleDetail`). `replayLastBattle(state, deps)` (legal in
`pve_summary` and `pvp_summary`) returns `{ ok, battle, stored,
storedEventLogHash }` with a started `Battle` at tick 0 for playback;
`verifyLastBattle` runs it and compares hashes. PvP fights a generated boss
until a ghost pool exists (`findPvpOpponent`); the boss's `ThreatProfile` is
stored in the detail (`source.threat`) and replays use it, not current
content. A ghost's modifiers (its own team state) apply to side 1.

## Saving (W2-4)

`session` defines the save FORMAT, the RULES and a storage INTERFACE; it does
no I/O. A browser implementation of `SaveStore` (IndexedDB) lives in
`packages/web`. Time is always passed in (`now`, an integer).

**Record** (`SaveRecord`, `schemas/save.schema.json`): `saveFormatVersion: 1`,
`runId`, `runVersion`, `installedVersionAtSave` (updated on every write),
`actionCounter`, `hostName`, `playerNames`, `createArgs` (what `createRun`
got, so the run can be replayed from `state.seed` and `state.actionLog`),
`state`, `summary` (`round`, `lives`, `step`, `outcome`), `updatedAt`, and an
optional `signature` (reserved; accepted and preserved, never computed here).
`parseSaveRecord(raw, deps)` is the loader: shape, cross-field checks, then
`validateRunState`. It never throws; bad input gives `{ok: false, errors}`.

**Controller** (`startRun`, `openRun`; `removeRun`, `initSaves`): the only way
the app touches a run. `dispatch(player, intent, now)` applies the intent; a
rejected intent writes nothing; an accepted one is saved with `await
store.put` BEFORE the result is returned (CP-23a). If the save fails the
controller keeps its old state and returns `save_failed`; the same intent can be
retried. Dispatches are queued, so saves are in action order. When the run
ends, history is appended and then the save is removed; `initSaves` repairs an
interruption between the two. Nothing stored is recomputed on open: offers and
the battle result are outcomes inside the state, so a rules or economy change
only affects the next roll and the next battle. Only the most recent battle's
`detail` is in a save (`pending.battle`); `history` holds results only.

**Versions**: `classify(runVersion, installed)` is `same`, `older_minor`,
`older_major` or `newer`. `openRun` sets `versionNotice` for `older_minor`;
`older_major` and `newer` saves cannot be opened. `initSaves(store, installed,
now)` deletes older-major saves (history reason `version_wiped`, with the
round reached), finishes saves whose state has an `outcome`, and reports
`newer` and corrupt ones without touching them. A corrupt save is never
deleted by `openRun`.

**One save per run, no copies**: a record is keyed by `runId`. `put` with an
existing `runId` replaces it, `startRun` rejects (`run_exists`) an ID that is
saved or already in history, and the interface has no way to copy a record to a
new ID. Do not add one.

### What a `SaveStore` must guarantee

- `put(record)` is atomic: when it resolves the whole new record is stored;
  when it rejects the previous record for that `runId` is intact and readable,
  and no partial record exists. Writes to one `runId` end with one complete
  record. Stored values are copies (later changes to the object passed in do
  not alter the store).
- `list()` returns every stored run (no limit), sorted by `updatedAt`
  descending, then `runId`. A stored value that does not parse is still listed,
  as `{corrupt: true, runId, updatedAt, errors}` (use `summarizeStored`).
- `get(runId)` returns what was stored (even if damaged; callers validate), or
  null. `remove` resolves also for an unknown ID.
- At most one record per `runId`, ever; no duplicate IDs.
- `appendHistory` keeps append order and ignores an entry whose `runId` is
  already in history; `bestDepthByPartySize` is the highest `round` per party
  size over the history (`bestDepthFromHistory`).

`runSaveStoreConformance(name, makeStore)` from `@game/session/testing`
checks all of this; `makeStore` must return a fresh, empty store. The browser
store must pass it. `createMemorySaveStore` is the reference, with fault
injection (`failNextPut`, `failNextRemove`, `beforePut`, `beforeRemove`,
`injectRaw`).
