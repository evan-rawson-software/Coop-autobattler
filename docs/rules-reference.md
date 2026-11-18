# Rules reference

## Purpose and how to use it for a port

Battles are deterministic (CB-30): the outcome is a pure function of
`(team, opponent, seed, game version)`. The simulation will be re-implemented
in another language (GDScript or C#, TA-49/TA-50). This document is the
language-neutral statement of the rules; the golden vectors in `golden/` are
the proof.

To port: implement each section below from the text alone, then write a test
runner that loads every file in `golden/`, runs the function named by `kind`
on `input`, and compares with `expected` (see "Golden vectors"). The port is
correct when every vector passes bit for bit. Start with the PRNG vectors
(`prng-*`), then integer math, then the hash, then the simulations.

All arithmetic that can affect an outcome uses integers only. Where this
document says "u32", the value is an unsigned 32-bit integer and every
operation is taken modulo 2^32. Where it says "i64", a signed 64-bit integer
is enough (the reference implementation additionally throws when a value
leaves +/- (2^53 - 1), so ported code never needs more than i64).

**What this document describes.** Every section describes the code on
`main` and is pinned by the golden vectors. Some sections start with a
**Status (#124)** table naming the per-player rules that changed them; every
one of those rules is implemented. The per-player design of
issue #124 (rules PP-1 to PP-18) is recorded in the appendix
at the end, "Appendix: the per-player design (issue #124)".

### Notes for a port

The reference implementation is TypeScript. These are the places where its
language does something a GDScript or C# port would not do by itself; the
code is written so that none of them changes a result, and a port keeps it
that way.

- **Sorting.** Godot's `sort_custom` and C#'s `List.Sort` are not stable.
  Every sort that decides a result has a total order: its comparator breaks
  every tie, down to an id, a cell, or the item's position in the list it
  came from (written as an explicit `seq` or index tie-break). Port each
  comparator with all of its keys.
- **Gated offers.** Do not remove an entry with `fromRound` above the round
  from the list before a shop draw and do not skip it: keep it at weight 0 in
  its place (the result is the same as removing it, but the wall-shape redraw
  and any later entry stay in file order).
- **Boss draw.** The boss list keeps file order and the previous boss is
  removed before the single `nextInt` (never after it), only when more than
  one boss is eligible; the draw is on the child `boss` of `ghost:r<round>`,
  which a child does without advancing its parent.
- **Map and Set order.** JavaScript iterates a `Map` or `Set` in insertion
  order; a C# `Dictionary` or `HashSet` has no order. Rules code never
  iterates one: it keeps an array alongside, or reads the keys sorted
  (`sortedInts`, `sortedIntEntries`, `sortedKeys`). Object keys are likewise
  only read sorted by code point. A lint rule enforces this in `core`,
  `session/src/rules` and `session/src/bot`.
- **Pylons.** The goal swap lives in the goal set, not in `chooseTarget`: the
  unit's `target` stays the Core's player index, and the goal set
  (`goalBuildings`) is the Core's standing pylons while any stands (so the
  movement field, the breach field, the walk to the goal at distance 0, the
  flyer's walk to the goal and rule b all follow, and everything is recomputed
  when a pylon is destroyed, which drops the cached fields like any
  destruction). A breach route never enters the shielded Core or a goal
  pylon. The shield filters unit attacks only; the Overload decay is not
  blocked. The generator's pylon placement uses the real movement field (an
  arena built from the profile) to avoid sealing a Core, and an integer-only
  sector rule (no angles, no floating point) to spread the pylons; draws come
  only from `holdRng.child(p).child("pylons")`, never from a stream the
  layouts use. The `pylons` side option and the `ArenaPylon` list exist only in
  a battle that has them (a state hash of any other battle must not change).
- **Champions.** `unitStats(side, def, strengthPercent, healthPercent)` has
  two nested floors for health: `mulPct(mulPct(health, 100 + P), hp)`, never
  `health * (100 + P) * hp / 10000`. `healthPercent` rides the wave entry into
  the `entering` queue and is applied at the entry's spawn; the champion entry
  is listed first in its tick, so it is queued first and enters first (lowest
  unit ID of the wave) when there is room. The wave index `j` of the start
  column counts the champion entries (they are ordinary entries of the list),
  so the other entries of a Warlord's waves start further along than a
  Boss's. The champion price formula uses the unit's `unitCost` and the wave
  budget only, never the strength percent.
- **Core bursts.** The line is `floor(starting * t / 100)` in integer
  arithmetic (no floating point), compared as "health before the tick's damage
  above the line and health after it at or below it"; use the Core's
  *starting* health (its `coreHealths` entry), not a maximum that a modifier
  changed. A threshold fires once, in step 4 after all damage, in the order
  Core ascending then threshold descending, and the units enter in the next
  tick's Production step, after the producers and before the scheduled waves,
  using the producer spawn-cell key (class, distance, tie key) around the Core.
  The `bursting` queue keeps its order and entries that find no room stay in
  place. The burst split uses `share()` over `partySize * thresholds` slots,
  Core-major; a burst counts as a wave in the strength conversion. The state
  has no `bursting` field unless a side has bursts (a state hash of any other
  battle must not change).
- **Linked Cores.** A side with `linkedCores` keeps its Cores' own `hp` as
  they are while the pool stands; every sum, comparison and overkill below
  reads the pool instead, and the pool is the only thing damage touches. Sum
  the tick's damage on all of the side's Cores first (the saturating sum of
  "Integer math conventions" over the Cores in player order, attacks and
  decay together; a separate saturating sum of the attacks alone for the
  `buildingDamageDealt` credit), then subtract once. The decay is added once
  (to the lowest living Core) and logged once. When the pool is 0 or below,
  set every living Core of the side to 0 in that step (player order); the
  first of them carries the overkill, the others 0, so the generic "sum the
  overkill of the Cores destroyed in the latest tick" needs no special case.
  Rung 1 of the ladder still counts Cores standing (all of them, or none), and
  rung 2 reads the pool as `sumHp`. The state gets a `linkedPools` list only
  when a side has `linkedCores`.
- **Per-resource counters.** A two-input consumer (CB-5e) keeps one counter per
  resource. They are a plain list ordered by resource ID (code point order),
  the order of the tier's `costs` after `sortedKeys`, and are only ever read
  by index, never by iterating a dictionary. `costs` itself is an object read
  sorted by key; a port stores it as a sorted list of `(resource, cost)`.
- **Refinery state.** `BoardSim.refineries` exists only on a board that has a
  refinery (CB-5d): a port keeps the field optional (or keeps it and leaves
  it out of the hash when empty) so that the state hash of every other board
  is unchanged. A refinery's counters are the per-resource list described
  above; its output store is a plain count. Items made in a batch are
  logged as one `produced` event each, and a refinery acts in step 3a of
  `stepFlow` (after the sources), in building ID order, in every consumer mode.
- **Armor.** `armor` is optional in `units.json` and is 0 when absent; a port
  must not write it into a saved or hashed unit (a unit is
  `{id, side, def, px, py, hp, damage, attackCooldown, owner, target}`), so
  every existing state hash is unchanged. It is read from the definition
  when a hit is dealt, as the last step of the damage order of CB-5h
  (after Overload and the splash percent), one hit at a time:
  `max(1, hit - armor)` for `hit > 0`, never on the sum of a tick. The
  `unit_attacked` and `turret_fired` events carry the reduced value.
- **Splash.** `splash` (`{radiusSub, percent}`) is optional in `units.json`
  and absent from the definition when not given; like `armor` it is never
  written into a saved or hashed unit, so every existing state hash is
  unchanged. A port finds the secondary targets through its per-side cell grid
  (the grid of the opposing side, cells `cellCoord(px -+ radiusSub)` in each
  axis, the same grid that is current in step 4) and not by scanning every unit;
  the result must be in unit `id` order, which is list order. The test is
  integer: `dx*dx + dy*dy <= radiusSub*radiusSub` on the centres. All secondary
  hits join the per-tick damage accumulation of step 4 exactly like the
  primary hit; none is applied early. The `splash` event is recorded right
  after the `unit_attacked` event of the same attacker.
- **Resources without a rarity.** A resource is a *base* resource exactly when
  it has no `refinedFrom`. Only base resources have a `rarity` and only base
  resources are placed on maps (`listBase`, in file order); a port must not
  give a refined resource a default rarity. Adding a refined resource to
  `resources.json` after the base ones leaves every map unchanged.
- **Indexes.** `x[i] ?? 0` on a typed array is a type-checker formality: the
  index is in range by construction. Where an index can be -1 (no unit, no
  building), the code checks `i >= 0` before reading; a port must keep those
  checks (GDScript `a[-1]` is the last element, C# throws).
- **Exceptions.** No rule uses an exception to decide an outcome. `throw`
  marks a broken invariant or out-of-bounds input at setup (content bounds,
  a value outside the safe-integer range); a port may treat those as fatal
  asserts. Where a refused value is an ordinary outcome, the code uses a
  never-throwing form: `canonicalJsonOrNull`, `workshopPriceOrNull`, and the
  neutral-zone attempt, which returns its failure reason. The `try`/`catch`
  blocks left in `session` only guard against JavaScript values that throw
  when read (getters, proxies); plain parsed data never reaches them.
- **Missing fields.** Canonical JSON refuses `undefined`, so an optional field
  of a state, snapshot, event or result is **left out** when it has no value,
  never written as `null` (unless its description says it is nullable). A
  port's serializer must do the same, or the hashes differ.
- **Integers.** Every quantity fits an i64 (see "Integer math conventions").
  The PRNG and FNV-1a work in u32: in GDScript, whose `int` is 64-bit, mask
  with `& 0xFFFFFFFF` after every multiply, add and shift; in C#, use `uint`.
  The reference implementation is exact only while a product stays below
  2^53; the largest product in a tick (the degree-4 overlap test in unit
  movement) stays far below that on every board the game can make, so an
  exact i64 port agrees with it everywhere it matters.
- **Strings.** Text limits (`label` and id lengths in ghost snapshots and
  saves) count UTF-16 code units, and the ghost order (`compareGhosts`)
  compares strings by UTF-16 code unit. Godot strings index by code point, so
  a port counts and compares UTF-16 units explicitly (they agree with code
  points for every character below U+10000). Canonical JSON sorts object keys
  by code point. A ghost's identity `ghostKey` is the JSON text of the array
  `[owner id, run id]`: for every id the validator accepts it is
  byte-for-byte the canonical JSON of that array.
- **Battle object.** `startBattle` returns its running battle as an object of
  closures over a few counters (ramp steps, the timeline, the result); in a
  port that is simply a class with those fields. Only `ArenaSim` is state
  that is saved and restored.

## The PRNG

Algorithm: **xoshiro128\*\*** (state of four u32 words), seeded with
**splitmix32**. Only u32 operations are used.

Notation: `+`, `*`, `^` (xor), `<<`, `>>` are u32 operations (mod 2^32, shifts
drop bits). `rotl(x, k) = (x << k) | (x >> (32 - k))`.

### Seeding

Input: a u32 `seed`. Let `counter = seed`. For each of 4 words:

```
counter = counter + 0x9E3779B9
t = counter
t = t ^ (t >> 16)
t = t * 0x21F0AAAD
t = t ^ (t >> 15)
t = t * 0x735A2D97
t = t ^ (t >> 15)
word[i] = t
```

The state is `(s0, s1, s2, s3) = (word[0], word[1], word[2], word[3])`. If all
four are zero (cannot happen in practice) the state is set to `(1, 0, 0, 0)`.
Example: seed 0 gives state `64625032 d9c0799c af362e10 7fa88912` (hex).

### State and step function

The state is exactly the four u32 words. To save a game, store them as four
integers; to restore, load them (all-zero is invalid).

`nextU32()`:

```
result = rotl(s1 * 5, 7) * 9
t = s1 << 9
s2 = s2 ^ s0
s3 = s3 ^ s1
s1 = s1 ^ s2
s0 = s0 ^ s3
s2 = s2 ^ t
s3 = rotl(s3, 11)
return result
```

First outputs for seed 0: `1789933344, 44971166, 2521387044, 3848737593`.

### nextInt(n): unbiased integer in [0, n)

Defined for `1 <= n < 2^32`; anything else is an error.

```
threshold = (2^32 - n) mod n        // computed with ordinary integers >= 2^32,
                                    // or as ((0 - n) mod 2^32) mod n in u32
loop:
    x = nextU32()
    if x >= threshold: return x mod n
```

Outputs below `threshold` are rejected so that every residue has the same
number of accepted outputs (no modulo bias). `nextInt` always consumes at
least one output, including when `n = 1`. Rejections consume outputs too, so
ports must loop exactly as above.

### pick and shuffle

`pick(list)`: error if empty; return `list[nextInt(length)]`.

`shuffle(list)` (Fisher-Yates) returns a new list: copy the list, then for
`i` from `length - 1` down to `1`: `j = nextInt(i + 1)`; swap elements `i` and
`j`. A list of 0 or 1 elements consumes no output.

### Child streams

`child(label)` returns a new generator and does not change the parent. The new
seed is the FNV-1a 32 hash (see below) of this byte sequence:

1. the parent's four state words, each as 4 bytes little-endian, in order
   `s0, s1, s2, s3`;
2. the label: for a string, the byte `0x73` followed by its UTF-8 bytes; for a
   u32 integer, the byte `0x69` followed by 4 bytes little-endian.

The hash is then used as `seed` in the seeding step above. Because the
derivation depends on the parent's current state, derive the children (map,
shop, battle, ...) from a root generator before drawing from it, or from a
generator that is only used to derive children.

## Integer math conventions

- Division always rounds toward negative infinity (floor), including for
  negative operands. `mulDiv(a, b, c) = floor(a * b / c)`, `c != 0`.
- `a * b` must fit the safe range, |a * b| <= 2^53 - 1; otherwise the
  reference implementation throws. Ported code should treat such inputs as
  an error too (never wrap, and never saturate except in the one place below).
- `addInt(a, b)` is `a + b` and throws if the sum leaves the safe range. Every
  sum outside the damage rule uses it (or `mulInt`/`mulPct`), so it is exact
  or an error, never truncated to 32 bits.
- `mulInt(a, b)` is `a * b` and throws if the product leaves the safe range.
- `addSaturating(a, b, cap) = min(cap, a + b)` for `0 <= a <= cap` and
  `0 <= b <= (2^53 - 1) - cap`, so `a + b` is exact before the cap is applied;
  it throws for any operand outside that range. It is the **only** saturating
  operation, and it is used for exactly one quantity: the damage one target
  takes in one tick. The rule, in full: every single hit is an integer from 0
  to `MAX_HIT = 2^51` (a unit hit after Overload scaling, or an Overload Core
  decay; both are checked at battle setup, which fails otherwise; a turret
  shot is at most `MAX_DAMAGE = 1e12`, below `MAX_HIT`). The damage a target
  takes in a tick starts at 0 and each hit is added with
  `addSaturating(sum, hit, MAX_TICK_DAMAGE)`, `MAX_TICK_DAMAGE = 2^52`. As all
  terms are non-negative, the result is `min(2^52, exact sum of the hits)`,
  whatever the order. Health is at most `MAX_HEALTH = 1e12`, far below 2^52,
  so a target whose sum saturated dies exactly as it would with the exact sum.
  The only difference is the Core's overkill (`hp - damage`, see "Core health
  and overkill"): it is computed from the saturated sum, so a Core's overkill
  never exceeds `2^52 - hp`. A 64-bit port gets the same results for every
  input that does not throw.
- All helpers throw on non-integer or out-of-range input.
- Basis points: 10000 = 100%. `mulBps(v, bps) = mulDiv(v, bps, 10000)`.
  `mulPct(v, p) = mulDiv(v, p, 100)`. Both floor.
- `modFloor(n, d)` has the sign of `d`; `divFloor(n, d) = (n - modFloor(n, d)) / d`.
- `compareFractions(a, b, c, d)` compares `a / b` with `c / d` (`a, c >= 0`,
  `b, d > 0`, all safe integers) and returns -1, 0 or 1 without forming any
  product (so it is exact for every safe input; it throws otherwise). Set
  `flip = false` and repeat: let `qa = floor(a / b)`, `qc = floor(c / d)`.
  1. if `qa != qc`: let `r = -1` if `qa < qc`, else `1`; return `r` if `flip`
     is false, `-r` if `flip` is true;
  2. let `ra = a - qa * b`, `rc = c - qc * d` (the remainders, `qa == qc`);
  3. if `ra == 0` and `rc == 0`: return 0;
  4. if `ra == 0` (the first fraction is the smaller): return -1 if `flip` is
     false, 1 if true;
  5. if `rc == 0` (the second is the smaller): return 1 if `flip` is false,
     -1 if true;
  6. otherwise `ra / b < rc / d` holds exactly when `b / ra > d / rc`, so
     continue with `(a, b, c, d) = (b, ra, d, rc)` and `flip = not flip`.
  Each round is a step of Euclid's algorithm on both fractions, so it ends
  after at most about 80 rounds; `qa * b` is at most `a`, so it never leaves
  the safe range.
- `clamp(v, lo, hi)` requires `lo <= hi`. `minInt`/`maxInt` take two integers.
- Never use floating point for anything that can change a result. The lint
  rules for `packages/core` also forbid clocks, timers, `Math.random`,
  `for...in`, `Object.keys/values/entries`, and `sort()` without a comparator.

## Canonical JSON and the hash

Event logs and results are hashed from their canonical JSON text:

- Allowed values: `null`, `true`, `false`, integers, strings, arrays, objects.
  Floats, NaN, infinities, negative zero, `undefined` and integers outside
  +/- (2^53 - 1) are rejected.
- No whitespace anywhere.
- Object keys are sorted by Unicode code point (equivalently, by UTF-8 bytes),
  ascending.
- Strings are written in double quotes. Escapes: `\"`, `\\`, `\b`, `\t`, `\n`,
  `\f`, `\r`; other code points below U+0020 as `\u00xx` with lowercase hex;
  everything else (including U+007F and non-ASCII) is written literally.
  Strings must not contain lone surrogates.
- Integers are written in decimal with no leading zeros or `+`.

The hash is **FNV-1a, 32 bit**, over the UTF-8 bytes of that text:

```
h = 0x811C9DC5
for each byte b: h = (h ^ b) * 0x01000193      // u32
```

It is written as 8 lowercase hexadecimal digits, zero-padded. Check values:
the empty byte string hashes to `811c9dc5`; `null` to `77074ba4`;
`{"a":1}` to `8b9e4511`.

The hash of a simulation's event log is `eventLogHash`: the hash of the
canonical JSON of the array of event objects.

## Content bounds

Health, damage and the breach constants are capped so that every sum and
product that affects an outcome stays an exact integer (|x| <= 2^53 - 1) on
the largest supported board. The core exports the constants (`limits.ts`);
the loaders and the JSON schemas enforce the same numbers. The caps are huge
on purpose: PvE threats (below) are not limited by them in rounds 1 to
`maxThreatRound`.

| Constant               | Value               | Applies to                                                                |
| ---------------------- | ------------------- | ------------------------------------------------------------------------- |
| `MAX_HEALTH`           | 1 000 000 000 000   | `health` of every building tier (Core included) and unit; run-time health |
| `MAX_DAMAGE`           | 1 000 000 000 000   | `damage` of a unit and of a turret tier; run-time scaled unit damage      |
| `MAX_BREACH_BASE_COST` | 1 000 000           | `breachBaseCost` and `breachHealthPerCost` in `sim.json`                  |
| `MAX_TIER_COST`        | 1 000 000           | each value of `costs` of a unit producer tier (CB-5e); at most four of them |
| `MAX_OUTPUT_PER_BATCH` | 1 000               | `outputPerBatch` of a refinery tier (CB-5d)                               |
| `MAX_UNITS_PER_PRODUCTION` | 4               | `unitsPerProduction` of a unit producer tier (CB-13a); 1 when absent      |
| `MAX_TUNNEL_SPAN_CELLS` | 12                 | `maxSpanCells` of a Tunnel entrance (CB-9g): the cells between its two ends |
| `MAX_ARMOR`            | 1 000               | `armor` of a unit (CB-5h); 0 when absent                                  |
| `MAX_SPLASH_RADIUS_CELLS` | 2                | `splashRadiusCells` of a turret tier (CB-18b): `MAX_SPLASH_RADIUS / 240`; `splashPercent` is 1 to 100 |
| `MAX_SPLASH_RADIUS`    | 480                 | `splash.radiusSub` of a unit (CB-5h): 1 to 480 sub-cell units (two cells); `splash.percent` is 1 to 100 |
| `MAX_ARENA_CELLS`      | 8 192               | arena cells (`width * height`) for which a breach field is computed       |
| `MAX_TICK_DAMAGE`      | 2^52                | most damage one target takes in one tick (the sum saturates here)         |
| `MAX_HIT`              | 2^51                | most one hit may deal after Overload scaling                              |
| `CELL_UNITS`           | 240                 | sub-cell units per cell (positions, radii, reach)                         |
| `MAX_UNIT_RADIUS`      | 480                 | `radius` and `collisionRadius` of a unit (two cells)                      |
| `MAX_UNIT_REACH`       | 1 920               | `reach` of a unit (eight cells)                                           |
| `MAX_SEPARATION_CAP`   | 480                 | `separationCap` in `sim.json` (`separationPercent` is 0 to 100)           |

In `specialists.json` (issue #470, "Specialists"): `specialists` has 1 to
`MAX_SPECIALISTS` (16) entries, each `{ id, family, effects, signature }` with
a unique `id` matching `spec_[a-z0-9_]+` of at most `MAX_SPECIALIST_ID_LENGTH`
(48) characters, a `family` of `logistics`, `defense`, `units` or `industry`,
1 to `MAX_SPECIALIST_EFFECTS` (4) `effects`, and a `signature` building ID
matching `bld_[a-z0-9_]+`, unique across the file (the building itself is
added by a later step of issue #468, so it is not checked against
`buildings.json` yet). An effect is `{ kind, percent }` with a `kind` of
`unit_health_percent`, `source_speed_percent` or `production_speed_percent`,
or `{ kind: "building_health_percent", target, percent }` with a `target` of
the modifier targets (`all`, `wall`, `gate`, `turret`, `source`, `route`,
`unit_producer`, `economy`); `percent` is an integer from 1 to
`MAX_SPECIALIST_PERCENT` (100); no other keys. The shipped numbers are the
placeholders of CB-51a, tuned in issue #477.

In `buildings.json`, `resourceSetting` (issue #473, "The resource setting and
the Mana Well") is an optional field of a building of kind `source` or, since
issue #476, `refinery` (the Transmuter, "The Transmuter"): `true` or absent
(`false` and any other value are refused, as is the field on any other kind).
A collector with it needs no extra number: it makes the resource its owner
chose, at its own tiers' `intervalTicks` (an integer of at least 1, as for
every collector). A refinery with it has no `output`, exactly one input that
names no `resource`, and per tier `costPerBatch` (an integer from 1 to
`MAX_TIER_COST`, 1000000) instead of `costs`; a refinery without it is as
before (`output` and `costs` required, `costPerBatch` refused).

In `points.json` (points of interest, "The neutral zone"): `chancePercent` is
0 to 100; `bandMarginCells` is at least 0 and twice it must be below
`plotWidth` (the loader checks this when it knows the mapgen file, `pnpm
validate:content` always does; the generator also treats a band with no column
left as having no point); `buffs` has 1 to 16 entries, each with a unique `id`
matching `poi_[a-z0-9_]+`, a `kind` of `unit_strength` or `heal`, an
integer `weight` from 1 to 1000 and the numbers of its kind (CB-8g, no other
keys): `strengthPercent` 1 to 10 000 for `unit_strength`; `healIntervalTicks` 1
to 1 000 000, `healRadiusCells` 1 to 8 and `healAmount` 1 to 1 000 000 for
`heal`; the file's `maxPointStrengthPercent` is 0 to 100 000 (outside the
Armory cap). The point bonus must leave every unit within `MAX_HEALTH` and
`MAX_DAMAGE` together with `maxUnitStrengthPercent`: checked by a test and, for
the battle at hand, at tick 0 ("Points of interest", "Buffs"). `neutralZone.depth` in `mapgen.json` must be
odd (the loader and `mapgen.schema.json` refuse an even one). `guards` (CB-8e):
`baseBudget` 1 to 1 000 000, `growthPercent` 100 to 1000, `maxGuardsPerPoint` 1
to 9 (the point's cell and its 8 neighbours), `leashCells` 1 to 8, `units`
1 to 16 entries with a unit ID of the unit file that does not fly, an integer
`cost` from 1 to 1 000 000, a `weight` from 1 to 1000, no unit twice. The
`capture` (CB-8f): `captureTicks` 1 to 1 000 000, `maxCapturersCounted` 1 to
1000, `captureRadiusCells` 1 to 8, `pointAggroRangeCells` 1 to 8 (all integers;
nothing else bounds them: a radius above the aggro range is allowed). The
guard budget is clamped like the threat budget so that every product of the
budget math stays below `2^53` (`growBudget` with the limit `floor((2^53 - 1) /
100000)`). A guard's strength percent that would take its health above
`MAX_HEALTH` or its damage above `MAX_DAMAGE` is **capped** to the largest
that does not (never an error, see "Neutral guards"); a guard never hits
harder than `MAX_DAMAGE`, which is below `MAX_HIT`, since Overload does not
affect it.

`offerWeights[].fromRound` in `economy.json` is an integer of at least 1 (no
upper bound; a value above the last round just never offers the entry); the
loader and `economy.schema.json` reject 0, negative and non-integer values, and
the loader also rejects a list in which no entry has `fromRound` 1 and no
`specialist` (some entry must be on offer in round 1 to every player, so that
the sum of the weights is positive in every roll). `offerWeights[].specialist`
(issue #472) is a string matching `^spec_[a-z0-9_]+$`; with the roster known (the
validator and every game build) it must be a specialist of `specialists.json`
and the entry's `def` must be that specialist's `signature` building, and a
`def` that is some specialist's signature building may be listed only with that
specialist (an entry without one is refused).

In `threats.json`, a boss-only archetype (`bossOnly` true) must have `fromRound`
(integer, at least 1; no upper bound) and `minPartySize` (integer from 1 to
`maxPartySize`). An archetype with `bossOnly` false must not have
`minPartySize`; it may have `fromRound` (the same field and meaning: the first
round `pickArchetypes` can offer it; absent means 1), and the loader rejects a
file in which no archetype with `bossOnly` false starts at round 1 (absent or
1), so round 1 can always offer a threat. The
loader and `threats.schema.json` enforce this, and the loader also rejects a
file that has boss-only archetypes but none with `fromRound` 1 and
`minPartySize` 1, so a boss can always be drawn. A file with no boss-only
archetype at all is still accepted: every archetype is then a boss candidate,
with no gating.

An archetype's `waves.count` is an integer from 1 to 16 (was 12 until the Swarm's
fourteen waves, issue #431) and `waves.growthPercent` from 100 to 300; the wave
sizes `s_k` stay below 2^53 for these bounds (at most `100 * 3^15`).

`layouts.maze` (issue #432) has seven integers: `coreRow` (at least 0), `rows`
(1 to 16), `rowSpacing` (2 to 16), `gapWidth` (1 to 64), `firstRow` (1 to 64),
`turretMinDistance` (at least 1) and `maxWallsPerPlot` (1 to 1024); all seven
are required, as is `layouts.maze` itself (the loader and the schema reject a
file without it). `stronghold.layout` may be `maze`. The generator also throws a
`RangeError` (a content error) when `firstRow` is on or past the front-most free row
(`plotDepth - 2`), when the last wall row would touch the Core's rows, when
`gapWidth` is at least `plotWidth`, or when the path is sealed (see "Layouts").

An archetype's optional `brood` (MM-9d, "Core bursts") is allowed only when
`bossOnly` is true (rejected otherwise). `brood.thresholdsPercent` is a list of
1 to 5 integers, each from 1 to 99, **strictly descending**; `brood.sharePercent`
is an integer from 1 to 60. Both the loader and `threats.schema.json` enforce
this (the loader messages: "strictly descending", "must be an integer from 1 to
99", "1 to 5 thresholds", "at most 60"). The profile's `stronghold.bursts` has
at most `maxPartySize * 5` Core-and-threshold pairs, each with one entry per
composition unit, `count` at least 1 (bounded by `maxUnitsPerWavePerPlot *
partySize`); the strength they share is bounded like a wave's (step 8 of
"Generation").

An archetype's optional `linkedCores` (MM-9d, "Linked Cores") is a boolean,
allowed only when `bossOnly` is true and, when it is `true`, only with
`minPartySize` of at least 2 and without `brood` (the loader rejects each
other combination: "only allowed when \"bossOnly\" is true", "\"minPartySize\" of
at least 2", "cannot be combined with \"brood\""; `threats.schema.json` has
the type and the boss-only note). The profile's `stronghold.sharedHealth` is
the sum of the Cores' `health`, each at most `MAX_HEALTH` and at most
`maxPartySize` Cores, so at most `8 * 1e12`, an exact integer. A linked pool
starts as the sum of its Cores' starting health (`coreHealths`, at most
`MAX_HEALTH` each), so the same bound holds in a battle.

An archetype's optional `pylons` (MM-9d, "Pylons") is an object, allowed only
when `bossOnly` is true and not together with `brood` or `linkedCores` (the
loader rejects each: "only allowed when \"bossOnly\" is true", "cannot be
combined with \"brood\"", "cannot be combined with \"linkedCores\""): `perPlot`
an integer from 1 to `MAX_PYLONS_PER_PLOT = 8`, `sharePercent` from 1 to
`MAX_PYLONS_SHARE_PERCENT = 60`, `minDistance` from 1 and `maxDistance` from 1
to `MAX_PYLONS_DISTANCE = 8`, `minDistance <= maxDistance`; the content must
have a pylon building (a defense of `defenseType` `pylon`). The profile has at
most `perPlot * maxPartySize = 32` pylons, each with `health` from 1 to
`MAX_HEALTH` (the generator clamps it; with the shipped content, rounds 1 to
`maxThreatRound`, the clamp is not reached), and the battle checks a pylon's
side option health the same way as a Core's (a `RangeError` from
`createArenaSim`, "Side option pylons"). A pylon's own tier health in
`buildings.json` is an ordinary building health (1 to `MAX_HEALTH`) that a
battle replaces. The pylon building is never offered, bought or owned: the
economy loader rejects it in `offerWeights`, in `startingKit` (also inside a
`pick`) with the message "is a boss-only pylon and cannot be bought, offered or
owned", `rollOffers` throws a `RangeError` if it is ever asked to roll one, and
`buyOffer` refuses an offer of one (`no_such_offer`, detail `boss_only`).

An archetype's optional `champion` (MM-9d, "Warlord") is an object `{unit,
healthPercent, sharePercent}`, allowed only when `bossOnly` is true and not
together with `brood`, `linkedCores` or `pylons` (the loader rejects each:
"only allowed when \"bossOnly\" is true", "cannot be combined with
\"brood\"", "\"linkedCores\"", "\"pylons\""). `unit` must be a known unit
with a `unitCost` entry ("has no unitCost"); `healthPercent` an integer from
`MIN_CHAMPION_HEALTH_PERCENT = 100` to `MAX_CHAMPION_HEALTH_PERCENT = 1000`;
`sharePercent` from 1 to `MAX_CHAMPION_SHARE_PERCENT = 60`; and `mulPct(unit
health, healthPercent)` must not exceed `MAX_HEALTH` (loader error "exceeds the
maximum"). A wave entry's `healthPercent` (profile, side option
`scheduledWaves`) is an integer of at least 100; the battle checks at setup
that `unitStats(unit, strength, healthPercent)` stays within `MAX_HEALTH`
(`RangeError` from `createArenaSim`), and the generator lowers
`unitStrengthPercent` so that `floor(floor(h * (100 + P) / 100) * hp / 100) <=
MAX_HEALTH` holds for the archetype's `healthPercent` `hp` (largest `P` for
which `floor(h * (100 + P) / 100) <= floor((100 * MAX_HEALTH + 99) / hp)`). A
champion counts toward the wave cap like any unit (step 5 below). The loader rejects a `maxUnitsPerWavePerPlot` below 2 when any archetype has a `champion`. With the
shipped content (Golem health 260, at most 600 percent) the clamp is not
reached in rounds 1 to `maxThreatRound`.

`focusCapPlots` (issue #433) is a required top-level integer of `threats.json`
(1 to 64; shipped 2). An archetype's optional `focus` (issue #433) is a boolean,
allowed only when `bossOnly` is false (the loader says "only allowed when
\"bossOnly\" is false"); absent means false. A wave entry's `plot` (profile,
side option `scheduledWaves`) is an integer from 0 to the plot count minus 1;
the battle checks it at setup (`RangeError` from `createArenaSim`).

A tier's `costs` (CB-5e) holds one integer from 1 to `MAX_TIER_COST` per
resource, at most one resource per input (so at most four); the combined cost
`costPerUnit` the loader derives from it is their sum, at most
`4 * 1 000 000`. `productionIntervalTicks` and the one-cost `costPerUnit`
keep their bound of an integer of at least 1. `needPer1000 = floor(1000 * cost
/ interval)` is at most `1000 * 4 * 1e6`, far below 2^53.

A unit producer tier's optional `unitsPerProduction` (CB-13a) is an integer from
1 to `MAX_UNITS_PER_PRODUCTION` (4); absent means 1 and the loader gives every
tier the field (1 when absent). The cost of one production, `costPerUnit *
unitsPerProduction` (and each `costs` value times it), is then at most `4 * 4 *
1e6`, so `needPer1000` stays far below 2^53. The field is refused on any other
kind of building ("field ... is not valid").

A route building of `routeType` `tunnel_in` (the Tunnel entrance, CB-9g) gives,
both required, `partner` (the building ID of its exit) and `maxSpanCells` (an
integer from 0 to `MAX_TUNNEL_SPAN_CELLS`, the same at every tier); the fields
are refused on every other building. `loadBuildings` checks the pair as a whole:
the partner exists, is a route building of `routeType` `tunnel_out` and is named
by no other entrance; every `tunnel_out` is some entrance's partner; both ends
are 1x1 with no mask; the entrance has exactly one input side and no output
side, the exit exactly one output side and no input side (neither names a
resource); and, tier by tier, the entrance's `price` is the exit's `price` or
one more (**the split of the item's price**: the entrance takes the odd gold, so
the two ends' prices add up to the item's price, see "Shops and gold"). The
economy loader refuses a `tunnel_out` in `offerWeights` or the starting kit
(it is bought only with its entrance). Health is per end and free.

A turret tier may also give, all optional (CB-18b; absent means the plain turret,
which behaves exactly as before): `minRangeCells`, an integer of at least 1 and
**below** the tier's `rangeCells` (the loader refuses an equal or larger one);
and `splashPercent` (1 to 100) with `splashRadiusCells` (1 to
`MAX_SPLASH_RADIUS_CELLS` = 2), given **together or not at all**. They are
content, not saved data, and are refused on a wall, a gate, a pylon and every
other kind. The splash radius in sub-cell units is `splashRadiusCells * 240`
(at most `MAX_SPLASH_RADIUS`), the minimum range `minRangeCells * 240`; both
products are far below 2^53.

A refinery tier's `costs` (CB-5d) is checked like those of a unit producer: one
integer from 1 to `MAX_TIER_COST` per input resource, at most one per input (a
refinery has one or two inputs). `outputPerBatch` is an integer from 1 to
`MAX_OUTPUT_PER_BATCH` and `productionIntervalTicks` an integer of at least 1,
so `refineryOutputPer1000 = floor(1000 * outputPerBatch / interval)` is at most
`1e6` and the output store never holds more than 1000 items.

A loader reports a value above its cap like any other bad field (for example
`"health" must be at most 1000000000000 (got 3000000000000)`), and the schemas
carry the same `maximum`. The caps apply to the numbers as declared; they are
not tier-by-tier relative.

Every place where health, damage or strength is multiplied or summed, with
its worst case at the caps (`H = MAX_HEALTH = MAX_DAMAGE = 1e12`; the shipped
board has 3744 cells, `MAX_ARENA_CELLS` allows more than twice that):

| Quantity | Worst case | Why it is exact |
| --- | --- | --- |
| Breach cost of one cell, `breachBaseCost + ceil(health / breachHealthPerCost)` | `1e6 + 1e12 = 1.000001e12` | one addition, checked with `addInt` |
| Breach distance, the sum of cell costs along a least-cost route | `8192 * 1.000001e12 < 8.2e15` | a route enters each cell at most once; below `2^53 - 1 = 9.007e15`; `addInt` throws otherwise |
| Breach heap order | none | the heap compares `(distance, cell)` pairs, distance first and then cell index; no packed key and no product |
| Time-limit rule, `hp0 / max0` against `hp1 / max1` | none | compared exactly by the Euclid-style `compareFractions` (no product of healths), for any safe integers |
| Scaled unit health or damage, `floor(v * (100 + P) / 100)` | `v * (100 + P) <= 100 * H + 99 < 1.1e14` | the result is checked against the cap; `mulPct` throws if the product is unsafe |
| Modifier on health or turret damage, `floor(v * (100 + S) / 100)` | `v <= H`, so `S` up to 8907 is safe | `mulPct` throws beyond that; the result is checked against the cap |
| Overload hit, `floor(damage * (100 + level * overloadDamageStepPercent) / 100)` | at most `MAX_HIT = 2^51 = 2.25e15` | `createArenaSim` computes it for the largest `level` (at `maxBattleTicks`) and for every unit type at the side's largest strength, and fails at setup if it passes `MAX_HIT`; shipped: level 103, 2160 percent, so at most 2.16e13 for a unit of 1e12 damage |
| Overload Core decay, `level * overloadCoreDamageStep` | at most `MAX_HIT` | checked at setup the same way; shipped: 515 |
| Damage to one target in one tick (units, turrets, decay) | saturates at `MAX_TICK_DAMAGE = 2^52` | each term is at most `MAX_HIT` (a turret at most `MAX_DAMAGE`); `partial sum + hit <= 2^52 + 2^51 < 2^53`, so the sum is exact, and a sum that reaches the cap stays there |
| Core overkill, `coreRemaining = hp - damage` | magnitude at most `2^52` | a saturated sum means the target is long dead (health is at most `H`); the tiebreak compares `hp - damage`, not the damages, so when both sums saturate the side with the higher pre-tick Core health has less overkill and wins (equal health: the tiebreak ladder, "End conditions") |
| Building damage dealt by one side (`buildingDamageDealt`), the sum over ticks and buildings of `min(attack damage, health before the tick)` | `8192 * 1e12 = 8.192e15 < 9.007e15` | each building yields at most its maximum health over the battle (every credit also lowers its health by at least that much), `H` at most; at most `MAX_ARENA_CELLS` buildings; summed with `addInt`, which therefore never throws, so no saturation is needed |
| Units killed by one side | at most the units ever spawned | counted as the other side's `unitsDied`, one per dead unit |
| Unit strength percent `P` (base option + modifiers + ramp bonus) | the largest value accepted is `maxStrengthPercent(unit)`, 2 499 999 999 902 for the shipped soldier | `unitStats` throws a `RangeError` for any `P` that would push a unit past `MAX_HEALTH` or `MAX_DAMAGE`; `addInt` for the sum of percents |

**Geometry (issue #59).** The arena has at most `MAX_ARENA_CELLS = 8192`
cells, so every coordinate is at most `8192 * 240 = 1 966 080` (below 2^21).
`aggroRangeCells` is at most `MAX_ARENA_CELLS`, `moveCooldownTicks` from 1 to
240, `radius` and `collisionRadius` from 1 to 480, `reach` from 0 to 1920.

| Quantity | Worst case | Why it is exact |
| --- | --- | --- |
| Squared centre distance `dx^2 + dy^2` | `2 * 1 966 080^2 < 7.8e12` | far below 2^53; the loader bound on coordinates makes it exact |
| Contact test `(reach + R + Re)^2` | `(1920 + 480 + 480)^2 = 8.3e6` | |
| Aggro test `(aggroRangeCells * 240)^2` | `1 966 080^2 < 3.9e12` | |
| Step `dx * s` (speed `s <= 240`) | `1 966 080 * 240 < 4.8e8` | |
| Push `dx * o` (`o <= 960`) | `1 966 080 * 960 < 1.9e9` | only overlapping pairs reach it, so `|dx| <= 960` in practice |
| `awayDiv(ox * R, d)` | `1 966 080 * 480 < 9.5e8` | |
| Sum of pushes on one unit in a pass | at most the number of overlapping neighbours times 960 | a unit overlaps at most a few dozen circles |
| `isqrtFloor` / `isqrtCeil` argument | below `7.8e12` | exact: a float estimate corrected in both directions until `r^2 <= n < (r+1)^2` |

Distances and each building's maximum health are held in 64-bit float arrays
that only ever contain integers (never 32-bit integers, which would wrap at
2^31), and every sum outside the damage rule uses `addInt`/`mulInt`/`mulPct`,
so a value outside the safe range is an error (`RangeError`), never a wrapped
or rounded number. A board with more than `MAX_ARENA_CELLS` cells is an error
when its breach field is computed.

Values that are scaled at run time are held to the same bound and checked,
never wrapped. Every check is made by `createArenaSim` before tick 0, so a
battle either starts or fails with a `RangeError` at setup, never in the
middle:

- **Maximum health** of a building is computed in one place (`maxHealthOf` in
  `max-health.ts`) and used for the health it starts with, its breach cost in
  the simulation, and its breach cost in the enemy-path preview: the tier's health (the Core is tier 1), or the `coreHealths` side
  option entry of its player for the Core, then raised by the team's `core_health_percent` (Core)
  or matching `building_health_percent` effects (any other building) plus,
  for a building, the matching `building_health_percent` effects of its
  owner's specialist (summed, then applied once; "Specialists", "Family
  bonuses"), as `floor(value * (100 + sum) / 100)`. The percent sum is accumulated with
  `addInt`; a sum beyond 2^53 - 1, or one for which `value * (100 + sum)`
  would leave the safe range, is a `RangeError` naming the modifier kind. The
  result must not exceed `MAX_HEALTH`;
  each `coreHealths` entry must be an integer from 1 to `MAX_HEALTH`.
- **Turret damage** (`floor(tier damage * (100 + sum) / 100)` with the team's
  `turret_damage_percent`) must not exceed `MAX_DAMAGE`. The percent sum is
  accumulated with `addInt`, and a sum for which `damage * (100 + sum)` would
  leave the safe range is a `RangeError` naming `turret_damage_percent`, like
  the health modifiers above.
- A unit's scaled health and damage (`mulPct(base, 100 + P)`, see "Units")
  must not exceed `MAX_HEALTH` and `MAX_DAMAGE`; otherwise `unitStats` throws a
  `RangeError` naming the unit. For each side, `createArenaSim` checks every
  unit type up front with `P` = the side's `unitStrengthPercent` option, plus
  the sum of its `unit_strength_percent` effects that apply to that unit type
  (those with no `units` plus those whose `units` list the type), plus the
  largest ramp bonus the side can reach: `maxUnitStrengthPercent` if it has a `unit_strength` economy
  building, otherwise 0 (each owner is capped alone, so this bound holds for
  every owner). `maxStrengthPercent(unit)` (in `units.ts`) is the
  largest `P` a unit allows: the largest `P` with `floor(health * (100 + P) /
  100) <= MAX_HEALTH` and `floor(damage * (100 + P) / 100) <= MAX_DAMAGE`
  (a unit with 0 damage does not limit on damage). The same per-type `P`
  covers the units of a scheduled wave. Speed percents (issue #424) need no
  such check: they only shorten a cooldown, never below 1 tick, and their sum
  is accumulated with `addInt`.
- **Event definitions** (`content/events.json`): `fromRound`, if present, is an
  integer from 1 to 1000 (absent means 1). Market day's `params.extraOffers`
  and `params.freeRerolls` are integers from 1 to `MAX_SHOP_EFFECT_COUNT` (10),
  which also bounds the `count` of a saved next-shop effect. Rich vein's
  `resourceWeights` (issue #414) is a non-empty object from resource ID to an
  integer from 1 to `MAX_RESOURCE_WEIGHT` (1000); every key must be a base
  resource of `resources.json` (the loader, given the resources, and
  `events.schema.json`; a refined resource is rejected). It mirrors how map
  nodes are weighted: Ore and Power common, Flux rare, which is
  `nodesPerPlot.common` 3 against `nodesPerPlot.rare` 1 per base resource of
  that rarity (shipped: 3, 3, 1).
- Blueprint's `params.choices` (issue #412) is an integer from 1 to
  `MAX_BLUEPRINT_CHOICES` (10) and `params.maxOfferWeight` an integer from 1 to
  1000 (checked at wiring). A saved `held_offer` entry (see "Next-shop
  effects") names a building of `buildings.json` whose tier 1 has a price and
  that is not a boss-only pylon.
- Caravan's `params.gold` is an integer from 1 to 1000, each of `weightGold`,
  `weightUpgrade`, `weightNode`, `weightModifier` an integer from 0 to 1000 and
  `weightBuilding` from 1 to 1000; `resourceWeights` is required when
  `weightNode` is above 0 (checked at wiring and by `events.schema.json`).
- **Added nodes** (`content/mapgen.json`): `maxAddedNodesPerPlot` is an integer
  from 0 to `MAX_ADDED_NODES_PER_PLOT` (16); shipped 3. Map generation does not
  read it. 0 means Rich vein is never available and no state may hold an added
  node.
- **Modifier definitions** (`content/events.json`): every effect's `percent`
  is an integer from `MIN_MODIFIER_PERCENT` (-90) to `MAX_MODIFIER_PERCENT`
  (1000), never 0 (the loader, `events.schema.json`, a team state's parser and
  `team-state.schema.json` all check it). `pact`, if present, is `true`, and a
  pact has at least one positive and one negative effect and is not stackable.
  `minModifierSumPercent` (`sim.json`) is an integer from -99 to 0. `fromRound`, if present,
  is an integer from 1 to 1000 (absent means 1); a `unit_strength_percent`
  effect's `units`, if present, is a non-empty list of unit IDs with no
  duplicates, each a unit of `units.json`, **in the order of `units.json`**
  (the loader rejects any other order, so every definition has one canonical
  form and a held effect compares equal to it, see "Ghosts"). `units` is
  allowed on `unit_strength_percent`, `unit_move_speed_percent`,
  `unit_attack_speed_percent` (issue #424), `unit_splash_percent` and
  `unit_armor_flat` (issue #426) and on no other effect kind. The two
  speed kinds and `unit_splash_percent` and `poi_capture_speed_percent` have
  their own range: `percent` an integer from 1 to
  `MAX_SPEED_MODIFIER_PERCENT` (100), never negative (no drawback form, so no
  pact uses them); `unit_armor_flat` has `amount`, not `percent`, an integer
  from 1 to `MAX_ARMOR_FLAT` (10). A team state parses `units` the same way,
  except that the unit IDs are not checked against `units.json` and their
  order is not checked (a held effect must equal its definition anyway).
  **Stacking has no cap** (issue #423): the percent sum of a kind is bounded
  only by the existing checks above (`MAX_HEALTH`, `MAX_DAMAGE`, the safe
  integer range). Checked for ten stacks of every health modifier: the
  highest-health building is a tier-3 wall at 600, with `wall` +25% and `all`
  +10% held ten times each the percent sum is 350 and the health is
  `600 * 450 / 100 = 2700`; the Core (500) with `core_health_percent` +20%
  ten times is 1500. Even a thousand stacks stay far below `MAX_HEALTH`
  (1e12), so no cap on the summed percent is needed.
- The Overload hit and Core decay at the last possible tick must not exceed
  `MAX_HIT` (see the table).
- **Generated threats stay far below these bounds.** With the shipped content,
  for every archetype, threat type and party size 1 to 4, in every round 1 to
  `maxThreatRound` (63), the generated Core health is below `MAX_HEALTH` and
  `unitStrengthPercent` is below the largest `P` every unit allows, so
  nothing is cut off. The largest values, at round 63, are a Core health of
  266 885 486 545 (2.67e11, 3.7 times below `MAX_HEALTH`) and a
  `unitStrengthPercent` of 4 271 604 748 (585 times below 2 499 999 999 902).
  `generateThreat` still clamps (see "PvE threats", step 8) as a safety net
  for other content, and a test asserts that the clamp is never reached by the
  shipped content in rounds 1 to 63.

## Golden vectors

Files: `golden/*.json`. Each file is a JSON array of vectors, validated by
`schemas/golden-vector.schema.json`. A vector:

| Field         | Meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `id`          | Unique, lowercase, stable name.                                      |
| `kind`        | Which simulation function it exercises (a name in the registry).     |
| `description` | Optional note.                                                       |
| `input`       | Plain JSON passed to the function. Integers and strings only.        |
| `expected`    | `result` (plain JSON, compared structurally) and/or `eventLogHash`.  |

Kinds currently defined:
`prng-u32` (first `count` outputs for `seed`), `prng-sample` (`count` calls of
`nextInt(bound)`, then `shuffle` of `0..shuffleLength-1`, then `pick` of the
same list, and the final state), `prng-child` (the parent state and the first
`count` outputs of `child(label)`), `map-gen` (see Map generation),
`team-state-ops` (see Team state and placement), `flow-graph` (see Conduits), `flow-sim` (see Tick order), `arena-sim` (see
"Golden kind `arena-sim`"), `enemy-paths` (see "Enemy-path preview"),
`neutral-zone` and `battle` (see "The neutral zone" and "Battles"), `threat-gen`, `boss-pick` and
`pve-battle` (see "PvE threats").

`shop-roll` (see "Run random streams" and "Shops and gold"): input `{seed,
before, round, leg, players, rerolls}` and optionally `offerWeights` (a list of
`{def, weight, fromRound?, specialist?}` that replaces the shipped list for this
vector), `specialists` (one specialist ID or null per player, index = player;
absent or shorter: null; the specialist of that player's rolls and re-rolls,
issue #472; `shop-roll.23` to `shop-roll.26`) and
`extraOffers` (default 0: every roll and re-roll makes that many offers more than
`shopOfferCount`, Market day; `shop-roll.17` and `shop-roll.18`; the vectors
`run-replay.s6-p1-market-day` and `run-replay.s1-p2-market-day` play Market day
through its shop). Start at `rootRng(seed)`, draw each
label in `before` in order, then draw `shop:r<round>:<leg>`. For each player
`i`, roll the offers from that stream's child `p<i>`, then re-roll `rerolls`
times from the same child. The result lists each player's rolls (offers as
`slot def tier price`) and final stream state, and the run generator state
after the shop draw. `run-replay` (a run starts in `specialist_pick`, so its actions begin with each player's `pick_specialist` and `ready`; issue #470): input `{seed, players, actions}`, where
`actions` is a list of `{player, intent}`. The run is created with the given
seed and player names and the actions are applied in order, with a battle
resolver that always wins. The result is the final step, round, action count,
gold, shop offers, run generator state and the hash of the whole run state
(`hashJson`), or `{ok: false, reason, at}` if an action is rejected. Both kinds
need `@game/session`, which the `golden` package may depend on (it is test-only).

In the reference implementation the registry is `goldenKinds` in
`packages/golden/src/kinds.ts`; a new kind is one added entry. Each kind is an
adapter in `packages/golden/src/kinds/` (one file per kind or family of
kinds; the two session kinds are in `packages/golden/src/run-kinds.ts`) that reads the vector input, calls the rules in `core`
or `session`, and builds the result. The registry hands the adapters the
content from `@game/content`; a port needs its own way to hand content to
them.
`pnpm test`
runs all vectors and never rewrites them. `pnpm golden:update` regenerates the
`expected` parts and must be run deliberately; review the diff of `golden/`
like any other change.

## Map generation

**Status (#124).** This section describes the code on `main`. The rules
below are specified in "Appendix: the per-player design (issue #124)" and
changed this section; all of them are implemented.

| Rule | Change to this section | Status |
| ---- | ---------------------- | ------ |
| PP-15 | Every walkable cell of a plot is reachable from that plot's own front row through cells of that plot only ("Attempt steps"). | **implemented** (issue #129) |

Implemented by `generateMap` in `packages/core/src/generate-map.ts`. Parameters
come from `content/mapgen.json` (loader: `packages/core/src/mapgen.ts`), the
terrain flags from `content/terrain.json`, and resources and the Core footprint
from the resource and building content. Nothing is hard-coded in the generator.

### Coordinates

The board is a grid of cells `(x, y)`, integers only. `x` runs along the front
edge, from `0` to `width - 1`. `y` is depth: `y = 0` is the **back** row and
`y = height - 1` is the **front** row, the one facing the enemy; enemy units
enter across the front edge, into cells with `y = height - 1`. Movement and
adjacency are 4-directional (no diagonals). A cell is **buildable** if it has no
feature with `blocksBuilding`; a resource node cell is buildable. A cell is
**walkable** if it is in bounds and has no feature with `blocksMovement`.
Cells are ordered by `(y, x)`: smaller `y` first, then smaller `x`.

The board has one **plot** per player side by side: `width = partySize *
plotWidth`, `height = plotDepth`. Plot `p` (0-based, left to right) is the
columns `p * plotWidth` to `(p + 1) * plotWidth - 1`; `plotOf(x) =
floor(x / plotWidth)`. `partySize` is an integer from 1 to `maxPartySize`.

### Map format (plain JSON, `schemas/map.schema.json`)

`{ width, height, partySize, plotWidth, features, nodes }`. `features` lists
every blocked cell as `{ x, y, feature }` (`feature` is a terrain ID such as the
lake or cliff ID), sorted by `(y, x)`; a cell not listed is open ground. `nodes`
lists every resource node as `{ x, y, resource }`, sorted by `(y, x)`. Integers
and strings only. Key order for the canonical hash is irrelevant (the hash
sorts keys). A map's hash in the golden vectors is the FNV-1a 32 hash of its
canonical JSON, as for any value. The loader `loadMap` re-checks: integers,
`width = partySize * plotWidth`, every cell in bounds, no two entries on one
cell within a list, lists sorted by `(y, x)`, known feature and resource IDs,
no node on a feature cell.

### Parameters (`content/mapgen.json`)

`plotWidth`, `plotDepth`, `maxPartySize`; `nodesPerPlot.common` and
`nodesPerPlot.rare`; `maxAddedNodesPerPlot` (Rich vein, read by the team
state and the event, not by generation); `lakes` (`feature`, `countMin`, `countMax`, `sizeMin`,
`sizeMax`); `cliffs` (`feature`, `countMin`, `countMax`, `lengthMin`,
`lengthMax`); `minBuildablePercent`; `backMargin`, `frontMargin` (at least 1),
`sideMargin` (at least 1); `coreFrontClearance`; `placementTries`;
`maxAttempts`. Starting values: 24, 16, 4; 3 and 1; lakes 1 to 2 of 6 to 14
cells; cliffs 1 to 2 of 4 to 8 cells; 80; 2, 1, 1; 8; 30; 64;
`maxAddedNodesPerPlot` 3.

The file also holds the `neutralZone` object used only by battles (see "The
neutral zone"); board generation does not read it.

### Random draws

`between(rng, lo, hi)` means `lo + rng.nextInt(hi - lo + 1)`. It always makes
exactly one `nextInt` call, even when `lo = hi`.

Streams, using `child` (which does not advance its parent):

- `root = Rng.fromSeed(seed)`. Nothing is ever drawn from `root`.
- Attempt `a` (counting from 0): `A = root.child(a)` with `a` as an integer
  label.
- Plot `p`: `P = A.child(p)` with `p` as an integer label.
- Per plot: `lakesRng = P.child("lakes")`, `cliffsRng = P.child("cliffs")`,
  `nodesRng = P.child("nodes")` (string labels). Nothing is drawn from `A` or
  `P` themselves.

Each attempt generates all plots in order `p = 0 .. partySize - 1`; for each
plot it runs lakes, then cliffs, then nodes. One shared set of feature cells
and one shared set of nodes are kept across plots and across the steps.

### Attempt steps

Let `x0 = p * plotWidth`. The **feature region** of plot `p` is
`xLo = max(x0, sideMargin)`, `xHi = min(x0 + plotWidth - 1, width - 1 -
sideMargin)`, `yLo = backMargin`, `yHi = height - 1 - frontMargin` (inclusive).
Features only ever occupy cells in their own plot's feature region, so none
touch the left or right board edge, the front row, or the back `backMargin`
rows.

The four directions, in this fixed order, as `(dx, dy)`: `(0, -1)`, `(1, 0)`,
`(0, 1)`, `(-1, 0)`.

1. **Lakes** (`lakesRng`). `count = between(countMin, countMax)`. For each lake,
   make up to `placementTries` tries; each try draws, in this order,
   `size = between(sizeMin, sizeMax)`, `sx = between(xLo, xHi)`,
   `sy = between(yLo, yHi)`. If `(sx, sy)` already has a feature, the try fails
   (the draws stay consumed). Otherwise grow: `cells = [(sx, sy)]`; while
   `len(cells) < size`, build the candidate list by going through `cells` in
   order and, for each, the four directions in order, adding the neighbour if it
   is inside the feature region, has no feature, is not in this lake, and is not
   already a candidate; if the list is empty the try fails; otherwise
   `cells.append(candidates[nextInt(len(candidates))])`. A successful try marks
   all `cells` with the lake feature and ends this lake. If all tries fail, the
   attempt fails.
2. **Cliffs** (`cliffsRng`). `count = between(countMin, countMax)`. For each
   cliff, up to `placementTries` tries; each try draws, in this order, all of:
   `length = between(lengthMin, lengthMax)`, `bend = nextInt(2)`,
   `d1 = nextInt(4)`, `sx = between(xLo, xHi)`, `sy = between(yLo, yHi)`,
   `firstLen = 1 + nextInt(length - 1)`, `perp = nextInt(2)`. (All are drawn
   even if unused.) `dir1` is direction `d1`; `dir2` is direction
   `(d1 + 1) mod 4` if `perp = 0`, else `(d1 + 3) mod 4`. If `bend = 0` the cells
   are `(sx, sy) + i * dir1` for `i = 0 .. length - 1`. If `bend = 1` they are
   `(sx, sy) + i * dir1` for `i = 0 .. firstLen - 1`, then, with `L` the last of
   those, `L + j * dir2` for `j = 1 .. length - firstLen`. The try fails if any
   cell is outside the feature region or already has a feature; otherwise all
   cells get the cliff feature. If all tries fail, the attempt fails.
3. **Nodes** (`nodesRng`). Slots are built by going through the base resources
   in resource-list order (`listBase`); each contributes `nodesPerPlot.rare`
   slots if its rarity is `rare`, else `nodesPerPlot.common`. For each slot in
   order, the candidates are all cells of plot `p` (`x` from `x0` to
   `x0 + plotWidth - 1`, `y` from 0 to `height - 1`), listed by `(y, x)`, that
   have no feature and where neither the cell nor any of its four neighbours
   (on the whole board, so including the previous plot) holds a node. If there
   are none the attempt fails. Otherwise the node goes on
   `candidates[nextInt(len(candidates))]`.

After all plots: sort `features` and `nodes` by `(y, x)`, then check the
fairness constraints; the attempt fails on the first violation (the order does
not matter, as any failure moves to the next attempt):

- per plot, `buildableCells * 100 >= minBuildablePercent * plotWidth * height`;
- every walkable cell is reachable from the front row (flood fill with 4-way
  moves from all walkable front-row cells) - the front row itself is always
  walkable because features keep off it;
- per plot (PP-15), every walkable cell of the plot is reachable from a
  walkable front-row cell of that plot by 4-way moves through cells of that
  plot only (so terrain alone never closes off part of a plot from its own
  front);
- every plot has at least one legal Core position whose footprint lies within
  that plot's columns.

**Retries.** Attempt `a + 1` is tried after attempt `a` fails, up to
`maxAttempts`; the first accepted attempt is the result and its 1-based number is
the `attempts` value recorded in the golden vectors. If all fail, generation
throws an error.

### Core positions

The Core is the building of kind `core`; its footprint `(w, h)` comes from the
building content. A position `(x, y)` is the footprint's lowest-x, lowest-y cell
and the footprint covers `x .. x + w - 1`, `y .. y + h - 1` (no rotation is
considered). Every player has one Core, which must lie wholly in their own
plot (PP-2). `validateCorePosition(map, p, x, y)` (in the code the player comes
before the position) returns the first of these that applies:

1. `out_of_bounds` if `x < 0`, `y < 0`, `x + w > width` or `y + h > height`;
2. `outside_own_plot` if `plotOf(x) != p` or `plotOf(x + w - 1) != p`;
3. `blocked` if any footprint cell is not buildable;
4. `on_node` if any footprint cell holds a resource node;
5. `too_far_forward` if `y + h > height - coreFrontClearance` (the starting
   value 8 puts the whole footprint in the back half of a 16-row board).

Otherwise it is ok. `listLegalCorePositions(map, p)` returns every ok position
of plot `p`, sorted by `(y, x)`; map generation guarantees at least one per
plot. A footprint spanning two plots is therefore never legal.

### ASCII rendering

`renderMapAscii` prints rows from `y = height - 1` (front, so the enemy side is
at the top) down to `y = 0`, one character per cell: `.` open, `~` lake, `#`
cliff, `?` any other feature, and for a node the letter at the resource's
position in the resource list (`a` for the first, `b`, `c`, ...). The last line
is a legend.

### Golden kind `map-gen`

Input `{ "seed": u32, "partySize": 1..4 }`, generated with the repository's real
content and `content/mapgen.json`. Result `{ "map": <map>, "hash": <8 hex
digits, hash of the map>, "attempts": <number> }`. Vectors: `golden/map-gen.json`.

## Team state and placement

Implemented in `packages/core/src/team-state.ts` (golden kind `team-state-ops`:
`team-state-ops.ts`). The party's whole state for combat is one board (CP-6,
CB-32). All operations are pure: each returns a new state or a rejection and
never changes its input.

### Format (plain JSON, `schemas/team-state.schema.json`)

```
{ map, cores, buildings, stash, nextId, nextConduitId, conduits, modifiers?, addedNodes?, specialists? }
```

- `map`: the map format above.
- `cores`: a list of exactly `partySize` entries, entry `p` being player `p`'s
  Core as `{ x, y }`, the footprint's lowest-x, lowest-y cell, or `null` before
  it is placed (PP-2). A Core is **not** an entry in `buildings` or `stash`;
  its definition is the content building of kind `core` (found by kind) and it
  can never be moved, returned or sold: no instance ID addresses it; it is
  addressed by its player index. `placeCore` is the only operation that
  touches `cores`, and works once per player. All Cores of a side have the same
  maximum health (see the battle sections).
- `buildings`: placed buildings `{ id, def, tier, x, y, rotation, owner,
  resource? }`.
  `id` is a unique positive integer instance ID, `def` a building definition
  ID, `tier` 1 to 3, `rotation` 0, 90, 180 or 270, `owner` a 0-based player
  index below `map.partySize`. `(x, y)` is the lowest-x, lowest-y cell of the
  footprint **after rotation**. `resource` (optional, issue #473) is the
  **resource setting** of a building whose definition has one ("The resource
  setting" below): the ID of a base resource. It is present exactly on a
  placed building of such a definition and absent on every other, so a state
  without such a building serialises and hashes as before and **no format
  number is raised** (CONTRIBUTING, "Versions and saved formats"). A stash
  entry has no `resource`: the setting is chosen when the building is placed
  and lost when it goes back to the stash.
- `stash`: owned buildings off the board `{ id, def, tier, owner }`.
- `nextId`: the next instance ID to assign. IDs start at 1, are taken from
  `nextId` by `addToStash`, and are never reused (not even after
  `removeFromStash`). A building keeps its ID when it moves between `stash`
  and `buildings`.
- `nextConduitId`: one counter per player, a list of exactly `partySize`
  positive integers, each starting at 1: the number `n` of that player's next
  conduit ID (see Conduits, "Conduit IDs"). Conduits no longer use `nextId`.
- `conduits`: conduits `{ id, from, to, cells }`, sorted by `id` (see
  Conduits). Their `id` is in the owner's own ID space, not the building one.

- `modifiers` (optional): run modifiers `{ id, effects }` taken so far; omitted
  when there are none. See "PvE options, rewards, events and run modifiers".
- `addedNodes` (optional, issue #414, RS-4i4): resource nodes added by the Rich
  vein event, `{ x, y, resource, owner, round }`, in the order added (rounds do
  not decrease); omitted, never an empty list, when there are none, so a state
  without added nodes serialises and hashes as before and **no format number is
  raised** (old states and snapshots stay readable; see CONTRIBUTING). The
  generated nodes stay in `map.nodes`; the map is never changed, so a ghost's
  map still equals `generateMap(mapSeed, partySize)`.

  **`allNodes(team)`** is the one merge of the two: `map.nodes` followed by the
  added nodes (as `{ x, y, resource }`) in the order added; it is
  `map.nodes` itself when none was added. `queryTeamMap(team, terrain)` is
  `queryMap` with them (`nodeAt` sees both). Everything that reads nodes
  (placement `source_needs_node` and `node_reserved`, `occupancy`'s
  `sourceResource`, the conduit and flow views, the bot, the web board, hover
  info and tutorial checks) goes through one of the two; `map.nodes` is read
  directly only by map generation, the map loader and the golden `map-gen`.

  **Rules for an added node** (`addNode(state, content, mapgen, { owner, x, y,
  resource, round })`; the first failure is reported): `invalid_owner` (not a
  player index), `unknown_resource` (not a base resource), `invalid_round` (not
  an integer of at least 1), then the cell: `out_of_bounds`,
  `outside_own_plot` (`x` not in the owner's columns), `front_row` (`y >
  height - 1 - frontMargin`; so the plot's front `frontMargin` rows are out),
  `blocked_by_feature` (a feature that blocks building), `node_here` (a
  generated or an added node is on the cell), `overlaps_core` (a Core cell),
  then `overlaps_building` (a placed building), `overlaps_conduit` (a conduit
  cell), and `plot_full` (the owner already has `maxAddedNodesPerPlot` added
  nodes). `addableNodeCells(state, content, mapgen, owner)` lists the cells for
  which every cell rule holds, in `(y, x)` order, and is empty at the cap. A
  node on a buildable cell, so a source can be built on it exactly as on a
  generated one; any other building on it is `node_reserved`.

  **validateTeamState** parses `addedNodes` hostilely (non-empty list of exact
  `{ x, y, resource, owner, round }` objects, integers except `resource`) and
  re-checks every entry: owner in range, a base resource, `round >= 1` and not
  below the previous entry's, the cell rules above that do not depend on
  buildings (bounds, plot, front row, feature, a generated node or an earlier
  added node on the cell, the Core), and at most `maxAddedNodesPerPlot` per
  owner. Buildings and conduits are then checked against the map with the added
  nodes, so a building that needs a node (a source) may stand on one and a
  building that must not (anything else) may not. A conduit may cross an added
  node as it may a generated one.

- `specialists` (optional, issue #470, RS-13, CP-31): each player's specialist,
  a list of exactly `partySize` entries, entry `p` being player `p`'s
  specialist ID (`spec_...`, one of `content/specialists.json`) or `null`
  while `p` has not picked. It is **omitted** (never a list of nulls) while
  nobody has picked, and in a state made before specialists existed, so such a
  state serialises and hashes as before and **no format number is raised**
  (old saves and snapshots stay readable and play as they did; see
  CONTRIBUTING). `setSpecialist(state, content, player, id)` is the only
  operation that touches it: it fails with `invalid_owner` (not a player index)
  or `unknown_specialist` (not in the roster; checked when the content has one),
  otherwise sets entry `player` (a player can change it as often as they like;
  `null` clears it) and omits the list again when every entry is `null`.
  `specialistOf(state, p)` is entry `p`, or `null` when the field is absent.
  It has no effect on a battle or a shop yet (later steps of issue #468).
  Duplicates are allowed: all entries may be equal (RS-13a).

Buildings of kind `core` never appear in `buildings` or `stash`.

**Canonical order.** `buildings` and `stash` are each sorted by ascending
`id`, so one state always serialises identically (and hashes identically).
`createTeamState(map)` gives an empty state with `nextId` 1 and every
`nextConduitId` entry 1.

### Rotation, footprint cells and sides

Board directions: **north** is toward increasing `y` (toward the front row, the
enemy side, drawn at the top of the ASCII rendering); **east** is toward
increasing `x`; south is decreasing `y`; west is decreasing `x`. Rotation is
clockwise as drawn with the front row on top: north to east to south to west.

- Sides: a side at rotation 0 becomes, at rotation `r`, the side `r / 90`
  clockwise steps on: at 90, north to east, east to south, south to west, west
  to north; at 180 each side to its opposite; at 270 north to west, west to
  south, south to east, east to north. Input and output lists keep their
  order (`rotateBuilding`).
- Footprint: a definition's footprint `(w, h)` is its size at rotation 0
  (`w` along x, `h` along y). At 90 and 270 it is `(h, w)`. The rotated box is
  always anchored at its lowest-x, lowest-y cell; rotating in place keeps
  `(x, y)` and so can change which cells are covered. A footprint without a
  cell mask is a full rectangle: a building at `(x, y)` covers every cell
  `(x + i, y + j)` with `0 <= i < w'` and `0 <= j < h'` (the rotated size).
  A footprint **with a cell mask** (the wall shapes, below) covers only the
  mask's cells; the box is still the bounds check.
- **Footprint cell masks (issue #291).** A footprint may carry `cells`, a list
  of `[x, y]` pairs at rotation 0 inside the `w` x `h` box (`x` along x, `y`
  along y, `y` growing north as everywhere on the board; a shape written north
  on top is therefore listed with its top row at the highest `y`). The loader
  (`loadBuildings`, error text `... footprint: ...`) rejects a mask that is
  empty or not a list of integer pairs, has a cell outside the box or a
  duplicate, does not use every row and every column of the box (the box must
  be the mask's bounding box), or is not 4-connected. Loaded masks are sorted
  by `(y, x)`. Without `cells` the footprint is the full box.
  `rotateBuilding(def, r).footprint` rotates the mask with the box: clockwise
  as drawn with north on top, a mask cell `(x, y)` of a `w` x `h` box becomes
  at 90 `(y, w - 1 - x)`, at 180 `(w - 1 - x, h - 1 - y)`, at 270
  `(h - 1 - y, x)`, in a box of the rotated size, which keeps the mask
  normalised to the rotated box's lowest-x, lowest-y corner (every row and
  column is still used). A building at `(x, y)` covers `(x + cx, y + cy)` for
  each rotated mask cell; `cellsOf` lists them in `(y, x)` order. Every rule
  that talks about a building's cells (overlap with buildings, Cores,
  conduits and nodes, plot and terrain checks, occupancy, sealed producers,
  the arena's solid cells and the enemy-path preview) uses these cells, never
  the bounding box. The bounds check (`out_of_bounds`) uses the rotated box.
  A conduit's edge geometry (`box`) is the rotated box and only matters to
  buildings with sides; the masked buildings have none.
- A Core is never rotated: Core `p` covers `cores[p].x .. cores[p].x + w - 1`
  by `cores[p].y .. cores[p].y + h - 1`.
- `cellsOf` lists a building's cells in `(y, x)` order. `absoluteSides` gives
  its input sides (with resources) and output sides at its rotation.
  `sourceResource` is the resource of the node under a source. `buildingAt`
  returns the placed building, `{ core: p }` for a cell of player `p`'s Core,
  or `null`.

### Operations

Each returns `{ ok: true, state }` (`addToStash` also the new `id`) or
`{ ok: false, reason, detail? }`. All are free (no gold).

- `addToStash(def, tier, owner)`: reasons `unknown_definition`,
  `core_not_allowed` (the definition is of kind `core`), `invalid_tier` (not an
  integer 1 to 3), `invalid_owner` (not an integer from 0 to `partySize - 1`),
  checked in that order. Appends `{ id: nextId, def, tier, owner }` and
  increments `nextId`.
- `placeCore(actor, x, y)`: reasons in order: `invalid_owner` (`actor` is not
  an integer from 0 to `partySize - 1`; the specification leaves this case
  open and it uses the same reason as `addToStash`); `core_already_placed` if
  `cores[actor]` is not `null`; then those of `validateCorePosition(map,
  actor, x, y)` (`out_of_bounds`, `outside_own_plot`, `blocked`, `on_node`,
  `too_far_forward`); then `overlaps_building` if the footprint covers a placed
  building; then `overlaps_conduit` if it covers a conduit cell. It works once
  per player; nothing can move or remove a Core. `overlaps_core` in
  `placeFromStash`, `moveBuilding` and `addConduit` means the footprint of any
  placed Core. `validateTeamState` requires every placed Core to be legal for
  its player, and `renderTeamStateAscii` draws every Core as `C`.
- `placeFromStash({ actor, id, x, y, rotation, resource? })`: `id` must be in
  `stash`. Moves the entry to `buildings` (same ID, tier, owner). `resource`
  (issue #473) is the resource setting: for a building whose definition has the
  setting it is a base resource ID, or left out for **the first base resource
  of `resources.json`** (Ore); for any other building it must be left out. Any
  other value is `invalid_resource` ("The resource setting").
- `moveBuilding({ actor, id, x, y, rotation })`: `id` must be in `buildings`. Sets
  position and rotation in one step; moving to the same position with a new
  rotation is a rotate in place. The building's own current cells never count
  as overlap.
- `setBuildingResource({ actor, id, resource })` (issue #473): changes the
  resource setting of a placed building ("The resource setting").
- `returnToStash({ actor, id })`: `id` must be in `buildings`; the entry goes back
  to `stash` (sorted by ID); a resource setting is dropped with it. Rejects with `unknown_building`, `invalid_owner`
  or `not_owner`; for a Tunnel end also `would_loop` and `resource_mismatch`
  (below, "Tunnels").
- `addItemToStash(def, tier, owner)` (CB-9g): one **shop item**. It is
  `addToStash` of `def`, and, when `def` is a Tunnel entrance, of its `partner`
  (the exit) as well, at the same tier and owner, as a second entry with the next
  ID: the entrance's entry comes first. It fails as `addToStash` does and then
  adds nothing. The shop's buy, the starting kit and the caravan use it; the
  `team-state-ops` op `addToStash` stays one building, so a script names the two
  ends one by one.
- `removeFromStash({ actor, id })`: `id` must be in `stash`; the entry is deleted
  (selling and refunds come later). Rejects with `unknown_building`,
  `invalid_owner` or `not_owner`.

Every operation names its `actor`, the player index of the player performing
it (PP-1). **Only the owner acts on a building**: an `actor` that is not the
building's `owner` gets `not_owner`; an `actor` that is not an integer from 0
to `partySize - 1` gets `invalid_owner`. **A building's cells lie in its
owner's plot**: every cell of the rotated footprint has `plotOf(x) = owner`.
With one player, plot 0 is the whole board and neither rule can reject.

**Rule order for `placeFromStash` and `moveBuilding`.** The first failing rule
in this order is the reported reason:

1. `unknown_building`: no such instance ID where expected (stash for place,
   buildings for move).
2. `invalid_owner` (`actor` is not a player index), then `not_owner` (`actor`
   is not the building's `owner`). (A malformed `actor` is told apart from a
   wrong one.)
2a. `placeFromStash` only (issue #473): `invalid_resource` (`resource` is not a
   base resource, or is given for a building whose definition has no setting).
3. `invalid_rotation`: not 0, 90, 180 or 270.
4. `out_of_bounds`: a non-integer position, or any cell of the rotated
   footprint outside `0 <= x < width`, `0 <= y < height`.
5. `outside_own_plot`: a footprint cell has `plotOf(x) != owner`.
6. `blocked_by_feature`: a cell holds a feature whose `blocksBuilding` is true.
7. `overlaps_core`: a cell is in the footprint of any placed Core.
8. `overlaps_building`: a cell is covered by another placed building.
9. `overlaps_conduit`: a cell holds a conduit cell. For `moveBuilding`, conduits
   attached to the moving building do not count (they are removed when the
   move succeeds); conduits of other buildings do.
10. Node rules (none of them applies to a **collector** with the resource
    setting, which stands on any open cell of its owner's plot, node or not,
    and takes nothing from a node: "The resource setting"; a Transmuter is a
    refinery, so `node_reserved` applies to it as to any building that is not a
    source):
   - `source_needs_node`: a building of kind `source` must have every
     footprint cell on a resource node, all of the same resource (a
     placeholder source is 1x1). It produces that resource.
   - `node_reserved`: a building that is not a source may not cover any node
     cell. A resource node cell is otherwise buildable, so this keeps nodes
     for sources.
11. Tunnel ends only (CB-9g, "Tunnels"): once the placement is otherwise legal,
    the network of the state after the operation (with the conduits of a moving
    building detached) is checked as `addConduit` checks one: `resource_mismatch`,
    else `would_loop`. Placing or moving an end can bring a pair into being, and a
    pair is a conduit segment.

A rejected operation changes nothing. Placement does not require the Core to
be placed first. A building goes only in its owner's plot (PP-1).

### Conduits attached to a moved building

Moving, rotating or returning a building **removes every conduit attached to
it** (every conduit whose `from.building` or `to.building` is that building),
and no others. `detachConduits(state, buildingId)` in `team-state.ts` does it
(it returns the same state object when nothing is attached); `moveBuilding` and
`returnToStash` call it after the building has been updated, and only when the
operation is accepted. A rejected operation detaches nothing. The only other operations that remove
conduits are `eraseConduit` and a **change of a resource setting** to a
different resource (`setBuildingResource`, issue #473), which detaches every
conduit attached to that building in the same way, because they carried the old
resource.

### Whole-state validation

`validateTeamState(data, content, mapgenConfig)` takes any value and returns
`{ ok: true, state }` or `{ ok: false, errors }` (readable strings). It never
throws, and re-checks everything without trusting how the state was built (it
will vet other players' snapshots, MM-17): the shape and no unknown fields; the
map with `loadMap`; the Core position with `validateCorePosition` when placed;
every entry's `id` (positive integer), `def` (known, never kind `core`), `tier`
(1 to 3), `owner` (in range) and, for placed buildings, integer `x`, `y` and a
legal `rotation`; IDs unique across `buildings` and `stash`; both lists sorted
by ascending `id`; `nextId` greater than every building and stash ID; and every
placement rule above for every building (each against the Core and all other
placed buildings); then every conduit (shape, unique ID among conduits, each ID decoding to
the conduit's `owner`, canonical order, `nextConduitId` a list of `partySize`
positive integers each above the largest number `n` of that owner's conduits, each conduit's geometry rules against all the other
conduits, no two conduits on one side, no loop, no resource mismatch; see
Conduits), counting the Tunnel pairs derived from the placement as conduit
segments and re-checking them (see "Tunnels"). `specialists` is parsed
hostilely: absent, or a list of exactly `partySize` entries, each `null` or a
string matching `spec_[a-z0-9_]+` that is in the roster (`content.specialists`,
when the content has one), and not all `null`. A placed building's `resource`
(issue #473) is checked against its definition: a definition with the resource
setting needs a `resource` that is a base resource (a refined resource, an
unknown ID and a value that is not a string are errors), and any other
definition must not have one; a stash entry may not have the field (an unknown
key). The conduits are then checked with the setting as the source's resource.
It does not check that the map is one the generator could produce.

### ASCII rendering

`renderTeamStateAscii` prints the map rendering (front row on top) with
buildings drawn over it, one character per covered cell: `S` source, `R`
route, `U` unit producer, `D` defense, `E` economy, `C` Core, and `*` for each
conduit path cell. The last line is the map legend followed by the building
legend (`... C=core *=conduit`).

### Golden kind `team-state-ops`

Input `{ "seed": u32, "partySize": 1..4, "ops": [...] }`. The map is the
`map-gen` map for that seed and party size, the state starts as
`createTeamState(map)`, and the ops run in order. An op is an object with an
`op` field and its arguments: `addToStash` (`def`, `tier`, `owner`),
`placeCore` (`actor`, `x`, `y`), `placeFromStash` (`actor`,
`id`, `x`, `y`, `rotation`, and optionally `resource`; issue #473) and
`moveBuilding` (the same without `resource`), `setBuildingResource` (`actor`,
`id`, `resource`; issue #473), `returnToStash` and `removeFromStash` (`actor`,
`id`), `addNode` (`owner`, `x`, `y`, `resource`, `round`; Rich vein, issue
#414), `addConduit` (`actor`, `from` and `to`, each `{ building, side }`, and
`cells`, a list of `{ x, y }`), `eraseConduit` (`actor`, `id`) and
`setSpecialist` (`actor`, `specialist`: an ID or `null`; issue #470). Once the
state holds a Tunnel end (issue #442, CB-9g) every entry of `results` also has
`tunnels`: the pairs `[entrance, exit, distance]` of the state after that op, in
entrance order (nothing is added before the first end, so older vectors are
unchanged). A rejected op leaves
the state as it was and the run continues. Result `{ "results": [...],
"state": <final state>, "hash": <hash of the final state> }`, with one entry
per op: `{ "op", "ok": true }` (plus `"id"` for `addToStash` and `addConduit`) or `{ "op",
"ok": false, "reason" }`. Vectors: `golden/team-state-ops.json`.

## Conduits

Implemented in `packages/core/src/conduits.ts` (golden kinds `team-state-ops`
and `flow-graph`: `team-state-ops.ts`). Conduits carry resources between
buildings (CB-3g, CB-3h). They are free, unlimited, take up space, and can never
cross or share a cell; the only way for two flows to cross is through a
crossover building. All functions are pure.

### Model

A conduit is `{ id, owner, from: { building, side }, to: { building, side },
cells }` (`schemas/team-state.schema.json`):

- `owner`: the player who drew it, the `actor` of the `addConduit` that made it
  (PP-1). An ordinary conduit joins two buildings of its owner; a border half
  (PP-4) has one building end, of its owner. Every path cell lies in its
  owner's plot. Only the owner erases it.
- `id`: a unique positive integer in the owner's own ID space (below, "Conduit
  IDs"); it may equal a building ID. `addConduit` assigns it from the owner's
  counter `nextConduitId[owner]` and increments that counter.
- `from.building`, `to.building`: instance IDs of **placed** buildings (never
  the Core, which has no ID).
- `side`: an absolute side (`north`, `east`, `south`, `west`) of that building
  at its current rotation.
- `cells`: the ordered path of `{ x, y }` from the cell just outside the `from`
  side to the cell just outside the `to` side; empty for a direct connection.

`conduits` is kept sorted by ascending `id` (new conduits get the largest ID, so
appending keeps it sorted).

### Sides, edges and directions

A building's **side** is the set of cell edges on that side of its rotated
footprint: one edge on a side of a 1x1 building, two on a side of a 2x2. The
cell **directly outside** an edge is the cell next to it, across the edge. For
a building whose rotated footprint covers `x0 .. x0 + w - 1` by
`y0 .. y0 + h - 1`, the cells outside its sides are, in increasing coordinate
order: north `(x0 + i, y0 + h)`, south `(x0 + i, y0 - 1)` for `i < w`; east
`(x0 + w, y0 + j)`, west `(x0 - 1, y0 + j)` for `j < h`. A conduit attaches at
one specific edge: its first cell is outside one edge of the `from` side and its
last cell is outside one edge of the `to` side (they may be different edges of
a 2x2 side; the same cell for a one-cell path). Each output side holds at most
one conduit and each input side at most one, however many edges it has.

**Input and output sides.** A building's input and output sides are those of
its definition rotated by its rotation (`absoluteSides`). Sources have outputs
only; route buildings have both; unit producers, turrets and economy buildings
have inputs only; walls, gates and the Core have neither. Content guarantees
that a side is never both an input and an output. A **splitter** has one input
and two or three outputs, a **merger** two or three inputs and one output, a
**crossover** two inputs and two outputs, each input's opposite side being its
output (a straight-through path).

**Direct connection.** The `from` side of building A *directly faces* the `to`
side of building B when `to.side` is the opposite of `from.side` and the cell
outside at least one edge of A's `from` side is a cell of B. Then (and only
then) the conduit is a direct connection: `cells` must be empty, and a non-empty
`cells` is `invalid_path`. When the sides do not directly face, `cells` must be
non-empty (an empty list is `invalid_path`). So two facing sides are always
joined directly. If A's `from` side touches B but the conduit names a `to` side
of B that is not the opposite side, it does not count as facing: the path then
has to start inside B and fails `overlaps_building`.

**Path.** For a non-empty path: every cell is an in-bounds integer cell; each
consecutive pair is 4-directionally adjacent; no cell appears twice; the first
cell is outside an edge of the `from` side and the last outside an edge of the
`to` side. Any violation is `invalid_path`.

### `addConduit` rules and their order

`addConduit(state, content, { actor, from, to, cells, id? })` returns `{ ok: true, state, id }`
or `{ ok: false, reason, detail? }`. The rules are checked in this fixed order
and the first failing rule is the reported reason:

0. `invalid_conduit_id`: only when an explicit `id` is given (undo re-adds a
   conduit under the ID it had). It must decode to `actor`, with a number `n`
   of at least 1 and below `nextConduitId[actor]`, and no conduit may have it.
   The counter is left unchanged.
1. `unknown_building`: either end is not a placed building (an unknown ID, a
   stashed building, or the Core).
2. `not_owner`: an end building is not owned by `actor` (`from` checked before
   `to`; an `actor` that is no player owns nothing, so it gets this reason too).
3. `not_an_output`: `from.side` is not one of the building's output sides at its
   rotation (this includes buildings with no outputs and any value that is not a
   side name). Then `not_an_input` likewise for `to.side`. `from` is checked
   before `to`.
4. `side_in_use`: that output side, or that input side, already has a conduit
   (output first).
5. `invalid_path`: see Path and Direct connection above.
6. `outside_own_plot`: a path cell has `plotOf(x) != actor`.
7. `blocked_by_feature`: a path cell holds a feature with `blocksBuilding`.
8. `overlaps_core`: a path cell is in the footprint of any placed Core.
9. `overlaps_building`: a path cell is covered by a placed building.
10. `crosses_conduit`: a path cell is used by another conduit (CB-3g: conduits
    never share or cross a cell).
11. `resource_mismatch`: see Resource typing.
12. `would_loop`: see Loops.

A conduit may run over a resource node cell (it blocks that node while it is
there, since `placeFromStash` and `moveBuilding` reject `overlaps_conduit`;
conduits are free to erase). A rejected operation changes nothing.

**Conduit IDs.** Every player has their own conduit ID space, so one player's
adds, erases and undos can never touch another player's IDs. The ID of a
player's `n`th conduit (`n` from 1) is `n * 4 + owner`, where 4 is the
largest party size (`maxPartySize` in `mapgen.json`; the constant is
`MAX_PARTY_SIZE` in `conduit-ids.ts`, with a test that it covers the content).
A solo player's conduits are 4, 8, 12, ... Buildings and stash entries keep
the shared `nextId`.

Other operations: `eraseConduit(state, { actor, id, reclaimId? })` removes one
conduit (reasons, in order: `unknown_conduit`, `invalid_owner`, `not_owner`;
only the conduit's owner erases it); an erased ID is not handed out again,
except with `reclaimId` (undo of an add): if the conduit's number is one below
its owner's counter, that counter goes back by one, otherwise the counters are
left alone. `detachConduits` is described under
Team state and placement. Placement and moving respect conduits:
`placeFromStash`, `moveBuilding` and `placeCore` reject `overlaps_conduit` when
a footprint cell is a conduit cell (rule 7 there; for `placeCore` after
`overlaps_building`).

### Resource typing (CB-5b)

Each conduit carries at most one resource type, set by what feeds it.
`conduitResource(state, content, conduitId)` returns a resource ID or `null`
(undetermined, also for an unknown ID):

- A conduit leaving a **source** carries the source's resource
  (`sourceResource`): its node's resource, or, for a source with the resource
  setting (issue #473), its setting (whatever node it may stand on).
- A conduit leaving a **refinery** (CB-5d) carries the refinery's `output`
  resource, a refined resource, whatever its inputs carry (even when none of
  them is connected).
- A conduit leaving a **splitter** carries what the splitter's input conduit
  carries, or `null` when the splitter has no input conduit or that conduit is
  itself undetermined.
- A conduit leaving a **merger** carries what its input conduits carry: the
  first determined resource in the order north, east, south, west of the input
  sides. In a valid state all determined inputs agree, so the order never
  matters.
- A conduit leaving a **crossover** carries what its channel's input conduit
  carries; the two channels never mix (a crossover with only one input
  connected has one determined and one undetermined output).
- A conduit cannot depend on itself: if it somehow did (an invalid, looping
  state), it is `null`.

**When the source is not yet connected.** A conduit drawn downstream of an
unfed splitter, merger or crossover channel is `null` and is always accepted:
`null` never causes a rejection. The type is inferred later, when an upstream
conduit is added; `conduitResource` always reflects the network as it is now.

**The check.** After tentatively adding the conduit, the whole network is
recomputed (connecting an upstream piece can determine types far downstream),
and the addition is rejected with `resource_mismatch` if any consumer input
receives a determined resource different from the one its definition names for
that side, or any merger has two inputs with different determined resources.
Consumers are all buildings with inputs except route buildings (a refinery is
one: a refined conduit is refused at the input of another refinery or of any
building that takes another resource, Composite into an Aether refinery
included; Composite and Aether never mix in a merger).

Because sources take their resource from their node (or from their setting),
moving a source to a different node, or changing a setting, could change types;
this is fine because moving and changing a setting detach the source's conduits
first.

### Loops (CB-9c)

Conduit networks cannot loop. The graph used has one node per placed building
and one per **channel** of a crossover (a channel is an input side with the
opposite output side), and an edge `from -> to` per conduit. `addConduit` is
rejected with `would_loop` if that directed graph would contain a cycle
(including a building feeding itself). Two unrelated flows crossing through a
crossover are two nodes and not a loop; a flow that reaches the same crossover
channel twice is. The check is a topological sort (Kahn).

### Tunnels (CB-9g)

Implemented in `packages/core/src/tunnels.ts` (the pairing) and used by
`conduits.ts`, `flow-sim.ts`, `team-state.ts` and `arena-sim.ts`. A Tunnel is two
1x1 route buildings bought as one item: an **entrance** (`tunnel_in`: one input
side, no output side) and an **exit** (`tunnel_out`: one output side, no input
side). Each side is on the back of its building (rotation 0: the entrance's input
is on its south side, the exit's output on its north side). Neither stores a
resource and neither consumes any.

**The facing direction.** The entrance *faces* the side opposite its input side
(rotation 0: north; the conduit travels that way). The exit's *front* is the side
opposite its output side. With cells numbered north = +y, east = +x:
`step(north) = (0, +1)`, `step(east) = (+1, 0)`, `step(south) = (0, -1)`,
`step(west) = (-1, 0)`.

**Pairing is derived, never stored.** `pairTunnelEnds` (`tunnels.ts`) takes the
ends in building ID order and returns the pairs sorted by entrance ID:

1. For every entrance `E` of owner `o` whose own column is in plot `o`, look at
   the cells `E + d * step(facing)` for `d = 1, 2, ..., maxSpanCells + 1` (`d` is
   the distance; `d - 1` the cells between the two ends, at most `maxSpanCells`,
   the entrance's content number, 5). The first such cell that holds an exit of
   owner `o` whose column is also in plot `o` is the exit `E` wants, at distance
   `d`; an exit of another owner or in another plot is skipped and the search goes
   on. Nothing between the cells matters: buildings, conduits and terrain may
   stand there.
2. An exit wanted by several entrances goes to the one with the smallest distance;
   on a tie (two entrances facing each other's side of the exit) the smaller
   building ID. The other entrances stay **unpaired**: they do not look further.
   An end in no pair is unpaired and does nothing.
3. The exit's own rotation takes no part: its output may be on any side.

Both ends in the owner's plot makes every cell between them the owner's too (a
plot is a run of columns), so a pair never crosses a plot border, and a pair is
not a border link (PP-4). The pair is recomputed from the placement every time
(`makeView` in `conduits.ts`), so moving, rotating, placing or removing either
end can re-pair or unpair them.

**The pair is a conduit segment.** In the joined network (`edgesWith`) each pair
adds one edge, after every conduit and in entrance ID order, with id
`-entrance` (negative: no conduit ID is), `length` = the distance `d`, from the
entrance's node out of its facing side to the exit's node into its front. Items
therefore need exactly `d` ticks from the entrance to the exit (the same one cell
per tick as a conduit), one tick more than a conduit of the `d - 1` cells
between the two ends would take, so a tunnel is never faster than a conduit. A
Tunnel end adds no tick of its own (it is a route node with one output).

- **Resource typing (CB-5b).** The edge carries what the entrance's input
  conduit carries; a conduit leaving the exit carries what the pair carries
  (the same rule as a crossover channel). An unfed entrance gives `null`, as any
  route.
- **Loops (CB-9c).** The pair is an edge from the entrance's node to the exit's:
  a loop through a pair is a loop. `buildFlowGraph` throws on one, so no
  operation may leave one: `addConduit` already refuses the conduit that closes
  it, and `placeFromStash`, `moveBuilding` and `returnToStash` of a Tunnel end
  refuse the operation (`would_loop`, or `resource_mismatch`) when the pairs of
  the new placement, with the conduits that operation detaches, would leave a
  loop or a mismatch (`networkProblem`: mismatch first, then loop). Picking up a
  nearer exit can bring a farther one into the pair, which is why `returnToStash`
  checks too.
- **Conduit rules are unchanged.** `addConduit` treats the ends as ordinary route
  sides (`not_an_output`, `not_an_input`, `side_in_use`, `invalid_path`, ...): a
  conduit goes into the entrance's input side and out of the exit's output side.
  The two virtual sides of a pair (the entrance's facing side, the exit's front)
  are in no definition, so no conduit can use them.
- **Validation.** `validateTeamState` (and so ghost validation, MM-17) accepts
  pairs, applies the placement rules to each end (an end outside its owner's plot
  is `outside_own_plot`), and re-checks the derived pairing: every pair joins one
  owner's ends, both in that owner's plot, no entrance is in two pairs and no
  exit is claimed twice. The last two cannot happen with the derivation above
  (the nearest entrance simply wins), so they are a safety check.

**In a battle.** The arena keeps the pairs it started with (`ctx.tunnels`, one
list per side, from `tunnelPairs` of the starting teams) and passes the list to
`rebuildFlow`. When a building is destroyed (step 6) every pair with that
building as an end leaves the list for good: the flow plan is rebuilt without the
pair, the entries of the pair edge (`sim.conduits` with a negative id) are gone,
and its items are lost by the rule for a destroyed conduit ("Mid-battle
removal": `retired.lost`). The end that is left stands, unpaired, and no other end
ever pairs in its place in that battle, even if it would by the derivation (an
unmasked farther exit). The conduits attached to the destroyed end go as for any
building (CB-9a); the surviving end's own conduit stays and an unpaired entrance
loses what reaches it. No event is logged for the pair itself.

Notes for a port: `pairs = derive(placement)` once per team state; the pair edge
is a conduit of `d` slots with id `-entrance` placed after all the conduits;
tunnel nodes are route nodes with one output and (the exit) no conduit input; a
battle freezes the pair list and only ever removes pairs from it.

### Flow graph (input to W1-4)

`buildFlowGraph(state, content)` returns plain JSON-safe data (it throws on a
state with a loop or an unknown definition; validate untrusted states first):

```
{ nodes: FlowNode[], edges: FlowEdge[], order: string[] }
```

- `nodes`: one per placed building that has at least one conduit attached; a
  crossover becomes **two** nodes (both channels, whenever it has any conduit),
  one per input side. Sorted by building ID, then channel (north, east, south,
  west). A node is
  `{ key, building, channel, def, kind, produces, inputs, outputs }`:
  - `key`: the instance ID as a decimal string, or `"<id>.<input side>"` for a
    crossover channel (for example `"7.south"`).
  - `channel`: the channel's input side for a crossover node, else `null`.
  - `kind`: `source`, `splitter`, `merger`, `crossover`, `tunnel_in`,
    `tunnel_out`, `refinery` or `consumer`. A Tunnel end is a node whenever it
    has a conduit attached **or** is paired. An entrance has its input (the real
    input side) and one output on the side it faces; an exit has one input on its
    front side (opposite its output) and its real output. The pair is attached to
    those sides (`conduit` = the pair's negative id), and is `null` while the end
    is unpaired (so an unpaired entrance has an output with no conduit, which
    loses its items).
  - `produces`: a source's node resource, else `null`.
  - `inputs`: `{ side, conduit, requires }` per input side, `conduit` the ID of
    the conduit attached there or `null`, `requires` the resource that input
    needs (consumers; `null` for routes and crossover channels).
  - `outputs`: `{ side, conduit }` per output side, `conduit` as above.
  - **Order of `inputs` and `outputs`**: clockwise starting from north, in the
    building's current rotation (absolute sides): north, east, south, west,
    keeping only the sides the building has. This is the order in which a
    splitter alternates between its outputs; an output with `conduit: null` is
    skipped by the simulation. A crossover channel has one input and the
    opposite output.
- `edges`: one per conduit, sorted by conduit ID, then one per Tunnel pair in
  entrance ID order (`conduitId` = minus the entrance's building ID, `fromSide`
  the entrance's facing side, `toSide` the exit's front, `length` the distance):
  `{ conduitId, from, to, fromSide, toSide, length, resource }`; `from` and `to`
  are node keys, `length` is the number of path cells (0 for a direct
  connection) and `resource` is the determined resource or `null`.
- `order`: the node keys in topological order (every edge goes from an earlier
  to a later node), which exists because there are no loops. Ties are broken by
  the node sort order above (building ID, then channel): among the nodes with no
  unprocessed predecessor the first in that order goes next.

### Golden kind `flow-graph`

Input as for `team-state-ops` (`seed`, `partySize`, `ops`). The result is
`{ "graph": <flow graph of the final state>, "hash": <hash of the graph> }`.
Vectors: `golden/flow-graph.json`. The conduit rejection reasons, a network with
a splitter, a merger and a crossover, a merger mismatch that only appears when
an upstream source is connected last, and a loop are covered by vectors in
`golden/team-state-ops.json`. The input may also give `extraBuildings` (building
definitions in the format of `content/buildings.json`, added for the run).
Issue #381 adds `flow-graph.refinery-ab-chain` and `flow-graph.refinery-bc-chain`
(collectors, a refinery, a refined conduit and a test consumer of the refined
resource from `extraBuildings`: the refinery node has kind `refinery` and the
output edge carries the refined resource) and
`team-state-ops.refined-conduit-mismatch` (Composite is refused with
`resource_mismatch` at both inputs of an Aether refinery and at a Barracks, and
a Flux collector then feeds the Aether refinery). Issue #442 adds
`flow-graph.tunnel-under-walls` (a Tunnel pair of distance 4 between a collector
and a Barracks with walls on the cells between: `tunnel_in` and `tunnel_out`
nodes and the pair as the edge `-entrance` of length 4) and
`flow-graph.tunnel-unpaired` (an entrance with no exit), and in
`team-state-ops.json` `tunnel-pairing`, `tunnel-nearest-wins`,
`tunnel-repair-on-move`, `tunnel-loop-refusals` and `tunnel-mismatch-refusal`.

## Tick order

**Status (#124).** This section describes the code on `main`. The rules
below are specified in "Appendix: the per-player design (issue #124)" and
changed this section; all of them are implemented.

| Rule | Change to this section | Status |
| ---- | ---------------------- | ------ |
| PP-7 | With PP-4 an output whose half is open is a connected output that never accepts (the item is held and the line backs up; it is not a dead end and nothing is lost). | **implemented** (issue #135) |

Implemented in `packages/core/src/flow-sim.ts` (golden kind `flow-sim`:
`packages/golden/src/kinds/flow-sim.ts`). This is the resource flow of **one board on its own**
(CB-10, CB-11). It is step 1 of the two-board battle tick described under "One
battle tick" below, which adds units, production, combat and destruction.
Economy buildings (in-battle ramp) and Overload are described under "One
battle tick"; the only thing they add to this single-board flow is the optional
**source interval modifier** (step 3 below), one value per player index, 0 in a
dry run. A **refinery** (CB-5d, "Refineries" below) is part of this flow: it
takes, makes and releases items inside `stepFlow` (step 3a), in every consumer
mode.

### Constants (`content/sim.json`)

`ticksPerSecond` (10, fixed battle time per second), `inputBufferUnits` (4,
the capacity of each consumer input buffer), `breachBaseCost` (10) and
`breachHealthPerCost` (10), the last two used by the breach field (see "Goals
and movement fields"), `aggroRangeCells` (3, the centre-to-centre range, in cells, within which a unit
chases an enemy unit; see "One battle tick", step 3a2), `separationPercent` (75, the
percent of an overlap that a pair of overlapping units resolves per tick; 0 to
100) and `separationCap` (40, the most a pair is moved apart per tick, in
sub-cell units; 0 to 480; see step 5), `maxSourceSpeedPercent`
(300) and `maxUnitStrengthPercent` (300), the global caps of the in-battle ramp
(see "In-battle ramp (economy buildings)"), and the Overload constants
`overloadStartTick` (1800, three minutes at 10 ticks a second), `overloadIntervalTicks` (100),
`overloadDamageStepPercent` (20) and `overloadCoreDamageStep` (5) (see
"Overload"), `maxBattleTicks` (12000, the hard cap on a battle, see "Battles")
and `timelineSampleTicks` (50, the sampling interval of the battle summary
timeline). Later issues add fields.

### Items

An item is one unit of one resource type, stored as the resource ID. Items have
no identity. A conduit with `L` path cells (`FlowEdge.length`) has `L` slots,
numbered `0 .. L - 1`, slot 0 nearest the `from` building; each is empty or
holds one item. A direct connection (`L = 0`) has no slots: an item offered to
it goes straight to the `to` building.

### State (plain JSON)

`createBoardSim(teamState, content, simConfig)` builds the state of a validated
team state. Nothing is carried in from outside (CB-11): the state is a function
of the team state and `sim.json` only. Fields, with every list in a fixed order:

- `tick`: ticks completed; starts at 0.
- `bufferCapacity`: `inputBufferUnits`.
- `sources`: one per placed source building (connected or not), by building ID:
  `building`, `resource` (its node's), `countdown` (starts at the tier's
  `intervalTicks`, so the first item appears after one full interval), `stalled`
  (0 or 1, starts 0), `pointer` (starts 0), and the counters `produced`, `lost`,
  `stalledTicks` (start 0).
- `conduits`: one per conduit, by conduit ID: `id` and `slots`, a list of `L`
  entries, each a resource ID or `null` (all `null` at the start). Each Tunnel
  pair adds one more entry after the conduits, in entrance ID order: `id` minus
  the entrance's building ID, `L` = the distance (CB-9g).
- `routes`: one per flow-graph route node (splitter, merger, a Tunnel end, or one
  crossover channel), in flow-node order (building ID, then channel): `key` (the node
  key), `building`, `held` (the one-item holding cell, `null` when empty),
  `pointer` (starts 0) and the counter `lost`.
- `consumers`: one per placed building that has input sides and is not a source
  or route (a refinery included), by building ID: `building` and `inputs`, one
  per input side clockwise from north: `side`, `resource` (what that side
  requires), `count` (the input buffer, starts 0) and the counters `delivered`
  and `consumed`.
- `refineries` (CB-5d): present **only on a board that has a refinery** (so the
  state, and its hash, of every other board is unchanged), one per placed
  refinery (connected or not) in building ID order: `building`, `resource` (its
  output resource), `counters` (one per input resource, sorted by resource ID,
  the order of the tier's `costs`; start 0), `cooldown` (starts 0), `store`
  (items made and not yet released, the output store; starts 0), `stalled` (0
  or 1, starts 0) and the counters `produced`, `lost`, `batches` and
  `stalledTicks` (start 0).

The compiled wiring (which conduit feeds which input, and the processing
orders below) is derived from the team state by the same code and is not part
of the saved state.

### One tick: `stepFlow`

The reference implementation changes the state in place. The step context
chooses the consumer mode, `hold`, `drain` or `need` (see "Dry run"), and may carry an event list that
the step appends to. Let `T` be `tick` at the start of the step; every event of
the step has `tick = T`. In this order:

**0. Merger arbitration.** For **every** merger (whether its holding cell is
empty or full): let `n` be its number of input sides (the order of
`FlowNode.inputs`, clockwise from north, including sides with no conduit).
Look at input indices `pointer, pointer + 1, ...` (mod `n`) and pick the first
that is _ready_, using the state as the tick began (before anything moves).
Input `i` is ready when its conduit exists and

- it has `L >= 1` and its **last slot holds an item**; or
- it is a direct connection (`L = 0`) from a **route building** (a splitter,
  merger or crossover channel) whose **holding cell holds an item**; or
- it is a direct connection from a **source** whose `countdown` is at most 1
  (it produces this tick if it can place the item); or
- it is a direct connection from a **refinery** whose `store` is not 0 (it
  releases an item this tick if it can place it).

That input is the merger's _winner_ for this tick; if no input is ready the
merger has no winner. When several inputs are ready on the same tick, including
two direct sources that both produce this tick, the winner is whichever is
first from the merger's round-robin `pointer` (the one that comes first in the
order `pointer, pointer + 1, ...`), not the one with the lower building ID. This is decided before any item moves, so it does not
depend on the order in which anything is processed. A winner is only a
reservation: if the winner does not (or cannot) deliver, the cell stays empty
for the rest of the tick and the pointer does not move. A direct upstream
splitter counts as ready whenever it holds an item, even if this tick it
prefers another of its outputs; the reservation is then unused for one tick
(the splitter's own pointer has moved on by the next tick, so the two
outputs still alternate).

**1. Deliver and advance, downstream first.** Process the conduits with
`L >= 1` in this order: reverse of the position of the conduit's `from` node in
`FlowGraph.order`, ties (several conduits leaving one node) by conduit ID
ascending. For each:

- a. If the last slot holds an item, offer it to the `to` building (see
  "Accepting"). If accepted, the slot becomes empty.
- b. For slot `i` from `L - 2` down to 0: if slot `i` holds an item and slot
  `i + 1` is empty, move the item to slot `i + 1`.

Because downstream conduits are processed first, a slot freed downstream is
usable by the conduit upstream in the same tick, so a full line moves as one.
An item moves at most one slot per tick.

**2. Route buildings push.** In `FlowGraph.order` (topological), each route
node whose holding cell holds an item tries to push it:

- _Splitter._ Let `n` be its number of outputs (`FlowNode.outputs`, clockwise
  from north, including sides with no conduit). For `k = 0 .. n - 1`, take
  output `o = (pointer + k) mod n`; skip it if it has no conduit; otherwise try
  to push (below). The first output that takes the item wins: the cell is
  emptied and `pointer = (o + 1) mod n`. If no output has room, the item stays
  held and the pointer does not move. If **no** output has a conduit, the item
  is lost.
- _Merger, crossover channel or Tunnel end._ One output. If it has no conduit the
  item is lost; otherwise try to push, and keep the item if it is refused. (An
  entrance's output is its pair, a conduit of `d` slots; an exit's output is the
  conduit leaving it. An unpaired entrance has no output, so it loses what it is
  given.)

_Pushing onto a conduit_ means: if it has slots, put the item in slot 0 if that
slot is empty (otherwise refuse); if it is a direct connection, offer the item
to the `to` building (see "Accepting"). A push in step 2 can fill a cell that a
later route in the order then empties in the same tick, so an item can cross
several directly connected routes in one tick.

_Lost_ (dead end): the item is removed, the route's `lost` counter increases,
and `{tick: T, type: "lost", building, resource}` is recorded, `building` being
the route building (for a crossover, the crossover building).

**3. Sources produce.** In building ID order, for each source:

1. If `countdown > 0`, decrease it by 1. If it is still above 0, the source is
   done for this tick.
2. Otherwise (the item is ready; `countdown` is 0), let `n` be its number of
   output sides (clockwise from north). Try the outputs exactly as a splitter
   does (preferred `pointer`, then the following ones, skipping outputs with no
   conduit; on success `pointer = (o + 1) mod n`), pushing onto the conduit as
   in step 2.
3. If the item was placed: `produced` increases,
   `{tick: T, type: "produced", building, resource}` is recorded,
   `countdown = scaledInterval`, `stalled = 0`, where `scaledInterval =
max(1, floor(intervalTicks * 100 / (100 + P)))` and `P` is the board's
   **source interval modifier** (percent) of the source's **owner** for this
   tick (PP-8: `FlowContext.sourceSpeedPercent` is a list by player index, and a
   missing entry is 0). `P` is an input of the step, 0 unless the caller sets
   it (the arena sets it each tick, see "In-battle ramp"; a dry run leaves it
   unset, which gives `intervalTicks` unchanged). The result is rounded **down** (a faster source never rounds
   in favour of the slower one) and is never below 1, so a source produces at
   most one item per tick. The modifier is only read at a reset: a countdown
   that is already running is never rewritten, and the very first countdown
   (at the cold start) is always the plain `intervalTicks`.
4. If **no** output has a conduit: the item is lost at once: `produced` and
   `lost` both increase, the `produced` event and then a `lost` event (with the
   source as `building`) are recorded, and `countdown = scaledInterval`.
5. Otherwise the source **stalls**: the item waits, `countdown` stays 0 (so no
   new production), and it is retried at every following tick. `stalledTicks`
   increases by 1 on every tick it fails. If `stalled` was 0 it becomes 1 and
   `{tick: T, type: "stalled", building}` is recorded (only on the first
   failing tick). Production is delayed, not lost; nothing is counted as
   `produced` until the item is placed.

**3a. Refineries produce.** In building ID order, for each refinery (after
every source, so an item a source or a conduit put into its input buffer this
tick can be taken at once). Let `costs` be its tier's `costs` entries sorted
by resource ID, `counters` its counters in the same order:

1. **Intake**, as for a two-input consumer (step 2.1 of "One battle tick" and
   `intakeByResource`): go through its inputs clockwise from north; the input
   of resource `r` takes `min(buffer count, cost_r - counter_r)` items
   (`takeFromBuffer` on that side, which adds them to that input's `consumed`)
   into `counter_r`. This happens every tick, whatever the store holds or the
   cooldown is: a counter simply stays full, so a full counter, a full buffer
   and a backed-up conduit hold an input back, as for a unit producer.
2. **Release.** If `store > 0`, offer one item of the output resource to the
   output conduit by the rule of a source's waiting item in step 3 (a refinery
   has one output side; push onto its conduit as in step 2). If it is placed:
   `store` decreases by 1 and `stalled = 0`. If the output side has no conduit
   the item is sent into nothing: `store` decreases by 1, `lost` increases and
   `{tick: T, type: "lost", building, resource}` is recorded (`produced` was
   counted when the batch was made). Otherwise (the conduit is full or the
   output is an open border half, PP-4) the item waits: if `stalled` was 0 it
   becomes 1 and `{tick: T, type: "stalled", building}` is recorded (only on
   the first failing tick), and `stalledTicks` increases by 1. At most one
   item leaves per tick.
3. **Batch.** If every counter equals its cost, `cooldown = 0` **and
   `store = 0`** (after the release of step 2, so the last item of a store and
   the next batch can share a tick): every counter becomes 0, `cooldown =
   productionIntervalTicks`, `store = outputPerBatch`, `produced` increases by
   `outputPerBatch`, `batches` by 1, and one `{tick: T, type: "produced",
   building, resource}` event per item (`outputPerBatch` of them) is recorded
   with the output resource. A batch does not wait for the conduit: it only
   needs an empty store, so while the store holds items no new batch starts.
4. If `cooldown > 0` it decreases by 1 (after step 3, so a batch made this
   tick counts this tick as the first of its interval).

The first item of a batch is released on the **next** tick (step 3a.2 runs
before step 3a.3), which is also why a direct connection into a merger is
"ready" (step 0) by its `store`. The Overclocker's `source_speed` modifier is
read only by step 3 (sources): a refinery's `productionIntervalTicks` is not
scaled by it. Only the owner's Alchemist scales it (`FlowContext.refinerySpeedPercent`,
"Specialists", "Family bonuses"): the cooldown set in step 3a.3 is `scaledInterval(
productionIntervalTicks, P)` with the `P` of the refinery's owner. A refinery is paced in every consumer mode: in `drain` mode (below) its
buffers are not drained and in `need` mode it has no pacer.

**Consumers.** With `consumers: "drain"` (tests and dry runs), after step 3a
every consumer input's `count` is added to its `consumed` counter and set to 0,
except for a refinery's inputs.
With `"hold"` buffers stay as they are; later issues remove units from them
with `takeFromBuffer` (below).

**4. The tick counter** increases by 1.

### Collector rate

A collector (a building of kind `source`) has **exactly one output side**
(the loader rejects any other count), so the splitter is the only building
that divides a flow (CB-9e). Its rate is one item per `scaledInterval` ticks
(step 3). The helpers `collectorRatePer1000` and `collectorHundredthsPerSecond`
give the display values: `ratePer1000 = floor(1000 / scaledInterval)` items per
1000 ticks (the plain `intervalTicks` when there is no speed-up), and
`floor(100 * ticksPerSecond / scaledInterval)` hundredths of an item per second
(tier 1 at 20 ticks: 0.50 per second, shown rounded down). A collector with the
resource setting (the Mana Well, issue #473) is an ordinary collector here: its
tier's `intervalTicks` and the owner's collector speed-up (a Flowmancer's
family bonus included) apply in the same way, and the resource it makes is its
setting. Its shipped intervals are 40 / 28 / 20, **half the rate** of an
Extractor of the tier ("The resource setting", "The Mana Well").

### Accepting

An item offered to a building's input side (by step 1a, or by a push):

- _Consumer_ (unit producer, turret, economy building): accepted if that input's
  `count` is below `bufferCapacity`. Then `count` and `delivered` increase by 1
  and `{tick: T, type: "delivered", building, side, resource}` is recorded.
  Otherwise refused, and the conduit backs up.
- _Route building or crossover channel_: accepted if its holding cell is empty;
  the item goes into the cell. An offer to a **merger** is additionally
  accepted only if the merger has no winner in step 0 or the offer comes
  through the winner's input; this holds whether the offer is made by a conduit
  in step 1a or by a direct connection (step 2 or 3). Whenever a merger accepts
  an item through input index `i`, its `pointer` becomes `(i + 1) mod n`. A
  splitter or crossover channel has one input, so there is nothing to
  arbitrate (their pointers do not change on input).
- Anything else (cannot happen in a valid state): refused.

Because step 1 comes before steps 2 and 3, a merger's cell is only free for a
conduit in step 1 and for a direct connection in step 2 or 3; step 0 is what
keeps every kind of input in the rotation. Without it a conduit delivery would
always refill the cell before a directly connected route could push (the route
pushes before the merger empties it), and a ready direct source would refill
the cell in step 3 right after the merger emptied it in step 2, so the direct
input would starve (or monopolise) behind a slow consumer. A source still
stalls rather than push into a cell that is full or reserved for another
input. A splitter's outputs and a crossover's channels need no such rule:
their only shared resource is a consumer buffer or conduit slot fed by one
input, and a splitter already rotates over the outputs that accept; the
direct-connection case matters only where several inputs meet, at a merger.

### Splitting with back-up

A splitter holds at most one item. Each tick, if it holds an item, it tries
its outputs in the order `pointer, pointer + 1, ...` (clockwise from north,
modulo the number of output sides), skipping sides with no conduit. The first
output that **accepts** takes the item and `pointer` becomes the index after
it; if none accepts, the item stays and `pointer` does not move. An output
accepts when the first slot of its conduit is empty or, for a direct
connection, when the building behind it accepts ("Accepting"). `pointer`
starts at 0 at the start of every battle.

So while every connected output accepts, the items go out in strict rotation
and the counts of two outputs differ by at most 1 (an **even split**). An
output whose path is full **backs up** and is skipped, so its share goes to
the outputs that still accept (**the remainder goes to the other paths**).
When no path accepts, the splitter holds its item, its input conduit fills
and the collector stalls: production is delayed, not lost. No division is
performed and no item is split. A path stops accepting when its consumer is at
top speed with a full store ("Top speed, need and store" under "One battle
tick").

### Refineries (CB-5d, CB-5f)

A **refinery** is a building of kind `refinery`: a consumer that turns the
resources it takes into one new resource and puts it on a conduit. The rules
here hold for every refinery; the two shipped ones are content. Its definition
(`content/buildings.json`, `schemas/buildings.schema.json`) has:

- `output`: the ID of a **refined** resource, one whose `refinedFrom` is, as a
  set, the set of the resources of the building's inputs (the loader rejects
  anything else, so a refinery of Composite takes Ore and Power).
- one or two inputs, each naming a resource, and exactly one output side;
- per tier `health`, `price`, `costs` (an integer from 1 to `MAX_TIER_COST`
  for **every** input resource and no other, read sorted by resource ID like
  the `costs` of a two-input unit producer), `productionIntervalTicks` (at least
  1) and `outputPerBatch` (an integer from 1 to `MAX_OUTPUT_PER_BATCH`, 1000).
  A refinery tier has no `costPerUnit`.

Rules (step 3a of `stepFlow`, "One tick: `stepFlow`"):

- **Intake and waiting** are those of a two-input consumer: one counter per
  input resource, each filled up to its cost, a full counter holding its input
  back. Items taken count as `consumed`.
- **Batch.** When every counter is full, the cooldown is 0 and the output
  store is empty: counters to 0, cooldown to `productionIntervalTicks`,
  `outputPerBatch` items of the output resource into the store (they count as
  `produced`, with one `produced` event each).
- **Release.** Every tick one item of the store, if any, is offered to the
  output conduit by the rule of a source's waiting item. If the conduit cannot
  accept it the item waits, the refinery is **stalled** (`stalled` event on
  the first tick, `stalledTicks` counts) and no new batch starts until the
  store is empty; so a backed-up output stops the intake (counters, buffers
  and input conduits fill) until it frees. At most one item leaves per tick,
  so a refinery whose `outputPerBatch` is larger than its interval cannot
  release a whole batch in time: the store stays non-empty and batches follow
  one per `outputPerBatch` ticks. An output side with no conduit sends each
  item into nothing: `lost`.
- **Speed.** The top speed is one batch per `productionIntervalTicks`; the
  output at top speed is `refineryOutputPer1000 = floor(1000 * outputPerBatch /
  interval)` items per 1000 ticks and each input is needed at
  `needPer1000By = floor(1000 * cost_r / interval)`. With less than that
  arriving the refinery follows its slowest input: it makes a batch whenever
  every counter has filled, so its output is limited by the input that takes
  longest to fill its counter, never more than the top speed.
  The Overclocker (`source_speed`) speeds up collectors only; a refinery is
  not scaled by it. The owner's Alchemist shortens the interval above to
  `max(1, floor(interval * 100 / (100 + P)))` (issue #471, CB-57).
- **Typing (CB-5b).** A conduit leaving a refinery carries its `output`
  resource ("Resource typing"). A refined conduit feeds only a building whose
  input names that refined resource (any other input, including the input of
  another refinery, gives `resource_mismatch`); splitters, mergers and
  crossovers carry it like any resource, and a merger never mixes Composite
  with Aether or with a base resource. The shipped consumers of refined
  resources are the Golem forge (Composite) and the Spire (Aether); the
  refinery vectors made before them define a test consumer with
  `extraBuildings`.
- **Border links (PP-4)** carry refined resources like any resource; a link
  may feed a refinery input or leave a refinery's output.
- A refinery is **not a unit producer**: it makes no units and
  `sealedProducers` never lists it. It is in the shop's offers from round 3
  (issue #383, "Offer roll") and in the bot's builds.

The flow graph node of a refinery has `kind` `refinery`; its `outputs` has
one entry. The Transmuter is the refinery with the resource setting; where it
differs, "The Transmuter" says so.

### Consumer seam

`takeFromBuffer(sim, buildingId, sideOrResource, n)` returns whether `n` units
were available and, if so, removes them (adding `n` to `consumed`); if not it
removes nothing. `sideOrResource` is an absolute side (`north` ...) or a
resource ID; for a resource it draws from the inputs that take that resource,
clockwise from north, and the sum must cover `n`. An unknown building or side
gives `false`. A two-input consumer (CB-5e) always takes by side: its intake
(step 2.1) calls `takeFromBuffer` once per input, so each resource is drawn
only from its own input. What a consumer does with the units (spawning, firing, upgrades)
belongs to later issues, which call this function between ticks, before the
next `stepFlow`.

### Events

A refinery logs `produced` (one per item of a batch, with the output
resource), `lost` (an item sent into nothing) and `stalled`.
`{tick, type, ...}` with `type` one of `produced` (`building`, `resource`),
`delivered` (`building`, `side`, `resource`), `lost` (`building`, `resource`)
and `stalled` (`building`); `schemas/sim-event.schema.json`. Movement along
conduits is not logged (playback animates it from conduit contents). Events
within a tick appear in the order the steps produce them.

### Conservation

At the end of every tick: items produced = items in conduit slots + items in
route holding cells + items in refinery output stores + items in consumer
buffers + items consumed + items lost (`flowTotals`; its `held` is the items in
route holding cells and refinery stores together). A source's waiting
(stalled) item is not yet counted as produced. The items a refinery takes are
`consumed` when it takes them from a buffer, and the items it makes are
`produced` when its batch is made, so a refined item is a new item in the
count: a chain of collectors, a refinery and a consumer of its output
balances at every tick.

### Dry run (CB-43)

`dryRunFlow(teamState, content, simConfig, ticks, mode = "drain")` runs
`createBoardSim` and `stepFlow` with `consumers: "drain"` for `ticks` ticks and reports, per source:
`produced`, `lost`, `stalledTicks`; per route: `lost`; per consumer input:
`delivered` and `ratePer1000` = `floor(1000 * d / w)` where
`w = ticks - floor(ticks / 2)` and `d` is the number of deliveries during the
last `w` ticks (so the cold start does not distort it; 0 when `w` is 0).

With `mode = "need"` (consumer mode `need`, used by the build screen) each
consumer is instead **paced at its top speed**, with no arena: after the flow
steps of each tick, every consumer in building-ID order runs the intake and
produce rules of "One battle tick" step 2 (a unit producer always finds a
spawn position; a turret is taken to fire whenever it is charged and off
cooldown, the upper bound of its need; an economy building stops after
`maxSteps` steps and then takes nothing), then its cooldown counts down by 1.
The result gains `needs`: per consumer `{building, needPer1000, productions}`,
with `needPer1000` the helper below and `productions` the count during the run.
For a two-input consumer (CB-5e) the entry also has `needPer1000By`, a list
sorted by resource ID of `{resource, needPer1000}` with the need of each
resource (`floor(1000 * cost_r / interval)`); its `needPer1000` is the one of
the summed cost. The pacer follows the intake and produce rules of step 2 for
a two-input consumer: one counter per resource, a production only when every
counter is full and the cooldown is 0, then every counter back to 0.
A **refinery** has no pacer (it paces itself in every mode, step 3a): its
entry in `needs` is `{building, needPer1000, needPer1000By, productions,
outputPer1000}` with `needPer1000` the helper value of the summed cost,
`needPer1000By` the need of each input, `productions` the **batches** made and
`outputPer1000` the output at top speed (`refineryOutputPer1000`). When the
board has a refinery the result also has `refineries`, one entry per refinery
in building order `{building, resource, produced, batches, lost, stalledTicks,
ratePer1000}`, with `ratePer1000` the items made per 1000 ticks over the last
`w` ticks (as above): the refinery's real output, limited by its slowest
input (a refinery fed 50 Power per 1000 ticks, costing 3 per batch of 2, shows
33). A board without a refinery has no `refineries` entry. In `"drain"` mode a
refinery's own input buffers are not drained.
The delivered `ratePer1000` is as above, so a consumer fed at or above its
need shows a rate equal to its need (over a window that is a whole number of
intervals). The pacer state (`progress`, `cooldown`, `productions` per
consumer) belongs to the run's context, not to `BoardSim`, so the state hash
of the other modes is unchanged. The modes `hold` and `drain` stay for tests.

### Golden kind `flow-sim`

Input: a `team-state-ops` script (`seed`, `partySize`, `ops`) plus `ticks` and
`consumers` (`"hold"`, `"drain"` or `"need"`), and optionally `take`, `{building, side,
every}` (`building` an integer, `side` one of `north`, `east`, `south`, `west`,
`every` an integer from 1; anything else is rejected): before every tick `T` with `T mod every = every - 1` one unit is taken
from that consumer input with `takeFromBuffer` (if it holds one), which paces a
slow consumer in `"hold"` mode. The script builds the board, then the flow
simulation runs for `ticks` ticks from the cold start. Result:
`{ tick, stateHash, flow, sources, routes, consumers }`: `stateHash` is the
hash of the final state, `flow` the conservation totals, `sources` a list of
`{building, resource, produced, lost, stalledTicks}`, `routes` a list of
`{building, key, lost, held}` and `consumers` a list with one entry per
consumer input `{building, side, resource, count, delivered, consumed}`; in
mode `"need"` it also has `pacers`, one `{building, progress, cooldown,
productions}` per consumer (a two-input consumer's entry also has `counters`,
the list of its per-resource counters sorted by resource ID, and `progress`
is their sum; a refinery has none). On a board with a refinery the result also
has `refineries`, one `{building, resource, counters, cooldown, store, stalled,
produced, lost, batches, stalledTicks}` per refinery. An optional
`extraBuildings` list (building definitions in the format of
`content/buildings.json`) is added to the content for the run (the kinds
`flow-graph` and `arena-sim` accept it too; an ID that already exists is an
error). The event log of the run is the vector's event log (`eventLogHash`).
Vectors: `golden/flow-sim.json` (a long conduit, a splitter, a merger, a
crossover with two resources, a dead end, a full-buffer backpressure case, and a
merger with a direct input and a conduit input behind a slow consumer, a
merger fed directly by two sources behind a slow consumer, and a merger fed
directly by one source and by a conduit behind a slow consumer: the last two
pin the "direct source is ready when its `countdown` is at most 1" rule). Four
`"need"` vectors (2000 ticks) pin PP-7 against consumers with a top speed
(the barracks needs 50, 71 and 100 items per 1000 ticks at tiers 1 to 3):
`need-even-split` (a tier 1 collector, 50 per 1000 ticks, into a splitter with
two tier 1 barracks: both under-supplied, 25 per 1000 ticks each),
`need-top-speed-one-path-backs-up` (two tier 2 collectors, 142 per 1000
ticks, through a merger and a splitter into a tier 1 and a tier 3
barracks: the even share, 71, is above the tier 1 barracks' top speed, so its
production interval makes that path back up and the tier 3 barracks takes the
remainder (about 90 per 1000 ticks)), `need-top-speed-all-backs-up` (a tier 3 and a tier 2
collector, 171 per 1000 ticks, into two tier 1 barracks: both reach their top
speed, the collectors stall, nothing is lost)
and `need-three-way-unconnected` (one of the three outputs has no conduit).
Two vectors with the Grand barracks (issue #440, CB-10f, CB-13a; 1000 ticks, a tier 2 Grand barracks that takes 8 items per production every 56 ticks, need 142 per 1000 ticks) pin the stated exception to the rebalance rule: `grand-barracks-two-collectors-need` (two tier 2 collectors, 71 per 1000 ticks each, joined by a Merger: 142 delivered, 17 productions, no source stalls) and `grand-barracks-one-collector-need` (one collector: 71 delivered, about half the productions, 8).
Three vectors with the Tunnel (issue #442, CB-9g) pin the pair as a conduit segment: `tunnel-under-walls` (1000 ticks, consumers in `need` mode: a Barracks is fed through a pair of distance 4 with walls on the cells between, 49 delivered, nothing lost) and `tunnel-transit-pair` against `tunnel-transit-conduit` (25 ticks each: the same line through the pair delivers nothing yet, through Mergers and a conduit of the cells between them one item: a tunnel is one tick slower than that conduit, never faster).
Six vectors with the Foundry (issue #380, CB-5e; one-cost buildings are
unchanged) pin two-input consumers: `foundry-ore-only` (Power never arrives:
the Ore counter fills, the Ore buffer fills, the collector stalls, nothing is
produced), `foundry-both-inputs-top-speed` (one production per interval),
`foundry-power-slow-ore-backs-up` (Ore stalls while Power still arrives; the
Foundry follows Power), `foundry-tier1-need`, `foundry-mixed-network` (Ore
shared through a splitter with a Barracks) and
`foundry-border-link-feeds-power` (one input fed over a border link, PP-4).
Without the cooldown rule of the production step the two `top-speed` vectors
change. Nine vectors with the refineries (issue #381, CB-5d; made before any
shipped building took Composite or Aether, so each ends its chain at a one-input test
consumer defined in the vector with `extraBuildings`: a unit producer of
soldiers that takes the refined resource, one per 10 ticks) pin them:
`refinery-ab-chain-need` and `refinery-bc-chain-need` (two tier 3 collectors,
a tier 3 refinery, a refined conduit, the consumer: 66 items per 1000 ticks),
`refinery-ab-tier1-need` (the collectors back up behind a tier 1 refinery),
`refinery-ab-one-input-missing`, `refinery-ab-output-backs-up` (the consumer
is not paced: the store holds, the refinery is stalled, intake stops),
`refinery-ab-unconnected-output` (every item lost, never stalled),
`refinery-ab-direct-output` (a conduit of length 0), `refinery-ab-chain-drain`
and `refinery-bc-flux-border-link` (the Aether refinery of one player takes
Flux from another over a border link).

### Mid-battle removal

`rebuildFlow(sim, newState, content, simConfig, pairs?)` (`flow-sim.ts`; `pairs`
are the Tunnel pairs that still stand, from the arena's `ctx.tunnels`; without
it they are derived from `newState`) supports the
destruction of buildings (CB-9a). `newState` is the team state with the
destroyed building, every conduit attached to it, and the other half of every
border link that lost a half (PP-4) removed. The flow plan is
recompiled from `newState`; everything that survives keeps its state (sources
by building ID; conduits by conduit ID; routes by node key; consumers by
building ID and input side; `tick` is kept). What is removed is accounted so
that conservation still holds:

- Items in removed conduit slots (the slots of a Tunnel pair whose end was
  destroyed included, CB-9g), a removed route's holding cell, and a removed
  consumer's input buffers are **lost**. A removed unit producer's `progress`
  (for a two-input producer every one of its counters) is dropped with it;
  those items were already counted as `consumed`. A destroyed **refinery**
  loses the items of its output store (they count as lost, and everything
  downstream of it is cut like any destroyed building's conduits, CB-9a); its
  counters were taken from its buffers already and are dropped. In a battle
  (`stepArena`, destruction in step 6) one `lost` event per item of the store
  is logged with the refinery's `building`, the output resource and the tick
  of the destruction.
- The counters of removed parts move to `retired`: a removed source's
  `produced` and `lost`; a removed route's `lost`; a removed consumer's
  `consumed`; a removed refinery's `produced` and `lost`; plus the lost items
  above. `BoardSim.retired`
  (`{produced, lost, consumed}`) exists only after the first removal that
  moved a non-zero amount (so a state that never lost a building has the same
  shape and hash as before) and `flowTotals` adds it in.

## The arena

**Cores (PP-9).** Each side has one Core per placed player Core: `Arena.coreRef[side][player]` is its building `ref` (-1 if none was placed). The `health` list holds, per side, the Cores in player order as `{side, core, hp, remaining, fellTick}` and then the buildings by instance ID as `{side, building, hp}`. Each Core starts at its own maximum health (`maxHealthOf`, with the side option `coreHealths[player]`). A destroyed Core's cells become open ground and **nothing else changes** (CB-17a): its owner's buildings, sources, conduits and units carry on.

Implemented in `packages/core/src/arena.ts` (geometry) and `arena-sim.ts`
(state and tick), `arena-paths.ts` (fields). Units live in an **arena**: one
grid holding both sides. Each side's `BoardSim` keeps running in its own
board-local coordinates; only units, building health and the grid are in arena
terms.

Both boards must have the same `width` `W` and `height` `h` (otherwise
`createArena` throws). With `gapRows` rows between them, the arena is `W` wide
and `H = 2h + gapRows` tall:

- Side 0's board occupies arena rows `0 .. h - 1` unchanged: arena `(x, y)` =
  board `(x, y)`.
- Rows `h .. h + gapRows - 1` are the gap: open ground, the neutral zone of a
  battle (see "The neutral zone"). An optional list of **blocked gap cells**
  may block some of them (it must lie inside the gap rows); a battle passes
  the zone's lakes and cliffs this way.
- Side 1's board is rotated 180 degrees: board cell `(x, y)` is arena cell
  `(W - 1 - x, H - 1 - y)`. `toArena(side, cell)` and `toBoard(side, cell)` are
  the two directions of this map (the rotation is its own inverse; side 0 is
  the identity). Side 1's front row (`y = h - 1`) is arena row `h + gapRows`.

Per arena cell the arena records:

- **blocked**: the cell holds a terrain feature with `blocksMovement` on either
  board (mapped through the transform), or is a blocked gap cell;
- **the building covering it**, if any: a placed building (side and instance
  ID) or a side's Core. A building is stored with its arena cells.

**Conduits are not in the arena at all.** They never block movement and can
never be targeted (CB-3h, CB-9a). A destroyed building (or Core) stops
covering its cells at once and they are open ground again.

**Health** (CB-11) is battle state: every placed building starts at its tier's
`health`; each Core at the Core definition's tier-1 `health`. Health is an
integer; it never goes below 0. A building at 0 is destroyed (step 6 below).

### Units

A unit is `{id, side, def, px, py, hp, maxHp, damage, attackCooldown, owner, target}`
(a neutral guard also has `post`, see "Neutral guards"). `side` is 0 or 1, or
**2 for a neutral guard** (CB-8e), which has `owner = -1` and `target = -1`;
guards are in the same list, sorted by `id`, with ids from the same counter
(they are placed before tick 0, so they take the first ids).
`owner` is a player index of the unit's own side and `target` the player index
of the enemy Core it heads for, or `-1` when none stands (PP-11, "Goals and
movement fields"). `(px, py)` is
the **centre of the unit's circle** in arena **sub-cell units** (see "Unit
geometry"). `id` is a positive integer taken from one counter shared by both
sides, in spawn order (the counter starts at 1, is never reused); the unit list
is kept sorted by `id`. `hp` starts at the unit definition's `health`; `maxHp` (CB-8g) is the same number, **fixed at spawn** from `unitStats` (so it includes the strength percent and a champion's health percent) and never changes: healing never takes `hp` above it. It is stored in the unit's state, so the state hash of every battle with units includes it; no saved format stores an arena state (the run state and the ghost snapshot store teams).
`attackCooldown` counts down in ticks. A unit spawned by a side that holds a
speed modifier (issue #424, "Unit move and attack speed") also stores the
optional `moveCooldownTicks` and `attackCooldownTicks`, **fixed at spawn**,
each only when it differs from the unit definition's value; a unit without
them uses the definition's. In the same way (issue #426) a unit spawned by a
side that holds Stone skin or Wide arcs stores `armor` (the definition's plus
the side's `unit_armor_flat` amounts, at most `MAX_ARMOR`) or `splashPercent`
(see "Unit armor and splash modifiers"), each only when it differs. A port must not write them otherwise, so the state
hash of every battle without speed modifiers is unchanged. **Units are circles that may overlap
each other a little for a while but never solid ground** (soft collision,
issue #82): see "Unit geometry" and step 5 of the tick. There is no
`moveCooldown`: movement is continuous, at the unit's `speed`.

A unit also stores `damage`, its attack damage **fixed at spawn**. All reads
of a unit's stats (health, damage, range, cooldowns) go through one function,
`unitStats(side, def, strengthPercent, healthPercent = 100, moveSpeedPercent =
0, attackSpeedPercent = 0, armorBonus = 0, splashBonusPercent = 0,
healthBonusPercent = 0)`. With
`strengthPercent = P` above 0 it returns the definition with `health =
mulPct(health, 100 + P)` and `damage = mulPct(damage, 100 + P)` (rounded
down). With `moveSpeedPercent = S` or `attackSpeedPercent = S` above 0 the
result's `moveCooldownTicks` or `attackCooldownTicks` becomes
`max(1, floor(base * 100 / (100 + S)))` (issue #424, see "Unit move and attack
speed"); everything else is unchanged. A `healthPercent = hp` other than 100
(a champion, MM-9d "Warlord", passed only for a scheduled-wave entry that has
one) is applied **after** the strength percent and to health only: `health =
mulPct(mulPct(health, 100 + P), hp)` (two roundings down; with `P = 0` just
`mulPct(health, hp)`); damage, armor and every other stat are unchanged, and a
result above `MAX_HEALTH` is a `RangeError`. A `healthBonusPercent = H` above 0 (the owner's specialist, issue #471) makes the
strength-scaled health `mulPct(health, 100 + P + H)`: one rounding, damage
unchanged ("Specialists", "Family bonuses"). With `P = 0`, `hp = 100`, `H = 0` and both speed percents 0 the
definition is returned as is. A scaled `health` above `MAX_HEALTH` or `damage` above `MAX_DAMAGE`
is an error (`RangeError`), see "Content bounds". A spawn passes the side's
current `unit_strength` bonus (see "In-battle ramp"; plus the side's
`unitStrengthPercent` option, see "Side options"; plus the side's point bonus,
see "Points of interest", "Buffs"), and the unit starts with
`hp = health` and `damage` of the result; units already on the field are never
changed afterwards. A unit's `armor` (CB-5h) is never scaled by strength: it is
read each time a hit on the unit is dealt (see "Units, combat and destruction",
"Order of damage modifiers"), from the definition, or from the unit's own
`armor` when its side held Stone skin at its spawn (issue #426, "Unit armor and
splash modifiers"); `unitStats` returns the definition's armor plus the side's
`armorBonus`, at most `MAX_ARMOR`.

**Splash** (issue #387). A unit definition may give `splash`, an object
`{radiusSub, percent}`: `radiusSub` an integer from 1 to `MAX_SPLASH_RADIUS`
(480, two cells; 240 sub-cell units per cell), `percent` an integer from 1 to
100. Absent means no splash, so the unit files and every saved state and state
hash of a unit without it are unchanged (the field is part of the definition,
never of a unit's state). Content: `unit_caster` (health 32, damage 12, attack
cooldown 20, move cooldown 6, radius 66, collision radius 43, reach 720,
ranged, splash 360 / 60; tuned in issue #386, still proposed) made by `bld_spire`. See "Units, combat and
destruction", "Splash damage". The worst case is bounded by the units alive: one
attack hits at most every opposing unit alive (at most 1000 per side, the unit
budget of `docs/performance-budget.md`), so a tick has at most
`(attackers with splash) * (opposing units)` secondary hits, at most about 10^6;
a battle packed with casters measured a peak of 444 secondary hits per tick (see
the performance budget).

**Armor** (issue #382). A unit definition may give `armor`, an integer from 0
to `MAX_ARMOR` (1000); absent means 0, so the unit files and every saved state
and state hash of a unit without armor are unchanged. Every hit on a unit deals
`armorHit(hit, armor) = max(1, hit - armor)` when `hit > 0` and `armor > 0`,
and `hit` otherwise (a hit of 0 stays 0). Content: `unit_golem` (armor 3; see
"Status of every rule" for the numbers) made by `bld_golem_forge`.

**Long reach: the Lancer** (issue #439, CB-16e). `unit_lancer` (health 35,
damage 7, attack cooldown 12, move cooldown 6, radius 70, collision radius 46,
reach 300, melee, ground) is made by `bld_lancer_hall` (1x3, Ore on the south
side before rotation, one Lancer per production, `costPerUnit` 6). It has no
field and no rule of its own: it is a melee unit whose `reach` (300, against the
soldier's 60) is larger, so rule a of "One battle tick" step 4 (the nearest
enemy unit in contact, `d^2 <= (reach + R + Re)^2`, with no test of what stands
between) already lets it hit an enemy that is in contact with the ally in front
of it, and a unit that attacks holds its place (so pushing never carries it
through the ally). In contact its centre is at most `300 + 70 + Re` from the
enemy's (at most 480 for the shipped radii), under the aggro range of 720
(`aggroRangeCells` 3), so a Lancer that has no enemy in reach still walks to an
enemy within aggro and then holds. A melee unit still cannot hit a flying unit.
Notes for a port: nothing to add; read `reach` as for every unit, and keep rule
a's tie key (smallest `d^2`, then lowest unit id), which decides between the
enemy in front and the one behind it. The shipped content keeps
`reach + radius + the largest radius` under `aggroRangeCells * 240` (a test
pins it).

### Unit geometry (issue #59)

Everything below is integer arithmetic; the largest values are in "Content
bounds". Implemented in `geometry.ts` (helpers) and `unit-motion.ts`
(placement and movement).

**Scale.** One cell is `CELL_UNITS = 240` sub-cell units. Arena cell `(cx, cy)`
is the closed square `[240 cx, 240 cx + 240] x [240 cy, 240 cy + 240]`, and the
arena is the rectangle `[0, 240 W] x [0, 240 H]`. The **cell of a unit** is taken
**in the frame of a side**: for side 0 it is `(floor(px / 240), floor(py /
240))`; for side 1 the position is rotated first, the cell is `(W - 1 -
floor((240 W - px) / 240), H - 1 - floor((240 H - py) / 240))`. A centre
exactly on a cell boundary therefore belongs, in the frame of side 0, to the
cell with the higher coordinate (`py = 240 k` is row `k`) and, in the frame of
side 1, to the cell with the lower arena coordinate (`py = 240 k` is row
`k - 1`), so that a mirrored battle stays exactly symmetric. The frame used is
that of the unit's own side for the unit's decisions, and that of the
**turret's owner** for the turret row test (see "Turret fire"). Both are clamped into the arena. 240 was chosen so that the
placeholder radii (0.30 and 0.25 cell) and the speeds derived from the move
cooldowns below are exact integers.

**Unit definition fields** (`content/units.json`, all integers in sub-cell
units unless noted):

| Field | Meaning |
| --- | --- |
| `radius` | Radius of the unit's body: used for reach, aggro, turret range and drawing. 1 to 480. |
| `collisionRadius` | Radius of the circle that is pushed out of solid ground and pushed apart from other units' circles (soft). 1 to 480. About 65 percent of `radius` for the ground units of the first content. |
| `reach` | Most the gap between the unit's circle and its target may be for it to attack (0 to 1920). |
| `moveCooldownTicks` | Ticks the unit needs to walk one cell. `speed = floor(240 / moveCooldownTicks)` sub-cell units per tick (1 to 240; at least 1 results). Soldier 6 -> 40, raider 4 -> 60: the same crossing time per cell as the earlier one-cell-per-cooldown rule. |
| `armor` | Optional integer 0 to `MAX_ARMOR` (1000), default 0: taken off every hit on this unit, at least 1 left for a hit above 0 ("Units, combat and destruction"). Not scaled by `unit_strength`. |
| `splash` | Optional `{radiusSub, percent}` (`radiusSub` 1 to `MAX_SPLASH_RADIUS` = 480, `percent` 1 to 100): area damage around the unit it attacks ("Units, combat and destruction", "Splash damage"). Not scaled by `unit_strength`. |
| `flying` | Boolean. A flying unit ignores walls, lakes and cliffs and collides only with other flying units ("Ranged units and flyers"). A flying unit must be `ranged` (the loader rejects a melee flyer). |
| `attackType` | `"melee"` or `"ranged"`. A melee unit cannot hit a flying unit; a ranged unit can. For a ranged unit `reach` is its range (edge to edge, as for melee). |

Placeholder content (units added with part 2, all numbers placeholders to tune: archer `health 30, damage 5, cooldown 10, moveCooldownTicks 6 (speed 40, like the soldier), radius 66, collisionRadius 43, reach 720` (three cells), ranged; drone `health 20, damage 4, cooldown 8, moveCooldownTicks 4, radius 66, collisionRadius 16, reach 600`, flying, ranged; producers `bld_range` (archer, `res_a`) and `bld_hangar` (drone, `res_b`), both 2x2 like the Barracks, offered in the shop at weights 5 and 3): soldier `radius = 72` (0.30 cell), `collisionRadius = 47`,
`reach = 60`; raider `radius = 60` (0.25 cell), `collisionRadius = 39`, `reach =
60`. Reach, aggro and turret range use `radius` (the body); collision uses
`collisionRadius`, so bodies pack tighter than they are drawn.

**Helpers.**
- `isqrtFloor(n)`: the largest integer `r` with `r * r <= n` (`n >= 0`);
  `isqrtCeil(n)`: the smallest `r` with `r * r >= n`. Both exact for every safe
  integer (a port may use any exact method; the reference corrects a floating
  estimate in both directions).
- `awayDiv(a, b)` for `b > 0`: `ceil(a / b)` if `a >= 0`, `floor(a / b)` if
  `a < 0` (rounds away from zero); `truncDiv(a, b)` rounds toward zero.
- `boxDist2(X, Y, cell)`: the squared distance from point `(X, Y)` to the
  closed square of `cell`: `dx = max(240 cx - X, 0, X - 240 (cx + 1))`, `dy`
  likewise, `dx^2 + dy^2`. `buildingDist2(X, Y, building)` is the minimum over
  the building's cells.
- Circles `a` and `b` **overlap** iff `dist^2 < (Ra + Rb)^2` (centre distance
  squared, collision radii). Touching (equal) is not an overlap.

**Solid cells.** For a side, a cell is **solid** iff it is not open for that
side (`openFor`: terrain, a blocked gap cell, a building that blocks the side;
an own gate is not solid for its owner). Everything outside the arena rectangle
is solid. A circle of radius `R` at `(X, Y)` **fits** for a side iff
`R <= X <= 240 W - R`, `R <= Y <= 240 H - R` and for every solid cell whose
square intersects the box `[X - R, X + R] x [Y - R, Y + R]` (cells
`floor((X - R) / 240) .. floor((X + R) / 240)` in x, likewise y, clamped to the arena)
`boxDist2(X, Y, cell) >= R^2`. A unit therefore cannot pass a gap narrower than
its collision diameter, and no unit's circle ever intersects blocked ground.
Conduits are not in the arena: units pass over them.

**Invariant (holds at the end of every tick and at tick 0).** Every unit's
collision circle fits for its side: it is inside the arena and clear of every
solid cell. Two units' collision circles **may overlap** (soft collision, issue
#82): overlap is resolved by the push pass of step 5 over the following ticks,
it is not forbidden. `stepArena` guarantees the invariant by construction (the
settling of step 5: a position that does not fit is replaced by one that
does, and the unit's last fitting position is the fallback).

**Push-out of solid ground** `pushOutSolid(side, R, (X, Y))`: visit the cells of
the window above in row-major order (`y` then `x`, ascending) and, for each
solid one with `boxDist2 < R^2`, replace `(X, Y)` as follows (using the new
value for the next cell). Let `q` be the point of the square nearest to
`(X, Y)` (each coordinate clamped to the square) and `(ox, oy) = (X - qx, Y - qy)`.
If `(ox, oy) != (0, 0)`: `d = isqrtFloor(ox^2 + oy^2)` and the new position is
`q + (awayDiv(ox * R, d), awayDiv(oy * R, d))` (at least `R` from the square,
`d >= 1` always holds here). If the centre is inside or on the edge of the square
(`(ox, oy) = (0, 0)`): leave through the nearest face, with `L = X - 240 cx`,
`Rr = 240 (cx + 1) - X`, `D = Y - 240 cy`, `U = 240 (cy + 1) - Y`; take the
smallest, ties in the order `L, Rr, D, U`, and move to the face minus (`L`, `D`)
or plus (`Rr`, `U`) `R` along that axis. Finally clamp `X` to `[R, 240 W - R]` and
`Y` to `[R, 240 H - R]`. For side 1 the same rule is used in its own (rotated)
frame: the cells are visited from the last to the first and the exit-face ties
are taken in the order `Rr, L, U, D`. One call is one sweep: it can leave the
result in another solid cell; the settling in step 5 (`settle`, up to 4
sweeps, then a fallback) deals with that.

### Ranged units and flyers (issue #59 part 2; CB-16b, CB-16c)

Implemented in `arena-sim.ts` (decisions, spawn) and `unit-motion.ts`
(layers); no new state: whether a unit flies is a function of its definition.

- **Who can hit a flyer.** Only ranged attackers: a ranged ground unit, a flying
  unit (always ranged) and a turret. A melee unit never targets a flyer and
  never chases one (rules a and a2 skip it), so a melee unit whose only
  remaining enemies are flyers walks on to its goal. Every unit can hit a
  ground unit, and every unit can hit a Core (rule b is unchanged). Turret fire
  ("Turret fire") already targets every enemy unit in the allowed rows, flyers
  included, with the same distance test.
- **Ranged units** use the same rules as melee units with a larger `reach`:
  rule a (the nearest enemy in reach, ties by lowest id), a2, then b (the
  target Core if in reach, else the nearest, same tie key). A unit that attacks
  holds its place, so an archer stops where its range first covers something
  and fires until that target is gone, then moves on. There is no line of
  sight for an attack: archers shoot over walls and over allies. An archer
  behind a soldier in a corridor can block the units behind it only while it
  fires (the others slide round a holder when they can, step 3 "Steering").
- **Splash and flyers.** A ranged unit with `splash` (the caster) can hit a
  flyer like any ranged unit, and its splash includes flyers: the splash
  search takes every unit of the opposing side, ground or flying, whose centre
  is within the radius, regardless of layer.
- **Flying units** fly in a separate layer. They are not solid for anything
  except the arena rectangle: `fits` and the push-out use a copy of the world
  in which no cell is solid (`ctx.air`), so walls, buildings, lakes and
  cliffs never stop or push one. In the push pass of step 5 a pair only
  pushes if both units are in the same layer, so flyers push only flyers (by
  their small `collisionRadius`) and ground units push only ground units. The
  steering of rule c ("Steering") considers only allies of the same layer.
  Spawning places a flyer on the **spawn cells** below, which for a flyer are
  **every** in-board cell 4-adjacent to the producer's footprint, open or not
  (a wall, a building or a lake cell included; the cells of the producer's own
  footprint count too, since each footprint cell is 4-adjacent to the others
  of a 2x2 footprint, so a drone may appear on top of its Hangar), ordered by the straight-line
  key `(0, buildingDist2(cell centre, target Core), tie key)`; it checks `fits`
  against the empty world and the overlap test against flyers only, so a
  Hangar walled in on every side still spawns its drones.
  `spawnUnitForTest` the same. A flyer's reach and body are measured as for
  any unit, so a unit's circle is hit at its `radius` whether it flies or not.
- **A flyer chooses a Core by straight-line distance.** The rule of PP-11 is
  unchanged (the Core opposite the owner's plot if it stands), but wherever
  the "nearest" Core is picked (a new target when the Core fell, a wave
  spawn, a spawn from a Hangar, `spawnUnitForTest`) a flying unit ranks the
  living Cores by `(0, buildingDist2(px, py, Core))` from its own position
  (from the centre of its first spawn cell at a spawn), never by the movement
  and breach fields; the later parts of the key `(|q - opposite(owner)|, -q)`
  are as before. Ties are therefore deterministic and mirror symmetric.
- **Sealed producers.** A producer of flying units is never sealed
  ("Sealed unit producers"), so it never blocks Ready.
- **Mirror symmetry and restore** hold as before: nothing above depends on
  unit order, and nothing new is stored.
- PvE waves from round 4 contain archers and drones ("Generation", step 4, `rangedMix`); the bots buy and place the Range and the Hangar.

### State (plain JSON)

`createArenaSim(teamA, teamB, gapRows, content, simConfig, options?)` gives the
state at tick 0:

- `tick`, `nextUnitId`, `gapRows`, `gapBlocked` (blocked gap cells sorted by
  `(y, x)`);
- `teams`: each side's team state **with destroyed buildings and their
  conduits removed**; `boards`: each side's `BoardSim`;
- `health`: one entry `{side, building, hp}` per Core and placed building, in
  order of side, then building ID with the Core (`building = 0`) first; a
  destroyed building stays in the list with `hp = 0`;
- `producers`: `{side, building, progress, cooldown}` for each living unit
  producer, by side then building ID, all starting at `progress = 0`,
  `cooldown = 0`;
- `turrets`: `{side, building, charge, cooldown}` for each living turret, by
  side then building ID, all starting at `charge = 0`, `cooldown = 0`;
- `wards`: `{side, building, charge}` for each living Rune Ward (issue #474),
  by side then building ID, all starting at `charge = 0`. **Present only when
  a plot has a Rune Ward at the start**, so the state (and its hash) of every
  battle without one is what it was before;
- `ramps`: `{side, building, charge, steps, cooldown}` for each living economy
  building (in-battle ramp), by side then building ID, all starting at
  `charge = 0`, `steps = 0`, `cooldown = 0` (CB-11);
- `units`; `entering`: the scheduled-wave units that have not found room yet,
  `{side, unit, col}` in queue order (see "Side options"); and counters `spawned`, `unitsDied` and `buildingDamageDealt`, each a
  pair indexed by side (`buildingDamageDealt[s]` is the damage the units of side
  `s` have applied to the enemy's buildings, see step 4 and "Tiebreak
  counters");
- `guards`: present **only** after `placeGuards` was called, that is, for a
  battle whose zone has points of interest: `{leashCells, capture, posts,
  killed, lostToGuards, maxPointStrengthPercent, healed}`, see "Neutral guards" and "Points of interest"
  (`capture` holds the four numbers of `content/points.json` `capture`);
- `points`: present **only** when `placeGuards` was called, like `guards`
  (CB-8f, "Points of interest"): one `{id, controller, progressSide,
  progress, held, buff}` per point of the zone, sorted by `id` (`buff` is
  the numbers of the point's buff, CB-8g, and absent for a point with none);
- `sideOptions`: present **only** when a side was given options (PvE battles, see
  "Side options"); a ghost battle's state has no such field, so its hash is
  unchanged;
- `linkedPools`: present **only** when a side has the `linkedCores` option
  (Linked Cores, MM-9d): `{side, hp, remaining}` per such side, initially the
  sum of that side's Cores' starting health for both `hp` and `remaining`
  (see "Linked Cores").

Everything else (the grid, the compiled wiring, cached fields) is derived from
this state by `createArenaContext(sim, content, simConfig, {events?})`, so a
state can be saved, restored and continued; a restored battle continues
exactly like the original.

## One battle tick

`stepArena(sim, ctx)` changes the state in place, in exactly this order. Let
`T` be `sim.tick` at the start; every event of the step has `tick = T`.

**Neutral units (CB-8e).** Wherever a rule below says "side 0 first, then
side 1", the neutral side 2 comes **after side 1, in unit-id order**. The
steps in which that matters are: step 1 (flow) and step 2 (production,
turret and ramp charging) have no neutral part (guards have no board, no
producer and no building; they are placed before tick 0); step 3 decides
guards with the rules of "Neutral guards" (pass 1 to 3 in id order with the
other units; enemy sets `[1, 2]`, `[0, 2]`, `[0, 1]`, guards last), and turret
fire never targets them; step 4 resolves guard attacks in unit-id order with the
others (guards first, as they have the lowest ids), without the Overload
escalation, and splash reaches every unit of an enemy side of the attacker,
neutral included; step 5 treats guards as a third side in the push pass
(different sides are enemies, ids decide a coincident pair with the same
frame); step 6 removes dead units in id order, guards included
(`unit_died {side: 2}` for a guard, counters in "Neutral guards"), and the
destruction of buildings and the retargeting of units skip guards (their
`target` is -1); step 7 counts the cooldown of guards down like any unit's. The points of
interest (CB-8f, "Points of interest") add the diversion of rule c in step 3
(units of side 0 and 1 only) and the capture step at the end of step 6.

0. **Overload level.** `level = overloadLevel(T)` (see "Overload"). On a tick
   where `T >= overloadStartTick` and `(T - overloadStartTick) mod
   overloadIntervalTicks = 0` (an Overload _beat_) the events
   `overload_started` (only when `level = 1`) and `overload_level {level}` are
   recorded. Nothing is stored: the level is a function of the tick.
1. **Flow.** For each side the arena first sets the board's source interval
   modifier to that side's current `source_speed` bonus (see "In-battle ramp"),
   then runs `stepFlow` for side 0's board, then side 1's. The two boards do
   not interact. Their events are appended side 0 first, each tagged `side`
   (see Events).
2. **Production.** For each living unit producer, side 0 first and each side in
   instance-ID order. In this step the **cost of a production** is the tier's
   `costPerUnit * unitsPerProduction` (CB-13a; for a two-input producer each
   `cost_r` times `unitsPerProduction`), and `costPerUnit` below means that
   figure; with `unitsPerProduction` 1 (every producer but the Grand barracks)
   nothing differs from before. A producer also has `held`, the number of units
   of a finished production still to spawn (0, and absent from a saved arena
   state while 0). A producer with `held > 0` skips step 2.1 and the cost and
   cooldown tests of step 2.2 and goes straight to spawning (see "Several
   units per production" below):
   1. **Intake.** Only if `held = 0` and `progress < costPerUnit` (no finished unit is
      waiting): go through its inputs clockwise from north and, for each, take
      `min(input buffer count, costPerUnit - progress)` items
      (`takeFromBuffer`) and add them to `progress` (all resources count
      alike). So `progress` never exceeds `costPerUnit`; the rest stays in the
      buffer. **Two-input producer (CB-5e; the tier has `costs` instead of
      `costPerUnit`):** `progress` is one counter per resource, in a list
      ordered by resource ID. Go through the inputs clockwise from north as
      above; the input of resource `r` takes `min(input buffer count, cost_r -
      counter_r)` items (`takeFromBuffer` on that side) and adds them to
      `counter_r` (an input never feeds another resource's counter; two inputs
      of one resource share its counter, in input order). So `counter_r` never
      exceeds `cost_r`. A full counter takes nothing more: that input's buffer
      and conduit fill and back up, even while the other resource is still
      arriving. In step 2.2 and elsewhere `progress` of such a producer means
      the sum of its counters, and `progress = costPerUnit` (the sum of the
      costs) holds exactly when every counter is full. A producer that holds a finished unit (step 2 below could not
      place it, or its cooldown is running) takes nothing, so its buffers fill
      and its conduits back up (the source stalls), exactly like a fully
      charged turret.
   2. **Produce.** A production starts at most once per tick (several units per production: 3. below): if `progress = costPerUnit` (the
      building's tier) **and `cooldown = 0`** and the unit finds a **spawn
      position**, set `progress = 0` (every counter of a two-input producer to
      0), set `cooldown = productionIntervalTicks`
      and spawn one unit of the producer's `unit` type there. The **spawn cells** are the
      cells 4-adjacent to the producer's footprint that are open for the
      producer's side (not blocked and not covered by a building that blocks
      that side; an own gate counts as open; for a **flying** unit every
      in-board neighbour counts and the key is the straight-line one of
      "Ranged units and flyers"), ordered by the key (class,
      distance, tie key): class 0 if the cell has a finite distance in the
      movement field of the unit's **target Core** (below) and then that
      distance; else class 1 with its distance in the breach field of that
      Core; else class 2; ties by the **tie key** (below). The unit's `owner`
      is the producer's `owner`; its target is the Core opposite the owner's
      plot if it stands, else, for each living enemy Core `q`, the key
      (class, distance) of the first spawn cell ordered by `q`'s fields
      decides, with the ties of "Goals and movement fields" (a producer with
      no spawn cell for `q` is not a candidate for `q`); the spawn cells are
      those ordered by the chosen Core. `unit_spawned` records `owner` and
      `target`. For each spawn cell in that order, and for each **offset** in the
      order below, the candidate position is the cell's centre
      `(240 cx + 120, 240 cy + 120)` plus the offset; the **first candidate at
      which the unit's collision circle fits for its side (see "Unit geometry")
      and is not **heavily blocked** is the spawn position**. A candidate
      position `(x, y)` is heavily blocked iff some living unit with collision
      radius `Ru` at `(ux, uy)` has `(x - ux)^2 + (y - uy)^2 < (R + Ru -
      floor(R / 2))^2`, `R` the new unit's collision radius: the circles
      overlap by more than half of `R` (rounded down). Lighter overlap does not
      refuse the entry, it resolves itself in step 5. With
      `m = 120 - collisionRadius` (no offsets other than `(0, 0)` if `m <= 0`),
      the offsets in the side's own frame are `(0, 0)`, `(0, m)`, `(-m, 0)`,
      `(m, 0)`, `(0, -m)`, `(-m, m)`, `(m, m)`, `(-m, -m)`, `(m, -m)` (own
      frame `+y` points at the enemy; for side 1 both components are negated,
      the arena rotation). If no cell has a free position the unit is **held**:
      nothing is spawned and `progress` (every counter) stays full and `cooldown`
      at 0, so step 2.1 takes nothing on later ticks until the unit can be
      placed. Only
      the cells next to the producer are tried, so a jam at the exit holds the
      unit rather than letting it appear farther away.
   3. **Several units per production (CB-13a; `unitsPerProduction = n`).**
      Step 2.2 spawns the `n` units one after another in the same tick, each
      by the whole procedure of 2.2 (the spawn cells, the offsets, the first
      free candidate), the units already placed by this production counting as
      living units, so the second unit takes the next free candidate. In
      detail, per producer and tick:
      a. If `held > 0`: go to d. with `held` as it is.
      b. Else the production starts only if `progress = costPerUnit` and
         `cooldown = 0` (as in 2.2); if not, nothing more happens.
      c. Find the spawn position of the first unit. If there is none the
         production does **not** start: nothing is spawned, `progress` stays
         full and `cooldown` stays 0, exactly as in 2.2 for one unit. If there
         is one: set `progress = 0` (every counter to 0), `cooldown =
         productionIntervalTicks` and `held = n`, and spawn the first unit
         there.
      d. While `held > 0`: find a spawn position; if there is none, stop.
         Otherwise spawn a unit there and subtract 1 from `held`. (When c.
         spawned the first unit, d. spawns the others in the same tick.)
      e. At the end `held` is stored (the field is omitted when it is 0).
      So a production is paid for and its cooldown starts when its first unit
      spawns; if there is room for fewer than `n`, the producer **holds the
      rest** and spawns them in later ticks as room appears, one after another
      and in the first tick with room, **before it starts taking items for
      the next production** (a producer with `held > 0` takes nothing, so its
      buffers fill and its conduits back up, as for one held unit, and it does
      not wait for the cooldown, which keeps counting down meanwhile). Each
      unit's strength percent (ramp, side option, point bonus, modifiers) is
      read at the moment **that** unit spawns, so a unit that waited has the
      bonus of its own tick. The held units of a producer that is destroyed
      are lost with it (the producer leaves `producers`). With `n = 1` the
      rules reduce exactly to 2.2: the unit spawns in the tick the production
      starts or not at all, and `held` is never stored.
      The need of such a producer (PP-6, PP-7, CB-43) is `floor(1000 * cost /
      interval)` with the cost of the whole production, in the flow dry run
      too (the pacer of "need" mode does not spawn, so `held` plays no part
      there).
      Notes for a port: keep `held` in the producer's saved arena state (it is
      an optional field: absent means 0, so a state without it restores as
      before); run a. to e. in this order for every producer in instance-ID
      order, with no early exit between the units of a production other than
      the missing spawn position; do not iterate a map to find the cells.
   4. A new unit has `attackCooldown = 0` and gets the next ID. It is placed
      immediately and takes part in this tick's decisions. (`inputBufferUnits`
      is smaller than some `costPerUnit` values, so the progress counter is
      what makes those producers work.)

   After all unit producers, the **burst units** leave their Cores (a state
   with no `bursts` option skips this), then the **scheduled waves** enter (see
   "Side options", `bursts` and `scheduledWaves`).
   Then, **turret charging**: for each living turret,
   side 0 first and each side in instance-ID order, if `charge < costPerShot`
   (the turret's tier), go through its inputs clockwise from north and, for
   each, take `min(input buffer count, costPerShot - charge)` items out of the
   buffer (`takeFromBuffer`) and add them to `charge`. A turret that is fully
   charged takes nothing, so an idle turret lets its buffer fill and its
   conduit back up (the source stalls) instead of draining the network.
   `charge` never exceeds `costPerShot`.

   Then, **ward charging**, after turret charging (a state without `wards`
   skips it): for each living Rune Ward, side 0 first and each side in
   instance-ID order, if `charge < costPerStrike` (the Ward's tier), take
   `min(input buffer count, costPerStrike - charge)` items out of its input
   buffer (`takeFromBuffer`) and add them to `charge`; `charge` never exceeds
   `costPerStrike`. A Ward that is full takes nothing, so an idle Ward lets
   its buffer fill and its conduit back up. A Ward with no conduit, or whose
   collector is starved, stays at `charge = 0`: it is **not working**.

   Then, **ramp charging**, after ward charging: for each living economy
   building, side 0 first and each side in instance-ID order, if `steps <
   maxSteps` (its tier), go through its inputs clockwise from north and, for
   each, take `min(input buffer count, costPerStep - charge)` items out of
   the buffer (`takeFromBuffer`) and add them to `charge`. If `charge =
   costPerStep` **and `cooldown = 0`** afterwards: `steps += 1`, `charge = 0`,
   `cooldown = stepIntervalTicks` (for an owner with an Alchemist
   `scaledInterval(stepIntervalTicks, P)`, "Specialists") and `ramp_step {side, building, effect,
   steps}` is recorded. Intake continues while the cooldown runs, up to
   `costPerStep`. So a building takes at most one step per
   `stepIntervalTicks` ticks. A building with `steps = maxSteps` takes nothing, so
   its buffer fills and its conduit backs up (the source stalls). Because the
   ramp is charged after unit production, a unit spawned in a tick sees the
   bonus as it was at the start of that tick's production step; a step taken
   in tick `T` first affects spawns from tick `T + 1`, and source resets from
   tick `T + 1` (the flow step of tick `T` ran before).
3. **Decide.** Using the state as it is now (a snapshot: no decision sees
   another unit's decision), every unit chooses one action. The choice is made
   in **three passes** over the units, each in `id` order; a pass reads the
   snapshot and the results of the EARLIER passes only, never a result of its
   own pass, so the outcome does not depend on the order of the unit list:
   pass 1 is rule a; pass 2 is rules a2 and b for the units that did not
   choose a; pass 3 is the movement (rule c, and the walk towards an aggro
   target) of the units that did not choose an attack. A unit **holds** iff
   pass 1 or 2 made it attack (a unit, or rule b); the set of holders is fixed
   after pass 2 (a unit that attacks a breach building in pass 3 does not
   count as a holder for the steering of the others, though it holds its own
   place). Distances between units are **centre to centre, Euclidean, compared as
   squared integers** (no square roots). Let `R` be the unit's `radius`, `reach`
   its definition's reach, `(px, py)` its centre and `c` its cell. Two units are
   **in contact** when `d^2 <= (reach + R + Re)^2` (`d^2` the squared centre
   distance, `Re` the other unit's `radius`): the gap between the two circles
   is at most `reach`. The **nearest** enemy unit in a set is the one with the
   smallest `d^2`, ties by lowest unit `id`.
   - **a. Attack a unit.** If any enemy unit is in contact, target the nearest.
     A **flying** enemy counts only for a **ranged** unit: a melee unit does not
     see it here, in a2, or anywhere else in the decision ("Ranged units and
     flyers"). Everything else is the same for ranged units, with their larger
     `reach`: the shot needs no line of sight, and a unit that attacks holds
     its place.
   - **a2. Aggro (CB-16).** Otherwise, the candidates are the enemy units with
     `d^2 <= (aggroRangeCells * 240)^2` (centre to centre) that are **visible**
     (a flying unit sees past solid cells: its line of sight is not tested) and
     that the unit can hit (a):
     with `n = max(1, ceil(max(|dx|, |dy|) / 120))` and `(dx, dy)` the vector
     to the enemy's centre, every sample point `(px + trunc(dx * k / n),
     py + trunc(dy * k / n))` (division rounded toward zero) for `k = 0 .. n` lies in a cell (of the unit's side frame) that is not solid
     for the unit's side (a cell-level line of sight; the line is not tested
     against the circles). The nearest candidate `E` is the aggro target, and
     the unit **moves** towards `E`'s centre `(ex, ey)`, ignoring the movement
     field: in pass 3 with the heading `H = (ex - px, ey - py)` and the
     steering of "Steering" (a unit on `E`'s centre moves to it directly). If
     there is no candidate the unit falls through to b.
     Why two units that move in the same ticks always meet: both close the
     distance each tick (up to their speed) and attack once in contact; blocked
     by other units they wait, never walk away.
   - **b. Attack a building.** Otherwise, if a living **enemy Core** is within
     reach, that is, `buildingDist2(px, py, building) <= (reach + R)^2` (the gap
     between the circle and the nearest point of the building's cells is at most
     `reach`), target it. Any enemy Core counts, not only the unit's target
     (CB-15c); with several in reach: the unit's target Core if it is one of
     them, else the one with the smallest `buildingDist2`, ties by `(|q -
     opposite(owner)|, -q)`. The unit's `target` does not change.
     **Pylons (MM-9d).** A Core with a standing pylon (a side option, "Side
     options") is **shielded** and is not a candidate: each of its standing
     pylons is one instead, with that Core's `q` in the key (so the unit's
     target Core's pylons come first, then by `buildingDist2`, then `(|q -
     opposite(owner)|, -q)`; between pylons of one Core with equal
     `buildingDist2` the first in the side options' order stays). The unit
     targets the pylon like a Core (`ACT_BUILDING` on its building; a pylon is
     an ordinary building for damage, health and destruction). A ranged unit
     therefore shoots a pylon in reach from where it stands, as it would the
     Core. Nothing aims at a shielded Core: a unit that did would stand in
     place (a holder) hitting nothing, and a whole wave could be held there
     by one corner of the Core.
   - **c0. Fly.** A flying unit that reaches c ignores the movement and breach
     fields: its heading is the vector to the centre of the cell of its target
     Core nearest to it (the same cell as in "Goals and movement fields", "at
     the Core"), steered as in "Steering" (only flying allies count as
     blockers), and it never breaches. With no enemy Core standing it waits.
     Its target Core is chosen by straight-line distance ("Ranged units and
     flyers"). Rules a and a2 do not test line of sight for a flyer (the
     attacker): it chases an enemy within the aggro range behind a wall or a
     lake, where a ground unit does not.
   - **c1. Divert to a point (CB-8f).** A unit of side 0 or 1 that reaches c
     (it attacks nothing and has no aggro target), in a battle whose state has
     `points`, first looks for a point to divert to: see "Points of interest".
     If it diverts, the rest of c (including c0) is replaced by the move
     described there: a unit that diverts never uses the Core fields in that
     tick.
   - **c. Move.** Otherwise the unit chooses a **heading** or a **target
     point** as follows (field details in "Goals and movement fields"); the
     move itself is resolved in step 5. Let `d` be the unit's cell's distance
     in the movement field (-1: none). A heading `H` becomes the target point
     `p + V` with `V` the result of the steering of "Steering" (so the unit
     walks in a direction, not at a place).
     - `d > 0`: the next cell `k` of `fieldStep` from `c`; the heading is
       `H = 240 * (k - c)` componentwise, that is, `(240 * (kx - cx), 240 *
       (ky - cy))` with the cell coordinates in arena terms (one of the eight
       directions, scaled to a cell). The unit does not aim at the centre of `k`.
     - `d = 0` (the cell shares an edge with the Core): the heading is the
       vector from the unit to the centre of the Core cell nearest to the
       unit (smallest `boxDist2`, ties by the order of the Core's cells; ties
       go to the first cell in the unit's own frame, i.e. side 1 reads the
       list from the end): `H = (240 bx + 120 - px, 240 by + 120 - py)`; if
       that is `(0, 0)` the unit does not move. The unit presses against the
       Core until rule b fires. (The Core is the unit's target Core; a unit
       with `target = -1` does not move.)
     - `d = -1` (sealed): follow the breach field. `bd = breach(c)`; if `bd < 0`
       the unit waits. If `bd = 0` the heading is as for `d = 0`. Otherwise `k
       = breachStep(c)`: if `k` is open for the side the target POINT is `k`'s
       centre (no steering); if `k` is covered by an enemy building `B`, then
       `B` is its **goal building**: when `buildingDist2(px, py, B) <= (reach +
       R)^2` the unit attacks `B` (like rule b, even though `B` is not the
       Core), otherwise the target is `k`'s centre (solid ground stops the
       unit at the building's face, where it is in reach).
   - **d. Wait.** No action (nothing to move towards).

   A unit that **attacks** this tick (it chose (a), (b), or, on a sealed
   board, attacks the building covering the next breach cell under (c)) holds
   position: it does not move this tick
   (even when its `attackCooldown` is above 0, in which case it also does not
   attack). A unit that chose to move but cannot get anywhere (blocked by other
   units or solid ground) simply ends the tick where step 5 leaves it.

   **Turret fire.** After every unit has decided (same snapshot), each living
   turret, side 0 first and each side in instance-ID order, with `cooldown = 0`
   and `charge = costPerShot`, looks for a target: an enemy unit whose **cell
   row**, taken **in the frame of the turret's owner** (side 0: `floor(py /
   240)`; side 1: `H - 1 - floor((240 H - py) / 240)`, "Unit geometry"), is
   inside the arena rows of the **turret owner's own board or the gap** (side 0: rows `0 .. h + gapRows - 1`; side 1: rows `h .. H - 1`; the
   enemy's board never qualifies (PP-13, CB-3j, CB-18a); so a unit with `py = 240 (h + gapRows)` exactly is on the enemy's first row for a side 0 turret, and one with `py = 240 h` exactly is on the enemy's last row for a side 1 turret, whatever its own side) and that is **in range**:
   `buildingDist2(px, py, turret) <= (rangeCells * 240 + R)^2` with `R` the
   unit's `radius` and `rangeCells` the turret tier's range, that is, the gap
   from the unit's circle to the nearest point of the turret's cells is at
   most `rangeCells` cells. **Blind spot (CB-18b):** a tier with `minRangeCells`
   ignores every unit with `buildingDist2(px, py, turret) < (minRangeCells *
   240)^2`, measured on the unit's centre (the radius `R` is not added: a unit is
   in the blind spot exactly when its centre is closer than `minRangeCells`
   cells to the nearest cell of the turret); a unit at exactly that distance is
   a valid target. Without the field there is no blind spot. The target is the in-range unit
   outside the blind spot with the smallest
   `buildingDist2`; ties by lowest unit `id`. A
   unit that is dying this tick or has already been chosen by another turret is
   still a valid target (no turret sees another's choice). If there is a
   target the turret fires: `charge` becomes 0, `cooldown` becomes
   `cooldownTicks`, the tier's `damage` (with the team's `turret_damage_percent`)
   reduced by the target's armor (`armorHit`) is added to the unit's pending
   damage, and `turret_fired` is recorded with that value (in this step, after all decisions, before
   the `unit_attacked` events of step 4). **Turret splash (CB-18b):** when the
   tier has `splashPercent` and `splashRadiusCells`, the same shot also hits
   every other unit of an enemy side of the turret's side (the other side and
   the neutral guards, exactly the set of unit splash, CB-8e) whose centre is
   within `splashRadiusCells * 240` of the **target's centre**
   (`dx*dx + dy*dy <= radius^2`, the grid search of unit splash, from the same
   snapshot: positions are those of the start of the tick, units spawned this
   tick included). Each such unit, in unit id order, takes `max(1,
   mulPct(damage, splashPercent))` where `damage` is the tier's damage with
   `turret_damage_percent` and **before** any armor (the order of CB-5h: damage,
   splash percent, then armor; there is no Overload on a turret), then reduced by its own
   armor (`armorHit`) and added to its pending damage, together with every
   other hit of the tick. Flyers are included, a unit that is dying this tick
   too, but never a building or a Core, and never a unit of the turret's own
   side. The `turret_fired` event then has `splash`, the list of `{unit,
   damage}` (damage after armor, unit id order, possibly empty); without turret
   splash the event has no `splash` field. _Notes for a port:_ the blind spot
   test uses the centre only while the maximum range adds the unit's radius; the
   splash is at least 1 (unit splash is skipped at 0); find the neighbours
   through the enemy sides' cell grids as for unit splash, never by scanning
   every unit; the splash reads the same `unitDamage` accumulation as the
   shot, so a unit hit by two turrets and a melee attack in one tick takes the
   saturating sum. A turret with no valid target keeps
   its charge and its (already 0) cooldown. A turret therefore never fires at
   a unit on the enemy's board, however close to the neutral zone the unit is
   (CB-18a); units in the neutral zone are targets (PP-13). Turrets do not otherwise affect movement: they are buildings, they
   block all units and have health.
4. **Resolve attacks simultaneously.** Every unit that chose (a) or (b) and has
   `attackCooldown = 0` deals its `damage` (the unit's own stored `damage`)
   escalated by Overload, `mulPct(damage, 100 + level * overloadDamageStepPercent)`
   (see "Overload"; **a neutral guard's hit is its plain `damage`**, no
   escalation), to its target; when the target is a unit, that hit is then
   reduced by the target's armor (`armorHit`, "Order of damage modifiers"), and
   the `unit_attacked` event carries the value actually dealt (after Overload
   and armor for a unit target; after Overload only for a building or Core).
   **Splash damage.** When the attacker's definition has `splash` and its
   target is a unit (not a building or a Core; turrets and buildings never
   splash), the target takes the hit as above, and then every other unit of the
   **opposing** side (the other side's units, ground or flying, and the neutral
   guards; for a guard attacker, the units of sides 0 and 1; the attacker's own
   side is never hurt) whose centre is
   within the radius takes `part = mulPct(hit, percent)`, where `hit` is the
   damage after Overload and before the primary target's armor. The test is
   exact, in integers on the centres: `dx*dx + dy*dy <= radiusSub*radiusSub`
   (a unit exactly `radiusSub` away is hit). A `part` of 0 is skipped (no hit,
   no entry); otherwise each secondary target's own armor applies,
   `armorHit(part, armor)`, and the result is added to that target's pending
   damage. Secondary targets are processed in unit `id` order. All hits of one
   attack, primary and secondary, are added in this same step to the
   same per-tick accumulation as all other damage, and nobody dies before the
   destruction step ("Resolution order"); a unit that is itself dying this tick
   may still be a primary or secondary target and still attack (simultaneous
   attacks). The attack is recorded as `unit_attacked` (the primary hit) and,
   straight after it, one `splash` event with the targets and the damage each
   took. The search uses the opposing side's cell grid and visits only the
   cells within `radiusSub` of the target's centre.
   **Rune Ward strike (issue #474, CB-53).** Straight after the
   `unit_attacked` of a hit on a **building that is a wall or a gate** (not
   on a Core, a unit, or any other building, and not a blocked hit on a
   shielded Core), in the order of the hits (unit `id` order), the attacker may
   take a strike back. The **candidate Wards** of the hit building are fixed at
   the start of the battle: the Rune Wards of the **same side and the same
   owner** (the placed building's `owner`) as the wall or gate that **share an
   edge** with it, that is, a cell of the Ward and a cell of the wall (any
   shape) or gate whose Manhattan distance in arena coordinates is exactly 1
   (a diagonal does not count), listed in Ward instance-ID order. A Ward of a
   partner or of any other side is never a candidate, so a Ward never touches
   a neighbour's wall or an enemy building. At the hit, the **first** candidate
   that is alive (not yet destroyed by step 6) and has `charge >=
   costPerStrike` strikes; **only that one** does (two Wards next to one wall
   never strike for the same hit). It spends the charge (`charge -=
   costPerStrike`), and the attacker takes `armorHit(reflectDamage, armor)`
   (the tier's `reflectDamage`, then the attacker's own armor, `max(1, ...)`),
   added to the attacker's pending damage in the same accumulation and the
   same tick as every other hit, with the Ward's side as the damage's source
   (it matters only for the kill counts of neutral guards). It is not scaled
   by Overload, modifiers or the specialist, and it is never itself
   struck back. A Ward with `charge < costPerStrike`, no candidate Ward, or a
   Ward destroyed earlier, does nothing. `ward_struck {side, building, wall,
   unit, damage}` is recorded right after the `unit_attacked` of the hit
   (`side` the Ward's side, `building` the Ward, `wall` the wall or gate,
   `unit` the attacker, `damage` after armor). The unit dies in step 6 like
   any unit if this takes it to 0, simultaneously with everything else of the
   tick. A side with `freePower` has its Wards charged like its turrets. _Notes
   for a port:_ the order is the unit order of step 4, and the charge is spent
   in that order, so with a charge of one two attackers in the same tick are
   not both struck: the one with the lower unit `id` is. Build the candidate
   lists once, never by scanning cells during the battle.
   Damage from all
   attackers, from turret shots and from Ward strikes, is summed per target with the saturating
   rule of "Integer math conventions" (`addSaturating(sum, hit,
   MAX_TICK_DAMAGE)`: each hit is at most `MAX_HIT = 2^51`, a sum below the
   cap `2^52` is exact, and a larger one is `2^52`) and applied together
   (so two units can kill each other in the same tick; a target that is killed
   this tick still receives every blow aimed at it). Each attacker's `attackCooldown` becomes
   its `attackCooldownTicks` (the unit's own stored value if it has one, else
   the definition's, issue #424). A building's health stops at 0 (a Core's health
   value after all damage of the tick, which may be negative, is also kept for
   the tiebreak, see "Battles"). **Building damage dealt:** for each building
   (a Core too) that took unit attacks this tick, let `A` be the saturating
   sum of those attack hits on it (Overload Core decay is not part of `A`) and
   `h` its health before this tick; side `1 - owner` gets `min(A, h)` added to
   its `buildingDamageDealt` with `addInt`. Decay and any damage beyond the
   building's remaining health (overkill) are never counted. (Turret shots
   only hit units, so they add nothing.) Events
   (`unit_attacked`) are recorded in unit-`id` order. **Core decay**: on an
   Overload beat, each _living_ Core (side 0, then side 1) takes `level *
   overloadCoreDamageStep` damage, added to the damage of this step (so it is
   applied together with the unit attacks) and recorded as
   `overload_core_damage {side, core, damage}` after the `unit_attacked` events, for **every** living Core in the order side 0 then side 1, ascending player index (each takes the full amount; a destroyed Core takes nothing). A
   Core that is already destroyed takes nothing and records nothing.
   **Shield (MM-9d, "Pylons"; only a side with the `pylons` option).** A Core
   is **shielded** while at least one pylon of its player index is alive at the
   start of the step (a pylon is alive until step 6 destroys it, so a pylon
   brought to 0 by this tick's damage still shields the tick it falls). A hit
   by a unit on a shielded Core adds nothing to the Core's damage (neither to
   `buildingDamage`, nor to `A`, so nothing to `buildingDamageDealt`); the
   `unit_attacked` event is still recorded and is followed by `core_hit_blocked
   {unit, side, core, damage}`. The **Overload decay is not blocked** (see
   "Overload"). The shipped decision rules never choose a shielded Core (rule
   b), so the blocked hit is a safety net for any other way a unit's attack
   could land on one; it is part of the rules so a port that adds such a way
   keeps the shield. Pylons are damaged like any building (unit attacks only:
   turrets shoot units).
   **Linked Cores (MM-9d; only a side with the `linkedCores` option).** The
   Cores of such a side take no damage themselves: all damage to any of them
   goes to the side's shared pool, once. For each such side, the damage of
   the tick on its Cores is gathered in player order: `D` is the saturating
   sum (`addDamage`, cap `2^52`) of the per-Core sums of this step (unit
   attacks and the Overload decay) and `A` the saturating sum of the attack
   hits alone. Hits on different Cores in the same tick therefore add up. The
   Overload decay is **not** applied per Core: on an Overload beat the
   decay amount is added once, to the lowest living Core of the side (the
   other side's Cores still take it each), and one `overload_core_damage` is
   recorded for it, naming that Core. Then, instead of the per-Core
   application: the side with the pool `h` before this tick has `A' = min(A,
   h)` added to the other side's `buildingDamageDealt` (the same rule as for
   a building, the pool being the building), `remaining = h - D` (unclamped)
   and `pool = max(0, remaining)`. If the pool is now 0, every living Core of
   the side gets `hp = 0` in this step, in player order, and its `remaining`
   is `remaining` of the pool for the first of them (the lowest player index
   that was alive) and 0 for the others; step 6 then destroys them all in the
   usual way (so all fall in one tick, `core_destroyed` in Core order, and
   each fall tick is the current tick). While the pool is above 0 the Cores'
   own `hp` and `remaining` stay at their starting value. Events: the
   `unit_attacked` of a hit on a Core of such a side, and its
   `overload_core_damage`, carry the extra field `pool`: the pool's value at
   the start of the tick (before any damage of the tick; hits of one tick all
   show the same value). The field is absent for a side without the option.
   A Core burst (below) is not used together with the pool (the loader
   rejects the combination).
   **Core bursts (MM-9d; only a side with the `bursts` option).** After all
   damage of the tick has been applied to the Cores (unit attacks, Overload
   decay, and for the party's Cores everything else), for each Core of that
   side that has bursts, in ascending player index, and for each of its
   thresholds `t` in descending order: let `starting` be that Core's starting
   health (its `coreHealths` entry) and `line = floor(starting * t / 100)`
   (integer division of the exact product; `starting * t` is below 2^53 since
   `starting <= MAX_HEALTH` and `t <= 99`). The threshold **fires** iff the
   Core's health before this tick's damage was **above** `line` and its health
   after it (not below 0) is **at or below** `line`. So a hit that crosses
   several lines fires each of them in this one step, highest threshold first,
   and a Core brought to 0 fires every threshold it was still above (every
   threshold not fired before, since health only ever falls); a threshold
   fires at most once, and a Core that starts at or below a line never fires
   it. A firing appends the burst's units to the side's `bursting` queue, in
   the profile's order (the composition order: entry `i` of the burst, its
   `count` units one after the other) and records `burst_released {side,
   core, thresholdPercent, units: [{unit, count}]}` (one event per Core and
   threshold, in the order they fired). Nothing spawns in this tick: the
   queue is walked in the Production step of the **next** tick (a step taken
   in a tick takes effect from the next tick). The event comes before the
   `core_destroyed` event of step 6 when the same hit destroys the Core.

   **Healing (CB-8g, last part of step 4).** After all damage of the step is
   applied (units, buildings, Cores), a battle whose state has `points` runs
   the heal beat of its `heal` points: see "Points of interest", "Buffs". It
   comes before the removal of the dead in step 6, so a unit brought to 0
   health this tick is not healed back, and before the moves of step 5, so
   the unit's centre is where it fought.
5. **Move and separate** (soft collision, issue #82). Every unit keeps its
   decision from step 3; the units that were killed in step 4 still move
   (decisions were simultaneous). The step works on arrays indexed by position
   in the unit list (ascending `id`) and has no other input than the state and
   the decisions, so it cannot depend on earlier ticks. Neighbour searches may
   use any grid; the rules only say which pairs are compared. **Nothing here
   depends on the order of the unit list**: every push is an integer computed
   from the positions at the start of the pass and the pushes are summed.
   Let `P = separationPercent` (`sim.json`, 75; 0 to 100) and `C =
   separationCap` (`sim.json`, 40; 0 to 480). Write `settle(X, Y; F)` for the
   **settling** of a circle of the unit's collision radius `R` and side at
   `(X, Y)` with the fallback position `F` (defined below), and `ceilDiv(a, b)
   = floor((a + b - 1) / b)` for `a >= 0`, `b > 0`.
   1. **Classes.** A unit is a **fighter** iff its action in step 3 is an
      attack: it attacks a unit (a), the Core or goal building (b), or, on a
      sealed board, the building covering the next breach cell (the attack
      of rule c: "the unit attacks B (like rule b ...)"). A unit that chose to
      move (c) without attacking and has a non-zero step `v` (below) is a
      **mover**. Every other unit (it chose d, or to move with `v = (0, 0)`)
      is **idle** (waiting).
   2. **Desire.** A unit that chose to move has a target `(tx, ty)`, a speed
      `s = floor(240 / moveCooldownTicks)` (the unit's own stored
      `moveCooldownTicks` if it has one, else the definition's) and `(dx, dy) = (tx - px, ty - py)`.
      If `dx^2 + dy^2 <= s^2` the step is `v = (dx, dy)`; otherwise, with
      `L = isqrtCeil(dx^2 + dy^2)`, `v = (truncDiv(dx * s, L), truncDiv(dy * s,
      L))` (length at most `s`). The tentative position `T` of a mover is
      `settle(p + v; p)`; of every other unit `T = p`. (`p` fits, see the
      invariant, so every `T` fits.)
   3. **The push pass.** Consider every unordered pair of units `{i, j}` whose
      collision circles overlap at their tentative positions, `d^2 < R^2`
      with `(dx, dy) = T_i - T_j`, `d^2 = dx^2 + dy^2` and `R = Ri + Rj`
      (collision radii). Each pair is handled once, with these steps:
      1. **Weights** `(wi, wj)`, how the push is split (a unit takes
         `w / (wi + wj)` of it). Units of **different sides**: a fighter has
         weight 0 and any other unit weight 1, except that two fighters of
         different sides both have weight 1 (so an enemy mover or idle unit
         gives way to a fighter completely, two enemy fighters share the push
         equally and a pair that was pressed together separates, issue #103,
         and any other enemy pair shares equally). Units of the **same side** (allies): the
         weight of the unit against the other is
         `ALLY_WEIGHT[class of the unit][class of the other]` with rows and
         columns in the order idle, mover, fighter:

         | unit \ other | idle | mover | fighter |
         | ------------ | ---- | ----- | ------- |
         | idle         | 1    | 1     | 1       |
         | mover        | 0    | 1     | 2       |
         | fighter      | 0    | 1     | 1       |

         So a waiting ally gives way completely to a moving or fighting ally
         (it is no wall); a mover and a fighter split the push 2 : 1, the
         fighter taking the reduced share; two units of one class share
         equally. If `wi + wj = 0` the pair is skipped. **Exception:** two
         allied fighters (weights 1 and 1) each take the **whole** total
         instead of half, that is, the divisor `wi + wj` below is replaced by
         1 for such a pair (so fighters at a target are not crushed together
         by allied movers behind them). Call the divisor `W` (`W = wi + wj`,
         or 1 in that case).
      2. **Amount.** `d = isqrtFloor(d^2)` (0 when the centres coincide),
         `o = R - d` (at least 1) and `total = min(C, ceilDiv(o * P, 100))`.
         If `total = 0` the pair is skipped.
      3. **Push.** With `d >= 1`, unit `i` is pushed by `(awayDiv(dx * total *
         wi, d * W), awayDiv(dy * total * wi, d * W))` (away from `j`) and
         unit `j` by `(awayDiv(-dx * total * wj, d * W), awayDiv(-dy * total *
         wj, d * W))` (away from `i`).
         (`awayDiv` rounds away from zero, so a unit that takes a non-zero
         share of a non-zero push moves at least 1 on each axis along which
         the centres differ.)
      4. **Coinciding centres** (`d = 0`): unit `u` is pushed along **both**
         axes by the same amount, `sign(u) * awayDiv(total * w_u, W)` added to
         its `x` and to its `y` (so a wall in the way of one axis cannot hold
         a coincident pair together). `sign(u)` is `+1` or `-1` **in arena
         coordinates**: for two units of one side, `f` if `u` has the higher
         `id` and `-f` if the lower, where `f = +1` for side 0 and `-1` for
         side 1 (the frame of side 1 is the arena rotated by half a turn,
         both axes negated); for two units of different sides, `f` whatever
         the ids (side 0 goes up, side 1 down). Only the ids and the sides
         decide, so a mirrored battle stays symmetric.
      All pushes are **summed per unit** (`push_u`, integers) from the
      tentative positions; no pair sees the pushes of another pair.
   4. **Apply and push out of solid ground.** The new position of a unit is
      `T` if its summed push is `(0, 0)`, else `settle(T + push; T)`. The new
      `px, py` are stored. There is no event for movement (see Events).

   **Settling** `settle(X, Y; F)` for a circle of radius `R` and a side: if the
   circle **fits** at `(X, Y)` (see "Unit geometry") the result is `(X, Y)`.
   Otherwise apply `pushOutSolid` (see "Unit geometry") to `(X, Y)` and, as
   soon as the circle fits at the result, stop and return it; at most 4
   sweeps in all (each starts from the result of the one before). If no sweep
   ended where the circle fits, the result is the fallback `F`. Because the
   result fits whenever `F` does, **applying `settle` to its own result
   changes nothing** (idempotent): this is why a unit with a zero push needs no
   special case. Units may therefore end the tick overlapping each other
   (temporarily, see "Decided simplifications"), but never inside solid
   ground or outside the arena.
6. **Deaths and destruction.**
   - Units with `hp <= 0` are removed in `id` order (`unit_died`).
   - Then, side 0 then side 1, in the order of the `health` list (Core first,
     then instance ID ascending), every still-present building with health 0 is
     destroyed: `building_destroyed` (or `core_destroyed` for a Core); it is
     removed from the arena; for a building (not a Core), every conduit
     attached to it, "up to the next building" (CB-9a), and the other half of
     every border link (PP-4) that loses a half, is removed, each
     recorded as `conduit_destroyed` in conduit-ID order; it is dropped from its
     side's team state, producer list, turret list and flow plan (see
     Mid-battle removal),
     so items in its conduits or held by it are lost and buildings downstream
     simply stop receiving. A destroyed economy building also leaves
     `ramps`, so its contribution leaves the side's bonus total at once. A
     destroyed Core is only recorded: the Core's
     cells become open (`stepArena` itself never ends a battle and stays safe
     to call, and Core decay skips a destroyed Core; the battle-end rule is
     checked after the tick by the code in "Battles"). Any number of Cores of both sides can fall in
     the same tick.
   - A destroyed **pylon** (MM-9d) is destroyed like any building
     (`building_destroyed`); right after it, `pylon_destroyed {side, building,
     core, standing}` is recorded, `standing` being the pylons of that Core
     still alive after this step's destruction (all the tick's destroyed
     buildings are removed in health-list order, so a second pylon falling in
     the same tick sees the first as gone), and when `standing` is 0 also
     `core_shield_down {side, core}`: from the next tick on the Core takes
     hits, and its units' goal set is the Core again (the fields are dropped
     below).
   - After any destruction every cached movement field and breach field is
     dropped. Then, at the end of this step, every living unit, in unit-`id`
     order, whose target Core now has health 0 gets `target =
     chooseTarget(owner, c)` (PP-11, "Goals and movement fields"), `c` the
     cell that holds its centre, and `unit_retargeted {unit, target}` is
     recorded after the destruction events. A unit changes its target at no
     other time after it spawned.
   - **Capture step (CB-8f).** Last in step 6, after the retargeting, from the
     units alive now: for each point in `id` order the capture progress of
     "Points of interest" ("Capture step") is updated and `point_capture_started`
     / `point_captured` are recorded, then the held ticks are counted. Only a
     battle whose state has `points` has this step.
7. **Cooldowns.** Each living turret's, unit producer's and economy
   building's non-zero `cooldown` and each surviving
   unit's non-zero `attackCooldown` decreases by 1. Then
   `tick` increases by 1. (Because the
   decrease also applies to the tick of the action, a turret that fires in tick
   `t` with `cooldownTicks = 8` may fire again in tick `t + 8`, and a unit with
   `attackCooldownTicks = 10` that attacked in tick `t` attacks again in tick
   `t + 10`. A unit producer that makes a unit in tick `t` with a
   `productionIntervalTicks` of `k` can make the next in tick `t + k`, and an
   economy building steps again after `stepIntervalTicks` the same way.)

#### Top speed, need and store

Every consumer has a top speed: one production per minimum time between
productions (a unit per `productionIntervalTicks`, a shot per `cooldownTicks`,
a step per `stepIntervalTicks`; integers of at least 1). Walls, gates, route
buildings and the Core have no inputs and consume nothing (CB-10c).

- **Top speed.** A fully fed building makes one production every interval,
  never more; supply beyond it backs up (see "Splitting with back-up").
- **Need.** `needPer1000 = floor(1000 * cost / interval)` items per 1000
  ticks (helper `needPer1000(building, tier)`; 0 for a building that consumes
  nothing). Screens show items per second with two decimals, rounded down:
  `floor(100 * cost * ticksPerSecond / interval)` hundredths
  (`needHundredthsPerSecond`). For a two-input consumer (CB-5e) `cost` in
  these two formulas is the sum of its costs (a combined figure for screens),
  and each resource has its own need `floor(1000 * cost_r / interval)` (helper
  `needPer1000By`, sorted by resource ID): 50 / 71 / 100 per resource for the
  Foundry at tiers 1 / 2 / 3. A turret has this need only while it fires: a
  charged, idle turret takes nothing; an economy building at `maxSteps` takes
  nothing.
- **Under-supplied buildings wait** (CB-10d): `progress` or `charge` keeps
  what has arrived and the production happens when the full cost is there (for
  a two-input consumer, when every resource's counter is full: a Foundry with
  Ore and no Power never produces). It
  is a full production (same unit, same shot, same step); nothing is produced
  at reduced strength and no building switches off.
- **Store** (CB-10b). A building holds at most `cost` in `progress` or
  `charge`, plus `inputBufferUnits` in each input buffer. When both are full
  it refuses items ("Accepting"), its conduit fills and the flow backs up. A
  two-input consumer holds at most `cost_r` per resource: when the counter of
  one resource and its input buffer are full, that resource's conduit backs up
  even while the other resource is still arriving.
- **Cold start** (CB-11): `progress`, `charge`, `cooldown` and every buffer
  are 0 at tick 0 of every battle.

### Goals and movement fields

**Every unit heads for its target Core** (issue #66: there is no other
target preference; a unit never goes for sources, routes or defenses). A
unit's `target` is the Core of the plot opposite its owner's plot while that
Core stands, then the nearest remaining enemy Core (PP-11, below; with one
Core per side it is always that one). The unit fights the enemy units it meets
(rules a and a2) and attacks a building only when that building is an enemy
Core within reach, target or not (rule b, CB-15c), or blocks the way (the
breach rule below). In this section "the Core" means the unit's target Core
and "the movement field" and "the breach field" the fields of that Core,
except where rule b says otherwise.

- The **goal set** of a unit is its target Core. A destroyed Core is not a
  goal; with no goal (`target = -1`) the unit waits. The goal building is the
  Core. **Pylons (MM-9d).** While the target Core is shielded, that is while
  at least one pylon of that Core's player index (the side options' `pylons`,
  see "Side options") is alive, the goal set is **its standing pylons**
  instead, all of them (in the order of the side options), and the Core itself
  is not a goal: this is the one place the unit's target is read through the
  shield (PP-11's `chooseTarget` still returns the Core's player index;
  `goalBuildings(arena, side, core)` is what changes). The movement field of
  that Core is then the field towards the nearest pylon (a distance 0 cell is
  an open cell sharing an edge with any standing pylon), so "the nearest
  standing pylon by the movement field, then the tie key" is `fieldStep`'s
  ordinary choice; when the last pylon is destroyed the fields are dropped
  with every destruction and the goal set is the Core again. A Core that is
  not shielded, and every ordinary battle (no pylons), behave exactly as
  before.
- Which buildings block which side's units is one predicate (`blocksUnit`): a
  living building blocks the units of both sides, **except** that a gate
  (`defenseType` `gate`) does not block the units of its own side. A cell is
  **open for a side** if it is not blocked (terrain or blocked gap cell) and
  not covered by a building that blocks that side. Everything that asks "may
  this unit be here" uses it: the movement fields, the breach field (open
  cells cost 1, so an owner's gate costs 1 to the owner and is a costly
  enemy building to the enemy), spawn cells, the solid cells of "Unit geometry"
  and the aggro line of sight, and `spawnUnitForTest`. So a gate is open ground for its owner (units walk
  through it and stand on it; a producer may spawn a unit onto it) and a
  blocking building for the enemy, which can attack and breach it like a wall.
  A gate is a building of kind `defense`; it is never a goal, and an enemy
  unit attacks it only as a breach building (below), like a wall.
  When a gate is destroyed it is removed like any building and is open ground
  for everyone. Walls and turrets block both sides.
- The **movement field** of a side and an enemy Core (one per side and per
  living enemy Core, `computeField(arena, side, core)`; the goal is that Core)
  is a least-cost map over open cells (cells, not positions: the
  fields do not know about radii or other units, and they do not depend on
  where the crowds are; routing around crowds is deferred, issue #86).
  There are **eight directions**: a straight step (north, east, south, west)
  costs `STEP_COST = 10` and a diagonal step costs `DIAGONAL_COST = 14`. A
  diagonal step from `(x, y)` by `(dx, dy)` is allowed only if BOTH cells it
  passes, `(x + dx, y)` and `(x, y + dy)`, are open for the side (**no cutting
  corners** through solid cells), besides the target cell itself being open.
  Distance 0 for every open cell that shares an EDGE with a cell of the Core
  (the 4-neighbours of the Core cells, on every free side; a cell that only
  touches a Core corner is not a goal, so a base whose edge cells are walled
  is sealed even when a corner cell is open); the distance of any other open
  cell is the least total step cost to a distance 0 cell (Dijkstra; the values
  are exact and do not depend on the order cells are processed in). Unreached
  cells have no distance. A unit whose cell has a finite distance `d > 0`
  takes the step `fieldStep`: among the open neighbours `n` (8 directions, a
  diagonal only if allowed as above) with `dist(n) < d`, the one with the
  smallest `dist(n) + cost` (10 for a straight, 14 for a diagonal step), ties
  by the tie key; its heading is the direction to that cell (see rule c); with
  `d = 0` it is next to the Core and presses towards the nearest Core cell
  (rule c, `d = 0`). **Approximation:** the field treats every one-cell gap as
  passable. That is right for every shipped unit (all collision radii are below
  half a cell: the Golem's is 80 of 120); a unit whose collision diameter exceeds one cell is routed
  through gaps it cannot enter and waits at them (the circle rules, not the
  field, stop it).
- The unit's **goal building** (rule b) is any living enemy Core when the gap
  from the unit's circle to the Core's nearest cell is at most `reach`, the
  target Core first (step 3b). A Core shielded by pylons (MM-9d) is not a goal
  building: each of its standing pylons stands in its place with the Core's
  key (the same target-first rule, the same distance comparison; among the
  pylons of one Core the smaller gap first, then the earlier in the side
  options' order), so a ranged unit shoots a pylon in reach like any goal and
  no unit attacks a shielded Core (it would only stand there: see "Units,
  combat and destruction").
- **Tie key.** Wherever two cells tie (equal score in `fieldStep`, equal
  cost in `breachStep`, equal distance among spawn cells), the preferred one
  is the most **forward** one, then the lowest `x`, **in the board frame of
  the unit's own side**. With `(ox, oy)` the cell in that frame (side 0: `(x,
  y)`; side 1: `(W - 1 - x, H - 1 - y)`, with `W`, `H` the arena width and
  height in cells) the key is `(H - 1 - oy) * W + ox` and the SMALLER key is
  preferred: a larger own-frame `y` (towards the enemy) first, then a smaller
  own-frame `x`. (Before issue #82 part 2 the key was `oy * W + ox`, which
  sent units sideways before forward and let a wide wave slide along its row
  to the Core's column and advance in single file.) Using the own frame is
  what keeps a mirrored battle exactly symmetric.
- **No sealed bases (CB-20).** If the unit's cell has no distance in its
  movement field (every route to the Core is blocked) and the Core is not
  within `reach` (rule b is evaluated first, whether or not the cell has a
  distance: a unit in a sealed pocket attacks the Core if it is in its reach),
  it uses the **breach field** of its side. This is a least-cost map (Dijkstra, integer costs)
  towards the target Core. Passable cells are open cells and cells covered by
  an enemy building other than the target Core (an enemy Core that is not the
  target is passable and costs like any building); terrain, the unit's own
  side's blocking buildings and the target Core's own cells are impassable.
  **Pylons (MM-9d):** while the target Core is shielded the breach field's
  distance 0 cells are the passable cells 4-adjacent to any standing pylon (the
  goal set), and neither a pylon of the goal set nor the shielded Core is ever
  entered. Entering an open cell
  costs 1; entering a cell covered by an enemy building costs
  `breachBaseCost + ceil(maxHealth / breachHealthPerCost)` (at most 1.000001e12: see
  "Content bounds" for why every distance stays exact), where `maxHealth` is
  that building's **maximum** health (the tier's health from the content, or
  the `coreHealths` entry, raised by the team's health modifiers, see "Content
  bounds": the health it starts the battle with), never its current health (`content/sim.json`:
  10 and 10). The
  distance of a cell is the cheapest total cost of the cells entered on the way
  from it to a passable cell 4-adjacent to the Core (distance 0). A unit in
  breach mode takes the neighbour that minimises (cost of entering it +
  its distance), ties by tie key. If that cell is open, it heads for its
  centre; if it is covered by an enemy building, that building is
  its goal building and it attacks it as soon as it is within `reach`, heading
  for the building's cell until then (step 3c); at distance 0 its goal building
  is the Core. With no breach
  distance either, the unit waits. When a breach opens a real path the normal
  field takes over (fields are dropped after every destruction).
- Fields are computed lazily, cached per side and enemy Core (and per side and
  enemy Core for the breach field), and dropped whenever a building is destroyed (the per-side
  solid-cell grids of "Unit geometry" are rebuilt at the same moment). They never
  depend on unit positions. The breach field and the breach step (the choice
  of the next cell) use maximum health only, so a damaged building is no
  cheaper to breach than a healthy one, and both depend only on which
  buildings are alive: the cache is invisible. Because of this a saved state
  restored at any tick (the context is rebuilt from the state alone) continues
  exactly like the original. (An implementation must not use current health
  here: it would make results depend on when a field was first computed.)

### Steering

How a heading `H = (hx, hy)` (an integer vector, not `(0, 0)`; its length is
the distance of the aim point) becomes the target point `p + V` of a mover
`p = (px, py)` in pass 3 of step 3 (rule c, and the walk towards an aggro
target). The vector `V` is `H` itself unless an ally is in the way, in which
case the unit steps around it. Step 5 then moves the unit towards `p + V` as
for any target (a step of at most its speed `s` along `V`, so only the
direction of `V` matters when `|V| >= s`; the heading of the field step has
length 240 or 339, above every speed).

Let `rc = Ri + Rj` be the sum of the two collision radii, `r = (rx, ry) =
(Qx - px, Qy - py)` the vector from the unit `i` to another unit `j` at
`Q`, `d = rx^2 + ry^2`, `dot = rx * hx + ry * hy`, `cross = rx * hy - ry *
hx` and `L2 = hx^2 + hy^2`. A unit `j` of the SAME side (`j != i`) is a
**blocker** iff

- `d < lim`, with `lim = 4 * rc^2` if `j` holds (it attacks, pass 1 or 2) and
  `lim = rc^2` if it does not (its collision circle already overlaps ours: it
  stands in the way and the push pass is pressing the two together), and
- it is ahead and in the lane: `dot > 0`, `dot < L2` and `cross^2 <= rc^2 *
  L2` (the line from `p` along `H` passes within `rc` of `j`'s centre, the
  distance of `j` from the line being `|cross| / sqrt(L2)`).

The candidates are exactly the units of the side that satisfy the two
conditions; an implementation may find them with any search that covers all
units with `d < 4 * rc^2`. Such units lie within `4 * maxRadius` of `p`
(`maxRadius`: the largest collision radius among the unit types), and the
reference visits the cells that contain the square of that half-width around
the unit. (A window of fixed cell size around the unit's own cell would make
the candidate set depend on how the grid is aligned, and so break half-turn
symmetry.) The **chosen blocker** is the one with the smallest `d`; ties: the larger `cross`;
then the lower unit `id`. If there is none, `V = H`.

Otherwise let `sigma` be `+1` if `cross > 0` and `-1` if `cross < 0` (the
unit goes to the side AWAY from the blocker), and for `cross = 0` (the
blocker exactly on the line) with `f = +1` for side 0 and `-1` for side 1:
if `hy != 0`, `sigma = +1` if `-hy * f > 0` else `-1`; if `hy = 0`, `sigma =
+1` if `hx * f > 0` else `-1` (towards the positive `x` of the unit's own
frame, then the positive `y`). Then

    V = (hx - sigma * hy, hy + sigma * hx)

that is, `H` turned by 45 degrees towards the chosen side and made `sqrt(2)`
longer (`V = H + sigma * perp(H)`, `perp(hx, hy) = (-hy, hx)`). There is no
state: the next tick evaluates the rule again from the new positions, so a
unit that has stepped aside far enough (the lane no longer touches the
blocker) goes straight again. A rotation of the whole picture by half a turn
maps `H`, `r` and `V` to their negatives, leaves `cross` unchanged, and the
rule for `cross = 0` uses the unit's own frame, so a mirrored battle stays
exactly symmetric. Walls correct any drift: a unit that is pushed into solid
ground is pushed out by the settling of step 5.

Why this and not "retarget to a free enemy": the rule is local, needs no
memory (a restored battle behaves the same) and does not change who a unit
fights, only the way it takes to reach that enemy, so followers reach a
target the first unit is already fighting instead of queueing behind it.

**Measured effect (issue #82, part 2).** Exact mirror matches are not a
realistic case, so the quality of the pathing is measured on varied, unequal
boards (`packages/tools/src/sim/varied.ts`; `pnpm exec tsx
packages/tools/src/sim/varied-report.ts --dense --matched --party 1,2,4
--seeds 1,2,3 --rounds 4,8,12` prints the table; `varied.test.ts` pins a
small set): factories the scripted bot builds with four strategies, three
seeds and three rounds, dense factories of mixed tier and gaps, and evenly
matched full factories whose Cores sit in different places; 432 battles in
all, before the change in brackets. Battles ended by a destroyed Core: 96.3
percent [96.3] (bot boards 95.4 [96.3], dense 100 [100], matched 98.1 [92.6];
the 128 reference-board battles of the benchmark: 79 [62.5] percent, the
tiebreak-by-kills ones fell from 16 to 1). Mean battle length 722 [712] ticks
(matched factories 1300 [1080]: they fight longer instead of stalling).
**Front width**, sampled every 10 ticks over the units that have left their
own board: 47.8 [38.4] such units stand in 17.3 [5.4] distinct columns, 0.36
[0.14] columns per unit (a conga line is about 0.1); at first contact the
leading band (8 cells deep) of a side spans 11.4 [7.0] columns.

### In-battle ramp (economy buildings)

"Economy" means buildings that make the factory stronger the longer a battle
lasts (SC-8 to SC-10); it has nothing to do with gold. Each is a building of
kind `economy` with `effect.type` `source_speed` or `unit_strength` and, per
tier, `costPerStep`, `stepPercent` and `maxSteps`. Its battle state is the
`ramps` entry `{side, building, charge, steps, cooldown}` (the owner is read from the team state; all 0 at the start of every
battle: the state is built from the team state and `sim.json` only, so no
upgrade carries from one battle to the next, CB-11). Charging, and the
`cooldown` of `stepIntervalTicks` between two steps, are described in "One
battle tick", step 2.

**Totals and caps (PP-8).** Economy buildings help only their owner. For a
side, an **owner** (player index) and an effect, the _raw total_ is the sum, over
that owner's **living** economy buildings on that side with that effect, of
`steps * stepPercent` (the building's tier value). Buildings of a partner add
nothing. The owner's **bonus** `P` is the raw total capped, each owner on their
own (`rampBonus(sim, ctx, side, effect, owner)`): `P = min(raw, cap)` with `cap = maxSourceSpeedPercent` for
`source_speed` and `maxUnitStrengthPercent` for `unit_strength` (25 and 100
since the rebalance, issue #145). The total is recomputed whenever it is read. A building leaves
the sum the moment it is destroyed (destroying ramp buildings weakens the enemy's ramp for the rest of the battle);
what it already did stays: running source countdowns and units already
spawned keep their values. Each building is also limited by its own
`maxSteps`, so the ramp has two limits: per building and per owner and effect.
A unit of a scheduled PvE wave has no producer and so **no ramp bonus** (owner
decision, issue #175): it gets only the side-wide `unitStrengthPercent`, run
modifiers and the side's point bonus (CB-8g); pinned by a test in `ramp.test.ts`.

**`source_speed`.** Before each tick's flow step the arena sets the board's
source interval modifiers to one value per player index: each owner's
`source_speed` bonus (the capped ramp total, in which the owner's Flowmancer
bonus is part of the raw total before the cap: `min(cap, raw + specialist)`,
issue #471, "Specialists"). A source whose countdown is reset after producing uses the
bonus `P` of its owner, so a player's Overclocker leaves a partner's collectors
unchanged: `max(1, floor(intervalTicks * 100 /
(100 + P)))` (integer division rounds down; at least 1, so at most one item
per tick). With the maximum 25 a tier 1 extractor (20) drops to 16, a tier 2
(14) to 11 and a tier 3 (10) to 8. The first countdown of a battle and any countdown already running
are not changed when the bonus changes, only the next reset sees it.

**Points of interest (CB-8g).** A side also has a **point bonus**: the
`strengthPercent` of every `unit_strength` point it holds, summed and capped at
`maxPointStrengthPercent` (40), see "Points of interest", "Buffs". It is the
side's, not a player's: every unit the side spawns while it holds the points
gets it, units of every player and units of a scheduled wave alike. It is
**outside** `maxUnitStrengthPercent`: the capped Armory bonus and the point bonus
add, so a player at the Armory cap still gains from a point.

**`unit_strength`.** A unit spawned by a unit producer (or placed with
`spawnUnitForTest` and an `owner`) while its producer's owner has the bonus `P`
gets `hp = mulPct(base health, 100 + P)` and `damage =
mulPct(base damage, 100 + P)`, each rounded down (for example, soldier health
40 at 4 percent: 41 (41.6); damage 6 at 4 percent: 6 (6.24)). The damage is
stored in the unit; later steps and later destruction of the building do not
change units already on the field. The Overload escalation (below) is applied
on top of the stored damage when it hits.

**Why it can be outgrown.** Both limits are fixed by content, steps cost
resources that could have gone elsewhere (for example a second barracks), and
Overload (below) caps how long a battle can last, so an opponent that scales
exponentially can overtake a capped ramp.

### Overload (CB-12)

Overload guarantees that battles end. Constants (`content/sim.json`):
`overloadStartTick` (1800, three minutes at 10 ticks a second), `overloadIntervalTicks` (100),
`overloadDamageStepPercent` (20), `overloadCoreDamageStep` (5).

- **Level.** `level = 0` for `T < overloadStartTick`, and from then on `level =
  1 + floor((T - overloadStartTick) / overloadIntervalTicks)`. The level is a
  function of the tick; the state holds nothing for it, so a restored battle
  continues identically. `overload_started` is recorded on the tick the level
  becomes 1 and `overload_level {level}` on every tick the level rises
  (including level 1, together with `overload_started`, which comes first).
- **Damage escalation.** Every unit's attack damage (against units, buildings
  and Cores, both sides alike) is `mulPct(damage, 100 + level *
  overloadDamageStepPercent)`, rounded down: for soldier damage 6, level 1 gives
  7 (7.2), level 2 gives 8 (8.4), level 5 gives 12, level 10 gives 18. **Turret
  damage is not escalated**, so that defences eventually lose to offence
  rather than prolonging the battle.
- **Core decay.** On each Overload beat (`level >= 1` and `(T -
  overloadStartTick) mod overloadIntervalTicks = 0`) both living Cores take `level *
  overloadCoreDamageStep` damage directly, together with that tick's other
  damage (step 4). Two walled boards with no units therefore still end: the
  Cores take 5, 10, 15, ... on ticks 1800, 1900, 2000, ...; after `n` beats the
  total is `5 * n * (n + 1) / 2`: 455 after 13 beats (last at 3000), 525 after
  14 (last at 3100), so with the Core health of 500 both Cores are destroyed
  at tick 3100 (level 14, damage 70). Both Cores may fall in the same tick; the
  simulation records `core_destroyed` for each; the battle-end rule and the
  tiebreak are in "Battles". With a Core health of 500 this bounds every
  battle: whatever else happens, both Cores are gone at tick 3100 at the
  latest, so a battle never lasts beyond 3101 ticks with the standard
  constants.
- **The deadline helper.** `overloadDeadline(simConfig, coreMaxHealth)`
  (`ramp.ts`) returns `{startTick, decayDestroysTick, decayDestroysLevel}`:
  `startTick = overloadStartTick`, and `decayDestroysTick` is the tick of the
  first beat `n` (1, 2, ...) at which `overloadCoreDamageStep * n * (n + 1) /
  2 >= coreMaxHealth`, namely `overloadStartTick + (n - 1) *
  overloadIntervalTicks` (`decayDestroysLevel = n`). Both are `null` when
  `overloadCoreDamageStep` is 0 and when that tick is not within the battle:
  a battle processes ticks 0 to `maxBattleTicks - 1` (it ends after the step
  of the tick before `maxBattleTicks`, and the Core destruction is checked
  first), so a beat at or after `maxBattleTicks` never lands. With the
  shipped configuration (12000 ticks) the last beat is at tick 11900 (level
  102) and at most 26,265 decay lands, so a Core of more than 26,265 health
  is never destroyed by the decay. `overloadOutcome(simConfig, coreMaxA,
  coreMaxB)` returns `{first, tick}` with `first` `'a'`, `'b'` or `'both'`
  for the Core(s) that fall first within the battle (a Core the decay does
  not destroy within the battle never falls first), and `first: null` when
  neither does. The helpers count the decay alone: any other damage
  to the Core makes the Core fall earlier. For a Core of 500 health, n = 14
  (13 beats take 455, 14 take 525), so with the standard constants it falls
  at tick 3100 (start 1800), that is 3 minutes 10 seconds, and the battle
  ends at `endTick` 3101 at the latest.
- **Linked Cores (MM-9d).** A side with `linkedCores` takes the decay once
  from its pool, not once per Core: on a beat the amount `level *
  overloadCoreDamageStep` is added to the side's damage of the tick a single
  time (step 4), so the pool falls by `5 * n * (n + 1) / 2` after `n` beats.
  The pool is therefore a single Core of that total health for the deadline:
  `overloadDeadline(simConfig, poolStartingHealth)` is the tick the decay
  alone empties it (a screen passes the pool, the sum, as one entry of
  `overloadOutcome`'s list for that side, not one entry per Core), and as
  always other damage makes it earlier. In PvE this is the intended deadline:
  the party's Cores (not linked) each take the full decay, so the pool, being
  larger than any single Core, outlasts the party's Cores unless the party
  damages it; the party must break the pool before its own Cores' deadline
  (3100 ticks for the standard 500 health) or the stronghold wins.
- **Pylons (MM-9d).** The decay is **not blocked** by a shield: a Core whose
  pylons stand still takes the full decay on every beat (it is added to the
  Core's damage of the tick as before, logged as `overload_core_damage`, and
  the shield only filters unit attacks, step 4). The deadline above is
  therefore unchanged for a Pylons boss: the decay alone destroys its Core at
  the same tick, pylons standing or not, and so the battle still ends. (The
  alternative, blocking it, would let a party that cannot break the pylons
  neither win nor lose before the time limit.) A pylon takes no decay: only
  Cores do.
- **PvE: the deadline is intended (CB-12, CB-29, #43).**
  In a PvE battle side 1's Cores are the stronghold's, whose total health is
  `coreHealthPerBudget` times the budget, at least `minCoreHealth` per Core,
  split evenly over the party's plots (PP-14; the figures below are the
  total, from the time when the stronghold had one Core, and each Core of a
  larger party now has its share only). The decay
  applies equally to both Cores, a flat amount per beat (5, 10, 15, ...), so
  with no other damage the Core with less maximum health falls first, at
  `overloadDeadline(simConfig, coreMaxHealth).decayDestroysTick` for that
  Core; the battle ends with `reason: "core_destroyed"`. The party's Core has
  500 health and falls at tick 3100 (14 beats take 525). A stronghold's Core
  is often smaller than that. In the sample of 96 shipped threats (all four
  archetypes, types easy, medium and hard, rounds 1 to 8, party size 1,
  seed `100 + round`, from `generateThreat`, with threats growing 25 percent
  per round, issue #145) the stronghold's Core health has a median of 241,
  a minimum of 42 and a maximum of 1188, and is under 500 in 81 of the 96
  (one is exactly 500). A Core of 241 falls at tick 2700 (10 beats take 275,
  9 take 225) and one of 42 at tick 2100 (4 beats take 50, 3 take 30), so
  against those the decay destroys the stronghold's Core first and the party
  wins by outlasting it: this is a legitimate way to win, and turtling is an
  intended strategy. The other 14 have more than 500 Core health (Rusher 8,
  Fortress 3, Boss 3; all in round 5 or later) and outlast the party's Core:
  against those the party must destroy the stronghold before tick 3100 or the
  threat wins. Larger parties meet larger strongholds (total health, party
  size 2: median 453, size 4: median 896, same grid; the smallest single Core
  in the whole grid is 40), so the share of such threats rises with the party
  size (14 of 96 at size 1, 44 at size 2 and 76 at size 4). Damage from
  units or turrets moves either deadline earlier. This is decided and
  intended, and no rule is special-cased for PvE: the decay applies equally
  to both Cores and the smaller falls first. Screens should compute the
  deadline for both Cores (`overloadDeadline`, or
  `overloadOutcome(simConfig, partyCoreMax, strongholdCoreMax)` for the
  comparison) and show which falls first.

### Events (arena log)

Arena events, in order of the steps above, use arena coordinates (a turret
shot is recorded in step 3, before the step 4 attack events):

| `type`               | Fields (besides `tick`)                                         |
| -------------------- | --------------------------------------------------------------- |
| `unit_spawned`       | `unit`, `side`, `def`, `px`, `py` (the centre, sub-cell units), `building` (the producer's ID, or 0 for a scheduled wave, see "Side options"), `owner`, `target` (PP-11) |
| `unit_retargeted`    | `unit`, `target` (the new target Core, a player index, or -1); recorded after the destruction events of step 6 |
| `burst_released`     | `side`, `core` (the Core, a player index), `thresholdPercent`, `units` (a list of `{unit, count}` in composition order); recorded in step 4 after the damage, one per Core and fired threshold (Core ascending, threshold descending), see "Core bursts" |
| `unit_attacked`      | `unit`, `target`, `damage`; and `pool` (the shared pool at the start of the tick) when the target is a Core of a side with `linkedCores` |
| `core_hit_blocked`   | `unit`, `side`, `core`, `damage`: a unit's hit on a Core shielded by a standing pylon did nothing (MM-9d); recorded in step 4 right after the `unit_attacked` of the same hit (an event only: the shipped targeting never aims at a shielded Core, see "Units, combat and destruction") |
| `splash`             | `attacker` (the unit with `splash`), `x`, `y` (the primary target's centre, sub-cell units), `targets` (a list of `{unit, damage}` of the secondary targets in unit id order, damage after their armor; may be empty); recorded right after the attacker's `unit_attacked` event, only when the attack was on a unit |
| `turret_fired`       | `side` (the owner), `building` (the turret), `unit`, `damage`; and `splash` (a list of `{unit, damage}`: the other units the shot hit, unit id order, damage after their armor, possibly empty) only for a turret tier with splash (CB-18b) |
| `ward_struck`        | `side` (the Ward's and the wall's), `building` (the Rune Ward), `wall` (the wall or gate that was hit), `unit` (the attacker), `damage` (after the attacker's armor); recorded in step 4 right after the `unit_attacked` of the same hit (issue #474, CB-53) |
| `guard_spawned`      | `unit`, `point` (the point's id), `def`, `px`, `py` (the centre, sub-cell units); recorded by a battle at tick 0 right after `zone_revealed`, one per placed neutral guard (CB-8e, "Neutral guards") |
| `point_capture_started` | `point` (the point's id), `side` (0 or 1): the point's `progressSide` became `side` with progress 0; recorded by the capture step (CB-8f, "Points of interest") |
| `point_captured`     | `point`, `side` (the new controller), `previous` (the controller before: -1, 0 or 1); recorded by the capture step right after the `point_capture_started` of the same tick, if any (CB-8f) |
| `unit_died`          | `unit`; and `side` = 2 for a neutral guard (a unit of a side has no `side` field) |
| `building_destroyed` | `side`, `building`                                              |
| `pylon_destroyed`    | `side`, `building`, `core` (the player index of the Core it shielded), `standing` (the pylons of that Core still alive); recorded in step 6 right after the pylon's `building_destroyed` (MM-9d) |
| `core_shield_down`   | `side`, `core`; recorded right after the `pylon_destroyed` whose `standing` is 0 (MM-9d) |
| `conduit_destroyed`  | `side`, `conduit`                                               |
| `core_destroyed`     | `side`, `core`                                                  |
| `ramp_step`          | `side`, `building`, `effect`, `steps` (the new step count)      |
| `overload_started`   | (none)                                                          |
| `overload_level`     | `level` (the new level)                                         |
| `overload_core_damage` | `side`, `core`, `damage`; and `pool` (as above) for a side with `linkedCores`, which has one such event per beat, naming its lowest living Core |
| `zone_revealed`      | `zone` (the neutral zone with its points of interest); recorded by a battle at tick 0, first in the log |
| `battle_ended`       | `winner`, `reason`; recorded by a battle as its last event, `tick` is the last tick that ran |

`target` is `{kind: "unit", unit}`, `{kind: "building", side, building}` or
`{kind: "core", side}`. The four flow events (`produced`, `delivered`, `lost`,
`stalled`) of each board keep their fields and gain `side`, the board's side
(0 or 1). The `delivered` event already has a `side` (the input side of the
building), so in the arena log that field is called `input` and `side` is the
board's. Schema: `schemas/sim-event.schema.json`.

**There is no movement event.** Units move every tick, and one event per unit
per tick would take the one-plot log of a long battle from under 1 MB to several
MB (the budget is 1 MB). The log therefore holds only the spawn position
(`unit_spawned`); a consumer that wants positions at tick `t` re-steps the
deterministic simulation (the web playback already does: it reads `px, py` from
the state of a second battle instance, which also gives sub-tick smoothing from
two consecutive states). The per-tick positions are covered by the golden
`stateHash` and the invariant tests. (`unit_moved` of the cell-based model was
removed.)

### Golden kind `arena-sim`

Input: `{ teamA, teamB, gapRows, ticks }` where each team is a `team-state-ops`
script (`seed`, `partySize`, `ops`) and the two boards must have the same size;
optionally `guards` (neutral guards, CB-8e; see "Neutral guards", "Golden vectors"), `units`, a list of `{side, def, x, y}` (arena cell; the unit is placed at the
cell's centre) or `{side, def, px, py}` (an exact position in sub-cell units) placed at tick 0 in list order (a position where the unit does not fit, or that overlaps a unit placed earlier, is an error), `buildingHealth`, a list of `{side,
building, hp}` (or `{side, core, hp}` for a Core, `core` the player index) that sets the current health of those buildings (`hp` from 1 to the maximum) before the battle starts, and
`restoreAt`, a list of tick counts
after which the state is saved as JSON and restored (the context rebuilt from
the state alone) before the run continues; the result must not depend on it. Optionally `checkpointEvery`, a positive integer number of ticks: the vector's `expected` then also holds `checkpoints`, a list with one entry `{tick, alive, coreHealth, stateHash}` at every multiple of `checkpointEvery` that the battle reaches (not tick 0; the final tick only if it is a multiple), where `alive` is `[side 0, side 1]` units alive, `coreHealth` is `[side 0, side 1]`, each the list of Core health by player (as in the result), and `stateHash` is the hash of the `ArenaSim` at that tick (as `result.stateHash` is at the final tick). A port that diverges learns the first checkpoint where it does; a mismatch is reported as the vector, the tick and the differing field. Vectors without `checkpointEvery` have no `checkpoints`. A battle starts and runs for `ticks`
ticks. Result: `{ tick, stateHash, events, sides }` with `stateHash` the hash of
the final `ArenaSim`, `events` the number of events, and `sides` a list of two
summaries `{spawned, alive, unitsDied, buildingDamageDealt,
buildingsDestroyed, coreHealth}` (`coreHealth` is the list of Core health by player; `buildingDamageDealt` is the health the
side's units and turrets took from the enemy's buildings, the Core included,
Overload decay not; `buildingsDestroyed` does not count the Core;
a destroyed Core has 0). The event log is the vector's event log (`eventLogHash`). Vectors:
`golden/arena-sim.json` (a mirror match, a rush against an almost empty base, a
four-plot battles where each unit walks to the Core opposite its plot, retargets when it falls (also saved and restored around the fall), takes the larger index in an exact tie, attacks a Core in reach that is not its target and then walks on, and a mirrored four-plot battle (issue #133), sealed base that is breached at its weakest wall, a ringed Core battle saved and restored four times, raiders that walk past a splitter to the Core (issue #66),
three turrets killing a wave that crosses the front edge, the same turrets
unpowered, a gate that lets its owner out while holding the enemy, a funnel
of a lake band and walls leaving one approach above eight turrets, an
overclocker speeding up a source, an armory making later units stronger, an
economy building reaching its cap, an overclocker destroyed mid-battle by a
breach, two walled Cores ending by Overload at tick 3100, and a soldier on a
corner cell between a healthy and a damaged wall of equal maximum health that
attacks the healthy one because the breach step prices buildings by maximum
health).

Vectors added with the circle model (issue #59): `arena-sim.separation-converging-soldiers` (four soldiers converging on one target: equal and unequal priority in the separation pass), `arena-sim.choke-point` (twelve soldiers through a wall line with a one-cell gap), `arena-sim.producer-held-at-blocked-exit` (a barracks whose only exit is occupied holds its unit, stops drawing, the source stalls) and `arena-sim.wide-unit-blocked-by-gap` (an ogre with a collision diameter of 320 waits in front of a one-cell gap that a soldier passes). Vectors added with ranged units and flyers (issue #59 part 2): `arena-sim.ranged-fires-from-range-and-holds`, `arena-sim.flyer-crosses-lake-line`, `arena-sim.melee-cannot-hit-flyer` and `arena-sim.ranged-and-flyers-mirror-restore` (mirrored rosters with all four unit types, saved and restored three times). Vectors added with the flyer follow-ups: `arena-sim.walled-hangar-spawns-drones` (a Hangar walled in on every side spawns drones that fly out), `arena-sim.flyer-crosses-walls-and-buildings` (a drone passes a wall line and a row of Barracks without attacking them) and `arena-sim.flyer-retargets-by-distance` (after its Core falls a drone takes the nearer Core where the ground tie rule would take the higher index). Two optional inputs make them possible: `extraUnits`, a list of unit definitions in the format of `content/units.json` added to the content for the run, and `report: "positions"`, which adds `positions` (`[[id, px, py], ...]` of the living units) to the result. Vectors added with two-input consumers (issue #380, CB-5e): `arena-sim.foundry-spawns-heavies`, `arena-sim.foundry-ore-only-spawns-nothing`, `arena-sim.foundry-mixed-network` (a Foundry and a Barracks sharing Ore through a splitter; saved and restored twice), `arena-sim.foundry-border-link-feeds-power` (Power over a border link, PP-4; saved and restored) and `arena-sim.foundry-destroyed-mid-battle` (the Foundry is the weak point of a sealed base and is destroyed while holding a full Power counter; "Mid-battle removal"; saved and restored twice). Vectors added with the refineries (issue #381, CB-5d), each with a test consumer defined by `extraBuildings` (a list of building definitions in the format of `content/buildings.json`, added to the content for the run, because no shipped building took a refined resource when they were made): `arena-sim.refinery-ab-feeds-units` and `arena-sim.refinery-bc-feeds-units` (a chain of two collectors, a refinery and the consumer, which spawns soldiers; saved and restored) and `arena-sim.refinery-destroyed-mid-battle` (a refinery is the weak point of a sealed base, stalled and holding two items when it is destroyed; the items are lost with two `lost` events and its conduits go with it; saved and restored twice). Vectors added with the Golem (issue #382, CB-5h; `bld_golem_forge` is shipped content, so none needs `extraBuildings`): `arena-sim.golem-chain-push` (Ore and Power collectors, a Composite refinery and a Golem forge, Golems marching with the soldiers of a Barracks against a base making soldiers; saved and restored), `arena-sim.golem-turrets-armor` (the turret-kills-wave board with Golems: every shot takes 3 less), `arena-sim.golem-passes-one-cell-gap` (a Golem and a soldier cross a wall line with a one-cell gap) and `arena-sim.golem-armor-vs-unit-hits` (a Golem against a soldier, an archer and a raider: hits of 3, 2 and 5). Vectors added with the Spire and the caster (issue #387, CB-5h; `bld_spire` is shipped content): `arena-sim.spire-chain-casters` (a Power and a Flux collector, an Aether refinery and a Spire; casters against a base that makes soldiers; saved and restored), `arena-sim.caster-splash-cluster` (a caster hits a soldier in a tight group: neighbours within the splash radius, a drone and a Golem included, take their share; the caster's own soldier does not; since issue #386 the radius is 360, so the soldier 241 away is hit as well) and `arena-sim.caster-hits-wall-only` (casters against a closed wall line: only the wall is hit, no splash event). Vectors added with the Lancer (issue #439, CB-16e; `bld_lancer_hall` is shipped content): `arena-sim.lancer-second-rank` (two Lancers stand behind a soldier each and hit the enemy soldier against it over the ally; a drone within reach is not hit) and `arena-sim.lancer-hall-rotations` (four Lancer halls, one in each rotation, each fed through its rotated Ore input by a collector of tier 1, 3, 2 and 1; saved and restored). Vectors added with the Grand barracks (issue #440, CB-13a; `bld_grand_barracks` is shipped content): `arena-sim.grand-barracks-two-collectors` (a tier 2 Grand barracks fed by two tier 2 collectors through a Merger spawns two soldiers in one tick every 56 ticks against a base that makes soldiers; saved and restored) and `arena-sim.grand-barracks-held-no-room` (a Grand barracks in a wall pen whose exit cell holds an enemy post: the first production spawns two soldiers, the next finds no room and starts nothing, and after the post dies the last has room for one soldier, spawns it and holds the other; saved and restored twice). Vectors added with the Mortar (issue #441, CB-18b; `bld_mortar` is shipped content, powered by a tier 3 Ore collector): `arena-sim.mortar-blind-spot` (an enemy Golem held in melee inside the blind spot is never shot, a soldier 9.5 cells away is; saved and restored), `arena-sim.mortar-splash-group` (a cluster of five soldiers: the shot unit takes 12, each soldier within one cell takes 7; saved and restored) and `arena-sim.mortar-splash-armor` (the same cluster with two Golems: the shot on a Golem is 9, its splash share 4, soldiers' splash 7).

The team scripts of this kind and of `team-state-ops` may give an explicit
`map` (in the map format) instead of `seed` and `partySize`; the vectors that
need a hand-placed resource node do.

### ASCII rendering

`renderArenaAscii(sim, content)` prints arena rows from `y = H - 1` (side 1, on
top) down to `y = 0`. Units are `0` or `1` for their side (drawn in the cell that holds their centre), `*` when both sides
have a centre in the same cell; buildings are `S R U D E C` (source, route, unit producer,
defense, economy, Core) in upper case for side 0 and lower case for side 1;
terrain is `~` lake, `#` cliff, `?` other, `%` a blocked gap cell; `.` is open.
The last line is a legend.

### Enemy-path preview

`previewEnemyPaths(teamState, content, simConfig)` (`enemy-paths.ts`) is the
build-screen helper (CB-43). For a single board it builds an arena with the board as side 0 and an empty board as
side 1 (gap 0), so that the board's cells are arena cells, and answers, **as
seen from the enemy side (side 1)**, with the same field and breach code as
the simulation (`computeField`, `fieldStep`, `computeBreach`, `breachStep`;
no second pathfinder; gates, walls and turrets all block the enemy):

For every `x` from 0 to `width - 1`, in order, such that the front-row cell
`(x, height - 1)` is open for the enemy side (no terrain, no building that
blocks it) (PP-12), an entry `{entry: {x, y}, core, cells, approach, breach}`
with `core` the Core of plot `plotOf(x)` if placed, else the nearest placed
Core by the key of PP-11. The path is that of an enemy unit that enters there
and heads for that Core, on the fields of that Core (PP-11); with no Core
placed there is no entry and the function does not throw. What a unit does after that Core has fallen is not previewed, and
neither is an attack on a Core that is not its target:

- `cells` is the walked path in board coordinates, **starting with the entry
  cell**, restricted to cells on the board (`y < height`); the walked cells
  with `y >= height` (the unit leaves the board through the neutral zone to
  pass a wall in the front row) are listed in `approach`, in walk order, and
  are left out of `cells`, whose consecutive on-board cells are then not
  adjacent. The Build screen can ignore `approach`. If the entry has a distance in the movement field of an enemy
  unit heading for the Core (side 1, field `core`), the unit takes `fieldStep` (the
  neighbour, 8 directions, with the smallest distance plus step cost, ties by
  tie key, forward first) until the distance is 0; the last cell is the one
  beside the Core and `breach` is `null`. Consecutive cells therefore share an
  edge or a corner (a diagonal step).
- Otherwise (sealed) it follows the breach field: while the breach distance of
  the current cell is above 0, take `breachStep` (minimise entering cost plus
  distance, ties by tie key). If that cell is open the unit walks into it
  (appended to `cells`); if it is covered by a building the walk stops: `cells`
  ends at the last open cell before it and `breach` is `{building, cell}`, the
  instance ID of the building the unit would attack and the cell of it entered.
  If the walk reaches a cell with breach distance 0, `cells` ends there and
  `breach` is `null`. The cost of a building uses its maximum health, computed exactly as in the simulation (tier health raised by the team's `building_health_percent` modifiers, see "Content bounds").
- An entry that has neither a field nor a breach distance (cut off by terrain)
  has `cells` = just the entry cell and `breach` = `null`.

The order of entries is by ascending `x`; the output depends only on the team
state and content (no random numbers). Identical tails are not merged.

**Approximation (issues #59 and #82).** The preview, like the movement fields, works on
cells: it answers "which cells could a unit of ordinary size walk", not "where
would a circle of radius R go". Every one-cell gap is passable, which is exact
for every unit of part 1 (collision radii below half a cell); the walked path
is the sequence of field cells, while a real unit steers by the direction of
each step and keeps its offset inside the cell (see "Steering"), so it may cut
across a neighbouring cell and slides along walls. The preview is the route
of a unit that enters at the centre of the column, not a trajectory. A unit
usually stays within one cell of it. A unit that enters off-centre keeps its
offset and now and then (about 1 to 2 walks in 100 in tests on random walled
boards) passes a wall row through a neighbouring gap. It can then be several
cells from the previewed route until the paths join again. A test measures
this against the simulation. A unit whose collision diameter is
larger than a gap does not fit through it in the simulation even though the
preview shows a path.

Golden kind `enemy-paths`: input is a team script (`team-state-ops` format,
with `map` or `seed`/`partySize`) that places the Core; result
`{paths: [{entry: [x, y], core, cells: [[x, y], ...], breach: null | {building,
cell: [x, y]}}, ...]}` (`approach` is not part of the golden result). Vectors: `golden/enemy-paths.json` (an open base around
terrain, a wall, a gate and a turret; a sealed base with one weak wall; four plots with Cores for players 0, 1 and 3).

### Seams for later issues

`unitStats` is the single place unit stats are modified (the `unit_strength`
bonus and the speed modifiers at spawn). `stepArena` does not assume the gap is open ground (blocked
gap cells are how the neutral zone enters), and does not end the battle: the
neutral zone, the battle end and the top-level entry point are in "The neutral
zone" and "Battles". The zone holds points of interest (CB-8d); they do not
block movement, and each starts the battle with neutral guards ("Neutral
guards", CB-8e), can be captured (CB-8f) and give their holder a buff (CB-8g, "Points of interest").

### Decided simplifications

- Units are circles that push each other apart softly (issue #82); there is
  no mass, momentum or facing. A crowd is resolved by the single push pass of
  step 5: overlap between units is allowed and temporary (a crowd that keeps
  walking into a choke compresses until the cap of the push balances it; one
  that stops is clear of overlap within about 10 ticks), and the hard
  guarantee is only the ground one (never inside solid ground or outside the
  arena). Measured with the placeholder content (`unit-motion.test.ts`): in
  open ground a crowd of 60 soldiers has no pair overlapping by more than 20
  percent of the sum of the radii after 40 ticks; in a crush at a one or
  two-cell choke about 1.2 of 60 soldiers overlap by more than half on
  average (at most 34 at once) and centres can coincide for a moment. Over
  whole reference battles (`stacking.test.ts`) no pair stays deeper than half
  for more than 3 ticks, and 0.19 percent of unit-ticks are that deep; in the
  dense four-plot battle (tier 1) the longest run is 10 ticks and 3.4 percent
  of unit-ticks are deeper than half. On the movement field a unit walks in
  the direction of its next cell, not at that cell's centre (rule c and
  "Steering"); only the walk to the Core (`d = 0`), a flyer's flight and a
  breach step aim at a cell centre.
- The movement fields are cell based and ignore radii and other units; a unit
  whose collision diameter exceeds one cell is not routed around gaps it cannot
  pass (see "Goals and movement fields"), and a cell with no free standing room
  near the Core simply queues.
- A producer whose exit cells have no free position **holds** the finished unit
  and stops drawing from its input buffers (backpressure, see step 2).
- Units can be trapped by buildings of their own side (own buildings are
  impassable even for the breach field); a trapped unit waits.
- Ranged attacks ignore walls and terrain (no line of sight).
- A destroyed Core's cells become open ground and nothing else changes
  (Overload Core decay skips it).
- Economy buildings, like every building other than the Core, are not goals;
  they are attacked only when a unit breaches through them (CB-20). They block
  movement for both sides like any building.
- The bonus is read at the start of the tick for source resets and at the
  moment of the spawn for units (see "In-battle ramp"); a step taken in a tick
  takes effect from the next tick.
- Aggro has only a cell-level line-of-sight test (step 3, a2): an enemy that
  is visible but not reachable by walking straight (a unit round a corner of a
  pocket) can still pull a unit towards it until it is in contact or blocked.
  The unit then waits against the obstacle; it does not path-find around it.

## The neutral zone

Implemented in `packages/core/src/neutral-zone.ts`; parameters in
`content/mapgen.json` under `neutralZone` (loader `mapgen.ts`); schema
`schemas/neutral-zone.schema.json`; golden kind `neutral-zone`. A battle is
fought on the two sides' boards with a small neutral zone between them (CB-8).
Its lakes, cliffs and points of interest are different every battle and
hidden from players until the battle begins (the battle's first event reveals
them).

### Format

`generateNeutralZone(battleSeed, width, content, mapgenConfig)` returns plain
JSON `{ width, depth, features, pointsOfInterest }`:

- `width` is the front width (the boards' width), `depth` the number of rows.
- Zone-local coordinates: `x` along the front edge (the same `x` as the
  arena's), `y = 0` is the zone row touching **side 0's** front edge,
  `y = depth - 1` the row touching side 1's front edge. In the arena the zone
  row `y` is arena row `h + y` with `h` the board height.
- `features` lists every feature cell as `{x, y, feature}` (a terrain ID),
  sorted by `(y, x)`; a cell not listed is open ground. A feature blocks
  movement exactly when its terrain entry says `blocksMovement` (the same flag
  the boards use).
- `pointsOfInterest` lists the points of interest (CB-8d) as `{id, band, x, y,
  buff}`, sorted by `id`. `band` is the plot band: columns `band * plotWidth`
  to `(band + 1) * plotWidth - 1` (clipped to `width - 1`), between side 0's
  plot `band` and side 1's plot `N - 1 - band` (CB-8b). `id` counts from 0 in
  band order, so ids and bands both increase along the list. `y` is always the
  middle row `(depth - 1) / 2`; `x` is the column; `buff` is a buff ID of
  `content/points.json`. A point is one cell. It does **not** block movement
  and units walk over it; it never lies on a feature. There is at most one per
  band. Each point starts the battle with neutral guards ("Neutral guards") and
  units divert to it and capture it ("Points of interest"); its `buff` is the
  buff its holder gets ("Points of interest", "Buffs").

### Parameters (`content/mapgen.json`, `neutralZone`)

`depth` (7, **odd**: points sit on the middle row), `lakes` `{countMinPerPlot, countMaxPerPlot, sizeMin, sizeMax}`
(0 to 1 per plot, 3 to 8 cells), `cliffs` `{countMinPerPlot, countMaxPerPlot,
lengthMin, lengthMax}` (0 to 1 per plot, 2 to 5 cells) and `maxAttempts` (64).
The feature IDs are those of `lakes.feature` and `cliffs.feature` in the same
file, and `placementTries` (30) is shared with board generation. "Per plot"
means per `plotWidth` columns of front width: `plots = ceil(width /
plotWidth)` (a hand-made board narrower than a plot counts as one plot), and
the zone's counts are `plots * countMinPerPlot` to `plots * countMaxPerPlot`.
A four-player battle therefore gets up to four lakes and four cliffs.

The points of interest read `content/points.json` (schema
`schemas/points.schema.json`, loader `points.ts`): `chancePercent` (60),
`bandMarginCells` (2), `buffs` (a list of `{id, kind, weight, ...numbers of the
kind}`; `poi_strength` of kind `unit_strength` with `strengthPercent` 20 and
`poi_heal` of kind `heal` with `healIntervalTicks` 10, `healRadiusCells` 3 and
`healAmount` 2, both weight 1) and `maxPointStrengthPercent` (40, CB-8g). The
tries per point are `placementTries` of `mapgen.json`. `guards` holds the neutral guards of every
point (CB-8e, "Neutral guards"): `baseBudget` (44), `growthPercent` (125),
`maxGuardsPerPoint` (5), `leashCells` (3) and `units`, the list of `{unit,
cost, weight}` (`unit_soldier` 10 / 3 and `unit_archer` 14 / 1). `generateNeutralZone` takes the loaded points
in its `content` argument (`content.points`); `startBattle` therefore needs
`content.points` too.

### Constraints

Every accepted zone satisfies all of:

1. the first row (`y = 0`) and the last row (`y = depth - 1`) contain no
   features, so no part of either front edge is sealed;
2. the leftmost and rightmost columns (`x = 0`, `x = width - 1`) contain no
   features;
3. every open cell (a cell without a `blocksMovement` feature) is
   4-connected to every other open cell, so the zone can be crossed from every
   front-edge cell on both sides.

Features are placed only in the region `x = 1 .. width - 2`, `y = 1 .. depth -
2`, which makes rules 1 and 2 hold by construction; rule 3 is checked after
placement. If that region is empty (width or depth below 3) no features are
placed.

### Random draws

The zone derives **only** from the battle seed and the width (and the content
and configuration), so a battle is reproducible from `(teamA, teamB, seed)`
(CB-8a). The two teams never influence it.

- `root = Rng.fromSeed(battleSeed)`; nothing is drawn from `root`.
- `zoneRng = root.child("neutral-zone")` (string label); nothing is drawn from
  it.
- Attempt `a` (counting from 0, up to `neutralZone.maxAttempts`): `A =
  zoneRng.child(a)` with `a` as an integer label; nothing is drawn from `A`.
  `lakesRng = A.child("lakes")` and `cliffsRng = A.child("cliffs")`.
- Lakes first, then cliffs, each from its own stream. `between` is as in map
  generation (exactly one `nextInt` call).
  1. `count = between(lakesRng, plots * lakes.countMinPerPlot, plots *
     lakes.countMaxPerPlot)`. This draw is always made, also when the region is
     empty.
  2. For each lake, up to `placementTries` tries: `size = between(lakesRng,
     sizeMin, sizeMax)`; start cell `x = between(lakesRng, 1, width - 2)`,
     then `y = between(lakesRng, 1, depth - 2)`; if that cell already holds a
     feature the try fails. Otherwise the lake grows to `size` cells exactly as
     in map generation (candidates are the unused region cells 4-adjacent to
     the lake, collected by scanning the lake's cells in the order they were
     added and the directions north `(0, -1)`, east, south, west, without
     duplicates; one is chosen with `lakesRng.nextInt(candidates.length)`); if
     no candidate remains the try fails. After `placementTries` failed tries
     the attempt fails.
  3. `count = between(cliffsRng, plots * cliffs.countMinPerPlot, plots *
     cliffs.countMaxPerPlot)` (always drawn).
  4. For each cliff, up to `placementTries` tries, with the draws of a board
     cliff in this order: `length = between(cliffsRng, lengthMin,
     lengthMax)`, `bend = nextInt(2)`, `d1 = nextInt(4)`, start `x =
     between(1, width - 2)`, `y = between(1, depth - 2)`, `firstLen = 1 +
     nextInt(length - 1)`, `perp = nextInt(2)`. The cliff goes `length` cells
     from the start in direction `d1`; with `bend = 1` it goes `firstLen` cells
     in `d1` and the rest in the direction `(d1 + 1) mod 4` (`perp = 0`) or
     `(d1 + 3) mod 4` (`perp = 1`) from the last of those cells. Directions are
     indexed north, east, south, west. The try fails if any cell is outside the
     region or already holds a feature.
  5. Points, after lakes and cliffs and after constraint 3 has been checked
     (they take no part in it), from `pointsRng = A.child("points")` (nothing
     is drawn from `A` itself; the lakes and cliffs draws are untouched, so
     every zone keeps its features and attempt count). `y = (depth - 1) / 2`.
     For `band = 0 .. plots - 1`, in this order:
     1. `roll = pointsRng.nextInt(100)`, always drawn. The band has no point
        unless `roll < chancePercent`.
     2. `lo = band * plotWidth + bandMarginCells`, `hi = min((band + 1) *
        plotWidth - 1, width - 1) - bandMarginCells`. If `lo > hi` the band has
        no point and nothing more is drawn for it. Otherwise up to
        `placementTries` tries: `x = between(pointsRng, lo, hi)`; the try
        succeeds when the 3 x 3 cells around `(x, y)` all lie inside the zone
        and none holds a `blocksMovement` feature; the first success ends the
        tries. If every try fails the band has no point (the attempt does not
        fail).
     3. For a band that got a point: `i = pickWeightedIndex(pointsRng,
        weights)` with the buffs' `weight`s in file order (exactly one
        `nextInt(totalWeight)`; the first index whose running total exceeds the
        draw), and the point is `{id: number of points so far, band, x, y,
        buff: buffs[i].id}`.
- After placement, constraint 3 is checked on the open cells; if it fails the
  attempt fails. A failed attempt is simply replaced by attempt `a + 1`. If
  all attempts fail an error is raised. With the standard content, over 500
  seeds and all four widths (2000 zones), 1991 zones were accepted at the first
  attempt, 9 needed a second one and none a third.

### Golden kind `neutral-zone`

Input `{seed, partySize}`; the width is `partySize * plotWidth`. Result
`{zone, hash, attempts}` with `hash = hashJson(zone)`. Vectors:
`golden/neutral-zone.json`, one per party size 1 to 4, plus a four-plot zone
with a point in every band, one with no point and a two-plot zone with two.

### Samples

`*` is a point of interest. One plot (seed 7, first attempt; `y = 0` is side 0's
edge, `~` lake, `#` cliff; this one has no point):

```
........................
...................~....
...................~~...
.##.................~...
....................~...
....................~...
........................
```

Four plots (seed 3, first attempt; one point, in band 3, `poi_strength` at
`(90, 3)`; bands 0 to 2 rolled no point):

```
................................................................................................
................................................................................................
...............................###..............................................................
................................##........................................................*.....
................................................................................................
.........................................................................#####..................
................................................................................................
```

Two plots (seed 2, first attempt; a point in each band: `poi_strength` at
`(13, 3)` and `poi_heal` at `(33, 3)`). `pnpm sim map --seed 2 --party 2` prints
this picture, with the point list, under the board map:

```
................................................
................................................
.....................~~.................####....
.............*........~~.~.......*......#.......
.......................~~~~.~..#................
.........................~~~~..#................
................................................
```

## Neutral guards

Implemented in `packages/core/src/guards.ts` (planning: how many of which
unit, from the content) and `arena-sim.ts` (`placeGuards`, the behaviour);
numbers in `content/points.json` under `guards` (schema
`schemas/points.schema.json`, loader `points.ts`). CB-8c and CB-8e (issue
#372). Guards hold the points of interest of the neutral zone ("The neutral
zone"). A point with a living guard cannot be captured ("Points of
interest"); the buffs are in "Points of interest", "Buffs" (CB-8g).

### Model

- A unit's `side` is 0, 1 or **2 (neutral)**. Guards are ordinary entries of
  the one unit list, sorted by `id`, with ids from the shared counter
  (`nextUnitId`); the guards are placed before the first tick, so they have
  the **lowest ids** of the battle (1, 2, ...).
- A guard has `owner = -1`, `target = -1` and `post`, the `id` of the point it
  guards. No other unit has `post` (the field is absent, so the state and hash
  of a unit of a side are unchanged). A guard's `hp` and `damage` are fixed at
  placement like any unit's, through `unitStats(2, def, strengthPercent)`.
- The state gets `guards` **only when the zone has points**: `{leashCells,
  posts, killed, lostToGuards}` where `posts` lists `{id, x, y}` (the point
  as an arena cell: `x` the zone `x`, `y = boardHeight + zone y`), sorted by
  `id`, and `killed` and `lostToGuards` are pairs indexed by side (see
  "Counters"). A state without it (a battle with no point, every arena-sim
  scenario that places no guards) is unchanged, so its hash is as before.
  `leashCells` is stored so that a restored state needs nothing else.
- Guards never count toward `spawned[s]` or `unitsDied[s]`, in the timeline's
  unit counts, or in the tiebreak ladder (PP-10), and they never decide a
  battle's end (only Cores, the ladder and the time limit do).
- **Enemies.** Every unit of side 0 and 1 is an enemy of every guard and the
  other way round; guards are not enemies of each other. The enemy sides of a
  unit of side 0 are `[1, 2]`, of side 1 `[0, 2]`, of a guard `[0, 1]`.
  Wherever "the other side" is searched (contact, aggro, splash) these sets
  are meant; the searches take the best candidate over all of them (smallest
  squared distance, ties by lowest id), so the order of the sets does not
  matter. Guards are not enemies of a side's buildings or Cores.
- **Frame.** A guard has no own frame: wherever a rule reads "the unit's own
  frame" (cell of a position, tie keys, steering, collision and push-out
  sweeps) it uses **side 0's frame**. Its solid grid is its own (below).

### Placement at tick 0

`startBattle` calls `placeGuards` after `zone_revealed` is recorded, only when
`zone.pointsOfInterest` is not empty. For each point in `id` order and each of
its guards in plan order (below):

1. The cells tried, in order: the point's cell, then its 8 neighbours N, E,
   S, W, NE, SE, SW, NW, as offsets `(0, 0)`, `(0, +1)`, `(+1, 0)`, `(0,
   -1)`, `(-1, 0)`, `(+1, +1)`, `(+1, -1)`, `(-1, -1)`, `(-1, +1)` in arena
   coordinates (north is `+y`, towards side 1, as everywhere in the rules). A
   cell outside the zone's rows, outside the arena or blocked is skipped.
2. In a cell, the first free position of step 2.2 of the tick (the spawn
   offsets in side 0's frame, the fit test for the guard's solid grid, and
   not **heavily blocked** by a living unit: the guards placed before count).
   The first cell with a free position gives the guard's position.
3. A guard with no free position in any of the 9 cells is **not placed**
   (no event; the point has fewer guards).
4. The guard is created (next id, `attackCooldown = 0`) and `guard_spawned
   {unit, point, def, px, py}` is recorded with the tick of the call, 0.

The first five guards of a point all fit on its cell (the spawn offsets give
five free positions), which is why guards usually start in a tight cluster.

### Composition (CB-8c, CB-8e)

Per point, with the battle's `round` (an input of `startBattle` and
`simulateBattle`, an integer from 1; `startPveBattle` takes it too, a
RangeError for anything else; the zone does not depend on it):

1. **Budget.** `guardBudget(round)` has the integer math of the threat
   budget (SC-1): `v = baseBudget`; repeat `min(round, R) - 1` times `v =
   floor(v * growthPercent / 100)` (`mulDiv`), where `R` is the last round
   whose growth-only value is at most `floor((2^53 - 1) / 100000)`; later
   rounds keep the budget of `R`. (`threatBudget` uses the same helper
   `growBudget` with its own limit; there is no type multiplier or party
   size here: every point gets the same budget.) With the shipped numbers:
   44, 55, 68, 85, 106, 132, ... (`baseBudget` 44, `growthPercent` 125).
2. **Units.** `left = budget`, a list of drawn units, and the stream `rng =
   Rng.fromSeed(battleSeed).child("guards").child(pointId)` (so a point's
   guards do not depend on the other points). While fewer than
   `maxGuardsPerPoint` (5) are drawn: let `affordable` be the entries of
   `guards.units` (file order) with `cost <= left`; if none, stop; else one
   `pickWeightedIndex(rng, weights of affordable)` picks the next guard, and
   `left -= cost`. Shipped: `unit_soldier` cost 10 weight 3, `unit_archer` cost
   14 weight 1; no flyers (the loader refuses one). Round 1 therefore buys
   about three soldiers and one archer (44 = 3 * 10 + 14).
3. **Strength.** With `spent = budget - left`: `strengthPercent =
   mulDiv(left, 100, spent)` when `spent > 0` and `left > 0`, else 0; the same
   percent for every guard of the point. Each guard's percent is then
   **capped** (never an error) at the largest `P` for which `mulPct(health, 100
   + P)` is at most `MAX_HEALTH` and `mulPct(damage, 100 + P)` at most
   `MAX_DAMAGE` (`maxGuardStrength`: `floor(((bound + 1) * 100 - 1) / value) -
   100` for each of the two, the smaller, at least 0). The guard spawns through
   `unitStats(2, def, P)`: health and damage are `mulPct(base, 100 + P)`.

The plan is a list `{point, guards: [{unit, strengthPercent}]}` in point `id`
order; `battle.sim.units` shows the result.

### Behaviour

Guards take part in step 3 (decide) like units, with these differences. Let
`post` be the guard's point and `centre` its cell's centre `(240 x + 120, 240
y + 120)`. A guard is **leashed** iff `dx^2 + dy^2 > (leashCells * 240)^2` with
`(dx, dy)` its centre minus `centre` (`leashCells` is 3).

- **Pass 1 (a, contact).** A leashed guard chooses nothing. Otherwise as for
  any unit: it attacks the nearest enemy unit in contact (units of both
  sides), a flying enemy only if the guard is ranged.
- **Pass 2 (a2, aggro).** A leashed guard chooses nothing. Otherwise the
  nearest visible enemy within `aggroRangeCells` is its aggro target (the same
  test as for any unit; the line of sight uses the guard's own solid grid).
  **Rule b does not exist for a guard**: it never aims at a building or a Core
  and does not breach.
- **Pass 3 (move).** An aggro target is chased like any unit's (the
  steering of "Steering", the guard's allies are guards). A guard with nothing
  else to do **holds or walks back**: when its centre is in the point's cell
  or one of its 8 neighbours (the 3x3 block where guards are placed) it does
  not move; otherwise it takes one step of `fieldStep` along the **movement
  field to the point's cell** (below) from the cell that holds it (heading
  `240 * (k - c)` as in rule c, steered), or, if that cell has no route,
  heads straight for `centre`. A leashed guard therefore drops its target and
  walks back until it is inside the 3x3 block, and with no enemy a guard
  walking back or standing is the only thing it does.
- **Turrets do not shoot guards** (step 3, turret fire): a turret's candidates
  are enemy units of side 0 or 1 only; a guard is not an enemy of a side's
  buildings (PP-13 lets turrets engage enemy *units* in the zone, and
  guards are not).
- **Overload does not affect guards.** A guard's attack deals its stored
  `damage` (before armor), not `mulPct(damage, 100 + level *
  overloadDamageStepPercent)`. (The Core decay is of Cores only.)
- **Soft collision (step 5).** Guards are in the push pass like any unit and
  count as enemies of both sides (weights of step 5.3.1 for different sides).
  Coinciding centres: the sign of a unit is `f` (+1 for sides 0 and 2, -1 for
  side 1) as before, and for two units of different sides **with the same
  `f`** (a guard and a side-0 unit) it is decided by the ids as for one side
  (`f` for the higher id, `-f` for the lower), so the two separate.
- **The neutral zone.** A guard's solid grid is solid for every cell outside
  the gap rows and for every blocked gap cell (lakes, cliffs): the guard
  never leaves the zone, whatever pushes it (fit test, spawn, push-out).
  Other units' grids are as before.

**The movement field to a point** is `computeCellField(arena, 2, cell)`: the
least-cost map of "Goals and movement fields" (steps 10 and 14, 8 directions, a
diagonal only if both orthogonal cells are open, distance 0 at the cell
itself) seeded with the point's cell, over the cells open for side 2 (as for
side 0 and 1 a cell is open when it is not blocked terrain and not covered by
a building that blocks it; side 2 has no gates). It is built **once per
point on first use** and cached in the context (`postFields`, keyed by point
id); it is dropped with the other fields when a building is destroyed (the
boards' open cells then change); a restored state rebuilds it. The point's
cell is `y * width + x`.

### Counters and the tiebreak

- `guards.killed[s]` (`guardsKilled` in the summary): guards killed by side
  `s`. In the tick a guard dies, let `d0` and `d1` be the damage side 0's and
  side 1's units dealt to it in step 4 (primary and splash hits, each side's
  hits summed with the saturating rule); `killed[0]` increases when `d0 >= d1` and
  `killed[1]` when `d1 >= d0`, so an exact tie counts for both. A guard death
  never adds to `unitsDied`.
- `guards.lostToGuards[s]`: units of side `s` that died mainly to guards.
  In the tick a unit dies, let `g` be the damage the guards dealt to it and
  `D` its total damage that tick (`g > 0`); when `g > D - g` the death counts
  here (it is still in `unitsDied[s]`). **The kills rung of the tiebreak and
  `unitsKilled[s]`** are `unitsDied[1 - s] - lostToGuards[1 - s]`: a unit the
  guards killed is a loss of its side but not a kill of the other side, so
  guards stay out of the ladder (PP-10). The other rungs read cores, overkill
  and `buildingDamageDealt` only.

### Events

- `guard_spawned {unit, point, def, px, py}` at tick 0, right after
  `zone_revealed`, one per placed guard in placement order.
- A guard's death is `unit_died {unit, side: 2}` (a unit of a side has no
  `side` field in `unit_died`). Its attacks and the hits on it are the usual
  `unit_attacked` (with `target {kind: "unit"}` for hits on units; guards
  never hit buildings) and `splash` events.
- `unit_died` is recorded in unit id order, guards first.

### Notes for a port

- A guard is a unit with `side = 2`; keep the one list sorted by id and the
  three-sided enemy table above rather than two separate lists, so every
  id-ordered pass (decisions, attack events, deaths) stays the same.
- Everything that reads "side 0 first, then side 1" in "One battle tick" and
  "Resolution order" concerns buildings, flows, producers, turrets and Cores,
  which guards do not have; where such a rule meets neutral units they come
  **after side 1, in id order** (the enemy sets `[1, 2]` and `[0, 2]` list the
  guards last). Any rule ordered by unit id is over the whole list, in which
  the guards come first (lowest ids).
- Do not iterate a map or set of guards or posts: `posts` is a list sorted by
  `id`, plans are lists in point order, the enemy sides are a fixed table.
- Distances stay squared integers; the leash test is
  `dx*dx + dy*dy > (leashCells * 240)^2`.
- The caps of `maxGuardStrength` use integer division of numbers below
  `2^53`: `(MAX_HEALTH + 1) * 100 - 1 = 100000000000099`.

### Golden vectors

`arena-sim` gets the optional input `guards` (`{posts: [{id, x, y}] (arena
cells), leashCells (default 3), units: [{post, def, x, y | px, py,
strengthPercent?}]}`): the posts are recorded and the guards are placed in list
order with `spawnGuardForTest` (a position that does not fit for guards or
overlaps a unit placed earlier is an error; no event), after the `units` list.
Its result gains `guards: {alive, killed}` when the input has `guards`. The
`battle` kind takes `round` (default 1) and, test-only, `zone`. Vectors:
`arena-sim.guards-walk-past-not-drawn-in`, `arena-sim.guards-soldier-kills-guard`,
`arena-sim.guards-leashed-guard-returns`,
`arena-sim.guards-archer-hits-drone-soldier-cannot`,
`arena-sim.guards-turret-ignores-guard`,
`arena-sim.guards-both-sides-near-same-guards`, and for battles
`battle.guards-two-points-round-1`, `battle.guards-two-points-round-8` (a
hand-made zone with two points, the same boards in two rounds) and
`battle.generated-zone-round-6`.

## Points of interest

Implemented in `arena-sim.ts` (`divertPoint`, `moveToPoint`, `stepPoints`) and
`battle.ts` (the summary); numbers in `content/points.json` under `capture`
(schema `schemas/points.schema.json`, loader `points.ts`). CB-8c and CB-8f
(issue #373). The points are placed by "The neutral zone" and guarded by
"Neutral guards"; this section covers how units divert to a point, wait there,
capture it and what is recorded, and "Buffs" what a held point gives its side
(CB-8g, issue #374).

### State

A battle whose zone has points (`placeGuards` was called) has `points` in the
`ArenaSim`, a list sorted by `id` with one entry per point:

| Field          | Meaning                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `id`           | The point's id (the same order as `guards.posts`, entry `k` is post `k`).    |
| `controller`   | The side that holds the point: -1 (nobody, the start), 0 or 1.               |
| `progressSide` | The side whose progress `progress` is: -1, 0 or 1.                           |
| `progress`     | Capture progress, 0 up to `captureTicks - 1` (`need - 1` of the side with Claimstakers). |
| `held`         | `[ticks side 0 held it, ticks side 1 held it]`, from 0.                      |
| `buff`         | The numbers of the point's buff (CB-8g, "Buffs"); absent: the point gives nothing. |

At tick 0 every point is `{controller: -1, progressSide: -1, progress: 0,
held: [0, 0]}`. `guards.capture` stores the four numbers of the content
(`captureTicks`, `maxCapturersCounted`, `captureRadiusCells`,
`pointAggroRangeCells`), so a saved state needs nothing else: the state is
plain JSON and a restored battle continues exactly like the original. A
state without points (no `points` key) is unchanged, so its hash is as
before.

### Aggro: diverting to a point

In decision pass 3, rule c1 (a unit of side 0 or 1 that attacks nothing and
has no aggro target, so neither a, a2 nor b chose an action: units and guards
in aggro range come first, as does a Core in reach). A unit **diverts** to
the point with index `k` when both hold:

1. `controller != side` of the unit (a point its own side holds never draws
   it);
2. the squared distance from the unit's centre to the centre of the point's
   cell `(240 x + 120, 240 y + 120)` is at most `(pointAggroRangeCells *
   240)^2`, and a **ground** unit has the cell-level line of sight of rule a2
   (`lineClear` of the unit's side, from the unit's centre to the point's
   centre) over that line. A flyer sees past solid cells, like in rule a2.

If several points qualify the unit takes the smallest squared distance, ties
by the lowest `id` (the loop is in `id` order and keeps the first on a tie).
The test is made again every tick from the state alone, so a unit keeps no
memory of its goal: it **drops the point the moment** its own side becomes
the controller (or it is pushed out of the range) and takes the move of rule
c from where it stands. Nobody stays behind.

A diverted unit moves like this (and rule c, including c0, is not used that
tick):

- Let `(hx, hy)` be the vector from the unit's centre to the point's centre.
  If `hx^2 + hy^2 <= (captureRadiusCells * 240)^2` the unit **waits**: no
  move this tick. It still attacks anything in reach (rule a decided that
  before) and is pushed by other units as any waiting unit is (step 5).
- Otherwise a **flyer** moves along the heading `(hx, hy)`, steered as in
  "Steering" (only flying allies count as blockers), never through the
  fields.
- Otherwise a ground unit takes `cell`, the cell of its centre in its own
  frame (as for rule c). If the **movement field to the point** (the field
  of the guards, `computeCellField(arena, 2, point cell)`, cached per point
  and shared with the guards, "Neutral guards") has a distance `d > 0` at
  `cell`, it takes one step `k = fieldStep(arena, side, field, cell)` (`side`
  is the unit's own, for the tie key) and the heading is `H = 240 * (k -
  cell)` componentwise, steered as in "Steering". If `d <= 0` or there is no
  step, the heading is `(hx, hy)` as for a flyer. (A point is in the middle
  row of the zone and the aggro range is at most 8 cells, so the unit is in
  the zone when it is within 3 cells; the field is over the cells open for
  side 2.)

The point's guards fight a diverted unit by their own rules. Capture needs no
unit to be diverted: any unit of side 0 or 1 within `captureRadiusCells` of
the point counts in the capture step, whatever brought it there.

### Capture step

At the end of step 6 (after the deaths, the destruction of buildings and the
retargeting; a battle whose state has no `points` skips it). Let `r =
captureRadiusCells * 240`. First one pass over the living units: a **guard**
(side 2) marks the point of its `post` as guarded; any other unit, flyers
included, with `(dx^2 + dy^2) <= r^2` to a point's centre adds one to that
point's count for its side (a unit can count at several points). Then for
each point in `id` order, with `c0` and `c1` the counts of side 0 and side 1:

1. If a guard of the point is alive: nothing changes (not even the decay of
   step 5).
2. If `c0 > 0` and `c1 > 0` the point is **contested**: nothing changes.
3. If exactly one side `s` has units in range and `s` is **not** the
   controller:
   - if `progressSide != s`: `progressSide = s`, `progress = 0` and
     `point_capture_started {point, side: s}` is recorded;
   - `progress += min(count, maxCapturersCounted)` (the progress added per
     tick is never scaled);
   - if `progress >= need_s`: `previous = controller`, `controller =
     s`, `progress = 0`, `progressSide = -1` and `point_captured {point,
     side: s, previous}` is recorded.
4. If exactly one side is in range and it **is** the controller: nothing
   changes (the controller's units standing there freeze the other side's
   leftover progress; the rules do not say otherwise).
5. If no unit of a side is in range: `progress` falls by 1 if above 0, and
   when it is 0 `progressSide = -1`.

`need_s` is the take threshold of side `s` (issue #426, Claimstakers): with
`P_s` the sum of the `poi_capture_speed_percent` percents of `s`'s modifiers
(checked `addInt`; 0 without any), `need_s = max(1, ceil(captureTicks * 100 /
(100 + P_s)))` in integers (`captureTicksFor`). With 0 it is `captureTicks`;
50 percent turns 50 into 34, 100 percent into 25. It is computed once at the
start of the step for each side from the side's `teams[s].modifiers` (already
part of the state, so a restored battle needs nothing more) and applies to the
capturing side only; the decay (rule 5), the contested rule (2), the
controller rule (4) and the guarded rule (1) are unchanged, and `progress`
stays an integer from 0 to `need_s - 1`. A progress held when a side's
threshold is below it cannot happen: modifiers are fixed for the whole battle.

Last, still in the pass of that point: if `controller` is 0 or 1,
`held[controller] += 1`. So the tick of a capture counts for the new
controller, and `held[0] + held[1]` is at most the number of ticks.

With the shipped numbers (`captureTicks` 50, `maxCapturersCounted` 3) one
unit takes a free point in 50 ticks (34 with Claimstakers) (`point_captured` 49 ticks after
`point_capture_started`, which is recorded in the tick of the first
progress), two units in 25, three or more in 17.

### Events and summary

- `point_capture_started {point, side}` and `point_captured {point, side,
  previous}` (the events table). Progress is **not** logged every tick.
- **Playback reads the progress from the timeline samples** (not from the
  events): every `TimelineSample` of a battle whose zone has points carries
  `points`, a list `{id, controller, progressSide, progress}` by point `id`
  at the sample's tick (`timelineSampleTicks`, the first sample at tick 0 and
  the last at the end). The events say when a point changed hands and who
  started; the samples give the progress bar between them.
- The battle summary (`BattleSummary`) has `points` (present only when the
  zone has points): per point by `id`, `{id, controller, pointHeldTicks}`,
  the final controller (-1, 0 or 1) and the ticks `[side 0, side 1]` held it.
  It is **not** part of the tiebreak ladder (PP-10) and does not decide when
  a battle ends.

### Buffs

CB-8g (issue #374). A point's buff is `buff.kind` with its numbers, copied
from the `content/points.json` entry the zone names (`point.buff` is the entry's
`id`) into the state of the point at tick 0, so a restored state needs nothing
else: `{kind: "unit_strength", strengthPercent}` or `{kind: "heal",
healIntervalTicks, healRadiusCells, healAmount}`. The state also keeps
`guards.maxPointStrengthPercent` (the top-level `maxPointStrengthPercent` of the
file) and `guards.healed`, `[side 0, side 1]`. The buff is **active while the
point's `controller` is 0 or 1**, for that side, and only then: it ends the
moment the point is taken by the other side (the capture step, end of step 6,
changes `controller`) and with the battle. Every player of the side benefits
(an exception to PP-8). A point with no controller, and a point with no `buff`
(scenarios), gives nothing. More entries of one kind with other numbers need no
code: each point carries its own numbers.

**`unit_strength`: stronger new units.** The side's **point bonus** is `min(sum,
maxPointStrengthPercent)`, `sum` being the `strengthPercent` of every
`unit_strength` point whose `controller` is the side (`pointStrengthBonus`; 20
per point and a cap of 40 with the shipped numbers, so a third point adds
nothing). `spawnStrength` of a unit of side `s` (producer units, units of a
scheduled wave, test spawns) is `rampBonus(owner) + unitStrengthPercent option
+ run modifiers + pointBonus(s)`, with `rampBonus` 0 for a wave unit; this
single number is the `strengthPercent` given to `unitStats` (the owner's
specialist health percent is passed separately, as `healthBonusPercent`). The point bonus is
outside the Armory cap `maxUnitStrengthPercent`. It is read at the moment of the
spawn (step 2 of the tick for producers and waves; a wave unit waiting in `entering` reads it when it is placed on the field; the capture step that gives
or takes a point runs at the end of step 6, so a point captured in tick `T`
counts for the spawns of tick `T + 1` on), and a unit already on the field is
never changed: not when the point is lost, not when another is taken. Neutral
guards (side 2) are not spawned by this path and get no point bonus.
**Content bound:** at `placeGuards` (tick 0) the largest possible bonus (the
sum of every `unit_strength` point of the zone, capped) is added to each side's
worst case (`base + modifiers + largest ramp bonus`) of the start check of "Content
bounds" and every unit type must stay within `MAX_HEALTH` and `MAX_DAMAGE`
(and the Overload hit within `MAX_HIT`); a battle for which a spawn could pass
them is refused with a `RangeError` before the first tick. A test pins that
every unit of `units.json` can take `maxUnitStrengthPercent +
maxPointStrengthPercent` (`maxStrengthPercent(def)`).

**`heal`: healing near the point.** In step 4, after the damage is applied
(see "One battle tick"), for each point in `id` order whose `controller` is 0 or
1, whose buff is `heal` and for which `T mod healIntervalTicks = 0` (`T` the
tick being run; tick 0 is a beat), the point is a **beat** of its holder. Then
for every unit of the arena in unit-`id` order that is not a guard, has `hp > 0`
and `hp < maxHp`: `best` is the largest `healAmount` of the beats of the
unit's own side whose point centre `(240 x + 120, 240 y + 120)` is within
`healRadiusCells * 240` of the unit's centre (`dx^2 + dy^2 <= r^2`, squared
integers); if `best > 0` the unit gains `g = min(best, maxHp - hp)`, `hp += g`
and `guards.healed[side] += g`. A unit near several beats of its side gains
**once**, with the largest amount (healing does not stack); a unit of the other
side, a guard, a building and a Core are never healed, and a unit with `hp <=
0` (killed in this very step) is not healed back. There is no event for a heal;
playback reads `healedHp` from the summary, or `hp` from a later sample.

**Summary.** `BattleSideSummary` has `pointBonus` (the side's point bonus at the
end of the battle, `pointStrengthBonus`: 0 without points) and `healedHp`
(`guards.healed[side]`, 0 without points); the `arena-sim` golden kind reports
both for a state with points as `pointBonus` and `healed`. Neither is part of
the tiebreak (PP-10). **Seam for a later modifier** (the Shrine modifier
"Claimstakers", captured 50 percent faster, issue #426): the capture numbers are
stored per battle in `guards.capture`; a modifier only needs to change what
`placeGuards` is given.

### Notes for a port

- A point's state also has its `buff` (copied numbers); the buff of a point
  with a controller is looked up from the point's state alone. The point bonus
  and the heal beat are computed from `points` at the moment of the spawn and
  of step 4: nothing about them is cached or stored besides `guards.healed`.
- The state of a point has four numbers and `held`; keep the list sorted by
  `id` and parallel to `guards.posts`. Do not keep a set of "diverted" units:
  the diversion is recomputed from the unit's position every tick.
- All distances are squared integers (`dx*dx + dy*dy <= (cells * 240)^2`).
  The unit's centre against the point's cell centre; no square roots.
- The capture step runs after the units that died this tick are removed and
  after buildings fell; a guard killed this tick no longer blocks the
  capture, a unit killed this tick no longer counts.
- Units on opposite sides of a point stop `captureRadiusCells` from its
  centre, `2 * captureRadiusCells` from each other: with the shipped numbers
  that is beyond the aggro range (3 cells), so a standoff in which both sides
  wait and the point is contested lasts until later arrivals push the front
  units closer. This is a consequence of the numbers, not a rule.

### Golden vectors

(Buffs, CB-8g: `arena-sim` also takes, per post, an optional `buff` (`{kind,
...numbers}` as in the content) and `controller` (0 or 1: the starting holder,
test setup), `guards.maxPointStrengthPercent`, per unit an optional `hp`, a
list `lateUnits` placed after the guards and the controllers, and `report:
"stats"` (`stats: [[id, hp, maxHp, damage], ...]`); its result has `pointBonus`
and `healed`. Vectors: `arena-sim.points-strength-new-units-stronger`,
`arena-sim.points-strength-two-points-capped`,
`arena-sim.points-strength-lost-point-normal-units`,
`arena-sim.points-heal-restores-up-to-max`,
`arena-sim.points-heal-caps-at-max-health`,
`arena-sim.points-heal-two-points-once-per-beat`,
`arena-sim.points-heal-not-after-point-lost`, and for whole battles
`battle.points-strength-wave-captures` and `battle.points-heal-wave-captures`.
Every battle summary has `pointBonus` and `healedHp` per side.)

`arena-sim` takes `guards.capture`, optional `{captureTicks,
maxCapturersCounted, captureRadiusCells, pointAggroRangeCells}` (each
defaulting to the shipped number 50, 3, 2, 3), and its result gains
`points: [{id, controller, progressSide, progress, held}]` when the input has
`guards` (a post with no `guards.units` is a point with no guards). The
`battle` and `pve-battle` kinds' `summary` gains `points` when the zone has
points. Vectors: `arena-sim.points-outside-range-not-drawn`,
`arena-sim.points-one-soldier-captures` (saved and restored),
`arena-sim.points-three-soldiers-capture-fast`,
`arena-sim.points-five-soldiers-count-three`,
`arena-sim.points-contested-makes-no-progress`,
`arena-sim.points-contested-keeps-progress`,
`arena-sim.points-drone-captures-guarded-point`,
`arena-sim.points-soldiers-kill-guards-then-capture`,
`arena-sim.points-retaken-by-other-side`,
`arena-sim.points-capture-restarts-for-other-side` and, for a whole battle
with a wave of side 1 (as a PvE threat sends), `battle.points-wave-captures-point`.

## Battles

**Status (#124).** This section describes the code on `main`. The rules
below are specified in "Appendix: the per-player design (issue #124)" and
changed this section; all of them are implemented.

| Rule | Change to this section | Status |
| ---- | ---------------------- | ------ |
| PP-2 | `core_not_placed` names the lowest player without a Core, for any side with a player without a Core. | **implemented** (issues #131, #138) |

Implemented in `packages/core/src/battle.ts` (golden kind `battle`:
`packages/golden/src/kinds/battle.ts`). **Side 0 is always the party and side 1 the opponent** (the
defender, also called the ghost when the opponent is a recorded team). A
battle is a pure function of `(teamA, teamB, seed, round)`, the content and the
configuration (CB-30); `round` (from 1) only scales the neutral guards
("Neutral guards"), the zone derives from the seed and the width alone.

### Assembly

`startBattle({teamA, teamB, seed, round}, content, {sim, mapgen}, options?)`
sets a battle up at tick 0, or returns `{ok: false, error}`. A `round` that is
not an integer from 1 is a `RangeError` (a programming error, before the
checks below). The checks run in this order and the first failure is
reported:

1. `party_size_mismatch`: the boards differ in width. Equal party sizes (1 to
   4) run; different ones never do. This is checked before anything else.
2. `board_size_mismatch`: the boards differ in height (not reachable with
   generated boards).
3. `core_not_placed` (with the `side` and the lowest `player` without a Core): a
   side has no Core placed at all,
   side 0 checked first.
4. `invalid_zone`: only with the test-only option below.

Then the neutral zone is generated from `seed` and the width (above), the
arena is built with `gapRows = zone.depth` and the zone's blocked cells as the
gap (see "The arena"), and the first event `zone_revealed {zone}` is recorded
at tick 0, followed by the `guard_spawned` events of the neutral guards of the
zone's points (none for a zone without points; "Neutral guards").

These follow from the arena rules and are checked by tests: nothing can be
built in the zone (a board is exactly its own `h` rows); no building has cells
or conduits in a zone row; no building produces or flows in the zone (production and flow stay on the
boards; turrets may shoot units of the other side standing in the zone, never units on the enemy's board and never the neutral guards); only units fight there. A unit producer on a front row may spawn a
unit onto the first zone row.

The only test-only switch is `options.zone`: a zone to use instead of the
generated one (for example an empty or point-symmetric zone, so that a mirror
match stays exactly symmetric). It must have the boards' width and satisfy the
zone constraints, otherwise `invalid_zone`.

### Core health and overkill

Core health is clamped at 0 for display. In the tick where damage takes a
Core to 0 or below, the health value after **all** of that tick's damage (unit
attacks and Overload decay) is also kept unclamped, so it may be negative
(`remaining`, `ctx.coreRemaining[side][player]`); for a living Core it equals
its health. A destroyed Core's overkill is `-remaining` (0 if it ended exactly
at 0). The damage of the tick is the per-target sum with the saturation rule
of "Integer math conventions": `remaining = hp - min(2^52, exact sum)`, with
`hp` the Core's health before that tick's damage. So a Core's overkill is at
most `2^52 - hp`, and two Cores whose sums both saturated differ only by their
`hp`. A side's overkill (the summary's `coreOverkill`, the ladder's rung 3) is
the sum of the overkill of its Cores that were destroyed in the **latest**
tick, in player order, saturating at `2^52` (`sumOverkill`).

**Linked Cores (MM-9d).** For a side with `linkedCores` the shared pool takes
the place of the Cores' health, and the same rules apply to it as to one Core
(per step 4 of "One battle tick"): `remaining = hp - min(2^52, exact sum of
the tick's damage on all its Cores)` with `hp` the pool before the tick, the
pool clamped at 0 for display, overkill = `-remaining` once the pool is 0 (0
if it ended exactly at 0). The overkill is counted **once**: the first Core to
fall (the lowest player index) carries the pool's `remaining` and the other
Cores of the side 0, so the side's overkill (`sumOverkill` over the Cores
destroyed in the latest tick) equals the pool's. The Cores' own `hp` stays at
their starting health while the pool stands, so `cores[p].health` of the
battle summary shows that number (it is for layout and display) and 0 once
they fell. Everything below that reads "the side's Core health" (`sumHp`,
`coreHealth` of the summary) reads the pool instead (a living pool value, 0
when it fell) and never the sum of the Cores. `coreMaxHealth` (`sumMax`) is
the sum of the Cores' starting health, which is the pool's starting value.

**Part of the saved state (issue #157).** Each Core entry of the `health`
list carries `remaining` (the unclamped health after the latest tick that
damaged it; equal to `hp` while the Core stands, so the value starts as the
maximum health) and `fellTick` (the tick in which the Core was destroyed, or
`null`). `ctx.coreRemaining` is derived from them when a context is built, and
the `Battle` reads the fall tick from `fellTick`, so a Core that fell before a
restore point keeps its overkill and its `destroyedTick`: restoring at any tick
gives the same Core state, `coreOverkill` and `destroyedTick` as a straight run.
The summary's `rampSteps` and `timeline` are not part of the state: they
exist only in the closure of the `Battle` that ran the ticks (counted from its
own first tick), so a restore does not give them back. `ArenaSim` is not a saved format (a
`Battle` is not saved), so no format number changes; the entries are part of
the state hash, which is why this change regenerated the pinned `stateHash`es
of every battle.

### End conditions (CB-33, PP-10)

Checked at the end of each tick, after `stepArena`. Let `standing[s]` be the
number of living Cores of side `s`.

1. **One side has no Core left** (`standing[s] = 0`, the other has some): the
   other side wins, `reason: "core_destroyed"`. Losing some but not all Cores
   ends nothing. For a side with `linkedCores` all Cores fall in the tick the
   pool reaches 0 and none before, so the party wins exactly when the pool is
   empty, in the tick it empties (with the Overload decay as one more
   source of damage: see "Overload"); a side's party Cores are never linked.
2. **Both sides lost their last Core in this tick**: the ladder decides,
   starting at rung 3.
3. **Time limit**: `maxBattleTicks` (12000) ticks have been simulated and
   both sides have a living Core: the ladder decides, starting at rung 1. The
   decay alone destroys any Core with at most `overloadCoreDamageStep * m * (m
   + 1) / 2` health, where `m` is the number of Overload beats before
   `maxBattleTicks` (102 with the standard constants, 26265 health), so with
   every Core at 500 health (before `core_health_percent` modifiers) all
   Cores of both sides fall at tick 3100 at every party size and the time
   limit is a safety net for larger Cores (`coreHealths`) and tests.

**The ladder.** The first rung on which the sides differ decides; the
defender wins no tie.

| Rung | The winner has | `reason` |
| ---- | -------------- | -------- |
| 1 | more Cores standing (a linked side has all of its Cores or none) | `time_limit` |
| 2 | the larger share of total Core health, `sumHp / sumMax`, compared exactly with `compareFractions` (a linked side's `sumHp` is its pool, counted once; `sumMax` the sum of its Cores' starting health) | `time_limit` |
| 3 | less overkill (above; a linked side's is the pool's, once) | `tiebreak_overkill` |
| 4 | more building damage dealt (`buildingDamageDealt`) | `tiebreak_building_damage` |
| 5 | more units killed (`unitsKilled`) | `tiebreak_kills` |
| 6 | otherwise the attacker, side 0 | `tiebreak_attacker` |

With one Core per side this is exactly the earlier rule set. Rungs 1 and 2
can only differ at the time limit.

### Tiebreak counters

Two integers per side, both part of the saved state (`buildingDamageDealt` is
a field of `ArenaSim`; the kills are derived from `unitsDied` and, with neutral guards, from
`lostToGuards`):

- **`buildingDamageDealt[s]`**: the damage that side `s`'s units have applied
  to the other side's buildings, **the Core included**, over the whole battle,
  summed tick by tick as in step 4 of "One battle tick": for each building and
  tick, `min(A, h)` where `A` is the saturating sum of that tick's unit
  attacks on the building and `h` the building's health before the tick. It
  does **not** include Overload Core decay (the Core takes that whatever
  happens), and it does not include overkill, i.e. damage beyond the health the
  building had left (so a Core that had 10 health and was hit for 18 counts 10;
  a building hit by two units in the same tick counts at most its remaining
  health once). Turret shots hit units only. Damage to units is never counted
  here. If a Core takes attack damage and decay in the same tick, the decay
  does not reduce the credited attack damage (`min(A, h)` is computed with the
  attacks alone). **Linked Cores:** the Cores of a side with `linkedCores`
  count as one building: `A` is the saturating sum of the tick's attacks on
  all of them and `h` the pool before the tick, so a tick's credit is
  `min(A, pool)` once (never more than the pool had, whatever the number of
  Cores hit).
- **`unitsKilled[s]`**: the number of enemy units that died from side `s`'s
  damage. A unit takes damage only from the other side's units and turrets and from
  neutral guards (no unit attacks its own side, Overload does not damage
  units), so every unit death is the kill of exactly one side or of the guards and the case of one unit killed by
  both sides in the same tick cannot occur. Hence `unitsKilled[s] =
  unitsDied[1 - s] - lostToGuards[1 - s]` (units that died, whatever blow of
  the other side finished them; a unit that took the blows of several enemies
  in its last tick is one kill; `lostToGuards` is 0 when the zone has no
  point, and a unit that died mainly to neutral guards is nobody's kill, see
  "Neutral guards").

Bounds (see "Content bounds"): per building the credited total is at most its
maximum health (every credit `min(A, h)` also takes at least that much from
`h`), so at most `MAX_HEALTH = 1e12`; a side's total is at most the sum over
the enemy's buildings, and there are at most `MAX_ARENA_CELLS = 8192` of them,
so at most `8192 * 1e12 = 8.192e15 < 2^53 - 1 = 9.007e15`: the counter is
always exact and needs no saturation (it is still summed with the checked
`addInt`). `unitsDied` is at most the number of units ever spawned, far below
any bound.

Once a battle has ended nothing steps any more: `step()` does nothing and
`simulateBattle` stops. The result is `{winner, reason, endTick}` with `winner`
0 or 1 and `endTick` the number of ticks simulated (the last tick that ran has
number `endTick - 1`; the closing `battle_ended` event carries that tick).

### Entry points

- `startBattle(...)` returns `{ok: true, battle}`; the handle has `step()`
  (run one tick, record events, check the end), `isOver()`, `result()`
  (`null` while running), `summary()` (valid at any time), `zone`, `sim` (the
  plain-JSON `ArenaSim`) and `eventLog`. Playback and tools use this.
- `simulateBattle(input, content, config, options?)` runs a battle to its end
  with `startBattle`: `{ok: true, result, summary, eventLog, zone}` or `{ok:
  false, error}` where `error` is `{code, message, side?}`.

### Event log

The log is the arena event list (see "Events (arena log)") with two events
added: `zone_revealed {zone}` first (tick 0) and `battle_ended {winner,
reason}` last (the tick of the last step). It is plain JSON; its hash is the
vector's `eventLogHash`.

### Summary

`summary = {sides: [party, opponent], timeline}`. Per side:

| Field           | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `unitsSpawned`  | Units spawned over the battle.                                       |
| `unitsLost`     | Units that died.                                                     |
| `buildingsLost` | Buildings destroyed (the Core is not counted).                       |
| `cores`         | Per placed Core, by player: `{player, health, maxHealth, overkill, destroyedTick}` (`health` clamped at 0; `overkill` 0 and `destroyedTick` null while it stands). |
| `coresStanding` | Cores alive at the end.                                              |
| `coreHealth`    | Total Core health at the end (`sumHp`, Cores clamped at 0).          |
| `coreMaxHealth` | Total maximum Core health (`sumMax`).                                |
| `coreOverkill`  | The overkill of the Cores destroyed in the latest tick, summed with saturation; see "Core health and overkill". |
| `rampSteps`     | `ramp_step` events of the side (steps of destroyed buildings count). |
| `buildingDamageDealt` | Damage the side's units applied to the enemy's buildings, Core included; see "Tiebreak counters". |
| `unitsKilled`   | Enemy units that died from the side's damage (`unitsDied` of the other side less `lostToGuards`). |
| `guardsKilled`  | Neutral guards the side's units killed (CB-8e): a guard's death counts for the side that dealt it the most damage in that tick, for both on a tie; 0 without points. Not a tiebreak counter. |

Beside `sides` and `timeline`, the summary has `points` when the zone has
points (CB-8f): per point `{id, controller, pointHeldTicks: [side 0, side 1]}`,
see "Points of interest".

`timeline` is a list of samples `{tick, sides: [s0, s1], points?}` with `s = {units,
unitHealth, buildings}`: units alive, the sum of their current health, and
placed buildings alive (the Core is not counted); `points` (only for a zone
with points) is the capture state `{id, controller, progressSide, progress}` of
each point at the sample's tick. The first sample is at tick
0, then one after every `timelineSampleTicks` (50) simulated ticks, and one at
`endTick` unless it coincides with a regular sample. The golden vectors leave
the timeline out.

### Golden kind `battle`

Input `{teamA, teamB, seed}`, optionally `round` (an integer from 1, default 1:
the guards scale with it) and a test-only `zone` (a hand-made neutral zone, passed
as `options.zone`), and optionally `sideOptions` (`[side0, side1]`,
each `null` or an object of the side options of "Side options": `scheduledWaves`,
`freePower`, `unitStrengthPercent`, `coreHealths`; absent in the older vectors);
each team is a `team-state-ops` script (`map` or
`seed` and `partySize`, and `ops`). Result for a battle that ran: `{ok: true,
result, summary (without timeline, with points when the zone has points), zone, stateHash, events}` where
`stateHash` is the hash of the final `ArenaSim` and `events` the length of the
event log; the event log is the vector's `eventLogHash`. For a refused battle:
`{ok: false, error: {code, message}}` (no event log). Vectors:
`golden/battle.json`: a mirror match (it ends at tick 1740 with side 0 as the
winner by the attacker rung of the ladder, reason `tiebreak_attacker`;
before issue #82 part 2 the armies stalled and Overload destroyed both
Cores at tick 3100);
rush against fortify-and-ramp; a quick one-sided battle; a walled stalemate
ended by Overload (attacker rung); one vector for each rung of the ladder after
equal overkill, `battle.tiebreak-building-damage` (a soldier wave hits a turret
and dies: side 1 has the building damage although side 0 has the kill),
`battle.tiebreak-kills` (free-power turrets kill a wave: side 1 wins on kills
with no building damage on either side) and `battle.tiebreak-attacker` (two
bare Cores), `battle.wave-queue` (a wave of 80 soldiers larger than the front row: the units that find no room wait in the `entering` queue and come in later); party sizes 1 and 2 refused; for several Cores (issue #132) `battle.two-plot-core-falls` (one Core falls at tick 2000 and the battle goes on; an earlier fall adds no overkill), `battle.walled-four-cores-overload` (eight walled Cores fall at tick 3100), `battle.time-limit-cores-standing-side0` and `-side1` (rung 1, the defender can win), `battle.time-limit-core-share` (rung 2) and `battle.overkill-two-cores` (rung 3); `battle.golem-chain-push` (issue #382: the Golem chain of `arena-sim.golem-chain-push` as a whole battle); `battle.spire-chain-push` (issue #387: the Spire chain of `arena-sim.spire-chain-casters` as a whole battle); `battle.lancer-hall-rotations` (issue #439: the four Lancer halls of `arena-sim.lancer-hall-rotations` as a whole battle); `battle.grand-barracks-two-collectors` (issue #440: the Grand barracks chain of `arena-sim.grand-barracks-two-collectors` as a whole battle); `battle.tunnel-exit-destroyed` (issue #442: a Tunnel exit in a barrier of tier 3 walls is destroyed at tick 139, after the Barracks it feeds, so the pair is gone for the rest of the battle); with the neutral guards (issue #372) `battle.guards-two-points-round-1` and `-round-8` (a hand-made zone with two points) and `battle.generated-zone-round-6`.

### Decided simplifications

- The neutral zone is not symmetric, so a mirrored pair of boards does not
  give an exactly symmetric battle with a generated zone; symmetry holds only
  for an empty or point-symmetric zone (the test-only option).
- Units of the two sides have no special rules in the zone: it is open ground
  (or lake and cliff) like any board cell; only the neutral guards of its
  points of interest are special ("Neutral guards").
- The Core health fraction in the time-limit rule uses each Core's health
  at the start of the battle as its maximum (`battle.ts`, `coreMax`), after
  side options (`coreHealths`) and `core_health_percent` modifiers, so the
  two sides' maximums can differ.

## Side options

A small, general mechanism of the arena simulation (`createArenaSim(...,
options)`, `ArenaOptions.sideOptions`, also `BattleInput.sideOptions`): per side,
an optional object with any of the fields below. Ghost battles do not use it.
When any side has options the state carries them in `sideOptions` (a pair
indexed by side, `{}` for a side without), so a saved state continues
identically; with none the field is absent.

- **`scheduledWaves`**: a list `{tick, unit, count, healthPercent?, plot?}` (an
  entry's optional `healthPercent`, MM-9d "Warlord", an integer of at least
  100, is copied to each queued `entering` entry and passed to `unitStats` when
  the unit spawns, see "Units"; absent means 100 and the entry is
  byte-identical to before; an entry's optional `plot`, issue #433 "Focus", an
  integer from 0 to the plot count minus 1, limits where the wave enters, see
  "Focus entries" below, and absent means the whole width, byte-identical to
  before). In the Production step of
  tick `tick` (after all unit producers of both sides, side 0's waves before
  side 1's, waves in list order), the wave's `count` units are appended to the
  state's `entering` queue as `{side, unit, col}` (unit `i` after unit `i - 1`).
  Wave `j` is the `j`-th entry of the side's list (0-based). Work in the side's
  own frame, column `c` = board `x` (for side 1 the arena column is
  `W - 1 - c`). Unit `i` (0-based, `n = count`) wants column
  `col = (floor((2i + 1) * W / (2n)) + 7j) mod W`, i.e. the units are spread
  evenly across the whole width, from a start column that moves by 7 columns
  for each wave index (the constant 7 is part of the rule). **Entering.**
  Every tick, in the same Production step after the producers and the queueing
  just described, the queue is walked once in order (side 0's entries and side
  1's entries are in the order they were appended: side 0's wave first). For
  each entry the unit tries to enter on the side's **front row** (side 0:
  arena row `h - 1`; side 1: arena row `H - h`, the row next to the neutral
  zone): the candidate columns are `col`, then `col - 1`, `col + 1`, `col - 2`,
  `col + 2`, ... (distance `d = 0, 1, ...`, the lower own-frame column first;
  columns outside `0 .. W - 1` are skipped), and in each column whose front-row
  cell is **open for the side** (not blocked terrain, not covered by a building
  that blocks the side) the same **offsets** as for producers (step 2.2) are
  tried from the cell centre; the unit's `owner` is `plotOf(c)` for the
  own-frame column `c` it entered on (the column actually used, not `col`) and
  its target is `chooseTarget(owner, entry cell)` (PP-11); the first position where the unit's collision
  circle fits and is not heavily blocked by any living unit (rule of step 2.2;
  the units that entered earlier in this walk included) is its spawn position. (The offsets are `120 - collisionRadius`
  times the offset table, so a unit of another collision radius tries other
  positions inside a cell: a larger unit can find room where a smaller one did
  not, and the other way round. An entry of the very same collision radius and
  side as an entry that found none earlier in this walk cannot find any either,
  since units are only added during the walk; skipping it without trying is
  only a shortcut and never changes the result.) An entry that finds none stays in the
  queue, **in its place**, and tries again next tick; the entries behind it are
  still tried this tick (no head-of-line blocking), so the relative order of
  waiting entries never changes. No entry is ever dropped: if the front row has
  no open cell the entry waits (a destroyed building may open one). An entry
  that enters is removed, becomes a unit with the next unit ID (at that tick,
  with the strength of that tick), counts as `spawned` and produces
  `unit_spawned` with `building = 0`. Wave `count` is the total for the whole
  board, so a four-plot board simply gets wider waves. The queue is part of the
  state (`entering`), so a restored battle continues identically.
  **Focus entries** (issue #433). A wave with `plot = q` works on the columns
  `lo .. hi - 1` of plot `q`, `lo = q * plotWidth`, `hi = lo + plotWidth`, and
  nothing else changes: unit `i` of wave `j` (`n = count`) wants the own-frame
  column `col = lo + ((floor((2i + 1) * plotWidth / (2n)) + 7j) mod plotWidth)`
  (the same spread and the same stride, inside the plot); the candidate columns
  are `col`, `col - 1`, `col + 1`, ... as above but **only those in `lo ..
  hi - 1`** (so the walk stops after `plotWidth` distances), the cells are
  tried in the same order with the same offsets, and a unit with no room waits
  in its place as before (it never enters another plot). The entry's `plot` is
  copied to the queued entry; the unit's `owner` is therefore `q`, and its
  target the Core of plot `q` chosen by PP-11 as before. The "failed radius"
  shortcut above is kept per (collision radius, plot): a failure on the whole
  width also fails every plot, a failure on one plot says nothing about the
  others. With `plot = 0` and one plot (a party of 1) `lo = 0`, `hi = W` and
  the entry is identical to one without `plot`.
- **`freePower`**: every turret of the side (and every Rune Ward, issue #474)
  is fully charged at all times: in the turret charging step, `charge` is set
  to `costPerShot` (a Ward's, to `costPerStrike`) without touching the input
  buffers. No flow is needed (the PvE threat has no sources,
  conduits or producers). The turrets still obey the normal firing rules,
  including that they only shoot units standing on their owner's board rows or in the neutral zone (PP-13).
- **`unitStrengthPercent`**: a base strength percent for every unit the side
  spawns (producers and waves). `unitStats` receives the sum of this and the
  spawning producer owner's `unit_strength` ramp bonus (which is capped separately by
  `maxUnitStrengthPercent`; the base is not) and its `unit_strength_percent`
  modifiers.
- **`coreHealths`**: a list by player index (a PvE stronghold: one entry per plot, PP-14): that player's Core starts with this health (and it is its maximum health in the summary and the time-limit rule) instead of the
  definition's (before the team's `core_health_percent`); a player without an entry has the definition's. Each entry must be an integer
  from 1 to `MAX_HEALTH`, and `unitStrengthPercent` must keep every unit type
  within the stat bounds even with the modifiers and the largest ramp bonus the
  side can reach added; otherwise the battle does not start (a `RangeError`
  from `createArenaSim`), see "Content bounds".

- **`bursts`** (Core bursts, MM-9d "Brood"): a list `{core, thresholdPercent,
  unit, count}`, in release order (by Core, then threshold descending as the
  archetype lists them, then composition order), with `count >= 1` and `core`
  a player index of the side. When any side has a non-empty `bursts` the state
  carries a `bursting` queue (`[{side, core, unit}]`, initially `[]`); with
  none the field is absent, so every other state is unchanged. The trigger is
  in "One battle tick", step 4. **Leaving the Core.** In the Production step of
  every tick, after all unit producers and before the scheduled waves, the
  `bursting` queue is walked once in order. Each entry leaves its Core like a
  producer's unit (step 2.2) with the Core as the "producer": its `owner` is
  the Core's player index (the plot), its target is the Core opposite that
  plot if it stands (else the nearest by the same rule as a producer), the
  spawn cells are the cells 4-adjacent to the Core's footprint ordered by
  (class, distance, tie key) for that target (the same key and tie key as a
  producer's, no new rule), and the position is the first free offset in the
  first spawn cell that has one. The unit has no producer and no ramp bonus
  (`unit_spawned` has `building = 0`) and the side's `unitStrengthPercent`.
  An entry with no free position stays in the queue, **in its place**, and
  tries again next tick; the entries behind it are still tried this tick (so
  the order of waiting entries never changes); none is dropped. If the Core
  has been destroyed its footprint cells are open and units still leave from
  them; if the battle has ended nothing spawns any more (a one-Core stronghold
  whose Core falls ends the battle that tick, so its last bursts never
  leave). Burst units are ordinary wave units afterwards (they retarget like
  any unit when their Core falls).

- **`linkedCores`** (Linked Cores, MM-9d): a boolean. When `true` the side's
  Cores share one health pool: `linkedPools` gets `{side, hp, remaining}` with
  `hp = remaining` = the sum of the Cores' starting health (their
  `coreHealths` entries, saturating `addInt`, so at most `8 * MAX_HEALTH`).
  The damage rules are in "One battle tick", step 4 ("Linked Cores"), the
  readers of Core health in "Core health and overkill", "End conditions" and
  "Tiebreak counters". `false` or absent changes nothing (no `linkedPools`
  field, so the state hash of every other battle is unchanged). A PvE threat
  has it exactly when its profile has `stronghold.sharedHealth`.

- **`pylons`** (Pylons, MM-9d): a list `{building, core, health}`: the side's
  building with instance ID `building` is a **pylon** of the Core with player
  index `core`, and starts the battle with `health` (an integer from 1 to
  `MAX_HEALTH`, checked at setup; it replaces the tier's health, as
  `coreHealths` does for a Core; the team's building-health modifiers are
  applied on top as for any building, but the stronghold has none). The
  building must be a `bld_pylon`-type defense (`defenseType` `pylon`) that is
  placed in the team state; a pylon never needs power, and does nothing
  but stand: it has no inputs, produces nothing and is never shot by turrets
  (they only hit units). While at least one pylon of a Core is alive the Core
  is **shielded**: (1) it takes no damage from unit attacks ("One battle tick",
  step 4, "Shield"), (2) the goal set of the other side's units heading for it
  is its standing pylons, and rule b attacks a pylon in reach in its place
  ("Goals and movement fields"). The pylon list is read when the context is
  built (`arenaOf`): a list `ArenaPylon {ref, side, core}` in the order of the
  side options, side 0 first; the state has no field of its own for it, and
  with no `pylons` option in a battle every rule is unchanged (the state hash
  of any other battle must not change). A PvE threat has it exactly when its
  profile has a non-empty `stronghold.pylons`: `building` is `buildings.length
  + 1 + i` for the `i`-th pylon of the list, the IDs `buildStronghold` gives.

Everything else (unit behaviour, aggro, breach logic, Overload, end conditions
and the tiebreak ladder) is unchanged.

## PvE threats

One Core per player in the stronghold, bosses included (PP-14, issue #138): **implemented**.

Implemented in `threats.ts` (configuration and the budget), `threat-gen.ts`
(the generator), `threat-layouts.ts` (stronghold layouts), `pve-battle.ts`
(battles) and `reference-boards.ts` (test boards); golden kinds `threat-gen`
and `pve-battle`: `packages/golden/src/kinds/threat.ts`. A PvE enemy or boss is a scripted threat,
not a factory: a schedule of unit **waves** that arrive at the front edge of its
side, plus a **stronghold** (one Core per party plot, walls and turrets) for the party to attack.
Its strength grows exponentially with the round (SC-1 to SC-7) so that every
run eventually ends. The numbers are in `content/threats.json`
(schema `schemas/threats.schema.json`, loader `loadThreats(data, {units,
buildings})`, raw export `rawThreats` from `@game/content`).

### The budget (SC-1)

`baseBudget` (B0, 100), `growthPercent` (g, 125: a factor 1.25 per round) and
`typeMultiplierPercent` (`easy` 70, `medium` 100, `hard` 140, `boss` 120).
`budget(round, type, partySize)` is computed in exactly this order:

1. `v = baseBudget`; repeat `min(round, maxRound) - 1` times: `v = floor(v *
   growthPercent / 100)`.
2. `v = floor(v * typeMultiplierPercent[type] / 100)`.
3. `budget = v * partySize`.

`maxRound` is the largest round whose growth-only value `V_r` (the `v` of step
1) is at most `limit = floor((2^53 - 1) / (1000 * maxTypePercent *
maxPartySize))`, where `maxTypePercent` is the largest multiplier and
`maxPartySize` comes from `threats.json` (4). The factor 1000 is headroom so
that percent arithmetic on any budget (up to 1000 percent) stays in the safe
range. Later rounds are clamped to `maxRound` (the budget stops growing there,
far beyond any run that can be survived). `growthPercent` must be above 100 and
the loader rejects a `baseBudget` above the limit. Medium budgets for one
player, rounds 1 to 15: 100, 125, 156, 195, 243, 303, 378, 472, 590, 737, 921,
1151, 1438, 1797, 2246.

### The profile (plain JSON, `schemas/threat-profile.schema.json`)

```
{ archetype, type, round, partySize, budget, unitStrengthPercent,
  waves: [{ tick, unit, count, healthPercent?, plot? }],
  stronghold: { cores: [{ x, y, health }],
                buildings: [{ def, tier, x, y, rotation }],
                bursts?: [{ core, thresholdPercent, unit, count }],
                pylons?: [{ core, x, y, health }],
                sharedHealth?: number } }
```

`cores[p]` is the Core of plot `p`: the position of its lowest cell, in the
stronghold's board coordinates, and its health. There are exactly `partySize`
Cores. `bursts` (Core bursts, MM-9d) is present only for an archetype with
`brood` (then non-empty) and absent for every other archetype, so their
profiles and hashes are unchanged: each entry says that Core `core` releases
`count` units of `unit` when its health falls to `thresholdPercent` of its
starting health (one entry per unit type of the burst, ordered by `core`,
then the archetype's threshold order, then composition order). The battle
reads them as the `bursts` side option. `sharedHealth` (Linked Cores, MM-9d)
is present only for an archetype with `linkedCores` and absent for every
other archetype (their profiles and hashes are unchanged): the total health
of the Cores, the sum of the `health` fields computed after any clamp. The
per-Core `health` fields stay for layout and display; the battle reads
`sharedHealth` as the `linkedCores` side option (the pool itself starts as the
sum of the Cores' starting health, which is the same number). `pylons`
(Pylons, MM-9d) is present only for an archetype with `pylons` (it may be
empty when no cell fits) and absent for every other archetype (their profiles
and hashes are unchanged): each entry is a pylon at board cell `(x, y)` with
starting `health`, belonging to the Core of player `core` (the plot its `x` is
in); the list is sorted by `(y, x)` and `buildStronghold` places the pylons
after the buildings, so they get the instance IDs `buildings.length + 1`, ...
in list order, as `bld_pylon` tier 1 owned by `core`. The battle reads them as
the `pylons` side option (`building` = that ID).

A wave entry's `healthPercent` (Warlord, MM-9d) is present only on the
champion entries of an archetype with `champion` (one per wave tick, listed
first in its tick; `unit` is the champion unit, `count` is `partySize`) and
absent from every other entry, so every other profile and hash is unchanged.

A wave entry's `plot` (Focus, issue #433) is present only on the entries of an
archetype with `focus` (every entry of one wave tick has the same `plot`, 0 to
`partySize - 1`) and absent from every other entry, so every other profile and
hash is unchanged. The battle reads it as the `plot` of the `scheduledWaves`
entry.

It is everything the battle needs; there are no hidden inputs. `waves` are in
tick order (the units of one wave share a tick, one entry per unit type);
`stronghold.buildings` are sorted by `(y, x)` and get instance IDs 1, 2, ... in
that order. Coordinates are the stronghold's own board coordinates (`y = 0` the
back row, `y = height - 1` the front row facing the party), the board being
`partySize * plotWidth` by `plotDepth`.

### Archetypes (data templates in `threats.json`)

An archetype has `waveSharePercent` (the rest of the budget goes to the
stronghold), `waves` `{firstTick, intervalTicks, count, growthPercent,
composition: [{unit, weight}], signature?}` and `stronghold`
`{coreHealthPerBudget, wallSharePercent, turretSharePercent, layout}`.
`bossOnly` archetypes are never offered by `pickArchetypes`; they have
`fromRound` and `minPartySize` (see "Choosing and summarising", `pickBoss`) and
may have `brood` `{thresholdsPercent: [..], sharePercent}` (Core bursts, below)
`linkedCores: true` (Linked Cores, below), `pylons` `{perPlot, sharePercent,
minDistance, maxDistance}` (Pylons, below) or `champion` `{unit, healthPercent,
sharePercent}` (Warlord, below). A plain archetype may have `focus: true`
(Focus, below).
Shipped values:

| Archetype | Wave share | Waves (first tick, interval, count, growth) | Composition | Stronghold (Core per budget, walls, turrets, layout) |
| --- | --- | --- | --- | --- |
| Rusher | 70 | 100, 120, 6, 115 | soldier 2 : raider 1 | 600, 0, 0, `open` |
| Fortress | 20 | 600, 400, 3, 130 | soldier | 300, 30, 25, `ring` |
| Escalator | 75 | 100, 75, 8, 160 | soldier 3 : raider 1 | 300, 25, 15, `line` |
| Skirmishers (`arch_skirmishers`, from round 2) | 50 | 150, 150, 6, 120 | archer 3 : soldier 1 | 300, 0, 45, `open` |
| Swarm (`arch_swarm`, from round 1) | 80 | 80, 45, 14, 108 | raider | 500, 0, 10, `open` |
| Maze (`arch_maze`, from round 2) | 25 | 400, 300, 4, 125 | soldier 2 : raider 1 | 300, 40, 30, `maze` |
| Focus (`arch_focus`, from round 3, `focus`) | 60 | 150, 160, 7, 120 | soldier 2 : raider 1 | 400, 20, 15, `ring` |
| Juggernaut (`arch_juggernaut`, from round 3) | 60 | 250, 300, 4, 135 | heavy 2 : golem 1 | 350, 25, 15, `line` |
| Coven (`arch_coven`, from round 3) | 55 | 200, 200, 6, 120 | caster 2 : soldier 2 | 350, 20, 20, `ring` |
| Boss | 55 | 200, 250, 6, 125 | soldier 3 : raider 1; every 3rd wave only raiders | 400, 20, 20, `ring` |
| Brood (`arch_boss_brood`, boss only, from round 3, any party size) | 55 | 200, 250, 6, 125 | soldier 3 : raider 1; every 3rd wave only raiders | 400, 20, 20, `ring` |
| Bonded (`arch_boss_linked`, boss only, from round 5, party size 2 or more) | 55 | 200, 250, 6, 125 | soldier 3 : raider 1; every 3rd wave only raiders | 400, 20, 20, `ring` |
| Pylons (`arch_boss_pylons`, boss only, from round 7, any party size) | 55 | 200, 250, 6, 125 | soldier 3 : raider 1; every 3rd wave only raiders | 400, 20, 20, `ring` |
| Warlord (`arch_boss_warlord`, boss only, from round 9, any party size) | 55 | 200, 250, 6, 125 | soldier 3 : raider 1; every 3rd wave only raiders | 400, 20, 20, `ring` |

Rusher tests defence (early frequent waves, a small open Core); Fortress tests
ramp and siege (late light waves, a big walled Core with turrets); Escalator
tests speed (waves that grow fast, a wall line); Skirmishers (issue #431) sends
mostly archers behind a soldier screen against an open stronghold with many
turrets (the counter is fast melee that catches archers, and turrets; walls do
nothing against ranged attacks); Swarm sends raiders only, in fourteen small
waves 45 ticks apart, against an open stronghold with a small Core (the counter
is area damage and turrets). Both are plain data: the generator needs no new
rule (every unit of a composition is in `unitCost`, `open` is an existing
layout). They interact with the ranged mix (step 4) as every archetype does: from
`rangedMix.fromRound` each non-signature wave gives 25 percent of its budget to
archers and 15 percent to drones. For Skirmishers this thins the soldier screen
(about 32 percent soldiers by count in rounds 2 and 3 at large budgets, about 18
percent from round 4, the rest archers and drones; at party size 1 the small
budgets of rounds 2 to 5 buy no soldier at all), it is about 80 percent ranged; for Swarm
raiders stay about 70 to 75 percent of the units (rounds 10 and 15, party 4).
**Notes for a port:** nothing new to implement: two more entries in the archetype
list (file order decides `pickArchetypes`' shuffle), and the wave `count` bound is
now 16 (was 12).
Maze (issue #432) sends light, late waves (a quarter of the budget in four
waves, the first at tick 400, 300 apart) against the
new `maze` layout: a winding walled path to the Core, lined with turrets (the
counter is a strong army that pushes through, or breaching). Its waves are plain
data like the others; at round 15 `unitStrengthPercent` is 100 for hard, party 1
and 4 (the waves fit the cap), 150 and 155 at round 16. The layout is the only new rule: see "Layouts".
Its stronghold budget is three quarters of the budget; walls take 40 percent of
it, turrets 30, and the rest becomes Core health. The wall cap is
`layouts.maze.maxWallsPerPlot` (88), not `maxWallsPerPlot` (60): four full rows
of 22 walls need it (the other option was fewer rows, which would not zig-zag).
Focus (issue #433, from round 3) has normal waves (60 percent of the budget in
seven waves from tick 150, 160 apart, soldier 2 : raider 1) against a `ring`
stronghold (Core 400 per budget, 20 percent walls, 15 percent turrets), but each
wave enters through one plot: see step 6 and the cap in step 5. In a party of 1
every wave is plot 0, the whole width, so it plays as ordinary waves (the
profile's waves carry `plot: 0`, which changes nothing in the battle). The
stronghold is generated exactly as a `ring` of another archetype. **Notes for a
port (Focus):** one flag on the template, one extra random stream (`wavesRng.child("focus")`,
below) and the plot restriction of the entering walk in "Side options"; the
wave sizes, composition and ranged mix are the ordinary ones.
Juggernaut and Coven (issue #434, both from round 3) are plain data like
Skirmishers and Swarm: no generator rule. Juggernaut sends few, slow, very tough
waves (four waves from tick 250, 300 apart, growth 135 percent; heavies and
Golems at weights 2 : 1) against a `line` stronghold with a wall line (Core 350
per budget, 25 percent walls, 15 percent turrets); its counter is focused
damage, and walls to buy time. Coven sends casters behind a soldier screen (six
waves from tick 200, 200 apart, casters and soldiers at weights 2 : 2) against a
`ring` stronghold (Core 350, 20 percent walls, 20 percent turrets); its counter
is spread-out units (caster splash), and armored Golems shrug off splash. The
two units are priced for the wave budget in `unitCost`: heavy 20 (about 2 times
the 10 resources, 5 of each input, that the Foundry's tier 1 `costs` were before
issue #386; the heavy unit did not change, so its price stays) and caster 10 (it was
8, 2 times the Spire's tier 1 `costPerUnit` of 4; issue #386 raised the caster's
health and damage by about a third, so the price follows); the Golem keeps its price of 50
(the Forge's tier 1 `costPerUnit` of 4 would give 8, which would flood Juggernaut
with Golems whose stats are several times a soldier's). The ranged mix (step 4)
applies to both from `rangedMix.fromRound` (25 percent of a non-signature wave's
budget to archers and 15 percent to drones). Units per wave at medium, party 1
(measured with seed 7; at small budgets the integer split buys no Golem at
all): Juggernaut has
4 heavies at round 3 (one per wave), 3 heavies, 2 archers and a drone at round 5,
7 heavies, 8 archers and 4 drones at round 10 (waves of 2, 3, 5 and 9) and 10
heavies, 10 archers and 5 drones at round 15 (`unitStrengthPercent` 117); at
party 4, 11 heavies and a Golem at round 3, 5 Golems at round 10, 6 at round 15.
Coven has 4 casters and 3 soldiers at round 3 (waves of 1, 1, 1, 1, 1 and 2),
12 casters at round 10 and 15 at round 15 (strength 142). Every wave has at
least one unit (the existing minimum of step 5); no wave exceeds `cap`.
**Notes for a port (Juggernaut, Coven):** two more archetype entries (file order
sets `pickArchetypes`' shuffle) and two more `unitCost` entries.
No per-archetype switch for the mix was needed. Swarm's waves are small
(`growthPercent` 108, so the last wave is about 2.7 times the first): at party
size 1, round 1 every wave is one raider; at round 10 the largest wave is 5
raiders, an archer and a drone; at round 15, `unitStrengthPercent` is 75
(party 1) or 71 (party 4), the largest wave 8 to 34 raiders with its ranged
units, no more than `cap`. Boss mixes all of it, its
every-Nth-wave signature being all raiders (a fast swarm of small, weak units; since issue #66 raiders no longer prefer any building, they are ordinary units with different numbers: health 25, damage 8, radius 0.25 cell, move cooldown 4). Brood has the Boss's waves and stronghold exactly, plus
`brood: {thresholdsPercent: [75, 50, 25], sharePercent: 15}`: each of its Cores
releases a burst of units when it falls to 75, 50 and 25 percent of its
starting health (MM-9d). Its burst budget comes out of the stronghold budget,
so its Cores are smaller than the Boss's. Bonded also has
the Boss's waves and stronghold exactly (no budget is set aside; the Cores
have the Boss's size), plus `linkedCores: true`: its Cores share one health
pool (below). The Pylons stronghold has the Boss's waves and stronghold, plus
`pylons: {perPlot: 3, sharePercent: 10, minDistance: 2, maxDistance: 4}`: three
pylons around each Core, paid from a tenth of the stronghold budget, and a
Core takes no damage while one of its pylons stands (MM-9d); like Brood, its
Cores are smaller than the Boss's (the budget is spent on the pylons first).
The Warlord has the Boss's waves and stronghold exactly (the stronghold budget
is not touched, its Cores have the Boss's size), plus `champion: {unit:
"unit_golem", healthPercent: 600, sharePercent: 40}`: 40 percent of every
wave's budget buys one champion Golem per boss plot (up to 600 percent of a
Golem's health), which leads the wave (MM-9d); the composition is bought from
the other 60 percent. There is no aura or other rule: the champion is a
plain, sturdy Golem.
Unit
prices for spending wave budget are `unitCost` in `threats.json` (soldier 10,
raider 8, archer 14, drone 16; about 2 times the producer's tier 1 `costPerUnit`
of 5, 4, 7 and 8, rounded; golem 50, only bought as a champion: the soldier and
raider cost about 1 per 2.4 to 3 points of health times damage per tick, and the
Golem's 260 health at 6 damage per 14 ticks is about 111 of those points, so
about 43, raised to 50 for its armor 3. Heavy 20 and caster 10 (issues #434 and #386) follow the same rule, see
Juggernaut and Coven above. Only the Warlord's champion and Juggernaut's
composition name the Golem). Building prices for the stronghold are the **tier 1** prices of the
first building of defense type `wall` **with a one-cell footprint** (strongholds
place walls cell by cell, so the tetromino shapes are not used; `bld_wall_block`)
and of the first building of defense type `turret` in the
building content (tier 1 only for now).

### Generation: `generateThreat({seed, round, type, partySize, archetype}, content, {threats, mapgen})`

A pure function. Randomness: `T = Rng.fromSeed(seed).child("threat")
.child(round)` (a string label, then an integer label; nothing is drawn from
the parents), `wavesRng = T.child("waves")`, `holdRng = T.child("stronghold")`.
`partySize` is 1 to `min(maxPartySize, mapgen.maxPartySize)`, and at least the
archetype's `minPartySize` (a boss-only archetype that needs a bigger party,
Bonded with 2, is an error for a smaller one, a `RangeError`, like any
other invalid input; `pickBoss` never offers it then).

1. `B = budget(...)`; `waveBudget = floor(B * waveSharePercent / 100)`;
   `S = B - waveBudget`. **Brood.** An archetype with `brood` sets
   `burstBudget = floor(S * sharePercent / 100)` aside **before** walls,
   turrets and Core health, which use `S' = S - burstBudget` wherever
   steps 7 and the rest say `S` (an archetype without `brood` has `S' = S`).
   **Pylons.** An archetype with `pylons` likewise sets `pylonBudget =
   floor(S * sharePercent / 100)` aside (`S` here is the stronghold budget
   before any set-aside, `B - waveBudget`; the two options are never combined),
   so `S' = S - pylonBudget`; it is spent on the pylons' health in step 7.
2. **Wave sizes.** `s_0 = 100`, `s_(k+1) = floor(s_k * growthPercent / 100)`
   for `k = 0 .. count - 1`; `sum` is their total. Wave `k` has budget `W_k =
   floor(waveBudget * s_k / sum)` (computed as quotient and remainder of
   `waveBudget` by `sum`, so nothing overflows). **Champion.** An archetype
   with `champion` `{unit, healthPercent: H, sharePercent: Q}` first sets
   `C_k = floor(W_k * Q / 100)` aside and uses `W_k - C_k` as the wave's budget
   in steps 3 and 4 (an archetype without `champion` has `C_k = 0`, `W_k`
   unchanged). With `N = partySize`, `c = unitCost[unit]`, `per = floor(C_k /
   N)` and `full = floor(c * H / 100)`: the wave's champion health percent is
   `h_k = H` if `per >= full`, else `max(100, floor(per * 100 / c))`. (So it
   is never below a plain unit's health and never above `H`; what `C_k` buys
   beyond `H` or beyond the floor of 100 is not spent on anything.) The
   champion's price ignores the strength percent of step 5.
3. **Composition.** For wave `k` (0-based): if the archetype has a `signature`
   and `(k + 1) mod everyNthWave = 0`, the composition is the signature unit
   alone (weight 1, no random draw). Otherwise each entry's weight becomes
   `floor(weight * 100 * (100 + d) / 100)` with `d = wavesRng.nextInt(2J + 1) -
   J`, `J = compositionJitterPercent` (20): one draw per entry, in wave order
   then composition order. (If all weights became 0 the template weights are
   used.)
4. **Ranged mix** (`rangedMix` in `threats.json`, optional: `{fromRound,
   archerUnit, archerPercent, droneUnit, dronePercent}`, shipped 4, archer 25,
   drone 15). In a round `>= fromRound`, each wave that is not a signature wave
   sets aside `A = floor(W_k * archerPercent / 100)` and `D = floor(W_k *
   dronePercent / 100)`; the composition entries then share `W_k - A - D`. A
   running pool per kind starts at 0 for the threat; each such wave adds its
   `A` (`D`) to the pool and takes `floor(pool / cost)` whole archers
   (drones) out of it (the pool keeps the rest). The last non-signature wave
   instead takes `floor((pool + floor(cost / 2)) / cost)`, i.e. rounds to the
   nearest unit, and the pool may go slightly negative; so the mix can spend
   up to half a unit's price more than was set aside, and the total wave cost
   can exceed the wave budget slightly (by up to about one archer plus one
   drone). Two entries are appended after the composition entries (archer,
   then drone), also when their count is 0. Rounds before `fromRound` and
   signature waves are exactly as without the mix. It draws no random numbers.
   Wave units get no ramp bonus (the ramp rule "A unit of a scheduled PvE wave has no producer"), so these are
   plain units.
   **Unit counts.** The budget of an entry is `floor(W_k * weight / weightSum)`
   (same overflow-safe division) and its ideal count `n = floor(that / cost)`.
   If every entry of a wave has `n = 0`, the entry with the highest weight
   (first on ties) gets 1: every wave has at least one unit.
5. **Strength conversion.** `cap = maxUnitsPerWavePerPlot * partySize` (12 per
   plot; for an archetype with `focus`, whose wave puts all its units in one
   plot, `cap = maxUnitsPerWavePerPlot * min(partySize, focusCapPlots)`, 24 at
   most: a party of 4 meets fewer, stronger units in one lane, the rest of the
   budget becoming `unitStrengthPercent`; for an archetype with `champion`, `cap` is `N` less, the champions that
   every wave has, which are never scaled: `m` is the largest wave without them,
   so a wave has at most `maxUnitsPerWavePerPlot * partySize` units with them). Let `m` be the largest wave (sum of `n` over a wave's entries). If `m
   <= cap`, `unitStrengthPercent = 0`. Otherwise `unitStrengthPercent =
   ceil(100 * m / cap) - 100`, and every `n` becomes `floor(n * cap / m)`; a
   wave left with no unit gets 1 of its first entry. A ranged entry (archer or
   drone unit of `rangedMix`) that had `n > 0` before scaling and is `0` after
   it gets 1, but only while the wave's total stays below `cap`. So the largest
   wave has at most `cap` units, each `(100 + P) / 100` times as strong, and total wave
   power (units times strength) stays within a few percent of the wave
   budget (rounding, the one-unit minimum), while the unit count stays small
   however high the budget grows. The strength is applied to health and damage
   as in `unitStats`.
   **Bursts** (only with `brood`; `T` thresholds, `N = partySize`). The
   burst budget is split over the `N * T` slots, slot `i = core * T + j` (Core
   `core`, the archetype's `j`-th threshold: Core-major, thresholds in the order
   listed): `b_i = share(burstBudget, i)` with the `share` of step 7 taken over
   `N * T` instead of `N` (`floor(burstBudget / (N*T))`, plus 1 for the first
   `burstBudget mod (N*T)` slots). A burst becomes units exactly as a wave of
   budget `b_i` does with the archetype's `composition` at its template weights:
   no jitter, no signature, no ranged mix, no random draw; the budget of an
   entry is `floor(b_i * weight / weightSum)` (overflow-safe as in step 2), its
   count `floor(that / cost)`, and a burst whose every count is 0 gets 1 unit
   of the highest-weight entry (first on ties). Each burst then counts as
   **one wave for the strength conversion**: `m` in step 5 is the largest of
   all waves **and** bursts, `cap` is the same, and every burst's counts are
   scaled with the waves' (same `floor(n * cap / m)`, same minimum of one unit
   of the first entry). `stronghold.bursts` lists, for each slot in slot order,
   each composition entry with a count above 0, as `{core, thresholdPercent,
   unit, count}`.
6. Waves are listed per wave tick (`firstTick + k * intervalTicks`), one entry
   per composition entry (and per appended archer or drone entry) with a
   non-zero count. With `champion`, each tick's first entry is `{tick, unit:
   champion unit, count: partySize, healthPercent: h_k}`, before the composition
   entries (so the champions queue first and enter first, see "Side options",
   `scheduledWaves`).
   **Focus plots** (only with `focus`; `N = partySize`; one entry per wave tick,
   `k = 0 ..` in tick order; `F = wavesRng.child("focus")`, a child label drawn
   from nothing else, so `wavesRng`'s own draws are untouched): `plot_0 =
   F.nextInt(N)`; for `k > 0`, `r = F.nextInt(N - 1)` and `plot_k = r + 1` if
   `r >= plot_{k-1}`, else `r` (never the plot of the wave before). With `N = 1`
   every `plot_k = 0` and nothing is drawn. Every entry of tick `k` (the
   composition entries and the appended archer and drone entries) gets
   `plot = plot_k`.
7. **Stronghold** (`N = partySize`, `share(total, p) = floor(total / N) + (1 if
   p < total mod N else 0)`).
   - `wallsTotal = min(floor(floor(S' * wallSharePercent / 100) / wallPrice),
     maxWallsPerPlot * N)` (for the `maze` layout the cap is
     `layouts.maze.maxWallsPerPlot * N` instead); `turretsTotal` likewise with the turret price and
     `maxTurretsPerPlot`. Plot `p` may place up to `share(wallsTotal, p)`
     walls and `share(turretsTotal, p)` turrets.
   - For `p = 0 .. N - 1` in order, with the random stream `holdRng.child(p)`
     (an integer label; nothing is drawn from `holdRng` itself), the
     archetype's layout (below) is computed on a board that is one plot
     (`plotWidth` by `plotDepth`) around that plot's Core, then every position
     is moved by `p * plotWidth`. So `ring` and `open` are one set per plot,
     and `line` has its one gap per plot, drawn from that plot's stream.
   - **Pylons** (only with `pylons`; after the layouts of all plots, before
     Core health). Let the *occupied* cells be the Core footprints, the placed
     walls and the placed turrets of all plots (gap cells are free). For plot
     `p = 0 .. N - 1` in order, with the stream `holdRng.child(p).child
     ("pylons")` (a fresh stream, so the layout draws above are untouched),
     `perPlot` sectors `s = 0 .. perPlot - 1` and the plot's Core footprint:
     the **candidates** are the cells of the plot's own columns
     (`p * plotWidth .. (p + 1) * plotWidth - 1`) with `0 <= y <= plotDepth - 2`
     (never the front row), not occupied, and at Chebyshev distance `d` from
     the footprint with `minDistance <= d <= maxDistance` (the distance of the
     layouts' `turretMinDistance`: 0 inside the footprint). A candidate's
     **sector** is `floor(perPlot * pos / (8 * m))` with, for the offset `(vx,
     vy) = (2 * x - cx2, 2 * y - cy2)` from the Core's centre (`cx2 = 2 *
     coreX + coreWidth - 1`, `cy2` likewise, so both stay integers; local
     plot coordinates), `m = max(|vx|, |vy|)` and `pos` the position along the
     clockwise walk round the square of half-side `m` that holds the cell,
     starting at its back-left corner `(-m, -m)` (`y = 0` is the back): the
     first matching of `vy = -m: pos = vx + m`; `vx = m: pos = 3m + vy`; `vy =
     m: pos = 5m - vx`; else (`vx = -m`) `pos = 7m - vy` (`pos` runs over `0 ..
     8m - 1`). So the sectors are `perPlot` equal arcs of the ring round the
     Core, the first starting at the back-left corner. For each sector in
     order: list its candidates by `(y, x)`, shuffle them once with
     `rng.shuffle` (also when it has one), and take the first that is still not
     occupied (an earlier pylon of this plot took a cell) and does not **seal
     the Core**; a sector with no such cell gets no pylon. *Sealing:* the
     check builds the arena of the stronghold as the battle does (the boss
     board as side 0, an empty party board below it with no gap rows; the
     Cores, walls and turrets placed so far as buildings, a pylon as a
     building) and asks the movement field of the party's side towards that
     plot's Core (`computeField(arena, 1, p)`, the goal being the Core, not
     its pylons): the candidate is refused iff, before it, some front-row cell
     (`y = plotDepth - 1`, any column) had a distance and, with it added, no
     front-row cell has one. (If the walls and turrets alone already seal the
     Core, every candidate passes.) A pylon taken is added to the occupied
     cells at once, so the later sectors and plots see it.
     The result is sorted by `(y, x)`; let `n` be its length and `P` the
     pylon budget. If `n > 0` the `i`-th (in that order) has `health =
     min(MAX_HEALTH, max(1, share'(P, i)))` with `share'` the `share` formula
     over `n` instead of `N`; if `n = 0` the whole `pylonBudget` is returned to
     the Core health below (`S' + P`). The pylons are not walls or turrets for
     the totals above and take no part in `spent`: their budget is spent (set
     aside) in step 1. The content's pylon tiers (`bld_pylon`: health 100, 200,
     400) are only the placed building's own stats, which the side option
     replaces.
   - `spent` is the price of everything placed, over all plots. `total =
     max(minCoreHealth * N, floor((S' - spent) * coreHealthPerBudget / 100))`
     (`S' + P` instead of `S'` when no pylon was placed):
     every unspent point of the stronghold budget (after the burst share), including what a full
     layout or the building caps could not absorb, becomes Core health. It is
     split evenly: `cores[p].health = share(total, p)`, so the shares differ by
     at most 1, the extra points go to the lowest plot indices, and they add
     up to `total` exactly. The total is computed by the same formula as with one Core, but its floor is `minCoreHealth * N` (the minimum is per Core, not for the whole stronghold) and `spent` now comes from the per-plot layouts, so it is not the old total.
8. **Content bounds.** After steps 1 to 7: each `cores[p].health =
   min(MAX_HEALTH, cores[p].health)` and `unitStrengthPercent =
   min(unitStrengthPercent, L)`, where `L` is the smallest
   `maxStrengthPercent` over all unit types (see "Content bounds"; for a
   `champion` also at most the largest `P` that keeps the champion's health
   after its health percent within `MAX_HEALTH`). The unit
   counts are not changed; the excess strength or health budget is lost (when
   a Core is clamped the Cores no longer add up to `total`). This is only a
   safety net: with the shipped content neither clamp is reached in rounds 1
   to `maxThreatRound` (see "Content bounds").
9. **Shared health** (only with `linkedCores`). `stronghold.sharedHealth` is
   the sum of the final `cores[p].health` (after step 8's clamp). Nothing else
   about the profile changes: Bonded spends the budget exactly as the
   Boss does (waves, walls, turrets, Core health, one Core per plot at the
   layout's position, health split as in step 7); only the battle reads the
   Cores as one pool.

### Layouts (in `threat-layouts.ts`; parameters in `threats.json`)

All in the board coordinates of one plot, which `generateThreat` shifts by
`p * plotWidth` for plot `p` (step 7). The Core footprint is 2 x 2; the Core's
`x` is `floor((plotWidth - 2) / 2)` (the middle of the plot), its `y` the
layout's `coreRow`. No building uses the front row. "Turrets" are picked by
`pickTurrets`: candidates are grouped by an ascending key, each group is listed
by `(y, x)`, and while turrets are still needed the next group is shuffled
with `holdRng.shuffle` and its cells taken from the front.

- **`open`**: no walls. Turret candidates: all cells at Chebyshev distance
  (from the Core footprint) at least `turretMinDistance`, key = that distance.
- **`ring`**: ring `k` (from 1) is the square perimeter at Chebyshev distance
  `firstRingDistance + (k - 1) * ringSpacing` from the Core footprint, with a
  gap of `gapWidth` cells in the middle of each of its four sides. Walls fill
  ring 1 first, then ring 2, ...; cells outside the board or on the front row
  are skipped; inside a ring the priority is: higher `y`, then nearer the Core's
  middle column, then lower `x`. Turret candidates as for `open`, minus walls
  and the gap cells of the rings that hold a wall.
- **`line`**: a wall line across the whole board on row `lineRow`, up to
  `maxRows` rows (`lineRow`, `lineRow - 1`, ...), with one gap of `gapWidth`
  cells per plot. The gap of plot `p` starts at `p * plotWidth + gapMargin +
  holdRng.nextInt(plotWidth - 2 * gapMargin - gapWidth + 1)`; these draws (one
  per plot, in order) come first. Walls fill row `lineRow` first, then the next
  row; inside a row the cells nearest to a gap come first, then lower `x`.
  Turret candidates: cells below `lineRow` (any `y < lineRow`), not in a gap
  column, not on a wall, at Chebyshev distance at least `turretMinDistance`
  from the Core; key = `lineRow - y`.

- **`maze`** (issue #432): `rows` wall rows across the plot on `y = firstRow -
  k * rowSpacing`, `k = 0 .. rows - 1` (row 0 is the front-most), each with one
  gap of `gapWidth` cells at the left end (`x = 0 .. gapWidth - 1`) or the
  right end (`x = plotWidth - gapWidth .. plotWidth - 1`) of the plot; the sides
  alternate row by row. The side of row 0 is the **first draw** of
  `holdRng.child(p)`: `nextInt(2)`, 0 = left, 1 = right. Walls fill row 0
  first, then row 1, ...; inside a row the cells nearest to the gap come first
  (by distance to the gap's inner edge), then lower `x`; so a small budget gives
  a partly filled front row, and a bigger one a longer maze, never a sealed one
  (each row keeps its gap).
  *The path.* Over the cells of rows `0 .. plotDepth - 2` that hold no wall, a
  breadth-first search with 4 moves (order `y + 1`, `y - 1`, `x - 1`, `x + 1`)
  from the Core's four cells gives each cell its step distance `d`. The
  **entrance** is the cell of the front-most free row (`y = plotDepth - 2`)
  with the least `d`, ties to the lowest `x`; if no cell of that row has a
  distance the layout throws a `RangeError` (a sealed maze is a content
  error). The path is the entrance, then repeatedly the first neighbour (same
  move order) whose `d` is one less, down to the Core; the entrance has index
  0.
  *Turrets.* Candidates are the cells with `y < firstRow` that are on none of
  the `rows` wall rows (the whole row, whether or not it holds walls), not on
  the path, not in the Core, at Chebyshev distance at least `turretMinDistance`
  from the Core, and within Chebyshev distance 1 of at least one path cell;
  key = the least path index among the path cells within distance 1. They are
  picked by `pickTurrets` with the same stream (after the side draw), the entrance
  group first. A turret is never on the path, so turrets cannot seal the maze.
  Shipped: `coreRow` 0, `rows` 4, `rowSpacing` 3, `gapWidth` 2, `firstRow` 13,
  `turretMinDistance` 2, `maxWallsPerPlot` 88 (4 rows of 22).
  A unit's own movement field (8 moves, see "Goals and movement fields") finds
  its way through the gaps; walls are only attacked when a field is sealed, which
  a maze never is.

Every layout is computed once per plot around that plot's own Core, so a
`ring` on a wide board is one ring set per plot (cells outside the plot are
skipped, as cells outside the board are).

Snapshot of a Fortress stronghold (round 8, medium, party size 1; `D` walls and
turrets, `C` the Core, the front row on top):

```
........................
........................
........................
........................
.....DDDDDD..DDDDDD.....
.....D............D.....
.....D............D.....
.....D..DDD..DDD..D.....
.....D..DDDDDDDD..D.....
.....D..D......D..D.....
.........D.CC.D.........
...........CC.D.........
.....D..DD....DD..D.....
.....D..DDD.DDDD..D.....
.....D..DDD..DDD..D.....
........................
```

Snapshot of a full Maze stronghold (round 15, hard, party size 1, 94 buildings:
88 walls and 6 turrets; `D` walls and turrets, `C` the Core, the front row on
top; the first row's gap is on the left, so units walk along the front to
`x = 0, 1`, go through, walk right along the next corridor to `x = 22, 23`,
and so on; the six turrets stand next to the path in the second corridor):

```
...........CC...........
...........CC...........
........................
........................
DDDDDDDDDDDDDDDDDDDDDD..
........................
........................
..DDDDDDDDDDDDDDDDDDDDDD
........................
........................
DDDDDDDDDDDDDDDDDDDDDD..
D.......................
D.DDDD..................
..DDDDDDDDDDDDDDDDDDDDDD
........................
........................
```

**Notes for a port (Maze):** the layout needs a 4-move breadth-first search and
the move order above; the only random draws are `nextInt(2)` for the first row's
side, then `pickTurrets`; row order, gap sides and the cell order inside a row
are fixed by the rules, so the walls need no randomness. The generator's wall
cap for this layout is its own `maxWallsPerPlot`.

### The stronghold as a team state

`buildStronghold(profile, content, mapgen)`: a board of `partySize * plotWidth`
by `plotDepth` with no features and no nodes (`createTeamState`), the Core
with every Core placed with `placeCore(p, x, y)` (each lies inside its plot),
then each building with
`addToStash` (owner = the plot it stands in) and `placeFromStash`. Any rejection
throws: a threat whose stronghold cannot be built is a generator bug.

### Choosing and summarising

`pickArchetypes(seed, round, threats, previous)`; `previous` is the list of
archetype IDs offered in the previous round's PvE options (empty in round 1).
1. `eligible` = the archetypes with `bossOnly` false and `fromRound <= round`
   (absent means 1), in file order. If that is empty, the archetypes with
   `bossOnly` false, and if that is empty too, all archetypes.
2. `fresh` = `eligible` without the IDs in `previous`; `stale` = the rest of
   `eligible`; both in file order.
3. `rng = Rng.fromSeed(seed).child("archetypes").child(round)`. `order` =
   `rng.shuffle(fresh)` (one `nextInt` per swap from the end; nothing is
   drawn when `fresh` has fewer than 2 entries). If `order` has fewer than 3
   entries, `rng.child("stale").shuffle(stale)` is appended (child streams do
   not advance `rng`). With 3 or more fresh archetypes only the first three are
   used.
4. `easy`, `medium`, `hard` take `order[0]`, `order[1]`, `order[2]`, each index
   taken modulo `order.length` (wrapping around if there are fewer than
   three). With three or more eligible they are distinct.
Result: when enough types are unlocked, no type repeats from the round before
(six eligible: none shared; four: two shared, the fewest possible). With only
three eligible types, `fresh` is empty from round 2 on and the offer is a
shuffle of the same three, but now drawn from the `"stale"` child stream, not
from `rng`: the order differs from versions before #430. Golden kind
`archetype-pick`: input `{seed, round, previous?, archetypes?}`, result
`{easy, medium, hard}`; `archetypes` (`{id, bossOnly?, fromRound?}`, `bossOnly`
default false) replaces the shipped archetypes in that vector. Notes for a
port: keep `fresh` and `stale` in file order before shuffling, shuffle from the
end with `nextInt(i + 1)`, and use the child stream label `stale` exactly.
`pickBoss({round, partySize, previousBoss?}, threats, rng)` (MM-9b, MM-9c)
chooses the boss of a PvP round with no ghost. Eligible: the archetypes with
`bossOnly` true, `fromRound <= round` and `minPartySize <= partySize`, in file
order (if the file has no boss-only archetype, every archetype, in file order).
If more than one is eligible, `previousBoss` is removed from the list (if it is
not in it, nothing is removed); if exactly one is eligible it is kept even when
it is the previous boss. The result is `list[rng.nextInt(list.length)]`, one
draw from `rng`. Pure. Golden kind `boss-pick`: input `{seed, round, partySize,
previousBoss?, archetypes?}`, `rng = Rng.fromSeed(seed).child("boss")`, result
`{boss}`; `archetypes` (`{id, bossOnly?, fromRound?, minPartySize?}`, `bossOnly`
default true, the others default 1) replaces the shipped archetypes in that
vector (each takes the waves and stronghold of the first shipped one).
`threatSummary(profile, content)` returns `{archetype,
type, level (easy 1, medium 2, hard and boss 3), totalUnits, firstWaveTick
(null if no waves), coreHealth (the total over the Cores), cores (their
number), walls, turrets}`.

### PvE battles

`startPveBattle({team, threat, seed, round}, content, {sim, mapgen})` and
`simulatePveBattle(...)` (`round` as for `startBattle`: the guards of the
zone's points scale with it; the session passes the run's round, the golden
kind and the tools the threat's) extend `startBattle`/`simulateBattle` (they call
`startBattle`; there is no second tick loop). Side 0 is the party, side 1 the
threat (so it is the defender, who wins no tie). The stronghold is built as
above and becomes side 1's team state; side 1 gets the side options
`scheduledWaves` = `profile.waves`, `freePower` = true, `unitStrengthPercent`
= `profile.unitStrengthPercent` and `coreHealths` = the Cores' `health` values
in plot order.
The neutral zone is generated from the battle seed exactly as for any battle.
A party whose board width differs from the threat's gives `party_size_mismatch`.
The party wins only when every stronghold Core is destroyed (or by the
tiebreak ladder, Overload and the time limit, as in any battle). Wave units
follow the unit targeting rule (PP-11): a unit's owner is the plot of the
column it enters and its first target is the Core opposite that plot (the Core
of the party plot it faces), so each wave heads for the Core of the area it
enters. The result, summary and event log have the shape of a ghost battle; the handle
and the simulation result also carry the `threat`. Wave spawns are
`unit_spawned` events with `building = 0`.

Snapshot of a Rusher wave arriving (round 12, medium, against the rush
reference board, tick 101: the five units of the first wave, spread across the
width on the threat's front row, which is arena row 23; the threat is on top,
`cc` is its Core):

```
........................
........................
........................
...........cc...........
...........cc...........
........................
........................
........................
........................
........................
........................
........................
........................
........................
........................
...1......11.......1..1.
........................
..............%%........
..............%.........
........................
```

### Reference boards

**Status (#124).** This section describes the code on `main`. The rules
below are specified in "Appendix: the per-player design (issue #124)" and
changed this section; all of them are implemented.

| Rule | Change to this section | Status |
| ---- | ---------------------- | ------ |
| PP-6 | The boards are rebuilt as supply-limited boards (each building's need against its collectors' rates), all of one shop value. Since issue #130 the production step caps every producer at its top speed. | **implemented** (issue #145): rush, fortify and siege each cost 330 gold and form the circle of CB-21, every battle ending with a destroyed Core. Measured with `pnpm sim batch --count 20 --seed 1` (seeds 1 to 20, the first board is the party): rush beats siege 18 of 20 (siege first: rush wins 17 of 20), fortify beats rush 20 of 20 (rush first: fortify wins 20 of 20), siege beats fortify 17 of 20 (fortify first: siege wins 18 of 20) |

`reference-boards.ts` and `reference-boards-siege.ts` (importable by later
tools; not test modules): four solo boards as `team-state-ops` scripts on the
map of seed 5 (party size 1), Core at (11, 5). Rush, fortify and siege each have
a shop value of 330 gold: **rush** (tier 3 extractors on the Ore nodes at
(10, 1) and (21, 4), each feeding a tier 3 barracks directly, a tier 1
extractor on (8, 8) feeding a tier 1 barracks, and five walls, four at tier 2
and one at tier 1, in front of the Core), **fortify** (two tier 2 turrets, each
powered through a conduit by its own tier 2 extractor on a Power node; a tier 2
extractor feeding a tier 2 barracks and another feeding a tier 2 armory; ten
walls around the Core, three at tier 2 and seven at tier 1) and **siege** (a
tier 3 extractor feeding a tier 3 barracks, a tier 2 extractor feeding a tier 2
armory, a tier 2 extractor feeding a tier 2 range and a tier 1 extractor on a
Power node feeding a tier 1 hangar, each directly; no walls). **poor** is the
starting kit placed badly: one extractor far from its barracks over a 17-cell
conduit, one extractor with no conduit, an unpowered turret and three walls in
a back corner. Supply: each collector feeds one producer of its own tier (tier 3
one item per 10 ticks against five per 50 for the barracks; tier 2 one per 14
ticks against five per 70 for the barracks and the armory and six per 75 for
the range; tier 1 one per 20 ticks against five per 100 for the barracks and
eight per 120 for the hangar), so the range and the hangar run at about 89 and
75 percent of their top speed, and each turret has one collector, so it fires
at half rate. The
armory spends its Ore on a strength bonus for the soldiers spawned later. `ALL_REFERENCE_BOARDS` lists them in the order rush, fortify, siege,
poor. `referenceBoardScript(name)` (the original three) and
`anyReferenceBoardScript(name)` (all four) give the script,
`buildReferenceBoard` and `buildAnyReferenceBoard` build the state.

**Board files.** `boards/<name>.json` holds each board as plain JSON:
`{name, description, mapSeed, partySize, team}` where `team` is a team state
(`schemas/team-state.schema.json`, whole-state validation as in "Whole-state
validation"). A bare team state is also accepted by the command-line runner. A
test requires each file to equal what its script builds; `pnpm boards:export`
rewrites the files.

### Text templates

Presentation text (not simulation) refers to a resource as `{res_x}`, where
`res_x` is a resource ID (lowercase letters, digits and underscores after
`res_`). `formatText` replaces each placeholder with that resource's display
name and leaves all other text unchanged; an unknown ID is an error.
`placeholderIds` lists the IDs mentioned, in order, with repeats. Resource
display names exist only in `content/resources.json`.

### Command-line runner

`pnpm sim` (in `packages/tools`; see the README) is a thin shell over the rules
above and adds none. Conventions it fixes: in `battle` the first board is side
0 (the party, "A") and the second side 1 (the defender, "B"); in `pve` the
party is side 0; `batch` runs the battles with seeds `seed, seed + 1, ...,
seed + count - 1` and, against a threat, generates the threat with the same
seed unless a threat seed is given. The event log hash printed is the golden
convention: the hash of the whole event log (see "Golden vectors").

### Golden kinds `threat-gen` and `pve-battle`

`threat-gen`: input `{seed, round, type, partySize, archetype}`; result
`{profile, hash}` (`hash` = hash of the profile). `pve-battle`: input `{team,
threat, seed, coreHealths?}` (`coreHealths`, test only: replaces the generated
starting health of the stronghold Cores by player index, so a Core can fall
fast enough to cross several burst lines in one tick) with `team` a `team-state-ops` script and `threat` a
`threat-gen` input; result `{ok: true, result, summary (without timeline),
threatHash, zone, stateHash, events}` or `{ok: false, error: {code, message}}`;
the event log is the vector's event log. Vectors: `golden/threat-gen.json`
(every archetype at rounds 1, 5 and 10, a four-plot Escalator, a round beyond
the budget clamp) and `golden/pve-battle.json` (each reference board against
each archetype at round 1, and two battles the party loses) and
Brood vectors (issue #398): three `threat-gen` cases for `arch_boss_brood`
and three `pve-battle` cases (the four-plot party at round 3; one Core set to 12
health so two bursts fire in one tick; four Cores set to 7, 10, 3 and 12 with
a Core destroyed by a hit that crosses all its lines) and
`golden/reference-matrix.json` (the `pve-battle` kind again: the siege board
against each archetype at round 1, and every reference board against each
archetype at round 5 (medium) and round 10 (hard)).

Juggernaut and Coven vectors (issue #434): for each, four `threat-gen` cases
(medium round 3 party 1, medium round 5 party 2, medium round 10 party 1, hard
round 15 party 4) and one `pve-battle` case (`rush-vs-juggernaut-r3`,
`rush-vs-coven-r3`).

Focus vectors (issue #433): three `threat-gen` cases for `arch_focus` (medium
round 5 with party 1, medium round 6 with party 2, hard round 10 with party 4:
the plots, and a cap of two plots with four) and three `pve-battle` cases
(`rush-vs-focus-r3`, solo; `party2-vs-focus-r5`; `party4-vs-focus-r6`).

Bonded vectors (issue #399): three `threat-gen` cases for
`arch_boss_linked` (party sizes 2, 3 and 4; a party of 1 is an error, not a
vector) and six `pve-battle` cases with `team` scripts for two and four plots:
`party2-vs-linked-r5` and `party4-vs-linked-r5` (several Cores hit in the same
tick, all Cores falling in the tick the pool empties), `party2-vs-linked-r5-overkill-once`
(Cores set to 7 and 9: the overkill against the pool, counted once) and three
time-limit cases, `party2-vs-linked-time-limit-pool-share-party-wins`,
`...-pool-share-boss-wins` (rung 2 reading the pool) and
`...-time-limit-cores-standing` (rung 1). The time-limit cases use two test-only
inputs of the `pve-battle` kind: `coreHealths` (above) and
`partyCoreHealthPercent`, a `core_health_percent` run modifier on the party's
team so its Cores outlast the Overload decay. The `boss-pick` vector 2 now
draws `arch_boss_linked` (it joined the eligible bosses at round 5 with four
players).

Pylons vectors (issue #400): three `threat-gen` cases for `arch_boss_pylons`
(`boss-pylons-r7-solo`, `-r12-party3`, `-r30-party4`) and four `pve-battle`
cases: `rush-vs-pylons-r7` and `rush-archers-vs-pylons-r7` (the soldiers, then
the archers, take the three pylons before the Core, `core_shield_down` and
then `core_destroyed`), `party2-vs-pylons-r7` (two Cores with their own
pylons, the shields falling at different ticks) and
`core-only-vs-pylons-r1-overload-ignores-shield` (a party with only a Core,
given 100000 percent more health: the pylons stand to the end and the Overload
decay destroys the shielded Core at tick 2400). No vector has a
`core_hit_blocked` event: the decision rules never aim at a shielded Core, so
only a unit test of the event schema covers it. `boss-pick` vector 2 draws
`arch_boss_linked` as before (its description now lists
`arch_boss_pylons` among the eligible bosses at round 7), and vector 18 is
new (round 7, solo: Brood or Pylons, here Pylons).

Warlord vectors (issue #401): four `threat-gen` cases for `arch_boss_warlord`
(`boss-warlord-r9-solo`: every champion a plain Golem because the share cannot
buy more; `-r12-solo` and `-r20-solo`: the health percent rising with the wave
size up to 600; `-r30-party4`: four champions per wave at the full 600, cap
11 per plot for the rest) and two `pve-battle` cases (`rush-vs-warlord-r9`,
`rush-vs-warlord-r20`). `boss-pick` is unchanged: the Warlord joins the
eligible bosses at round 9 and no vector draws a boss from round 9.

### Decided simplifications

- Tier 1 buildings only, and the first one-cell wall (`bld_wall_block`) and
  the first turret building in the content, for the stronghold.
- Strength is one number for all waves of a threat (not per wave).
- Stronghold turrets are always charged (`freePower`), so there is no way to
  starve them; the wall and turret caps per plot keep the building count low.
- A wave unit that finds no open front-row cell is not spawned.

## Performance budget

**Status (#124).** The budget document describes the code on `main`. Its
baseline (issues #164 and #123) is measured on the per-player design: a legal
dense four-plot board (PP-1 and the plot's node count, unit counts under
PP-6, one movement field and one breach field per living enemy Core under
PP-11), beside a stress board that no player can build.

See `docs/performance-budget.md` (CB-36, W1-10): baseline measurements of
whole battles and the budget the benchmark test enforces (units per side,
battle length, battles per second at one and four plots, event log size).

## Resolution order

What exists so far is the order in which simultaneous flow events resolve; all
of it is fixed by the tick order above and uses no random numbers:

- Conduits resolve downstream first, ties by conduit ID; routes in topological
  order of the flow graph (ties by building ID, then channel); sources by
  building ID.
- A merger arbitrates between all its ready inputs, conduit and direct alike,
  with its round-robin pointer (step 0), so when two direct sources are ready
  on the same tick the pointer decides, not the building ID; splitters and
  sources with several outputs alternate with theirs.
- When two things want the same space in one tick, the earlier step wins
  (conduits, then routes, then sources), and within a step the earlier one in
  the orders above.

### Units, combat and destruction

All of it is fixed by "One battle tick" and uses no random numbers. Every tie is
broken as follows:

- **Same step, many things:** units act in ascending unit `id` (decisions,
  attacks, moves, deaths; the neutral guards have the lowest ids, so they come
  first, and where an order lists the sides, side 2 follows side 1, "Neutral
  guards"); producers in side then building-ID order; buildings
  are destroyed in side then `health`-list order (Core first, then instance
  ID); conduits of a destroyed building are reported in conduit-ID order.
- **Which enemy unit to hit or chase:** the nearest by squared centre distance,
  then the lowest unit `id`, over the enemy sides of the unit (the other side's
  units and the neutral guards for sides 0 and 1; both sides for a guard). A turret picks its target by the squared distance
  from the unit's centre to its nearest cell (ties: lowest unit `id`), only
  among enemy units of the other side on its owner's board rows or the gap;
  guards are never a target.
- **Which building to hit:** an enemy Core when it is within reach (with
  several: the unit's target Core, else the nearest by `buildingDist2`, ties by
  `(|q - opposite(owner)|, -q)`, PP-11); in breach mode
  the building covering the next breach cell.
- **Shielded Cores (MM-9d).** A Core with a standing pylon is not a building
  to hit: its pylons are (rule b), so of the buildings in reach the party's
  unit takes the unit's target Core's pylons first, then the nearest. If a hit
  lands on a shielded Core anyway (the shipped decisions never choose one), it
  does nothing: no damage, no `buildingDamageDealt`, a `core_hit_blocked`
  event after its `unit_attacked`. The shield is read at the start of step 4,
  so a pylon that falls in step 6 of a tick still shields during that tick and
  the Core is hittable from the next one. The Overload decay is not a unit
  hit and is never blocked.
- **Which target Core** (PP-11, `chooseTarget`): the Core opposite the owner's
  plot while it stands; else the smallest `(class, distance, |q -
  opposite(owner)|, -q)`: the nearer by movement field, then breach field,
  then the plot nearer to the opposite plot, then the larger enemy player
  index (the lower column in the unit's own frame).
- **Which way to step** (equal distance or equal cost) and **where to spawn**
  (equal distance): the lowest `y`, then the lowest `x`, in the board frame of
  the unit's own side (the tie key). Equal-length shortest paths are therefore
  resolved cell by cell by this rule, never by search order.
- **Who yields when units collide:** by the weights of step 5.3.1: nobody
  pushes an enemy fighter; a waiting ally gives way completely to a moving or
  fighting ally; a mover and a fighting ally split the push 2 : 1; two
  allied fighters each take the whole push; anything else shares equally.
  Coinciding centres separate along both axes, towards negative for the lower
  id of one side and by side for units of different sides.
- **Order of damage modifiers (CB-5h):** a hit on a unit takes these steps,
  in this order, each on the result of the one before: (1) the attacker's
  damage, fixed at spawn with `unit_strength` (`unitStats`); (2) Overload
  escalation, `mulPct(damage, 100 + level * overloadDamageStepPercent)`; (3)
  the splash percent for a secondary target, `mulPct(hit, percent)` rounded
  down, where `hit` is the damage after step 2 and **before** the primary
  target's armor (a secondary target's share never depends on the primary's
  armor); a primary target skips this step; (4) the
  target's armor, once per hit: `max(1, hit - armor)` for a hit above 0, a
  hit of 0 staying 0 (each secondary target applies its own armor to its own
  share, so a share of 1 or more is at least 1 after armor). One helper
  (`armorHit`) does step 4 and is applied
  where a hit on a unit is dealt: a unit attack (step 4 of the tick, primary
  and secondary hits) and a
  turret shot (step 3), after Overload, before the hit joins the target's
  summed damage. The armor of a unit is on its definition and is not scaled
  by `unit_strength`. Hits on buildings and Cores are not reduced (they have
  no armor); a neutral guard's hit skips step 2 (Overload does not affect
  guards, CB-8e).
- **Simultaneous attacks:** all damage (unit attacks and turret shots) is
  computed from the same snapshot and applied together; nobody's death during
  the tick changes another unit's or turret's action in that tick.
- **Economy buildings:** charged in side then instance-ID order after the
  turrets; at most one step per building per tick.
- **Turrets:** charged in side then instance-ID order after the unit
  producers; they fire in side then instance-ID order after all unit
  decisions; each picks its own target without seeing the others' (so several
  turrets may shoot one unit, overkilling it); the turret events precede the
  unit attack events of the tick.
- **Spawn order and IDs:** the neutral guards are placed before tick 0, in
  point-id order, so they have the lowest ids; side 0's producers spawn before
  side 1's within a tick, so at equal times side 0's units have the lower IDs. Because the
  relative order of IDs inside a side is the same on both sides, a mirrored
  battle (same team, 180-degree rotated) stays exactly symmetric.
- **Breach routes:** least total cost; equal-cost neighbours by tie key. The
  cost of a building uses its maximum health (tier health raised by the team's health modifiers), not its current health.

## Run random streams

Code: `packages/session/src/rules/streams.ts`, `machine.ts`.

A run keeps one generator, saved in the run state. Its root is
`rootRng(seed) = Rng.fromSeed(seed).child('run')` (see "Child streams").
Every random purpose gets its own stream, found by a label:
`drawStream(state, label)` takes the run generator `g`, derives
`stream = g.child(label)`, then advances `g` by one `nextU32()` and stores
`g`'s state back. So the stream depends on the label and on how many streams
were drawn before it; two draws with the same label differ. Replaying the
same actions from the seed draws the same labels in the same order and gets
the same streams, which is what lets a port reproduce offers, options and
events. The code that uses a stream receives only the child, never `g`.

`r` is the round number and `leg` is `pve` or `pvp`. Labels, in the order the
step machine draws them in a round:

| Label                      | Drawn                                                                   | Used for                                  |
| -------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| `kit`                      | once, entering the first `build`                                            | starting kit                              |
| `pve_options:r<r>`         | on entering the first `build` of round `r`, and on entering the shop that ends round `r - 1` | the PvE options for the battle of round `r` |
| `battle:pve:r<r>`          | when the PvE battle starts                                              | the PvE battle                            |
| `event_offers:r<r>:<leg>`  | on entering `event_choice`                                              | the event offers                          |
| `event_resolve:r<r>:<leg>` | when the chosen event is applied                                        | event outcomes                            |
| `vote:<topic>:r<r>:<leg>`  | each party vote resolution with two or more players (none for one player) | the pick used only when the votes differ |
| `shop:r<r>:<leg>`          | on entering a shop                                                      | shop offers (see "Shops and gold")        |
| `ghost:r<r>`               | when the PvP opponent is selected                                       | the ghost draw (see "Ghosts")             |
| `battle:pvp:r<r>`          | when the PvP battle starts                                              | the PvP battle                            |

The `kit` stream also draws the random wall shapes of the starting kit (see
"Gold").

The order of draws matters because each draw advances `g`. A shop re-roll
does not draw a new run stream: it continues the player's stored shop stream.
Golden vectors: `shop-roll` and `run-replay` (see "Golden vectors") pin the
stream derivation; `prng-child` covers the derivation of a child stream only.

## Shops and gold

Placeholder numbers live in `content/economy.json`; the rules below are what
the code does. Code: `packages/core/src/shop.ts`, `weighted.ts`, `economy.ts`
and `packages/session/src/rules/economy.ts`.

### Gold

Each player has their own gold (an integer, never negative). Gold is spent
only at shops, on buildings and re-rolls. It never appears in the battle
simulation. Each player starts the run with `startingGold` and, once per
player, the `startingKit` buildings in their stash (owner = that player); this
happens when the Core is placed, on entering the first `build` step.

A kit entry is `{def, tier, count}` (`count` copies of one building) or
`{pick, tier, count}` (issue #291), where `pick` is a non-empty list of
distinct building IDs: each of the `count` copies is drawn **uniformly** from
the list, with the `kit` stream (the generator `g.child("kit")` of "Streams"):
one `nextInt(len(pick))` per copy, taking `pick[x]`. Draw order: players in
index order, entries in file order, copies in order; `def` entries draw
nothing. Each copy is its own stash entry (a stash id from the player's
sequence), so three copies of the same shape are three rows. The shipped kit
is 2 Extractors, 1 Barracks, a `pick` of `bld_wall_o`, `bld_wall_t`,
`bld_wall_s`, `bld_wall_z`, `bld_wall_l`, `bld_wall_j` (never the I) with
`count` 3, and 1 Turret, all tier 1. For the ghost value bound, the price of a
`pick` entry is its dearest choice.

### Income

On entering each `shop` step (both shops of every round), every player is paid
`baseIncomePerShop` plus the party's shop income bonus, and their offers are
rolled in the same step. The first `build` step has no income and no offers.

The **shop income bonus** (issue #425) is the sum of the `amount` of every
`shop_income_flat` effect in `TeamState.modifiers` (a Tithe adds 1; whole gold,
checked `addInt`). It is party-wide: every player is paid the same bonus, the
gold stays per player and nothing moves between players (CP-29). A Tithe taken
in an event is paid from the next shop on.

Notes for a port: `income = baseIncomePerShop + sum(amount of shop_income_flat
effects)`, added to each player's gold once per `shop` step.

### Weighted pick

`pickWeightedIndex(rng, weights)`: weights are non-negative integers with a
positive sum `T`. Draw `x = rng.nextInt(T)` (one draw). Return the first index
`i` with `x < w0 + ... + wi`.

### Offer roll

`rollOffers(rng, round, extraOffers)` makes `shopOfferCount + extraOffers`
offers (`extraOffers` is 0 unless a next-shop effect adds offers, see "Next-shop
effects"), for slot 0, 1, ... in order. Per slot, exactly two draws, in this
order:

1. the building: `pickWeightedIndex` over `offerWeights` (file order), where
   an entry whose `fromRound` is greater than the current round has weight 0
   (see "Offer weights from a round" below) and an entry that names a
   `specialist` other than the one of the player being rolled has weight 0
   (see "Signature buildings" below);
2. the tier: `pickWeightedIndex` over the weights `[w1, w2, w3]` of the
   applicable `tierOdds` row; the result plus 1 is the tier.

Duplicates across slots are allowed. The offer is `{slot, def, tier, price}`
where `price` is that tier's `price` in `buildings.json`, and for a Tunnel
entrance (CB-9g) the **item price** (`itemPrice`): the entrance's tier price plus
its partner's, which is 10 / 22 / 40. Buildings not in
`offerWeights` are never offered; the Core cannot be listed.

**Offer weights from a round (issue #383).** An `offerWeights` entry may have
`fromRound` (integer, at least 1; default 1 when absent). In a roll for round
`r`, every entry with `fromRound > r` has weight 0 in every draw of that roll,
the wall-shape redraw below included; the entry keeps its place in the list,
so file order and the draw count do not change. Because `pickWeightedIndex`
never picks a zero weight (and a zero weight, also at the end of the list,
does not move the draw `x` or the running totals of the others), a gated roll
gives exactly the result of a roll over the list without the gated entries.
The round is the round of the shop being entered (re-rolls use the same
round). At least one entry must have `fromRound` 1, so that the sum of the
weights is positive in every round. Nothing else reads `offerWeights`: the
starting kit and the events do not draw from it. The shipped content sets `fromRound` on its
last nine entries (appended at the end of the list so that rolls of round 1 are
unchanged): from round 3 (issue #383) `bld_foundry` weight 6, `bld_refinery_ab` 4,
`bld_golem_forge` 4, `bld_refinery_bc` 4, `bld_spire` 4; then the new buildings
(issue #443): `bld_lancer_hall` weight 5 from round 2, `bld_tunnel_in` 5 and
`bld_mortar` 4 from round 3, `bld_grand_barracks` 3 from round 5. The Tunnel is
listed by its entrance, `bld_tunnel_in`: one offer is one item, an entrance and
an exit (the exit is never listed). Every other entry has round 1. Measured
over 20 000 rolls of 5 offers: 0.145 offers per shop are new buildings at
round 2 (none at round 1), 0.350 at rounds 3 and 4 (7%; 0.54 more are
refining buildings), 0.411 from round 5 on (8.2%, the same at round 8; 35% of
shops hold at least one). `shop-roll.14` to `shop-roll.16` pin it with a test list given in
the vector input as `offerWeights` (`{def, weight, fromRound?}` entries that
replace the shipped list). _Notes for a port:_ keep the list in file order and
append new entries at the end; the gate is only `fromRound <= round`, so a port
that rolls over the whole list with weight 0 for gated entries and one that
rolls over the filtered list draw the same numbers. `shop-roll.19` to
`shop-roll.22` pin the shipped list at rounds 2, 3, 5 and 8 (issue #443).

**Signature buildings (issue #472; EC-3b).** An `offerWeights` entry may name
a `specialist` (the ID of one of the roster; the entry's `def` is that
specialist's signature building). In a player's roll such an entry has its own
weight if and only if **both** gates hold: `fromRound <= round` and the player's
specialist (`team.specialists[player]`, "Specialists") equals the entry's
`specialist`; otherwise it has weight 0 in every draw of that roll, the
wall-shape redraw included. This is the zero-weight rule of "Offer weights from
a round" with a second condition: the entry keeps its place in the list, so
file order and the number of draws do not change, and a roll for a player who
has no entry of their own (no specialist yet, a team from before specialists, a
specialist whose signature building is not listed) is **exactly** the roll over
the list without the specialist entries: same offers, same draws, same stream
state. A re-roll uses the same player's specialist. The roll takes the
specialist as an argument (`rollOffers(..., extraOffers, specialist)`: the ID or
null); `offerWeightsAt(economy, round, specialist?)` is the one place that
computes the weights, and a call **without** a specialist (the Blueprint and
Caravan pools, which belong to no one's own shop) gives every specialist entry
weight 0, so no event ever offers or holds a signature building (EC-3b).
Entries of other specialists in the same list do not move any draw. The
shipped `economy.json` lists a signature building for each specialist whose own
step of #468 has landed: from issue #473 the **Mana Well** (weight 12, `fromRound`
2, `specialist` `spec_flowmancer`; "Specialists", "The Mana Well"), the others
come with their steps (the **Rune Ward** from issue #474: weight 12, `fromRound` 2,
`specialist` `spec_wardsmith`; the **Familiar Roost** from issue #475: weight 12,
`fromRound` 2, `specialist` `spec_beastbinder`; the **Transmuter** from issue
#476: weight 12, `fromRound` 2, `specialist` `spec_alchemist`, as EC-3b
decides). A roll for a player who has no entry of their own is
exactly the roll over the list without the specialist entries, so only the
Flowmancer's shops from round 2 differ from before #473, from #474 the
Wardsmith's too, from #475 the Beastbinder's and from #476 the Alchemist's.
`shop-roll.31` (the shipped list at round 2: the Transmuter is on offer to the
Alchemist only) and `shop-roll.32` (round 1: none yet) pin the Transmuter's
entry. `shop-roll.23`
(three players, the Flowmancer, another specialist and none, with a test list
holding a Mana Well entry for the Flowmancer from round 2), `shop-roll.24`
(round 1: gated by round), `shop-roll.25` (players without the entry roll as if
it were not in the list) and `shop-roll.26` (the shipped list with a
specialist: equal to `shop-roll.20` until issue #475, which gave the Beastbinder
its own entry, so it now differs) pin it; `shop-roll.27` (the shipped list
at round 2: the Mana Well is on offer to the Flowmancer only) and `shop-roll.28`
(the shipped list at round 1 for a Flowmancer: no Mana Well yet) pin the
shipped entry (issue #473). _Notes for a port:_ the player's
specialist is read from the team state when its shop is entered and when it
re-rolls; nothing is drawn for it, and it does not change `pickWeightedIndex`
(weights still sum with zeros left in place).

**Wall shape limit (issue #291).** A *wall def* is a building of kind `defense`
with `defenseType` `wall`; the Gate (`gate`) is not one. One set of offers (a
first roll, and every re-roll on its own) never holds more than 2 different
wall defs (`MAX_WALL_SHAPES_PER_SHOP`; copies of one def count once, at any
tier). While rolling, keep the set `W` of wall defs of the slots already
rolled in this set (empty at slot 0). For each slot, after draw 1: if the
picked def is a wall def, is not in `W`, and `|W| >= 2`, make **one extra
draw**: `pickWeightedIndex` over `offerWeights` in file order with every wall
def not in `W` removed (the weights of the remaining entries unchanged: one
`nextInt` of their sum); that second pick replaces the first and stands, with
no further check (it cannot be a wall def outside `W`). Then draw 2 (the tier)
as usual. So a slot costs 2 draws, or 3 when the limit redraws. Golden vectors
`shop-roll.12` and `shop-roll.13` pin it.

### Tier odds lookup

`tierOdds` rows are sorted by `fromRound`, starting at 1. The row with the
largest `fromRound` not greater than the current round applies (a round past
the last row uses the last row). The maximum tier is 3, fixed by the building
content.

### Streams

Entering a shop gives the hook the stream `shop:r<round>:<leg>`. Player `i`'s
offers are rolled from that stream's child `p<i>`. The saved state of that
child stream is stored with the offers in `perPlayer[i].shop`
(`{offers, stream}`), so offers exist in the run state before anything is
shown, and reloading or replaying never changes them.

### Buying, selling, re-rolling

- Buy `{slot}`: needs the slot to hold an offer (`no_such_offer` otherwise,
  including a slot already bought) and `gold >= price` (`not_enough_gold`).
  Pays `price`, adds a new stash entry for the buyer (`addItemToStash`), and
  empties the slot until the next roll. Buildings never merge: three identical
  purchases are three entries. **One item can be two buildings (CB-9g):** buying a
  Tunnel (offer `def` `bld_tunnel_in`) adds an entrance and an exit, two entries
  of the offer's tier, the entrance first (consecutive IDs).
- Sell `{id}`: only a stash entry (`not_in_stash` if it does not exist or is
  placed on the board) of the seller (`not_owner` otherwise). Refund =
  floor(tier price x R / 100), with R the sell refund percent: `sellRefundPercent`
  plus the sum of the party's `sell_refund_percent` effects (issue #425), the
  sum capped at 90 when any such effect is held (`R = max(sellRefundPercent,
  min(sellRefundPercent + sum, 90))`, so with none `R` is `sellRefundPercent`
  and selling never refunds the full price through a modifier). Selling is
  also allowed in the first `build` step. A Tunnel's two ends are sold one at a
  time, each as its own stash entry, and each refunds the percent of **its own**
  price, which is its share of the item's price: the entrance has `ceil(P / 2)`
  and the exit `floor(P / 2)` of the item price `P` (content: 5 / 11 / 20 each,
  so selling either end of a tier 2 Tunnel at 50 percent gives 5). The two
  refunds add up to at most the item's refund, and selling one end leaves the
  other as it was.
- Re-roll `{}`: needs `gold >= rerollCost` (`not_enough_gold`). Pays it and
  replaces all of that player's offers with a roll from the next draws of that
  player's stored shop stream (so two re-rolls differ). A re-roll also brings
  back bought slots. While the player has a `free_rerolls` effect (see
  "Next-shop effects") the re-roll costs 0 (the `rerolled` effect then has
  `cost` 0) and uses one of them up. Every roll of the shop, re-rolls included,
  makes `shopOfferCount + extra_offers` offers. While the player has a
  `held_offer` the offers have one more entry after those, the held slot (see
  "Next-shop effects"): a re-roll keeps it as it was.
- Buy and re-roll are legal only in the `shop` step (`wrong_step` elsewhere,
  including the first `build`). None of these can be undone.

### Next-shop effects (RS-4i1)

`perPlayer[i].nextShop` is an OPTIONAL list of `{kind, count}` or `{kind:
"held_offer", def}` (absent means none; the saved format number did not change,
records without it are read as having none). Kinds: `extra_offers` (`count` =
offers more than `shopOfferCount`), `free_rerolls` (`count` = re-rolls that
cost 0) and `held_offer` (`def` = a building ID, Blueprint). At most one entry
per kind; `count` is an integer from 1 to 10. An event adds entries
(counts of one kind are summed, capped at 10) when it is applied, so they are
set before the shop step is entered. The shop reads them: entering the shop
rolls `shopOfferCount + extra_offers` offers from the same shop stream (more
draws of the same stream, the wall-shape limit applying to the whole set), and
each re-roll rolls the same number. A free re-roll takes one off `free_rerolls`
(the entry is removed at 0), so a save and reload in the shop keeps what is
left. The effects are removed for every player when the shop step ends, and
also when the run ends (abandon, defeat). `validateRunState` checks: a list, each entry
either `{kind, count}` with `kind` `extra_offers` or `free_rerolls` and `count`
an integer from 1 to 10, or `{kind: "held_offer", def}` with exactly those two
keys and `def` a building with a purchasable tier 1 that is not a pylon; no
repeated kind; and the key present only in the steps `event_resolve` and
`shop`.

*Held offer* (Blueprint, RS-4i5). The held slot is the slot with index
`shopOfferCount + extra_offers` (the count of the player's `extra_offers`
effect, 0 if none), the first after the rolled offers. Entering the shop rolls
the offers as usual, then, if the player has a `held_offer`, appends
`{ slot: <that index>, def, tier: 1, price: tier 1 price of def }` to `offers`;
nothing is drawn for it, so the shop stream is exactly where it would be
without it. A re-roll rolls the offers (from the stored stream, as usual) and
appends the same entry again while the effect exists, so a re-roll never
replaces it. Buying the held slot is an ordinary buy (the building goes to the
buyer's stash, the slot becomes `null`) and, in the same step, removes the
`held_offer` entry, so it can be bought once and a later re-roll does not bring
it back; the `bought` effect carries `held: true` then (the field is absent on
every other purchase). It is removed with the other effects when the shop step
ends. A save and reload in the shop keeps the entry and the appended offer.

Notes for a port: do not write `nextShop` when it is empty; treat an absent key
as an empty list on load. The held slot is found by index and by the presence
of the effect, there is no flag on the offer; Market day and Blueprint cannot
both apply to one shop today (one event is taken per event step), but the index
rule above gives `shopOfferCount + extra_offers + 1` offers if they ever do.

## PvE options, rewards, events and run modifiers

Code: `packages/core/src/modifiers.ts`, `events.ts`, `economy.ts` (rewards),
`team-state.ts` (`raiseTier`), `arena-sim.ts` (modifiers in the simulation);
`packages/session/src/rules/pve-options.ts`, `rewards.ts`, `events.ts`,
`real-battle.ts`, `replay.ts`, `game-deps.ts`. Data: `content/events.json`
(`schemas/events.schema.json`) and `rewards` in `content/economy.json`.

### PvE options (RS-3, RS-3b, RS-6a)

For the PvE battle of round `r` three options are generated, `easy`, `medium`
and `hard`, and stored in `RunState.upcomingPve = { round, options }`. They
are drawn on entering the first `build` step (round 1) and on entering the
shop that ends round `r - 1` (round `r`), so they exist in state while the
party builds. When `pve_choice` opens they move to `pending.options` and
`upcomingPve` becomes null. Stream `pve_options:r<r>` (`r` is the round of the
battle): `pickArchetypes(rng.child("archetypes").nextU32(), r, threats,
previous)` gives the three archetypes (`previous` below), and each difficulty's threat is
`generateThreat({seed: rng.child(<difficulty>).nextU32(), round: r, type:
<difficulty>, partySize, archetype})`. An option is
`{ id, difficulty, archetype, reward: {gold}, budget, summary, threat }` with
`id = difficulty`, `summary = threatSummary(threat)` and `threat` the whole
profile. The budget multipliers (70 / 100 / 140 percent) and the strictly
increasing `rewards.pveWin` (checked by the loader) make harder options
strictly larger in budget and reward.

`previous` is the `offered` list of the round record of round `r - 1`:
`thisRound.pve` when `RunState.round` is `r - 1` (the options of round `r` are
drawn in the last shop of round `r - 1`), else the `history` entry with
`round = r - 1`; empty in round 1, when that record or its `offered` is absent
(older saves, a round without a PvE record), or when `r` is 1. `offered` is the
list of the `archetype` IDs of the three options (easy, medium, hard order),
set on the PvE record when the PvE battle starts (the vote on `pve_choice` puts
it in `pending` next to `option`, and entering `pve_battle` copies it to the
record); it is omitted when no option has an archetype. It is saved data and
optional (absent means none), so replays and reloads give the same options. A
record's `offered` has at most three strings. Notes for a port: take the
previous round's IDs from the stored record, never from a table in the code.

### Rewards (EC-6, EC-7)

Gold only, per player, paid when the battle's summary step ends (before the
event step). PvE win: the chosen option's `reward.gold`. PvE loss: nothing,
and no life is lost. PvP win: `rewards.pvpWin`. PvP loss: `rewards.pvpLoss`
and `pvpLossLifeCost` lives. The values are in `content/economy.json`
(`rewards.pveWin.easy` / `medium` / `hard`, `rewards.pvpWin`,
`rewards.pvpLoss`; see "Numbers set in the rebalance"). No battle or event adds a building (only shop
purchases and the starting kit do).

### Run modifiers (EC-8)

`TeamState.modifiers` is an optional list `{ id, effects }` in the order taken;
it is omitted (never an empty list) when there are none, so states without
modifiers hash as before. A modifier's effects are copied into the team state
when it is taken. Effects (percent is an integer from -90 to 1000, never 0, a
negative percent being a drawback, RS-4i6; the simulation uses
`floor(value * (100 + sum) / 100)`, summing all effects of a kind and
target held by the side, with the sum first raised to `minModifierSumPercent`
if it is lower, see below). Stackable modifiers have **no cap** (issue #49):
bonuses of the same kind (and target) are summed, then applied once, never
compounded, so each extra stack is worth relatively less than the one before:

| Kind | Applied |
| --- | --- |
| `building_health_percent` (`target`: `all`, `wall`, `gate`, `turret`, `source`, `route`, `unit_producer`, `economy`) | to the maximum (and so the starting) health of matching placed buildings (not the Core; a defense matches its defense type, so `wall` matches every wall shape, issue #291; others their kind; `all` matches every building); at tick 0 in `createArenaSim` |
| `core_health_percent` | to the maximum (and so the starting) Core health (after a side-option Core override) |
| `unit_strength_percent` (optional `units`: unit IDs) | added to the unit strength percent at each spawn (health and damage, see the unit stats seam in "The arena"); side-wide, and it comes only from run modifiers, never from an economy building (PP-8). A unit of type `u` spawns with the sum of the side's effects with no `units` plus those whose `units` list `u`, summed and applied once (never one application per effect). Without `units` an effect applies to every unit type, as before; a battle whose modifiers have no `units` is bit-identical to one before the field existed |
| `unit_move_speed_percent` (optional `units`) | percent 1 to 100; shortens the move cooldown of units of the side at spawn, see "Unit move and attack speed" below |
| `unit_attack_speed_percent` (optional `units`) | percent 1 to 100; shortens the attack cooldown of units of the side at spawn, same section |
| `unit_armor_flat` (`amount` 1 to 10, optional `units`) | added to the armor of units of the side at spawn (issue #426), see "Unit armor and splash modifiers" below |
| `unit_splash_percent` (percent 1 to 100, optional `units`) | added to the splash percent of units of the side with `splash` at spawn (issue #426), same section |
| `poi_capture_speed_percent` (percent 1 to 100, side-wide) | shortens the capture threshold of the side's points of interest (issue #426), see "Capture step" |
| `turret_damage_percent` | to the damage of each of the side's turrets, when the arena context is built |
| `shop_income_flat` (`amount`, not `percent`) | whole gold 1 to 10 added to every player's income per shop, see "Income"; **no effect in battle** |
| `sell_refund_percent` | percent 1 to 90 added to `sellRefundPercent` for every player's sales, capped at a sum of 90, see "Shop"; **no effect in battle** |

**The sum floor** (EC-8). `minModifierSumPercent` (`sim.json`, an integer from
-99 to 0, shipped -50) bounds the sum: `sum = max(sum, minModifierSumPercent)`,
taken per kind and target (for `building_health_percent` the sum of the effects
whose target is `all` or the building's defense type or kind; for
`unit_strength_percent` per unit type: the untargeted effects plus those
listing the type), before `floor(value * (100 + sum) / 100)`. Only the
modifier sum is clamped: the side's base `unitStrengthPercent` and the ramp
bonus are added after it. A sum that is not below the bound is unchanged, so a
battle whose modifiers are all positive is bit-identical to one before
negative effects existed. The check at setup (`createArenaSim`: the largest
strength per unit type, health and damage bounds) uses the clamped sum.
`maxHealthOf`, `coreMaxHealth` and the turret damage take the bound as an
argument (from `SimConfig`), so the Build screen's preview and the simulation
agree.

Each side's modifiers come from its own team state (`TeamState.modifiers`):
the party's from the run, and a ghost from `findPvpOpponent` brings its own,
which apply to side 1. Generated threats (PvE options and the PvP boss) have
none. An extractor-speed kind is not implemented as a run modifier; the
specialist's `source_speed_percent` (issue #471) is an owner-scoped effect, not
a modifier. A specialist's `building_health_percent` is summed with the
modifiers above for its owner's buildings and applied once ("Specialists").

**The modifier list** (issue #423; numbers are proposals, see EC-8 in the
spec). Definitions are in `content/events.json`, in file order, with an
optional `fromRound` (the first round the Shrine may offer it, default 1):

| Modifier | Effect | Stacks | `fromRound` |
| --- | --- | --- | --- |
| `mod_stout_walls` | `building_health_percent` `wall` +25 | yes | 1 |
| `mod_sharp_turrets` | `turret_damage_percent` +20 | yes | 1 |
| `mod_fortified_core` | `core_health_percent` +20 | yes | 1 |
| `mod_drilled_troops` | `unit_strength_percent` +10 | yes | 1 |
| `mod_reinforced_frames` | `building_health_percent` `all` +10 | yes | 1 |
| `mod_sharpshooters` | `unit_strength_percent` +25, `units: [unit_archer]` | no | 1 |
| `mod_hornet_swarm` | `unit_strength_percent` +25, `units: [unit_drone]` | no | 1 |
| `mod_vanguard` | `unit_strength_percent` +20, `units: [unit_soldier, unit_raider]` | no | 1 |
| `mod_quick_march` | `unit_move_speed_percent` +10 (issue #424) | yes | 1 |
| `mod_rapid_fire` | `unit_attack_speed_percent` +15 (issue #424) | no | 2 |
| `mod_tithe` | `shop_income_flat` 1 (issue #425) | yes | 1 |
| `mod_scrap_dealer` | `sell_refund_percent` +25 (50 to 75, issue #425) | no | 1 |
| `mod_stone_skin` | `unit_armor_flat` 1, `units: [unit_golem]` (issue #426) | no | 3 |
| `mod_wide_arcs` | `unit_splash_percent` +50, `units: [unit_caster]` (issue #426) | no | 3 |
| `mod_claimstakers` | `poi_capture_speed_percent` +50 (issue #426) | no | 1 |

**Pacts** (issue #413, RS-4i6). A modifier definition may carry `pact: true`
(optional, absent means false). The loader requires a pact to be not
stackable and to have at least one positive and one negative effect. The
Shrine never offers a pact (see "Events (RS-4)"); a pact enters the team only
through the Pact event.

| Pact | Benefit | Drawback |
| --- | --- | --- |
| `mod_pact_fury` | `unit_strength_percent` +15 | `core_health_percent` -40 |
| `mod_pact_bastion` | `building_health_percent` `all` +50 | `unit_strength_percent` -5 |
| `mod_pact_overcharge` | `turret_damage_percent` +40 | `building_health_percent` `turret` -50 |

Also in the content, each entered once the feature it needs had
landed: stone skin
(+1 Golem armor, from round 3), wide arcs (+50% caster splash, from round 3)
and claimstakers (points of interest captured 50% faster). Gold modifiers (Tithe and Scrap dealer, issue #425) are
party-wide and act for every player. Pacts (issue #413) are never offered by
the Shrine.

Notes for a port: read `units` as an optional array; the sum for a unit type
is `sum(percent of effects where units is absent or contains the unit's id)`,
computed per spawn, in integers, with the same checked addition as
`modifierPercent`, then `max(sum, minModifierSumPercent)`. A percent may be
negative: read it as a signed integer and keep the floor division of
`floor(value * (100 + sum) / 100)` (the factor is at least 50, so no overflow
beyond the positive case, and the floor is the usual round-down of a
non-negative product).

**Gold effects** (issue #425). `shop_income_flat` (`amount`, an integer from 1
to `MAX_SHOP_INCOME_FLAT` = 10, no `percent`) and `sell_refund_percent`
(`percent`, an integer from 1 to `MAX_SELL_REFUND_PERCENT_ADD` = 90) change
gold only. They sit in `TeamState.modifiers` like every other effect (one list,
one display) and are paid and applied as in "Income" and the Sell action of the
shop. Both are party-wide: every player gets them, gold stays per player and
nothing moves between players. **The arena ignores them**: no battle function
reads them, so a battle, its hash and the generated threats are the same with
or without them, and a ghost carrying them gains nothing in battle. Because
the effects must equal their definition and a held modifier takes one of the
`2 * round - 1` slots, ghost validation needs no rule for them and counts no
strength for them (see "Ghosts"; their only effect on a bound is the Tithe
gold in the value bound below). The refund cap is `SELL_REFUND_PERCENT_CAP` =
90 (a constant, not content). A `percent` outside 1 to 90, or an `amount`
outside 1 to 10, is rejected by the loader, the team-state parser and the
schemas; `amount` sums use checked addition.

**Unit move and attack speed** (issue #424). Two effect kinds, each with the
optional `units` of `unit_strength_percent`: `unit_move_speed_percent` and
`unit_attack_speed_percent`, `percent` an integer from 1 to 100. At the
spawn of a unit of type `u` (producers, scheduled waves and test spawns; not
neutral guards, which have no side modifiers), `unitStats` gets
`S_move` and `S_attack`, each the sum of the side's effects of that kind with
no `units` or with `units` listing `u` (checked `addInt`, no floor, since the
percents are positive), and returns

```
moveCooldownTicks   = max(1, floor(base * 100 / (100 + S_move)))
attackCooldownTicks = max(1, floor(base * 100 / (100 + S_attack)))
```

in integers, from the definition's `moveCooldownTicks` and
`attackCooldownTicks`. The unit stores each only if it differs from the
definition (see "The arena", unit state) and keeps it for its lifetime, as
strength; taking a modifier later changes no unit already on the field. The
walking speed is then `floor(240 / moveCooldownTicks)` and an attacker's
cooldown after a hit is `attackCooldownTicks`. Turrets are buildings and are
not affected (their damage has its own kind). Sums are per side: a unit
spawned by side 0 reads only side 0's modifiers.

The rounding is lumpy on short cooldowns, because every result is a whole
number of ticks. The move cooldowns of the shipped units, at 0 to 3 stacks of
Quick march (`S` = 0, 10, 20, 30) and the speed each gives
(`floor(240 / ticks)` sub-cell units per tick):

| Unit | 0 stacks | 1 stack | 2 stacks | 3 stacks |
| --- | --- | --- | --- | --- |
| `unit_soldier`, `unit_heavy`, `unit_lancer`, `unit_archer`, `unit_caster` | 6 (40) | 5 (48) | 5 (48) | 4 (60) |
| `unit_raider`, `unit_drone` | 4 (60) | 3 (80) | 3 (80) | 3 (80) |
| `unit_familiar` | 3 (80) | 2 (120) | 2 (120) | 2 (120) |
| `unit_golem` | 10 (24) | 9 (26) | 8 (30) | 7 (34) |

So one stack of Quick march gives a raider or drone 33% more speed (+10% asked)
and a second and third stack give them nothing more; two stacks give the
soldier the same as one. The attack cooldowns at Rapid fire (`S` = 15):
soldier, heavy, archer and familiar 10 to 8, raider and drone 8 to 6, golem 14 to 12,
lancer 12 to 10, caster 20 to 17. A table test pins the move cooldowns (`speed-modifiers.test.ts`).

Notes for a port: read the two new kinds like `unit_strength_percent` (same
`units` rules), sum per kind and per unit type at each spawn with checked
addition, and use floor division of non-negative integers; do not store a
cooldown in a unit when it equals the definition's, and treat an absent
`moveCooldownTicks`/`attackCooldownTicks` as the definition's wherever a speed
or an attack cooldown is read. Ghost snapshots need nothing new: a held
modifier must equal its definition, be unlocked by the snapshot round
(`fromRound`), and the number held is bounded by the event slots; no modifier
adds to the ghost value bound (unit strength does not either).

**Unit armor and splash modifiers** (issue #426). `unit_armor_flat` (`amount`,
1 to `MAX_ARMOR_FLAT` = 10) and `unit_splash_percent` (`percent`, 1 to 100),
both with the optional `units` of `unit_strength_percent`. At the spawn of a
unit of type `u` (the same places as the speed kinds), `A` is the sum of the
side's `unit_armor_flat` amounts that apply to `u` and `P` the sum of its
`unit_splash_percent` percents that apply (checked `addInt`), and `unitStats`
returns

```
armor          = min(MAX_ARMOR, def.armor + A)
splash.percent = floor(def.splash.percent * (100 + P) / 100)   (only if def has splash)
splash.radiusSub unchanged
```

The percents are summed and applied once, never one application per effect:
Wide arcs on a caster (50) gives `floor(50 * 150 / 100)` = 75. A unit stores
`armor` or `splashPercent` only if it differs from the definition (`armor` when
`A > 0` and the cap does not hide it, `splashPercent` when `P > 0` and the unit
has `splash` and the result differs), keeps it for its lifetime, and taking a
modifier later changes no unit already on the field; a battle without these
modifiers has the same state and hash as before. Wherever armor is read (a hit
on a unit: unit attacks, turret shots, secondary splash targets, "Order of
damage modifiers") a unit's own `armor` is used if present, else the
definition's; wherever a splash is applied the unit's own `splashPercent` is
used if present, else the definition's percent. The damage order is unchanged:
spawn damage, Overload, splash percent (secondary targets only), each target's
armor. A unit without `splash` is unaffected by `unit_splash_percent`.

Notes for a port: keep the two optional per-unit fields out of the state when
they equal the definition's, and read armor and splash through one helper that
prefers the unit's field. Ghost snapshots need nothing new (see below): neither
kind changes any value a snapshot holds, so the ghost bound is untouched and a
held Stone skin or Wide arcs is validated like any other modifier (equal to its
definition, unlocked by `fromRound`, within the event slots).

### Party votes (CP-16)

Every party decision (PvE difficulty, event choice, event
follow-up choice) is one vote per player, changeable until the last player has
voted. It resolves when the last vote arrives:

1. If every player chose the same option, that option wins. The random pick of
   step 2 is not made (the stream is derived but unused).
2. Otherwise one player's vote is picked at random: `pick = nextInt(n)` on the
   child stream `vote:<topic>:r<round>:<leg>` (topic `pve`, `event` or
   `event_follow_up`), where `n` is the number of players and tickets are
   ordered by player index; the winner is that player's vote. Each vote is one
   equally likely ticket, so an option with 3 of 4 votes wins with probability
   3/4. The host has no tie-break.

The stream is derived with the run's `drawStream` (which advances the run
generator by one output) exactly once, at the moment of the last vote, for
every vote in a party of two or more players, whether it was unanimous or not.
This keeps the later rolls independent of how the party voted: if only a split
vote advanced the generator, one dissenting voter could choose between two
different futures for every later roll. A one-player run draws nothing (a solo
run is unchanged by this rule). The result is applied in the
same action and stored in the state, so a reload cannot change it and a replay
of the action log reproduces it. The `vote_resolved` effect lists `tickets`
(every vote in player order) and, for a random pick, `picked: { player, random:
true }`.

Note on predictability: the random pick is not secret. The generator is part
of the run state, so a modified client can compute the pick before it votes.
This matters only once play is networked. It is recorded in issue #65 for the
networking and anti-cheat design.

### Ready (CP-17, CP-17a)

`ready` and `unready` are legal in `specialist_pick`, `core_placement`, `build`, `shop`,
`pve_summary` and `pvp_summary`. A step ends when every player is ready (a solo player's `ready`
ends it at once); the ready flags are cleared on entering the next step.
**Ready locks editing (issue #58):** in `specialist_pick`, `core_placement`, `build` and `shop`, while a player is
ready, every intent of theirs other than `unready` (and `abandon` by the host)
is rejected with `locked_ready`: `pick_specialist`, `place_core`, `buy`, `sell`, `reroll`, the board edits
(`place_building`, `move_building`, `return_building`, `set_building_resource`,
`add_conduit`, `erase_conduit`) and any extension intent a handler allows in those steps.
The step check comes first (a `vote` in `build` is still `wrong_step`), and
`ready` while ready is still `already_ready`. Other players are not affected.
`allowedIntents` leaves the locked intents out. Because the step ends the
moment the last player readies, an unready is always possible while the flag
is set. The summary steps have nothing to edit and are not locked.

### Sealed unit producers (issue #37, part 3a)

`ready` in `build` or `shop` is rejected with `sealed_producer`, with the
building ids in `detail` (ascending, comma separated, such as `"12,15"`), while
`sealedProducers(team, content)` (core, `sealed-producers.ts`) is not empty.
The board is read whole, but `ready` from player `p` is rejected only while a
sealed producer is **owned by `p`** (PP-15); `detail` lists only those ids. A placed unit
producer (a building whose kind is `unit_producer`) is **sealed** when its
units could not reach the front row:

- The board is read as the arena reads side 0 (`createArena` and `openFor`
  from the arena code, unchanged). A cell is **walkable** if it is not terrain
  that blocks movement (lake, cliff) and not covered by a building or the
  Core, except that a **gate is walkable** (it lets its own side through,
  `blocksUnit`). Conduits are not obstacles. Movement is 4-directional.
- The **front row** is the board's last row, `y = height - 1`, next to the
  neutral zone. The zone itself is not consulted.
- A producer is **not sealed** if one of its footprint cells is on the front
  row (it can spawn onto the first zone row), or if at least one **spawn cell**
  (a cell 4-adjacent to its footprint, inside the board) is walkable and a chain
  of 4-adjacent walkable cells joins it to a walkable cell of the front row.
  Otherwise it is sealed. This is the spawn rule of the arena ("where to
  spawn") without its preference ordering: only whether a route exists.
- A producer whose unit is **flying** is never sealed: its units appear on any
  cell next to it and fly over everything (CB-16c). `sealedProducers` knows
  this when the content it is given has `units` (the session and the web do);
  given buildings only, it applies the ground rule to every producer.
- Unplaced buildings (the stash) never count; a building that is not a unit
  producer is never listed. The search is one breadth-first pass from the front
  row (about a millisecond on a full four-plot board).

**Fit approximation (issue #59).** The rule above is cell based: a one-cell gap is
walkable. A unit "fits" a one-cell gap iff `2 * collisionRadius <= 240`, which
holds for every unit of part 1 (soldier 94, raider 78), so for them the cell
rule is exact; for a hypothetical unit wider than a cell the check would say
"not sealed" for a pocket whose only exit is too narrow for it. The check uses
no unit radii at all (it does not know which unit a producer makes at this
stage of the code), and that is the stated approximation. (The heavy unit's
collision diameter is 110 and the Golem's 160, so both fit.) The check does not read a
producer's costs, so a two-input producer (CB-5e, the Foundry) is a unit
producer like any other here. A refinery (CB-5d) is not a unit producer and is
never listed.

The summary steps are not checked. `sealedProducers(state, deps)` in the session
package gives the same list for a screen.

### Events (RS-4)

`content/events.json` lists event definitions `{ id, type, weight, fromRound?,
resourceWeights?, params }` (`resourceWeights` only for Rich vein and Caravan) and modifier definitions `{ id, stackable, fromRound?, effects }`,
and `offerCount` (3). The `type` names a handler in the session package; the
handler decides availability, extra offer data, what happens on pick, and how a
follow-up choice is applied. Adding a type is data plus one handler.

Offers (stream `event_offers:r<r>:<leg>`): **never two offers of the same
type** (issue #48). The content may hold several definitions of one type (for
example a small and a big Windfall); they compete for a single place. The
definitions whose first round has come (`round >= fromRound`; `fromRound`
defaults to 1, `round` is `RunState.round`, the round of the event step) and
whose handler says `available` (Workshop: some owned building
below tier 3 that a player can pay for; Drill: some owned collector below tier 3; Shrine: at least one modifier can be taken; Pact: some pact is not held; Rich vein: some player is under the cap and has a legal cell; Blueprint: some building is rare at this round; Caravan: the shop can offer `players + 1` different buildings; Windfall and Market
day: always) form the pool, in file order. Both conditions are checked before
the draw, so the number of draws is still the number of offers, and where no
`fromRound` is above the round the draws are those of the pool without it
(round 1 offers did not change when Market day was added). A definition with an
always-available handler must have `fromRound` 1 or none (wiring throws
otherwise), so the step always has an offer. The draw sequence is: one `pickWeightedIndex`
over the weights of the pool; the picked definition is offered, and it and
every other definition of the same type are removed from the pool; repeat
until `offerCount` offers exist or the pool is empty. There is exactly one
draw per offer made, so the number of draws is the number of offers (at most
the number of available types) and none is wasted. A type with several
definitions is therefore chosen with the probability of its first draw, which
is the sum of its definitions' weights, and the definition within it is
weighted by its own weight. The instance data (such as a Shrine's modifiers) comes from
the child stream `<event id>:<index>` of the offer stream, which does not
advance it. An offer is `{ id, event, type, ...data }` with `id` the event id.
Offers are stored in `pending.options` before they are shown.

**Fewer than three offers is allowed, on purpose.** The party is offered up to
three events, one per type, so with fewer types available it is offered two or
one: with the Workshop unavailable (every building at tier 3) and a Shrine
that cannot be offered, or the like. The step always has at least one offer,
because wiring requires an event definition whose handler is `alwaysAvailable`
(the Windfall); `createGameDeps` throws otherwise. The machine, the vote,
`validateRunState` (1 or more offers in `event_choice`) and the schema accept
any number of offers from 1 to `offerCount`. More event types will come later.

- **Workshop** (`params.workshopPricePercent`, 70; an integer from 1 to 100,
  checked by the schema and at wiring): every player may raise ONE building
  they own by one tier, paying from their own gold. Issue #50 replaced the
  earlier party-wide free upgrade.
  - *Available* when, at the moment the offers are generated, at least one
    player owns a building (placed or in the stash) below tier 3 whose
    upgrade price their gold covers. The offer stores `workshopPricePercent`.
  - *Price* of raising a building of definition `d` from tier `t` to `t + 1`:
    `floor(tierPrice(d, t + 1) * workshopPricePercent / 100)`. `tierPrice` is
    the shop price of that tier (the function the shop rolls offers with), the
    division is integer division rounding down, so with 80% a tier price of 9
    gives 7 (the shipped value is 70, issue #417). A building at tier 3 is never an option; events never add a
    building.
  - *Follow-up.* After the party votes for the Workshop (the usual party vote)
    the step is `event_resolve` with `pending.followUp = { prompt:
    "workshop_building", perPlayer: true, options, votes }`. `options` lists,
    for every player, the buildings they own below tier 3, in player then
    instance order: `{ id: "b<instance id>", player, building, def, tier,
    newTier, price, placed, affordable }`. `votes[i]` is player i's choice (an
    option id or `"skip"`) or null; it is the only record of who has chosen.
    A player who cannot afford any of their options starts with `"skip"`
    already chosen (they have nothing else to choose); if nobody can, there
    are no options and the step goes straight to the shop. Stored option data
    is never trusted: `validateRunState` checks only the STRUCTURE of each
    option (id format, `player` in range, the building exists and belongs to
    that player, `def` and `tier` match the building's current tier,
    `newTier = tier + 1 <= 3`, `placed` matches, `price` a non-negative
    safe integer, `affordable` a boolean) and compares nothing with content
    prices or gold, so a run saved under an older minor version stays
    openable under changed prices. A tampered structure is rejected
    (`invalid_choice` in `event_choose`). A save made under run-state format 2
    (the old party-wide Workshop) is
    `unsupported_format`; the format version is now 3.
  - *Choosing.* Each player sends `{ type: "event_choose", choice }` with one of
    their own option ids or `"skip"`. `skip` is always allowed, also when an
    upgrade is affordable. Another player's option is rejected with
    `not_owner`, an unknown id with `invalid_choice`, and an option the
    player's gold does not cover with `not_enough_gold`. Affordability is
    checked when a player submits a choice, against current content
    (`workshopPrice(content, def, tier + 1, percent)` with the offer's stored
    percent) and the player's gold at that moment; the stored `price` and
    `affordable` are display data and are ignored, so a player who could pay
    the stored price but not the current one gets `not_enough_gold` and can
    still skip. The price is computed again from current content and charged
    when the last player has chosen; a stored choice that can no longer be
    paid then (or whose building is no longer eligible) is applied as a skip
    for that player: no charge, no upgrade, and nobody's submission is
    rejected for it. `votes` pre-filled with `skip` (a player with nothing
    affordable when the offer was made) can be changed like any other choice. A choice is stored at once and may be changed until
    the last player has chosen; nothing is applied before that. There is no
    party vote on the building and no random draw.
    The web screen sends `event_choose` for an upgrade only when the player
    presses the confirm button ("Upgrade · N gold", N the selected row's
    price): clicking a row only selects it and sends nothing. Skip is sent at
    once.
  - *Applying.* When every player has chosen, the choices are applied in
    player order (price taken from the player's gold, `raiseTier` on the
    building) and the run goes to the shop. With one player the first choice
    applies at once. The `event_resolved` custom effect carries `choices`
    (the votes in player order) instead of `choice`, and `applied`: one entry
    per player in player order, `{ player, result: 'skip' }`, `{ player,
    result: 'upgrade', building, def, newTier, price }` (the price charged), or
    `{ player, result: 'skip', dropped: true, reason }` when a chosen upgrade
    was dropped (`not_enough_gold`, `invalid_choice`, `cannot_raise`).
- **Drill** (no params; `fromRound` 2 in the shipped file; RS-4i2): every
  player may raise ONE of their own collectors by one tier for free. It is the
  Workshop's follow-up with two differences, a filter and a price; the code is
  shared (`upgradeHandler`, `workshopOptions`/`workshopOptionProblem` with an
  `only` filter on the building definition).
  - *Available* when, at the moment the offers are generated, some player owns
    a building (placed or in the stash) whose definition has `kind: "source"`
    (a collector) and whose tier is below 3. The offer carries no data beyond
    `{ id, event, type }`.
  - *Follow-up.* `pending.followUp = { prompt: "drill_building", perPlayer:
    true, options, votes }`, exactly as for the Workshop (option shape, player
    then instance order, `skip` always allowed, `votes[i]` is the only record
    of who has chosen), but `options` lists only that player's collectors
    below tier 3, each with `price: 0` and `affordable: true`. A player with
    no such collector starts with `"skip"` already chosen. The price is 0
    (the Workshop price formula with percent 0), so `not_enough_gold` cannot
    happen; `not_owner` and `invalid_choice` are as in the Workshop, and a
    building that is not a collector is `invalid_choice`.
  - *Applying.* When every player has chosen, in player order, `raiseTier` on
    each chosen collector, no gold taken, then the shop. A stored pick that no
    longer holds (the collector was sold, is now tier 3, or is not a
    collector) is applied as a skip with `dropped: true, reason:
    "invalid_choice"`. `event_resolved` carries `choices` and `applied` as for
    the Workshop (`price` is 0).
  - *Random streams.* None: no draw, and no other stream moves.
  - *validateRunState* checks each option of a `drill_building` follow-up like
    the Workshop's (structure only) and also that the building is a collector;
    `perPlayer` must be true.
  - Notes for a port: the saved shape is the Workshop's (no new field, no
    format change); a ghost's tier bound counts Drill raises like Workshop
    raises (`type` `workshop` or `drill` in the configured events).
- **Rich vein** (`resourceWeights` on the definition: `{ res_a: 3, res_b: 3,
  res_c: 1 }`; `fromRound` 3 in the shipped file; RS-4i4, issue #414): every
  player may add ONE resource node to their own plot.
  - *Available* when `maxAddedNodesPerPlot` is known to the hooks (it is when
    they are built by `createGameDeps`; without map rules the event is never
    available) and some player is under the cap with at least one cell in
    `addableNodeCells` (see "Team state and placement").
  - *Offer.* `{ id, event, type: "rich_vein", resource }`: `resource` is the
    base resource ID drawn with `pickWeightedIndex` over `resourceWeights` of
    the base resources in resource-file order (`listBase`) that have a weight,
    on the offer's child stream `<event id>:<index>` (one draw; no other
    stream moves). It is drawn before the vote so the card can name it.
  - *Follow-up.* `pending.followUp = { prompt: "rich_vein_cell", perPlayer:
    true, options, votes }`. `options` has one entry per player that has a
    legal cell, `{ id: "cells<player>", player, cells: [[x, y], ...] }` (the
    legal cells at that moment, `(y, x)` order); a player with none starts
    with `"skip"` already chosen, and if nobody has a cell there are no
    options and the step goes straight to the shop. The choice is a string
    `c<x>_<y>` (decimal, no leading zeros, at most 6 digits each) or `skip`; it
    is not one of the stored options (the handler's `optionOf` builds it).
    `checkChoice` runs `addNode` for that player at that cell and refuses with
    its reason (`front_row`, `outside_own_plot`, `blocked_by_feature`,
    `node_here`, `overlaps_core`, `overlaps_building`, `overlaps_conduit`,
    `out_of_bounds`, `plot_full`, `unknown_resource`, `invalid_round`;
    `invalid_choice` for a malformed id). A choice is stored at once and can be
    changed until the last player has chosen; only the submitting player's
    choice is checked then.
  - *Applying.* When every player has chosen, in player order: `addNode` with
    `round = RunState.round` on the team as it is after the earlier players'
    nodes. A pick that is no longer legal is applied as a skip with
    `dropped: true` and the `addNode` reason (`invalid_choice` for a pick that
    names no cell), never rejected. `event_resolved` carries `choices` and
    `applied`: `{ player, result: 'node', x, y, resource }`, `{ player, result:
    'skip' }` or `{ player, result: 'skip', dropped: true, reason }`. Then the
    shop.
  - *validateRunState* checks a `rich_vein_cell` follow-up: `perPlayer` true,
    the offer's `resource` a base resource, each option `{ id:
    "cells<player>", player, cells }` with at most one per player and every
    listed cell in `addableNodeCells` for that player now, and a stored vote
    that is `skip` or a cell listed for that player. The team's `addedNodes`
    are validated as part of the team.
  - *Ghosts.* Beside the team-state checks, every added node's `round` must be
    from the first `fromRound` of a `rich_vein` event in `events.json` (no such
    event: none allowed) up to the snapshot's round; the size limit has a term
    `partySize * maxAddedNodesPerPlot * addedNodeEntry`.
  - Notes for a port: nothing is stored in the map; all reads of nodes use
    the merge of the generated and the added list. The per-player machinery
    is the Workshop's; the one new idea is that the choice space is a cell
    set, so the options hold lists of cells and the choice id is parsed, not
    looked up.
- **Blueprint** (`params.choices`, 3, and `params.maxOfferWeight`, 4; `fromRound`
  3 in the shipped file; RS-4i5, issue #412): every player may choose one rare
  building to be held in their next shop.
  - *Rare* at round `r`: a building whose `offerWeights` entry has weight at most
    `maxOfferWeight` and is in the shop's roll at `r`. "In the roll" is the
    shop's own gate: `offerWeightsAt(economy, round)` is the `offerWeights` list
    with the weight of every entry whose `fromRound` is above `round` set to 0
    (and, from issue #472, of every signature-building entry: this call names no
    specialist, "Offer roll"), and `rollOffers` draws from that list for a
    player with no specialist entry; the rare list is its entries
    with weight from 1 to `maxOfferWeight`, in `offerWeights` order, each
    building once (`rareOfferDefs`). With the shipped content (`maxOfferWeight`
    4) the rare buildings from round 3 are, in order: `bld_crossover`,
    `bld_wall_i`, `bld_wall_o`, `bld_wall_t`, `bld_wall_s`, `bld_wall_z`,
    `bld_wall_l`, `bld_wall_j`, `bld_refinery_ab`, `bld_golem_forge`,
    `bld_refinery_bc`, `bld_spire` (twelve; the last four, which start at round
    3, are the refineries and the refined buildings). In rounds 1 and 2 the last
    four are not in the roll, so they are not rare then.
  - *Available* when the hooks know the shop rules (`createGameDeps` passes
    them; without them the event is never available) and at least one rare
    building exists at this round.
  - *Offer.* `{ id, event, type: "blueprint", blueprints }` with `blueprints[i]`
    the list for player `i`: up to `choices` distinct rare buildings (fewer if
    fewer are rare), drawn WITHOUT replacement with `pickWeightedIndex` over
    their `offerWeights` weights (the pool in the order above; a drawn building
    is removed from the pool, then the next draw), from the stream
    `<event id>:<index>` of the offer stream `.child(player)` (one stream per
    player; no other stream moves, and player `i`'s list does not depend on the
    number of players). The lists are drawn before the vote and stored.
  - *Follow-up.* `pending.followUp = { prompt: "blueprint_building", perPlayer:
    true, options, votes }`, `options` = for each player and each building of
    their list `{ id: "p<player>:<def>", player, def }`. Every player has at
    least one option (a player with none would start with `skip` chosen). The
    choice is an option id of the player's own (`not_owner` for another
    player's, `invalid_choice` for any id that is not an option) or `skip`; it
    is stored at once and can be changed until the last player has chosen.
  - *Applying.* When every player has chosen, in player order: the player
    gets the `held_offer` `{kind: "held_offer", def}` in `nextShop` (replacing
    an earlier one; there is none today). A stored pick whose `def` is no
    longer in that player's list, or is unknown, is applied as a skip with
    `dropped: true` and reason `invalid_choice`. A skip changes nothing for that
    player and never affects the others. `event_resolved` carries `choices` and
    `applied`: `{ player, result: 'blueprint', def }`, `{ player, result: 'skip'
    }` or the dropped form. Then the shop (see "Next-shop effects" for the held
    slot: tier 1, normal price, kept by re-rolls, bought once, gone when the shop
    ends).
  - *validateRunState* checks a `blueprint_building` follow-up: `perPlayer`
    true and every option `{ id: "p<player>:<def>", player, def }` with `player`
    in range and `def` a building; a stored vote must be `skip` or an option of
    that player. The `nextShop` entry is checked as described there.
  - Notes for a port: nothing is added to the team state or the ghost snapshot,
    so no hash moves; the only saved data is the optional `held_offer` entry.
    The rare test and the shop roll share one gate function, so a content
    change to `fromRound` or a weight moves both together.
- **Caravan** (`params.gold`, 6, `params.weightGold`, `weightBuilding`,
  `weightUpgrade`, `weightNode`, `weightModifier`, `resourceWeights`; `fromRound`
  2 in the shipped file; RS-4h, RS-4i3, issue #415): a draft of rewards, one per
  player in turn. The only event whose follow-up is not a vote and not per
  player.
  - *Available* when the hooks know the shop rules and the shop can offer at
    least `players + 1` different buildings at this round (always so with the
    shipped table).
  - *Offer.* `{ id, event, type: "caravan", items, order }`, drawn before the
    vote from the offer's child stream `<event id>:<index>` and stored.
    `order` lists the players in choosing order, a rotation of `0 .. n-1`:
    the first Caravan of a run starts at `child("first").nextInt(n)`; every
    later one at `(caravanFirst + 1) mod n` where `caravanFirst` is the first
    chooser of the latest Caravan taken (run state, below). `items` has
    `n + 1` rewards (solo: 2), each `{ id: "it<k>", kind, ... }`, drawn from
    `child("items")` one reward at a time: one `pickWeightedIndex` over the
    weights of the kinds that can still be made, then one draw inside the kind.
    Kinds and their weights are the params `weightGold`, `weightBuilding`,
    `weightUpgrade`, `weightNode`, `weightModifier` (integers 0 to 1000;
    `weightBuilding` at least 1, so a draft can always be filled; `gold` is 1
    to 1000; a `weightNode` above 0 needs `resourceWeights`; all checked at
    wiring and by the schema). A kind can be made when its weight is above 0
    and: `gold` (once): always, `{ gold: params.gold }`; `building`: a
    building the shop can offer at this round (`offerWeightsAt` with no
    specialist, so never a signature building; weight above
    0, tier 1 priced) not already an item, drawn by `pickWeightedIndex` over
    its offer weight, `{ def }`; `upgrade` (once): some player owns a
    building below tier 3 (`workshopOptions` at price 0); `node`: some player
    has a legal cell (`addableNodeCells`) and a base resource of
    `resourceWeights` is not already an item, drawn by `pickWeightedIndex` over
    `resourceWeights`, `{ resource }`; `modifier` (once, so at most one reward is
    party-wide): the Shrine's eligible list (not a pact, unlocked, not held or
    stackable), one picked with `rng.pick`, `{ modifier, partyWide: true }`. If no kind
    can be made, the list stops short (never with the shipped content).
  - *Follow-up.* On pick: `caravanCount += 1` and `caravanFirst = order[0]`
    in the run state (optional fields, absent until the first Caravan), and
    `pending.followUp = { prompt: "caravan", mode: "draft", items, order,
    taken }` with `taken` all null (no `options`, no `votes`). `taken[i]` is the
    choice of `order[i]`: an item id (`it2`), an item id with a sub-choice
    (`it2:b17` for an Upgrade, the building to raise; `it3:c4_9` for a Node,
    the cell), or `skip`. No timers.
  - *Turns.* Let `c` be the first index with `taken[c]` null. `event_choose`
    is accepted from `order[c]` (a new pick) and from `order[c-1]` (to change
    their pick, until `order[c]` has chosen); anyone else gets `not_your_turn`.
    The choice must be a free item (not taken by another player; the sender's
    own current item counts as free), else `invalid_choice`; a plain item takes
    no sub-choice; an Upgrade needs `b<id>` of the sender's own building below
    tier 3 (`workshopOptions`), a Node `c<x>_<y>` that `addNode` accepts for
    the sender with the item's resource at `round` (the `addNode` reason is
    returned); a modifier must still be eligible (`not_unlocked`, `already_held`).
    `skip` is legal only for a player who can take none of the free items.
    The pick is stored at once. The pick of the last player is final: it ends
    the draft.
  - *Applying,* when `taken` has no null: in choosing order, each pick is
    re-checked against the team as it is then and applied: gold adds `gold` to
    the taker; a building goes to the taker's stash as tier 1 (`addToStash`);
    an Upgrade is `raiseTier` of the named building, free; a Node is `addNode`
    (round = `RunState.round`); the modifier is added to `TeamState.modifiers`
    for the whole team. A pick that no longer holds is applied as a skip with
    `dropped: true` and the reason. The unchosen item is discarded.
    `event_resolved` carries `order`, `choices` (= `taken`) and `applied`
    (in choosing order): `{ player, result: 'gold', gold }`, `'building'`
    (`def`, `building`), `'upgrade'` (`building`, `def`, `newTier`), `'node'`
    (`x`, `y`, `resource`), `'modifier'` (`modifier`, `partyWide: true`),
    `{ player, result: 'skip' }` or the dropped form. Then the shop.
  - *Run state.* `caravanCount` (integer 1 to 1000) and `caravanFirst` (a player
    index) are optional, present together, absent before the first Caravan.
    Old saves stay readable and hash as before, so no format number is raised
    (CONTRIBUTING). A draft is a new allowed shape of the opaque `pending`
    (`pending` is not strictly typed by the schema); it is not a change of an
    existing one.
  - *validateRunState* checks a draft: the offer is a `caravan` offer; the
    follow-up has exactly `prompt`, `mode`, `items`, `order`, `taken`;
    `players + 1` items with ids `it0..`, a valid kind and fields (gold at
    least 1, a building with a tier 1 price, a base resource, a modifier ID),
    `partyWide` exactly on modifiers and at most once; `order` a rotation of
    the players; `taken` filled as a prefix (null only after non-null is
    refused), each `skip` or a distinct item with a sub-choice that is legal for
    that player now; and not complete (a complete draft has ended).
  - *Ghosts.* The value bound adds, from the Caravan's first round, one free
    building or raise per event step (the dearest tier 1 price the shop sells by
    then or the largest price step of any building); its `gold` counts in the
    best event gold like a Windfall's; a Caravan counts as a raise for the tier
    bound; an added node may come from a Caravan with `weightNode` above 0.
  - Notes for a port: the draft is the only follow-up with turns; keep the
    cursor as "first null", allow the previous player to change, and
    apply at the end in order. Sub-choices are in the choice string, so a
    pick is one string. Bots take the first free reward in the order gold,
    modifier, raise, node, building.
- **Shrine** (`params.choices`, default 3): available when a modifier is
  *eligible*. A modifier is eligible when `round >= fromRound` (`fromRound`
  defaults to 1; `round` is `RunState.round`, the round of the event step,
  the same value the offer stream's name uses), it is not a pact (`pact:
  true`: pacts, issue #413, are never offered by the Shrine), and it is either
  not held or stackable. The eligible list is in file order. The offer lists up to
  `choices` of them: `rng.shuffle` of the eligible list on the offer's child
  stream, the first `choices` kept, then put back in file order. So with no
  `fromRound` in the file the draw is the same as before, and the child
  stream is the only one used (no other stream moves). The follow-up options
  are those modifiers; the chosen one is added to `TeamState.modifiers`. A
  choice for a modifier whose `fromRound` is above the current round is
  refused (`not_unlocked`), as is a non-stackable one already held
  (`already_held`).
- **Windfall** (`params.gold`, 8 as shipped, issue #417): no follow-up; every player gets that much gold
  at once.
- **Market day** (`params.extraOffers`, 1, and `params.freeRerolls`, 1; integers
  from 1 to 10, checked at wiring and by the schema; `fromRound` 2 in the shipped
  file; RS-4i1): always available from its round. The offer stores both numbers.
  No follow-up and no random draw: on pick, every player gets the effects
  `extra_offers` and `free_rerolls` in `nextShop` (see "Next-shop effects"), and
  the shop that follows has one more offer and a free first re-roll. A shop
  after that one has neither.
  Notes for a port: the effects live in the per-player state, not in the team
  state, so ghosts and team hashes are not affected.

- **Pact** (no params; `fromRound` 4 in the shipped file; RS-4i6): *available*
  when at least one modifier with `pact: true` is not held (a pact is held at
  most once per run). The offer is `{ id, event, type: "pact", pact:
  <modifier id> }`: the one pact is `rng.pick(free pacts in file order)` on the
  offer's child stream `<event id>:<index>` (one `nextInt(n)`; no other stream
  moves). Both its benefit and its drawback are shown from the modifier
  definition. *No follow-up*: voting for the Pact takes it, on pick the
  modifier `{ id, effects }` is added to `TeamState.modifiers` exactly as the
  Shrine adds one (an offer whose pact is no longer free, or unknown, changes
  nothing). Not voting for it (the party takes another event) is the skip; an
  offer set always has another event because the Windfall is always
  available. Because nothing but this event gives a pact, the party never
  holds a pact twice.
  *validateRunState* needs nothing new: the held modifier is validated as any
  modifier (percent -90 to 1000, never 0). The saved shape is unchanged.
  Notes for a port: a pact is an ordinary modifier with a negative effect
  among its effects; the pact filter exists only in the Shrine's eligibility
  check and the Pact's availability and draw.

After the party votes for an offer (the usual party vote, see "Party votes"
above), a handler with no follow-up applies at once and the step goes to the
shop; so does a follow-up that lists no options (nobody could answer it). A
handler that can return a follow-up declares `canAskFollowUp` and must have a
`choose` function (a party vote) or a `chooseEach` function (a per-player
follow-up, the Workshop), checked when the deps are built. Otherwise the step
becomes `event_resolve` with `pending = { offer, followUp: { prompt, options,
votes } }`, and each player sends `{ type:
"event_choose", choice: <option id> }`. Votes count at once and can be
changed; when all players have voted the winner (see "Party votes") is
applied and the step goes to the shop. A follow-up with `perPlayer: true` (the
Workshop) is not a vote: see the Workshop above.

### Battles and playback

`createBattleResolver` runs `simulatePveBattle` with the voted option's threat
(PvE), or, for PvP, the ghost fixed in `state.pvpOpponent` (see "Ghosts"; or
the team `findPvpOpponent` returns), else a
generated `boss` threat for the round (opponent kind `boss`). The archetype is
no longer drawn here: it is `state.pvpOpponent.boss`, chosen in the shop (see
"Ghosts", "Selection"). Only a state whose `pvpOpponent` has no `boss` (a save
made before issue #397, or a run without `threats` in its ghost rules) keeps
the old draw: `rng.child("archetype").pick(list)` on the battle stream, `list`
being the boss-only archetypes in file order, else all archetypes, keeping only those whose `minPartySize` is at most the party size (a solo run never draws Bonded; no boss is drawn before its `fromRound`, so Brood from round 3, Bonded from round 5 and Pylons from round 7). The result's
`opponent` then carries `boss: <archetype id>` and the round record stores it. The battle seed is the first `nextU32` of
the battle stream. `BattleResult.detail` is `{ version, kind, round, seed,
source, teamHash, summary }`: no event log. `source` is `{type: "option"}`
(threat in `pending.option.threat`), `{type: "generated", input, threat}` (the
`ThreatInput` and the generated `ThreatProfile`; a replay fights the stored
profile, so later content changes cannot alter it) or `{type: "ghost", label,
team}`. `summary` holds the winner,
reason, end tick, event count, Core health on both sides, and `eventLogHash =
hashJson(eventLog)`. The summary steps accept only ready, unready and abandon,
so the team cannot change between a battle and the end of its summary step;
`teamHash` records the team that fought and a replay refuses (`team_changed`)
if it differs.

## Specialists

Issues #470 and #471 (umbrella #468; RS-13, CP-31, CB-51, MM-1e). Each player
picks one starting specialist before placing their Core. The pick is stored
(#470) and its **family bonus** acts in every battle (#471, "Family bonuses"
below). The signature building's shop gate comes with #472 ("Signature buildings in
the shop" below); what each signature building does comes in the later steps of
#468.

### Content (`content/specialists.json`, `schemas/specialists.schema.json`)

`{ specialists: [{ id, family, effects, signature }, ...] }`, the roster in the
order the pick screen shows it; the bounds are in "Content bounds".
The first roster: `spec_flowmancer` (logistics, `source_speed_percent` 10,
`bld_mana_well`), `spec_wardsmith` (defense, `building_health_percent` 15 on
`wall`, `gate` and `turret`, `bld_rune_ward`), `spec_beastbinder` (units,
`unit_health_percent` 10, `bld_familiar_roost`) and `spec_alchemist` (industry,
`production_speed_percent` 15, `bld_transmuter`). Names and descriptions are in
`content/presentation.en.json` under `specialists` (one entry per ID, exactly:
`name`, `family`, `bonus`, `signature`, `description`; a missing or extra entry
is a load error).

### The step `specialist_pick` and the intent `pick_specialist`

- The step table: `specialist_pick` allows `pick_specialist`, `ready`,
  `unready` and `abandon`. Its `pending` is `null`; the picks are in the team
  state (`specialists`, "Team state and placement"). A new run starts here,
  with `round` 1, `leg` `pve`, no Core and no pick. It is a Ready-lock step
  (`locked_ready`, "Ready").
- `pick_specialist { specialist }` by player `p` (any player, for their own
  entry only; the intent has no other target, CP-31): `specialist` not a string
  is `invalid_intent`; not in the roster is `unknown_specialist`; otherwise
  `setSpecialist(team, content, p, specialist)`. Sending it again **changes the
  pick**, for as long as `p` is not Ready (a Ready player is `locked_ready`
  until `unready`). A pick that equals the current one changes nothing and
  emits no effect; otherwise the effect `specialist_picked { player,
  specialist }` is emitted. **Nothing is drawn**: the run generator and every
  stream are untouched, so a pick (and the intents `ready` and `unready` of this
  step) never moves a later stream.
- `ready` is rejected with `specialist_not_picked` while the player has no pick
  (there is no skip, RS-13a); otherwise the rules of "Ready" apply. When the
  last player readies, the run enters `core_placement` (clearing the ready
  flags) with `pending = { positions: [null, ..., null] }`. Solo, `ready` ends
  the step at once. `abandon` by the host ends the run (`run_over`) with the
  picks so far.
- The picks are public to the party (RS-13b); every effect and the state show
  them. Duplicates are allowed. No player can pick for another (the intent
  names no target) and the picks never change after the step ends: no intent
  later touches `specialists`.
- **Validation** (`validateRunState`): `step` may be `specialist_pick`, with
  `leg` `pve`, no Core placed, `pending` null; a ready player there has a pick;
  in any other step but `run_over`, a state whose team has `specialists` has no
  `null` entry (a state without the field is a run from before specialists and
  is accepted in every step).
- Bot: each strategy has one specialist, a fixed table (`rush`
  `spec_beastbinder`, `fortify` `spec_wardsmith`, `siege` `spec_alchemist`,
  `weak` `spec_flowmancer`); every player of a bot party picks it and readies.
  Nothing is drawn, so no bot stream moves.

### Signature buildings in the shop (issue #472; EC-3b)

- **Content.** The four signature buildings of the roster are building
  definitions in `buildings.json` from this step, so that the specialists, the
  shop gate, the ghost check and the bot can name them: `bld_mana_well`,
  `bld_rune_ward`, `bld_familiar_roost` and `bld_transmuter`. Every one is
  **content only** in step #472: its own step of #468 (5/9 to 8/9) gives it its
  behaviour and its real numbers (the Mana Well got them in issue #473, "The
  resource setting and the Mana Well" below, and the Rune Ward in issue #474,
  "The Rune Ward" below, and the Familiar Roost in issue #475, "The Familiar
  Roost and the Familiar" below). Until then each is a stand-in of an existing kind with the
  footprint of the spec and placeholder numbers: the Mana Well a slow `source`
  (1x1, interval 40 / 28 / 20, price 8 / 20 / 40, still on a node); the Rune Ward
  a 1x1 `wall` (health 120 / 200 / 300, price 8 / 18 / 36; real since
  issue #474); the Familiar Roost a
  1x2 `unit_producer` of `unit_raider` (Power on the south side, 4 per unit,
  every 80 / 56 / 40 ticks, price 20 / 40 / 70; it makes `unit_familiar` since
  issue #475); the Transmuter a 1x2
  `refinery` of Composite from 2 Ore and 2 Power (every 60 / 42 / 30 ticks,
  price 25 / 50 / 90; real since issue #476, "The Transmuter"). They are **not in `offerWeights`**: nobody can buy one
  yet, so no run holds one and no rule, battle or shop changes. (An entry gated
  by a round that has no effect yet would have been equal; leaving them out
  keeps each step's content valid without a number that means nothing.)
  `loadAllContent` refuses a specialist whose `signature` is not a building.
  Presentation text and sprites are placeholders (the Rune Ward drew as a wall
  cell until issue #474).
- **Shop gate.** "Offer roll", "Signature buildings": an `offerWeights` entry
  with a `specialist` is on offer only to a player with that specialist, from
  its `fromRound`.
- **Ghost validation** (`validateGhostSnapshot`, item 6a of "Validation"): a
  snapshot may hold a signature building, placed or in the stash, only if the
  specialist of its **owner** (`team.specialists[owner]`) is the specialist
  whose `signature` it is. A snapshot without the `specialists` field (from
  before specialists), or whose owner has another specialist, is rejected with
  an error that names the building, the owner and the specialist it needs. A
  run cannot produce the mismatch: the shop offers a signature building only to
  its owner, a stash entry or building never changes owner (CP-29) and the
  pick never changes after the step ends.
- **Bot.** Each strategy's `want` table gains the signature building of the
  specialist it picks, with a weight like the building of its family it
  resembles (`rush` `bld_familiar_roost` 7, with the Lancer hall; `fortify`
  `bld_rune_ward` 8, with the Mortar; `siege` `bld_transmuter` 4, with the
  Foundry; `weak` `bld_mana_well` 1, ignored: it buys at random), and the
  layout priority puts the Familiar Roost after the Lancer hall (`rush`) and
  the Rune Ward after the Mortar (`fortify`). Because the shop only offers the
  bot its own specialist's building, it buys and places it as it does that
  family. The Mana Well is bought but not placed by the `weak` bot (it places
  no collector). The Transmuter, a refinery, is wired only together with a
  consumer of its output, as every refinery is (issue #476, "The Transmuter",
  "The bot"). Nothing is drawn.
- **Formats.** `offerWeights[].specialist` is optional content, not saved data:
  no format number is raised.

### The resource setting and the Mana Well (issue #473; RS-13, EC-3b, PP-8)

Step 5/9 of #468: the Flowmancer's signature building and the **building
resource setting** that the Transmuter (8/9, issue #476) uses too.

- **The setting.** A building definition may declare `"resourceSetting": true`
  (an optional field of a building of kind `source` or, since issue #476,
  `refinery` only; the loader and `buildings.schema.json` refuse it on any
  other kind and any value but `true`). A **placed** building of such a definition carries `resource`, one
  **base** resource of `resources.json` (a refined resource is not allowed),
  chosen by its owner when it is placed and changeable between battles in the
  steps where the layout can be edited (`build`, `shop`), like a move or a
  rotation. It is stored on the building in the team state ("Team state and
  placement", format) and is not part of the stash entry: returning the
  building to the stash drops it, and placing it again chooses again (the first
  base resource when none is given).
- **`setBuildingResource({ actor, id, resource })`.** Reasons in order:
  `unknown_building` (not a placed building), `invalid_owner`, `not_owner`,
  `no_resource_setting` (its definition has no setting), `invalid_resource`
  (not a base resource of the content). Choosing the resource it already has
  succeeds and changes nothing (the same state is returned, nothing is
  detached). A different resource sets `resource` and **detaches every conduit
  attached to the building** with `detachConduits`, in the same way and for the
  same reason as a move (the conduits carried the old resource): the conduit
  counters and instance IDs do not change. Free. The golden ops are
  `placeFromStash` with `resource` and `setBuildingResource`.
- **Placement.** A source with the setting is placed by the ordinary rules
  ("Rule order for `placeFromStash` and `moveBuilding`") except step 10: it
  needs **no node** and may stand on **any open cell of its owner's plot**; it
  may not stand on a natural feature that blocks building (`blocked_by_feature`),
  outside its owner's plot (`outside_own_plot`) or on a Core, a building or a
  conduit. It **may** stand on a resource node (generated or added by a Rich
  vein) and then **gains nothing from it**: the node's resource is ignored, the
  node stays unused, and the setting is the resource. A node cell it covers
  makes no building `node_reserved` elsewhere.
- **The resource it makes** (`sourceResource(instance)`, one function used by
  the conduit typing, the flow graph, the flow simulation and `occupancy`):
  for a collector with the setting `instance.resource`, for any other collector
  the resource of its node. A collector with the setting and no `resource` is
  invalid state (`validateTeamState` refuses it; the flow simulation throws).
  Conduit typing, the `resource_mismatch` check and the flow graph's `produces`
  follow from it, so a Well set to Power cannot be joined to an Ore input.
- **The intents** (session). `place_building` takes an optional `resource`
  (any string; absent means the default above; a non-string is
  `invalid_intent`); `set_building_resource { id, resource }` is a new board
  intent, legal in the same steps as the other board edits (`build`, `shop`;
  `wrong_step` elsewhere), locked while the player is Ready (`locked_ready`),
  and `invalid_intent` for a non-integer `id` or a non-string `resource`. It
  adds the reasons of `setBuildingResource` to the built-in reasons. Intents are
  part of the action log, so an old log replays as it did (no log has either
  field or intent).
- **Undo (RS-5g).** The web's undo inverts a change of the setting by setting
  the old resource and re-adding the conduits the change detached (as for a
  move, under their old IDs); undoing a placement returns the building, undoing
  a return places it again **with its setting**.
- **The Mana Well** (`bld_mana_well`, Flowmancer only, 1x1, one output side,
  north at rotation 0, kind `source` with `resourceSetting` true). It makes its
  owner's chosen **base** resource (Ore, Power or Flux) at the collector rate
  of its tier; the numbers (proposed, to be tuned in #477): `intervalTicks`
  40 / 28 / 20, price 8 / 20 / 40, health 20 / 30 / 40. The **Flowmancer's
  family bonus** (`source_speed_percent`, "Family bonuses") applies to it as to
  an Extractor: it is a collector and the bonus is the owner's collector speed
  total, so, for a Flowmancer, 40 becomes `floor(4000 / 110)` = 36, 28 becomes 25
  and 20 becomes 18 (the Overclocker's cap is the same). It trades space for
  supply (Pillar 6): a cramped plot can make up for a missing node, but each Well
  costs a cell and wiring.
- **The stated exception to the rebalance principle (issue #145, SC-13a).** A
  collector fully feeds exactly one consumer of its own tier; the Mana Well
  makes **half the rate** of an Extractor of its tier (its `intervalTicks` are
  twice the Extractor's: 40 against 20, 28 against 14, 20 against 10), so a Well
  feeds **about half** a consumer of its tier. Two Wells set to one resource
  feed one such consumer through a Merger. This is intended (EC-3b, issue #473):
  it is the price of working without a node.
- **In the shop.** `economy.json` lists the Mana Well from round 2 with weight
  12 and `specialist` `spec_flowmancer` ("Offer roll", "Signature buildings"); no
  event pool offers it. Shop price and tier odds are the ordinary ones.
- **Ghost validation** needs nothing new beyond `validateTeamState` (the
  setting is checked there, above) and the signature-building rule 6a: a
  snapshot from a real run always has a base-resource `resource` on every Well,
  because the only operations that create or change one check it. A snapshot
  from before this step has no Well, so none is rejected.
- **The bot.** A strategy whose shop sells it a Mana Well uses it when the plot
  has no free node of the resource a consumer it already has or likes needs
  (the layout planner puts it on the open cell nearest the consumer, set to the
  consumer's resource, only when no node collector can feed the consumer;
  `bld_mana_well` is never placed on a node by the node steps). In the shop a
  strategy that connects buys it only for a consumer it likes that the dry run
  shows would be fed that way. No shipped strategy picks the Flowmancer except
  `weak`, which buys at random and places no collector, so the Well changes the
  shop rolls of `weak` from round 2 (and nothing else of a bot run).
- **Formats.** The optional `resource` of a placed building and the two intent
  shapes add no required field and change no existing meaning: no format number
  is raised ("Versions and saved formats" in CONTRIBUTING).
- **Vectors.** `team-state-ops.mana-well-setting` (placement on open ground,
  on a node, refusals, the default resource, a change that detaches a conduit,
  the same resource, a move, a return), `flow-graph.mana-well-on-a-node`,
  `flow-sim.mana-well-rate` (tiers 1 to 3 against an Extractor: 10, 14 and 20
  items in 400 ticks against 20; the Well feeds a Barracks with Ore and a Hangar
  with Power) and `flow-sim.mana-well-setting-change` (the same board after two
  changes: the conduits are detached and nothing is delivered),
  `arena-sim.specialist-flowmancer-mana-well` (the family bonus) and
  `shop-roll.27` and `shop-roll.28`.
- _Notes for a port:_ the setting is plain data on the placed building; read it
  wherever the resource of a collector is read and nowhere else. A Well's
  `intervalTicks` go through `scaledInterval` like any collector's, so integer
  floors are `floor(interval * 100 / (100 + P))`. Changing a setting is the one
  operation (besides a move and a return) that removes conduits; remember to
  re-add them in an undo.

### The Rune Ward (issue #474; CB-53, EC-3b, V-15, V-17)

Step 6/9 of #468: the Wardsmith's signature building.

- **The building** (`bld_rune_ward`, Wardsmith only). A defense of its own
  `defenseType`, **`ward`** (a new value: `buildings.json`, the schema and the
  loader accept it; the other values are unchanged), 1x1, one **input**, Power
  (`res_b`) on the south side at rotation 0, no output. Tier fields (all
  integers >= 1, `reflectDamage` at most `MAX_DAMAGE`): `reflectDamage` 2 / 3 / 4
  and `costPerStrike` 1 at tiers 1 to 3, health 120 / 200 / 300, price 8 / 18 /
  36 (proposed, tuned in #477). Like every building it works only while fed
  (V-15, CB-10): with no charge it does nothing. The loader refuses a `ward` with
  anything but exactly one input naming a resource and no output.
- **Not a wall.** The Ward has its own `defenseType`, so it is **not** boosted by
  the Wardsmith's bonus (`wall`, `gate`, `turret` targets), it does not count
  towards the wall limit of one set of offers (`MAX_WALL_SHAPES_PER_SHOP`, "Offer
  roll": that rule reads `defenseType` `wall`), it is not a wall for the
  threat generator, the bot's wall lists or the web's wall drawing, and it
  blocks units like any building (it is solid, not a gate).
- **What it does.** "Resolve attacks" (step 4), "Rune Ward strike": when an
  enemy unit hits a **wall or gate** of the Ward's own owner that shares an
  edge with the Ward, and the Ward holds a full charge, the attacker takes
  `reflectDamage` less its armor (`armorHit`), in the same tick. The wall takes
  its damage as before. One Ward strikes per hit: **among several candidate
  Wards the lowest instance ID with a full charge** (the recommendation of the
  issue: no stacking). Owner rules: a Ward acts only on the units of an enemy
  side (pillar 4, V-17), only for walls and gates of its **own owner** on its own
  side (never a partner's, even next to it), and it never damages a building.
  Charging is "Resolve step 2, ward charging": one item of Power per strike.
- **Which wall cell.** An attack names a building, not a cell; a multi-cell wall
  shape counts as next to the Ward if **any** of its cells shares an edge with
  the Ward's cell. A gate and the one-cell wall are single cells.
- **The rebalance principle (SC-13a, issue #145).** A Ward uses one item per
  strike and only when it is struck for, so one collector of its tier feeds one
  Ward at any hit rate a wall sees in practice (a tier 1 Extractor makes one item
  in 20 ticks; a wall's attackers hit once per attack cooldown). No exception
  to the principle is needed.
- **Event.** `ward_struck` ("Events" table; `sim-event.schema.json`).
- **Shop.** `economy.json`: `bld_rune_ward`, weight 12, `fromRound` 2,
  `specialist` `spec_wardsmith`, as the Mana Well's entry ("Offer roll",
  "Signature buildings"). A roll for any player without the Wardsmith is
  unchanged, so only the Wardsmith's shops from round 2 differ from before.
- **Ghost validation.** Nothing new: the signature-building rule 6a already
  ties it to its specialist; a real run's snapshot holds a Ward only for its
  owner. A Ward in a snapshot has no extra saved field, so no format number is
  raised.
- **Web.** The Ward's reach is shown while placing it, moving it, and while it
  is selected: the four cells that share an edge with it are tinted and outlined
  (green where a wall or gate of the player already stands), with the text
  "It strikes back for the walls and gates on the marked cells." Playback draws
  `ward_struck` as a ring on the Ward and a bolt to the attacker, and the
  battle's building table credits the damage to the Ward.
- **The bot.** `fortify` buys the Rune Ward (it is the Wardsmith's pick) and the
  layout wires it to a Power collector like a turret, on the open cell nearest
  the collector that touches a wall or gate of its own if one is in reach, and a
  wall or gate placed later goes beside a Ward that has none (`planLayout`:
  `preferred`, `placeBesideWard`); the other strategies never see it in a shop.
  Nothing is drawn.
- **Vectors.** `arena-sim.ward-strikes-back-at-wall-attacker` (a unit attacks a
  warded wall; also run with a save and restore at tick 100),
  `arena-sim.ward-no-ward-control` (the same wall with no Ward),
  `arena-sim.ward-starved-does-nothing`, `arena-sim.ward-two-wards-one-strikes`,
  `arena-sim.ward-strike-armor-floor`, `arena-sim.ward-strike-kills-attacker`,
  `arena-sim.ward-gate`, `arena-sim.ward-two-cells-away-does-nothing`,
  `arena-sim.ward-diagonal-does-nothing`,
  `arena-sim.ward-partner-wall-not-struck-for`, `shop-roll.29` and `shop-roll.30`
  (the Wardsmith's offers, and the round gate), and the content, loader and
  shop tests (`rune-ward.test.ts`). The four `run-replay` vectors that have a
  Wardsmith at a shop from round 2 (`s1-p2-market-day`, `s4-p2-drill`,
  `s214-p2-blueprint`, `s6-p2-caravan`) and `shop-roll.27` changed: the
  Wardsmith's rolls now include its entry, so its offers and the state hash
  differ; nothing else of those runs did.
- _Notes for a port:_ a Ward is a consumer with a charge, exactly as a turret,
  but with no cooldown and no target search: the only trigger is a hit on a
  neighbouring wall or gate. Precompute, per wall or gate, its candidate Wards
  in Ward-ID order at the start of the battle; test adjacency with Manhattan
  distance 1 between cells, never with the footprint boxes. Spend the charge when
  the attack is resolved, in unit order, so a charge of one serves the first
  attacker only.

### The Familiar Roost and the Familiar (issue #475; CB-54, CB-15, CB-51a, EC-3b, V-15)

Step 7/9 of #468: the Beastbinder's signature building and unit.

- **The building** (`bld_familiar_roost`, Beastbinder only). A `unit_producer`
  (CB-9, CB-13) of `unit_familiar`, 1x2, one input, Power (`res_b`) on the
  south side at rotation 0, no output; it turns with the rotation like every
  building. One Familiar per production, `costPerUnit` 4 Power, every
  `productionIntervalTicks` 80 / 56 / 40 at tiers 1 to 3 (a tier collector
  makes one item per 20 / 14 / 10 ticks, so one Extractor of its tier makes
  exactly the 4 items per 80 / 56 / 40 ticks that one Roost uses: the rebalance
  principle SC-13a holds, no exception), price 20 / 40 / 70, health 40 / 60 /
  80 (proposed, tuned in #477). It is a plain producer: it holds a finished
  unit while the exit is blocked and nothing else is new in its rules.
- **The unit** (`unit_familiar`, `units.json`). Health 20, damage 5, attack
  cooldown 10, **move cooldown 3** (speed `floor(240 / 3)` = 80 sub-cell units
  per tick: the shortest of any ground unit, the raider's is 4), radius 60,
  collision radius 39, reach 60, melee, ground, no armor, no splash. About half
  a Soldier's health (40) and a little below its damage (6); the issue's
  numbers, where the design note (CB-54) said about 40% health and two thirds of
  a Soldier's move cooldown (4, equal to the raider's): the issue wins. It
  follows the normal target rules (CB-15b, CB-15c, CB-16) with no rule of its
  own, and it is the unit of its owner (CB-15a), so the Beastbinder's
  `unit_health_percent` 10 applies: `floor(20 * 110 / 100)` = 22 health, damage
  5. Because it runs 80 sub-cell units per tick over a 240-unit cell, it
  reaches a Core well before a Soldier does (40 per tick).
- **Not used by threats.** No `threats.json` composition, signature or boss
  names it: it is player-only, and a Familiar appears only from an owner's Roost.
- **Run modifiers.** The unit-targeted modifiers read the unit's ID as for any
  unit (`units` lists name it only if they list it); the table of "Unit move and
  attack speed" has its row.
- **Shop.** `economy.json`: `bld_familiar_roost`, weight 12, `fromRound` 2,
  `specialist` `spec_beastbinder` (as "Offer roll", "Signature buildings"). A
  roll for any player without the Beastbinder is unchanged, so only the
  Beastbinder's shops from round 2 differ from before.
- **Ghost validation.** Nothing new (rule 6a ties the Roost to its specialist).
  No new saved field: no format number is raised.
- **Web.** Presentation text for the unit and the building, a unit sprite
  (`unit_familiar`) and the Roost's sprite in the atlas.
- **The bot.** `rush` picks the Beastbinder and wants the Roost (weight 7, as
  the Lancer hall), wires it to a Power collector like any consumer (it is in
  the bot's consumer list) and places it after the Lancer hall in the layout
  priority, as set up in #472. Nothing is drawn.
- **Vectors.** `arena-sim.familiar-roost-reaches-core` (a Beastbinder's
  extractor and Roost: Familiars with 22 health reach and destroy an empty
  Core), `arena-sim.familiar-outruns-soldier` (a Familiar, a raider and a
  Soldier at equal distance: the Familiar hits the Core first), `shop-roll.26`
  (the shipped list with a Beastbinder, now showing Roosts) and the content,
  loader and shop tests. `speed-modifiers.test.ts` gains the Familiar's rows.
- _Notes for a port:_ nothing is new in the rules: read the unit's numbers from
  content like any unit, and the producer from `buildings.json` with
  `unit: "unit_familiar"`; the speed is only the smaller `moveCooldownTicks`.

### The Transmuter (issue #476; CB-55, CB-56, CB-57, EC-3b, V-15)

Step 8/9 of #468: the Alchemist's signature building, the first refinery with
**one** input and the second user of the building resource setting. Numbers
are the issue's and proposed; they are tuned in #477.

- **Content.** `bld_transmuter`: kind `refinery`, `"resourceSetting": true`,
  footprint 1x2, one input on the south side that names **no resource**, one
  output on the north side. Per tier `costPerBatch` 2 (items taken per batch),
  `outputPerBatch` 1, `productionIntervalTicks` 60 / 42 / 30, price 25 / 50 /
  90, health 40 / 60 / 80. It has no `output`: the resource it makes is the
  setting of the placed building. The schema (`tierTransmuter`) and the loader
  refuse `costs` on it and `costPerBatch` on any other refinery; they check
  that it has exactly one input and no `output`.
- **Setting.** The placed building carries `resource`, a base resource, exactly
  as a Mana Well does ("The resource setting and the Mana Well"): `placeFromStash`
  takes it (default: the first base resource), `setBuildingResource` changes it
  between battles and detaches both its conduits, returning it to the stash
  drops it. `validateTeamState` requires it on a placed Transmuter. A
  Transmuter is not a collector, so it is placed like any refinery: it needs an
  open cell of its owner's plot and **may not stand on a node**
  (`node_reserved`), unlike the Mana Well.
- **Typing (CB-5b).** The one input takes **any base resource**: the conduit that
  feeds it sets what it takes, as a route carries what it is fed. A conduit
  carrying a refined resource into it is `resource_mismatch` (it takes base
  resources only). A conduit leaving it carries the resource of its setting
  (`refineryOutputOf`: the definition's `output`, or the setting), so a
  Transmuter set to Power cannot be joined to an Ore input, and changing the
  setting detaches the conduits for that reason. The flow graph node has
  `kind` `refinery`, `produces` null, and its input has `requires` null.
- **Rule.** One tick of a Transmuter is a tick of a refinery ("Refineries")
  with one counter: its resource is the one its input conduit carries (in the
  flow simulation: the `resource` of the edge into it, in the sim's consumer
  input list), its cost `costPerBatch`, its output the setting. It takes up to
  `costPerBatch` items into the counter, makes a batch when the counter is full,
  the cooldown is 0 and the store is empty, puts `outputPerBatch` items of the
  setting resource into the store and releases one per tick; a refused item
  makes it stalled, an output side with no conduit loses the item. Speed and
  Alchemist bonus are the refinery's: the owner's `production_speed_percent`
  shortens `productionIntervalTicks` to `max(1, floor(interval * 100 / (100 +
  P)))` (60 becomes 52 for +15%; CB-57).
- **Same resource.** If the resource its input carries equals its setting it
  is **idle**: it takes nothing in, makes nothing (no counter fills, no batch,
  no event), and the input buffer and the conduit back up to the collector,
  which stalls. The build screen says "same resource" on it. With no conduit
  attached, or one whose resource is not determined (nothing feeds it), it is
  idle too. The issue states it this way; the spec (CB-55, CB-56) had said such
  a feed is refused by the editor, and was changed to match.
- **Conservation.** Items the Transmuter takes are `consumed` when taken, the
  items it makes are `produced` when the batch is made, so a Transmuter loses
  `costPerBatch - outputPerBatch` = 1 item per batch in the count (the loss is
  `consumed` that never turns up as a consumer's delivery); the law of
  "Conservation" holds at every tick (checked in the tests and the vectors).
- **The stated exception (SC-13a, issue #145).** Refining pays a premium; this
  pays a penalty: a collector feeding a Transmuter makes **twice** as many
  items as arrive on the other side, so it never creates supply and cannot beat
  the rebalance principle.
- **Alchemist.** It is a refinery, so the Alchemist's production speed applies
  to it (CB-57).
- **In the shop.** `economy.json` lists it from round 2 with weight 12 and
  `specialist` `spec_alchemist`. Ghost validation (rule 6a) needs nothing new.
- **The bot.** The layout planner puts a stashed Transmuter in a chain only for
  a stashed consumer with one base-resource input that the plot has **no open
  node** of (no node of that resource without a building on it, other than the
  ones the style keeps back): it sets the Transmuter to that resource, places
  it beside a collector of another base resource (a placed free one, or a
  stashed one put on a free node), joins them and places the consumer beside
  the Transmuter, all or nothing. In the shop a strategy that connects buys a
  Transmuter (one only) when that chain would be placed for a consumer it likes
  or already holds, with gold left for the consumer and one collector, and then
  also buys the consumer that waits for it. Only `siege` picks the Alchemist.
- **Vectors.** `flow-sim.transmuter-conversion`, `-same-resource`,
  `-output-backs-up`; `flow-graph.transmuter-takes-any-base-resource`;
  `team-state-ops.transmuter-setting`; `arena-sim.transmuter-feeds-roost`,
  `-alchemist-bonus`, `-same-resource-makes-nothing`; `shop-roll.31` and `.32`.
  No existing vector changes.
- **Formats.** No format number is raised: the optional `resource` of a placed
  building (issue #473) and the optional `resourceSetting` and `costPerBatch`
  of content are all there is.
- _Notes for a port:_ the resource of a Transmuter's input is read when the
  board sim is created (from the conduit graph) and does not change during a
  battle; `idle` is decided then. Counters are one number; there is no sorting
  of costs. Everything else is the refinery code with `costs` replaced by one
  entry.

### Saves and snapshots (no format number raised)

The run state format stays 10 and the ghost snapshot format 7: `specialists`
is an optional team-state field (see its entry in "Team state and placement")
and `specialist_pick` is a new allowed value of `step`, not a changed shape.
A save or a ghost made before this step has no `specialists` and, for a save,
is in a step after `specialist_pick`; it loads and plays as it always did.
A ghost snapshot carries the field as part of `team` (MM-1e); validation is
`validateTeamState` (above) with the roster of the content, so an unknown
specialist ID, a list of the wrong length or one that is all `null` is
rejected, while a snapshot without the field is accepted, and so is one whose
entries are equal. The size limit of "Validation" has the term
`partySize * specialistEntry` (the canonical length of the longest specialist
ID plus a comma), well inside the margin. A snapshot of a real run has every
entry set (a run cannot leave `specialist_pick` otherwise).

### Family bonuses (issue #471; CB-51a, CB-57, EC-8a, EC-8b)

A specialist's `effects` are **owner-scoped**: each acts only on the buildings
and units **owned by the player who picked it** (a building's owner is
`PlacedBuilding.owner`; a unit's owner is the owner of the building that made
it, CB-15a). It never touches a partner's, the other side's, a scheduled
wave's or burst's, a guard's or a boss's things. The effects are read from the
roster of the loaded content at the start of a battle, by the ID in the
team's `specialists` list (`specialistEffectsOf(team, roster, owner)`; none
when the team has no list, the entry is null, the ID is not in the roster or
`owner` is not a player index). A ghost's team carries its list, so a ghost's
bonuses act for that party exactly as they did for it, and a team without the
list (a save or snapshot from before specialists) plays as it always did.
Nothing is stored for them in a battle state: the sums below are derived from
the team and fixed for the battle (`ArenaContext.specialist`, per side and
player index; they are not part of the state hash or of a saved state).

A sum of effects is `specialistPercent(effects, kind, target?)`: the plain sum
of the `percent` of the effects of that kind (for `building_health_percent`
only those whose `target` is `all` or equals the building's target, below).

| Kind | What it changes, for the owner's things only | Rule |
| --- | --- | --- |
| `building_health_percent` (`target`) | the maximum (and so starting) health of a matching building, not the Core | `maxHealthOf`: **summed with the Shrine effects of the same kind and target, floored at `minModifierSumPercent`, applied once** (below) |
| `unit_health_percent` | the health of a unit spawned by one of the owner's unit producers | health only, **summed with the strength percent and applied once** (below) |
| `source_speed_percent` | the owner's collectors (sources) | added to the owner's `source_speed` ramp total **before the cap** (below) |
| `production_speed_percent` | the owner's refineries and the owner's economy (ramp) buildings | shortens the batch interval of a refinery and the step interval of an Overclocker or Armory by the interval rule (below) |

**The interval rule.** For a bonus `P` and a whole interval `T` of at least 1,
the interval becomes `scaledInterval(T, P) = max(1, floor(T * 100 / (100 +
P)))`: the same function as the collector rule of "One tick: `stepFlow`". It
rounds in favour of the owner, never goes below 1 tick, and a short interval
can gain more than the stated percent. For `P = 10`: 20, 14, 10 become 18, 12,
9. For `P = 15`: the Overclocker step 40, 42, 40 (tiers 1 to 3) become 34, 36,
34; the Armory step 80, 70, 60 become 69, 60, 52; a refinery interval 60, 42,
30 becomes 52, 36, 26. A countdown or cooldown that is already running is
never changed; only the next reset reads the value. The first countdown of a
battle is the plain interval.

**Building health (Wardsmith).** `maxHealthOf(team, building, content,
minModifierSumPercent)` for a building that is not a Core takes `target =
defenseType ?? kind` (a defense matches its defense type, `wall`, `gate`,
`turret` (the Mortar too) or `ward`/`pylon`; any other building its kind).
`sum = max(minModifierSumPercent, shrine + specialist)`, where `shrine` is the
sum of the team's `building_health_percent` effects whose target is `all` or
`target`, and `specialist` is `specialistPercent(effects of the building's
owner, building_health_percent, target)`; then `health = floor(tier health *
(100 + sum) / 100)`, one rounding. So with Stout walls (+25) and the
Wardsmith (+15) a wall has `floor(250 * 140 / 100) = 350`, not 359; a partner's
wall has the Shrine's 25 only. The `sum` is checked like any modifier sum
(`RangeError` beyond the safe range or `MAX_HEALTH`). The raised health is the
health the building starts the battle with and the health its breach cost is
computed from (the Build screen's enemy-path preview calls the same
function). A side option health override (a pylon or Core override) is raised
the same way. The Rune Ward is a defense of type `ward` and is not boosted.

**Unit health (Beastbinder).** `unitStats(side, def, strengthPercent,
healthPercent, move, attack, armor, splash, healthBonusPercent = 0)`: with
`H = healthBonusPercent` above 0 the health is `mulPct(base health, 100 + P +
H)` (one rounding, `P` the strength percent) instead of `mulPct(base health,
100 + P)`; damage uses `P` only; a champion's `healthPercent` is then applied
as before. `H` is the owner's `unit_health_percent` sum, read at the moment
the unit is spawned from one of the owner's producers (`addUnit`, and
`spawnUnitForTest` with an `owner`); a unit without a producer (a scheduled
wave, a burst, a guard) gets `H = 0`. It is **outside** the Armory cap
`maxUnitStrengthPercent` and the point-bonus cap. The up-front check of
`createArenaSim` (`assertStrengthBounds`) includes the largest `H` of the
side's players, so a bound is failed at setup, never mid-battle.

**Collector speed (Flowmancer).** `rampBonus(sim, ctx, side, 'source_speed',
owner)` is `min(maxSourceSpeedPercent, raw)` with `raw` = the owner's ramp
total (`steps * stepPercent` of the owner's living Overclockers) **plus** the
owner's `source_speed_percent` sum. With no Overclocker the bonus is the
specialist's alone (10); with a tier 3 Overclocker at five steps (+25) it is
`min(25, 35) = 25`: the two never go past the cap. Each owner is computed on
their own and a partner gets nothing from it. The arena puts this number into
`FlowContext.sourceSpeedPercent[owner]` before every flow step, from the first
tick of the battle (before any ramp step), so the first reset of a collector
already reads it. `rampBonus` for `unit_strength` is unchanged.

**Production speed (Alchemist).** The arena puts each owner's
`production_speed_percent` sum into `FlowContext.refinerySpeedPercent[owner]`
(a list by player index, a missing entry or an absent list is 0; a dry run
leaves it unset) before every flow step. In step 3a.3 a refinery that makes a
batch sets `cooldown = scaledInterval(productionIntervalTicks, P)` with the `P`
of its owner (`PlanRefinery.owner`); this is the shortest time between
batches, supply still decides whether it is reached. At the start of a battle
`createArenaContext` sets the step interval of each of the owner's economy
buildings (`RampInfo.stepInterval`) to `scaledInterval(stepIntervalTicks, P)`
for the same owner sum, so the ramp reaches its steps sooner. The step size
(`stepPercent`), each building's `maxSteps`, `costPerStep` and the owner caps
are unchanged: the ramp reaches its cap sooner and never goes beyond it. Unit
producers, turrets and collectors are not changed by it.

**Display.** The run bar's Bonuses popover shows the acting player's family
bonus, one line per effect, under "Specialist bonus: <name>", apart from the
party's modifiers.

**Golden vectors** (`arena-sim.specialist-*`): `flowmancer-collectors` (the
18, 12, 9 intervals and the neighbour on the base cadence),
`flowmancer-overclocker-cap`, `wardsmith-health-stacks-with-shrine` (the
Shrine sum and the neighbour with the Shrine only), `beastbinder-unit-health`
(44 against 40), `beastbinder-with-armory` (46, 48, 50, 52, 54), 
`alchemist-ramp-steps` and `alchemist-refinery-batches`.

### Notes for a port

- Family bonuses (#471): all sums are integers; keep the order of the
  operations of "Family bonuses": health `floor(tier health * (100 + max(floor,
  shrine + specialist)) / 100)`; unit health `floor(base * (100 + P + H) /
  100)`; collector speed `min(cap, ramp raw + specialist)`; every speed
  interval `max(1, floor(T * 100 / (100 + P)))`. Never compound a specialist
  with a Shrine effect. An owner index outside the list, a null entry, an
  unknown ID or a missing list means no bonus. Iterate the players by index
  and the effects in file order (no map or set iteration order).
- A port reads `specialists` as an optional list of `partySize` nullable
  strings and omits it when every entry is null (the canonical JSON and the
  hash depend on this).
- `createRun` starts in `specialist_pick` with `pending` null; the Core
  placement step then starts with every position null. The action log of a run
  therefore begins with `pick_specialist` and `ready` of every player.
- Match the order of the checks: step table, locked, then in `ready` the
  pick check (`specialist_not_picked`) before anything else of the step.
- No random draw anywhere in this step.

## Ghosts

A ghost is another run's party, frozen at the start of one of its PvP battles
and fought by a later run (MM-1..MM-17, W3-1). Everything below is implemented
in `core/src/ghost-snapshot.ts` (format and validation) and
`session/src/rules/ghosts.ts` (taking, matching, selecting); the pool itself is the
`GhostStore` interface (`session/src/app/ghost-store.ts`, see the session README).
Ghosts are switched on by giving the run's deps `ghosts` (`createGameDeps(...,
{ ghosts: { ownerId } })`); without it PvP always fights the generated boss.

### Format (`schemas/ghost-snapshot.schema.json`)

`formatVersion` (7), `gameVersion` (`major.minor`, the run's `runVersion`),
`partySize`, `round`, `mapSeed` and `team` (the whole team state: map, Core,
buildings, stash, conduits, modifiers), `owner` (`{id, label}`; the id is a
stable install identifier, the label is shown to opponents), `runId`, `lives`
(lives left when taken), `pvpRecord` (`{wins, losses}`: the PvP battles of the
rounds before this one). `runSeed` and `actionLog` are reserved for TA-22b and
NOT accepted yet: `snapshotOf` never writes them and a snapshot carrying either
is rejected (an unbounded value there would be copied into the run state and
its save). `mapSeed` is the run's seed: the party's map is
`generateMap(mapSeed, partySize)`, so a verifier regenerates it and compares
(this also covers the map-integrity question of issue #51 for ghosts). A
snapshot is plain JSON and round-trips through `JSON.stringify` unchanged.
Its bucket is `(gameVersion, partySize, round)`; an owner has at most one
snapshot per bucket, a newer one replaces it (MM-1c).

### When it is taken

On entering the PvP battle (`pvp_battle`), before the fight, win or lose
(MM-1a). `snapshotOf(state, owner)` is a pure function of the run state at
that moment; the machine puts its result in a `ghost_snapshot` effect. The run
controller writes it to the store after the save of that step succeeded. The
store is never touched by `applyIntent`, `replayRun` or any validation of a
run state, so replaying a run needs no pool.

### Matching

A snapshot is eligible for a run only if its `gameVersion` equals the run's
`runVersion`, its `partySize` equals the number of players and its `round`
equals the run's round (MM-2), it is not from the run itself (`runId`), and
that ghost (its owner and run, `ghostKey`) has not been fought in this run
already (`state.ghostsFought`, MM-3). Own-device snapshots of other runs are
eligible (the last five per bucket are kept, see "Local pool limits"): a local
pool has one owner id, so excluding the owner would make the pool useless.

### Selection

The opponent is fixed in the shop of the PvE leg, the step before the PvP
battle, by the intent `select_ghost` (extension handler, shop only, once per
round). Entering that shop emits `ghost_selection_needed`; the run controller
reads the pool and sends `select_ghost` as the host with the candidates as
payload (at most 16 valid ones, found with bounded work, see "Bounded work per
selection" below). The party cannot `ready` in that
shop until it has been applied (`ghost_selection_pending`). The handler:

1. validates and filters the payload again (nothing in it is trusted), drops
   duplicates, and sorts by `(owner id, run id)`;
2. takes the stream `ghost:r<round>` (`drawStream`, which advances the run
   generator by exactly one output whatever the payload holds);
3. with `n >= 1` candidates picks `candidates[stream.nextInt(n)]`; with none,
   the boss, chosen with `pickBoss` (MM-9b, MM-9c; "Choosing and summarising")
   with `round` the run's round, `partySize` the number of players, `previousBoss`
   the boss ID of the run's most recent boss battle (the latest round record,
   this round's last, whose PvP opponent is a boss with a `boss` ID; not just
   the previous round), and the generator `stream.child("boss")` (a child draws
   nothing from the stream, so the ghost draw above is the same whatever the
   boss);
4. stores the whole chosen snapshot in `state.pvpOpponent = { round, kind:
   'ghost' | 'boss', label, ghost, boss? }`; `boss` is the archetype ID, only
   for a boss.

The boss thus has the same stream as the ghost draw, and `pickBoss` is the one
place that decides it. MM-11: the shop before a boss battle can name the boss
(the web text is in `packages/web/src/run/boss-text.ts`).

Skipping an invalid snapshot and drawing another is therefore done by
filtering before the single draw, which is the deterministic form of that
rule. The action log does not keep the payload (16 candidates were 94% of a
save): the machine logs a compact record instead, see "The logged form" below,
so `replayRun` repeats the draw with no store; the PvP battle uses the stored snapshot's team as side 1 (the
existing `startBattle` with the party as side 0), stores it in the battle
detail like any ghost, and clears `pvpOpponent` afterwards (the ghost's key
joins `ghostsFought`). A reload before the battle reads the same
`pvpOpponent` from the save. If a run was saved after entering the shop but
before the selection, `RunController.prepare` finishes it when the run is
opened. Players are told before the battle whether it is the boss and, for
the boss, which one (MM-11): the shop's Next battle panel is headed "Rival
party" for a ghost and "Boss battle next" for the boss; there is no
"Opponent:" line, and the ghost's label is not shown. When the opponent is the
boss, the panel also gives its name, one line on its mechanic and one line of
counter advice (`packages/web/src/run/boss-text.ts`; a save made before the
boss was stored gets the generic lines, a computer-made stronghold, not
another party).
Presentation only: whether the next opponent is the boss follows from
`pvpOpponent` alone, so no "boss in N rounds" is shown (there is no fixed boss
round).

If the automatic selection fails (`save_failed`, or `invalid_state` from the
validation before the save), nothing is chosen and the failure is reported, not
swallowed: the dispatch that entered the shop returns `selectionFailure`
(`{ reason, detail? }`, additive), a `ready` refused with
`ghost_selection_pending` carries the same cause, `prepare` resolves with it,
and `controller.selectionFailure` holds the last one. The next `dispatch` or
`prepare` retries the selection. `select_ghost` is in `allowedIntents` of the
host only while a selection is owed.

Only the host may send `select_ghost` (`not_host` otherwise; it is not in
`allowedIntents` of other players), so a non-host cannot force the boss with an
empty list.

#### The logged form

`applyIntent` receives `{ type: 'select_ghost', candidates }` but the action log
gets a normalised, compact entry (the handler returns it as `logged`; the
machine stores it instead of the intent; `replayRun` hands it back to the
handler in replay mode, where it is the only form accepted, and live it is
refused with `invalid_intent`):

    { type: 'select_ghost',
      n,            // valid candidates after filtering (0: the boss)
      index,        // the drawn index, nextInt(n) on ghost:r<round>; null if n = 0
      chosen,       // the snapshot as validated live; null for the boss
      hash,         // hashJson of the canonical candidate list (audit / signing)
      chosenHash }  // hashJson(chosen); null for the boss

`replayRun` takes the stream `ghost:r<round>` as the live path did (for `n = 0`
it chooses the boss exactly as the live path, so the log needs no boss field),
checks that
`nextInt(n) === index`, checks `chosen` for structure only
(`checkGhostSnapshotShape` with no rules, no economy and no events: the fixed
size cap `GHOST_MAX_SERIALIZED_BYTES` (2 MiB) is the only size limit), checks
`hashJson(chosen) === chosenHash`, that it belongs to the run's bucket, is not
the run's own and has not been fought, and uses it. It does NOT run the value,
tier, modifier (known to events, effects, stackable) or derived size bounds
again: those are today's numbers, and replaying a run must not depend on them
or on the pool. Restore does the same for `pvpOpponent.ghost` (structure, the
`rules` lives checks as before, and the 2 MiB cap), so a run saved under
earlier content or economy numbers still loads. Only selection of a new ghost
applies every bound. A wrong index, a changed or swapped
snapshot, a malformed entry or the old `candidates` form fails the replay with
`replay_mismatch` at that action; it never falls back to another opponent.
`hash` commits the run to the pool it saw but cannot be recomputed in a replay
(no list); `chosenHash` is what binds `chosen` in the log. A log is not
signed, so someone who edits both `chosen` and `chosenHash` consistently can
still pick another valid-looking opponent: that is the signing phase (TA-22a).
Measured: a 10-round solo run beside 16 owners went from 264,717 bytes to about
36 KB (11.6 KB without ghosts).

### Validation (`validateGhostSnapshot`)

Every candidate, and a ghost inside a loaded run state, must pass all of:

1. **Shape and size**: no unknown fields at any level (`runSeed` and
   `actionLog` are reserved and rejected), `formatVersion` 7, `gameVersion` as
   `major.minor`, sizes and ids within their limits (labels printable, at most
   40 characters). Checked first, on the raw value, stopping at the first
   violation: plain JSON only, every number a safe integer (and not `-0`), no string or key with a lone
   surrogate (canonical JSON refuses both, so a snapshot that passes can always
   be hashed), nesting at most 16
   levels, every string and key at most 128 characters, and a canonical JSON
   length of at most `ghostMaxSerializedSize(partySize, round)`, below. Only
   `partySize` (1 to `maxPartySize`) and `round` (1 to `GHOST_MAX_ROUND`, 200) are read before
   this walk, and a value where either is not an integer in range is rejected
   without being walked. The walk counts characters incrementally, each string at its length as JSON writes it (quotes, backslashes and `\b \t \n \f \r` two characters, other control characters six), and gives up
   as soon as the budget is exceeded (an array or object whose element count
   alone cannot fit is rejected before its elements are visited; nothing is
   sorted), and at most 10 errors are reported (then "and N more").

   **Size limit.** At most `GHOST_MAX_SERIALIZED_BYTES` (2,097,152, fixed,
   independent of content, economy and events): the limit below is clamped to
   it, so whatever selection accepts always restores. At round 200 the derived
   limit is below the cap for every party size (party 4: 1,053,694). Restore
   and replay use the cap alone. The derived limit, from what a legitimate snapshot can contain, with
   `cells = partySize * plotWidth * plotDepth`, `V = ghostValueBound(round,
   partySize).limit` and `N = floor(V / cheapest tier-1 price)` (`cells` when
   `ghostMaxSerializedSize` is called without economy numbers):

       limit = cells * mapEntry                          (every cell a feature or node)
             + min(cells, N) * (buildingEntry            (every cell a building ...
                                + 2 * conduitEntry)      ... with two conduit ends per side pair
             + cells * conduitCellEntry                  (or a conduit cell)
             + N * stashEntry                            (the whole value bound in the stash)
             + partySize * maxAddedNodesPerPlot * addedNodeEntry   (Rich vein)
             + (2 * round - 1) * modifierEntry           (one modifier per event step)
             + partySize * specialistEntry               (one specialist per player, RS-13)
             + 4096                                      (margin: ids, labels, counters)

   Each entry is the canonical length of a worst-case sample (longest content
   id, highest coordinates, instance id of 7 digits) plus a comma. With the
   shipped content: party 1 gives 33,287 (round 1), 58,064 (round 10) and
   99,359 (round 25) characters; party 4 gives 120,542, 213,926 and 369,566.
   (The earlier flat `4096 + 12288 * partySize` dropped a legitimate late
   four-player board of about 63 KB at round 23; the limit now always exceeds
   what the board and the value bound allow.)
   **Tithe in the size limit** (issue #425). The size limit is a worst case over
   every modifier set a run can hold, not over the snapshot, so `V` is taken
   with `T = bestTitheAmount * (2r - 1)` (a Tithe at every event step; 0 when
   the content has no `shop_income_flat` modifier). This grows `V` with the
   square of the round: with the shipped content the party 4 limit goes from
   1,112,200 to 2,097,152 (the cap) at round 100 and from 1,659,200 to the cap
   at round 200 (events without the Caravan), and from 288,283 (was 258,880) at
   round 5. A limit that reaches the cap is the cap: restore and replay use it
   anyway, and the cap clamps it.
   **Building count.** A snapshot with more buildings than the board has cells
   (`partySize * plotWidth * plotDepth`) is rejected before the team is
   checked: placed buildings cannot overlap, so a legal board never exceeds it.
   **Conduit count.** Before the per-conduit checks run, a snapshot with more
   conduits than `buildings * (most output sides of any building definition)`
   is rejected: each conduit takes one output side of a placed building and a
   side carries one conduit end (`side_in_use`; the Core is not a conduit
   end), so a legal board never exceeds it. The per-conduit checks themselves
   are linear in the number of conduits (side and cell use are counted once), and
   so is the network analysis (the topological sort uses a heap of ready nodes
   and the merger check an index of the first conduit into each side; results
   and error order are unchanged). The bound uses the content maximum (3
   output sides for the shipped splitter; the loader allows up to 4).
2. **Whole team state** (`validateTeamState`): legal placement on its own map
   (extractors on nodes, nothing on natural features, a legal Core position,
   known buildings, tiers 1 to 3, conduits), plus a Core must be placed (until each player places their own, issue
   #131, at least one; the snapshot's `team.cores` has one entry per player)
   and the map's party size equal `partySize`.
3. **Map**: `team.map` equals `generateMap(mapSeed, partySize)`.
   Nodes added by Rich vein (issue #414, MM-17) are not in the map: they are the
   team's optional `addedNodes`, so a ghost's map is still exactly the
   generated one. The generated map plus the added nodes is accepted when each
   added node passes the team-state rules (its owner's plot, a buildable cell
   off the plot's front row, not on a feature, node or Core, a base resource,
   at most `maxAddedNodesPerPlot` per plot, rounds not decreasing) and its
   `round` lies from the first `fromRound` of a `rich_vein` event up to the
   snapshot's round (no such event in the events file: none accepted). A node
   written into `map.nodes` instead fails the map comparison.
4. **Numbers**: `wins + losses = round - 1`, `lives <= startingLives` and
   `losses * pvpLossLifeCost = startingLives - lives`.
5. **Value bound**: the sum of the shop prices (at the building's tier) of
   every building, placed or stashed, is at most the bound below.
6. **Tier bound**: for every owner, the number of tiers above the highest tier
   the shop could have sold is at most the number of Workshop or Drill raises possible.
   Exactly, with `shopTier(r)` the highest tier with a non-zero weight in any
   `economy.tierOdds` row with `fromRound <= r` (and at least the tier of every
   starting-kit entry, and 1), and `raises(r) = 2r - 1` if `events.json` has an
   event of type `workshop` or `drill` (the event steps before this round's PvP battle:
   two per earlier round plus this round's PvE event; each Workshop raises one
   building per player by one tier), else 0: for each owner,
   `sum over its buildings (placed and stashed) of max(0, tier - shopTier(r))
   <= raises(r)`. With the current content `shopTier` is 1 for rounds 1-2, 2
   for rounds 3-4 and 3 from round 5, and `raises` is 1, 3, 5, ... So a round-1
   ghost may hold one tier-2 building but not a tier-3 one, even if its value
   fits the bound; from round 2 a tier 3 is reachable by two raises
   (`ghostTierBound`).
6a. **Signature buildings** (issue #472): every building, placed or stashed,
   whose `def` is the `signature` of a roster specialist belongs to an owner
   whose `team.specialists[owner]` is that specialist ("Specialists", "Signature
   buildings in the shop"); an owner with another specialist, with none or in
   a snapshot without the field is rejected (`team: player N has "<def>", the
   signature building of "<specialist>", ...`). Content is read from
   `content.specialists`; nothing else changes the rule for other buildings.
7. **Modifiers**: each is known to `events.json`, has exactly its defined
   effects (including `units`, compared as canonical JSON), a non-stackable
   one is held once, its `fromRound` (default 1) is at most the snapshot's
   `round`, and there are at most `2 * round - 1` of them (one per event step
   that can have happened by then). A pact (`pact: true`) is also held only
   from the first `fromRound` of a `pact` event in `events.json` (no such event:
   never). Negative effects need no special rule: the effects must equal the
   definition (so a drawback cannot be dropped or weakened), a pact is one of
   the `2 * round - 1` slots like any modifier, and the value and tier bounds do not
   read modifiers, so a drawback neither passes nor hides extra power.

The value bound, for `n` players at the start of the PvP battle of round `r`:

    per player = startingGold
               + baseIncomePerShop * (2r - 1)     shops entered so far
               + best pveWin * r                  best PvE win of each round up to r
               + best PvP gold * (r - 1)          PvP win or loss gold of the rounds before
               + maxEventGold * (2r - 1)          every event a Windfall
               + drillStep * (2 * (r - f) + 1)    free Drill raises, if a Drill event exists (f its fromRound, r >= f)
               + kit                              price of the starting kit
    limit = n * (per player gold + kit)

A held Tithe (issue #425) adds to the bound: `+ T * (2r - 1)` per player,
with `T` the sum of the `amount` of every `shop_income_flat` effect in the
snapshot's `modifiers`, so a Tithe is counted at every shop up to the round
(more than it can have paid). Without such an effect `T` is 0 and the bound is
exactly as before. `sell_refund_percent` adds nothing (a sale returns less than
was paid). No strength is counted for either kind: the arena ignores them.
There is no margin. Every gold source is counted at its best case; buying turns
gold into building value one for one; selling returns less than was paid; and a
Workshop upgrade adds less value (`price(t+1) - price(t)`) than it costs
(`floor(price(t+1) * workshopPricePercent / 100)`), which a test checks for
every building and tier of the shipped content, so no chain of upgrades can
manufacture value. (An earlier version added 25% for "Workshop upgrades that
turn gold into slightly more value"; that was wrong and the margin was
removed. A fuzz of seeded runs that buy, re-roll and upgrade shows no false
rejection and a highest value-to-limit ratio of at most 1.) A Drill raises a
collector for free, which does add value without costing gold, so the bound
counts it: `drillStep` is the largest `price(t+1) - price(t)` (t = 1, 2) of any
collector (`kind` `source`; 25 in the shipped content), and `2 * (r - f) + 1`
is the number of event steps from the Drill's `fromRound` `f` up to the PvP
battle of round `r` (the PvE event of rounds `f..r` and the PvP event of
rounds `f..r-1`); 0 without a Drill event. With the current content
(starting gold 10, income 5, hard win 13, PvP win 8, Windfall 4, Drill from round 2,
kit worth 67):

| Party | Round | Gold per player | Limit |
| ----- | ----- | --------------- | ----- |
| 1     | 1     | 32              | 99    |
| 1     | 2     | 96              | 163   |
| 1     | 3     | 185             | 252   |
| 1     | 5     | 363             | 430   |
| 1     | 8     | 630             | 697   |
| 1     | 12    | 986             | 1053  |
| 2     | 3     | 185             | 504   |

The bound is the installed version's, which is also the ghost's version
(MM-15), so no tolerance for runs that spanned an update is needed yet (MM-17).
The signature check (TA-22a) is not implemented.

### PP-17. Formats, version and ghost validation

Implemented (issues #135, #131, #139, #160).

- **Major version.** The game's major version is 1.0. At first start,
  saves of older major versions are deleted and the local ghost pool is
  emptied, as for any major release (TA-8). There is no migration.
- **Team state**: `cores` in place of `core` (PP-2); `owner` on every conduit
  (PP-1); conduit ends may be border spots (PP-4); the optional `specialists`
  (issue #470; no format number raised, see "Specialists").
- **Formats.** Ghost snapshot `formatVersion` 7, run state format 10 (both raised by issue #291, which replaced the wall `bld_wall` by seven shapes). Older
  values are rejected (a logged `chosen` snapshot of another format is
  refused in `select_ghost` and in `replayRun`).
- **Ghost validation** (`validateGhostSnapshot`) adds, through
  `validateTeamState`: every Core placed and inside its player's plot, with
  exactly one placed Core per player; every building inside its owner's
  plot; every conduit and half owned and placed as PP-1 and PP-4 require; no
  mismatch or loop on the joined network. Plot and ownership checks are
  implemented in `validateTeamState` (`packages/core/src/team-state.ts`; error
  `outside_own_plot`; tests in `packages/core/src/ownership.test.ts` and
  `per-player-cores.test.ts`).
- **Value bound per owner.** Gold cannot be given (CP-29), so the bound is
  applied to each owner: the shop value of an owner's buildings, placed or
  stashed, is at most `per player gold + kit` (`goldPerPlayer + kitPerPlayer`
  of `ghostValueBound`; the whole-team limit is that term times `N`, and a
  team that passes per owner passes in total). Implemented; an owner above
  it is rejected with an error naming the owner. The tier bound is already
  per owner.
- **Size limit.** `ghostMaxSerializedSize` keeps its form; its entry sizes
  are measured on the current format (an `owner` on conduits, `N` Cores).
  The conduit-count bound is unchanged: every conduit or half occupies one
  building side.
- **Matching** is unchanged: version, party size, round. A ghost party's
  plots face the party's one to one (PP-11).
- **Bundled ghosts** are regenerated with the current rules by the bots; a
  bundled file of another game version is ignored.

### Bounded work per selection

`presentCandidates` does not validate every row of a bucket. It first drops, by
cheap checks on the raw row (bucket, not the run's own, not in
`ghostsFought`, one row per `ghostKey`), and puts the rest in a fixed order:
by `hashJson([runId, round, key])`, ties by key. It then validates rows in that
order until 16 are valid or `MAX_GHOST_ROWS_VALIDATED` (48) rows have been
tried, and returns what it found in `(owner id, run id)` order. The same
listing gives the same result in any listing order, and the subset differs
between runs and rounds. A bucket with more than 48 unusable rows can
therefore end in the boss; that is accepted.

Replay is not affected: the action log keeps only the compact record of the
draw (`n` of at most 16, `index`, `chosen`, `hash`, `chosenHash`), and replay
and restore never read the pool or repeat the walk. A run restored after the
selection keeps `pvpOpponent` from its save, so changes to the pool between
saving and restoring (new snapshots, evictions, a cleared pool) cannot change
the opponent. A run restored before the selection simply selects again from
the pool as it is then, as before. The run-state format is unchanged.

The stores bound the reading as well (`GhostStore`):

- A snapshot larger than the size bound for its party size and round
  (`ghostMaxSerializedSize`, the bound validation uses) is refused at write
  time.
- `list` returns at most 64 rows (`GHOST_LIST_LIMIT`), in `(owner id, run id)`
  order, and does not read a row not marked as within the bound: IndexedDB
  filters on an index that only holds such rows, and localStorage reads a small
  per-snapshot meta key (bucket, owner, run, sequence number, size) before any
  value.

### Local pool limits

The local pool keeps the player's own past runs: one owner id per install, and
up to `GHOST_KEEP_PER_OWNER_BUCKET` (5) snapshots per owner per bucket
(version, party size, round), so the draw in a bucket is a real draw among the
last five runs that reached that round. When a sixth is saved the oldest is
dropped. "Oldest" is the store's own save sequence number (a counter kept in
the store; re-saving the same run counts as newest), never the clock. The run's
own snapshots and ghosts already fought stay excluded at selection. The
player can still influence ghost versus boss (plant a weak run; clear the
pool), which is acceptable for the prototype. "Clear saved opponents" stays under
Developer on the main menu (shown only in development and debug builds, or with
`?dev` in the URL) and is not on the run screens. The requirements of
the shared Steam pool (identities, anti-tamper, abuse) are tracked in
issue #79. The ghost database moved to version 2 for this change; the upgrade
empties the local pool, which refills as runs are played.

### Bundled ghosts

A build ships a fixed file of ghosts (`packages/web/src/run/bundled-ghosts.json`)
so a new install does not meet only bosses (MM-12). They are taken by the
scripted bot with the pool on: `pnpm sim ghosts` (alias `pnpm ghosts:update`)
plays four strategies on eight seeds for party sizes 1 to 4, up to round 6.
Each run fights the ghosts of the earlier runs of its bucket (the generated
boss where none exist yet, which is all a party of three or four survives
against for five rounds). Four snapshots are kept per bucket (party size,
round), filled from round 6 down, seeds before strategies. No run supplies the
buckets of two rounds of one party size: a ghost's run stays excluded for the
rest of a player's run, so a fresh player always has a bundled candidate left
in each of rounds 1 to 6.
Owner ids are `bundled-<strategy>` and labels `Bundled <strategy> bot`. The
output is deterministic, every snapshot is checked with `validateGhostSnapshot`
and the selection-time shape and size bounds before it is written, and a test
fails when the committed file differs from a new run (a sim or content change
needs `pnpm ghosts:update` and a commit).

In the web app the file is a second, read-only source behind the same store
interface (`layerGhostStores`). It loads on the first read of the pool (the
shop before a PvP battle), as its own chunk. A file that is missing, invalid
or made for another game version (`major.minor`) is ignored: the pool is then
the local one. `save` and "Clear saved opponents" act on the local pool only, and
the per-owner cap and eviction never see a bundled row.

Candidate order. A listing is the union of the local rows and the bundled rows
of the bucket, one row per `(owner id, run id)` (a local row wins), in the
canonical order `(owner id, run id)`, cut at 64 rows. It depends only on the
contents of the two sources. The selection puts the eligible rows in the order
of `hashJson([runId, round, key])` and logs only the draw, so reload and replay
never read the pool: the logged opponent is replayed as it was.

### Fallback

With no eligible valid snapshot, `pvpOpponent` is `{ round, kind: 'boss',
label: 'the boss', ghost: null, boss: <archetype id> }` and the battle
generates the boss threat of that archetype for the round. `boss` is optional
in the saved format (like `startedAt`, no format number changed): a
`pvpOpponent` or round-record opponent without it is valid and means the old
behaviour, the archetype drawn at battle time. That draw (also used when the
rules have no threats file for the shop's choice, e.g. headless bot runs) is
`pickBoss` with the same round, party size and previous boss as the shop's
draw, on the battle stream's child `archetype` (one `nextInt`), so it obeys
`fromRound`, `minPartySize` and the no-back-to-back rule too. Validation requires a string,
a boss-only archetype when the content is known, and rejects `boss` on a ghost
opponent. The run's round record shows the opponent as `ghost` (label: the
owner's label) or `boss` (with the archetype ID in `boss`). The ghost snapshot
does not contain it.

## Appendix: the per-player design (issue #124)

This appendix records the per-player design decided in issue #124 and where
each of its rules (PP-1 to PP-18) now lives; other sections cite the rules by
number. It was the first section of this document while the design was being
built. The specs (Draft v5.0) describe
a design decided in issue #124: every player
has their own **plot** and their own **Core**, builds only what they own and
only in their own plot, and can link to a neighbour with conduits across the
plot border; a side loses a battle when **all** of its Cores are destroyed;
collectors have a flow rate by tier and every consumer has a top speed.

All of it is implemented; the Status table below names, for each rule,
the issue that implemented it. The rules themselves are written in the
sections they change, and the golden vectors pin them. The rule texts below
were written against the rules before issue #124 (one shared board, one Core
per side): where they say "today" or "today's", they mean those earlier rules,
not the current code.

Terms. A **plot** is one player's own area of the board (see "Coordinates":
plot `p` is the columns `p * plotWidth` to `(p + 1) * plotWidth - 1`, and
`plotOf(x) = floor(x / plotWidth)`). **Player `p`** (0-based) owns plot `p`.
`N` is the party size. A **collector** is a building of kind `source`. A
**consumer** is a unit producer, a turret or an economy building. A
**production** is one unit spawned, one turret shot, or one ramp step.

### Status of every rule

| Rule | What it specifies | Status |
| ---- | ----------------- | ------ |
| PP-1 | Ownership and plot checks on every board operation; conduits have an owner | **implemented** (issue #129) |
| PP-2 | One Core per player: team state, positions, `placeCore`, health | **implemented** (issues #128, #132 and #138); `core_not_placed` names the side and the lowest player without a Core |
| PP-3 | Core placement step: each player places their own Core, no vote | **implemented** (issue #131) |
| PP-4 | Border links | **implemented** (issues #135 and #136; "Conduits", "Mid-battle removal", "One battle tick" step 6) |
| PP-5 | Collector flow rate by tier | **implemented** (issue #130; "One tick: `stepFlow`", step 3, and "Collector rate") |
| PP-6 | Minimum time between productions, need, store | **implemented** (issue #130; "One battle tick", step 2 and step 7, "In-battle ramp", "Dry run (CB-43)") |
| PP-7 | Splitting, with back-up | **implemented** ("One tick: `stepFlow`", step 2; vectors against consumers with a top speed since issue #130). An open border half (PP-4) is a connected output that never accepts (issue #135) |
| PP-8 | Economy buildings act for their owner only; lower collector speed-up cap | **implemented** (issue #137) for the per-owner bonus, cap and modifiers ("In-battle ramp"); `maxSourceSpeedPercent` is 25 and `maxUnitStrengthPercent` 100 (issue #145, "Numbers set in the rebalance") |
| PP-9 | Several Cores per side in the arena; Overload per Core; a destroyed Core switches nothing off | **implemented** (issue #132; "The arena", "One battle tick", "Overload", "Side options") |
| PP-10 | End conditions and the tiebreak ladder with several Cores | **implemented** (issue #132; "Battles") |
| PP-11 | A unit's owner and target Core; one movement field per target Core; a unit also attacks any enemy Core within reach, target or not | **implemented** (issue #133; "The arena", "One battle tick", "Goals and movement fields", "Side options", "Resolution order") |
| PP-12 | Enemy-path preview per Core | **implemented** (issue #133; "Enemy-path preview") |
| PP-13 | Turrets engage units in the neutral zone | **implemented** (issue #134; "Turret fire", step 3) |
| PP-14 | PvE strongholds and bosses with one Core per player | **implemented** (issue #138; "PvE threats", "Side options") |
| PP-15 | Sealed-producer check per owner; map rule per plot | map rule **implemented** (issue #129); sealed check per owner **implemented** (issue #131) |
| PP-16 | Party votes and run streams without the Core vote | **implemented** (issue #131) |
| PP-17 | Formats, major version and ghost validation per owner | **implemented** (issues #135, #131, #139 and #160; "Ghosts") |
| PP-18 | No giving: no intent moves gold or a building between players | **implemented** (nothing to remove; guarded by `packages/session/src/rules/no-giving.test.ts`) |

### Numbers set in the rebalance

Issue #145, part 1 (owner decisions 1 to 6). The rules below fix the **shape**
of each computation; these are the shipped numbers. The principle: **a
collector fully feeds exactly one producer of its own tier.** Collectors give
0.50 / 0.71 / 1.00 items per second at tiers 1 / 2 / 3, and the need of a
building at the same tier is the same, so a higher tier needs more per second
and is never cheaper per production. A plot has 3 Ore, 3 Power and 1 Flux
node, so it runs three Barracks-type buildings at full speed and no more; a
player grows by raising tiers, by economy buildings or through a border link.

| Number | Where | Shipped (tier 1 / 2 / 3) | Constraint |
| ------ | ----- | ------------------------ | ---------- |
| Collector `intervalTicks` | `buildings.json` | 20 / 14 / 10 (unchanged) | integer >= 1; a higher tier is never slower |
| Barracks `costPerUnit` / `productionIntervalTicks` | `buildings.json` | 5 / 5 / 5 items per 100 / 70 / 50 ticks (need 0.50 / 0.71 / 1.00 per second) | integers >= 1 |
| Foundry `costs` / `productionIntervalTicks` (issue #380, proposed, to be tuned) | `buildings.json` | `res_a` 6 and `res_b` 6 per unit (5 and 5 before issue #386), every tier, per 120 / 84 / 60 ticks (need 0.50 / 0.71 / 1.00 per resource per second, 50 / 71 / 100 per 1000 ticks: one collector of its tier per input, as before; the intervals follow the costs); price 40 / 85 / 150, health 70 / 105 / 140; makes `unit_heavy` (health 70, damage 14, attack cooldown 10, move cooldown 6, radius 84, collision radius 55, reach 66) | each cost an integer from 1 to `MAX_TIER_COST`; in the shop from round 3 (issue #383) and in the bot's builds |
| Golem forge `bld_golem_forge` and `unit_golem` (issue #382, proposed, to be tuned) | `buildings.json`, `units.json` | `res_ab_refined` 4 per Golem, every tier, per 120 / 84 / 60 ticks; price 45 / 90 / 160, health 70 / 105 / 140; 2x2, Composite on the south side; Golem health 260, damage 6, attack cooldown 14, move cooldown 10 (speed 24), radius 110, collision radius 80 (diameter 160, under one cell), reach 80, melee, armor 3 | `armor` an integer from 0 to `MAX_ARMOR`; a Golem with the largest strength bonus stays within `MAX_HEALTH`; in the shop from round 3 (issue #383) and in the bot's builds |
| Spire `bld_spire` and `unit_caster` (issue #387, proposed, to be tuned) | `buildings.json`, `units.json` | `res_bc_refined` 4 per caster, every tier, per 120 / 84 / 60 ticks; price 50 / 95 / 170, health 70 / 105 / 140; 2x2, Aether on the south side; caster health 32, damage 12, attack cooldown 20, move cooldown 6, radius 66, collision radius 43, reach 720, ranged, splash radius 360 sub-cell units (1.5 cells) and 60 percent (28, 9, 240 and 50 before issue #386) | `splash.radiusSub` 1 to `MAX_SPLASH_RADIUS`, `splash.percent` 1 to 100; in the shop from round 3 (issue #383) and in the bot's builds |
| Lancer hall `bld_lancer_hall` and `unit_lancer` (issue #439, proposed, to be tuned) | `buildings.json`, `units.json` | `res_a` 6 per Lancer, every tier, per 110 / 77 / 55 ticks (need 54 / 77 / 109 per 1000 ticks, against a collector's 50 / 71 / 100); price 25 / 50 / 90, health 60 / 90 / 120; 1x3, Ore on the south side (the box and the side turn with the rotation); Lancer health 35, damage 7, attack cooldown 12, move cooldown 6, radius 70, collision radius 46, reach 300 (1.25 cells), melee | reach at most `MAX_UNIT_REACH`; in the shop from round 2, weight 5 (issue #443) |
| Grand barracks `bld_grand_barracks` and `unitsPerProduction` (issue #440, CB-9f, CB-10f, CB-13a, proposed, to be tuned) | `buildings.json` | `res_a` 4 per soldier and 2 soldiers per production (8 items), every tier, per 80 / 56 / 40 ticks; need 100 / 142 / 200 per 1000 ticks, exactly the output of two collectors of the tier (50 / 71 / 100 each; 2 x 1/20, 2 x 1/14, 2 x 1/10 items per tick = 8 / 80, 8 / 56, 8 / 40), twice a Barracks' soldiers per tick at 80% of its interval and 80% of its cost per unit; price 70 / 140 / 240, health 150 / 225 / 300; 3x3, Ore on the south side (the whole side, any of its three cells; the box and the side turn with the rotation) | `unitsPerProduction` an integer from 1 to `MAX_UNITS_PER_PRODUCTION` (4), absent means 1; the stated exception to SC-13a: two collectors of its tier joined by a Merger fully feed it, one feeds it half the time; in the shop from round 5, weight 3 (issue #443) |
| Refineries `bld_refinery_ab` (Composite from `res_a` + `res_b`) and `bld_refinery_bc` (Aether from `res_b` + `res_c`): `costs` / `productionIntervalTicks` / `outputPerBatch` (issue #381, proposed, to be tuned) | `buildings.json` | 3 of each input per batch of 2 items, every tier, per 60 / 42 / 30 ticks (need 50 / 71 / 100 per input per 1000 ticks, output 33 / 47 / 66 per 1000 ticks); price 35 / 75 / 130, health 60 / 90 / 120; 2x2, the first input south, the second west, the output north | `costs` as for the Foundry, `outputPerBatch` 1 to `MAX_OUTPUT_PER_BATCH`; in the shop from round 3 (issue #383) and in the bot's builds |
| Mortar `bld_mortar` and the turret fields `minRangeCells`, `splashPercent`, `splashRadiusCells` (issue #441, CB-9f, CB-18b, proposed, to be tuned) | `buildings.json` | 2x2, Ore (`res_a`) on the south side; damage 8 / 12 / 16, range 9 / 10 / 11 cells, minimum range 3 cells at every tier, cooldown 30 / 24 / 18 ticks, `costPerShot` 2, splash 60% in 1 cell, price 40 / 80 / 140, health 80 / 120 / 160; need 66 / 83 / 111 per 1000 ticks against a tier collector's 50 / 71 / 100, so one collector of its tier keeps it firing at 75 to 90 percent of its top speed (the rebalance principle SC-13a, measured by the dry run) | `minRangeCells` 1 to `rangeCells` - 1; `splashPercent` 1 to 100 with `splashRadiusCells` 1 to 2; in the shop from round 3, weight 4 (issue #443) |
| Tunnel `bld_tunnel_in` and `bld_tunnel_out` (issue #442, CB-9f, CB-9g, proposed, to be tuned) | `buildings.json` | two 1x1 route buildings, an entrance (input on the south side at rotation 0) and an exit (output on the north side); `maxSpanCells` 5 (cells between the ends, the same at every tier), distance at most 6; price per end 5 / 11 / 20 (the item costs 10 / 22 / 40), health per end 20 / 30 / 40 | `maxSpanCells` an integer from 0 to `MAX_TUNNEL_SPAN_CELLS` (12); the entrance's price is the exit's or one more; in the shop from round 3, weight 5, listed by its entrance (issue #443) |
| Turret `cooldownTicks` / `costPerShot` / `damage` | `buildings.json` | 10 / 7 / 5 ticks, 1 item per shot, damage 5 / 8 / 10 (need 1.00 / 1.42 / 2.00 while firing: two collectors of its tier) | integers >= 1 |
| Overclocker `costPerStep` / `stepIntervalTicks` / `stepPercent` x `maxSteps` | `buildings.json` | 2 / 3 / 4 items per step, a step per 40 / 42 / 40 ticks, 2x5 / 3x5 / 5x5 = +10 / +15 / +25 percent | fits under `maxSourceSpeedPercent` |
| Armory `costPerStep` / `stepIntervalTicks` / `stepPercent` x `maxSteps` | `buildings.json` | 4 / 5 / 6 items per step, a step per 80 / 70 / 60 ticks, 5x5 / 7x5 / 10x5 = +25 / +35 / +50 percent | fits under `maxUnitStrengthPercent` |
| `inputBufferUnits` (items waiting at each input) | `sim.json` | 4 (unchanged) | integer >= 1, small |
| `maxSourceSpeedPercent` (collector speed-up cap) | `sim.json` | 25 | SC-12: a tier 1 collector boosted to 0.62 per second stays below an unboosted tier 2 (0.71), tier 2 boosted to 0.91 below tier 3 (1.00) |
| `minModifierSumPercent` (floor of a modifier percent sum) | `sim.json` | -50 | EC-8: with drawbacks of -90 allowed, a stat never drops below half or reaches 0 |
| `maxUnitStrengthPercent` (Armory cap per player) | `sim.json` | 100 | an Armory costs supply only while it charges, so it has its own limit |
| Core health | `buildings.json` | 500 (decided) | per Core |
| `nodesPerPlot` | `mapgen.json` | 3 common, 1 rare (unchanged) | the same for every plot |
| Gold | `economy.json` | `baseIncomePerShop` 5; `rewards.pveWin` easy / medium / hard 6 / 9 / 13; `pvpWin` 8; `pvpLoss` 4 (14 to 31 gold per round: the base income is paid at both shops of a round, see "Income") | strictly increasing `pveWin` |
| Walls (issue #291) | `buildings.json`, `economy.json` | seven tetromino shapes (I, O, T, S, Z, L, J), 4 cells each, tier 1 / 2 / 3 health 250 / 400 / 600 and price 8 / 18 / 36 (the old single wall: 100 / 160 / 240 and 4 / 9 / 18, now `bld_wall_block`, kept for strongholds and reference boards, not sold); `offerWeights`: every non-wall weight doubled (collector 24, Splitter 12, Merger 12, Crossover 4, Barracks 32, gate 6, turret 16, Overclocker 6, Armory 12, Range 16, Hangar 12), walls O, T, S, Z, L, J 2 each and I 1 (13 of 161 against 8 of 82 before); at most 2 wall shapes per shop; the kit's 3 walls are random shapes, never I | four cells for a price of 8 is 2 per cell (4 per cell before); the shop limit keeps a set of offers from being all walls |
| Shop | `economy.json` | (issue #145; every non-wall weight was doubled by issue #291, see Walls, and five entries from round 3 were added by issue #383, see "Offer roll") `offerWeights`: collector 12 (was 10), Splitter 6, Merger 6, Crossover 2 (was 4), Barracks 16 (was 10), wall 8, gate 3 (was 5), turret 8, Overclocker 3, Armory 6 (was 3; it was not offered before the rebalance), Range 8 (was 5), Hangar 6 (was 3); placeholder unit numbers of Range and Hangar kept by owner decision (issue #59) | unit producers and the Armory are offered more often, routing parts less; with 8 bot runs per strategy this changes no strategy's depth by more than a round (fortify at party 4: 12.5 to 14.8) |
| Mana Well (issue #473, proposed, to be tuned in #477) | `buildings.json`, `economy.json` | `bld_mana_well` 1x1 source with `resourceSetting`: interval 40 / 28 / 20 (half an Extractor's 20 / 14 / 10), price 8 / 20 / 40, health 20 / 30 / 40; in the shop from round 2 for the Flowmancer, weight 12 (half an Extractor's 24) | the stated exception to the rebalance principle: it feeds about half a consumer of its tier; weight and numbers are placeholders until #477 |
| Rune Ward (issue #474, proposed, to be tuned in #477) | `buildings.json`, `economy.json` | `bld_rune_ward` 1x1 defense of type `ward`, Power (`res_b`) on the south side: `reflectDamage` 2 / 3 / 4, `costPerStrike` 1, price 8 / 18 / 36, health 120 / 200 / 300; in the shop from round 2 for the Wardsmith, weight 12 | `reflectDamage` and `costPerStrike` integers >= 1 (`reflectDamage` at most `MAX_DAMAGE`); numbers are placeholders until #477 |
| Familiar Roost and Familiar (issue #475, proposed, to be tuned in #477) | `buildings.json`, `units.json`, `economy.json` | `bld_familiar_roost` 1x2 unit producer of `unit_familiar`, Power (`res_b`) on the south side, 4 per Familiar every 80 / 56 / 40 ticks (need 50 / 71 / 100 per 1000 ticks: exactly one collector of its tier), price 20 / 40 / 70, health 40 / 60 / 80; `unit_familiar` health 20, damage 5, attack cooldown 10, move cooldown 3 (speed 80), radius 60, collision radius 39, reach 60, melee; in the shop from round 2 for the Beastbinder, weight 12 | the rebalance principle holds; the Familiar has the shortest move cooldown of the ground units; numbers are placeholders until #477 |
| Transmuter (issue #476, proposed, to be tuned in #477) | `buildings.json`, `economy.json` | `bld_transmuter` 1x2 refinery with `resourceSetting`, one input of no resource on the south side: `costPerBatch` 2, `outputPerBatch` 1 (2 in, 1 out), `productionIntervalTicks` 60 / 42 / 30, price 25 / 50 / 90, health 40 / 60 / 80; in the shop from round 2 for the Alchemist, weight 12 | the stated exception to the premium of refining: it pays a penalty, so a collector feeding it makes twice what arrives; numbers are placeholders until #477 |
| Signature buildings (issue #472, placeholders until steps 5/9 to 8/9 of #468; the Mana Well is real since #473, the Rune Ward since #474, the Familiar Roost since #475 and the Transmuter since #476, see their rows) | `buildings.json` | `bld_mana_well` 1x1 source, price 8 / 20 / 40, interval 40 / 28 / 20; `bld_rune_ward` (1x1 wall at first, price 8 / 18 / 36, health 120 / 200 / 300; real since #474); `bld_familiar_roost` 1x2 producer of `unit_familiar` (real since #475, see its row), Power 4 per unit, price 20 / 40 / 70; `bld_transmuter` (real since #476, see its row); all four are in `offerWeights` | stand-ins of existing kinds so that the roster, the shop gate and the ghost check can name them; tuned in issue #477 |
| Threat growth | `threats.json` | `growthPercent` 125 (+25 percent per round) | above 100 |
| Stronghold caps | `threats.json` | `maxTurretsPerPlot` 6 (was 16); Fortress `turretSharePercent` 25 (was 40) and `coreHealthPerBudget` 300 (was 500); Boss `turretSharePercent` 20 (was 30) | the rest of a stronghold's budget becomes Core health |
| Escalator wave timing | `threats.json` | `firstTick` 100 and `intervalTicks` 75 (was 150 and 150): the eighth wave comes at tick 625 instead of 1200 | its Core used to fall before its large late waves spawned; a full tier 1 board now beats hard Escalator through round 8 (was 12), against 7 for Rusher |
| `minCoreHealth` (per Core) | `threats.json` | 30 (unchanged; never reached in rounds 1 to 12 at any party size) | |

Not part of this table: Overload timing, shop prices and tier odds, wave sizes
and `baseBudget` (all unchanged). The reference boards are rebuilt (PP-6; see
"Reference boards").

### Numbers set in the tuning

Issue #386 (refining 8/8). Measured with the balance harness
(`pnpm sim stage --chains`, `pnpm sim bot`); every number stays **proposed**
until the owner accepts it after the playtest. The reference boards put one plot
of two tier 1 collectors on the starting-kit board of the stage map (seed 5): a
refining chain, the base buildings on the same collectors, a Foundry, or (for
Aether) an Overclocker on the same Flux. Each is fought against generated PvE
threats (rounds 3 to 12, easy, medium and hard, every non-boss archetype, 5
seeds) and run for 1700 ticks against a passive Core. The premium is the win-rate
gain of the chain over the kit board divided by that of the alternative, and the
same for the Core damage cut (1.30 = 30 percent more).

| Number | Where | Before | Shipped | Why |
| ------ | ----- | ------ | ------- | --- |
| Caster `health` / `damage` | `units.json` | 28 / 9 | 32 / 12 | the Aether chain was worth 0.92 (win) and 1.00 (Core damage) of an Overclocker plus a Hangar on the same collectors; with 12 damage and 32 health it is 1.20 and 1.30 |
| Caster `splash` | `units.json` | radius 240, 50 percent | radius 360 (1.5 cells), 60 percent | casters hit 0.43 other units per cast in PvE (0.46 after; most enemy waves arrive in lines); the wider, stronger splash is the counter to packed groups (a unit 241 to 360 away is now hit), and splash damage per battle rose from 18.6 to 29.9 |
| Foundry `costs` / `productionIntervalTicks` | `buildings.json` | 5 + 5 per heavy, 100 / 70 / 50 | 6 + 6 per heavy, 120 / 84 / 60 | the Foundry was worth 1.17 of a Barracks plus a Hangar; it is 1.01 (win) and 1.06 (Core damage) now, with 11 percent more health and 29 percent more damage per supply item than the pair |
| `unitCost` of the caster | `threats.json` | 8 | 10 | the wave price follows the stronger caster (about 2.5 times the Spire's `costPerUnit`) |
| Golem, Golem forge, refineries, Spire price and interval | `buildings.json`, `units.json` | | unchanged | the Golem chain is worth 1.49 (win) and 1.21 (Core damage) of a Barracks plus a Hangar, the top of the 25 to 35 percent band, at 100 gold of buildings against 70; kept |
| Shop `offerWeights` of the chain pieces, `rerollCost` | `economy.json` | 4 each, 1 | unchanged | with the real offer roll, a player committed from round 3 who never re-rolls holds a whole chain by round 10 in 52 percent of runs (median round 8), one who re-rolls up to 10 gold in all has one by round 6 in 81 percent (6.6 gold on average); heavier weights would make the re-roller's chain a lottery |
| Version | `version.ts` | 1.0.52 | 1.0.53 | rules and content changed (TA-8); no saved format number changes |

Measured (5 seeds, rounds 3 to 12, 1.30 = 30 percent more):

| Pair | Win-rate points over the kit board | x win | Core damage cut per battle | x Core |
| ---- | ---------------------------------- | ----- | -------------------------- | ------ |
| Sparksteel chain / Barracks + Hangar | +32.1 / +21.6 | 1.49 | 121.5 / 100.3 | 1.21 |
| Foundry / Barracks + Hangar | +21.7 / +21.6 | 1.01 | 105.9 / 100.3 | 1.06 |
| Aether chain / Hangar + Overclocker | +18.0 / +15.0 | 1.20 | 80.1 / 61.6 | 1.30 |

Other findings: the first Golem and the first caster appear at tick 123 (a cold
start through the refinery's 60 ticks and the forge's 120), 14 of each in 1700
ticks, so both chains pay long before Overload (tick 1800). The Golem takes
1.7 raw damage for each point it takes after armor in PvE (soldiers and drones
1.0), and lives 340 ticks against 155 for a soldier; its damage dealt
is the one number that stays below the Barracks (a tank, not a bruiser). Against
the Fortress archetype (turret rings) the Golem chain wins 99 percent against 67
for the Barracks pair; armor 3 was kept because lowering it to 2 changed that
by under 3 points. Casters die fast (lifetime 143 ticks), which is the counter
of fast melee units. Bot strategies (12 runs at party 1, 6 at parties 2 and 4)
reach the same mean depths before and after (rush 12.3, fortify 11.8, siege 9.5,
weak 5.0 at party 1), so no strategy changed by more than a round.

### Numbers set in the boss tuning (issue #403)

Measured with the balance harness (`pnpm exec tsx packages/tools/src/sim/boss-report.ts`;
see its header). Boards: the scripted bot's boards (rush, fortify, siege, weak;
bot seeds 1 to 8, stopped after the round fought) at party sizes 1 to 4, each
fought against `arch_boss` and each new boss at the same round with 4 threat
seeds (1280 battles per boss column over rounds 3 to 12). Every number stays
**proposed** until the owner accepts it after the playtest. The bot boards win
less than 5 percent against `arch_boss` from round 9 and almost never from round
12, so rounds above 12 cannot tell the bosses apart (all at 0 to 2 percent).

| Number | Where | Before | Shipped | Why |
| ------ | ----- | ------ | ------- | --- |
| Brood `brood.sharePercent` | `threats.json` | 30 | 15 | a bigger burst share makes the Cores smaller and the fight easier (win rate gap to Boss at rounds 5 to 9: +4, +8, +12, +10, +11 points at 30; -3, +3, +1, +5, +2 at 15); thresholds unchanged |
| Pylons `pylons.sharePercent` | `threats.json` | 25 | 10 | the pylons' share also shrinks the Cores; gap at rounds 7 to 9 +8, +10, +5 at 25, +3, -1, +2 at 10 |
| Warlord `champion.sharePercent` | `threats.json` | 35 | 40 | the champion is paid from the wave and is health-limited in early rounds, so more share is an easier wave; gap at round 9 to 12 +1 to +3 points; fought below its own `fromRound` (`--early`) the Warlord is harder, -13 points at round 4 rising to +4 at round 8 |
| Warlord `champion.healthPercent`, Brood thresholds, pylon count and distances, Bonded (no number), every `fromRound` | `threats.json` | | unchanged | `healthPercent` has no effect before round 9 (the share, not the cap, limits the champion); no measurement tells the bosses apart where it binds |
| Version | `version.ts` | 1.0.53 | 1.0.54 | content changed (TA-8); no saved format number changes |

Win rate of the bot boards against each boss (all party sizes, 4 threat seeds,
32 boards per party size and round, so 128 to 512 battles per cell; points of
difference to Boss in brackets):

| Round | Boss | Brood | Bonded | Pylons | Warlord | Bundled ghosts or peer bot boards |
| ----- | ---- | ----- | ------ | ------ | ------- | ------ |
| 3 | 64 | 64 (-0) | | | | 53 |
| 4 | 60 | 56 (-4) | | | | 49 |
| 5 | 53 | 50 (-3) | 54 (+1) | | | 63 |
| 6 | 41 | 44 (+3) | 44 (+3) | | | 25 |
| 7 | 26 | 28 (+1) | 30 (+4) | 30 (+4) | | 32 |
| 8 | 11 | 16 (+6) | 10 (-1) | 10 (-0) | | 32 |
| 9 | 3 | 6 (+2) | 3 (+0) | 5 (+2) | 4 (+1) | |
| 10 | 4 | 4 (+0) | 6 (+2) | 5 (+1) | 6 (+2) | |
| 11 | 2 | 2 (-0) | 3 (+1) | 2 (+0) | 6 (+3) | |
| 12 | 0 | 0 (+0) | 1 (+0) | 0 (+0) | 2 (+2) | |

Before the tuning (same boards and seeds): Brood +4, +8, +12, +10, +11 at rounds
5 to 9; Pylons +8, +10, +5 at rounds 7 to 9; Warlord +1 to +2 at rounds 9 to 12
(+0 at round 8, -9 to -14 at rounds 4 to 6 with `--early`).
The last column is the bundled ghosts (rounds 3 to 6; party size and round
bucket) and, at rounds 7 and 8 where there are none, the other bot boards of
the same party size and round. Counter builds (target 3) were not shown: bot
fortify and rush boards do not win measurably more against the Brood (58 and 60
percent against Boss 55 and 59) or the Pylons boss (57 and 62 against 55 and 59)
than against Boss.

### PP-1. Ownership and plots

Implemented (issue #129). The rules live in the sections they change, which
are the only statement of them:

- Every placed or stashed building has an `owner`; every board operation
  names its `actor`; only the owner acts on a building; a building's cells
  lie in its owner's plot; a conduit has an `owner`. See "Team state and
  placement", "Operations" and its "Rule order for `placeFromStash` and
  `moveBuilding`" (`unknown_building`, `invalid_owner`, `not_owner`, then the
  placement rules, `outside_own_plot` among them).
- `returnToStash` and `removeFromStash` check `unknown_building`,
  `invalid_owner`, `not_owner`, in that order.
- Conduits: see "`addConduit` rules and their order" (`unknown_building`,
  `not_owner` for an end building that `actor` does not own, an `actor` that
  is no player included, preceded by `invalid_conduit_id` when an explicit
  `id` is given, then the geometry rules, `outside_own_plot` among
  them) and `eraseConduit` (`unknown_conduit`, `invalid_owner`, `not_owner`).
  `detachConduits` is unchanged: every conduit attached to a moved or returned
  building belongs to that building's owner.
- `validateTeamState` checks that every placed building lies in its owner's
  plot, and for every conduit that `owner` is in range, that each end building
  is owned by `owner` and that every path cell is in the owner's plot.
- Resource nodes need no rule of their own: a source must stand on a node and
  inside its owner's plot, so only the plot's player can use a plot's nodes
  (CP-14). With one player, plot 0 is the whole board and none of the
  ownership or plot reasons can occur.
- Golden kind `team-state-ops`: every op that changes the board has `actor`.

Signatures, as in the code: every operation after `addToStash` and `placeCore`
takes its `actor` in the argument object: `placeFromStash(state, content, {
actor, id, x, y, rotation })`, `moveBuilding(state, content, { actor, id, x, y,
rotation })`, `returnToStash(state, content, { actor, id })`,
`removeFromStash(state, { actor, id })`, `addConduit(state, content, { actor,
from, to, cells, id? })`, `eraseConduit(state, { actor, id, reclaimId? })`.

### PP-2. One Core per player

The format, the legal positions, `placeCore(actor, x, y)`, `overlaps_core`,
`buildingAt` and the ASCII picture are **implemented** (issue #128): see "Core
positions" and "Team state and placement", and the Core health (issue #132):

- **Health.** Every Core has the maximum health of the Core definition's
  tier 1 (500), raised by the team's `core_health_percent` modifiers. All
  Cores of a side therefore have the same maximum health (a PvE stronghold
  is the exception, PP-14: its Cores share the stronghold's total health).
- **A battle needs every Core placed**: `core_not_placed` carries the `side`
  and the lowest `player` index without a Core (**implemented**, issues #131
  and #138): a side with any player without a Core is refused, side 0 checked
  first. PvP boards are complete by construction, since a run cannot leave
  `core_placement` until every player has placed (PP-3), and a PvE stronghold
  has one Core per plot (PP-14).

### PP-3. The Core placement step

Before the first build step the run is in the step `core_placement`, which
follows the step `specialist_pick` ("Specialists"). A run created by
`createRun` starts in `specialist_pick`; a state saved before that step existed
starts in `core_placement` and is read as before.

- Player `p` sends `place_core { x, y }`. It is rejected with the reason of
  `validateCorePosition(map, p, x, y)` if that position is not legal;
  otherwise it is stored as `p`'s **pending position**, replacing any earlier
  one. A player can send it again for as long as they are not ready (Ready
  locks it, reason `locked_ready`, like any edit).
- `ready` and `unready` are legal in `core_placement`, with the rules of
  "Ready": a ready player can `unready` for as long as at least one other
  player is not ready, and can then send `place_core` again. So a player can
  change their position until the step ends: freely while not ready, and
  after an `unready` otherwise. With one player, `ready` ends the step at
  once.
- `ready` is rejected with `core_not_placed` while the player has no pending
  position.
- When the last player readies, `placeCore(p, x, y)` is applied for
  `p = 0 .. N - 1` in that order (none can be rejected: positions of
  different players are in different plots and nothing else is on the board),
  and the run enters the first `build` step, where gold and the starting kit
  are granted as today. The step's `pending` (`{ positions: [null, ..., null] }`,
  one entry per player) is set when the step is entered, from `specialist_pick`.
- There is no vote and no random draw in this step.

### PP-4. Border links

**Border spots.** Border `b` (an integer from 0 to `N - 2`) is the line
between plot `b` and plot `b + 1`: between the columns `xL = (b + 1) *
plotWidth - 1` and `xR = xL + 1`. A **border spot** is `(b, y)` with `0 <= y <
height`. A spot is not a cell. The **border cell** of a spot for player `b` is
`(xL, y)` and for player `b + 1` it is `(xR, y)`. With `N = 1` there are no
borders.

**Halves.** A **half** is a conduit one of whose ends is a border spot
`{ border: b, y }` in place of `{ building, side }`:

- a **sending half** has `from: { building, side }` (an output side) and
  `to: { border, y }`;
- a **receiving half** has `from: { border, y }` and `to: { building, side }`
  (an input side).

Its `owner` must be `b` or `b + 1`. `cells` is ordered from the `from` end to
the `to` end, as for every conduit: a sending half's path starts at a cell
outside its building side and **ends on the owner's border cell** of the
spot; a receiving half's path **starts on the owner's border cell** and ends
at a cell outside its building side. The path rules are otherwise those of
"Sides, edges and directions". `cells` is empty in exactly one case, a
**direct half**: an edge of the named side of the building lies on border `b`
in row `y` (the building has a footprint cell on the owner's border cell and
the side faces the neighbour: `east` for owner `b`, `west` for owner
`b + 1`). In that case a non-empty `cells` is `invalid_path`, and in every
other case an empty `cells` is `invalid_path`.

**Adding a half.** `addConduit` with a border end checks, in this order:

1. `unknown_building` (the building end);
2. `not_owner` (the building is not the actor's);
3. `invalid_border`: `b` is not an integer from 0 to `N - 2`, `y` is not an
   integer from 0 to `height - 1`, or `actor` is neither `b` nor `b + 1`;
4. `not_an_output` (sending half) or `not_an_input` (receiving half) for the
   building side;
5. `side_in_use` (the building side already holds a conduit or a half); then
   `border_spot_in_use`: the actor already has a half at spot `(b, y)`;
6. `invalid_path`;
7. `outside_own_plot`;
8. `blocked_by_feature`;
9. `overlaps_core`;
10. `overlaps_building`;
11. `crosses_conduit`;
12. `resource_mismatch`;
13. `would_loop`.

**Joining is derived, never stored.** For a spot `(b, y)`: if player `b` has a
half there and player `b + 1` has a half there, and one of the two is a
sending half and the other a receiving half, the two halves form a **link**.
In every other case (one half only, or two halves of the same kind) each half
at the spot is **open**. Because the join is computed from the halves each
time, erasing, moving or undoing never leaves a stale link.

A link can also be **broken**. The links are taken in a fixed order: border
ascending, then row ascending. A link is **joined** unless joining it, on top
of every ordinary conduit and the links already joined, would give a
`resource_mismatch` or a `would_loop` anywhere. Then it is broken. A broken
link behaves exactly as two open halves: it carries nothing, loses nothing, and
the sending side backs up. Nothing is stored, so a broken link is joined again
as soon as the cause is removed. When two links lie on one loop, the later one
in the order is the broken one. The flow graph lists each broken link as
`brokenLinks`, in that order: `{ border, y, sending, receiving, reason,
detail }`, with the two half ids, the reason (`resource_mismatch` or
`would_loop`) and the `detail` the edit-time check would name (none for a
loop). Everything that uses joins (the simulation, resource typing,
`conduitResource`, "Accepting", battle setup, ghosts, bots) uses the joined
links only, so a broken link is open everywhere.
Mending one link can break a later one in the fixed order: when an erase
removes the cause of an earlier link, that link joins again and a later link
that now clashes with it becomes the broken one. In a battle the joins are
derived again whenever a building is destroyed, so a broken link can mend (or
break) in the middle of the battle.

**A link is one conduit.** In the flow graph a link is one edge:

- `conduitId` is the sending half's `id`; a new field `linkedConduit` is the
  receiving half's `id` (`null` on the edge of an ordinary conduit);
- `from` and `fromSide` are the sending half's building end, `to` and
  `toSide` the receiving half's;
- `length` is the number of cells of the sending half plus the number of
  cells of the receiving half; the slots are numbered along the sending half
  first, then the receiving half, so slot 0 is nearest the sending building;
- `resource` is determined as for a conduit leaving the sending building.

The flow simulation, resource typing, the loop check, back-up and
"Accepting" treat the edge exactly as a conduit of that length. A link of two
direct halves has length 0 and is a direct connection across the border.

**An open half carries nothing and loses nothing.** It has no edge and no
slots, and it never holds an item.

- An open **sending** half is a **connected output that never accepts**. In
  the flow graph the output entry of its building side is `{ side, conduit:
  <the half's id>, open: true }` (`open` is `false` or absent on every other
  output). A push onto it (steps 2 and 3 of "One tick: `stepFlow`") is
  always refused, exactly as a push onto a conduit whose first slot is full.
  So a splitter treats it like any backed-up path: the item goes to the next
  output in rotation that accepts, and if none accepts the item is held, the
  line backs up and the collector stalls. A source whose output is an open
  half stalls. **For the dead-end rule ("if no output has a conduit, the item
  is lost") an open half counts as a conduit**: nothing sent towards an
  unjoined half is ever lost.
- An open **receiving** half delivers nothing: the input entry of its
  building side has `conduit: null`.
- A building counts as having a conduit attached (and so is a flow node) when
  it has a conduit or a half of either kind.

For `side_in_use` (an edit-time rule) the side is occupied. `conduitResource`
of a receiving half is that of its link's sending half, and `null` while it
is open.

**Checks cover the whole board.** `resource_mismatch` and `would_loop` are
evaluated on the network of joined links. Adding a conduit or a half is
therefore rejected when it would cause a mismatch or a loop anywhere,
including in the neighbour's plot (for example: a new conduit in plot 0 sends
a second resource, through a link, into a merger in plot 1), or when it would
break a link that is joined now. Broken links count as open. The reason is
the same and `detail` names the building where the problem appears. An
accepted add never changes which existing links are joined, because adding an
edge can only add violations. No other operation adds an edge, so no other
operation needs the check.

**The restoring add.** `addConduit` takes the option `restore`. With it, the
refusal for `resource_mismatch` and `would_loop` is skipped when the network
after the derivation has no mismatch and no loop, that is, when the conflict is
absorbed by one or more links becoming broken. A conflict that remains with
every link broken (inside one plot) is refused as before. All other rules and
their order are unchanged. Only undo and redo use it. The `add_conduit` intent
carries it as an optional boolean (`restore`). Any client may send it: the
resulting state is always valid.

**Removing.** `eraseConduit` removes one half (owner only, PP-1);
`detachConduits` removes the halves attached to a moved or returned building.
The other player's half is untouched and becomes open. A player who is left
alone (the other has disconnected, CP-21i) can erase their own half; nothing
of the absent player's can be changed. The session intents `add_conduit` and
`erase_conduit` take border ends (`{ border, y }`) and name the acting player;
a refusal reports its reason to the player who sent it. Undo and redo are per
player and layout only (RS-5g): undoing the removal of a half adds it again
with the restoring add. A conflict with a link is therefore never a reason to
refuse an undo: the link is broken instead. An undo is refused only for a
conflict inside one plot, with the same reason, and then the player's history
is left as it was (the web client checks the whole inverse first, so a refusal
changes nothing). Undo restores
the previous team state exactly, including conduit IDs and the counters
(`nextId`, `nextConduitId`). Every player has their own conduit ID space (see
Conduits, "Conduit IDs"), so what a teammate does in between never takes an ID
an undo needs: an undo is never refused over IDs.

**Validation.** `validateTeamState` checks every half with the rules above,
at most one half per player per spot, and no mismatch or loop on the network
after the derivation. Broken links are allowed.

**In battle.** `BoardSim.conduits` has one entry per flow edge, so one per
link, under the sending half's id. When the building at either end of a link
is destroyed, both halves are removed (`conduitsLostWith`), each recorded as
`conduit_destroyed` (in conduit-ID order), and the items in the link are lost
as for any conduit.
An open half attached to a destroyed building is removed with one event. A
destroyed Core removes nothing (PP-9).

**Direction and distance.** A link carries from its sending half to its
receiving half; which neighbour sends is free, and two neighbours may have
links both ways at different spots. A half cannot reach a border that is not
its owner's, so links join neighbouring plots only. To pass resources on to
a third plot, the player in between needs a route building of their own
between a receiving half and a sending half.

Vectors: `arena-sim.border-link-sender-destroyed`,
`arena-sim.border-link-receiver-destroyed` (a link cut by destroying the
sending or the receiving building) and `arena-sim.border-core-fallen-link-carries`
(the link keeps carrying after its owner's Core fell).

Golden kinds: `team-state-ops` accepts border ends in `addConduit`;
`flow-sim` gains `flow-sim.splitter-only-open-halves` (a collector feeding a
splitter whose only connected outputs are open sending halves: the splitter
holds its item, the collector stalls, `lost` stays 0 everywhere) and
`flow-sim.splitter-open-half-and-consumer` (one open half and one consumer:
the consumer gets every item);
`flow-graph` gains vectors with a link, an open half, a link of two direct
halves, and a mismatch and a loop that only appear across a link.

### PP-5. Collector flow rate

Implemented (issue #130). The rule is in "Tick order": "One tick:
`stepFlow`", step 3 and "Collector rate".

### PP-6. Minimum time between productions, need and store

Implemented (issue #130). The rules are in "Content bounds" (the fields),
"The arena" (state), "One battle tick" (step 2, step 7 and "Top speed, need
and store"), "In-battle ramp (economy buildings)" and "Dry run (CB-43)".

### PP-7. Splitting, with back-up

Implemented. The rule is in "Tick order": "One tick: `stepFlow`", step 2,
and "Splitting with back-up". The vectors of issue #130 pin it against
consumers with a top speed (golden kind `flow-sim`, mode `"need"`).

### PP-8. Economy buildings act for their owner

Implemented (issue #137; the rules are in "In-battle ramp"). Decided (owner
decision 19 on issue #124, CB-24a): economy buildings help only their owner,
and border links are the only way to help a partner (CP-29):

- The raw total and the capped **bonus are computed per side, per owner and
  per effect**: the sum over that owner's living economy buildings with that
  effect, capped by `maxSourceSpeedPercent` or `maxUnitStrengthPercent`.
- `source_speed` of owner `p` applies to the sources owned by `p`: `stepFlow`
  takes one source interval modifier per player index, not one per board.
  The same goes for a specialist's family bonus (issue #471): it applies to
  the things of the player who picked it only.
- `unit_strength` of owner `p` applies to units spawned by `p`'s unit
  producers. The side option `unitStrengthPercent` and the team's
  `unit_strength_percent` modifiers stay side-wide. The modifiers come only
  from run modifiers (`TeamState.modifiers`), never from an economy building,
  so decision 19 does not touch them. A scheduled-wave unit has no producer
  and no owner, so it gets no ramp bonus (only the side-wide parts).
- `maxSourceSpeedPercent` is 25 (see "Numbers set in the rebalance"); the
  lowering was not part of issue #137.

### PP-9. Several Cores per side in the arena

- **Arena.** Each side has `N` Cores, indexed by player. A Core covers its
  footprint cells (side 1's through the usual 180-degree transform).
- **State.** The `health` list has, per side, first the Cores in player
  order as `{side, core: p, hp}`, then the placed buildings by instance ID as
  `{side, building, hp}` (today's `building = 0` entry for the Core goes).
  Each Core starts at its maximum health (PP-2, or the side option below).
- **Damage.** A Core takes unit attacks like today. `buildingDamageDealt`
  credits `min(A, h)` per Core and tick, as for any building.
- **Overload decay** (step 4). On an Overload beat **every living Core**
  takes `level * overloadCoreDamageStep`, in the order side 0 then side 1 and
  ascending player index within a side, each recorded as
  `overload_core_damage {side, core, damage}`. The amount is the full amount
  for each Core; it is not divided between a side's Cores. A destroyed Core
  takes nothing and records nothing.
- **Destruction** (step 6). Buildings with health 0 are destroyed in the
  order of the `health` list (side, then Cores by player index, then
  buildings by instance ID). A Core is recorded as `core_destroyed {side,
  core}` and its cells become open ground.
- **A destroyed Core switches nothing off** (CB-17a). Nothing else changes:
  the owner's buildings stay in the team state, the producer, turret and ramp
  lists and the flow plan; their sources keep producing; their conduits and
  links stay; their units stay. A Core is never a conduit end, so no conduit
  is removed. Movement fields are dropped as after any destruction, and
  units whose target it was choose a new one (PP-11).
- **Unit attack targets** in events become `{kind: "core", side, core}`.
- **Side option.** `coreHealth` is replaced by `coreHealths`, a list of `N`
  integers from 1 to `MAX_HEALTH`, the starting and maximum health of each
  Core by player index (before `core_health_percent`).
- **Overload helpers.** `overloadDeadline(simConfig, coreMaxHealth)` is
  unchanged and is asked per Core. `overloadOutcome(simConfig, coresA,
  coresB)` takes two lists of maximum health. A side's **last-Core tick** is
  the largest `decayDestroysTick` of its Cores, or `null` if the decay does
  not destroy one of them within the battle. It returns `{first, tick}`:
  `first` is `'a'` or `'b'` for the side whose last-Core tick is smaller,
  `'both'` when the two are equal, with that tick; a side whose last-Core
  tick is `null` never comes first, and `first` is `null` when neither side
  loses its last Core to the decay. With every Core at 500 both sides have the
  last-Core tick 3100 at every party size, so a battle still ends at
  `endTick` 3101 at the latest.
- **Implemented** (issue #132). A unit's goal and target Core are those of
  PP-11 (issue #133).
- Golden kind `arena-sim`: `buildingHealth` entries may be `{side, core,
  hp}`; the per-side summary's `coreHealth` becomes the list of Core health
  by player.

### PP-10. End conditions and the tiebreak ladder

Checked at the end of each tick, after `stepArena`. Let `standing[s]` be the
number of living Cores of side `s`.

1. **One side has no Core left**: `standing[s] = 0` and `standing[1 - s] >
   0`. Side `1 - s` wins, `reason: "core_destroyed"`.
2. **Both sides lost their last Core in this tick**: `standing[0] =
   standing[1] = 0`. The ladder decides, starting at rung 3 (rungs 1 and 2
   are equal by definition).
3. **Time limit**: `maxBattleTicks` ticks have been simulated and both sides
   have a living Core. The ladder decides, starting at rung 1.

Otherwise the battle continues. Losing some but not all Cores ends nothing.

**The ladder.** The first rung on which the sides differ decides.

| Rung | The winner has | `reason` |
| ---- | -------------- | -------- |
| 1 | more Cores standing (`standing`) | `time_limit` |
| 2 | the larger share of total Core health: `sumHp[s] / sumMax[s]`, where `sumHp` adds the current health of all of the side's Cores (0 for a destroyed one) and `sumMax` their maximum health; compared exactly with `compareFractions` | `time_limit` |
| 3 | less **overkill** (below) | `tiebreak_overkill` |
| 4 | more building damage dealt (`buildingDamageDealt`, Cores included) | `tiebreak_building_damage` |
| 5 | more units killed (`unitsKilled`) | `tiebreak_kills` |
| 6 | the attacker: side 0 wins | `tiebreak_attacker` |

- **Overkill with several Cores.** For a Core destroyed in tick `t`,
  `remaining` is its health after all of that tick's damage, unclamped
  ("Core health and overkill", unchanged per Core), and its overkill is
  `-remaining` (0 or more). A side's overkill for rung 3 is the sum of the
  overkill of **its Cores that were destroyed in the final tick** of the
  battle; Cores that fell earlier add nothing. The sum is formed with
  `addSaturating(sum, o, 2^52)`, in player order (each term is below `2^52`;
  with up to four terms the exact sum can pass the safe range, and two sides
  that both saturate are equal on this rung; the cap is `2^52` and not
  `2^53 - 1` because `addSaturating` needs `o <= 2^53 - 1 - cap`). At the time limit no
  Core need have fallen in the final tick; a side with none has overkill 0.
- **The attacker is unchanged**: side 0 is always the party and side 1 the
  ghost or the PvE threat, so the defender wins no tie.
- `sumHp` and `sumMax` are at most `maxPartySize * MAX_HEALTH = 4e12` and
  are added with `addInt`.
- Rungs 1 and 2 can only differ at the time limit, which is reached only if
  a Core on each side survives the Overload decay to `maxBattleTicks` (a Core
  of more than 26,265 health with the standard constants, or Overload
  disabled in a test).

**Result and summary.** The result stays `{winner, reason, endTick}`. Per
side the summary's `coreHealth`, `coreMaxHealth` and `coreOverkill` become
`cores`, a list of the placed Cores by player of `{player, health, maxHealth, overkill, destroyedTick}`
(`health` clamped at 0; `overkill` and `destroyedTick` are 0 and `null` for a
living Core), plus `coresStanding`, `coreHealth` (`sumHp`), `coreMaxHealth`
(`sumMax`) and `coreOverkill` (the rung-3 sum). The other fields are
unchanged.

**Lives.** A lost PvP battle costs `pvpLossLifeCost` lives once, whatever
`coresStanding` was on either side (RS-5). That is today's rule; it reads the
`winner` only.

### PP-11. A unit's owner and target Core

**Fields.** A unit gains `owner`, a player index of its own side, and
`target`, a player index of the enemy side (the Core it heads for) or `-1`
when the enemy has no Core left. Both are part of the saved state.

**Owner.** A unit spawned by a unit producer has that building's `owner`. A
unit of a scheduled wave has `owner = plotOf(c)`, where `c` is the column, in
its side's own frame, of the front-row cell it enters on (the column actually
used, not the wanted `col`). `spawnUnitForTest` uses the plot of the unit's
cell in its own frame unless an owner is given.

**The opposite plot.** `opposite(p) = N - 1 - p`. Side 1's board is rotated by
180 degrees, so side 1's plot `q` occupies the arena columns of side 0's plot
`N - 1 - q`: the plots face each other one to one (CB-8b), and `opposite` is
the same function for both sides.

**Fields per target.** For each side and each living enemy Core `q` there is
one movement field and one breach field, defined exactly as today's ("Goals
and movement fields") with Core `q` in the place of "the Core": distance 0
for the open cells that share an edge with a cell of Core `q`. They are
computed lazily, cached per (side, `q`) and dropped after every destruction.

**Other Cores (CB-15c, decided: owner decision 18 on issue #124).** A unit
attacks whatever enemy is in range, including an enemy Core that is not its
target; where it walks is unchanged. For a unit, an enemy Core that is not
its target:

- blocks movement and is not a goal: no field leads to it and the unit never
  walks towards it, so it meets one only on its way;
- is attacked by **rule b whenever it is within reach**, exactly where the
  target Core is attacked today: after rule a (an enemy unit in contact) and
  rule a2 (aggro), before the move (rule c). An enemy unit therefore still
  comes first, and a Core in reach comes before walking on. Reach is
  measured as for the target Core, `buildingDist2(px, py, core) <= (reach +
  R)^2`, edge to edge;
- when several enemy Cores are within reach, rule b takes the unit's target
  Core if it is one of them; otherwise the one with the smallest
  `buildingDist2`, ties by the later parts of the target key, `(|q -
  opposite(owner)|, -q)` (the existing order, no new priority);
- does not change the unit's `target`, which changes only when the target
  Core is destroyed (below). A unit that attacks holds its place (step 3),
  so it stands and attacks the Core in reach **until that Core is
  destroyed** (an enemy unit in contact takes precedence meanwhile); it does
  not step on towards its target. That is how it treats its target Core and
  any other building it attacks. After the Core falls, rule b no longer
  fires for it and the unit resumes its walk to its own target Core;
- in the breach field costs `breachBaseCost + ceil(maxHealth /
  breachHealthPerCost)` to enter, as before, so a sealed unit can also
  attack it as a breach building (rule c).

Cores of the unit's own side are impassable, like its own buildings.

**Choosing a target**, `chooseTarget(owner, c)` for a unit of side `s` at
cell `c`:

1. If the enemy Core `opposite(owner)` is alive, that is the target.
2. Otherwise, among the living enemy Cores `q`, the one with the smallest key
   `(class, distance, |q - opposite(owner)|, -q)`, compared left to right:
   - `class` 0 and `distance` the cell's distance in the movement field for
     `q`, if it has one; else `class` 1 and `distance` its distance in the
     breach field for `q`, if it has one; else `class` 2 and `distance` 0;
   - then the Core whose plot index is nearer to `opposite(owner)`;
   - then the **larger** `q`. In the unit's own frame the enemy plot `q`
     lies in the columns of plot `N - 1 - q`, so this is the Core with the
     lower own-frame `x`, the same preference as the tie key of "Goals and
     movement fields".
3. With no living enemy Core the target is `-1` and the unit waits (the
   battle ends at the end of this tick).

Everything in the key is stated in the unit's own side's terms, and
`opposite` is symmetric, so a mirrored battle stays exactly symmetric.

**When it is chosen.**

- **At spawn from a producer** (step 2). If the Core `opposite(owner)` is
  alive it is the target and the spawn cells are ordered by its fields, as
  today. Otherwise, for each living enemy Core `q`, order the producer's
  spawn cells by `q`'s fields as today and take the key `(class, distance)`
  of the first cell; the target is the `q` with the smallest `(class,
  distance, |q - opposite(owner)|, -q)`, and the spawn uses that `q`'s
  ordering. A held unit has no target yet; the choice is made again on the
  tick it spawns.
- **At entry of a wave unit**: `chooseTarget(owner, entry cell)`, after the
  entry position is found.
- **When its target Core is destroyed.** At the end of step 6, after all
  destructions of the tick and after the fields are dropped, every living
  unit whose target Core now has health 0, in unit-`id` order, gets `target
  = chooseTarget(owner, c)` with `c` the cell that holds its centre, and
  `unit_retargeted {unit, target}` is recorded after the destruction events.
- A unit never changes target at any other time: not when another Core
  falls, and not when another Core becomes nearer.

**Uses.** Wherever "One battle tick" and "Goals and movement fields" say "the
enemy Core", "the movement field" or "the breach field", read: the unit's
target Core and its fields. That is: the spawn-cell ordering (step 2), the
goal building of rule b, the headings of rule c (including the press against
the Core at distance 0), and the breach rule. Rule b is the exception: it
reads "any living enemy Core within reach" ("Other Cores" above), not only
the target Core. Rules a and a2 are unchanged:
a unit fights any enemy unit it meets, whoever owns it. Turrets shoot any
enemy unit in range and gates let every unit of their side through, whoever
owns them (`blocksUnit` is by side, unchanged).

**Events.** `unit_spawned` gains `owner` and `target`; `unit_retargeted
{unit, target}` is new.

### PP-12. Enemy-path preview per Core

`previewEnemyPaths` answers, for every `x` whose front-row cell is open for
the enemy, with the path of an enemy unit that enters there and heads for its
target Core: the Core of plot `plotOf(x)` if it is placed, else the placed
Core `chooseTarget` picks from the entry cell (the nearest, with the key of
PP-11, `opposite` being `plotOf(x)`); today's walk, on the fields of that Core.
Each entry gains `core`, that Core's player index. The function does not
throw for a board with some Cores unplaced; with no Core placed it gives no
entry. What a unit does after that Core has fallen is not previewed.

### PP-13. Turrets engage units in the neutral zone

Implemented (issue #134). The rule is in "One battle tick": "Turret fire",
step 3.

### PP-14. PvE strongholds and bosses with one Core per player

A PvE opponent has `N` plots and one Core in each, bosses included, and the
battle runs under the same rules as any other (PP-9 to PP-11).

**Profile.** `stronghold` becomes `{ cores: [{ x, y, health }], buildings }`:
`cores[p]` is the Core of plot `p` (position in the stronghold's board
coordinates, and its health). `coreHealth` and `corePosition` go.

**Generation**, replacing step 7 of `generateThreat` (steps 1 to 6 and 8 are
unchanged; `S` is the stronghold budget):

1. `wallsTotal = min(floor(floor(S * wallSharePercent / 100) / wallPrice),
   maxWallsPerPlot * N)`; `turretsTotal` likewise.
2. **Shares.** `share(total, p) = floor(total / N) + (1 if p < total mod N
   else 0)`. Plot `p` may place up to `share(wallsTotal, p)` walls and
   `share(turretsTotal, p)` turrets.
3. **Layout per plot**, for `p = 0 .. N - 1` in order, with the random stream
   `holdRng.child(p)` (an integer label; nothing is drawn from `holdRng`
   itself): the archetype's layout is computed as today on a board that is
   one plot (`plotWidth` by `plotDepth`), so the Core is at local `x =
   floor((plotWidth - 2) / 2)`, `y = coreRow`; cells outside the plot are
   skipped as cells outside the board are today; then every position is
   moved by `p * plotWidth`. A `line` layout has its one gap per plot as
   today; `ring` and `open` are now one set per plot around that plot's
   Core.
4. `spent` is the price of everything placed, over all plots.
5. **Core health, split evenly.** `total = max(minCoreHealth * N,
   floor((S - spent) * coreHealthPerBudget / 100))`. The even split is
   `share(total, p)`: every Core gets `floor(total / N)` and the Cores of
   plots `0 .. (total mod N) - 1` get 1 more, so the shares differ by at most
   1 and add up to `total` exactly. Then the content bound of step 8 is
   applied per Core: `cores[p].health = min(MAX_HEALTH, share(total, p))`.
   Like the clamps of step 8 this is only a safety net: when it is reached
   the excess health is lost and the Cores no longer add up to `total`. With
   the shipped content it is not reached in rounds 1 to `maxThreatRound`.

`buildStronghold` places every Core with `placeCore(p, x, y)` and every
building with its plot as owner (each lies inside that plot by
construction). The battle passes `coreHealths = [cores[p].health]`.

**Waves** are scheduled and enter as today (`count` is the total for the
whole board, spread over the full width). Each unit's owner and first target
follow PP-11: it enters in a column of some party plot, and its target is
that plot's Core. This is "each wave heads for the Core of the area it
enters".

`threatSummary`: `coreHealth` is the total over the Cores and `cores` is
their number. Golden kinds `threat-gen` and `pve-battle` are re-pinned; with
one player the profile has one Core and differs from today's only in format
and in the random stream used for the layout.

### PP-15. Sealed producers per owner; map rule per plot

- **Map generation** gains one fairness constraint: for every plot, every
  walkable cell of the plot is reachable from a walkable front-row cell of
  **that plot** by 4-way moves through cells of that plot only. (Today's
  constraint, reachability from the front row over the whole board, stays.)
  With it, terrain alone never closes off part of a plot from that plot's
  own front, so a unit producer can be sealed only when its owner's own
  buildings are part of what closes it in. Generated maps change; `map-gen`
  vectors are re-pinned.
- **Ready.** `sealedProducers(team, content)` is unchanged and still reads
  the whole board. `ready` from player `p` is rejected with `sealed_producer`
  only while the list contains a producer **owned by `p`**; `detail` lists
  those ids only. Another player's sealed producer does not block `p`. The
  check never reads a producer's cost, so a two-input producer (CB-5e) is
  listed like any other.

### PP-16. Party votes and run streams

The vote topics are `pve`, `event` and `event_follow_up`. The topic `core` and
its stream `vote:core:...` no longer exist: Core placement draws nothing
(PP-3). The vote rules themselves are unchanged. Because one draw fewer
advances the run generator, every later stream of a multi-player run differs
from today's for the same seed; a solo run draws no vote stream today and is
unaffected by this rule.

PP-17 (formats, version and ghost validation) is described under "Ghosts".

### PP-18. No giving

Players cannot give each other gold or buildings (CP-29). The session has no
intent that moves gold or a building between players, so there is nothing to
remove; the rule is that none is added. A building's `owner` never changes.
The guard test `packages/session/src/rules/no-giving.test.ts` sends every intent a
player can send and checks that no other player's gold, stash or placed
buildings change and no `owner` changes. Board intents aimed at a partner's
buildings are rejected with `not_owner` (CP-28, PP-1, issue #129).

### Numbers set in the event tuning (issue #417)

Measured with the scripted bot over seeds 1 to 40 of each strategy (160 solo
runs of 10 rounds, about 2600 event steps) and, for the pacts and Rich vein, 24
seeds per cell. Version 1.0.55 (content changed, TA-8; no saved format number
changes). Gold equivalent of an event taken: the shop price of the tier gained
(or of the building) minus what was paid; modifiers and nodes are not counted.

| Number | Where | Before | Shipped | Why |
| ------ | ----- | ------ | ------- | --- |
| Workshop `workshopPricePercent` | `events.json` | 80 | 70 | at 80 the net value was 4.6 / 5.8 / 7.0 gold (rounds 2-4 / 5-7 / 8-10), the lowest of the gold events; now 7.5 / 9.6 / 10.8. Not lower: the ghost check "a Workshop raise never adds as much value as it costs" needs 70 or more (Splitter tier 1 to 2: 7 gain, 8 cost) |
| Windfall `gold` | `events.json` | 4 | 8 | now 8.0 at every round, +7% / -17% / -26% against the Workshop |
| Caravan `gold` | `events.json` | 6 | 8 | the gold reward was the weakest item of the draft |
| `mod_pact_fury` | `events.json` | +20 strength, -15 Core | +15 strength, -40 Core | rounds reached over no pact (24 seeds): rush +0.00, fortify +0.33, siege +0.50 (was +1.1, +0.9, +0.7) |
| `mod_pact_bastion` | `events.json` | +30 buildings, -10 strength | +50 buildings, -5 strength | -0.25 to -0.33 rounds for every strategy: the strength drawback bites, building health barely matters |
| `mod_pact_overcharge` | `events.json` | turret +40, turret health -20 | turret +40, turret health -50 | +0.1 to +0.2 rounds; the drawback does not change the result |
| Bot event order | `bot.ts` | Drill first or second for three strategies | Drill after Caravan (and, for fortify, after Workshop and Rich vein); Market day above Blueprint | Drill was taken in 57% of its offers, Market day in 7%, Rich vein in 5% |
| Event weights, `fromRound`s, Drill, Market day, Rich vein, Blueprint params | `events.json` | | unchanged | variety is already 8.8 of the 9 types seen per run |
| Version | `version.ts` | 1.0.54 | 1.0.55 | content changed (TA-8); no saved format number changes |
