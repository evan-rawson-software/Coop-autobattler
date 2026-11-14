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
**Status (#124)** table naming what is still open; nothing marked "not yet
implemented" is behaviour of the current code. The per-player design of
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
- **Map and Set order.** JavaScript iterates a `Map` or `Set` in insertion
  order; a C# `Dictionary` or `HashSet` has no order. Rules code never
  iterates one: it keeps an array alongside, or reads the keys sorted
  (`sortedInts`, `sortedIntEntries`, `sortedKeys`). Object keys are likewise
  only read sorted by code point. A lint rule enforces this in `core`,
  `session/src/rules` and `session/src/bot`.
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
| `MAX_ARENA_CELLS`      | 8 192               | arena cells (`width * height`) for which a breach field is computed       |
| `MAX_TICK_DAMAGE`      | 2^52                | most damage one target takes in one tick (the sum saturates here)         |
| `MAX_HIT`              | 2^51                | most one hit may deal after Overload scaling                              |
| `CELL_UNITS`           | 240                 | sub-cell units per cell (positions, radii, reach)                         |
| `MAX_UNIT_RADIUS`      | 480                 | `radius` and `collisionRadius` of a unit (two cells)                      |
| `MAX_UNIT_REACH`       | 1 920               | `reach` of a unit (eight cells)                                           |
| `MAX_SEPARATION_CAP`   | 480                 | `separationCap` in `sim.json` (`separationPercent` is 0 to 100)           |

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
  or matching `building_health_percent` effects (any other building), as
  `floor(value * (100 + sum) / 100)`. The percent sum is accumulated with
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
  its `unit_strength_percent` modifiers, plus the largest ramp bonus the side
  can reach: `maxUnitStrengthPercent` if it has a `unit_strength` economy
  building, otherwise 0 (each owner is capped alone, so this bound holds for
  every owner). `maxStrengthPercent(unit)` (in `units.ts`) is the
  largest `P` a unit allows: the largest `P` with `floor(health * (100 + P) /
  100) <= MAX_HEALTH` and `floor(damage * (100 + P) / 100) <= MAX_DAMAGE`
  (a unit with 0 damage does not limit on damage).
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
`neutral-zone` and `battle` (see "The neutral zone" and "Battles"), `threat-gen` and
`pve-battle` (see "PvE threats").

`shop-roll` (see "Run random streams" and "Shops and gold"): input `{seed,
before, round, leg, players, rerolls}`. Start at `rootRng(seed)`, draw each
label in `before` in order, then draw `shop:r<round>:<leg>`. For each player
`i`, roll the offers from that stream's child `p<i>`, then re-roll `rerolls`
times from the same child. The result lists each player's rolls (offers as
`slot def tier price`) and final stream state, and the run generator state
after the shop draw. `run-replay`: input `{seed, players, actions}`, where
`actions` is a list of `{player, intent}`. The run is created with the given
seed and player names and the actions are applied in order, with a battle
resolver that always wins. The result is the final step, round, action count,
gold, shop offers, run generator state and the hash of the whole run state
(`hashJson`), or `{ok: false, reason, at}` if an action is rejected. Both kinds
need `@game/session`, which the `golden` package may depend on (it is test-only).

In the reference implementation the registry is `goldenKinds` in
`packages/golden/src/kinds.ts`; a new kind is one added entry. Each kind is an
adapter in `packages/golden/src/kinds/` (one file per kind, `run-kinds.ts` for
the two session kinds) that reads the vector input, calls the rules in `core`
or `session`, and builds the result. The registry hands the adapters the
content from `@game/content`; a port needs its own way to hand content to
them.
`pnpm test`
runs all vectors and never rewrites them. `pnpm golden:update` regenerates the
`expected` parts and must be run deliberately; review the diff of `golden/`
like any other change.

## Map generation

**Status (#124).** This section describes the code on `main`. The rules
below are specified in "Appendix: the per-player design (issue #124)" and change this
section when their issue lands; none of them is in the code yet unless the
row says so.

| Rule | Change to this section | Status |
| ---- | ---------------------- | ------ |

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
`nodesPerPlot.rare`; `lakes` (`feature`, `countMin`, `countMax`, `sizeMin`,
`sizeMax`); `cliffs` (`feature`, `countMin`, `countMax`, `lengthMin`,
`lengthMax`); `minBuildablePercent`; `backMargin`, `frontMargin` (at least 1),
`sideMargin` (at least 1); `coreFrontClearance`; `placementTries`;
`maxAttempts`. Starting values: 24, 16, 4; 3 and 1; lakes 1 to 2 of 6 to 14
cells; cliffs 1 to 2 of 4 to 8 cells; 80; 2, 1, 1; 8; 30; 64.

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
{ map, cores, buildings, stash, nextId, nextConduitId, conduits, modifiers? }
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
- `buildings`: placed buildings `{ id, def, tier, x, y, rotation, owner }`.
  `id` is a unique positive integer instance ID, `def` a building definition
  ID, `tier` 1 to 3, `rotation` 0, 90, 180 or 270, `owner` a 0-based player
  index below `map.partySize`. `(x, y)` is the lowest-x, lowest-y cell of the
  footprint **after rotation**.
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
  (`w` along x, `h` along y). At 90 and 270 it is `(h, w)`. A building at
  `(x, y)` covers every cell `(x + i, y + j)` with `0 <= i < w'` and
  `0 <= j < h'` (the rotated size). The rotated box is always anchored at its
  lowest-x, lowest-y cell; rotating in place keeps `(x, y)` and so can change
  which cells are covered. All footprints are full rectangles, so there is no
  finer mapping of "which cell is which".
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
- `placeFromStash({ actor, id, x, y, rotation })`: `id` must be in `stash`. Moves
  the entry to `buildings` (same ID, tier, owner).
- `moveBuilding({ actor, id, x, y, rotation })`: `id` must be in `buildings`. Sets
  position and rotation in one step; moving to the same position with a new
  rotation is a rotate in place. The building's own current cells never count
  as overlap.
- `returnToStash({ actor, id })`: `id` must be in `buildings`; the entry goes back
  to `stash` (sorted by ID). Rejects with `unknown_building`, `invalid_owner`
  or `not_owner`.
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
10. Node rules:
   - `source_needs_node`: a building of kind `source` must have every
     footprint cell on a resource node, all of the same resource (a
     placeholder source is 1x1). It produces that resource.
   - `node_reserved`: a building that is not a source may not cover any node
     cell. A resource node cell is otherwise buildable, so this keeps nodes
     for sources.

A rejected operation changes nothing. Placement does not require the Core to
be placed first. A building goes only in its owner's plot (PP-1).

### Conduits attached to a moved building

Moving, rotating or returning a building **removes every conduit attached to
it** (every conduit whose `from.building` or `to.building` is that building),
and no others. `detachConduits(state, buildingId)` in `team-state.ts` does it
(it returns the same state object when nothing is attached); `moveBuilding` and
`returnToStash` call it after the building has been updated, and only when the
operation is accepted. A rejected operation detaches nothing. No other
operation removes conduits, apart from `eraseConduit`.

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
Conduits). It does not check that the map is one the generator could produce.

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
`placeCore` (`actor`, `x`, `y`), `placeFromStash` and `moveBuilding` (`actor`,
`id`, `x`, `y`, `rotation`), `returnToStash` and `removeFromStash` (`actor`,
`id`), `addConduit` (`actor`, `from` and `to`, each `{ building, side }`, and
`cells`, a list of `{ x, y }`) and `eraseConduit` (`actor`, `id`). A rejected op leaves
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

