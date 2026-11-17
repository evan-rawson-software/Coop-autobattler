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
| `threats.json`         | PvE threats: budget curve (SC-1), unit prices, per-plot limits, ranged mix, layout parameters, archetype and boss templates | `schemas/threats.schema.json`      |
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
A unit producer tier gives either `costPerUnit` (one cost for every resource it
takes, counted alike) or `costs` (a cost per resource, for a building with one
input per resource, such as the Foundry); never both. Every resource in `costs`
needs an input and every input resource needs a cost.
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
