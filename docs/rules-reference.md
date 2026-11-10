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
`count` outputs of `child(label)`), `map-gen` (see Map generation),
`team-state-ops` (see Team state and placement), `flow-graph` (see Conduits), `flow-sim` (see Tick order).

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

## Team state and placement

Implemented in `packages/core/src/team-state.ts` (golden kind `team-state-ops`:
`team-state-ops.ts`). The party's whole state for combat is one board (CP-6,
CB-32). All operations are pure: each returns a new state or a rejection and
never changes its input.

### Format (plain JSON, `schemas/team-state.schema.json`)

```
{ map, core, buildings, stash, nextId, conduits }
```

- `map`: the map format above.
- `core`: `{ x, y }`, the Core footprint's lowest-x, lowest-y cell, or `null`
  before it is placed. The Core is **not** an entry in `buildings` or `stash`;
  its definition is the content building of kind `core` (found by kind) and it
  can never be moved, returned or sold: no instance ID addresses it.
  `placeCore` is the only operation that touches `core`, and works once.
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
- `conduits`: conduits `{ id, from, to, cells }`, sorted by `id` (see
  Conduits). Their `id` comes from the same counter as building IDs.

Buildings of kind `core` never appear in `buildings` or `stash`.

**Canonical order.** `buildings` and `stash` are each sorted by ascending
`id`, so one state always serialises identically (and hashes identically).
`createTeamState(map)` gives an empty state with `nextId` 1.

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
- The Core is never rotated: it covers `core.x .. core.x + w - 1` by
  `core.y .. core.y + h - 1`.
- `cellsOf` lists a building's cells in `(y, x)` order. `absoluteSides` gives
  its input sides (with resources) and output sides at its rotation.
  `sourceResource` is the resource of the node under a source. `buildingAt`
  returns the placed building, the string `core`, or `null`.

### Operations

Each returns `{ ok: true, state }` (`addToStash` also the new `id`) or
`{ ok: false, reason, detail? }`. All are free (no gold).

- `addToStash(def, tier, owner)`: reasons `unknown_definition`,
  `core_not_allowed` (the definition is of kind `core`), `invalid_tier` (not an
  integer 1 to 3), `invalid_owner` (not an integer from 0 to `partySize - 1`),
  checked in that order. Appends `{ id: nextId, def, tier, owner }` and
  increments `nextId`.
- `placeCore(x, y)`: reasons in order: `core_already_placed`; then those of
  `validateCorePosition` (`out_of_bounds`, `blocked`, `on_node`,
  `too_far_forward`); then `overlaps_building` if the footprint covers a placed
  building; then `overlaps_conduit` if it covers a conduit cell.
- `placeFromStash(id, x, y, rotation)`: `id` must be in `stash`. Moves the entry
  to `buildings` (same ID, tier, owner).
- `moveBuilding(id, x, y, rotation)`: `id` must be in `buildings`. Sets position
  and rotation in one step; moving to the same position with a new rotation is
  a rotate in place. The building's own current cells never count as overlap.
  Anyone may move any building (CP-13); owner is not checked.
- `returnToStash(id)`: `id` must be in `buildings`; the entry goes back to
  `stash` (sorted by ID). Only `unknown_building` can reject.
- `removeFromStash(id)`: `id` must be in `stash`; the entry is deleted
  (selling and refunds come later). Only `unknown_building` can reject.

**Rule order for `placeFromStash` and `moveBuilding`.** The first failing rule
in this order is the reported reason:

1. `unknown_building`: no such instance ID where expected (stash for place,
   buildings for move).
2. `invalid_rotation`: not 0, 90, 180 or 270.
3. `out_of_bounds`: a non-integer position, or any cell of the rotated
   footprint outside `0 <= x < width`, `0 <= y < height`.
