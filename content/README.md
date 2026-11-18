# content

Game data files (JSON): buildings, encounter and boss templates, scaling
constants, and so on. Rules are kept separate from names, descriptions, and
art. Every file here is validated against a schema in [`../schemas/`](../schemas/)
(`pnpm validate:content`). To register another content file, add a row to
`packages/tools/src/registry.ts`.

## Files

| File                   | Holds                                                      | Schema                             |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------- |
| `resources.json`       | Resources and their display names (TA-27a)                 | `schemas/resources.schema.json`    |
| `terrain.json`         | Natural-feature rules (`ter_*` IDs)                        | `schemas/terrain.schema.json`      |
| `units.json`           | Unit numbers (`unit_*` IDs), integers only                 | `schemas/units.schema.json`        |
| `buildings.json`       | Building rules (`bld_*` IDs): kind, footprint, tiers, sides | `schemas/buildings.schema.json`    |
| `mapgen.json`          | Map generation parameters (plot size, nodes per plot, lakes, cliffs, neutral zone) | `schemas/mapgen.schema.json`       |
| `sim.json`             | Battle constants (ticks per second, buffer size, breach costs, aggro and separation, modifier caps, Overload, time limit) | `schemas/sim.schema.json`          |
| `economy.json`         | Gold, starting kit, shop size, re-roll/sell rules, battle rewards, offer and tier odds | `schemas/economy.schema.json`      |
| `events.json`          | Event definitions (type, weight, params) and the run modifiers a Shrine or a Pact offers | `schemas/events.schema.json`       |
| `points.json`          | Points of interest of the neutral zone: chance per plot band, margin, buffs (CB-8d), their neutral guards (CB-8e), the capture numbers (CB-8f) and the numbers of each buff (CB-8g) | `schemas/points.schema.json`       |
| `threats.json`         | PvE threats: budget curve (SC-1), unit prices, per-plot limits, ranged mix, layout parameters, archetype and boss templates | `schemas/threats.schema.json`      |
| `sounds.json`          | Sound effect recipes (`ui_click`, ...): wave, pitch, envelope, filters; rendered to `assets/audio/` by `pnpm audio:build` | `schemas/sounds.schema.json`       |
| `music.json`           | Music: instruments and the build, battle, win and loss tracks (tempo, scale, note patterns); played by a synth in the browser, no audio files | `schemas/music.schema.json`        |
| `presentation.en.json` | English names and descriptions for buildings, units, terrain, archetypes, event types and run modifiers, plus the effect-sentence templates, kind labels, "needs" words and screen texts | `schemas/presentation.schema.json` |

Rules files hold no display text; the presentation file holds no rules and
needs exactly one entry per building, unit, terrain feature, archetype, event
type and run modifier. Descriptions
refer to resources as `{res_a}`, which `formatText` in `core` replaces with the
configured name. In `buildings.json`, sides (`north`, `east`, `south`, `west`)
describe rotation 0, and each bought building has exactly three tiers. The
`core` building is not bought: it has one `tiers` entry holding only `health`.
Route buildings (splitter, merger, crossover) name no resource on their inputs
because they carry whatever they are fed.
A Tunnel is two route buildings, an entrance (`routeType` `tunnel_in`, one input
side, no output side) and an exit (`tunnel_out`, one output side, no input side),
both 1x1. The entrance names its exit in `partner` and the most cells between the
two ends in `maxSpanCells` (the same at every tier); one shop item puts both into
the stash. Each end has its own `price`: the item costs their sum, and the
entrance's price is the exit's or one more (it takes the odd gold), so selling
either end refunds its own share.
A unit producer tier gives either `costPerUnit` (one cost for every resource it
takes, counted alike) or `costs` (a cost per resource, for a building with one
input per resource, such as the Foundry); never both. Every resource in `costs`
needs an input and every input resource needs a cost.
A unit producer tier may also give `unitsPerProduction` (an integer from 1 to 4,
1 when absent): one production spawns that many units and costs `costPerUnit`
(or each of `costs`) times it.
A turret tier may also give `minRangeCells` (an integer from 1 up to `rangeCells`
minus 1: the turret ignores units closer than that, measured from the unit's
centre to the turret's nearest cell) and `splashPercent` (1 to 100) with
`splashRadiusCells` (1 or 2), both or neither: the shot also hurts the other
enemy units within that radius of its target for that percent of the damage, at
least 1 (area damage as for a unit's `splash`). With none of them a turret
behaves as before.
A `refinery` building names an `output` (a refined resource: one with
`refinedFrom` in `resources.json`, whose `refinedFrom` is the set of the
resources of its inputs) and each tier gives `costs` (a cost for every input
resource), `productionIntervalTicks` and `outputPerBatch`. Resources without
`refinedFrom` are base resources and need a `rarity`; refined resources have
none and are never placed on maps.
A unit may give `splash` (`radiusSub` in sub-cell units, 240 per cell, and
`percent`): when it attacks a unit, other enemy units whose centre is within
that radius of the target take that percent of the hit.
A unit may give `armor` (an integer, 0 when absent): it is taken off every hit
on that unit, and a hit above 0 always deals at least 1.