- A conduit leaving a **source** carries the source's node resource
  (`sourceResource`).
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
Consumers are all buildings with inputs except route buildings.

Because sources take their resource from their node, moving a source to a
different node could change types; this is fine because moving detaches the
source's conduits first.

### Loops (CB-9c)

Conduit networks cannot loop. The graph used has one node per placed building
and one per **channel** of a crossover (a channel is an input side with the
opposite output side), and an edge `from -> to` per conduit. `addConduit` is
rejected with `would_loop` if that directed graph would contain a cycle
(including a building feeding itself). Two unrelated flows crossing through a
crossover are two nodes and not a loop; a flow that reaches the same crossover
channel twice is. The check is a topological sort (Kahn).

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
  - `kind`: `source`, `splitter`, `merger`, `crossover` or `consumer`.
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
- `edges`: one per conduit, sorted by conduit ID:
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
`golden/team-state-ops.json`.

## Tick order

**Status (#124).** This section describes the code on `main`. The rules
below are specified in "Appendix: the per-player design (issue #124)" and change this
section when their issue lands; none of them is in the code yet unless the
row says so.

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
dry run.

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
  entries, each a resource ID or `null` (all `null` at the start).
- `routes`: one per flow-graph route node (splitter, merger, or one crossover
  channel), in flow-node order (building ID, then channel): `key` (the node
  key), `building`, `held` (the one-item holding cell, `null` when empty),
  `pointer` (starts 0) and the counter `lost`.
- `consumers`: one per placed building that has input sides and is not a source
  or route, by building ID: `building` and `inputs`, one per input side
  clockwise from north: `side`, `resource` (what that side requires), `count`
  (the input buffer, starts 0) and the counters `delivered` and `consumed`.

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
  (it produces this tick if it can place the item).

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
- _Merger or crossover channel._ One output. If it has no conduit the item is
  lost; otherwise try to push, and keep the item if it is refused.

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

**Consumers.** With `consumers: "drain"` (tests and dry runs), after step 3
every consumer input's `count` is added to its `consumed` counter and set to 0.
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
(tier 1 at 20 ticks: 0.50 per second, shown rounded down).

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

### Consumer seam

`takeFromBuffer(sim, buildingId, sideOrResource, n)` returns whether `n` units
were available and, if so, removes them (adding `n` to `consumed`); if not it
removes nothing. `sideOrResource` is an absolute side (`north` ...) or a
resource ID; for a resource it draws from the inputs that take that resource,
clockwise from north, and the sum must cover `n`. An unknown building or side
gives `false`. What a consumer does with the units (spawning, firing, upgrades)
belongs to later issues, which call this function between ticks, before the
next `stepFlow`.

### Events

`{tick, type, ...}` with `type` one of `produced` (`building`, `resource`),
`delivered` (`building`, `side`, `resource`), `lost` (`building`, `resource`)
and `stalled` (`building`); `schemas/sim-event.schema.json`. Movement along
conduits is not logged (playback animates it from conduit contents). Events
within a tick appear in the order the steps produce them.

### Conservation

At the end of every tick: items produced = items in conduit slots + items in
route holding cells + items in consumer buffers + items consumed + items lost
(`flowTotals`). A source's waiting (stalled) item is not yet counted as
produced.

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
productions}` per consumer. The event log of the run is the vector's event log (`eventLogHash`).
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
Without the cooldown rule of the production step the two `top-speed` vectors
change.

### Mid-battle removal

`rebuildFlow(sim, newState, content, simConfig)` (`flow-sim.ts`) supports the
destruction of buildings (CB-9a). `newState` is the team state with the
destroyed building, every conduit attached to it, and the other half of every
border link that lost a half (PP-4) removed. The flow plan is
recompiled from `newState`; everything that survives keeps its state (sources
by building ID; conduits by conduit ID; routes by node key; consumers by
building ID and input side; `tick` is kept). What is removed is accounted so
that conservation still holds:

- Items in removed conduit slots, a removed route's holding cell, and a removed
  consumer's input buffers are **lost**.
- The counters of removed parts move to `retired`: a removed source's
  `produced` and `lost`; a removed route's `lost`; a removed consumer's
  `consumed`; plus the lost items above. `BoardSim.retired`
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

A unit is `{id, side, def, px, py, hp, damage, attackCooldown, owner, target}`.
`owner` is a player index of the unit's own side and `target` the player index
of the enemy Core it heads for, or `-1` when none stands (PP-11, "Goals and
movement fields"). `(px, py)` is
the **centre of the unit's circle** in arena **sub-cell units** (see "Unit
geometry"). `id` is a positive integer taken from one counter shared by both
sides, in spawn order (the counter starts at 1, is never reused); the unit list
is kept sorted by `id`. `hp` starts at the unit definition's `health`.
`attackCooldown` counts down in ticks. **Units are circles that may overlap
each other a little for a while but never solid ground** (soft collision,
issue #82): see "Unit geometry" and step 5 of the tick. There is no
`moveCooldown`: movement is continuous, at the unit's `speed`.

A unit also stores `damage`, its attack damage **fixed at spawn**. All reads
of a unit's stats (health, damage, range, cooldowns) go through one function,
`unitStats(side, def, strengthPercent)`. With `strengthPercent = P` above 0 it
returns the definition with `health = mulPct(health, 100 + P)` and
`damage = mulPct(damage, 100 + P)` (rounded down); everything else is
unchanged. A scaled `health` above `MAX_HEALTH` or `damage` above `MAX_DAMAGE`
is an error (`RangeError`), see "Content bounds". A spawn passes the side's
current `unit_strength` bonus (see "In-battle ramp"; plus the side's
`unitStrengthPercent` option, see "Side options"), and the unit starts with
`hp = health` and `damage` of the result; units already on the field are never
changed afterwards.

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
- `ramps`: `{side, building, charge, steps, cooldown}` for each living economy
  building (in-battle ramp), by side then building ID, all starting at
  `charge = 0`, `steps = 0`, `cooldown = 0` (CB-11);
- `units`; `entering`: the scheduled-wave units that have not found room yet,
  `{side, unit, col}` in queue order (see "Side options"); and counters `spawned`, `unitsDied` and `buildingDamageDealt`, each a
  pair indexed by side (`buildingDamageDealt[s]` is the damage the units of side
  `s` have applied to the enemy's buildings, see step 4 and "Tiebreak
  counters");
- `sideOptions`: present **only** when a side was given options (PvE battles, see
  "Side options"); a ghost battle's state has no such field, so its hash is
  unchanged.

Everything else (the grid, the compiled wiring, cached fields) is derived from
this state by `createArenaContext(sim, content, simConfig, {events?})`, so a
state can be saved, restored and continued; a restored battle continues
exactly like the original.

## One battle tick

`stepArena(sim, ctx)` changes the state in place, in exactly this order. Let
`T` be `sim.tick` at the start; every event of the step has `tick = T`.

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
   instance-ID order:
   1. **Intake.** Only if `progress < costPerUnit` (no finished unit is
      waiting): go through its inputs clockwise from north and, for each, take
      `min(input buffer count, costPerUnit - progress)` items
      (`takeFromBuffer`) and add them to `progress` (all resources count
      alike). So `progress` never exceeds `costPerUnit`; the rest stays in the
      buffer. A producer that holds a finished unit (step 2 below could not
      place it, or its cooldown is running) takes nothing, so its buffers fill
      and its conduits back up (the source stalls), exactly like a fully
      charged turret.
   2. **Produce.** At most once per tick: if `progress = costPerUnit` (the
      building's tier) **and `cooldown = 0`** and the unit finds a **spawn
      position**, set `progress = 0`, set `cooldown = productionIntervalTicks`
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
      nothing is spawned and `progress` stays at `costPerUnit` and `cooldown`
      at 0, so step 2.1 takes nothing on later ticks until the unit can be
      placed. Only
      the cells next to the producer are tried, so a jam at the exit holds the
      unit rather than letting it appear farther away.
   3. A new unit has `attackCooldown = 0` and gets the next ID. It is placed
      immediately and takes part in this tick's decisions. (`inputBufferUnits`
      is smaller than some `costPerUnit` values, so the progress counter is
      what makes those producers work.)

   After all unit producers, the **scheduled waves** enter (see "Side options").
   Then, **turret charging**: for each living turret,
   side 0 first and each side in instance-ID order, if `charge < costPerShot`
   (the turret's tier), go through its inputs clockwise from north and, for
   each, take `min(input buffer count, costPerShot - charge)` items out of the
   buffer (`takeFromBuffer`) and add them to `charge`. A turret that is fully
   charged takes nothing, so an idle turret lets its buffer fill and its
   conduit back up (the source stalls) instead of draining the network.
   `charge` never exceeds `costPerShot`.

   Then, **ramp charging**, after turret charging: for each living economy
   building, side 0 first and each side in instance-ID order, if `steps <
   maxSteps` (its tier), go through its inputs clockwise from north and, for
   each, take `min(input buffer count, costPerStep - charge)` items out of
   the buffer (`takeFromBuffer`) and add them to `charge`. If `charge =
   costPerStep` **and `cooldown = 0`** afterwards: `steps += 1`, `charge = 0`,
   `cooldown = stepIntervalTicks` and `ramp_step {side, building, effect,
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
   - **c0. Fly.** A flying unit that reaches c ignores the movement and breach
     fields: its heading is the vector to the centre of the cell of its target
     Core nearest to it (the same cell as in "Goals and movement fields", "at
     the Core"), steered as in "Steering" (only flying allies count as
     blockers), and it never breaches. With no enemy Core standing it waits.
     Its target Core is chosen by straight-line distance ("Ranged units and
     flyers"). Rules a and a2 do not test line of sight for a flyer (the
     attacker): it chases an enemy within the aggro range behind a wall or a
     lake, where a ground unit does not.
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
   most `rangeCells` cells. The target is the in-range unit with the smallest
   `buildingDist2`; ties by lowest unit `id`. A
   unit that is dying this tick or has already been chosen by another turret is
   still a valid target (no turret sees another's choice). If there is a
   target the turret fires: `charge` becomes 0, `cooldown` becomes
   `cooldownTicks`, the tier's `damage` is added to the unit's pending damage,
   and `turret_fired` is recorded (in this step, after all decisions, before
   the `unit_attacked` events of step 4). A turret with no valid target keeps
   its charge and its (already 0) cooldown. A turret therefore never fires at
   a unit on the enemy's board, however close to the neutral zone the unit is
   (CB-18a); units in the neutral zone are targets (PP-13). Turrets do not otherwise affect movement: they are buildings, they
   block all units and have health.
4. **Resolve attacks simultaneously.** Every unit that chose (a) or (b) and has
   `attackCooldown = 0` deals its `damage` (the unit's own stored `damage`)
   escalated by Overload, `mulPct(damage, 100 + level * overloadDamageStepPercent)`
   (see "Overload"), to its target; the `unit_attacked` event carries that
   escalated value. Damage from all
   attackers, and from turret shots, is summed per target with the saturating
   rule of "Integer math conventions" (`addSaturating(sum, hit,
   MAX_TICK_DAMAGE)`: each hit is at most `MAX_HIT = 2^51`, a sum below the
   cap `2^52` is exact, and a larger one is `2^52`) and applied together
   (so two units can kill each other in the same tick; a target that is killed
   this tick still receives every blow aimed at it). Each attacker's `attackCooldown` becomes
   `attackCooldownTicks`. A building's health stops at 0 (a Core's health
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
      `s = floor(240 / moveCooldownTicks)` and `(dx, dy) = (tx - px, ty - py)`.
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
   - After any destruction every cached movement field and breach field is
     dropped. Then, at the end of this step, every living unit, in unit-`id`
     order, whose target Core now has health 0 gets `target =
     chooseTarget(owner, c)` (PP-11, "Goals and movement fields"), `c` the
     cell that holds its centre, and `unit_retargeted {unit, target}` is
     recorded after the destruction events. A unit changes its target at no
     other time after it spawned.
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
  (`needHundredthsPerSecond`). A turret has this need only while it fires: a
  charged, idle turret takes nothing; an economy building at `maxSteps` takes
  nothing.
- **Under-supplied buildings wait** (CB-10d): `progress` or `charge` keeps
  what has arrived and the production happens when the full cost is there. It
  is a full production (same unit, same shot, same step); nothing is produced
  at reduced strength and no building switches off.
- **Store** (CB-10b). A building holds at most `cost` in `progress` or
  `charge`, plus `inputBufferUnits` in each input buffer. When both are full
  it refuses items ("Accepting"), its conduit fills and the flow backs up.
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
  Core.
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
  passable. That is right for every part-1 unit (all collision radii are below
  half a cell); a unit whose collision diameter exceeds one cell is routed
  through gaps it cannot enter and waits at them (the circle rules, not the
  field, stop it).
- The unit's **goal building** (rule b) is any living enemy Core when the gap
  from the unit's circle to the Core's nearest cell is at most `reach`, the
  target Core first (step 3b).
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
  side's blocking buildings and the target Core's own cells are impassable. Entering an open cell
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
decision, issue #175): it gets only the side-wide `unitStrengthPercent` and run
modifiers; pinned by a test in `ramp.test.ts`.

**`source_speed`.** Before each tick's flow step the arena sets the board's
source interval modifiers to one value per player index: each owner's
`source_speed` bonus. A source whose countdown is reset after producing uses the
bonus `P` of its owner, so a player's Overclocker leaves a partner's collectors
unchanged: `max(1, floor(intervalTicks * 100 /
(100 + P)))` (integer division rounds down; at least 1, so at most one item
per tick). With the maximum 25 a tier 1 extractor (20) drops to 16, a tier 2
(14) to 11 and a tier 3 (10) to 8. The first countdown of a battle and any countdown already running
are not changed when the bonus changes, only the next reset sees it.

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
| `unit_attacked`      | `unit`, `target`, `damage`                                      |
| `turret_fired`       | `side` (the owner), `building` (the turret), `unit`, `damage`   |
| `unit_died`          | `unit`                                                          |
| `building_destroyed` | `side`, `building`                                              |
| `conduit_destroyed`  | `side`, `conduit`                                               |
| `core_destroyed`     | `side`, `core`                                                  |
| `ramp_step`          | `side`, `building`, `effect`, `steps` (the new step count)      |
| `overload_started`   | (none)                                                          |
| `overload_level`     | `level` (the new level)                                         |
| `overload_core_damage` | `side`, `core`, `damage`                                      |
| `zone_revealed`      | `zone` (the neutral zone); recorded by a battle at tick 0, first in the log |
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
optionally `units`, a list of `{side, def, x, y}` (arena cell; the unit is placed at the
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

Vectors added with the circle model (issue #59): `arena-sim.separation-converging-soldiers` (four soldiers converging on one target: equal and unequal priority in the separation pass), `arena-sim.choke-point` (twelve soldiers through a wall line with a one-cell gap), `arena-sim.producer-held-at-blocked-exit` (a barracks whose only exit is occupied holds its unit, stops drawing, the source stalls) and `arena-sim.wide-unit-blocked-by-gap` (an ogre with a collision diameter of 320 waits in front of a one-cell gap that a soldier passes). Vectors added with ranged units and flyers (issue #59 part 2): `arena-sim.ranged-fires-from-range-and-holds`, `arena-sim.flyer-crosses-lake-line`, `arena-sim.melee-cannot-hit-flyer` and `arena-sim.ranged-and-flyers-mirror-restore` (mirrored rosters with all four unit types, saved and restored three times). Vectors added with the flyer follow-ups: `arena-sim.walled-hangar-spawns-drones` (a Hangar walled in on every side spawns drones that fly out), `arena-sim.flyer-crosses-walls-and-buildings` (a drone passes a wall line and a row of Barracks without attacking them) and `arena-sim.flyer-retargets-by-distance` (after its Core falls a drone takes the nearer Core where the ground tie rule would take the higher index). Two optional inputs make them possible: `extraUnits`, a list of unit definitions in the format of `content/units.json` added to the content for the run, and `report: "positions"`, which adds `positions` (`[[id, px, py], ...]` of the living units) to the result.

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
bonus at spawn). `stepArena` does not assume the gap is open ground (blocked
gap cells are how the neutral zone enters), and does not end the battle: the
neutral zone, the battle end and the top-level entry point are in "The neutral
zone" and "Battles". Points of interest and neutral guards are deferred (CB-8
to CB-8c): the zone format reserves a `pointsOfInterest` list for them.

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
  of unit-ticks are deeper than half. A unit
  walks in a straight line to the centre of the next cell (see "Goals and
  movement fields"), so a crowd converges on cell centres; changing that is
  outside the collision rules.
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
Its lakes and cliffs are different every battle and hidden from players until
the battle begins (the battle's first event reveals them).

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
- `pointsOfInterest` is always `[]` for now. It is in the format so that the
  format does not change when points of interest are added (TA-41a).

### Parameters (`content/mapgen.json`, `neutralZone`)

`depth` (7), `lakes` `{countMinPerPlot, countMaxPerPlot, sizeMin, sizeMax}`
(0 to 1 per plot, 3 to 8 cells), `cliffs` `{countMinPerPlot, countMaxPerPlot,
lengthMin, lengthMax}` (0 to 1 per plot, 2 to 5 cells) and `maxAttempts` (64).
The feature IDs are those of `lakes.feature` and `cliffs.feature` in the same
file, and `placementTries` (30) is shared with board generation. "Per plot"
means per `plotWidth` columns of front width: `plots = ceil(width /
plotWidth)` (a hand-made board narrower than a plot counts as one plot), and
the zone's counts are `plots * countMinPerPlot` to `plots * countMaxPerPlot`.
A four-player battle therefore gets up to four lakes and four cliffs.

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
- After placement, constraint 3 is checked on the open cells; if it fails the
  attempt fails. A failed attempt is simply replaced by attempt `a + 1`. If
  all attempts fail an error is raised. With the standard content, over 500
  seeds and all four widths (2000 zones), 1991 zones were accepted at the first
  attempt, 9 needed a second one and none a third.

### Golden kind `neutral-zone`

Input `{seed, partySize}`; the width is `partySize * plotWidth`. Result
`{zone, hash, attempts}` with `hash = hashJson(zone)`. Vectors:
`golden/neutral-zone.json`, one per party size 1 to 4.

### Samples

One plot (seed 7, first attempt; `y = 0` is side 0's edge, `~` lake, `#` cliff):

```
........................
...................~....
...................~~...
.##.................~...
....................~...
....................~...
........................
```

Four plots (seed 3, first attempt):

```
................................................................................................
................................................................................................
...............................###..............................................................
................................##..............................................................
................................................................................................
.........................................................................#####..................
................................................................................................
```

## Battles

**Status (#124).** This section describes the code on `main`. The rules
below are specified in "Appendix: the per-player design (issue #124)" and change this
section when their issue lands; none of them is in the code yet unless the
row says so.

| Rule | Change to this section | Status |
| ---- | ---------------------- | ------ |
| PP-2 | `core_not_placed` names the lowest player without a Core, for any side with a player without a Core. | **implemented** (issues #131, #138) |

Implemented in `packages/core/src/battle.ts` (golden kind `battle`:
`packages/golden/src/kinds/battle.ts`). **Side 0 is always the party and side 1 the opponent** (the
defender, also called the ghost when the opponent is a recorded team). A
battle is a pure function of `(teamA, teamB, seed)`, the content and the
configuration (CB-30).

### Assembly

`startBattle({teamA, teamB, seed}, content, {sim, mapgen}, options?)` sets a
battle up at tick 0, or returns `{ok: false, error}`. The checks run in this
order and the first failure is reported:

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
at tick 0.

These follow from the arena rules and are checked by tests: nothing can be
built in the zone (a board is exactly its own `h` rows); no building has cells
or conduits in a zone row; no building produces or flows in the zone (production and flow stay on the
boards; turrets may shoot units standing in the zone, never units on the enemy's board); only units fight there. A unit producer on a front row may spawn a
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
   ends nothing.
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
| 1 | more Cores standing | `time_limit` |
| 2 | the larger share of total Core health, `sumHp / sumMax`, compared exactly with `compareFractions` | `time_limit` |
| 3 | less overkill (above) | `tiebreak_overkill` |
| 4 | more building damage dealt (`buildingDamageDealt`) | `tiebreak_building_damage` |
| 5 | more units killed (`unitsKilled`) | `tiebreak_kills` |
| 6 | otherwise the attacker, side 0 | `tiebreak_attacker` |

With one Core per side this is exactly the earlier rule set. Rungs 1 and 2
can only differ at the time limit.

### Tiebreak counters

Two integers per side, both part of the saved state (`buildingDamageDealt` is
a field of `ArenaSim`; the kills are derived from `unitsDied`):

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
  attacks alone).
- **`unitsKilled[s]`**: the number of enemy units that died from side `s`'s
  damage. A unit takes damage only from the other side's units and turrets (no
  unit attacks its own side, Overload does not damage units), so every unit
  death is the kill of exactly one side and the case of one unit killed by
  both sides in the same tick cannot occur. Hence `unitsKilled[s] =
  unitsDied[1 - s]` (units that died, whatever blow finished them; a unit that
  took the blows of several enemies in its last tick is one kill).

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
| `unitsKilled`   | Enemy units that died from the side's damage (`unitsDied` of the other side). |

`timeline` is a list of samples `{tick, sides: [s0, s1]}` with `s = {units,
unitHealth, buildings}`: units alive, the sum of their current health, and
placed buildings alive (the Core is not counted). The first sample is at tick
0, then one after every `timelineSampleTicks` (50) simulated ticks, and one at
`endTick` unless it coincides with a regular sample. The golden vectors leave
the timeline out.

### Golden kind `battle`

Input `{teamA, teamB, seed}` and optionally `sideOptions` (`[side0, side1]`,
each `null` or an object of the side options of "Side options": `scheduledWaves`,
`freePower`, `unitStrengthPercent`, `coreHealths`; absent in the older vectors);
each team is a `team-state-ops` script (`map` or
`seed` and `partySize`, and `ops`). Result for a battle that ran: `{ok: true,
result, summary (without timeline), zone, stateHash, events}` where
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
bare Cores), `battle.wave-queue` (a wave of 80 soldiers larger than the front row: the units that find no room wait in the `entering` queue and come in later); party sizes 1 and 2 refused; for several Cores (issue #132) `battle.two-plot-core-falls` (one Core falls at tick 2000 and the battle goes on; an earlier fall adds no overkill), `battle.walled-four-cores-overload` (eight walled Cores fall at tick 3100), `battle.time-limit-cores-standing-side0` and `-side1` (rung 1, the defender can win), `battle.time-limit-core-share` (rung 2) and `battle.overkill-two-cores` (rung 3).

### Decided simplifications

- The neutral zone is not symmetric, so a mirrored pair of boards does not
  give an exactly symmetric battle with a generated zone; symmetry holds only
  for an empty or point-symmetric zone (the test-only option).
- Units in the zone have no special rules: it is open ground (or lake and
  cliff) like any board cell.
- The Core health fraction in the time-limit rule uses the Core's maximum
  health as built from the content (the same for both sides today).

## Side options

A small, general mechanism of the arena simulation (`createArenaSim(...,
options)`, `ArenaOptions.sideOptions`, also `BattleInput.sideOptions`): per side,
an optional object with any of the fields below. Ghost battles do not use it.
When any side has options the state carries them in `sideOptions` (a pair
indexed by side, `{}` for a side without), so a saved state continues
identically; with none the field is absent.

- **`scheduledWaves`**: a list `{tick, unit, count}`. In the Production step of
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
- **`freePower`**: every turret of the side is fully charged at all times: in
  the turret charging step, `charge` is set to `costPerShot` without touching
  the input buffers. No flow is needed (the PvE threat has no sources,
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
  waves: [{ tick, unit, count }],
  stronghold: { cores: [{ x, y, health }],
                buildings: [{ def, tier, x, y, rotation }] } }
```

`cores[p]` is the Core of plot `p`: the position of its lowest cell, in the
stronghold's board coordinates, and its health. There are exactly `partySize`
Cores.

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
`bossOnly` archetypes are never offered by `pickArchetypes`. Shipped values:

| Archetype | Wave share | Waves (first tick, interval, count, growth) | Composition | Stronghold (Core per budget, walls, turrets, layout) |
| --- | --- | --- | --- | --- |
| Rusher | 70 | 100, 120, 6, 115 | soldier 2 : raider 1 | 600, 0, 0, `open` |
| Fortress | 20 | 600, 400, 3, 130 | soldier | 300, 30, 25, `ring` |
| Escalator | 75 | 100, 75, 8, 160 | soldier 3 : raider 1 | 300, 25, 15, `line` |
| Boss | 55 | 200, 250, 6, 125 | soldier 3 : raider 1; every 3rd wave only raiders | 400, 20, 20, `ring` |

Rusher tests defence (early frequent waves, a small open Core); Fortress tests
ramp and siege (late light waves, a big walled Core with turrets); Escalator
tests speed (waves that grow fast, a wall line); Boss mixes all of it, its
every-Nth-wave signature being all raiders (a fast swarm of small, weak units; since issue #66 raiders no longer prefer any building, they are ordinary units with different numbers: health 25, damage 8, radius 0.25 cell, move cooldown 4). Unit
prices for spending wave budget are `unitCost` in `threats.json` (soldier 10,
raider 8, archer 14, drone 16; about 2 times the producer's tier 1 `costPerUnit`
of 5, 4, 7 and 8, rounded). Building prices for the stronghold are the **tier 1** prices of the
first building of defense type `wall` and of defense type `turret` in the
building content (tier 1 only for now).

### Generation: `generateThreat({seed, round, type, partySize, archetype}, content, {threats, mapgen})`

A pure function. Randomness: `T = Rng.fromSeed(seed).child("threat")
.child(round)` (a string label, then an integer label; nothing is drawn from
the parents), `wavesRng = T.child("waves")`, `holdRng = T.child("stronghold")`.
`partySize` is 1 to `min(maxPartySize, mapgen.maxPartySize)`.

1. `B = budget(...)`; `waveBudget = floor(B * waveSharePercent / 100)`;
   `S = B - waveBudget`.
2. **Wave sizes.** `s_0 = 100`, `s_(k+1) = floor(s_k * growthPercent / 100)`
   for `k = 0 .. count - 1`; `sum` is their total. Wave `k` has budget `W_k =
   floor(waveBudget * s_k / sum)` (computed as quotient and remainder of
   `waveBudget` by `sum`, so nothing overflows).
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
   plot). Let `m` be the largest wave (sum of `n` over a wave's entries). If `m
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
6. Waves are listed per wave tick (`firstTick + k * intervalTicks`), one entry
   per composition entry (and per appended archer or drone entry) with a
   non-zero count.
7. **Stronghold** (`N = partySize`, `share(total, p) = floor(total / N) + (1 if
   p < total mod N else 0)`).
   - `wallsTotal = min(floor(floor(S * wallSharePercent / 100) / wallPrice),
     maxWallsPerPlot * N)`; `turretsTotal` likewise with the turret price and
     `maxTurretsPerPlot`. Plot `p` may place up to `share(wallsTotal, p)`
     walls and `share(turretsTotal, p)` turrets.
   - For `p = 0 .. N - 1` in order, with the random stream `holdRng.child(p)`
     (an integer label; nothing is drawn from `holdRng` itself), the
     archetype's layout (below) is computed on a board that is one plot
     (`plotWidth` by `plotDepth`) around that plot's Core, then every position
     is moved by `p * plotWidth`. So `ring` and `open` are one set per plot,
     and `line` has its one gap per plot, drawn from that plot's stream.
   - `spent` is the price of everything placed, over all plots. `total =
     max(minCoreHealth * N, floor((S - spent) * coreHealthPerBudget / 100))`:
     every unspent point of the stronghold budget, including what a full
     layout or the building caps could not absorb, becomes Core health. It is
     split evenly: `cores[p].health = share(total, p)`, so the shares differ by
     at most 1, the extra points go to the lowest plot indices, and they add
     up to `total` exactly. The total is computed by the same formula as with one Core, but its floor is `minCoreHealth * N` (the minimum is per Core, not for the whole stronghold) and `spent` now comes from the per-plot layouts, so it is not the old total.
8. **Content bounds.** After steps 1 to 7: each `cores[p].health =
   min(MAX_HEALTH, cores[p].health)` and `unitStrengthPercent =
   min(unitStrengthPercent, L)`, where `L` is the smallest
   `maxStrengthPercent` over all unit types (see "Content bounds"). The unit
   counts are not changed; the excess strength or health budget is lost (when
   a Core is clamped the Cores no longer add up to `total`). This is only a
   safety net: with the shipped content neither clamp is reached in rounds 1
   to `maxThreatRound` (see "Content bounds").

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

### The stronghold as a team state

`buildStronghold(profile, content, mapgen)`: a board of `partySize * plotWidth`
by `plotDepth` with no features and no nodes (`createTeamState`), the Core
with every Core placed with `placeCore(p, x, y)` (each lies inside its plot),
then each building with
`addToStash` (owner = the plot it stands in) and `placeFromStash`. Any rejection
throws: a threat whose stronghold cannot be built is a generator bug.

### Choosing and summarising

`pickArchetypes(seed, round, threats)`: the candidates are the archetypes that
are not `bossOnly`, in file order; `rng = Rng.fromSeed(seed).child("archetypes")
.child(round)`; the list is shuffled once and `easy`, `medium`, `hard` take
positions 0, 1, 2 (wrapping around if there are fewer than three; with three or
more they are distinct). `threatSummary(profile, content)` returns `{archetype,
type, level (easy 1, medium 2, hard and boss 3), totalUnits, firstWaveTick
(null if no waves), coreHealth (the total over the Cores), cores (their
number), walls, turrets}`.

### PvE battles

`startPveBattle({team, threat, seed}, content, {sim, mapgen})` and
`simulatePveBattle(...)` extend `startBattle`/`simulateBattle` (they call
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
below are specified in "Appendix: the per-player design (issue #124)" and change this
section when their issue lands; none of them is in the code yet.

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
threat, seed}` with `team` a `team-state-ops` script and `threat` a
`threat-gen` input; result `{ok: true, result, summary (without timeline),
threatHash, zone, stateHash, events}` or `{ok: false, error: {code, message}}`;
the event log is the vector's event log. Vectors: `golden/threat-gen.json`
(every archetype at rounds 1, 5 and 10, a four-plot Escalator, a round beyond
the budget clamp) and `golden/pve-battle.json` (each reference board against
each archetype at round 1, and two battles the party loses) and
`golden/reference-matrix.json` (the `pve-battle` kind again: the siege board
against each archetype at round 1, and every reference board against each
archetype at round 5 (medium) and round 10 (hard)).

### Decided simplifications

- Tier 1 buildings only, and the first wall and the first turret building in
  the content, for the stronghold.
- Strength is one number for all waves of a threat (not per wave).
- Stronghold turrets are always charged (`freePower`), so there is no way to
  starve them; the wall and turret caps per plot keep the building count low.
- A wave unit that finds no open front-row cell is not spawned.

## Performance budget

**Status (#124).** The budget document describes the code on `main`. Its
dense four-plot board is not a legal player-built board under PP-1 and the
plot's node count, unit counts fall under PP-6, and PP-11 adds one movement
field and one breach field per living enemy Core. The budget is measured
again in issue #145; see the status note at the top of
`docs/performance-budget.md`. Not yet implemented.

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
  attacks, moves, deaths); producers in side then building-ID order; buildings
  are destroyed in side then `health`-list order (Core first, then instance
  ID); conduits of a destroyed building are reported in conduit-ID order.
- **Which enemy unit to hit or chase:** the nearest by squared centre distance,
  then the lowest unit `id`. A turret picks its target by the squared distance
  from the unit's centre to its nearest cell (ties: lowest unit `id`), only
  among units on its owner's board rows.
- **Which building to hit:** an enemy Core when it is within reach (with
  several: the unit's target Core, else the nearest by `buildingDist2`, ties by
  `(|q - opposite(owner)|, -q)`, PP-11); in breach mode
  the building covering the next breach cell.
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
- **Spawn order and IDs:** side 0's producers spawn before side 1's within a
  tick, so at equal times side 0's units have the lower IDs. Because the
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
| `ghost:r<r>`               | when the PvP opponent is selected                                       | the ghost draw (see "Ghost snapshots")    |
| `battle:pvp:r<r>`          | when the PvP battle starts                                              | the PvP battle                            |

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

### Income

On entering each `shop` step (both shops of every round), every player is paid
`baseIncomePerShop`, and their offers are rolled in the same step. The first
`build` step has no income and no offers.

### Weighted pick

`pickWeightedIndex(rng, weights)`: weights are non-negative integers with a
positive sum `T`. Draw `x = rng.nextInt(T)` (one draw). Return the first index
`i` with `x < w0 + ... + wi`.

### Offer roll

`rollOffers(rng, round)` makes `shopOfferCount` offers, for slot 0, 1, ... in
order. Per slot, exactly two draws, in this order:

1. the building: `pickWeightedIndex` over `offerWeights` (file order);
2. the tier: `pickWeightedIndex` over the weights `[w1, w2, w3]` of the
   applicable `tierOdds` row; the result plus 1 is the tier.

Duplicates across slots are allowed. The offer is `{slot, def, tier, price}`
where `price` is that tier's `price` in `buildings.json`. Buildings not in
`offerWeights` are never offered; the Core cannot be listed.

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
  Pays `price`, adds a new stash entry for the buyer, and empties the slot
  until the next roll. Buildings never merge: three identical purchases are
  three entries.
- Sell `{id}`: only a stash entry (`not_in_stash` if it does not exist or is
  placed on the board) of the seller (`not_owner` otherwise). Refund =
  floor(tier price x `sellRefundPercent` / 100). Selling is also allowed in the
  first `build` step.
- Re-roll `{}`: needs `gold >= rerollCost` (`not_enough_gold`). Pays it and
  replaces all of that player's offers with a roll from the next draws of that
  player's stored shop stream (so two re-rolls differ). A re-roll also brings
  back bought slots.
- Buy and re-roll are legal only in the `shop` step (`wrong_step` elsewhere,
  including the first `build`). None of these can be undone.

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
battle): `pickArchetypes(rng.child("archetypes").nextU32(), r, threats)` gives
the three archetypes, and each difficulty's threat is
`generateThreat({seed: rng.child(<difficulty>).nextU32(), round: r, type:
<difficulty>, partySize, archetype})`. An option is
`{ id, difficulty, archetype, reward: {gold}, budget, summary, threat }` with
`id = difficulty`, `summary = threatSummary(threat)` and `threat` the whole
profile. The budget multipliers (70 / 100 / 140 percent) and the strictly
increasing `rewards.pveWin` (checked by the loader) make harder options
strictly larger in budget and reward.

### Rewards (EC-6, EC-7)

Gold only, per player, paid when the battle's summary step ends (before the
event step). PvE win: the chosen option's `reward.gold`. PvE loss: nothing,
and no life is lost. PvP win: `rewards.pvpWin`. PvP loss: `rewards.pvpLoss`
and `pvpLossLifeCost` lives. Placeholder values: PvE easy 3, medium 5, hard 8;
PvP win 6; PvP loss 2. No battle or event adds a building (only shop
purchases and the starting kit do).

### Run modifiers (EC-8)

`TeamState.modifiers` is an optional list `{ id, effects }` in the order taken;
it is omitted (never an empty list) when there are none, so states without
modifiers hash as before. A modifier's effects are copied into the team state
when it is taken. Effects (percent is an integer 1 to 1000; the simulation
uses `floor(value * (100 + sum) / 100)`, summing all effects of a kind and
target held by the side). Stackable modifiers have **no cap** (issue #49):
bonuses of the same kind (and target) are summed, then applied once, never
compounded, so each extra stack is worth relatively less than the one before:

| Kind | Applied |
| --- | --- |
| `building_health_percent` (`target`: `all`, `wall`, `gate`, `turret`, `source`, `route`, `unit_producer`, `economy`) | to the maximum (and so the starting) health of matching placed buildings (not the Core; a defense matches its defense type, others their kind; `all` matches every building); at tick 0 in `createArenaSim` |
| `core_health_percent` | to the maximum (and so the starting) Core health (after a side-option Core override) |
| `unit_strength_percent` | added to the unit strength percent at each spawn (health and damage, see the unit stats seam in "The arena"); side-wide, and it comes only from run modifiers, never from an economy building (PP-8) |
| `turret_damage_percent` | to the damage of each of the side's turrets, when the arena context is built |

Each side's modifiers come from its own team state (`TeamState.modifiers`):
the party's from the run, and a ghost from `findPvpOpponent` brings its own,
which apply to side 1. Generated threats (PvE options and the PvP boss) have
none. An extractor-speed kind is not implemented.

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

`ready` and `unready` are legal in `core_placement`, `build`, `shop`,
`pve_summary` and `pvp_summary`. A step ends when every player is ready (a solo player's `ready`
ends it at once); the ready flags are cleared on entering the next step.
**Ready locks editing (issue #58):** in `core_placement`, `build` and `shop`, while a player is
ready, every intent of theirs other than `unready` (and `abandon` by the host)
is rejected with `locked_ready`: `place_core`, `buy`, `sell`, `reroll`, the board edits
(`place_building`, `move_building`, `return_building`, `add_conduit`,
`erase_conduit`) and any extension intent a handler allows in those steps.
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
stage of the code), and that is the stated approximation.

The summary steps are not checked. `sealedProducers(state, deps)` in the session
package gives the same list for a screen.

### Events (RS-4)

`content/events.json` lists event definitions `{ id, type, weight,
params }` and modifier definitions `{ id, stackable, effects }`,
and `offerCount` (3). The `type` names a handler in the session package; the
handler decides availability, extra offer data, what happens on pick, and how a
follow-up choice is applied. Adding a type is data plus one handler.

Offers (stream `event_offers:r<r>:<leg>`): **never two offers of the same
type** (issue #48). The content may hold several definitions of one type (for
example a small and a big Windfall); they compete for a single place. The
definitions whose handler says `available` (Workshop: some owned building
below tier 3; Shrine: at least one modifier can be taken; Windfall: always)
form the pool, in file order. The draw sequence is: one `pickWeightedIndex`
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

- **Workshop** (`params.workshopPricePercent`, 80; an integer from 1 to 100,
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
    gives 7. A building at tier 3 is never an option; events never add a
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
  - *Applying.* When every player has chosen, the choices are applied in
    player order (price taken from the player's gold, `raiseTier` on the
    building) and the run goes to the shop. With one player the first choice
    applies at once. The `event_resolved` custom effect carries `choices`
    (the votes in player order) instead of `choice`, and `applied`: one entry
    per player in player order, `{ player, result: 'skip' }`, `{ player,
    result: 'upgrade', building, def, newTier, price }` (the price charged), or
    `{ player, result: 'skip', dropped: true, reason }` when a chosen upgrade
    was dropped (`not_enough_gold`, `invalid_choice`, `cannot_raise`).
- **Shrine** (`params.choices`, default 3): available when a modifier can be
  taken. The offer lists up to `choices` modifier IDs, a random subset of the
  modifiers not already held (stackable ones are always eligible), in file
  order. The follow-up options are those modifiers; the chosen one is added to
  `TeamState.modifiers`.
- **Windfall** (`params.gold`): no follow-up; every player gets that much gold
  at once.

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
generated `boss` threat for the round (archetype drawn from the boss-only
archetypes; opponent kind `boss`). The battle seed is the first `nextU32` of
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

## Ghosts

A ghost is another run's party, frozen at the start of one of its PvP battles
and fought by a later run (MM-1..MM-17, W3-1). Everything below is implemented
in `core/src/ghost-snapshot.ts` (format and validation) and
`session/src/rules/ghosts.ts` (taking, matching, selecting); the pool itself is the
`GhostStore` interface (`session/src/app/ghost-store.ts`, see the session README).
Ghosts are switched on by giving the run's deps `ghosts` (`createGameDeps(...,
{ ghosts: { ownerId } })`); without it PvP always fights the generated boss.

### Format (`schemas/ghost-snapshot.schema.json`)

`formatVersion` (3), `gameVersion` (`major.minor`, the run's `runVersion`),
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
   the boss;
4. stores the whole chosen snapshot in `state.pvpOpponent = { round, kind:
   'ghost' | 'boss', label, ghost }`.

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
opened. Players are told before the battle: "Opponent: a recorded rival party" (plus "(weak)" when the label names a strength) or
"Opponent: the boss (no ghost available)" (MM-11).

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

`replayRun` takes the stream `ghost:r<round>` as the live path did, checks that
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
   `actionLog` are reserved and rejected), `formatVersion` 6, `gameVersion` as
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
             + (2 * round - 1) * modifierEntry           (one modifier per event step)
             + 4096                                      (margin: ids, labels, counters)

   Each entry is the canonical length of a worst-case sample (longest content
   id, highest coordinates, instance id of 7 digits) plus a comma. With the
   shipped content: party 1 gives 33,287 (round 1), 58,064 (round 10) and
   99,359 (round 25) characters; party 4 gives 120,542, 213,926 and 369,566.
   (The earlier flat `4096 + 12288 * partySize` dropped a legitimate late
   four-player board of about 63 KB at round 23; the limit now always exceeds
   what the board and the value bound allow.)
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
4. **Numbers**: `wins + losses = round - 1`, `lives <= startingLives` and
   `losses * pvpLossLifeCost = startingLives - lives`.
5. **Value bound**: the sum of the shop prices (at the building's tier) of
   every building, placed or stashed, is at most the bound below.
6. **Tier bound**: for every owner, the number of tiers above the highest tier
   the shop could have sold is at most the number of Workshop raises possible.
   Exactly, with `shopTier(r)` the highest tier with a non-zero weight in any
   `economy.tierOdds` row with `fromRound <= r` (and at least the tier of every
   starting-kit entry, and 1), and `raises(r) = 2r - 1` if `events.json` has an
   event of type `workshop` (the event steps before this round's PvP battle:
   two per earlier round plus this round's PvE event; each Workshop raises one
   building per player by one tier), else 0: for each owner,
   `sum over its buildings (placed and stashed) of max(0, tier - shopTier(r))
   <= raises(r)`. With the current content `shopTier` is 1 for rounds 1-2, 2
   for rounds 3-4 and 3 from round 5, and `raises` is 1, 3, 5, ... So a round-1
   ghost may hold one tier-2 building but not a tier-3 one, even if its value
   fits the bound; from round 2 a tier 3 is reachable by two raises
   (`ghostTierBound`).
7. **Modifiers**: each is known to `events.json`, has exactly its defined
   effects, a non-stackable one is held once, and there are at most `2 * round
   - 1` of them (one per event step that can have happened by then).

The value bound, for `n` players at the start of the PvP battle of round `r`:

    per player = startingGold
               + baseIncomePerShop * (2r - 1)     shops entered so far
               + best pveWin * r                  best PvE win of each round up to r
               + best PvP gold * (r - 1)          PvP win or loss gold of the rounds before
               + maxEventGold * (2r - 1)          every event a Windfall
               + kit                              price of the starting kit
    limit = n * (per player gold + kit)

There is no margin. Every gold source is counted at its best case; buying turns
gold into building value one for one; selling returns less than was paid; and a
Workshop upgrade adds less value (`price(t+1) - price(t)`) than it costs
(`floor(price(t+1) * workshopPricePercent / 100)`), which a test checks for
every building and tier of the shipped content, so no chain of upgrades can
manufacture value. (An earlier version added 25% for "Workshop upgrades that
turn gold into slightly more value"; that was wrong and the margin was
removed. A fuzz of seeded runs that buy, re-roll and upgrade shows no false
rejection and a highest value-to-limit ratio of at most 1.) With the current content
(starting gold 10, income 5, hard win 13, PvP win 8, Windfall 4, kit worth 67):

| Party | Round | Gold per player | Limit |
| ----- | ----- | --------------- | ----- |
| 1     | 1     | 32              | 99    |
| 1     | 2     | 71              | 138   |
| 1     | 3     | 110             | 177   |
| 1     | 5     | 188             | 255   |
| 1     | 8     | 305             | 372   |
| 1     | 12    | 461             | 528   |
| 2     | 3     | 110             | 354   |

The bound is the installed version's, which is also the ghost's version
(MM-15), so no tolerance for runs that spanned an update is needed yet (MM-17).
The signature check (TA-22a) is not implemented.

### PP-17. Formats, version and ghost validation

Implemented (issues #135, #131, #139, #160).

- **Major version.** The game's major version is 1.0. At first start,
  saves of older major versions are deleted and the local ghost pool is
  emptied, as for any major release (TA-8). There is no migration.
- **Team state**: `cores` in place of `core` (PP-2); `owner` on every conduit
  (PP-1); conduit ends may be border spots (PP-4).
- **Formats.** Ghost snapshot `formatVersion` 6, run state format 9. Older
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
label: 'the boss', ghost: null }` and the battle generates the boss for the
round from the battle stream, as before. The run's round record shows the
opponent as `ghost` (label: the owner's label) or `boss`.

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

Almost all of it is implemented; the Status table below names, for each rule,
the issue that implemented it and what is still open. The rules themselves
are written in the sections they change, and the golden vectors pin them.
Where a rule below is still open, a port does not implement it yet.

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
| Turret `cooldownTicks` / `costPerShot` / `damage` | `buildings.json` | 10 / 7 / 5 ticks, 1 item per shot, damage 5 / 8 / 10 (need 1.00 / 1.42 / 2.00 while firing: two collectors of its tier) | integers >= 1 |
| Overclocker `costPerStep` / `stepIntervalTicks` / `stepPercent` x `maxSteps` | `buildings.json` | 2 / 3 / 4 items per step, a step per 40 / 42 / 40 ticks, 2x5 / 3x5 / 5x5 = +10 / +15 / +25 percent | fits under `maxSourceSpeedPercent` |
| Armory `costPerStep` / `stepIntervalTicks` / `stepPercent` x `maxSteps` | `buildings.json` | 4 / 5 / 6 items per step, a step per 80 / 70 / 60 ticks, 5x5 / 7x5 / 10x5 = +25 / +35 / +50 percent | fits under `maxUnitStrengthPercent` |
| `inputBufferUnits` (items waiting at each input) | `sim.json` | 4 (unchanged) | integer >= 1, small |
| `maxSourceSpeedPercent` (collector speed-up cap) | `sim.json` | 25 | SC-12: a tier 1 collector boosted to 0.62 per second stays below an unboosted tier 2 (0.71), tier 2 boosted to 0.91 below tier 3 (1.00) |
| `maxUnitStrengthPercent` (Armory cap per player) | `sim.json` | 100 | an Armory costs supply only while it charges, so it has its own limit |
| Core health | `buildings.json` | 500 (decided) | per Core |
| `nodesPerPlot` | `mapgen.json` | 3 common, 1 rare (unchanged) | the same for every plot |
| Gold | `economy.json` | `baseIncomePerShop` 5; `rewards.pveWin` easy / medium / hard 6 / 9 / 13; `pvpWin` 8; `pvpLoss` 4 (9 to 26 gold per round) | strictly increasing `pveWin` |
| Shop | `economy.json` | `bld_armory` in `offerWeights` at weight 3, like the Overclocker; `bld_range` at 5 and `bld_hangar` at 3 (issue #59; placeholder unit numbers kept by owner decision) | |
| Threat growth | `threats.json` | `growthPercent` 125 (+25 percent per round) | above 100 |
| Stronghold caps | `threats.json` | `maxTurretsPerPlot` 6 (was 16); Fortress `turretSharePercent` 25 (was 40) and `coreHealthPerBudget` 300 (was 500); Boss `turretSharePercent` 20 (was 30) | the rest of a stronghold's budget becomes Core health |
| Escalator wave timing | `threats.json` | `firstTick` 100 and `intervalTicks` 75 (was 150 and 150): the eighth wave comes at tick 625 instead of 1200 | its Core used to fall before its large late waves spawned; a full tier 1 board now beats hard Escalator through round 8 (was 12), against 7 for Rusher |
| `minCoreHealth` (per Core) | `threats.json` | 30 (unchanged; never reached in rounds 1 to 12 at any party size) | |

Not part of this table: Overload timing, shop prices and tier odds, wave sizes
and `baseBudget` (all unchanged). The reference boards are rebuilt (PP-6; see
"Reference boards").

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

Before the first build step the run is in the step `core_placement`.

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
  are granted as today.
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
- **Implemented** (issue #132). Until issue #133 lands every unit's goal is the
  lowest-indexed living enemy Core, and a unit attacks that Core only when it
  is in reach (`goalCoreRef`).
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
  those ids only. Another player's sealed producer does not block `p`.

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
The guard test `packages/session/src/no-giving.test.ts` sends every intent a
player can send and checks that no other player's gold, stash or placed
buildings change and no `owner` changes. Board intents aimed at a partner's
buildings are rejected with `not_owner` (CP-28, PP-1, issue #129).