4. `blocked_by_feature`: a cell holds a feature whose `blocksBuilding` is true.
5. `overlaps_core`: a cell is in the Core footprint (when the Core is placed).
6. `overlaps_building`: a cell is covered by another placed building.
7. `overlaps_conduit`: a cell holds a conduit cell. For `moveBuilding`, conduits
   attached to the moving building do not count (they are removed when the
   move succeeds); conduits of other buildings do.
8. Node rules:
   - `source_needs_node`: a building of kind `source` must have every
     footprint cell on a resource node, all of the same resource (a
     placeholder source is 1x1). It produces that resource.
   - `node_reserved`: a building that is not a source may not cover any node
     cell. A resource node cell is otherwise buildable, so this keeps nodes
     for sources.

A rejected operation changes nothing. Placement does not require the Core to
be placed first, and CP-12 applies: a building may go anywhere on the board
whoever owns it.

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
by ascending `id`; `nextId` greater than every ID (building, stash and conduit); and every
placement rule above for every building (each against the Core and all other
placed buildings); then every conduit (shape, unique ID shared with buildings
and stash, canonical order, each conduit's geometry rules against all the other
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
`placeCore` (`x`, `y`), `placeFromStash` and `moveBuilding` (`id`, `x`, `y`,
`rotation`), `returnToStash` and `removeFromStash` (`id`), `addConduit`
(`from` and `to`, each `{ building, side }`, and `cells`, a list of `{ x, y }`)
and `eraseConduit` (`id`). A rejected op leaves
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

A conduit is `{ id, from: { building, side }, to: { building, side }, cells }`
(`schemas/team-state.schema.json`):

- `id`: a unique positive integer taken from `nextId`, the same counter as
  buildings, and never reused. `addConduit` assigns it and increments `nextId`.
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

`addConduit(state, content, { from, to, cells })` returns `{ ok: true, state, id }`
or `{ ok: false, reason, detail? }`. The rules are checked in this fixed order
and the first failing rule is the reported reason:

1. `unknown_building`: either end is not a placed building (an unknown ID, a
   stashed building, or the Core).
2. `not_an_output`: `from.side` is not one of the building's output sides at its
   rotation (this includes buildings with no outputs and any value that is not a
   side name). Then `not_an_input` likewise for `to.side`. `from` is checked
   before `to`.
3. `side_in_use`: that output side, or that input side, already has a conduit
   (output first).
4. `invalid_path`: see Path and Direct connection above.
5. `blocked_by_feature`: a path cell holds a feature with `blocksBuilding`.
6. `overlaps_core`: a path cell is in the Core footprint.
7. `overlaps_building`: a path cell is covered by a placed building.
8. `crosses_conduit`: a path cell is used by another conduit (CB-3g: conduits
   never share or cross a cell).
9. `resource_mismatch`: see Resource typing.
10. `would_loop`: see Loops.

A conduit may run over a resource node cell (it blocks that node while it is
there, since `placeFromStash` and `moveBuilding` reject `overlaps_conduit`;
conduits are free to erase). A rejected operation changes nothing.

Other operations: `eraseConduit(state, { id })` removes one conduit (reason
`unknown_conduit`); the ID is never reused. `detachConduits` is described under
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

Implemented in `packages/core/src/flow-sim.ts` (golden kind `flow-sim`:
`flow-sim-kind.ts`). This is the part of the battle simulation that exists so
far: the resource flow of **one board on its own** (CB-10, CB-11). Units,
defenses, economy effects and the second board are added by later issues; the
sub-heading "Later" at the end of this section is a placeholder for them.

### Constants (`content/sim.json`)

`ticksPerSecond` (10, fixed battle time per second) and `inputBufferUnits` (4,
the capacity of each consumer input buffer). Later issues add fields.

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
chooses the consumer mode, `hold` or `drain`, and may carry an event list that
the step appends to. Let `T` be `tick` at the start of the step; every event of
the step has `tick = T`. In this order:

**0. Merger arbitration.** For each merger whose holding cell is empty: let `n`
be its number of input sides (the order of `FlowNode.inputs`, clockwise from
north, including sides with no conduit). Look at input indices `pointer,
pointer + 1, ...` (mod `n`) and pick the first whose conduit exists, has
`L >= 1` and whose **last slot holds an item** (as the tick began, before
anything moves). That input is the merger's _winner_ for this tick; if there is
none, the merger has no winner. This is decided before any item moves, so it
does not depend on the order in which conduits are processed.

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
   `countdown = intervalTicks`, `stalled = 0`.
4. If **no** output has a conduit: the item is lost at once: `produced` and
   `lost` both increase, the `produced` event and then a `lost` event (with the
   source as `building`) are recorded, and `countdown = intervalTicks`.
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

### Accepting

An item offered to a building's input side (by step 1a, or by a push):

- _Consumer_ (unit producer, turret, economy building): accepted if that input's
  `count` is below `bufferCapacity`. Then `count` and `delivered` increase by 1
  and `{tick: T, type: "delivered", building, side, resource}` is recorded.
  Otherwise refused, and the conduit backs up.
- _Route building or crossover channel_: accepted if its holding cell is empty;
  the item goes into the cell. Offers from a conduit in step 1a to a **merger**
  are additionally accepted only from the merger's winner of step 0. An offer
  to a merger by a direct connection (step 2 or 3) is accepted when the cell is
  empty, whichever input it comes through. Whenever a merger accepts an item
  through input index `i`, its `pointer` becomes `(i + 1) mod n`. A splitter
  or crossover channel has one input, so there is nothing to arbitrate (their
  pointers do not change on input).
- Anything else (cannot happen in a valid state): refused.

Because step 1 comes before steps 2 and 3, a conduit delivery into a merger's
empty cell beats a direct connection arriving in the same tick, and a source
stalls rather than push into a cell that is already full.

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

`dryRunFlow(teamState, content, simConfig, ticks)` runs `createBoardSim` and
`stepFlow` with `consumers: "drain"` for `ticks` ticks and reports, per source:
`produced`, `lost`, `stalledTicks`; per route: `lost`; per consumer input:
`delivered` and `ratePer1000` = `floor(1000 * d / w)` where
`w = ticks - floor(ticks / 2)` and `d` is the number of deliveries during the
last `w` ticks (so the cold start does not distort it; 0 when `w` is 0).

### Golden kind `flow-sim`

Input: a `team-state-ops` script (`seed`, `partySize`, `ops`) plus `ticks` and
`consumers` (`"hold"` or `"drain"`). The script builds the board, then the flow
simulation runs for `ticks` ticks from the cold start. Result:
`{ tick, stateHash, flow, sources, routes, consumers }`: `stateHash` is the
hash of the final state, `flow` the conservation totals, and the lists give
per-building counters (and, for consumers and routes, what they hold at the
end). The event log of the run is the vector's event log (`eventLogHash`).
Vectors: `golden/flow-sim.json` (a long conduit, a splitter, a merger, a
crossover with two resources, a dead end, and a full-buffer backpressure case).

### Later: units, defenses, economy, two-board battles

To be written by the issues that add them (units, defenses, economy effects,
two-board battles): where their steps fall in the tick order above, and how
the two boards interleave.

## Resolution order

What exists so far is the order in which simultaneous flow events resolve; all
of it is fixed by the tick order above and uses no random numbers:

- Conduits resolve downstream first, ties by conduit ID; routes in topological
  order of the flow graph (ties by building ID, then channel); sources by
  building ID.
- A merger arbitrates between inputs with its round-robin pointer (step 0);
  splitters and sources with several outputs alternate with theirs.
- When two things want the same space in one tick, the earlier step wins
  (conduits, then routes, then sources), and within a step the earlier one in
  the orders above.

### Later: combat

To be written by the issue that implements combat resolution (damage,
targeting and tie-breaking).
