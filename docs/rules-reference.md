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
  an error too (never wrap or saturate silently).
- All helpers throw on non-integer or out-of-range input.
- Basis points: 10000 = 100%. `mulBps(v, bps) = mulDiv(v, bps, 10000)`.
  `mulPct(v, p) = mulDiv(v, p, 100)`. Both floor.
- `modFloor(n, d)` has the sign of `d`; `divFloor(n, d) = (n - modFloor(n, d)) / d`.
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

Kinds currently defined: `placeholder-duel` (pipeline check only, not a rule),
`prng-u32` (first `count` outputs for `seed`), `prng-sample` (`count` calls of
`nextInt(bound)`, then `shuffle` of `0..shuffleLength-1`, then `pick` of the
same list, and the final state), `prng-child` (the parent state and the first
`count` outputs of `child(label)`), `map-gen` (see Map generation).

In the reference implementation the registry is `goldenKinds` in
`packages/core/src/golden-kinds.ts`; a new kind is one added entry. Kinds that
need the real content files (`map-gen`) cannot be built in `core`, which reads
no files: `core` exports a factory (`makeMapGenKind(content, config)`) and
`packages/golden/src/kinds.ts` builds the full registry from `@game/content`
and the `core` kinds. A port needs its own way to hand content to such kinds.
`pnpm test`
runs all vectors and never rewrites them. `pnpm golden:update` regenerates the
`expected` parts and must be run deliberately; review the diff of `golden/`
like any other change.

## Map generation

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
considered). `validateCorePosition` returns the first of these that applies:

1. `out_of_bounds` if `x < 0`, `y < 0`, `x + w > width` or `y + h > height`;
2. `blocked` if any footprint cell is not buildable;
3. `on_node` if any footprint cell holds a resource node;
4. `too_far_forward` if `y + h > height - coreFrontClearance` (the starting
   value 8 puts the whole footprint in the back half of a 16-row board).

Otherwise it is ok. `listLegalCorePositions` returns every ok position, sorted
by `(y, x)`. A footprint spanning two plots is not rejected here (placement of
the Core is not part of generation).

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

## Tick order

To be written by the issue that implements the battle simulation loop.

## Resolution order

To be written by the issue that implements combat resolution (damage,
targeting and tie-breaking).
