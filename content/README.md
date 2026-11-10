# content

Game data files (JSON): buildings, encounter and boss templates, scaling
constants, and so on. Rules are kept separate from names, descriptions, and
art. Every file here is validated against a schema in [`../schemas/`](../schemas/).
Filled by later issues.

## Files

| File                   | Holds                                                      | Schema                             |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------- |
| `resources.json`       | Resources and their display names (TA-27a)                 | `schemas/resources.schema.json`    |
| `terrain.json`         | Natural-feature rules (`ter_*` IDs)                        | `schemas/terrain.schema.json`      |
| `units.json`           | Unit numbers (`unit_*` IDs), integers only                 | `schemas/units.schema.json`        |
| `buildings.json`       | Building rules (`bld_*` IDs): kind, footprint, tiers, sides | `schemas/buildings.schema.json`    |
| `mapgen.json`          | Map generation parameters (board size, nodes, lakes, cliffs) | `schemas/mapgen.schema.json`       |
| `sim.json`             | Battle clock, flow and breach constants (ticks per second, buffer size, breach costs) | `schemas/sim.schema.json`          |
| `presentation.en.json` | English names and descriptions for buildings, units, terrain | `schemas/presentation.schema.json` |

Rules files hold no display text; the presentation file holds no rules and
needs exactly one entry per building, unit, and terrain feature. Descriptions
refer to resources as `{res_a}`, which `formatText` in `core` replaces with the
configured name. In `buildings.json`, sides (`north`, `east`, `south`, `west`)
describe rotation 0, and each bought building has exactly three tiers. The
`core` building is not bought: it has one `tiers` entry holding only `health`.
Route buildings (splitter, merger, crossover) name no resource on their inputs
because they carry whatever they are fed.
